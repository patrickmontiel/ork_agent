import "server-only";
import { db } from "../index";
import type { Service, ServiceRow, PublicPriceRow } from "../types";

function toService(r: ServiceRow): Service {
  return {
    id: r.id,
    name: r.name,
    role: r.role,
    orchestrable: r.orchestrable,
    blocked_reason: r.blocked_reason,
    support_status: r.support_status,
    emoji: r.emoji,
    sort_order: r.sort_order,
    editable: r.role !== "no_editable" && r.orchestrable !== "not_supported",
    hasPilotAdapter: r.pilot_adapter === 1,
  };
}

export function listServices(): Service[] {
  return db()
    .prepare<[], ServiceRow>("SELECT * FROM services ORDER BY sort_order, name")
    .all()
    .map(toService);
}

/**
 * Protagonistas del piloto: los únicos con adaptador real, hoy Spotify y
 * Netflix. Tener mecanismo definido no es tener código que lo ejecute.
 */
export function listPilot(): Service[] {
  return listServices().filter((s) => s.hasPilotAdapter);
}

/**
 * Cerrados con mecanismo definido pero sin adaptador: se muestran como
 * "próximamente". Aparecen en el catálogo para que la persona sepa que vienen,
 * sin prometer que ya funcionan.
 */
export function listComingSoon(): Service[] {
  return listServices().filter(
    (s) => s.role === "cerrado" && !s.hasPilotAdapter && s.orchestrable !== null,
  );
}

/** Cerrados sin mecanismo decidido. No se promete nada todavía. */
export function listUndecided(): Service[] {
  return listServices().filter((s) => s.role === "cerrado" && s.orchestrable === null);
}

/**
 * Puente: el comercio tiene API. Ork avisa la fecha y el comercio cobra, así
 * que no hace falta mandato. Sección aparte en la UI: el modelo de confianza es
 * distinto y no conviene mezclarlos.
 */
export function listBridge(): Service[] {
  return listServices().filter((s) => s.role === "puente");
}

/** Lo que no se puede mover, con el motivo que se le muestra al usuario. */
export function listBlocked(): Service[] {
  return listServices().filter((s) => !s.editable);
}

export function getService(id: string): Service | undefined {
  const r = db()
    .prepare<[string], ServiceRow>("SELECT * FROM services WHERE id = ?")
    .get(id);
  return r ? toService(r) : undefined;
}

// ─── Precios públicos ───────────────────────────────────────────────────────

export function getPublicPrice(
  serviceId: string,
  plan: string,
  country = "MX",
): PublicPriceRow | undefined {
  return db()
    .prepare<[string, string, string], PublicPriceRow>(
      "SELECT * FROM public_prices WHERE service_id = ? AND plan = ? AND country = ?",
    )
    .get(serviceId, plan, country);
}

export function listPublicPrices(serviceId?: string): PublicPriceRow[] {
  if (serviceId) {
    return db()
      .prepare<[string], PublicPriceRow>(
        "SELECT * FROM public_prices WHERE service_id = ? ORDER BY plan",
      )
      .all(serviceId);
  }
  return db()
    .prepare<[], PublicPriceRow>("SELECT * FROM public_prices ORDER BY service_id, plan")
    .all();
}

export type PriceUsability =
  | { usable: true; amount: number; currency: string }
  | { usable: false; reason: "sin_verificar" | "es_promo" | "no_existe"; note: string | null };

/**
 * ¿Se puede usar este precio para detectar promo?
 *
 * El detector de la Fase 3 compara lo que paga el usuario contra el precio de
 * lista. Esa comparación solo vale si el precio está verificado Y no es a su
 * vez promocional — si el precio publicado es una promo de 6 meses, todo el
 * mundo "tiene promo" y la señal no dice nada.
 *
 * Prefiere no opinar antes que opinar mal.
 */
export function priceUsability(serviceId: string, plan: string, country = "MX"): PriceUsability {
  const p = getPublicPrice(serviceId, plan, country);
  if (!p) return { usable: false, reason: "no_existe", note: null };
  if (p.needs_verification === 1 || p.amount === null) {
    return { usable: false, reason: "sin_verificar", note: p.note };
  }
  if (p.is_promo === 1) return { usable: false, reason: "es_promo", note: p.note };
  return { usable: true, amount: p.amount, currency: p.currency };
}

/** Precios que todavía no se han verificado contra la página oficial. */
export function unverifiedPrices(): PublicPriceRow[] {
  return db()
    .prepare<[], PublicPriceRow>(
      "SELECT * FROM public_prices WHERE needs_verification = 1 OR amount IS NULL ORDER BY service_id, plan",
    )
    .all();
}

/** Precios de lista que son a su vez promocionales: no sirven para comparar. */
export function promoPrices(): PublicPriceRow[] {
  return db()
    .prepare<[], PublicPriceRow>(
      "SELECT * FROM public_prices WHERE is_promo = 1 ORDER BY service_id, plan",
    )
    .all();
}

/**
 * Los precios de lista cambian y el detector de promo depende de ellos.
 * Si llevan más de `days` sin verificar, la comparación deja de ser confiable.
 */
export function stalePrices(days = 90): PublicPriceRow[] {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  return db()
    .prepare<[string], PublicPriceRow>(
      `SELECT * FROM public_prices
        WHERE needs_verification = 0 AND checked_at <> '' AND checked_at < ?
        ORDER BY checked_at`,
    )
    .all(cutoff);
}
