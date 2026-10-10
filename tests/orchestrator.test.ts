import { test } from "node:test";
import assert from "node:assert/strict";
import { proposeDateChange, applyProposal, rescueForward, isSafeDay, nextOccurrence, addOneCycle, type Subscription } from "../lib/orchestrator.ts";

const base: Subscription = { id: "cafe", name: "Club de café", emoji: "", merchant: "coffeeam.com", merchantType: "corte_duro", product: "", variantId: "", monthlyAmount: 30, billingDay: 10, nextCharge: "2026-10-10", status: "activa" };

test("mueve solo hacia adelante: 10 → 16 del mismo mes", () => {
  const p = proposeDateChange(base, 16, "2026-10-09");
  assert.equal(p.toDate, "2026-10-16");
  assert.equal(p.gapDays, 6);
  assert.equal(p.proratedAmount, 6);
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
