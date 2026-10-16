import "server-only";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { migrate } from "./migrate";
import { seed } from "./seed";

// Conexión única. Vive en globalThis para sobrevivir al hot reload de Next,
// igual que hacía el store en memoria de v1 — pero ahora detrás hay un archivo.
const g = globalThis as unknown as { __orkDb?: Database.Database };

function open(): Database.Database {
  const path = process.env.DATABASE_PATH ?? "./ork.db";
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  // Espera en vez de fallar si otra conexión tiene el lock.
  db.pragma("busy_timeout = 5000");

  // Orden: crear lo que falte → migrar lo que ya existía → sembrar.
  // El seed escribe columnas que la migración acaba de agregar, así que no
  // puede ir antes.
  const schema = readFileSync(join(process.cwd(), "lib/db/schema.sql"), "utf8");
  db.exec(schema);

  const applied = migrate(db);
  if (applied.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`[ork/db] migraciones aplicadas: ${applied.join(", ")}`);
  }

  seed(db);
  return db;
}

export function db(): Database.Database {
  if (!g.__orkDb) g.__orkDb = open();
  return g.__orkDb;
}

// ─── Utilidades compartidas ─────────────────────────────────────────────────

export function id(): string {
  return randomUUID();
}

export function now(): string {
  return new Date().toISOString();
}

export function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/** Fecha de hoy en CDMX (UTC-6), formato YYYY-MM-DD. */
export function todayCDMX(): string {
  return new Date(Date.now() - 6 * 3_600_000).toISOString().slice(0, 10);
}
