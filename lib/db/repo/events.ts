import "server-only";
import { db, now } from "../index";
import type { EventRow, EventSeverity } from "../types";

// Los eventos del piloto son append-only (un trigger bloquea los UPDATE).
// De aquí salen las 5 métricas del tablero de /admin/pilot.

export type EventType =
  // Ciclo de vida de una orquestación
  | "orchestration.started"
  | "orchestration.confirmed"
  | "orchestration.rejected"
  | "orchestration.expired"
  | "orchestration.cancelled_ok"
  | "orchestration.cancelled_fail"
  | "orchestration.resubscribed_ok"
  | "orchestration.resubscribed_fail"
  | "orchestration.verified"
  | "orchestration.succeeded"
  | "orchestration.rolled_back"
  | "orchestration.incident"
  // Señales del piloto
  | "pilot.service_gap"        // el usuario se quedó sin servicio
  | "pilot.account_restricted" // el servicio restringió la cuenta → apagado
  | "pilot.promo_lost"
  | "pilot.cancelled_for_disadvantage"
  // Mandatos
  | "mandate.granted"
  | "mandate.revoked"
  // Cobro
  | "fee.charged"
  | "fee.skipped";

export interface TrackInput {
  type: EventType;
  userId?: string;
  serviceId?: string;
  orchestrationId?: string;
  payload?: unknown;
  severity?: EventSeverity;
}

export function track(e: TrackInput): number {
  const r = db()
    .prepare(
      `INSERT INTO events (at, type, user_id, service_id, orchestration_id, payload, severity)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      now(),
      e.type,
      e.userId ?? null,
      e.serviceId ?? null,
      e.orchestrationId ?? null,
      e.payload === undefined ? null : JSON.stringify(e.payload),
      e.severity ?? "info",
    );
  return Number(r.lastInsertRowid);
}

export function countByType(type: EventType, since?: string): number {
  if (since) {
    return (
      db()
        .prepare<[string, string], { n: number }>(
          "SELECT COUNT(*) n FROM events WHERE type = ? AND at >= ?",
        )
        .get(type, since)?.n ?? 0
    );
  }
  return (
    db()
      .prepare<[string], { n: number }>(
        "SELECT COUNT(*) n FROM events WHERE type = ?",
      )
      .get(type)?.n ?? 0
  );
}

export function recent(limit = 100): EventRow[] {
  return db()
    .prepare<[number], EventRow>(
      "SELECT * FROM events ORDER BY id DESC LIMIT ?",
    )
    .all(limit);
}

export function forOrchestration(orchestrationId: string): EventRow[] {
  return db()
    .prepare<[string], EventRow>(
      "SELECT * FROM events WHERE orchestration_id = ? ORDER BY id",
    )
    .all(orchestrationId);
}

/** Eventos críticos sin resolver: alimentan el banner rojo del admin. */
export function criticals(limit = 20): EventRow[] {
  return db()
    .prepare<[number], EventRow>(
      "SELECT * FROM events WHERE severity = 'critical' ORDER BY id DESC LIMIT ?",
    )
    .all(limit);
}
