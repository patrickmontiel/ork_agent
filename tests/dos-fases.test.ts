import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { MockSpotifyAdapter } from "../lib/adapters/mock-spotify.ts";
import { runCancelPhase, runResubscribePhase, runUndo } from "../lib/pilot/run.ts";
import { planSupport } from "../lib/pilot/plan-support.ts";
import { verdictSesion2Perdida } from "../lib/pilot/verdicts.ts";

// El motor de dos fases.
//
// Lo que se defiende aquí es que el tiempo sea real: cancelar ocurre hoy,
// recontratar ocurre días después, y entre las dos cosas la persona está sin
// servicio. El motor viejo corría todo de un jalón porque el mock mentía.

const SCHEMA = readFileSync(join(process.cwd(), "lib/db/schema.sql"), "utf8");

// ─── Fase 1: cancelar deja esperando, no completado ─────────────────────────

test("la fase 1 NO completa nada: deja esperando el recontrato", async () => {
  const adapter = new MockSpotifyAdapter({ scenario: "feliz" });
  const r = await runCancelPhase({ adapter, resubDate: "2026-11-16" });

  assert.equal(r.state, "esperando_recontrato");
  assert.equal(r.undoDeadline, "2026-11-10", "la ventana para deshacer es el periodo pagado");

  // Y lo más importante: la fecha TODAVÍA no se movió.
  const estado = await adapter.getState();
  assert.equal(estado.billingDay, 10, "cancelar no mueve nada por sí solo");
  assert.equal(estado.status, "cancelada_con_acceso");
});

test("si la cancelación falla, no hay nada que esperar ni que deshacer", async () => {
  const adapter = new MockSpotifyAdapter({ scenario: "falla_cancelacion" });
  const r = await runCancelPhase({ adapter, resubDate: "2026-11-16" });

  assert.equal(r.state, "sin_cambios");
  assert.equal(r.undoDeadline, null, "sin ventana: no se canceló nada");
});

test("el éxito silencioso en la fase 1 se detiene antes de dejar a nadie colgado", async () => {
  const adapter = new MockSpotifyAdapter({ scenario: "exito_silencioso" });
  const r = await runCancelPhase({ adapter, resubDate: "2026-11-16" });
  assert.equal(r.state, "sin_cambios");
});

// ─── Fase 2: aquí sí se mueve la fecha ──────────────────────────────────────

test("las dos fases juntas sí mueven la fecha", async () => {
  const adapter = new MockSpotifyAdapter({ scenario: "feliz" });

  const f1 = await runCancelPhase({ adapter, resubDate: "2026-11-16" });
  assert.equal(f1.state, "esperando_recontrato");

  const f2 = await runResubscribePhase({
    adapter,
    resubDate: "2026-11-16",
    targetDay: 16,
    plan: "individual",
    expectedAmount: 139,
    retryMax: 3,
    retryDelayMs: 0,
  });

  assert.equal(f2.state, "completado");
  assert.equal(f2.serviceGap, false);
  assert.equal((await adapter.getState()).billingDay, 16);
});

test("si la fase 2 falla, la persona quedó sin servicio y se marca", async () => {
  const adapter = new MockSpotifyAdapter({ scenario: "falla_recontrato" });
  await runCancelPhase({ adapter, resubDate: "2026-11-16" });

  const f2 = await runResubscribePhase({
    adapter,
    resubDate: "2026-11-16",
    targetDay: 16,
    plan: "individual",
    expectedAmount: 139,
    retryMax: 2,
    retryDelayMs: 0,
  });

  assert.equal(f2.state, "incidente");
  assert.equal(f2.serviceGap, true, "canceló y no supo devolver el servicio");
  assert.ok(f2.manualSteps?.length, "y se le dice cómo arreglarlo");
});

// ─── Deshacer, mientras se puede ────────────────────────────────────────────

test("deshacer restaura fecha, precio y fin de periodo", async () => {
  const adapter = new MockSpotifyAdapter({ scenario: "con_promo" });
  const antes = await adapter.getState();

  const f1 = await runCancelPhase({ adapter, resubDate: "2026-11-16" });
  assert.equal(f1.state, "esperando_recontrato");

  const u = await runUndo(adapter, f1.priorState!);
  assert.equal(u.ok, true);

  const despues = await adapter.getState();
  assert.equal(despues.billingDay, antes.billingDay);
  assert.equal(despues.periodEnd, antes.periodEnd);
  assert.equal(despues.paidAmount, antes.paidAmount, "la promo también vuelve");
});

// ─── Persistencia: el estado intermedio existe de verdad ────────────────────

function dbConOrq(estado: string, extras: Record<string, string | null> = {}) {
  const db = new Database(":memory:");
  db.exec(SCHEMA);
  db.prepare(
    "INSERT INTO users (id,email,created_at) VALUES ('u1','a@b.mx','2026-10-15T00:00:00Z')",
  ).run();
  db.prepare(
    "INSERT INTO services (id,name,role,support_status,created_at) VALUES ('spotify','Spotify','cerrado','soportado','2026-10-15T00:00:00Z')",
  ).run();
  db.prepare(
    `INSERT INTO orchestrations
       (id,user_id,service_id,state,adapter_mode,to_day,to_date,undo_deadline,confirmed_at,created_at,updated_at)
     VALUES ('o1','u1','spotify',?,'mock',16,?,?,'2026-10-15T00:00:00Z','2026-10-15T00:00:00Z','2026-10-15T00:00:00Z')`,
  ).run(estado, extras.to_date ?? "2026-11-16", extras.undo_deadline ?? "2026-11-10");
  return db;
}

test("el estado esperando_recontrato se persiste con su ventana", () => {
  const db = dbConOrq("esperando_recontrato");
  const r = db.prepare("SELECT state, undo_deadline, to_date FROM orchestrations WHERE id='o1'").get() as {
    state: string;
    undo_deadline: string;
    to_date: string;
  };
  assert.equal(r.state, "esperando_recontrato");
  assert.equal(r.undo_deadline, "2026-11-10");
  assert.equal(r.to_date, "2026-11-16");
  db.close();
});

test("se encuentra lo que ya le tocaba recontratar, y lo que no", () => {
  const db = dbConOrq("esperando_recontrato");
  const vencidas = db
    .prepare(
      "SELECT id FROM orchestrations WHERE state='esperando_recontrato' AND abandoned_at IS NULL AND to_date <= ?",
    )
    .all("2026-11-16");
  assert.equal(vencidas.length, 1, "el 16 ya toca");

  const aun = db
    .prepare(
      "SELECT id FROM orchestrations WHERE state='esperando_recontrato' AND abandoned_at IS NULL AND to_date <= ?",
    )
    .all("2026-11-15");
  assert.equal(aun.length, 0, "el 15 todavía no");
  db.close();
});

test("un abandono se detecta pasados los días de gracia, no antes", () => {
  const db = dbConOrq("esperando_recontrato");
  const q = (hoy: string) =>
    db
      .prepare(
        "SELECT id FROM orchestrations WHERE state='esperando_recontrato' AND abandoned_at IS NULL AND date(to_date,'+3 days') < ?",
      )
      .all(hoy).length;

  assert.equal(q("2026-11-18"), 0, "dos días después todavía no");
  assert.equal(q("2026-11-20"), 1, "cuatro días después sí");
  db.close();
});

// ─── La métrica "sesión 2 nunca ocurrió" ────────────────────────────────────

test("una sola sesión perdida es 'mal': no hay cantidad aceptable", () => {
  assert.equal(verdictSesion2Perdida(0, 0), "sin_datos", "sin fases 1 no hay dato");
  assert.equal(verdictSesion2Perdida(0, 5), "bien", "con fases 1 y cero perdidas, el cero informa");
  assert.equal(verdictSesion2Perdida(1, 50), "mal", "una persona sin su servicio ya es fracaso");
  assert.equal(verdictSesion2Perdida(3, 100), "mal");
});

// ─── La reja de planes ──────────────────────────────────────────────────────

test("Duo y Family quedan fuera: afectan a alguien que no dio permiso", () => {
  for (const plan of ["duo", "Duo", "Premium Duo", "familiar", "family", "Premium Family"]) {
    const r = planSupport(plan);
    assert.equal(r.supported, false, `${plan} no debería soportarse`);
    assert.equal((r as { reason: string }).reason, "plan_compartido");
  }
});

test("individual sí se soporta", () => {
  for (const plan of ["individual", "Individual", "Premium Individual", "premium"]) {
    assert.equal(planSupport(plan).supported, true, plan);
  }
});

test("lo desconocido NO se toca", () => {
  for (const plan of [null, undefined, "", "   ", "plan rarísimo"]) {
    assert.equal(planSupport(plan).supported, false, `"${plan}" debería bloquearse`);
  }
});

test("estudiantes también queda fuera, por la verificación propia", () => {
  assert.equal(planSupport("estudiantes").supported, false);
  assert.equal(planSupport("Premium Student").supported, false);
});

test("el aviso de deshacer se calcula contra el día que recibe, no contra el reloj", () => {
  // Lo encontró la prueba de punta a punta: la consulta usaba date('now'), así
  // que ignoraba su propio parámetro y el aviso NUNCA salía. Es el único de los
  // dos avisos con fecha de caducidad real, porque después de undo_deadline
  // deshacer deja de existir.
  const db = dbConOrq("esperando_recontrato"); // undo_deadline = 2026-11-10
  const q = (hoy: string, diasAntes = 2) =>
    db
      .prepare(
        `SELECT id FROM orchestrations
          WHERE state='esperando_recontrato' AND abandoned_at IS NULL
            AND reminded_undo_at IS NULL AND undo_deadline IS NOT NULL
            AND undo_deadline > ?
            AND date(undo_deadline, '-' || ? || ' days') <= ?`,
      )
      .all(hoy, String(diasAntes), hoy).length;

  assert.equal(q("2026-11-01"), 0, "lejos de vencer todavía no");
  assert.equal(q("2026-11-08"), 1, "a 2 días sí");
  assert.equal(q("2026-11-09"), 1, "a 1 día también");
  assert.equal(q("2026-11-10"), 0, "el día que vence ya no: deshacer deja de existir");
  assert.equal(q("2026-11-12"), 0, "y después menos");
  db.close();
});

// ─── La tarjeta de "tienes algo esperando" ──────────────────────────────────
//
// Lo que se defiende no es el diseño: es que la urgencia sea la correcta.
// Pedirle que actúe cuando no toca la entrena a ignorar la tarjeta; no avisarle
// el día que sí, la deja sin servicio.

import { derivarPendiente } from "../lib/pilot/pendiente.ts";

const basePend = {
  serviceName: "Spotify",
  resubDate: "2026-11-16",
  undoDeadline: "2026-11-10",
  targetDay: 16,
};

test("faltando días: espera, y todavía puede deshacer", () => {
  const p = derivarPendiente({ ...basePend, today: "2026-11-05" });
  assert.equal(p.urgencia, "esperando");
  assert.equal(p.diasParaRecontratar, 11);
  assert.equal(p.puedeDeshacer, true);
  assert.match(p.titulo, /se reactiva en 11 días/);
});

test("el día objetivo: urgencia 'hoy' y dice qué gana si actúa", () => {
  const p = derivarPendiente({ ...basePend, today: "2026-11-16" });
  assert.equal(p.urgencia, "hoy");
  assert.equal(p.diasParaRecontratar, 0);
  assert.match(p.titulo, /Hoy toca reactivar/);
  assert.match(p.detalle, /día 16/);
});

test("pasado el día: vencido, y dice cuántos días lleva sin servicio", () => {
  const p = derivarPendiente({ ...basePend, today: "2026-11-19" });
  assert.equal(p.urgencia, "vencido");
  assert.equal(p.diasParaRecontratar, -3);
  assert.match(p.detalle, /hace 3 días/);
  assert.match(p.detalle, /sigues sin servicio/);
});

test("la ventana de deshacer coincide EXACTAMENTE con la del API", () => {
  // El API permite deshacer mientras hoy <= undo_deadline. Si la tarjeta usara
  // otro corte, alguien vería un botón que falla al tocarlo.
  assert.equal(derivarPendiente({ ...basePend, today: "2026-11-09" }).puedeDeshacer, true);
  assert.equal(derivarPendiente({ ...basePend, today: "2026-11-10" }).puedeDeshacer, true, "el día límite todavía cuenta");
  assert.equal(derivarPendiente({ ...basePend, today: "2026-11-11" }).puedeDeshacer, false);
});

test("sin poder deshacer, lo dice en vez de callárselo", () => {
  const p = derivarPendiente({ ...basePend, today: "2026-11-12" });
  assert.equal(p.puedeDeshacer, false);
  assert.match(p.detalle, /ya no se puede deshacer/i);
  assert.match(p.detalle, /se perdió/);
});

test("un día en singular no dice '1 días'", () => {
  const p = derivarPendiente({ ...basePend, today: "2026-11-15" });
  assert.match(p.titulo, /en 1 día\b/);
  const v = derivarPendiente({ ...basePend, today: "2026-11-17" });
  assert.match(v.detalle, /hace 1 día\b/);
});
