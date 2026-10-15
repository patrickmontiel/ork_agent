import "server-only";
import type { Database } from "better-sqlite3";

// Catálogo y precios públicos.
//
// Los precios alimentan el detector de promo de la Fase 3: si el usuario paga
// menos que el precio de lista, tiene promo y la pierde al recontratar. Por eso
// un precio mal capturado no es un detalle cosmético — hace que Ork le diga a
// alguien que tiene promo cuando no, o al revés.
//
// Precios verificados contra páginas oficiales de México el 2026-10-15.

export const PRICES_VERIFIED_AT = "2026-10-15";

// ─── Servicios ──────────────────────────────────────────────────────────────

export type Orchestrable = "pause" | "cancel_resubscribe" | "api" | "not_supported";

export interface SeedService {
  id: string;
  name: string;
  role: "puente" | "cerrado" | "no_editable";
  /** Cómo se movería la fecha. null = todavía sin determinar. */
  orchestrable: Orchestrable | null;
  /** ¿Hay adaptador real en el piloto? Solo Spotify y Netflix. */
  pilot_adapter: 0 | 1;
  blocked_reason: string | null;
  support_status: "soportado" | "por_verificar" | "no_soportado";
  emoji: string;
  sort_order: number;
}

export const SERVICES: SeedService[] = [
  // ── Con adaptador real en el piloto ──
  { id: "spotify", name: "Spotify", role: "cerrado", orchestrable: "cancel_resubscribe", pilot_adapter: 1, blocked_reason: null, support_status: "soportado", emoji: "🎵", sort_order: 10 },
  { id: "netflix", name: "Netflix", role: "cerrado", orchestrable: "pause", pilot_adapter: 1, blocked_reason: null, support_status: "soportado", emoji: "🎬", sort_order: 11 },

  // ── Cerrados, mecanismo definido, sin adaptador todavía → "próximamente" ──
  { id: "youtube_premium", name: "YouTube Premium", role: "cerrado", orchestrable: "cancel_resubscribe", pilot_adapter: 0, blocked_reason: null, support_status: "por_verificar", emoji: "▶️", sort_order: 20 },
  { id: "max", name: "Max", role: "cerrado", orchestrable: "cancel_resubscribe", pilot_adapter: 0, blocked_reason: null, support_status: "por_verificar", emoji: "🎭", sort_order: 21 },
  { id: "disney", name: "Disney+", role: "cerrado", orchestrable: "cancel_resubscribe", pilot_adapter: 0, blocked_reason: null, support_status: "por_verificar", emoji: "🏰", sort_order: 22 },
  { id: "paramount", name: "Paramount+", role: "cerrado", orchestrable: "cancel_resubscribe", pilot_adapter: 0, blocked_reason: null, support_status: "por_verificar", emoji: "⛰️", sort_order: 23 },
  { id: "vix", name: "ViX Premium", role: "cerrado", orchestrable: "cancel_resubscribe", pilot_adapter: 0, blocked_reason: null, support_status: "por_verificar", emoji: "📺", sort_order: 24 },
  { id: "crunchyroll", name: "Crunchyroll", role: "cerrado", orchestrable: "cancel_resubscribe", pilot_adapter: 0, blocked_reason: null, support_status: "por_verificar", emoji: "🍙", sort_order: 25 },
  { id: "deezer", name: "Deezer", role: "cerrado", orchestrable: "cancel_resubscribe", pilot_adapter: 0, blocked_reason: null, support_status: "por_verificar", emoji: "🎧", sort_order: 26 },
  { id: "apple_tv", name: "Apple TV+", role: "cerrado", orchestrable: "cancel_resubscribe", pilot_adapter: 0, blocked_reason: null, support_status: "por_verificar", emoji: "🍎", sort_order: 27 },
  { id: "apple_music", name: "Apple Music", role: "cerrado", orchestrable: "cancel_resubscribe", pilot_adapter: 0, blocked_reason: null, support_status: "por_verificar", emoji: "🎼", sort_order: 28 },
  { id: "chatgpt", name: "ChatGPT", role: "cerrado", orchestrable: "cancel_resubscribe", pilot_adapter: 0, blocked_reason: null, support_status: "por_verificar", emoji: "💬", sort_order: 29 },
  { id: "claude", name: "Claude", role: "cerrado", orchestrable: "cancel_resubscribe", pilot_adapter: 0, blocked_reason: null, support_status: "por_verificar", emoji: "✳️", sort_order: 30 },
  { id: "google_ai", name: "Google AI", role: "cerrado", orchestrable: "cancel_resubscribe", pilot_adapter: 0, blocked_reason: null, support_status: "por_verificar", emoji: "✨", sort_order: 31 },
  { id: "uber_one", name: "Uber One", role: "cerrado", orchestrable: "pause", pilot_adapter: 0, blocked_reason: null, support_status: "por_verificar", emoji: "🛵", sort_order: 32 },

  // ── Mecanismo SIN determinar. No se promete nada hasta decidirlo. ──
  { id: "microsoft_365", name: "Microsoft 365", role: "cerrado", orchestrable: null, pilot_adapter: 0, blocked_reason: null, support_status: "por_verificar", emoji: "🪟", sort_order: 40 },
  { id: "canva", name: "Canva", role: "cerrado", orchestrable: null, pilot_adapter: 0, blocked_reason: null, support_status: "por_verificar", emoji: "🎨", sort_order: 41 },
  { id: "ps_plus", name: "PlayStation Plus", role: "cerrado", orchestrable: null, pilot_adapter: 0, blocked_reason: null, support_status: "por_verificar", emoji: "🎮", sort_order: 42 },
  { id: "amazon_prime", name: "Amazon Prime", role: "cerrado", orchestrable: null, pilot_adapter: 0, blocked_reason: null, support_status: "por_verificar", emoji: "📦", sort_order: 43 },
  { id: "xbox_game_pass", name: "Xbox Game Pass", role: "cerrado", orchestrable: null, pilot_adapter: 0, blocked_reason: null, support_status: "por_verificar", emoji: "🕹️", sort_order: 44 },
  { id: "duolingo", name: "Duolingo", role: "cerrado", orchestrable: null, pilot_adapter: 0, blocked_reason: null, support_status: "por_verificar", emoji: "🦉", sort_order: 45 },
  { id: "rappi_pro", name: "Rappi Pro", role: "cerrado", orchestrable: null, pilot_adapter: 0, blocked_reason: null, support_status: "por_verificar", emoji: "🛍️", sort_order: 46 },
  { id: "meli_plus", name: "Mercado Libre Plus", role: "cerrado", orchestrable: null, pilot_adapter: 0, blocked_reason: null, support_status: "por_verificar", emoji: "🛒", sort_order: 47 },

  // ── Puente: el comercio tiene API. Ork avisa la fecha, el comercio cobra. ──
  { id: "cafe", name: "Club de café", role: "puente", orchestrable: "api", pilot_adapter: 0, blocked_reason: null, support_status: "soportado", emoji: "☕", sort_order: 80 },
  { id: "snacks", name: "Caja de snacks", role: "puente", orchestrable: "api", pilot_adapter: 0, blocked_reason: null, support_status: "soportado", emoji: "🍯", sort_order: 81 },
  { id: "limpieza", name: "Limpieza del hogar", role: "puente", orchestrable: "api", pilot_adapter: 0, blocked_reason: null, support_status: "soportado", emoji: "🧴", sort_order: 82 },

  // ── No editables. El motivo se le muestra al usuario tal cual. ──
  {
    id: "apple_iap", name: "Cobros por App Store", role: "no_editable", orchestrable: "not_supported", pilot_adapter: 0,
    blocked_reason: "Apple cobra estas suscripciones y no permite cambiar la fecha desde fuera. Puedes cancelar y volver a contratar desde tu computadora.",
    support_status: "no_soportado", emoji: "", sort_order: 90,
  },
  {
    id: "google_iap", name: "Cobros por Google Play", role: "no_editable", orchestrable: "not_supported", pilot_adapter: 0,
    blocked_reason: "Google Play cobra estas suscripciones y no permite cambiar la fecha desde fuera.",
    support_status: "no_soportado", emoji: "🤖", sort_order: 91,
  },
  {
    id: "planes_anuales", name: "Cualquier plan anual", role: "no_editable", orchestrable: "not_supported", pilot_adapter: 0,
    blocked_reason: "Los planes anuales cobran una vez al año. Mover esa fecha casi siempre cuesta más de lo que ahorra.",
    support_status: "no_soportado", emoji: "📅", sort_order: 92,
  },
  {
    id: "smartfit", name: "Smart Fit", role: "no_editable", orchestrable: "not_supported", pilot_adapter: 0,
    blocked_reason: "Contrato a 12 meses con 30% de penalización por cancelar antes. Mover la fecha te costaría más de lo que te ahorra.",
    support_status: "no_soportado", emoji: "🏋️", sort_order: 93,
  },
  {
    id: "adobe_cc", name: "Adobe Creative Cloud", role: "no_editable", orchestrable: "not_supported", pilot_adapter: 0,
    blocked_reason: "El plan anual cobra 50% de penalización por cancelar antes de tiempo.",
    support_status: "no_soportado", emoji: "🖌️", sort_order: 94,
  },
];

// ─── Precios públicos ───────────────────────────────────────────────────────
// amount null = sin precio verificado. El detector de promo NO compara contra
// un precio nulo: prefiere no opinar antes que opinar mal.

export interface SeedPrice {
  service_id: string;
  plan: string;
  amount: number | null;
  currency: string;
  /** El precio de lista es promocional y vuelve a subir. */
  is_promo: 0 | 1;
  /** Hace falta verificarlo antes de usarlo para detectar promo. */
  needs_verification: 0 | 1;
  note: string | null;
}

function p(
  service_id: string,
  plan: string,
  amount: number | null,
  opts: { currency?: string; is_promo?: 0 | 1; needs_verification?: 0 | 1; note?: string } = {},
): SeedPrice {
  return {
    service_id,
    plan,
    amount,
    currency: opts.currency ?? "MXN",
    is_promo: opts.is_promo ?? 0,
    needs_verification: opts.needs_verification ?? (amount === null ? 1 : 0),
    note: opts.note ?? null,
  };
}

export const PRICES: SeedPrice[] = [
  // Música
  p("spotify", "individual", 139),
  p("spotify", "duo", 189),
  p("spotify", "familiar", 239),
  p("spotify", "estudiantes", 74),
  p("apple_music", "individual", 139),
  p("apple_music", "familiar", 239),
  p("apple_music", "estudiantes", 75),
  p("deezer", "premium", 139),
  p("deezer", "family", 239),

  // Video
  // Netflix: el plan Básico ya no se vende en México.
  p("netflix", "estandar_con_anuncios", 139),
  p("netflix", "estandar", 269),
  p("netflix", "premium", 369),
  p("youtube_premium", "individual", 159),
  p("youtube_premium", "familiar", 319),
  p("youtube_premium", "estudiantes", 99),
  p("max", "basico_con_anuncios", 149),
  p("max", "estandar", 239),
  p("max", "platino", 299),
  // Disney+: lo publicado es precio promocional de 6 meses. El precio base al
  // que vuelve NO está verificado, así que el detector de promo lo tratará con
  // cuidado: un usuario que pague 129 no tiene promo propia, es el precio de lista.
  p("disney", "estandar_con_anuncios", 129, { is_promo: 1, note: "Promo 6 meses. Precio base sin verificar." }),
  p("disney", "estandar", 199, { is_promo: 1, note: "Promo 6 meses. Precio base sin verificar." }),
  p("disney", "premium", 279, { is_promo: 1, note: "Promo 6 meses. Precio base sin verificar." }),
  p("paramount", "desde", 149, { note: "Precio de entrada; el plan exacto no está especificado." }),
  p("vix", "premium", 149),
  p("vix", "premium_con_disney", 199),
  p("apple_tv", "mensual", 199),
  p("crunchyroll", "fan", 129),
  p("crunchyroll", "mega_fan", 159),

  // IA
  p("chatgpt", "go", 110),
  p("chatgpt", "plus", 343.97),
  p("chatgpt", "pro", 1700),
  p("claude", "pro", 20, { currency: "USD" }),
  p("claude", "max", 100, { currency: "USD" }),
  p("google_ai", "plus", 99),
  p("google_ai", "pro", 395),
  p("google_ai", "ultra", 1999),

  // Productividad
  p("microsoft_365", "personal", 184.99),
  p("microsoft_365", "familia", 224.99),
  p("microsoft_365", "premium", 374.99),
  p("canva", "pro", 150),
  p("canva", "negocios", 210, { note: "Por persona." }),

  // Gaming y otros
  p("ps_plus", "essential", 149),
  p("ps_plus", "extra", 229),
  p("ps_plus", "deluxe", 279),
  p("uber_one", "mensual", 70),

  // Sin precio verificado. Se registran igual para que aparezcan en el catálogo
  // y en el reporte de "falta verificar", en vez de desaparecer en silencio.
  p("amazon_prime", "mensual", null),
  p("xbox_game_pass", "mensual", null),
  p("duolingo", "super", null),
  p("rappi_pro", "mensual", null),
  p("meli_plus", "mensual", null, { note: "Promo temporal desde $49.90; precio base sin verificar." }),
];

// ─── Aplicación ─────────────────────────────────────────────────────────────

export function seed(d: Database) {
  const ts = new Date().toISOString();

  const upsertService = d.prepare(`
    INSERT INTO services (id, name, role, orchestrable, pilot_adapter, blocked_reason, support_status, emoji, sort_order, created_at)
    VALUES (@id, @name, @role, @orchestrable, @pilot_adapter, @blocked_reason, @support_status, @emoji, @sort_order, @created_at)
    ON CONFLICT (id) DO UPDATE SET
      name = excluded.name, role = excluded.role, orchestrable = excluded.orchestrable,
      pilot_adapter = excluded.pilot_adapter, blocked_reason = excluded.blocked_reason,
      support_status = excluded.support_status, emoji = excluded.emoji, sort_order = excluded.sort_order
  `);

  const upsertPrice = d.prepare(`
    INSERT INTO public_prices (id, service_id, plan, country, amount, currency, is_promo, needs_verification, note, checked_at, source)
    VALUES (@id, @service_id, @plan, 'MX', @amount, @currency, @is_promo, @needs_verification, @note, @checked_at, @source)
    ON CONFLICT (service_id, plan, country) DO UPDATE SET
      amount = excluded.amount, currency = excluded.currency, is_promo = excluded.is_promo,
      needs_verification = excluded.needs_verification, note = excluded.note, checked_at = excluded.checked_at
  `);

  d.transaction(() => {
    for (const s of SERVICES) upsertService.run({ ...s, created_at: ts });
    for (const x of PRICES) {
      upsertPrice.run({
        ...x,
        id: `${x.service_id}:${x.plan}:MX`,
        // Los no verificados no llevan fecha de verificación: así nunca se
        // confunden con un dato fresco.
        checked_at: x.needs_verification ? "" : `${PRICES_VERIFIED_AT}T00:00:00.000Z`,
        source: x.needs_verification ? null : "Página oficial MX",
      });
    }
  })();
}
