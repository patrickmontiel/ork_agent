import "server-only";
import { db, id, now } from "../index";
import { track } from "./events";

// Cobros de Ork a la persona.
//
// Esto NO es el cobro de la suscripción: el dinero del merchant nunca pasa por
// Ork. Aquí solo vive lo que Ork cobra por su propio servicio.

export interface ChargeRow {
  id: string;
  user_id: string;
  kind: "fee" | "premium";
  orchestration_id: string | null;
  amount: number;
  currency: string;
  status: "pendiente" | "pagado" | "fallido" | "cancelado";
  stripe_session_id: string | null;
  stripe_payment_intent: string | null;
  created_at: string;
  paid_at: string | null;
}

export interface CreateChargeInput {
  userId: string;
  kind: "fee" | "premium";
  orchestrationId?: string;
  amount: number;
  currency?: string;
  stripeSessionId?: string;
}

/**
 * Crea el cobro en estado pendiente.
 *
 * Devuelve null si ya existe un fee para esa orquestación: el índice único de
 * la base es la reja final contra el doble cobro, por debajo de la idempotencia
 * de webhooks. Que el llamador reciba null en vez de una excepción hace que el
 * camino correcto sea también el más cómodo.
 */
export function createCharge(input: CreateChargeInput): ChargeRow | null {
  const row: ChargeRow = {
    id: id(),
    user_id: input.userId,
    kind: input.kind,
    orchestration_id: input.orchestrationId ?? null,
    amount: input.amount,
    currency: input.currency ?? "MXN",
    status: "pendiente",
    stripe_session_id: input.stripeSessionId ?? null,
    stripe_payment_intent: null,
    created_at: now(),
    paid_at: null,
  };

  try {
    db()
      .prepare(
        `INSERT INTO charges
           (id, user_id, kind, orchestration_id, amount, currency, status,
            stripe_session_id, stripe_payment_intent, created_at, paid_at)
         VALUES
           (@id, @user_id, @kind, @orchestration_id, @amount, @currency, @status,
            @stripe_session_id, @stripe_payment_intent, @created_at, @paid_at)`,
      )
      .run(row);
    return row;
  } catch (e) {
    // UNIQUE violado = ya hay un fee para esa orquestación. No es un error.
    if (e instanceof Error && /UNIQUE/i.test(e.message)) return null;
    throw e;
  }
}

export function feeForOrchestration(orchestrationId: string): ChargeRow | undefined {
  return db()
    .prepare<[string], ChargeRow>(
      "SELECT * FROM charges WHERE orchestration_id = ? AND kind = 'fee'",
    )
    .get(orchestrationId);
}

export function byId(chargeId: string, userId: string): ChargeRow | undefined {
  return db()
    .prepare<[string, string], ChargeRow>("SELECT * FROM charges WHERE id = ? AND user_id = ?")
    .get(chargeId, userId);
}

export function bySession(sessionId: string): ChargeRow | undefined {
  return db()
    .prepare<[string], ChargeRow>("SELECT * FROM charges WHERE stripe_session_id = ?")
    .get(sessionId);
}

export function attachSession(chargeId: string, sessionId: string): void {
  db()
    .prepare("UPDATE charges SET stripe_session_id = ? WHERE id = ?")
    .run(sessionId, chargeId);
}

/** Marca pagado. Idempotente: si ya estaba pagado, no hace nada ni reemite evento. */
export function markPaid(chargeId: string, paymentIntent?: string): boolean {
  const res = db()
    .prepare(
      `UPDATE charges SET status = 'pagado', paid_at = ?, stripe_payment_intent = COALESCE(?, stripe_payment_intent)
        WHERE id = ? AND status <> 'pagado'`,
    )
    .run(now(), paymentIntent ?? null, chargeId);

  if (res.changes > 0) {
    const c = db().prepare<[string], ChargeRow>("SELECT * FROM charges WHERE id = ?").get(chargeId);
    track({
      type: "fee.charged",
      userId: c?.user_id,
      orchestrationId: c?.orchestration_id ?? undefined,
      payload: { kind: c?.kind, amount: c?.amount, currency: c?.currency },
    });
  }
  return res.changes > 0;
}

export function markFailed(chargeId: string, motivo: string): void {
  db()
    .prepare("UPDATE charges SET status = 'fallido' WHERE id = ? AND status = 'pendiente'")
    .run(chargeId);
  track({ type: "fee.skipped", payload: { chargeId, motivo }, severity: "warn" });
}

export function listCharges(userId: string, limit = 20): ChargeRow[] {
  return db()
    .prepare<[string, number], ChargeRow>(
      "SELECT * FROM charges WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
    )
    .all(userId, limit);
}
