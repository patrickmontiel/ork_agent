import "server-only";
import { db, id, now } from "../index";

// Encuesta de comprensión.
//
// Una sola pregunta, hecha justo después de mover la fecha: "¿entendiste lo que
// iba a pasar antes de que pasara?". Se pregunta sobre algo que la persona
// acaba de vivir, no en abstracto.
//
// Es la métrica 4 del piloto, y es la única que no se puede sacar de los logs:
// que el sistema funcione no quiere decir que la persona haya entendido qué
// aceptaba.

export interface SurveyRow {
  id: string;
  orchestration_id: string;
  user_id: string;
  understood: number;
  comment: string | null;
  at: string;
}

/**
 * Guarda la respuesta. Una por orquestación: el índice único lo garantiza y
 * una segunda se ignora en silencio, para que nadie pueda inflar el número
 * respondiendo varias veces.
 */
export function answer(input: {
  orchestrationId: string;
  userId: string;
  understood: boolean;
  comment?: string;
}): boolean {
  const res = db()
    .prepare(
      `INSERT OR IGNORE INTO survey_answers (id, orchestration_id, user_id, understood, comment, at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id(),
      input.orchestrationId,
      input.userId,
      input.understood ? 1 : 0,
      input.comment?.trim() || null,
      now(),
    );
  return res.changes > 0;
}

export function answeredFor(orchestrationId: string): SurveyRow | undefined {
  return db()
    .prepare<[string], SurveyRow>("SELECT * FROM survey_answers WHERE orchestration_id = ?")
    .get(orchestrationId);
}

/** Los comentarios de quienes dijeron que NO entendieron. Es lo que hay que leer. */
export function confusedComments(limit = 20): { comment: string; at: string }[] {
  return db()
    .prepare<[number], { comment: string; at: string }>(
      `SELECT comment, at FROM survey_answers
        WHERE understood = 0 AND comment IS NOT NULL AND comment <> ''
        ORDER BY at DESC LIMIT ?`,
    )
    .all(limit);
}
