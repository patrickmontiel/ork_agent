import "server-only";
import { db, id, now } from "../index";
import { getService } from "./services";
import type { Service } from "../types";

// Las suscripciones que el usuario conectó a Ork.

export interface UserServiceRow {
  id: string;
  user_id: string;
  service_id: string;
  plan: string | null;
  paid_amount: number | null;
  currency: string;
  billing_day: number | null;
  next_charge: string | null;
  desired_day: number | null;
  status: string;
  connected_at: string;
  updated_at: string;
}

/** Fila + el servicio del catálogo, que es lo que la UI necesita junto. */
export interface UserServiceView extends UserServiceRow {
  service: Service;
}

export function listUserServices(userId: string): UserServiceView[] {
  const rows = db()
    .prepare<[string], UserServiceRow>(
      "SELECT * FROM user_services WHERE user_id = ? ORDER BY connected_at",
    )
    .all(userId);
  return rows
    .map((r) => {
      const service = getService(r.service_id);
      return service ? { ...r, service } : null;
    })
    .filter((x): x is UserServiceView => x !== null);
}

export function getUserService(userId: string, serviceId: string): UserServiceView | undefined {
  const r = db()
    .prepare<[string, string], UserServiceRow>(
      "SELECT * FROM user_services WHERE user_id = ? AND service_id = ?",
    )
    .get(userId, serviceId);
  if (!r) return undefined;
  const service = getService(r.service_id);
  return service ? { ...r, service } : undefined;
}

export function connect(input: {
  userId: string;
  serviceId: string;
  plan?: string;
  paidAmount?: number;
  billingDay?: number;
  nextCharge?: string;
  desiredDay?: number;
}): UserServiceRow {
  const existing = db()
    .prepare<[string, string], UserServiceRow>(
      "SELECT * FROM user_services WHERE user_id = ? AND service_id = ?",
    )
    .get(input.userId, input.serviceId);

  if (existing) {
    // Reconectar no duplica: actualiza lo que venga y conserva lo demás.
    db()
      .prepare(
        `UPDATE user_services
            SET plan = COALESCE(?, plan),
                paid_amount = COALESCE(?, paid_amount),
                billing_day = COALESCE(?, billing_day),
                next_charge = COALESCE(?, next_charge),
                desired_day = COALESCE(?, desired_day),
                updated_at = ?
          WHERE id = ?`,
      )
      .run(
        input.plan ?? null,
        input.paidAmount ?? null,
        input.billingDay ?? null,
        input.nextCharge ?? null,
        input.desiredDay ?? null,
        now(),
        existing.id,
      );
    return getUserService(input.userId, input.serviceId)!;
  }

  const row: UserServiceRow = {
    id: id(),
    user_id: input.userId,
    service_id: input.serviceId,
    plan: input.plan ?? null,
    paid_amount: input.paidAmount ?? null,
    currency: "MXN",
    billing_day: input.billingDay ?? null,
    next_charge: input.nextCharge ?? null,
    desired_day: input.desiredDay ?? null,
    status: "activa",
    connected_at: now(),
    updated_at: now(),
  };
  db()
    .prepare(
      `INSERT INTO user_services
         (id, user_id, service_id, plan, paid_amount, currency, billing_day, next_charge, desired_day, status, connected_at, updated_at)
       VALUES
         (@id, @user_id, @service_id, @plan, @paid_amount, @currency, @billing_day, @next_charge, @desired_day, @status, @connected_at, @updated_at)`,
    )
    .run(row);
  return row;
}

export function setDesiredDay(userServiceId: string, day: number): void {
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    throw new Error(`Día inválido: ${day}. Debe estar entre 1 y 31.`);
  }
  db()
    .prepare("UPDATE user_services SET desired_day = ?, updated_at = ? WHERE id = ?")
    .run(day, now(), userServiceId);
}

export function applyNewDate(userServiceId: string, billingDay: number, nextCharge: string): void {
  db()
    .prepare(
      "UPDATE user_services SET billing_day = ?, next_charge = ?, updated_at = ? WHERE id = ?",
    )
    .run(billingDay, nextCharge, now(), userServiceId);
}
