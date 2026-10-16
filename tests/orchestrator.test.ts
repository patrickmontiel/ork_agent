import { test } from "node:test";
import assert from "node:assert/strict";
import { proposeDateChange, applyProposal, rescueForward, isSafeDay, nextOccurrence, addOneCycle, bestDayAfterPayday, cycleLength, prorate, type Subscription } from "../lib/orchestrator.ts";

const base: Subscription = { id: "cafe", name: "Club de café", emoji: "", merchant: "coffeeam.com", merchantType: "corte_duro", product: "", variantId: "", monthlyAmount: 30, billingDay: 10, nextCharge: "2026-10-10", status: "activa" };

test("mueve solo hacia adelante: 10 → 16 del mismo mes", () => {
  const p = proposeDateChange(base, 16, "2026-10-09");
  assert.equal(p.toDate, "2026-10-16");
  assert.equal(p.gapDays, 6);
  // El ciclo 10-oct → 10-nov dura 31 días, no 30: 30 × 6 / 31 = 5.81.
  // Antes esto daba 6 porque se prorrateaba contra un 30 fijo.
  assert.equal(p.proratedAmount, 5.81);
});

test("un día 'anterior' salta al mes siguiente, nunca hacia atrás", () => {
  const p = proposeDateChange(base, 1, "2026-10-09");
  assert.equal(p.toDate, "2026-11-01");
  assert.ok(p.gapDays > 0);
});

test("día 30 en febrero se ajusta al último día", () => {
  assert.equal(nextOccurrence("2027-02-02", 30), "2027-02-28");
});

test("applyProposal cambia día y fecha", () => {
  const s = applyProposal(base, proposeDateChange(base, 16, "2026-10-09"));
  assert.equal(s.billingDay, 16);
  assert.equal(s.nextCharge, "2026-10-16");
  assert.equal(addOneCycle(s.nextCharge, 16), "2026-11-16");
});

test("rescate condona el hueco en corte duro", () => {
  const r = rescueForward({ ...base, status: "pago_fallido" }, 16, "2026-10-10");
  assert.equal(r.newDate, "2026-10-16");
  assert.equal(r.chargedForGap, 0);
  assert.equal(r.blockedDays, 6);
});

test("rescate no aplica a merchants con gracia", () => {
  assert.throws(() => rescueForward({ ...base, merchantType: "gracia", status: "pago_fallido" }, 16, "2026-10-10"));
});

test("día seguro = 0-3 días después de quincena", () => {
  assert.equal(isSafeDay(16, [15, 30]), true);
  assert.equal(isSafeDay(1, [15, 30]), true);
  assert.equal(isSafeDay(10, [15, 30]), false);
  assert.equal(isSafeDay(27, [15, 30]), false);
});

// ─── Prorrateo exacto (Fase 0) ──────────────────────────────────────────────
// El trade-off se le muestra al usuario en números. Si el número está
// aproximado, la promesa se rompe cuando llega el cargo real.

test("el ciclo dura lo que dura el mes, no 30 fijo", () => {
  assert.equal(cycleLength("2027-01-10", 10), 31); // enero → febrero
  assert.equal(cycleLength("2027-02-10", 10), 28); // febrero común
  assert.equal(cycleLength("2028-02-10", 10), 29); // febrero bisiesto
  assert.equal(cycleLength("2027-04-10", 10), 30); // abril → mayo
});

test("el mismo hueco cuesta distinto según el mes", () => {
  const feb = prorate(280, 7, "2027-02-10", 10); // 280 × 7 / 28
  const ene = prorate(280, 7, "2027-01-10", 10); // 280 × 7 / 31
  assert.equal(feb, 70);
  assert.equal(ene, 63.23);
  assert.ok(feb > ene, "un día de febrero vale más que uno de enero");
});

test("hueco de cero días no cuesta nada", () => {
  assert.equal(prorate(199, 0, "2026-10-10", 10), 0);
});

test("un ciclo completo cuesta exactamente la mensualidad", () => {
  assert.equal(prorate(129, 31, "2027-01-10", 10), 129);
  assert.equal(prorate(129, 28, "2027-02-10", 10), 129);
});

// ─── bestDayAfterPayday (Fase 0) ────────────────────────────────────────────
// Antes ignoraba fromDay y siempre devolvía min(paydays) + 1.

test("elige la quincena que viene, no la primera del mes", () => {
  assert.equal(bestDayAfterPayday([15, 30], 1), 16);
  assert.equal(bestDayAfterPayday([15, 30], 15), 16);
  assert.equal(bestDayAfterPayday([15, 30], 20), 31); // la del 30 → cobra el 31
  assert.equal(bestDayAfterPayday([15, 30], 30), 31);
});

test("si ya pasaron todas las quincenas del mes, envuelve a la primera", () => {
  assert.equal(bestDayAfterPayday([15, 30], 31), 16);
});

test("quincena el día 31 envuelve al día 1", () => {
  assert.equal(bestDayAfterPayday([31], 1), 1);
});

test("sin quincenas configuradas, falla claro", () => {
  assert.throws(() => bestDayAfterPayday([], 1), /No hay quincenas/);
});

// ─── Guardas de proposeDateChange ───────────────────────────────────────────

test("día fuera de rango se rechaza", () => {
  assert.throws(() => proposeDateChange(base, 0, "2026-10-09"), /Día inválido/);
  assert.throws(() => proposeDateChange(base, 32, "2026-10-09"), /Día inválido/);
});

test("si la fecha ya pasó, el cálculo arranca desde hoy", () => {
  const vencida = { ...base, nextCharge: "2026-10-01" };
  const p = proposeDateChange(vencida, 16, "2026-10-09");
  assert.equal(p.fromDate, "2026-10-09");
  assert.equal(p.toDate, "2026-10-16");
  assert.equal(p.gapDays, 7);
});

test("applyProposal nunca acepta una fecha hacia atrás", () => {
  assert.throws(
    () => applyProposal(base, { subId: "cafe", fromDate: "2026-10-16", toDate: "2026-10-10", targetDay: 10, gapDays: -6, proratedAmount: 0, absorbedByMerchant: true, explanation: "" }),
    /nunca mueve una fecha hacia atrás/,
  );
});
