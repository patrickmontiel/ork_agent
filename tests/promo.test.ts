import { test } from "node:test";
import assert from "node:assert/strict";
import { detectPromo, promoLost, type PriceRef } from "../lib/pilot/promo.ts";
import { MockNetflixAdapter, NETFLIX_SCENARIOS } from "../lib/adapters/mock-netflix.ts";
import { runOrchestration } from "../lib/pilot/run.ts";
import { computeTradeoff } from "../lib/pilot/tradeoff.ts";

const lista = (amount: number, currency = "MXN"): PriceRef => ({ usable: true, amount, currency });

// ─── Detección de promo ─────────────────────────────────────────────────────

test("paga menos que lista → tiene promo, y se dice cuánto subiría", () => {
  const v = detectPromo(69.5, lista(139));
  assert.ok(v.known);
  assert.equal(v.hasPromo, true);
  assert.equal(v.monthlyIncrease, 69.5);
  assert.match(v.message, /\$139\.00/);
  assert.match(v.message, /pierdes esa promoción/);
});

test("paga lo mismo que lista → no hay promo", () => {
  const v = detectPromo(139, lista(139));
  assert.ok(v.known);
  assert.equal(v.hasPromo, false);
  assert.equal(v.monthlyIncrease, 0);
  assert.match(v.message, /No hay promoción que perder/);
});

test("diferencias de centavos no son promo", () => {
  const v = detectPromo(138.5, lista(139));
  assert.ok(v.known);
  assert.equal(v.hasPromo, false, "medio peso no es una promoción");
});

test("paga MÁS que lista no es promo (precio subió o plan distinto)", () => {
  const v = detectPromo(199, lista(139));
  assert.ok(v.known);
  assert.equal(v.hasPromo, false);
});

// ─── Cuándo NO se puede saber ───────────────────────────────────────────────

test("precio sin verificar → no opina, y lo dice", () => {
  const v = detectPromo(100, { usable: false, reason: "sin_verificar" });
  assert.equal(v.known, false);
  assert.match(v.message, /no tenemos verificado/i);
  assert.doesNotMatch(v.message, /no hay promoción/i, "nunca debe afirmar que no hay promo");
});

test("el precio de lista ES una promo → no sirve para comparar", () => {
  // Caso Disney+: lo publicado es promo de 6 meses.
  const v = detectPromo(129, { usable: false, reason: "es_promo" });
  assert.equal(v.known, false);
  assert.match(v.message, /es a su vez una promoción/i);
});

test("sin precio registrado → no opina", () => {
  const v = detectPromo(100, { usable: false, reason: "no_existe" });
  assert.equal(v.known, false);
});

test("sin monto leído → no opina", () => {
  const v = detectPromo(null, lista(139));
  assert.equal(v.known, false);
  assert.equal(v.known === false && v.reason, "sin_monto");
});

test("promoLost solo es true cuando SABEMOS que hay promo", () => {
  assert.equal(promoLost(detectPromo(69.5, lista(139))), true);
  assert.equal(promoLost(detectPromo(139, lista(139))), false);
  assert.equal(promoLost(detectPromo(69.5, { usable: false, reason: "sin_verificar" })), false);
  assert.equal(promoLost(detectPromo(null, lista(139))), false);
});

test("la incertidumbre no se cuenta como promo perdida", () => {
  // Importa: si contara, cada servicio sin precio verificado dispararía
  // confirmación reforzada y la señal dejaría de significar algo.
  const v = detectPromo(50, { usable: false, reason: "es_promo" });
  assert.equal(promoLost(v), false);
});

// ─── Netflix: pausa ─────────────────────────────────────────────────────────

async function correrNetflix(
  scenario: (typeof NETFLIX_SCENARIOS)[number],
  targetDay = 16,
  periodEnd = "2026-11-10",
) {
  const t = computeTradeoff({ periodEnd, targetDay, monthlyAmount: 269, today: "2026-10-15" });
  const adapter = new MockNetflixAdapter({ scenario });
  const result = await runOrchestration({
    adapter,
    tradeoff: t,
    chosen: t.esperar,
    targetDay,
    retryMax: 3,
    retryDelayMs: 0,
  });
  return { adapter, result, t };
}

test("netflix feliz: pausa, verifica, reanuda y la fecha queda movida", async () => {
  const { result, adapter } = await correrNetflix("feliz");
  assert.equal(result.state, "completado");
  const final = await adapter.getState();
  assert.equal(final.billingDay, 16);
  assert.equal(final.status, "activa");
});

test("netflix: la pausa NO cambia el precio", async () => {
  const { result, adapter } = await correrNetflix("feliz");
  const final = await adapter.getState();
  assert.equal(
    final.paidAmount,
    result.priorState?.paidAmount,
    "es la ventaja de pausar sobre cancelar y recontratar",
  );
});

test("netflix plan Básico: no se puede pausar, y nada cambia", async () => {
  const { result, adapter } = await correrNetflix("plan_basico");
  assert.equal(result.state, "sin_cambios");
  assert.equal((await adapter.getState()).status, "activa");
});

test("netflix pagado por un tercero: se detiene", async () => {
  const { result } = await correrNetflix("pago_por_tercero");
  assert.equal(result.state, "sin_cambios");
});

test("netflix: una pausa de más de 30 días se rechaza", async () => {
  // periodEnd 10-nov, destino el día 16 de DICIEMBRE = 36 días de pausa.
  const { result } = await correrNetflix("feliz", 16, "2026-11-10");
  // El caso base son 6 días y sí pasa; este es el control.
  assert.equal(result.state, "completado");

  const { result: largo } = await correrNetflix("pausa_muy_larga");
  assert.equal(largo.state, "incidente");
  assert.match(largo.events.map((e) => e.message).join(" "), /30 días/);
});

test("netflix: los mensajes de error explican el límite real, no un código", async () => {
  const { result } = await correrNetflix("plan_basico");
  assert.doesNotMatch(result.userMessage, /plan_no_pausable|undefined/);
  const todos = result.events.map((e) => e.message).join(" ");
  assert.match(todos, /Básico/);
});
