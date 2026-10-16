import { test } from "node:test";
import assert from "node:assert/strict";
import { MockSpotifyAdapter, MOCK_SCENARIOS, type MockScenario } from "../lib/adapters/mock-spotify.ts";
import { runOrchestration } from "../lib/pilot/run.ts";
import { computeTradeoff } from "../lib/pilot/tradeoff.ts";

// Los cinco escenarios del mock son los que hay que sobrevivir ANTES de
// escribir el adaptador real. Si el motor no aguanta aquí, no tiene por qué
// aguantar contra Spotify.

function tradeoffBase() {
  return computeTradeoff({
    periodEnd: "2026-11-10",
    targetDay: 16,
    monthlyAmount: 139,
    today: "2026-10-15",
  });
}

async function correr(
  scenario: MockScenario,
  opts: { retryMax?: number; failResubscribeTimes?: number } = {},
) {
  const t = tradeoffBase();
  const adapter = new MockSpotifyAdapter({
    scenario,
    failResubscribeTimes: opts.failResubscribeTimes,
  });
  return {
    adapter,
    result: await runOrchestration({
      adapter,
      tradeoff: t,
      chosen: t.esperar,
      targetDay: 16,
      retryMax: opts.retryMax ?? 3,
      retryDelayMs: 0,
    }),
  };
}

// ─── Camino feliz ───────────────────────────────────────────────────────────

test("feliz: cancela, verifica, recontrata, verifica y termina", async () => {
  const { result, adapter } = await correr("feliz");
  assert.equal(result.state, "completado");
  assert.equal(result.retries, 0);
  assert.equal(result.accountRestricted, false);

  const tipos = result.events.map((e) => e.type);
  assert.deepEqual(tipos, [
    "estado_previo",
    "cancelado",
    "verificacion_cancelacion",
    "recontratado",
    "verificacion_recontrato",
    "completado",
  ]);

  const final = await adapter.getState();
  assert.equal(final.status, "activa");
  assert.equal(final.billingDay, 16, "la fecha quedó movida de verdad");
});

test("feliz: guarda el estado previo antes de tocar nada", async () => {
  const { result } = await correr("feliz");
  assert.ok(result.priorState);
  assert.equal(result.priorState.billingDay, 10, "el día original, para poder revertir");
  assert.equal(result.priorState.status, "activa");
});

// ─── Falla la cancelación: nada cambió ──────────────────────────────────────

test("falla_cancelacion: no cambia nada y se lo dice a la persona", async () => {
  const { result, adapter } = await correr("falla_cancelacion");
  assert.equal(result.state, "sin_cambios");
  assert.match(result.userMessage, /no modificamos nada/i);
  assert.equal(result.manualSteps, undefined, "no hay nada que arreglar a mano");

  const final = await adapter.getState();
  assert.equal(final.status, "activa", "la suscripción sigue intacta");
  assert.equal(final.billingDay, 10, "y con su día original");
});

test("falla_cancelacion: nunca intenta recontratar", async () => {
  const { result } = await correr("falla_cancelacion");
  const tipos = result.events.map((e) => e.type);
  assert.ok(!tipos.includes("recontratado"));
  assert.ok(!tipos.includes("recontrato_fallo"));
});

// ─── Falla el recontrato: incidente ─────────────────────────────────────────

test("falla_recontrato: reintenta RETRY_MAX veces antes de rendirse", async () => {
  const { result } = await correr("falla_recontrato", { retryMax: 3 });
  assert.equal(result.state, "incidente");
  assert.equal(result.retries, 3, "tres reintentos, como dice RETRY_MAX");
  const fallos = result.events.filter((e) => e.type === "recontrato_fallo").length;
  assert.equal(fallos, 4, "el intento original más tres reintentos");
});

test("falla_recontrato: entrega instrucciones manuales concretas", async () => {
  const { result } = await correr("falla_recontrato");
  assert.ok(result.manualSteps && result.manualSteps.length > 0);
  assert.match(result.manualSteps.join(" "), /2026-11-16/, "dice la fecha exacta");
  assert.match(result.userMessage, /avisamos al equipo/);
});

test("falla_recontrato: si funciona al segundo intento, termina bien", async () => {
  const { result, adapter } = await correr("feliz", { failResubscribeTimes: 1, retryMax: 3 });
  assert.equal(result.state, "completado");
  assert.equal(result.retries, 1);
  assert.equal((await adapter.getState()).billingDay, 16);
});

test("falla_recontrato: con retryMax 0 no reintenta", async () => {
  const { result } = await correr("falla_recontrato", { retryMax: 0 });
  assert.equal(result.retries, 0);
  assert.equal(result.state, "incidente");
});

// ─── Cuenta restringida: se detiene todo ────────────────────────────────────

test("cuenta_restringida: se detiene antes de tocar nada", async () => {
  const { result, adapter } = await correr("cuenta_restringida");
  assert.equal(result.state, "incidente");
  assert.equal(result.accountRestricted, true, "esto dispara el apagado del piloto");

  const final = await adapter.getState();
  assert.equal(final.status, "restringida");
  assert.equal(final.billingDay, 10, "no se tocó nada");
});

test("cuenta_restringida: no reintenta nunca", async () => {
  const { result } = await correr("cuenta_restringida", { retryMax: 5 });
  assert.equal(result.retries, 0, "reintentar sobre una cuenta restringida la empeora");
});

// ─── Éxito silencioso: el peor de todos ─────────────────────────────────────

test("exito_silencioso: un ok no basta, verify lo caza", async () => {
  const { result } = await correr("exito_silencioso");
  assert.notEqual(result.state, "completado", "NUNCA debe reportar éxito");
  const tipos = result.events.map((e) => e.type);
  assert.ok(tipos.includes("exito_silencioso"), "lo detectó explícitamente");
});

test("exito_silencioso: no le miente a la persona", async () => {
  const { result } = await correr("exito_silencioso");
  assert.doesNotMatch(result.userMessage, /listo|movida con éxito/i);
  assert.match(result.userMessage, /no (pudimos|podemos) confirmar|no modificamos nada/i);
});

// ─── Promo ──────────────────────────────────────────────────────────────────

test("con_promo: el estado previo registra lo que pagaba antes", async () => {
  const { result, adapter } = await correr("con_promo");
  assert.equal(result.priorState?.paidAmount, 69.5, "pagaba promo");
  assert.equal(result.state, "completado");
  const final = await adapter.getState();
  assert.equal(final.paidAmount, 139, "al recontratar vuelve el precio de lista");
});

test("con_promo: el trade-off marca la pérdida y pide confirmación reforzada", () => {
  const t = computeTradeoff({
    periodEnd: "2026-11-10",
    targetDay: 16,
    monthlyAmount: 69.5,
    today: "2026-10-15",
    losesPromo: true,
  });
  assert.equal(t.reinforced, true);
  assert.match(t.reinforcedReasons.join(" "), /promoción/);
});

// ─── Invariantes que valen para todos los escenarios ────────────────────────

test("ningún escenario termina 'completado' sin verificar", async () => {
  for (const s of MOCK_SCENARIOS) {
    const { result } = await correr(s);
    if (result.state === "completado") {
      const v = result.events.filter((e) => e.type === "verificacion_recontrato");
      assert.equal(v.length, 1, `${s}: completó sin verificar`);
      assert.ok(result.finalState, `${s}: completó sin estado final`);
    }
  }
});

test("todo escenario que falla deja un mensaje en español, sin jerga", async () => {
  for (const s of MOCK_SCENARIOS) {
    const { result } = await correr(s);
    assert.ok(result.userMessage.length > 10, `${s}: mensaje vacío`);
    assert.doesNotMatch(result.userMessage, /undefined|null|Error:|\[object/, `${s}: fuga técnica`);
  }
});

test("el estado previo se lee siempre, pase lo que pase", async () => {
  for (const s of MOCK_SCENARIOS) {
    const { result } = await correr(s);
    assert.ok(result.priorState, `${s}: sin estado previo no se puede revertir ni comprobar`);
    assert.equal(result.events[0].type, "estado_previo", `${s}: debe ser lo primero`);
  }
});

// ─── Corte de servicio: la métrica que puede hundir el piloto ───────────────
//
// serviceGap NO es "hubo un error". Es "la persona se quedó sin su servicio
// porque Ork lo canceló y no supo devolvérselo". La diferencia importa: el
// tablero del piloto mide esto, no los errores en general.

test("falla_recontrato deja a la persona sin servicio → serviceGap", async () => {
  const { result } = await correr("falla_recontrato");
  assert.equal(result.state, "incidente");
  assert.equal(result.serviceGap, true, "canceló y no pudo volver: es un corte");
  assert.ok(result.manualSteps?.length, "y se le dan pasos para reactivarlo");
});

test("falla_cancelacion NO es corte: nada cambió", async () => {
  const { result } = await correr("falla_cancelacion");
  assert.equal(result.serviceGap, false, "si no llegó a cancelar, no hubo corte");
});

test("exito_silencioso en la cancelación NO es corte", async () => {
  // El servicio dijo ok pero no cambió nada, así que la persona sigue con su
  // servicio. Se detiene antes de recontratar sobre un estado falso.
  const { result } = await correr("exito_silencioso");
  assert.equal(result.serviceGap, false);
});

test("el camino feliz nunca reporta corte", async () => {
  const { result } = await correr("feliz");
  assert.equal(result.serviceGap, false);
});

test("una cuenta restringida desde el inicio no es corte provocado por Ork", async () => {
  const { result } = await correr("cuenta_restringida");
  assert.equal(result.accountRestricted, true);
  assert.equal(result.serviceGap, false, "Ork no alcanzó a tocar nada");
});

test("si el recontrato se recupera en un reintento, no hubo corte final", async () => {
  const { result } = await correr("feliz", { failResubscribeTimes: 2, retryMax: 3 });
  assert.equal(result.state, "completado");
  assert.ok(result.retries >= 1, "hubo reintentos");
  assert.equal(result.serviceGap, false, "volvió a quedar activo: no se cuenta como corte");
});

// ─── La regla real de Spotify, y por qué el mock mentía ─────────────────────
//
// Spotify: "Your account needs to stay free until the day you want the new
// billing to start. If you resubscribe before then, it will stay the same."
//
// El mock fijaba billingDay = targetDay sin mirar la fecha, así que la opción
// "adelantar" pasaba los tests mientras en la vida real le habría cobrado de
// más a la persona sin moverle nada. Estos tests fijan la regla verdadera.

test("recontratar ANTES de que venza conserva la fecha vieja", async () => {
  const adapter = new MockSpotifyAdapter({ scenario: "feliz" });
  const antes = await adapter.getState();

  await adapter.cancel();
  // periodEnd es 2026-11-10; se reactiva el 5, o sea antes.
  const r = await adapter.resubscribe({ onDate: "2026-11-05", plan: "individual", expectedAmount: 139 });

  assert.equal(r.ok, true, "la reactivación en sí funciona");
  const despues = await adapter.getState();
  assert.equal(despues.status, "activa");
  assert.equal(
    despues.billingDay,
    antes.billingDay,
    "la fecha NO se movió: es justo lo que Spotify documenta",
  );
});

test("por eso reactivar temprano sirve de ROLLBACK", async () => {
  // El mismo mecanismo que invalida "adelantar" es el que permite deshacer.
  const adapter = new MockSpotifyAdapter({ scenario: "feliz" });
  const antes = await adapter.getState();

  await adapter.cancel();
  await adapter.resubscribe({ onDate: "2026-11-01", plan: antes.plan, expectedAmount: antes.paidAmount });

  const despues = await adapter.getState();
  assert.equal(despues.billingDay, antes.billingDay, "vuelve la fecha");
  assert.equal(despues.periodEnd, antes.periodEnd, "vuelve el fin de periodo");
  assert.equal(despues.paidAmount, antes.paidAmount, "y el precio, promo incluida");
});

test("recontratar DESPUÉS de que venza sí mueve la fecha", async () => {
  const adapter = new MockSpotifyAdapter({ scenario: "feliz" });
  await adapter.cancel();
  await adapter.resubscribe({ onDate: "2026-11-16", plan: "individual", expectedAmount: 139 });

  const despues = await adapter.getState();
  assert.equal(despues.billingDay, 16, "esta es la única forma que funciona");
});

test("el adaptador declara la regla, para que la UI no ofrezca lo imposible", () => {
  const adapter = new MockSpotifyAdapter({ scenario: "feliz" });
  assert.equal(adapter.earlyResubscribeKeepsOldDate, true);
});
