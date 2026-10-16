import "server-only";
import { stripe, stripeEnabled, feeAmountMXN, premiumAmountMXN, toCents, baseUrl } from "@/lib/stripe/client";
import { createCharge, attachSession, feeForOrchestration } from "@/lib/db/repo/charges";
import { setStripeCustomer } from "@/lib/db/repo/users";
import { feeDecision, countsAsCharged, type FeeSkipReason } from "@/lib/billing/rules";
import type { UserRow } from "@/lib/db/types";

// Cuándo cobra Ork.
//
// LA REGLA: el fee se cobra SOLO después de una orquestación exitosa y
// verificada. No al confirmar, no al intentar, no al fallar. Si Ork no movió
// la fecha, Ork no cobra — y si el motor no pudo verificar el cambio, para
// efectos del cobro eso es un fallo.
//
// Premium es distinto: es una mensualidad, no depende de ninguna orquestación.

export type FeeOutcome =
  | { charged: false; reason: FeeSkipReason }
  | { charged: true; chargeId: string; checkoutUrl: string; amount: number; currency: string };

/**
 * Crea el cobro del fee tras una orquestación exitosa.
 *
 * Devuelve el link de pago, no cobra por su cuenta: Ork no guarda la tarjeta
 * de la persona ni la carga off-session sin que lo vea. El cobro se completa
 * cuando el webhook confirma la sesión.
 */
export async function chargeFeeAfterSuccess(
  user: UserRow,
  orchestrationId: string,
  orchestrationSucceeded: boolean,
): Promise<FeeOutcome> {
  const previo = feeForOrchestration(orchestrationId);

  // "Ya cobrado" significa cobrado de verdad. Un cobro que quedó en pendiente
  // porque Stripe se cayó a mitad NO está cobrado: ahí hay una fila sin sesión
  // de pago, y tratarla como cobrada dejaría a la persona sin link para pagar y
  // a Ork sin forma de reintentar. Nunca. Ese caso se retoma más abajo.
  const yaCobrado = countsAsCharged(previo?.status);

  // La decisión vive en lib/billing/rules.ts, sin Stripe ni base de datos
  // alrededor, para poder probarla sola. Aquí solo se la obedece.
  const decision = feeDecision({
    plan: user.plan,
    orchestrationSucceeded,
    alreadyCharged: yaCobrado,
    stripeEnabled: stripeEnabled(),
  });
  if (!decision.charge) return { charged: false, reason: decision.reason };

  const amount = previo?.amount ?? feeAmountMXN();
  // Se reusa la fila anterior si existe: el monto se congela en el primer
  // intento, así que un cambio de ORK_FEE_MXN no reprecia algo ya prometido.
  const charge =
    previo ??
    createCharge({
      userId: user.id,
      kind: "fee",
      orchestrationId,
      amount,
      currency: "MXN",
    }) ??
    // null = otra petición ganó la carrera. El índice único hizo su trabajo, y
    // la fila que ella creó es la buena.
    feeForOrchestration(orchestrationId);

  if (!charge) return { charged: false, reason: "ya_cobrado" };

  const s = stripe();
  const customerId = await ensureCustomer(s, user);

  const session = await s.checkout.sessions.create(
    {
      mode: "payment",
      customer: customerId,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "mxn",
            unit_amount: toCents(amount),
            product_data: {
              name: "Ork — cambio de fecha",
              description: "Se cobra solo porque el cambio se completó.",
            },
          },
        },
      ],
      success_url: `${baseUrl()}/cuenta/cobros?pago=ok`,
      cancel_url: `${baseUrl()}/cuenta/cobros?pago=cancelado`,
      metadata: { orkChargeId: charge.id, orkKind: "fee", orkOrchestrationId: orchestrationId },
    },
    // La clave va atada al cobro, no al tiempo. Por eso un reintento —el de la
    // librería o el de una corrida posterior— recupera la MISMA sesión en vez
    // de abrir una segunda que también habría que pagar.
    { idempotencyKey: `fee_${charge.id}` },
  );

  if (session.id !== charge.stripe_session_id) attachSession(charge.id, session.id);

  return {
    charged: true,
    chargeId: charge.id,
    checkoutUrl: session.url!,
    amount: charge.amount,
    currency: charge.currency,
  };
}

/** Sesión de suscripción para el plan Premium. */
export async function createPremiumCheckout(user: UserRow): Promise<string> {
  const s = stripe();
  const customerId = await ensureCustomer(s, user);
  const amount = premiumAmountMXN();

  const session = await s.checkout.sessions.create(
    {
      mode: "subscription",
      customer: customerId,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "mxn",
            unit_amount: toCents(amount),
            recurring: { interval: "month" },
            product_data: {
              name: "Ork Premium",
              description: "Cambios de fecha ilimitados.",
            },
          },
        },
      ],
      success_url: `${baseUrl()}/cuenta/cobros?premium=ok`,
      cancel_url: `${baseUrl()}/precios?premium=cancelado`,
      metadata: { orkKind: "premium", orkUserId: user.id },
    },
    { idempotencyKey: `premium_${user.id}_${new Date().toISOString().slice(0, 10)}` },
  );

  return session.url!;
}

/** Crea el customer de Stripe la primera vez y lo guarda. */
async function ensureCustomer(
  s: ReturnType<typeof stripe>,
  user: UserRow,
): Promise<string> {
  if (user.stripe_customer_id) return user.stripe_customer_id;
  const c = await s.customers.create(
    { email: user.email, metadata: { orkUserId: user.id } },
    { idempotencyKey: `customer_${user.id}` },
  );
  setStripeCustomer(user.id, c.id);
  return c.id;
}
