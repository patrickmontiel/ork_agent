import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeTradeoff,
  occurrenceOnOrAfter,
  shouldDiscourage,
  LAST_DAY,
  REINFORCED_GAP_DAYS,
} from "../lib/pilot/tradeoff.ts";

// El trade-off es lo que la persona lee antes de decidir. Si el número está
// mal, Ork le mintió — aunque sea por redondeo.

const base = {
  periodEnd: "2026-11-10",
  targetDay: 16,
  monthlyAmount: 139, // Spotify individual
  today: "2026-10-15",
};

// ─── Opción A: esperar ──────────────────────────────────────────────────────

test("esperar: del 10 al 16 son 6 días sin servicio y cero pesos", () => {
  const t = computeTradeoff(base);
  assert.equal(t.esperar.resubDate, "2026-11-16");
  assert.equal(t.esperar.daysWithoutService, 6);
  assert.equal(t.esperar.extraCost, 0);
  assert.equal(t.esperar.daysPaidTwice, 0);
});

test("si el día elegido coincide con el fin del periodo, no hay trade-off", () => {
  const t = computeTradeoff({ ...base, targetDay: 10 });
  assert.equal(t.alreadyOnTarget, true);
  assert.equal(t.esperar.daysWithoutService, 0);
  assert.equal(t.esperar.extraCost, 0);
  assert.match(t.esperar.summary, /sin que pierdas ni un día/);
});

// ─── Opción B: adelantar ────────────────────────────────────────────────────

test("adelantar: pagar los días que se repiten, con tarifa del mes real", () => {
  // Periodo pagado termina el 10-nov. El día 16 también existe en octubre,
  // después de hoy (15-oct), así que se puede adelantar al 16-oct.
  const t = computeTradeoff(base);
  assert.ok(t.adelantar, "debería existir la opción de adelantar");
  assert.equal(t.adelantar.resubDate, "2026-10-16");
  assert.equal(t.adelantar.daysWithoutService, 0);
  // Del 16-oct al 10-nov son 25 días ya pagados que se pagarían otra vez.
  assert.equal(t.adelantar.daysPaidTwice, 25);
  // Tarifa diaria sobre NOVIEMBRE (mes del periodEnd) = 139/30 = 4.6333
  assert.equal(t.adelantar.extraCost, 115.83);
});

test("adelantar no existe si el día objetivo ya pasó en este ciclo", () => {
  // Hoy 20-oct, periodo termina el 10-nov, quiere el día 16: el 16-oct ya pasó
  // y el 16-nov es después del fin de periodo.
  const t = computeTradeoff({ ...base, today: "2026-10-20" });
  assert.equal(t.adelantar, null);
  assert.match(t.recommendedReason, /única opción/);
});

test("la tarifa diaria usa el mes real, no 30 fijo", () => {
  const feb = computeTradeoff({
    periodEnd: "2027-02-10",
    targetDay: 5,
    monthlyAmount: 280,
    today: "2027-01-20",
  });
  // Del 5-feb al 10-feb son 5 días. 280/28 = 10 por día → 50.
  assert.ok(feb.adelantar);
  assert.equal(feb.adelantar.daysPaidTwice, 5);
  assert.equal(feb.adelantar.extraCost, 50);

  const ene = computeTradeoff({
    periodEnd: "2027-01-10",
    targetDay: 5,
    monthlyAmount: 280,
    today: "2026-12-20",
  });
  // Mismos 5 días, pero 280/31 = 9.03 por día → 45.16.
  assert.equal(ene.adelantar?.daysPaidTwice, 5);
  assert.equal(ene.adelantar?.extraCost, 45.16);
  assert.ok(ene.adelantar!.extraCost < feb.adelantar!.extraCost);
});

// ─── Confirmación reforzada ─────────────────────────────────────────────────

test("7 días o más sin servicio dispara confirmación reforzada", () => {
  const seis = computeTradeoff({ ...base, periodEnd: "2026-11-10", targetDay: 16 });
  assert.equal(seis.esperar.daysWithoutService, 6);
  assert.equal(seis.reinforced, false, "6 días no la dispara");

  const siete = computeTradeoff({ ...base, periodEnd: "2026-11-09", targetDay: 16 });
  assert.equal(siete.esperar.daysWithoutService, 7);
  assert.equal(siete.reinforced, true, `${REINFORCED_GAP_DAYS} días sí la dispara`);
  assert.match(siete.reinforcedReasons.join(" "), /sin servicio/);
});

test("perder una promo dispara confirmación reforzada aunque sean pocos días", () => {
  const t = computeTradeoff({ ...base, losesPromo: true });
  assert.equal(t.esperar.daysWithoutService, 6, "pocos días");
  assert.equal(t.reinforced, true);
  assert.match(t.reinforcedReasons.join(" "), /promoción/);
});

test("las dos causas juntas se listan por separado", () => {
  const t = computeTradeoff({ ...base, periodEnd: "2026-11-01", targetDay: 16, losesPromo: true });
  assert.equal(t.reinforced, true);
  assert.equal(t.reinforcedReasons.length, 2);
});

test("sin promo y con pocos días, no hay confirmación reforzada", () => {
  const t = computeTradeoff(base);
  assert.equal(t.reinforced, false);
  assert.equal(t.reinforcedReasons.length, 0);
});

// ─── Recomendación ──────────────────────────────────────────────────────────

test("con muchos días sin servicio, recomienda adelantar", () => {
  const t = computeTradeoff({ periodEnd: "2026-11-02", targetDay: 16, monthlyAmount: 139, today: "2026-10-15" });
  assert.ok(t.esperar.daysWithoutService >= REINFORCED_GAP_DAYS);
  assert.equal(t.recommended, "adelantar");
});

test("con pocos días de espera, recomienda esperar", () => {
  const t = computeTradeoff(base);
  assert.equal(t.recommended, "esperar");
  assert.match(t.recommendedReason, /casi un mes entero/);
});

test("las dos opciones son complementarias: nunca son baratas a la vez", () => {
  // Espera + días dobles suman siempre un ciclo completo. Es la razón de que
  // la recomendación solo tenga dos casos reales.
  for (const periodEnd of ["2026-11-02", "2026-11-10", "2026-11-13", "2026-11-20"]) {
    const t = computeTradeoff({ periodEnd, targetDay: 16, monthlyAmount: 139, today: "2026-10-15" });
    if (!t.adelantar || t.alreadyOnTarget) continue;
    const suma = t.esperar.daysWithoutService + t.adelantar.daysPaidTwice;
    assert.ok(
      suma >= 28 && suma <= 31,
      `periodEnd ${periodEnd}: esperar(${t.esperar.daysWithoutService}) + dobles(${t.adelantar.daysPaidTwice}) = ${suma}, debería ser un ciclo completo`,
    );
  }
});

test("cuando se pierde promo, Ork desaconseja mover", () => {
  assert.equal(shouldDiscourage(computeTradeoff({ ...base, losesPromo: true })), true);
  assert.equal(shouldDiscourage(computeTradeoff(base)), false);
  // Si ya está en la fecha, no hay nada que desaconsejar.
  assert.equal(
    shouldDiscourage(computeTradeoff({ ...base, targetDay: 10, losesPromo: true })),
    false,
  );
});

// ─── Último día del mes ─────────────────────────────────────────────────────

test("último día del mes se resuelve en cada mes, incluido febrero", () => {
  assert.equal(occurrenceOnOrAfter("2027-02-05", LAST_DAY), "2027-02-28");
  assert.equal(occurrenceOnOrAfter("2028-02-05", LAST_DAY), "2028-02-29");
  assert.equal(occurrenceOnOrAfter("2027-04-05", LAST_DAY), "2027-04-30");
  assert.equal(occurrenceOnOrAfter("2027-01-31", LAST_DAY), "2027-01-31");
});

test("trade-off con último día del mes", () => {
  const t = computeTradeoff({ periodEnd: "2027-02-10", targetDay: LAST_DAY, monthlyAmount: 139, today: "2027-01-20" });
  assert.equal(t.esperar.resubDate, "2027-02-28");
  assert.equal(t.esperar.daysWithoutService, 18);
  assert.equal(t.reinforced, true, "18 días sin servicio es mucho");
});

// ─── Redacción ──────────────────────────────────────────────────────────────

test("los resúmenes llevan el número, no un adjetivo", () => {
  const t = computeTradeoff(base);
  assert.match(t.esperar.summary, /6 días/);
  assert.match(t.adelantar!.summary, /\$115\.83/);
  assert.match(t.adelantar!.summary, /25 días/);
});

test("un solo día se escribe en singular", () => {
  const t = computeTradeoff({ periodEnd: "2026-11-15", targetDay: 16, monthlyAmount: 139, today: "2026-10-20" });
  assert.equal(t.esperar.daysWithoutService, 1);
  assert.match(t.esperar.summary, /1 día sin servicio/);
});

test("moneda USD se formatea distinto", () => {
  const t = computeTradeoff({ ...base, monthlyAmount: 20, currency: "USD" });
  assert.match(t.adelantar!.summary, /US\$/);
});
