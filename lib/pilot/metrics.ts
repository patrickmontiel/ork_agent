import "server-only";
import { db } from "@/lib/db";
import {
  verdictExito,
  verdictCorte,
  verdictRestringidas,
  verdictComprension,
  verdictDesventaja,
  MIN_ORQUESTACIONES,
  MIN_ENCUESTAS,
  MIN_TRADEOFFS_VISTOS,
  type Verdict,
} from "./verdicts";

// Las 5 métricas del piloto.
//
// Son las que deciden si Ork sigue o se apaga, así que están escritas para
// poder salir mal. Un tablero que solo puede dar verde no sirve de nada.
//
// Dos decisiones que hacen que estos números signifiquen algo:
//
//   1. Todo se cuenta sobre orquestaciones EJECUTADAS (las que pasaron de
//      'confirmado'). Las que expiraron sin confirmar no son fallas técnicas:
//      meterlas hundiría el porcentaje de éxito con gente que simplemente
//      cerró la pestaña.
//
//   2. Cuando no hay datos suficientes, el estado es "sin datos", NO "bien".
//      Cero de cero no es 100%.

export type { Verdict };

export interface Metric {
  key: string;
  label: string;
  /** El umbral, dicho como se acordó. */
  target: string;
  value: string;
  verdict: Verdict;
  /** De dónde sale el número, para que nadie tenga que adivinar. */
  detail: string;
  /** Qué hacer si está en rojo. */
  action?: string;
}

/** Orquestaciones que de verdad se ejecutaron: base de casi todo lo demás. */
const EJECUTADAS = `
  SELECT COUNT(*) AS n FROM orchestrations
   WHERE confirmed_at IS NOT NULL
     AND state NOT IN ('registrado', 'expirado', 'rechazado', 'confirmado')
`;

function count(sql: string, params: unknown[] = []): number {
  const r = db().prepare<unknown[], { n: number }>(sql).get(...params);
  return r?.n ?? 0;
}

function pct(part: number, total: number): number {
  return total === 0 ? 0 : (part / total) * 100;
}

function fmtPct(part: number, total: number): string {
  if (total === 0) return "—";
  return `${pct(part, total).toFixed(0)}% (${part} de ${total})`;
}

// ─── 1. Éxito técnico ───────────────────────────────────────────────────────

function exitoTecnico(): Metric {
  const total = count(EJECUTADAS);
  const ok = count("SELECT COUNT(*) AS n FROM orchestrations WHERE state = 'completado'");

  return {
    key: "exito_tecnico",
    label: "Éxito técnico",
    target: "≥ 85%",
    value: fmtPct(ok, total),
    // Con menos de 10 corridas el porcentaje es ruido: una falla mueve 10
    // puntos. Decirlo es más honesto que pintar un verde con 2 de 2.
    verdict: verdictExito(ok, total),
    detail:
      total < MIN_ORQUESTACIONES
        ? `Solo ${total} orquestaciones ejecutadas. Hacen falta ${MIN_ORQUESTACIONES} para que el porcentaje signifique algo.`
        : "Terminadas en 'completado' sobre todas las que se ejecutaron.",
    action: "Revisa los incidentes abajo: casi siempre es el recontrato.",
  };
}

// ─── 2. Incidentes de corte de servicio ─────────────────────────────────────

function corteDeServicio(): Metric {
  const total = count(EJECUTADAS);
  const cortes = count("SELECT COUNT(*) AS n FROM events WHERE type = 'pilot.service_gap'");

  return {
    key: "corte_servicio",
    label: "Cortes de servicio",
    target: "≤ 1 de cada 20 (5%)",
    value: total === 0 ? "—" : `${cortes} de ${total}`,
    verdict: verdictCorte(cortes, total),
    detail:
      "Veces que Ork canceló y no pudo devolver el servicio. No cuenta los días sin servicio que la persona eligió a sabiendas.",
    action: "Cada corte es una persona sin su servicio. Escríbele antes de mirar el tablero.",
  };
}

// ─── 3. Cuentas restringidas ────────────────────────────────────────────────

function cuentasRestringidas(): Metric {
  const n = count("SELECT COUNT(*) AS n FROM events WHERE type = 'pilot.account_restricted'");

  return {
    key: "cuentas_restringidas",
    label: "Cuentas restringidas",
    target: "0. Sin excepción",
    value: String(n),
    // Aquí no hay "alerta": una sola cuenta restringida ya es el peor
    // resultado posible del piloto, y además apaga los adaptadores reales.
    verdict: verdictRestringidas(n),
    detail:
      n === 0
        ? "Ningún servicio ha restringido la cuenta de un usuario."
        : "Un servicio restringió al menos una cuenta. El piloto se apagó solo.",
    action: "No reactives los adaptadores hasta entender qué lo disparó.",
  };
}

// ─── 4. Comprensión ─────────────────────────────────────────────────────────

function comprension(): Metric {
  const total = count("SELECT COUNT(*) AS n FROM survey_answers");
  const si = count("SELECT COUNT(*) AS n FROM survey_answers WHERE understood = 1");

  return {
    key: "comprension",
    label: "Entendieron qué iba a pasar",
    target: "≥ 90%",
    value: fmtPct(si, total),
    verdict: verdictComprension(si, total),
    detail:
      total < MIN_ENCUESTAS
        ? `Solo ${total} respuestas. Hacen falta ${MIN_ENCUESTAS} para leerlo.`
        : "Se pregunta justo después de mover la fecha, sobre lo que acaba de pasar.",
    action: "Si baja, el problema es el texto del trade-off, no la gente.",
  };
}

// ─── 5. Cancelaciones por desventaja ────────────────────────────────────────

function cancelacionesPorDesventaja(): Metric {
  // Base distinta a propósito: aquí el universo es "gente que VIO los números",
  // esté o no ejecutada después. Sobre las ejecutadas daría siempre cero, porque
  // justamente son las que no se ejecutaron.
  const vieron = count(
    "SELECT COUNT(*) AS n FROM orchestrations WHERE tradeoff_json IS NOT NULL",
  );
  const no = count(
    "SELECT COUNT(*) AS n FROM events WHERE type = 'pilot.cancelled_for_disadvantage'",
  );
  const p = pct(no, vieron);

  return {
    key: "cancelan_por_desventaja",
    label: "Dijeron que no al ver los números",
    target: "Sin umbral: es señal, no nota",
    value: fmtPct(no, vieron),
    // Esta métrica NO tiene "mal": que alguien rechace un mal trato es que el
    // producto funcionó. Lo que mide es si el trade-off vale la pena, y eso se
    // lee, no se aprueba.
    verdict: verdictDesventaja(no, vieron),
    detail:
      vieron < MIN_TRADEOFFS_VISTOS
        ? `Solo ${vieron} personas han visto un trade-off.`
        : "Rechazos explícitos sobre todas las personas a las que se les mostraron los números.",
    action:
      p >= 50
        ? "Más de la mitad dice que no: el trade-off que ofrece Ork no compensa. Eso es sobre el producto, no sobre ellos."
        : undefined,
  };
}

// ─── Tablero ────────────────────────────────────────────────────────────────

export function pilotMetrics(): Metric[] {
  return [
    exitoTecnico(),
    corteDeServicio(),
    cuentasRestringidas(),
    comprension(),
    cancelacionesPorDesventaja(),
  ];
}

export interface Incident {
  id: number;
  at: string;
  type: string;
  severity: string;
  orchestration_id: string | null;
  user_id: string | null;
  payload: string | null;
}

/** Lo que hay que mirar antes que el porcentaje: lo que salió mal, en orden. */
export function recentIncidents(limit = 25): Incident[] {
  return db()
    .prepare<[number], Incident>(
      `SELECT id, at, type, severity, orchestration_id, user_id, payload
         FROM events
        WHERE severity IN ('warn', 'critical')
           OR type IN ('pilot.service_gap', 'pilot.account_restricted',
                       'orchestration.incident', 'pilot.cancelled_for_disadvantage')
        ORDER BY id DESC
        LIMIT ?`,
    )
    .all(limit);
}

export interface Funnel {
  vieron: number;
  confirmaron: number;
  ejecutaron: number;
  completaron: number;
  expiraron: number;
  rechazaron: number;
}

/** Dónde se cae la gente. Más útil que cualquier promedio. */
export function funnel(): Funnel {
  return {
    vieron: count("SELECT COUNT(*) AS n FROM orchestrations WHERE tradeoff_json IS NOT NULL"),
    confirmaron: count("SELECT COUNT(*) AS n FROM orchestrations WHERE confirmed_at IS NOT NULL"),
    ejecutaron: count(EJECUTADAS),
    completaron: count("SELECT COUNT(*) AS n FROM orchestrations WHERE state = 'completado'"),
    expiraron: count("SELECT COUNT(*) AS n FROM orchestrations WHERE state = 'expirado'"),
    rechazaron: count("SELECT COUNT(*) AS n FROM orchestrations WHERE state = 'rechazado'"),
  };
}

export interface Money {
  feesPagados: number;
  feesPendientes: number;
  montoPagado: number;
  montoPendiente: number;
  premium: number;
}

/** El otro lado: si los links de cobro se pagan o se quedan colgados. */
export function money(): Money {
  const row = db()
    .prepare<[], Money>(
      `SELECT
         COALESCE(SUM(CASE WHEN kind='fee' AND status='pagado'    THEN 1 ELSE 0 END), 0) AS feesPagados,
         COALESCE(SUM(CASE WHEN kind='fee' AND status='pendiente' THEN 1 ELSE 0 END), 0) AS feesPendientes,
         COALESCE(SUM(CASE WHEN kind='fee' AND status='pagado'    THEN amount ELSE 0 END), 0) AS montoPagado,
         COALESCE(SUM(CASE WHEN kind='fee' AND status='pendiente' THEN amount ELSE 0 END), 0) AS montoPendiente,
         COALESCE(SUM(CASE WHEN kind='premium' AND status='pagado' THEN 1 ELSE 0 END), 0) AS premium
       FROM charges`,
    )
    .get();
  return row ?? { feesPagados: 0, feesPendientes: 0, montoPagado: 0, montoPendiente: 0, premium: 0 };
}
