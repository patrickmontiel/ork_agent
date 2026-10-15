import "server-only";
import { db, id, now } from "../index";

// Tarjetas del usuario.
//
// Aquí NO vive ningún PAN. Solo la referencia de Stripe y los últimos 4
// dígitos, que existen para una sola cosa: que la persona reconozca cuál de
// sus tarjetas es. Ork nunca ve ni guarda el número completo.

export interface CardRow {
  id: string;
  user_id: string;
  stripe_payment_method_id: string | null;
  brand: string | null;
  last4: string | null;
  exp_month: number | null;
  exp_year: number | null;
  is_default: number;
  created_at: string;
}

export interface CardView {
  id: string;
  brand: string;
  last4: string;
  isDefault: boolean;
  /** "Visa ·· 4242" — lo que se le muestra a la persona. */
  label: string;
  /** Vence antes de la fecha elegida: Ork debe avisar antes de mover nada. */
  expired: boolean;
}

export function listCards(userId: string): CardView[] {
  const rows = db()
    .prepare<[string], CardRow>(
      "SELECT * FROM cards WHERE user_id = ? ORDER BY is_default DESC, created_at",
    )
    .all(userId);
  return rows.map(toView);
}

export function getDefaultCard(userId: string): CardView | undefined {
  return listCards(userId).find((c) => c.isDefault) ?? listCards(userId)[0];
}

function toView(r: CardRow): CardView {
  const brand = r.brand ?? "Tarjeta";
  const last4 = r.last4 ?? "····";
  return {
    id: r.id,
    brand,
    last4,
    isDefault: r.is_default === 1,
    label: `${brand} ·· ${last4}`,
    expired: isExpired(r.exp_month, r.exp_year),
  };
}

function isExpired(month: number | null, year: number | null): boolean {
  if (!month || !year) return false;
  const now = new Date();
  // Una tarjeta vence al final de su mes.
  const end = new Date(Date.UTC(year, month, 1));
  return now >= end;
}

export function addCard(input: {
  userId: string;
  stripePaymentMethodId?: string;
  brand?: string;
  last4?: string;
  expMonth?: number;
  expYear?: number;
  makeDefault?: boolean;
}): CardRow {
  const row: CardRow = {
    id: id(),
    user_id: input.userId,
    stripe_payment_method_id: input.stripePaymentMethodId ?? null,
    brand: input.brand ?? null,
    last4: input.last4 ?? null,
    exp_month: input.expMonth ?? null,
    exp_year: input.expYear ?? null,
    is_default: 0,
    created_at: now(),
  };

  db().transaction(() => {
    const count = db()
      .prepare<[string], { n: number }>("SELECT COUNT(*) n FROM cards WHERE user_id = ?")
      .get(input.userId)!.n;
    // La primera tarjeta siempre queda como predeterminada.
    row.is_default = input.makeDefault || count === 0 ? 1 : 0;
    if (row.is_default === 1) {
      db().prepare("UPDATE cards SET is_default = 0 WHERE user_id = ?").run(input.userId);
    }
    db()
      .prepare(
        `INSERT INTO cards (id, user_id, stripe_payment_method_id, brand, last4, exp_month, exp_year, is_default, created_at)
         VALUES (@id, @user_id, @stripe_payment_method_id, @brand, @last4, @exp_month, @exp_year, @is_default, @created_at)`,
      )
      .run(row);
  })();

  return row;
}

export function setDefaultCard(userId: string, cardId: string): void {
  db().transaction(() => {
    db().prepare("UPDATE cards SET is_default = 0 WHERE user_id = ?").run(userId);
    db().prepare("UPDATE cards SET is_default = 1 WHERE id = ? AND user_id = ?").run(cardId, userId);
  })();
}
