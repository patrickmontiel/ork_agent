import "server-only";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";

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

  const schema = readFileSync(join(process.cwd(), "lib/db/schema.sql"), "utf8");
  db.exec(schema);
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

// ─── Catálogo inicial ───────────────────────────────────────────────────────
// Protagonistas: Netflix, Spotify, YouTube Premium.
// "Puente": los tres del buildathon, que sí tienen API de comercio vía Reap.
// "No editable": lo que no se puede, con el motivo que se le muestra al usuario.

type SeedService = {
  id: string;
  name: string;
  role: "puente" | "cerrado" | "no_editable";
  mechanism: "cancel_resubscribe" | "pause" | "api" | null;
  blocked_reason: string | null;
  support_status: "soportado" | "por_verificar" | "no_soportado";
  emoji: string;
  sort_order: number;
};

const SERVICES: SeedService[] = [
  // ── Protagonistas ──
  {
    id: "spotify", name: "Spotify", role: "cerrado", mechanism: "cancel_resubscribe",
    blocked_reason: null, support_status: "soportado", emoji: "🎵", sort_order: 10,
  },
  {
    id: "netflix", name: "Netflix", role: "cerrado", mechanism: "pause",
    blocked_reason: null, support_status: "soportado", emoji: "🎬", sort_order: 20,
  },
  {
    id: "youtube", name: "YouTube Premium", role: "cerrado", mechanism: "cancel_resubscribe",
    blocked_reason: null, support_status: "soportado", emoji: "▶️", sort_order: 30,
  },

  // ── Soportados, segunda ola ──
  {
    id: "amazon_prime", name: "Amazon Prime MX", role: "cerrado", mechanism: "cancel_resubscribe",
    blocked_reason: null, support_status: "soportado", emoji: "📦", sort_order: 40,
  },
  {
    id: "uber_one", name: "Uber One", role: "cerrado", mechanism: "pause",
    blocked_reason: null, support_status: "soportado", emoji: "🛵", sort_order: 50,
  },

  // ── Por verificar ──
  { id: "disney", name: "Disney+", role: "cerrado", mechanism: "cancel_resubscribe", blocked_reason: null, support_status: "por_verificar", emoji: "🏰", sort_order: 60 },
  { id: "max", name: "Max", role: "cerrado", mechanism: "cancel_resubscribe", blocked_reason: null, support_status: "por_verificar", emoji: "🎭", sort_order: 61 },
  { id: "paramount", name: "Paramount+", role: "cerrado", mechanism: "cancel_resubscribe", blocked_reason: null, support_status: "por_verificar", emoji: "⛰️", sort_order: 62 },
  { id: "vix", name: "Vix Premium", role: "cerrado", mechanism: "cancel_resubscribe", blocked_reason: null, support_status: "por_verificar", emoji: "📺", sort_order: 63 },
  { id: "crunchyroll", name: "Crunchyroll", role: "cerrado", mechanism: "cancel_resubscribe", blocked_reason: null, support_status: "por_verificar", emoji: "🍙", sort_order: 64 },
  { id: "chatgpt", name: "ChatGPT Plus", role: "cerrado", mechanism: "cancel_resubscribe", blocked_reason: null, support_status: "por_verificar", emoji: "💬", sort_order: 65 },
  { id: "claude", name: "Claude Pro", role: "cerrado", mechanism: "cancel_resubscribe", blocked_reason: null, support_status: "por_verificar", emoji: "✳️", sort_order: 66 },

  // ── Puente: los del buildathon. Tienen API de comercio; Ork no cancela nada. ──
  {
    id: "cafe", name: "Club de café", role: "puente", mechanism: "api",
    blocked_reason: null, support_status: "soportado", emoji: "☕", sort_order: 80,
  },
  {
    id: "snacks", name: "Caja de snacks", role: "puente", mechanism: "api",
    blocked_reason: null, support_status: "soportado", emoji: "🍯", sort_order: 81,
  },
  {
    id: "limpieza", name: "Limpieza del hogar", role: "puente", mechanism: "api",
    blocked_reason: null, support_status: "soportado", emoji: "🧴", sort_order: 82,
  },

  // ── No editables. El motivo se muestra tal cual al usuario. ──
  {
    id: "apple_iap", name: "Suscripciones de Apple", role: "no_editable", mechanism: null,
    blocked_reason: "Apple cobra estas suscripciones y no permite cambiar la fecha desde fuera. Puedes cancelar y volver a contratar desde tu computadora.",
    support_status: "no_soportado", emoji: "", sort_order: 90,
  },
  {
    id: "google_iap", name: "Suscripciones de Google Play", role: "no_editable", mechanism: null,
    blocked_reason: "Google Play cobra estas suscripciones y no permite cambiar la fecha desde fuera.",
    support_status: "no_soportado", emoji: "🤖", sort_order: 91,
  },
  {
    id: "smartfit", name: "Smart Fit", role: "no_editable", mechanism: null,
    blocked_reason: "Contrato a 12 meses con 30% de penalización por cancelar antes. Mover la fecha te costaría más de lo que te ahorra.",
    support_status: "no_soportado", emoji: "🏋️", sort_order: 92,
  },
  {
    id: "adobe_cc", name: "Adobe Creative Cloud (anual)", role: "no_editable", mechanism: null,
    blocked_reason: "El plan anual cobra 50% de penalización por cancelar antes de tiempo.",
    support_status: "no_soportado", emoji: "🎨", sort_order: 93,
  },
];

// Precios públicos de lista en México. `checked_at` es la fecha en que se
// verificaron; el detector de promo avisa si están rancios.
const PRICES: Array<[string, string, number]> = [
  ["spotify", "individual", 129],
  ["spotify", "duo", 169],
  ["spotify", "familiar", 209],
  ["netflix", "basico", 119],
  ["netflix", "estandar", 219],
  ["netflix", "premium", 299],
  ["youtube", "individual", 139],
  ["youtube", "familiar", 259],
];

function seed(d: Database.Database) {
  const ts = new Date().toISOString();

  const upsertService = d.prepare(`
    INSERT INTO services (id, name, role, mechanism, blocked_reason, support_status, emoji, sort_order, created_at)
    VALUES (@id, @name, @role, @mechanism, @blocked_reason, @support_status, @emoji, @sort_order, @created_at)
    ON CONFLICT (id) DO UPDATE SET
      name = excluded.name, role = excluded.role, mechanism = excluded.mechanism,
      blocked_reason = excluded.blocked_reason, support_status = excluded.support_status,
      emoji = excluded.emoji, sort_order = excluded.sort_order
  `);

  const upsertPrice = d.prepare(`
    INSERT INTO public_prices (id, service_id, plan, country, amount, currency, checked_at, source)
    VALUES (@id, @service_id, @plan, 'MX', @amount, 'MXN', @checked_at, @source)
    ON CONFLICT (service_id, plan, country) DO UPDATE SET
      amount = excluded.amount, checked_at = excluded.checked_at
  `);

  d.transaction(() => {
    for (const s of SERVICES) upsertService.run({ ...s, created_at: ts });
    for (const [service_id, plan, amount] of PRICES) {
      upsertPrice.run({
        id: `${service_id}:${plan}:MX`,
        service_id,
        plan,
        amount,
        checked_at: ts,
        source: "seed inicial — verificar contra la página pública antes del piloto",
      });
    }
  })();
}
