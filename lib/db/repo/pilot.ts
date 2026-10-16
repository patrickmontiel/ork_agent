import "server-only";
import { db, now } from "../index";
import { track } from "./events";
import type { PilotSwitchRow } from "../types";

// Interruptor del piloto.
//
// Los adaptadores reales (los que tocan cuentas de Spotify/Netflix) solo corren
// si TRES cosas son ciertas a la vez:
//   1. ADAPTER_MODE=real en el entorno
//   2. el interruptor de la base está encendido
//   3. nadie lo apagó por incidente
//
// Si el piloto detecta una cuenta restringida, `kill()` apaga el 2 y deja el
// motivo escrito. Reactivar es manual y a propósito: un banner lo ve quien
// entra al admin, pero el daño le pasa al siguiente usuario de la cola.

function row(): PilotSwitchRow {
  return db()
    .prepare<[], PilotSwitchRow>("SELECT * FROM pilot_switch WHERE id = 1")
    .get()!;
}

export interface PilotStatus {
  /** ¿Los adaptadores reales pueden correr ahora mismo? */
  live: boolean;
  /** Lo que pide el entorno, antes del interruptor. */
  envMode: "mock" | "real";
  /** Encendido manual en la base. */
  switchOn: boolean;
  killedAt: string | null;
  killReason: string | null;
  /** Por qué NO está vivo, en una línea, para mostrar en el admin. */
  blockedBy: string | null;
}

export function status(): PilotStatus {
  const r = row();
  const envMode = process.env.ADAPTER_MODE === "real" ? "real" : "mock";
  const switchOn = r.adapters_live === 1;
  const live = envMode === "real" && switchOn;

  let blockedBy: string | null = null;
  if (!live) {
    if (r.killed_at) blockedBy = `Apagado automático: ${r.kill_reason ?? "incidente"}`;
    else if (envMode !== "real") blockedBy = "ADAPTER_MODE=mock en el entorno";
    else blockedBy = "El interruptor del piloto está apagado";
  }

  return {
    live,
    envMode,
    switchOn,
    killedAt: r.killed_at,
    killReason: r.kill_reason,
    blockedBy,
  };
}

/** ¿Puedo tocar una cuenta real ahora? Úsalo antes de instanciar un adaptador. */
export function adaptersLive(): boolean {
  return status().live;
}

/**
 * Apagado de emergencia. Lo dispara una cuenta restringida, y cualquiera puede
 * llamarlo a mano. Es idempotente: si ya está apagado, no pisa el motivo original.
 */
export function kill(reason: string, ctx?: { userId?: string; serviceId?: string; orchestrationId?: string }): void {
  const r = row();
  if (r.killed_at) return; // ya apagado; se conserva el primer motivo

  db()
    .prepare(
      `UPDATE pilot_switch
         SET adapters_live = 0, killed_at = ?, kill_reason = ?, updated_at = ?
       WHERE id = 1`,
    )
    .run(now(), reason, now());

  track({
    type: "pilot.account_restricted",
    severity: "critical",
    userId: ctx?.userId,
    serviceId: ctx?.serviceId,
    orchestrationId: ctx?.orchestrationId,
    payload: { reason },
  });
}

/**
 * Reactivación manual. Pide confirmar el motivo por el que se apagó, para que
 * nadie lo vuelva a encender sin haber leído qué pasó.
 */
export function revive(acknowledgedReason: string): { ok: boolean; error?: string } {
  const r = row();
  if (!r.killed_at) {
    db()
      .prepare("UPDATE pilot_switch SET adapters_live = 1, updated_at = ? WHERE id = 1")
      .run(now());
    return { ok: true };
  }
  if (acknowledgedReason.trim() !== (r.kill_reason ?? "").trim()) {
    return {
      ok: false,
      error: "Para reactivar hay que escribir el motivo exacto del apagado. Léelo primero.",
    };
  }
  db()
    .prepare(
      `UPDATE pilot_switch
         SET adapters_live = 1, killed_at = NULL, kill_reason = NULL, updated_at = ?
       WHERE id = 1`,
    )
    .run(now());
  return { ok: true };
}
