import "server-only";
import { db, id, now } from "../index";
import { track } from "./events";
import type { Tradeoff, TradeoffOption } from "@/lib/pilot/tradeoff";
import type { RunResult } from "@/lib/pilot/run";
import type { ServiceState } from "@/lib/adapters/types";

// Una orquestación = un intento de mover la fecha de un servicio.
//
// Se registra ANTES de tocar nada, con el trade-off exacto que se le mostró a
// la persona. Si algún día hay una disputa, esta fila dice qué vio, qué eligió
// y qué pasó después.

export interface OrchestrationRow {
  id: string;
  user_id: string;
  service_id: string;
  user_service_id: string | null;
  mandate_id: string | null;
  state: string;
  from_day: number | null;
  to_day: number | null;
  from_date: string | null;
  to_date: string | null;
  tradeoff_json: string | null;
  chosen_option: string | null;
  prior_state_json: string | null;
  had_promo: number;
  promo_lost: number;
  retries: number;
  adapter_mode: string;
  confirm_deadline: string | null;
  confirmed_at: string | null;
  error: string | null;
  fee_charged: number;
  undo_deadline: string | null;
  reminded_undo_at: string | null;
  reminded_due_at: string | null;
  abandoned_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Ventana para confirmar. Pasada esta hora, la corrida expira sin ejecutarse. */
export const CONFIRM_WINDOW_MINUTES = 15;

export interface CreateInput {
  userId: string;
  serviceId: string;
  userServiceId?: string;
  mandateId: string;
  tradeoff: Tradeoff;
  fromDay: number | null;
  toDay: number;
  hadPromo: boolean;
  adapterMode: string;
}

/**
 * Registra la intención. Nace en "registrado" y con un plazo de confirmación:
 * el silencio no es consentimiento, así que si nadie confirma, expira.
 */
export function create(input: CreateInput): OrchestrationRow {
  const deadline = new Date(Date.now() + CONFIRM_WINDOW_MINUTES * 60_000).toISOString();
  const row: OrchestrationRow = {
    id: id(),
    user_id: input.userId,
    service_id: input.serviceId,
    user_service_id: input.userServiceId ?? null,
    mandate_id: input.mandateId,
    state: "registrado",
    from_day: input.fromDay,
    to_day: input.toDay,
    from_date: null,
    to_date: input.tradeoff.esperar.resubDate,
    tradeoff_json: JSON.stringify(input.tradeoff),
    chosen_option: null,
    prior_state_json: null,
    had_promo: input.hadPromo ? 1 : 0,
    promo_lost: 0,
    retries: 0,
    adapter_mode: input.adapterMode,
    confirm_deadline: deadline,
    confirmed_at: null,
    error: null,
    fee_charged: 0,
    undo_deadline: null,
    reminded_undo_at: null,
    reminded_due_at: null,
    abandoned_at: null,
    created_at: now(),
    updated_at: now(),
  };

  db()
    .prepare(
      `INSERT INTO orchestrations
         (id, user_id, service_id, user_service_id, mandate_id, state, from_day, to_day,
          from_date, to_date, tradeoff_json, chosen_option, prior_state_json, had_promo,
          promo_lost, retries, adapter_mode, confirm_deadline, confirmed_at, error,
          fee_charged, created_at, updated_at)
       VALUES
         (@id, @user_id, @service_id, @user_service_id, @mandate_id, @state, @from_day, @to_day,
          @from_date, @to_date, @tradeoff_json, @chosen_option, @prior_state_json, @had_promo,
          @promo_lost, @retries, @adapter_mode, @confirm_deadline, @confirmed_at, @error,
          @fee_charged, @created_at, @updated_at)`,
    )
    .run(row);

  track({
    type: "orchestration.started",
    userId: input.userId,
    serviceId: input.serviceId,
    orchestrationId: row.id,
    payload: {
      toDay: input.toDay,
      diasSinServicio: input.tradeoff.esperar.daysWithoutService,
      reforzada: input.tradeoff.reinforced,
      adapterMode: input.adapterMode,
    },
  });

  return row;
}

export function get(orchestrationId: string, userId: string): OrchestrationRow | undefined {
  return db()
    .prepare<[string, string], OrchestrationRow>(
      "SELECT * FROM orchestrations WHERE id = ? AND user_id = ?",
    )
    .get(orchestrationId, userId);
}

export function listForUser(userId: string, limit = 20): OrchestrationRow[] {
  return db()
    .prepare<[string, number], OrchestrationRow>(
      "SELECT * FROM orchestrations WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
    )
    .all(userId, limit);
}

/** ¿Sigue dentro de la ventana para confirmar? */
export function isConfirmable(o: OrchestrationRow): boolean {
  if (o.state !== "registrado") return false;
  if (o.confirmed_at) return false;
  if (!o.confirm_deadline) return false;
  return Date.now() <= Date.parse(o.confirm_deadline);
}

export function confirm(orchestrationId: string, chosen: TradeoffOption): boolean {
  const res = db()
    .prepare(
      `UPDATE orchestrations
          SET confirmed_at = ?, chosen_option = ?, state = 'confirmado', updated_at = ?
        WHERE id = ? AND state = 'registrado' AND confirmed_at IS NULL`,
    )
    .run(now(), chosen.kind, now(), orchestrationId);
  if (res.changes > 0) {
    track({ type: "orchestration.confirmed", orchestrationId, payload: { opcion: chosen.kind } });
  }
  return res.changes > 0;
}

export function reject(
  orchestrationId: string,
  motivo: string,
  ctx?: { porDesventaja?: boolean; tradeoff?: Tradeoff; opcion?: string },
): void {
  db()
    .prepare("UPDATE orchestrations SET state = 'rechazado', error = ?, updated_at = ? WHERE id = ?")
    .run(motivo, now(), orchestrationId);
  track({ type: "orchestration.rejected", orchestrationId, payload: { motivo } });

  // Que alguien vea los números y diga que no es una señal distinta de que el
  // link se le haya vencido. Si pasa seguido, el trade-off no vale la pena y
  // eso hay que saberlo, no esconderlo entre los expirados.
  if (ctx?.porDesventaja) {
    track({
      type: "pilot.cancelled_for_disadvantage",
      orchestrationId,
      severity: "warn",
      payload: {
        motivo,
        opcionVista: ctx.opcion,
        diasSinServicio: ctx.tradeoff?.esperar.daysWithoutService,
        costoDeMas: ctx.tradeoff?.adelantar?.extraCost,
      },
    });
  }
}

export function expire(orchestrationId: string): void {
  db()
    .prepare("UPDATE orchestrations SET state = 'expirado', updated_at = ? WHERE id = ?")
    .run(now(), orchestrationId);
  track({ type: "orchestration.expired", orchestrationId });
}

/** Guarda el resultado de la corrida, con el estado previo para poder auditar. */
export function finish(
  orchestrationId: string,
  result: RunResult,
  priorState: ServiceState | null,
): void {
  db()
    .prepare(
      `UPDATE orchestrations
          SET state = ?, retries = ?, prior_state_json = ?, error = ?, promo_lost = ?, updated_at = ?
        WHERE id = ?`,
    )
    .run(
      result.state,
      result.retries,
      priorState ? JSON.stringify(priorState) : null,
      result.state === "completado" ? null : result.userMessage,
      result.state === "completado" && priorState?.paidAmount !== result.finalState?.paidAmount ? 1 : 0,
      now(),
      orchestrationId,
    );

  if (result.state === "completado") {
    track({ type: "orchestration.succeeded", orchestrationId, payload: { retries: result.retries } });
  } else if (result.state === "incidente") {
    track({
      type: "orchestration.incident",
      orchestrationId,
      severity: "critical",
      payload: { retries: result.retries, mensaje: result.userMessage },
    });
  } else {
    track({ type: "orchestration.rolled_back", orchestrationId, payload: { estado: result.state } });
  }

  // El corte de servicio se cuenta aparte del incidente: no todo incidente
  // deja a alguien sin Spotify, y la métrica que importa es justamente esa.
  if (result.serviceGap) {
    track({
      type: "pilot.service_gap",
      orchestrationId,
      severity: "critical",
      payload: { estado: result.state, retries: result.retries, mensaje: result.userMessage },
    });
  }
}


// ─── Fase 2 ─────────────────────────────────────────────────────────────────
//
// Entre cancelar y recontratar pasan días. Estas funciones son las que evitan
// que una persona se quede colgada en ese hueco sin que nadie se entere.

/** Días después del día objetivo tras los cuales se da por abandonada. */
export const ABANDONO_TRAS_DIAS = 3;

/** La fase 1 terminó bien: queda esperando el recontrato. */
export function startWaiting(
  orchestrationId: string,
  undoDeadline: string | null,
  priorState: unknown,
): void {
  db()
    .prepare(
      `UPDATE orchestrations
          SET state = 'esperando_recontrato', undo_deadline = ?, prior_state_json = ?, updated_at = ?
        WHERE id = ?`,
    )
    .run(undoDeadline, priorState ? JSON.stringify(priorState) : null, now(), orchestrationId);

  track({
    type: "orchestration.waiting_resubscribe",
    orchestrationId,
    payload: { undoDeadline },
  });
}

/** Las que están esperando y ya les tocaba recontratar (to_date <= hoy). */
export function dueForResubscribe(today: string): OrchestrationRow[] {
  return db()
    .prepare<[string], OrchestrationRow>(
      `SELECT * FROM orchestrations
        WHERE state = 'esperando_recontrato' AND abandoned_at IS NULL AND to_date <= ?
        ORDER BY to_date`,
    )
    .all(today);
}

/**
 * A quién hay que recordarle que TODAVÍA puede deshacerlo.
 *
 * Se avisa antes de `undo_deadline`, porque después de esa fecha deshacer ya no
 * existe. Avisar tarde es no avisar.
 */
export function dueForUndoReminder(today: string, diasAntes = 2): OrchestrationRow[] {
  // OJO: la ventana se compara contra `today`, NO contra date('now'). Usar el
  // reloj de SQLite aquí hacía que la consulta ignorara el día que recibe, y el
  // aviso de deshacer —el único con fecha de caducidad real— no salía nunca.
  return db()
    .prepare<[string, string, string], OrchestrationRow>(
      `SELECT * FROM orchestrations
        WHERE state = 'esperando_recontrato'
          AND abandoned_at IS NULL
          AND reminded_undo_at IS NULL
          AND undo_deadline IS NOT NULL
          AND undo_deadline > ?
          AND date(undo_deadline, '-' || ? || ' days') <= ?
        ORDER BY undo_deadline`,
    )
    .all(today, String(diasAntes), today);
}

/** A quién hay que avisarle que HOY toca recontratar. */
export function dueForDueReminder(today: string): OrchestrationRow[] {
  return db()
    .prepare<[string], OrchestrationRow>(
      `SELECT * FROM orchestrations
        WHERE state = 'esperando_recontrato'
          AND abandoned_at IS NULL
          AND reminded_due_at IS NULL
          AND to_date <= ?
        ORDER BY to_date`,
    )
    .all(today);
}

export function markReminded(orchestrationId: string, cual: "undo" | "due"): void {
  const col = cual === "undo" ? "reminded_undo_at" : "reminded_due_at";
  db()
    .prepare(`UPDATE orchestrations SET ${col} = ?, updated_at = ? WHERE id = ?`)
    .run(now(), now(), orchestrationId);
}

/**
 * Las que llevan demasiado tiempo esperando: la sesión 2 nunca ocurrió.
 *
 * Es el peor caso del piloto —alguien sin su servicio por culpa de Ork— y por
 * eso se marca y se cuenta aparte de los fallos técnicos.
 */
export function abandonedCandidates(today: string, tras = ABANDONO_TRAS_DIAS): OrchestrationRow[] {
  return db()
    .prepare<[string, string], OrchestrationRow>(
      `SELECT * FROM orchestrations
        WHERE state = 'esperando_recontrato'
          AND abandoned_at IS NULL
          AND to_date IS NOT NULL
          AND date(to_date, '+' || ? || ' days') < ?
        ORDER BY to_date`,
    )
    .all(String(tras), today);
}

export function markAbandoned(orchestrationId: string, userId: string, serviceId: string): void {
  db()
    .prepare(
      "UPDATE orchestrations SET abandoned_at = ?, state = 'abandonado', updated_at = ? WHERE id = ?",
    )
    .run(now(), now(), orchestrationId);

  track({
    type: "pilot.second_session_missed",
    orchestrationId,
    userId,
    serviceId,
    severity: "critical",
    payload: { motivo: "pasó la fecha objetivo y nunca se recontrató" },
  });
}

/** Guarda el resultado de la fase 2. */
export function finishPhase2(
  orchestrationId: string,
  state: string,
  retries: number,
  error: string | null,
): void {
  db()
    .prepare(
      "UPDATE orchestrations SET state = ?, retries = ?, error = ?, updated_at = ? WHERE id = ?",
    )
    .run(state, retries, error, now(), orchestrationId);
}

/**
 * Lo que la persona tiene a medias ahora mismo.
 *
 * Solo `esperando_recontrato` y sin abandonar: es el único estado en que hace
 * falta que haga algo. Ordenado por urgencia —lo que vence antes, primero—
 * porque la tarjeta muestra una a la vez en la portada.
 */
export function pendingForUser(userId: string): OrchestrationRow[] {
  return db()
    .prepare<[string], OrchestrationRow>(
      `SELECT * FROM orchestrations
        WHERE user_id = ? AND state = 'esperando_recontrato' AND abandoned_at IS NULL
        ORDER BY to_date`,
    )
    .all(userId);
}
