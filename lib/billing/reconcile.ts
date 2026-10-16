import "server-only";
import { stripe, stripeEnabled } from "@/lib/stripe/client";
import { markPaid, markFailed, listCharges } from "@/lib/db/repo/charges";
import { track } from "@/lib/db/repo/events";
import type { UserRow } from "@/lib/db/types";

// Reconciliación: preguntarle a Stripe en vez de esperar a que avise.
//
// POR QUÉ EXISTE, aunque ya haya webhook:
//
//   - En desarrollo, Stripe no puede alcanzar localhost. Sin `stripe listen`,
//     el webhook NUNCA llega y el cobro se queda en pendiente para siempre
//     aunque la persona haya pagado.
//   - En producción los webhooks también se pierden, se retrasan o llegan
//     después de que la persona ya volvió a la página. Que el estado de un
//     cobro dependa de un mensaje que puede no llegar es frágil.
//
// Stripe es la fuente de verdad; esto solo la va a leer. Usa el MISMO
// markPaid() que el webhook, que es idempotente, así que no importa quién
// llegue primero: el segundo no hace nada.

export interface ReconcileResult {
  revisados: number;
  pagados: number;
  fallidos: number;
}

export async function reconcileUserCharges(user: UserRow): Promise<ReconcileResult> {
  const out: ReconcileResult = { revisados: 0, pagados: 0, fallidos: 0 };
  if (!stripeEnabled()) return out;

  const pendientes = listCharges(user.id, 50).filter(
    (c) => c.status === "pendiente" && c.stripe_session_id,
  );
  if (pendientes.length === 0) return out;

  const s = stripe();

  for (const c of pendientes) {
    out.revisados++;
    try {
      const session = await s.checkout.sessions.retrieve(c.stripe_session_id!);

      if (session.payment_status === "paid") {
        const pi =
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.payment_intent?.id;
        if (markPaid(c.id, pi)) {
          out.pagados++;
          track({
            type: "fee.charged",
            userId: user.id,
            orchestrationId: c.orchestration_id ?? undefined,
            payload: { via: "reconciliacion", chargeId: c.id },
          });
        }
      } else if (session.status === "expired") {
        markFailed(c.id, "sesión de pago expirada");
        out.fallidos++;
      }
    } catch (e) {
      // Que Stripe no conteste no puede tumbar la página de cobros: se deja
      // el cobro como está y se reintenta la próxima vez que entre.
      track({
        type: "fee.skipped",
        userId: user.id,
        severity: "warn",
        payload: {
          motivo: "reconciliación falló",
          chargeId: c.id,
          error: e instanceof Error ? e.message : String(e),
        },
      });
    }
  }

  return out;
}
