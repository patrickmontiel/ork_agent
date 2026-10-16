import { test } from "node:test";
import assert from "node:assert/strict";
import {
  verdictExito,
  verdictCorte,
  verdictRestringidas,
  verdictComprension,
  verdictDesventaja,
} from "../lib/pilot/verdicts.ts";

// Fase 5 — los umbrales del piloto.
//
// Lo que se defiende aquí no es la aritmética: es que el tablero PUEDA dar
// malas noticias. Un tablero que solo sabe dar verde no sirve para decidir si
// Ork sigue, que es justo para lo que existe.

// ─── Cero de cero no es 100% ────────────────────────────────────────────────

test("sin datos, ninguna métrica dice que todo va bien", () => {
  assert.equal(verdictExito(0, 0), "sin_datos");
  assert.equal(verdictCorte(0, 0), "sin_datos");
  assert.equal(verdictComprension(0, 0), "sin_datos");
  assert.equal(verdictDesventaja(0, 0), "sin_datos");
});

test("un 2 de 2 perfecto todavía es 'sin datos', no 'bien'", () => {
  // Es la trampa clásica: el primer día del piloto todo se ve impecable.
  assert.equal(verdictExito(2, 2), "sin_datos");
  assert.equal(verdictComprension(3, 3), "sin_datos");
});

// ─── Éxito técnico: meta ≥85% ───────────────────────────────────────────────

test("éxito técnico respeta el 85% justo en la frontera", () => {
  assert.equal(verdictExito(85, 100), "bien", "85% es la meta, y la cumple");
  assert.equal(verdictExito(84, 100), "alerta", "un punto abajo ya no es bien");
  assert.equal(verdictExito(70, 100), "alerta");
  assert.equal(verdictExito(69, 100), "mal");
});

test("éxito técnico con suficientes datos sí puede dar mal", () => {
  assert.equal(verdictExito(1, 10), "mal");
});

// ─── Cortes de servicio: meta ≤1 de cada 20 ─────────────────────────────────

test("cero cortes con orquestaciones reales sí es buena noticia", () => {
  // Aquí el cero SÍ es información, a diferencia de un porcentaje sobre cero.
  assert.equal(verdictCorte(0, 30), "bien");
});

test("cortes respeta el 1 de cada 20", () => {
  assert.equal(verdictCorte(1, 20), "bien", "exactamente 1 de 20 cumple la meta");
  assert.equal(verdictCorte(2, 20), "alerta", "el doble ya no");
  assert.equal(verdictCorte(3, 20), "mal");
});

test("un solo corte sobre pocas corridas no se disimula", () => {
  // 1 de 3 es 33%: aunque haya poca muestra, alguien se quedó sin su servicio.
  assert.equal(verdictCorte(1, 3), "mal");
});

// ─── Cuentas restringidas: 0, sin excepción ─────────────────────────────────

test("una sola cuenta restringida es 'mal', nunca 'alerta'", () => {
  assert.equal(verdictRestringidas(0), "bien");
  assert.equal(verdictRestringidas(1), "mal");
  assert.equal(verdictRestringidas(9), "mal");
});

// ─── Comprensión: meta ≥90% ─────────────────────────────────────────────────

test("comprensión respeta el 90%", () => {
  assert.equal(verdictComprension(90, 100), "bien");
  assert.equal(verdictComprension(89, 100), "alerta");
  assert.equal(verdictComprension(75, 100), "alerta");
  assert.equal(verdictComprension(74, 100), "mal");
});

test("si casi nadie entendió, lo dice", () => {
  assert.equal(verdictComprension(1, 10), "mal");
});

// ─── Cancelaciones por desventaja: señal, no nota ───────────────────────────

test("rechazar un mal trato nunca se marca como 'mal'", () => {
  // El producto funcionando es que la gente pueda decir que no.
  for (const [no, vieron] of [[0, 10], [5, 10], [9, 10], [10, 10]]) {
    const v = verdictDesventaja(no, vieron);
    assert.notEqual(v, "mal", `${no}/${vieron} no debería ser "mal"`);
  }
});

test("pero si más de la mitad dice que no, se levanta la mano", () => {
  assert.equal(verdictDesventaja(4, 10), "bien");
  assert.equal(verdictDesventaja(5, 10), "alerta", "la mitad ya es señal");
  assert.equal(verdictDesventaja(8, 10), "alerta");
});
