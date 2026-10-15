import "server-only";
import { db, id, now } from "../index";
import type { UserRow } from "../types";

function normalize(email: string): string {
  return email.trim().toLowerCase();
}

export function findByEmail(email: string): UserRow | undefined {
  return db()
    .prepare<[string], UserRow>("SELECT * FROM users WHERE email = ?")
    .get(normalize(email));
}

export function findById(userId: string): UserRow | undefined {
  return db()
    .prepare<[string], UserRow>("SELECT * FROM users WHERE id = ?")
    .get(userId);
}

/** Crea si no existe; en ambos casos marca que lo acabamos de ver. */
export function upsertByEmail(email: string): UserRow {
  const e = normalize(email);
  const existing = findByEmail(e);
  if (existing) {
    db().prepare("UPDATE users SET last_seen_at = ? WHERE id = ?").run(now(), existing.id);
    return { ...existing, last_seen_at: now() };
  }
  const row: UserRow = {
    id: id(),
    email: e,
    created_at: now(),
    last_seen_at: now(),
    payday_kind: null,
    payday_days: null,
    plan: "free",
    stripe_customer_id: null,
  };
  db()
    .prepare(
      `INSERT INTO users (id, email, created_at, last_seen_at, plan)
       VALUES (@id, @email, @created_at, @last_seen_at, @plan)`,
    )
    .run(row);
  return row;
}

/** Los días de cobro del usuario, como los dejó el chat del agente. */
export function paydays(u: UserRow): number[] {
  if (!u.payday_days) return [];
  try {
    const v = JSON.parse(u.payday_days);
    return Array.isArray(v) ? v.filter((n) => Number.isInteger(n)) : [];
  } catch {
    return [];
  }
}

export function setPaydays(userId: string, kind: string, days: number[]): void {
  db()
    .prepare("UPDATE users SET payday_kind = ?, payday_days = ? WHERE id = ?")
    .run(kind, JSON.stringify(days), userId);
}

export function setPlan(userId: string, plan: "free" | "premium"): void {
  db().prepare("UPDATE users SET plan = ? WHERE id = ?").run(plan, userId);
}

export function setStripeCustomer(userId: string, customerId: string): void {
  db().prepare("UPDATE users SET stripe_customer_id = ? WHERE id = ?").run(customerId, userId);
}
