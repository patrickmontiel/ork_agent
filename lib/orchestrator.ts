// Lógica pura de orquestación de fechas de Ork. Sin dependencias: se prueba con `node --test`.

export type MerchantType = "corte_duro" | "gracia";
export type SubStatus = "activa" | "pago_fallido" | "rescatada";

export interface Subscription {
  id: string;
  name: string;
  emoji: string;
  merchant: string;
  merchantType: MerchantType;
  product: string;
  variantId: string;
  monthlyAmount: number; // USD aprox. (precio + envío + impuestos de la última cotización)
  billingDay: number; // día del mes en que se cobra
  nextCharge: string; // YYYY-MM-DD
  status: SubStatus;
  lastOrderId?: string;
}

export interface DateProposal {
  subId: string;
  fromDate: string;
  toDate: string;
  targetDay: number;
  gapDays: number;
  proratedAmount: number; // costo de los días de hueco
  absorbedByMerchant: boolean;
  explanation: string;
}

const DAY = 86_400_000;

export function parseDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / DAY);
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
}

/** Fecha con día `day` en el mes (y,m); si el mes es más corto, usa el último día (ej. 30 → 28 feb). */
function clampDate(y: number, m: number, day: number): Date {
  return new Date(Date.UTC(y, m, Math.min(day, daysInMonth(y, m))));
}

/** Primera fecha con día `day` que sea >= `from` (o > si strict). */
export function nextOccurrence(from: string, day: number, strict = false): string {
  const f = parseDate(from);
  let y = f.getUTCFullYear();
  let m = f.getUTCMonth();
  for (let i = 0; i < 3; i++) {
    const c = clampDate(y, m, day);
    if (strict ? c > f : c >= f) return fmt(c);
    m++;
    if (m > 11) { m = 0; y++; }
  }
  throw new Error("unreachable");
}

export function addOneCycle(date: string, billingDay: number): string {
  return nextOccurrence(date, billingDay, true);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Regla de oro de Ork: la fecha solo se mueve HACIA ADELANTE.
 * El siguiente cobro pasa del `nextCharge` actual a la primera fecha con `targetDay` >= esa fecha.
 * El hueco se cubre por adelantado: prorrata de los días extra, que el merchant puede absorber.
 */
export function proposeDateChange(sub: Subscription, targetDay: number, today: string, merchantAbsorbs = true): DateProposal {
  if (!Number.isInteger(targetDay) || targetDay < 1 || targetDay > 31) {
    throw new Error(`Día inválido: ${targetDay}. Debe estar entre 1 y 31.`);
  }
  const from = sub.nextCharge < today ? today : sub.nextCharge;
  const to = nextOccurrence(from, targetDay);
  const gapDays = daysBetween(from, to);
  const proratedAmount = round2((sub.monthlyAmount * gapDays) / 30);
  const explanation =
    gapDays === 0
      ? `${sub.name} ya se cobra el día ${targetDay}. No hay cambio.`
      : `${sub.name}: el cobro se mueve del ${from} al ${to} (+${gapDays} días, solo hacia adelante). ` +
        (merchantAbsorbs
          ? `${sub.merchant} absorbe los ${gapDays} días extra ($${proratedAmount} USD): tú no pagas de más.`
          : `Los ${gapDays} días extra se pagan por adelantado: $${proratedAmount} USD de prorrata.`);
  return { subId: sub.id, fromDate: from, toDate: to, targetDay, gapDays, proratedAmount, absorbedByMerchant: merchantAbsorbs, explanation };
}

export function applyProposal(sub: Subscription, p: DateProposal): Subscription {
  if (p.toDate < p.fromDate) throw new Error("Ork nunca mueve una fecha hacia atrás.");
  return { ...sub, billingDay: p.targetDay, nextCharge: p.toDate };
}

export interface RescuePlan {
  subId: string;
  failedDate: string;
  newDate: string;
  targetDay: number;
  blockedDays: number;
  chargedForGap: number;
  explanation: string;
}

/**
 * Estado C — rescate hacia adelante tras pago fallido y dunning agotado.
 * Solo merchants de corte duro: lo que se bloqueó se condona (no se cobra el hueco).
 * Merchants con gracia cobran los días consumidos, así que no aplica el rescate.
 */
export function rescueForward(sub: Subscription, targetDay: number, today: string): RescuePlan {
  if (sub.status !== "pago_fallido") throw new Error(`${sub.name} no tiene un pago fallido; no hay nada que rescatar.`);
  if (sub.merchantType !== "corte_duro") {
    throw new Error(`${sub.merchant} es un merchant con gracia: se cobran los días consumidos, el rescate hacia adelante no aplica.`);
  }
  const newDate = nextOccurrence(today, targetDay, true);
  const blockedDays = daysBetween(sub.nextCharge, newDate);
  return {
    subId: sub.id,
    failedDate: sub.nextCharge,
    newDate,
    targetDay,
    blockedDays,
    chargedForGap: 0,
    explanation:
      `${sub.name} falló el ${sub.nextCharge}. Ork la reinicia el ${newDate} (día ${targetDay}, cuando sí hay fondos). ` +
      `Los ${blockedDays} días bloqueados se condonan: $0 de hueco. Se condona lo que se bloqueó.`,
  };
}

/** ¿El cobro cae en los 3 días posteriores a una quincena? Si no, es "antes de quincena" (riesgo de fondos insuficientes). */
export function isSafeDay(day: number, paydays: number[]): boolean {
  return paydays.some((p) => {
    const diff = (day - p + 31) % 31;
    return diff >= 0 && diff <= 3;
  });
}

/** Mejor día seguro: el día siguiente a la quincena más próxima hacia adelante desde `fromDay`. */
export function bestDayAfterPayday(paydays: number[]): number {
  const sorted = [...paydays].sort((a, b) => a - b);
  const p = sorted[0];
  return p >= 31 ? 1 : p + 1;
}
