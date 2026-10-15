import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import {
  currentText,
  textByVersion,
  fullText,
  servicesWithMandate,
} from "../lib/mandate/texts.ts";

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

// ─── Textos ─────────────────────────────────────────────────────────────────

test("cada servicio con mandato tiene texto vigente coherente", () => {
  for (const id of servicesWithMandate()) {
    const t = currentText(id);
    assert.ok(t, `falta texto vigente para ${id}`);
    assert.equal(t.serviceId, id, "el serviceId del texto no coincide con su llave");
    assert.ok(t.version.startsWith(`${id}.`), `la versión debe empezar con "${id}."`);
    assert.ok(t.parrafos.length > 0, "un consentimiento vacío no es consentimiento");
    assert.ok(t.titulo.length > 0);
    assert.ok(t.resumen.length > 0);
  }
});

test("toda versión vigente se puede recuperar por su id", () => {
  for (const id of servicesWithMandate()) {
    const t = currentText(id)!;
    assert.deepEqual(textByVersion(t.version), t);
  }
});

test("el texto de Spotify dice las cuatro cosas que no se pueden omitir", () => {
  const t = currentText("spotify")!;
  const todo = fullText(t).toLowerCase();
  assert.match(todo, /cancelar y volver a contratar/, "qué va a hacer Ork");
  assert.match(todo, /nunca guarda tu contraseña/, "qué NO hace Ork");
  assert.match(todo, /no está afiliado a spotify/, "que Ork no es Spotify");
  assert.match(todo, /revocar esta autorización/, "que se puede revocar");
});

test("el texto de Netflix avisa de los días sin servicio", () => {
  const t = currentText("netflix")!;
  const todo = fullText(t).toLowerCase();
  assert.match(todo, /pausar/, "el mecanismo es pausa, no cancelación");
  assert.match(todo, /no vas a poder ver/, "hay que decir que se pierde el acceso");
  assert.match(todo, /revocar/);
});

test("fullText es determinista: el mismo texto da el mismo hash", () => {
  const t = currentText("spotify")!;
  assert.equal(sha256(fullText(t)), sha256(fullText(t)));
});

test("dos servicios distintos no comparten hash", () => {
  const a = sha256(fullText(currentText("spotify")!));
  const b = sha256(fullText(currentText("netflix")!));
  assert.notEqual(a, b);
});

test("una versión inventada no existe", () => {
  assert.equal(textByVersion("spotify.v99"), undefined);
  assert.equal(textByVersion(""), undefined);
});

// ─── Inmutabilidad y vigencia en la base ────────────────────────────────────

const SCHEMA = readFileSync(join(process.cwd(), "lib/db/schema.sql"), "utf8");

function dbConMandato(revocado = false) {
  const db = new Database(":memory:");
  db.exec(SCHEMA);
  db.prepare("INSERT INTO users (id, email, created_at) VALUES ('u1','a@b.mx','2026-10-15T00:00:00Z')").run();
  db.prepare(
    "INSERT INTO services (id, name, role, orchestrable, support_status, created_at) VALUES ('spotify','Spotify','cerrado','cancel_resubscribe','soportado','2026-10-15T00:00:00Z')",
  ).run();
  const t = currentText("spotify")!;
  db.prepare(
    `INSERT INTO mandates (id, user_id, service_id, action_type, text_version, text_hash, timestamp, ip, scrolled_to_end, revoked_at)
     VALUES ('m1','u1','spotify',?,?,?,'2026-10-15T01:00:00Z','127.0.0.1',1,?)`,
  ).run(t.actionType, t.version, sha256(fullText(t)), revocado ? "2026-10-16T00:00:00Z" : null);
  return db;
}

function vigente(db: Database.Database) {
  return db
    .prepare(
      `SELECT * FROM mandates
        WHERE user_id = 'u1' AND service_id = 'spotify' AND action_type = 'cancel_resubscribe'
          AND revoked_at IS NULL
        ORDER BY timestamp DESC LIMIT 1`,
    )
    .get();
}

test("un mandato recién otorgado está vigente", () => {
  const db = dbConMandato();
  assert.ok(vigente(db));
  db.close();
});

test("un mandato revocado deja de estar vigente", () => {
  const db = dbConMandato(true);
  assert.equal(vigente(db), undefined);
  db.close();
});

test("el hash guardado corresponde al texto de su versión", () => {
  const db = dbConMandato();
  const m = db.prepare<[], { text_version: string; text_hash: string }>(
    "SELECT text_version, text_hash FROM mandates WHERE id = 'm1'",
  ).get()!;
  const t = textByVersion(m.text_version)!;
  assert.equal(sha256(fullText(t)), m.text_hash, "si esto falla, alguien editó el texto sin subir de versión");
  db.close();
});

test("editar el texto sin subir de versión invalida el mandato", () => {
  const db = dbConMandato();
  // Simula que texts.ts cambió: el hash guardado ya no corresponde.
  const textoEditado = fullText(currentText("spotify")!) + " Cláusula agregada después.";
  const m = db.prepare<[], { text_hash: string }>("SELECT text_hash FROM mandates WHERE id = 'm1'").get()!;
  assert.notEqual(sha256(textoEditado), m.text_hash, "el hash tiene que delatar el cambio");
  db.close();
});

test("scrolled_to_end queda registrado", () => {
  const db = dbConMandato();
  const m = db.prepare<[], { scrolled_to_end: number }>(
    "SELECT scrolled_to_end FROM mandates WHERE id = 'm1'",
  ).get()!;
  assert.equal(m.scrolled_to_end, 1);
  db.close();
});

test("revocar es la única mutación permitida", () => {
  const db = dbConMandato();
  assert.doesNotThrow(() =>
    db.prepare("UPDATE mandates SET revoked_at = '2026-10-17T00:00:00Z' WHERE id = 'm1'").run(),
  );
  assert.throws(
    () => db.prepare("UPDATE mandates SET service_id = 'netflix' WHERE id = 'm1'").run(),
    /inmutable/,
  );
  assert.throws(
    () => db.prepare("UPDATE mandates SET scrolled_to_end = 0 WHERE id = 'm1'").run(),
    /inmutable/,
    "cambiar la prueba de lectura también debe estar prohibido",
  );
  db.close();
});

test("un mandato de otro servicio no sirve para este", () => {
  const db = dbConMandato();
  const otro = db
    .prepare(
      `SELECT * FROM mandates WHERE user_id='u1' AND service_id='netflix' AND revoked_at IS NULL`,
    )
    .get();
  assert.equal(otro, undefined, "el mandato es por servicio, no global");
  db.close();
});

test("un mandato de otra acción no sirve para esta", () => {
  const db = dbConMandato();
  const otra = db
    .prepare(
      `SELECT * FROM mandates WHERE user_id='u1' AND service_id='spotify' AND action_type='pause' AND revoked_at IS NULL`,
    )
    .get();
  assert.equal(otra, undefined, "cancelar y pausar son permisos distintos");
  db.close();
});
