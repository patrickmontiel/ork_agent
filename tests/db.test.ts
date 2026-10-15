import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";

// El esquema se prueba en memoria: no toca ork.db ni necesita Next.
// Lo que se verifica aquí no es "¿existe la tabla?" sino la promesa que Ork le
// hace al usuario: un mandato no se puede editar ni borrar después de firmado.

const SCHEMA = readFileSync(join(process.cwd(), "lib/db/schema.sql"), "utf8");

function fresh(): Database.Database {
  const db = new Database(":memory:");
  db.exec(SCHEMA);
  return db;
}

function seedUserAndService(db: Database.Database) {
  db.prepare("INSERT INTO users (id, email, created_at) VALUES ('u1', 'a@b.mx', '2026-10-15T00:00:00Z')").run();
  db.prepare(
    "INSERT INTO services (id, name, role, mechanism, support_status, created_at) VALUES ('spotify','Spotify','cerrado','cancel_resubscribe','soportado','2026-10-15T00:00:00Z')",
  ).run();
}

function seedMandate(db: Database.Database) {
  db.prepare(
    `INSERT INTO mandates (id, user_id, service_id, action_type, text_version, text_hash, timestamp, ip)
     VALUES ('m1','u1','spotify','cancel_resubscribe','spotify.v1','abc123','2026-10-15T00:00:00Z','127.0.0.1')`,
  ).run();
}

test("el esquema aplica entero y crea las tablas", () => {
  const db = fresh();
  const names = db
    .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((r) => r.name);
  for (const t of [
    "users", "magic_tokens", "cards", "services", "public_prices",
    "user_services", "mandates", "orchestrations", "events",
    "survey_answers", "pilot_switch",
  ]) {
    assert.ok(names.includes(t), `falta la tabla ${t}`);
  }
  db.close();
});

test("aplicar el esquema dos veces no rompe nada", () => {
  const db = fresh();
  assert.doesNotThrow(() => db.exec(SCHEMA));
  db.close();
});

test("un mandato NO se puede editar", () => {
  const db = fresh();
  seedUserAndService(db);
  seedMandate(db);
  assert.throws(
    () => db.prepare("UPDATE mandates SET text_hash = 'otro' WHERE id = 'm1'").run(),
    /inmutable/,
  );
  assert.throws(
    () => db.prepare("UPDATE mandates SET timestamp = '2020-01-01' WHERE id = 'm1'").run(),
    /inmutable/,
  );
  assert.throws(
    () => db.prepare("UPDATE mandates SET text_version = 'spotify.v0' WHERE id = 'm1'").run(),
    /inmutable/,
  );
  db.close();
});

test("un mandato NO se puede borrar", () => {
  const db = fresh();
  seedUserAndService(db);
  seedMandate(db);
  assert.throws(() => db.prepare("DELETE FROM mandates WHERE id = 'm1'").run(), /no se borra/);
  db.close();
});

test("un mandato SÍ se puede revocar", () => {
  const db = fresh();
  seedUserAndService(db);
  seedMandate(db);
  assert.doesNotThrow(() =>
    db.prepare("UPDATE mandates SET revoked_at = '2026-10-16T00:00:00Z' WHERE id = 'm1'").run(),
  );
  const row = db.prepare<[], { revoked_at: string }>("SELECT revoked_at FROM mandates WHERE id = 'm1'").get()!;
  assert.equal(row.revoked_at, "2026-10-16T00:00:00Z");
  db.close();
});

test("los eventos del piloto son append-only", () => {
  const db = fresh();
  db.prepare("INSERT INTO events (at, type, severity) VALUES ('2026-10-15T00:00:00Z','orchestration.started','info')").run();
  assert.throws(
    () => db.prepare("UPDATE events SET type = 'otra' WHERE id = 1").run(),
    /append-only/,
  );
  db.close();
});

test("el interruptor del piloto nace apagado", () => {
  const db = fresh();
  const s = db.prepare<[], { adapters_live: number }>("SELECT adapters_live FROM pilot_switch WHERE id = 1").get()!;
  assert.equal(s.adapters_live, 0, "los adaptadores reales nunca arrancan encendidos");
  db.close();
});

test("solo puede existir una fila de interruptor", () => {
  const db = fresh();
  assert.throws(() =>
    db.prepare("INSERT INTO pilot_switch (id, adapters_live, updated_at) VALUES (2, 1, 'x')").run(),
  );
  db.close();
});

test("billing_day fuera de 1-31 se rechaza", () => {
  const db = fresh();
  seedUserAndService(db);
  assert.throws(() =>
    db.prepare(
      `INSERT INTO user_services (id, user_id, service_id, billing_day, connected_at, updated_at)
       VALUES ('us1','u1','spotify',40,'x','x')`,
    ).run(),
  );
  db.close();
});

test("un usuario no puede conectar el mismo servicio dos veces", () => {
  const db = fresh();
  seedUserAndService(db);
  const ins = db.prepare(
    `INSERT INTO user_services (id, user_id, service_id, billing_day, connected_at, updated_at)
     VALUES (?, 'u1','spotify',10,'x','x')`,
  );
  ins.run("us1");
  assert.throws(() => ins.run("us2"), /UNIQUE/);
  db.close();
});

test("role de servicio solo acepta los tres válidos", () => {
  const db = fresh();
  assert.throws(() =>
    db.prepare(
      "INSERT INTO services (id, name, role, support_status, created_at) VALUES ('x','X','inventado','soportado','x')",
    ).run(),
  );
  db.close();
});
