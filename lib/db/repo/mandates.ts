import "server-only";
import { db, id, now, sha256 } from "../index";
import { track } from "./events";
import type { MandateRow } from "../types";

// Mandatos. APPEND-ONLY.
//
// Es el registro de que una persona autorizó que Ork toque su suscripción. La
// tabla tiene triggers que impiden editar y borrar: desde aquí solo se puede
// insertar y revocar. Eso no es paranoia — si llega una disputa, este registro
// es lo único que dice qué autorizó la persona y cuándo.
//
// Se guarda el HASH del texto mostrado, no solo su versión: si alguien editara
// texts.ts sin subir de versión, el hash lo delataría.

export interface GrantInput {
  userId: string;
  serviceId: string;
  actionType: string;
  textVersion: string;
  /** El texto completo tal como se mostró. Se hashea, no se guarda. */
  fullText: string;
  ip?: string;
  userAgent?: string;
  /** ¿La persona llegó al final del texto? El botón lo exige. */
  scrolledToEnd: boolean;
}

export function grant(input: GrantInput): MandateRow {
  const row: MandateRow = {
    id: id(),
    user_id: input.userId,
    service_id: input.serviceId,
    action_type: input.actionType,
    text_version: input.textVersion,
    text_hash: sha256(input.fullText),
    timestamp: now(),
    ip: input.ip ?? null,
    user_agent: input.userAgent ?? null,
    revoked_at: null,
  };

  db()
    .prepare(
      `INSERT INTO mandates
         (id, user_id, service_id, action_type, text_version, text_hash, timestamp, ip, user_agent, scrolled_to_end)
       VALUES
         (@id, @user_id, @service_id, @action_type, @text_version, @text_hash, @timestamp, @ip, @user_agent, @scrolled)`,
    )
    .run({ ...row, scrolled: input.scrolledToEnd ? 1 : 0 });

  track({
    type: "mandate.granted",
    userId: input.userId,
    serviceId: input.serviceId,
    payload: {
      textVersion: input.textVersion,
      actionType: input.actionType,
      scrolledToEnd: input.scrolledToEnd,
    },
  });

  return row;
}

/** Revocar es la ÚNICA mutación permitida sobre un mandato. */
export function revoke(userId: string, mandateId: string): boolean {
  const res = db()
    .prepare(
      `UPDATE mandates SET revoked_at = ?
        WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
    )
    .run(now(), mandateId, userId);

  if (res.changes > 0) {
    const m = db()
      .prepare<[string], MandateRow>("SELECT * FROM mandates WHERE id = ?")
      .get(mandateId);
    track({
      type: "mandate.revoked",
      userId,
      serviceId: m?.service_id,
      payload: { mandateId, textVersion: m?.text_version },
    });
  }
  return res.changes > 0;
}

/** El mandato vigente para (usuario, servicio, acción), si existe. */
export function activeMandate(
  userId: string,
  serviceId: string,
  actionType: string,
): MandateRow | undefined {
  return db()
    .prepare<[string, string, string], MandateRow>(
      `SELECT * FROM mandates
        WHERE user_id = ? AND service_id = ? AND action_type = ? AND revoked_at IS NULL
        ORDER BY timestamp DESC LIMIT 1`,
    )
    .get(userId, serviceId, actionType);
}

/** Todos los mandatos del usuario, vigentes y revocados, del más nuevo al más viejo. */
export function listMandates(userId: string): MandateRow[] {
  return db()
    .prepare<[string], MandateRow>(
      "SELECT * FROM mandates WHERE user_id = ? ORDER BY timestamp DESC",
    )
    .all(userId);
}
