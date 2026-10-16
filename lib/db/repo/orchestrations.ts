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
