import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import Database from "better-sqlite3";
import Stripe from "stripe";
import { feeDecision, isBillableState, countsAsCharged } from "../lib/billing/rules.ts";

// Fase 4 — el dinero.
//
// Tres promesas que Ork le hace a la persona y que aquí se verifican:
//
//   1. Si el cambio de fecha no funcionó, no se cobra. Nunca.
//   2. Un reenvío de Stripe no cobra dos veces.
//   3. Nadie que conozca la URL del webhook puede fabricar un pago.
//
// Nada de esto toca la cuenta real de Stripe: la firma se calcula en local con
// el mismo algoritmo que usa Stripe, y la base corre en memoria.

const SCHEMA = readFileSync(join(process.cwd(), "lib/db/schema.sql"), "utf8");

// ─── 1. El fee se cobra SOLO si la orquestación funcionó ────────────────────

test("regla: una orquestación fallida nunca se cobra, pase lo que pase", () => {
  // La tabla entera de combinaciones alrededor del fallo. En las doce, la
  // respuesta tiene que ser la misma.
  for (const plan of ["free", null, undefined]) {
    for (const alreadyCharged of [false, true]) {
      for (const stripeEnabled of [false, true]) {
        const d = feeDecision({
          plan,
          orchestrationSucceeded: false,
          alreadyCharged,
          stripeEnabled,
        });
        assert.equal(d.charge, false, `cobró con plan=${plan}`);
        assert.equal(
          (d as { reason: string }).reason,
          "orquestacion_fallida",
          "el motivo tiene que ser el fallo, no otro",
        );
      }
    }
  }
});

test("regla: el éxito en plan free sí se cobra", () => {
  const d = feeDecision({
    plan: "free",
    orchestrationSucceeded: true,
    alreadyCharged: false,
    stripeEnabled: true,
  });
  assert.equal(d.charge, true);
});

test("regla: Premium no paga por evento aunque haya éxito", () => {
  const d = feeDecision({
    plan: "premium",
    orchestrationSucceeded: true,
    alreadyCharged: false,
    stripeEnabled: true,
  });
  assert.deepEqual(d, { charge: false, reason: "premium" });
});

test("regla: no se cobra dos veces la misma orquestación", () => {
  const d = feeDecision({
    plan: "free",
    orchestrationSucceeded: true,
    alreadyCharged: true,
    stripeEnabled: true,
  });
  assert.deepEqual(d, { charge: false, reason: "ya_cobrado" });
});

test("regla: sin Stripe configurado no se cobra, y se dice por qué", () => {
  const d = feeDecision({
    plan: "free",
    orchestrationSucceeded: true,
    alreadyCharged: false,
    stripeEnabled: false,
  });
  assert.deepEqual(d, { charge: false, reason: "stripe_apagado" });
});

test("solo 'completado' es cobrable: un ok de la API no es evidencia", () => {
  assert.equal(isBillableState("completado"), true);
  // Todos los demás estados del motor, incluidos los que suenan bien.
  for (const s of [
    "registrado",
    "confirmado",
    "ejecutando",
    "reintentando",
    "rollback",
    "incidente",
    "expirado",
    "cancelado",
    "ok",
    "exitoso",
  ]) {
    assert.equal(isBillableState(s), false, `"${s}" no debería ser cobrable`);
  }
});

test("un cobro en 'pendiente' NO cuenta como cobrado", () => {
  // Lo encontró la prueba de punta a punta: Stripe se cayó a mitad, la fila
  // quedó en pendiente y sin sesión de pago. Si eso contara como cobrado, la
  // persona nunca recibiría el link y Ork no podría reintentar nunca.
  assert.equal(countsAsCharged("pagado"), true);
  for (const s of ["pendiente", "fallido", "cancelado", null, undefined, ""]) {
    assert.equal(countsAsCharged(s), false, `"${s}" no está cobrado`);
  }
});

test("un fee pendiente se puede retomar; uno pagado no", () => {
  const pendiente = feeDecision({
    plan: "free",
    orchestrationSucceeded: true,
    alreadyCharged: countsAsCharged("pendiente"),
    stripeEnabled: true,
  });
  assert.equal(pendiente.charge, true, "un pendiente se retoma");

  const pagado = feeDecision({
    plan: "free",
    orchestrationSucceeded: true,
    alreadyCharged: countsAsCharged("pagado"),
    stripeEnabled: true,
  });
  assert.deepEqual(pagado, { charge: false, reason: "ya_cobrado" });
});

// ─── 2. Doble cobro: la reja de la base de datos ────────────────────────────

function dbConCobro() {
  const db = new Database(":memory:");
  db.exec(SCHEMA);
  db.prepare(
    "INSERT INTO users (id, email, created_at) VALUES ('u1','a@b.mx','2026-10-15T00:00:00Z')",
  ).run();
  db.prepare(
    "INSERT INTO services (id, name, role, support_status, created_at) VALUES ('spotify','Spotify','cerrado','soportado','2026-10-15T00:00:00Z')",
  ).run();
  // adapter_mode es NOT NULL sin default a propósito: nunca hay una
  // orquestación sin registro de qué se ejecutó de verdad.
  for (const o of ["o1", "o2"]) {
    db.prepare(
      "INSERT INTO orchestrations (id, user_id, service_id, state, adapter_mode, created_at, updated_at) VALUES (?,'u1','spotify','completado','mock','2026-10-15T00:00:00Z','2026-10-15T00:00:00Z')",
    ).run(o);
  }
  return db;
}

function insertarFee(db: Database.Database, id: string, orchId: string | null) {
  db.prepare(
    `INSERT INTO charges (id, user_id, kind, orchestration_id, amount, currency, status, created_at)
     VALUES (?, 'u1', 'fee', ?, 25, 'MXN', 'pendiente', '2026-10-15T00:00:00Z')`,
  ).run(id, orchId);
}

test("la base rechaza un segundo fee para la misma orquestación", () => {
  const db = dbConCobro();
  insertarFee(db, "c1", "o1");
  assert.throws(() => insertarFee(db, "c2", "o1"), /UNIQUE/i);
  // Y el primero sigue ahí, intacto.
  const n = db.prepare("SELECT COUNT(*) n FROM charges").get() as { n: number };
  assert.equal(n.n, 1);
  db.close();
});

test("dos orquestaciones distintas sí pueden tener su propio fee", () => {
  const db = dbConCobro();
  insertarFee(db, "c1", "o1");
  insertarFee(db, "c2", "o2");
  const n = db.prepare("SELECT COUNT(*) n FROM charges").get() as { n: number };
  assert.equal(n.n, 2);
  db.close();
});

test("el índice parcial no estorba a las mensualidades de Premium", () => {
  // Varios cobros 'premium' llevan orchestration_id NULL. Si el índice único no
  // excluyera NULL, el segundo mes de Premium reventaría.
  const db = dbConCobro();
  for (const id of ["p1", "p2", "p3"]) {
    db.prepare(
      `INSERT INTO charges (id, user_id, kind, orchestration_id, amount, currency, status, created_at)
       VALUES (?, 'u1', 'premium', NULL, 99, 'MXN', 'pagado', '2026-10-15T00:00:00Z')`,
    ).run(id);
  }
  const n = db
    .prepare("SELECT COUNT(*) n FROM charges WHERE kind='premium'")
    .get() as { n: number };
  assert.equal(n.n, 3);
  db.close();
});

test("una sesión de Stripe no se puede asociar a dos cobros", () => {
  const db = dbConCobro();
  insertarFee(db, "c1", "o1");
  insertarFee(db, "c2", "o2");
  db.prepare("UPDATE charges SET stripe_session_id = 'cs_test_1' WHERE id='c1'").run();
  assert.throws(
    () => db.prepare("UPDATE charges SET stripe_session_id = 'cs_test_1' WHERE id='c2'").run(),
    /UNIQUE/i,
  );
  db.close();
});

// ─── 3. Reenvíos de Stripe: idempotencia por event.id ──────────────────────

test("un reenvío del mismo evento se descarta sin procesarse", () => {
  const db = new Database(":memory:");
  db.exec(SCHEMA);
  const ins = db.prepare(
    "INSERT OR IGNORE INTO stripe_events (event_id, type, received_at) VALUES (?, ?, ?)",
  );

  const primera = ins.run("evt_1", "checkout.session.completed", "2026-10-15T00:00:00Z");
  assert.equal(primera.changes, 1, "el primero se registra");

  // Stripe reenvía el mismo evento: mismo id, y puede traer otra hora.
  const segunda = ins.run("evt_1", "checkout.session.completed", "2026-10-15T00:05:00Z");
  assert.equal(segunda.changes, 0, "el reenvío NO se registra, así que no se procesa");

  const n = db.prepare("SELECT COUNT(*) n FROM stripe_events").get() as { n: number };
  assert.equal(n.n, 1);
  db.close();
});

test("eventos distintos sí se procesan cada uno", () => {
  const db = new Database(":memory:");
  db.exec(SCHEMA);
  const ins = db.prepare(
    "INSERT OR IGNORE INTO stripe_events (event_id, type, received_at) VALUES (?, ?, ?)",
  );
  assert.equal(ins.run("evt_1", "a", "t").changes, 1);
  assert.equal(ins.run("evt_2", "a", "t").changes, 1);
  db.close();
});

// ─── 4. Firma del webhook ──────────────────────────────────────────────────
//
// Se usa el verificador real del SDK de Stripe contra firmas hechas a mano con
// el mismo algoritmo. Lo que se prueba no es la librería: es que la llamada
// exacta que hace app/api/stripe/webhook/route.ts rechaza lo que debe rechazar.

const SECRET = "whsec_" + "a".repeat(48);
const stripe = new Stripe("sk_test_llave_falsa_solo_para_firmar");

function firmar(payload: string, secret = SECRET, ts = Math.floor(Date.now() / 1000)) {
  const v1 = createHmac("sha256", secret).update(`${ts}.${payload}`).digest("hex");
  return `t=${ts},v1=${v1}`;
}

const EVENTO = JSON.stringify({
  id: "evt_test",
  type: "checkout.session.completed",
  data: { object: { id: "cs_test_1", payment_status: "paid", metadata: {} } },
});

function verificar(payload: string, header: string, secret = SECRET) {
  return stripe.webhooks.constructEvent(payload, header, secret);
}

test("una firma válida pasa", () => {
  const event = verificar(EVENTO, firmar(EVENTO));
  assert.equal(event.id, "evt_test");
});

test("un cuerpo alterado después de firmar se rechaza", () => {
  const header = firmar(EVENTO);
  const alterado = EVENTO.replace('"cs_test_1"', '"cs_del_atacante"');
  assert.throws(() => verificar(alterado, header), /signature/i);
});

test("un evento fabricado sin la llave se rechaza", () => {
  // Este es el ataque que importa: alguien conoce la URL y manda un pago
  // completado para activarse Premium gratis.
  const falso = JSON.stringify({
    id: "evt_falso",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_x",
        payment_status: "paid",
        metadata: { orkKind: "premium", orkUserId: "u1" },
      },
    },
  });
  assert.throws(
    () => verificar(falso, firmar(falso, "whsec_" + "b".repeat(48))),
    /signature/i,
  );
});

test("sin header de firma se rechaza", () => {
  assert.throws(() => verificar(EVENTO, ""), /signature/i);
});

test("una firma vieja se rechaza (replay fuera de tolerancia)", () => {
  const hace2h = Math.floor(Date.now() / 1000) - 7200;
  assert.throws(() => verificar(EVENTO, firmar(EVENTO, SECRET, hace2h)), /timestamp|tolerance/i);
});
