// El trade-off, en números exactos.
//
// Sin dependencias de base ni de red: es lógica pura y se prueba sola.
//
// POR QUÉ ESTO ES EL CORAZÓN DE LA FASE
//
// Ningún servicio cerrado permite cambiar la fecha de cobro de forma nativa.
// Ork la mueve cancelando y volviendo a contratar. Pero hay una regla que
// cambia toda la aritmética:
//
//   Reactivar ANTES de que venza el periodo ya pagado conserva la fecha vieja.
//
// Es decir: para que la fecha se mueva de verdad, el recontrato tiene que
// ocurrir cuando el periodo pagado ya venció. Y eso deja a la persona con dos
// salidas, nunca con una sola:
//
//   (a) ESPERAR  — no paga nada de más, pero se queda sin servicio los días
//                  entre el fin del periodo pagado y el día que eligió.
//   (b) ADELANTAR — no pierde ni un día de servicio, pero paga dos veces los
//                  días que van del día elegido al fin del periodo pagado.
//
// Las dos se le muestran con el número exacto. El plan dice "el trade-off
// siempre en números" y un número aproximado rompe la promesa en cuanto llega
// el cargo real.

// Ruta relativa y con extensión .ts a propósito: este módulo se prueba con
// `node --test`, que no resuelve el alias "@/" del tsconfig ni adivina
// extensiones. Next sí lo acepta.
import { nextOccurrence, daysBetween, parseDate, round2 } from "../orchestrator.ts";

/** Convención interna: 32 = último día del mes, que sí existe todos los meses. */
export const LAST_DAY = 32;

export type OptionKind = "esperar" | "adelantar";

export interface TradeoffOption {
  kind: OptionKind;
  /** Día en que Ork volvería a contratar. */
  resubDate: string;
  /** Días sin servicio. */
  daysWithoutService: number;
  /** Días que se pagarían dos veces. */
  daysPaidTwice: number;
  /** Dinero extra, exacto. 0 si no hay. */
  extraCost: number;
  currency: string;
  /** Una línea en español, lista para la pantalla. */
  summary: string;
}

export interface TradeoffInput {
  /** Fin del periodo que la persona YA pagó (YYYY-MM-DD). */
  periodEnd: string;
  /** Día del mes que quiere. 1-28, o LAST_DAY. */
  targetDay: number;
  /** Lo que paga al mes. */
  monthlyAmount: number;
  currency?: string;
  /** Hoy (YYYY-MM-DD). */
  today: string;
  /** ¿Perdería una promo al recontratar? */
  losesPromo?: boolean;
  /**
   * ¿Tiene sentido ofrecer "adelantar" en este servicio?
   *
   * false cuando recontratar antes de que venza conserva la fecha vieja (es el
   * caso de Spotify, documentado por ellos). Ahí la opción no solo no ayuda:
   * le cobraría de más a la persona sin moverle nada.
   *
   * El default es false a propósito. Una opción que no sabemos probar no se
   * ofrece.
   */
  allowEarlyResubscribe?: boolean;
}

export interface Tradeoff {
  /** Ya se cobra ese día: no hay nada que mover. */
  alreadyOnTarget: boolean;
  esperar: TradeoffOption;
  /** null cuando no existe una ocurrencia del día objetivo dentro del periodo pagado. */
  adelantar: TradeoffOption | null;
  /** Cuál recomienda Ork, y por qué. */
  recommended: OptionKind;
  recommendedReason: string;
  /**
   * ¿Hace falta confirmación reforzada?
   * Se activa con 7 días o más sin servicio, o cuando se pierde una promo.
   */
  reinforced: boolean;
  reinforcedReasons: string[];
  losesPromo: boolean;
}

/** Umbral de días sin servicio que dispara la confirmación reforzada. */
export const REINFORCED_GAP_DAYS = 7;

/** Días reales del mes de una fecha. */
function daysInMonthOf(date: string): number {
  const d = parseDate(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

/**
 * Primera ocurrencia del día objetivo en o después de `from`.
 * LAST_DAY se resuelve al último día de cada mes.
 */
export function occurrenceOnOrAfter(from: string, targetDay: number): string {
  if (targetDay === LAST_DAY) {
    const d = parseDate(from);
    let y = d.getUTCFullYear();
    let m = d.getUTCMonth();
    for (let i = 0; i < 3; i++) {
      const last = new Date(Date.UTC(y, m + 1, 0));
      if (last >= d) return last.toISOString().slice(0, 10);
      m++;
      if (m > 11) { m = 0; y++; }
    }
    throw new Error("unreachable");
  }
  return nextOccurrence(from, targetDay);
}

/** Última ocurrencia del día objetivo estrictamente ANTES de `before`. */
function occurrenceBefore(before: string, targetDay: number, notEarlierThan: string): string | null {
  // Se busca hacia atrás desde `before`, sin pasar de `notEarlierThan` (hoy).
  const limit = parseDate(notEarlierThan);
  const end = parseDate(before);
  let y = end.getUTCFullYear();
  let m = end.getUTCMonth();

  for (let i = 0; i < 3; i++) {
    const day = targetDay === LAST_DAY
      ? new Date(Date.UTC(y, m + 1, 0))
      : new Date(Date.UTC(y, m, Math.min(targetDay, new Date(Date.UTC(y, m + 1, 0)).getUTCDate())));
    if (day < end && day >= limit) return day.toISOString().slice(0, 10);
    m--;
    if (m < 0) { m = 11; y--; }
  }
  return null;
}

function money(n: number, currency: string): string {
  const s = n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency === "USD" ? `US$${s}` : `$${s}`;
}

function plural(n: number, uno: string, varios: string): string {
  return n === 1 ? `1 ${uno}` : `${n} ${varios}`;
}

export function computeTradeoff(input: TradeoffInput): Tradeoff {
  const currency = input.currency ?? "MXN";
  const { periodEnd, targetDay, monthlyAmount, today } = input;
  const losesPromo = input.losesPromo ?? false;

  // ── Opción A: esperar a que venza y recontratar el día elegido ───────────
  const resubWait = occurrenceOnOrAfter(periodEnd, targetDay);
  const gapDays = daysBetween(periodEnd, resubWait);

  // La tarifa diaria se calcula sobre el mes real del periodo pagado, no sobre
  // un 30 fijo: en febrero el día cuesta 10% más que en enero.
  const dailyRate = monthlyAmount / daysInMonthOf(periodEnd);

  const esperar: TradeoffOption = {
    kind: "esperar",
    resubDate: resubWait,
    daysWithoutService: gapDays,
    daysPaidTwice: 0,
    extraCost: 0,
    currency,
    summary:
      gapDays === 0
        ? "Tu fecha se mueve sin que pierdas ni un día ni pagues de más."
        : `Te quedas ${plural(gapDays, "día", "días")} sin servicio. No pagas nada de más.`,
  };

  const alreadyOnTarget = gapDays === 0;

  // ── Opción B: recontratar antes de que venza, pagando días repetidos ─────
  // Solo existe si el día objetivo cae dentro de lo que queda del periodo
  // pagado. Si el usuario ya pasó ese día este ciclo, esta opción no está.
  const allowEarly = input.allowEarlyResubscribe ?? false;
  const resubEarly = allowEarly ? occurrenceBefore(periodEnd, targetDay, today) : null;
  let adelantar: TradeoffOption | null = null;

  if (resubEarly && !alreadyOnTarget) {
    const overlap = daysBetween(resubEarly, periodEnd);
    const extra = round2(dailyRate * overlap);
    adelantar = {
      kind: "adelantar",
      resubDate: resubEarly,
      daysWithoutService: 0,
      daysPaidTwice: overlap,
      extraCost: extra,
      currency,
      summary: `No pierdes ni un día de servicio, pero pagas ${money(extra, currency)} de más: ${plural(overlap, "día que ya pagaste", "días que ya pagaste")}.`,
    };
  }

  // ── Recomendación ────────────────────────────────────────────────────────
  //
  // Las dos opciones son complementarias por construcción: los días de espera
  // y los días que se pagarían dos veces suman, siempre, un ciclo completo.
  // Nunca son las dos baratas a la vez. Esperar poco implica que adelantar
  // cuesta casi un mes entero; que adelantar salga barato implica que la
  // espera es larga. Eso deja exactamente dos casos reales.
  let recommended: OptionKind = "esperar";
  let recommendedReason = "";

  if (alreadyOnTarget) {
    recommendedReason = "No hay nada que mover: ya se cobra ese día.";
  } else if (!adelantar) {
    recommendedReason = `Es la única opción: el día ${textDay(targetDay)} ya pasó en este ciclo.`;
  } else if (gapDays >= REINFORCED_GAP_DAYS) {
    // Espera larga → adelantar sale barato. Quedarse una semana o más sin
    // servicio pesa más que unos pesos.
    recommended = "adelantar";
    recommendedReason = `${plural(gapDays, "día", "días")} sin servicio es mucho, y adelantar solo te cuesta ${money(adelantar.extraCost, currency)}.`;
  } else {
    // Espera corta → adelantar cuesta casi el mes completo. No vale la pena.
    recommendedReason = `Son solo ${plural(gapDays, "día", "días")} de espera. Adelantar te costaría ${money(adelantar.extraCost, currency)}, casi un mes entero.`;
  }

  // ── Confirmación reforzada ───────────────────────────────────────────────
  const reasons: string[] = [];
  if (gapDays >= REINFORCED_GAP_DAYS) {
    reasons.push(`Te quedarías ${plural(gapDays, "día", "días")} sin servicio.`);
  }
  if (losesPromo) {
    reasons.push("Vas a perder la promoción que tienes y no se puede recuperar.");
  }

  return {
    alreadyOnTarget,
    esperar,
    adelantar,
    recommended,
    recommendedReason,
    reinforced: reasons.length > 0,
    reinforcedReasons: reasons,
    losesPromo,
  };
}

function textDay(day: number): string {
  return day === LAST_DAY ? "último del mes" : String(day);
}

/**
 * Cuando se pierde una promo, Ork NO debería recomendar mover.
 * Es la única situación donde la recomendación es no hacer nada.
 */
export function shouldDiscourage(t: Tradeoff): boolean {
  return t.losesPromo && !t.alreadyOnTarget;
}
