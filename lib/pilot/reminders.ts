import "server-only";
import * as orch from "@/lib/db/repo/orchestrations";
import { getService } from "@/lib/db/repo/services";
import { findById } from "@/lib/db/repo/users";
import { sendUndoReminder, sendResubscribeReminder } from "@/lib/mailer";
import { track } from "@/lib/db/repo/events";
import { todayCDMX } from "@/lib/db";

// El barrido que sostiene la fase 2.
//
// Entre cancelar y recontratar pasan días, y en ese hueco la persona está sin
// su servicio. Si nadie le avisa, se queda así. Por eso esto no es una
// comodidad: es la diferencia entre un hueco avisado y uno indefinido.
//
// Tres cosas, en este orden deliberado:
//
//   1. Deshacer, mientras todavía se puede. Va PRIMERO porque es el único aviso
//      con fecha de caducidad real: después de undo_deadline deja de existir.
//   2. Hoy toca recontratar.
//   3. Marcar las que ya nadie va a recontratar, para que se vean.
//
// Es idempotente: cada aviso se marca al mandarse, así que correrlo dos veces
// el mismo día no manda nada dos veces.

export interface SweepResult {
  avisosDeshacer: number;
  avisosRecontrato: number;
  abandonadas: number;
  errores: string[];
}

function baseUrl(): string {
  return process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3001";
}

export async function runReminderSweep(hoy = todayCDMX()): Promise<SweepResult> {
  const out: SweepResult = {
    avisosDeshacer: 0,
    avisosRecontrato: 0,
    abandonadas: 0,
    errores: [],
  };

  // ── 1. Todavía se puede deshacer ──────────────────────────────────────────
  for (const row of orch.dueForUndoReminder(hoy)) {
    try {
      const user = findById(row.user_id);
      const service = getService(row.service_id);
      if (!user || !service || !row.undo_deadline) continue;

      const r = await sendUndoReminder({
        to: user.email,
        serviceName: service.name,
        undoDeadline: row.undo_deadline,
        resubDate: row.to_date ?? "",
        undoUrl: `${baseUrl()}/orquestar/${service.id}/deshacer?id=${row.id}`,
      });
      // Solo se marca si de verdad salió: si falla, se reintenta mañana, que
      // es mejor que darlo por avisado y que nunca se entere.
      if (r.ok) {
        orch.markReminded(row.id, "undo");
        out.avisosDeshacer++;
      }
    } catch (e) {
      out.errores.push(`undo ${row.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ── 2. Hoy toca recontratar ───────────────────────────────────────────────
  for (const row of orch.dueForDueReminder(hoy)) {
    try {
      const user = findById(row.user_id);
      const service = getService(row.service_id);
      if (!user || !service) continue;

      const r = await sendResubscribeReminder({
        to: user.email,
        serviceName: service.name,
        resubDate: row.to_date ?? hoy,
        targetDay: row.to_day ?? 1,
        actionUrl: `${baseUrl()}/orquestar/${service.id}/recontratar?id=${row.id}`,
      });
      if (r.ok) {
        orch.markReminded(row.id, "due");
        out.avisosRecontrato++;
      }
    } catch (e) {
      out.errores.push(`due ${row.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ── 3. Las que ya nadie recontrató ────────────────────────────────────────
  // No se "arregla" nada aquí: se marca para que aparezca en el tablero. El
  // daño ya ocurrió y esconderlo detrás de un promedio sería lo peor.
  for (const row of orch.abandonedCandidates(hoy)) {
    try {
      orch.markAbandoned(row.id, row.user_id, row.service_id);
      out.abandonadas++;
    } catch (e) {
      out.errores.push(`abandono ${row.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // OJO: el resumen del barrido NO puede usar pilot.service_gap. Esa métrica
  // cuenta eventos, así que emitirlo aquí sumaría un "corte de servicio" en
  // cada corrida y el tablero mentiría. Tipo propio, que no alimenta métricas.
  track({
    type: "pilot.sweep",
    severity: out.errores.length > 0 ? "warn" : "info",
    payload: { barrido: hoy, ...out },
  });

  return out;
}
