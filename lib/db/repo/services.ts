import "server-only";
import { db } from "../index";
import type { Service, ServiceRow, PublicPriceRow } from "../types";

function toService(r: ServiceRow): Service {
  return {
    id: r.id,
    name: r.name,
    role: r.role,
    mechanism: r.mechanism,
    blocked_reason: r.blocked_reason,
    support_status: r.support_status,
    emoji: r.emoji,
    sort_order: r.sort_order,
    editable: r.role !== "no_editable",
  };
}

export function listServices(): Service[] {
  const rows = db()
    .prepare<[], ServiceRow>("SELECT * FROM services ORDER BY sort_order, name")
    .all();
  return rows.map(toService);
}

/**
 * Protagonistas: servicios cerrados que Ork mueve cancelando y recontratando
 * (o pausando) con mandato del usuario. Spotify, Netflix, YouTube.
 * Es la lista que va arriba en la UI.
 */
export function listClosed(): Service[] {
  return listServices().filter(
    (s) => s.role === "cerrado" && s.support_status === "soportado",
  );
}

/** Cerrados que aún no se han verificado. Se muestran aparte, sin prometer nada. */
export function listUnverified(): Service[] {
  return listServices().filter(
    (s) => s.role === "cerrado" && s.support_status === "por_verificar",
  );
}

/**
 * Puente: el comercio tiene API, Ork manda la instrucción y el comercio cobra.
 * Ork no cancela nada aquí, así que no hace falta mandato. Sección aparte en
 * la UI: el modelo de confianza es distinto y no conviene mezclarlos.
 */
export function listBridge(): Service[] {
  return listServices().filter((s) => s.role === "puente");
}

/**
 * Todo lo que Ork puede mover hoy, sin importar el rol. Úsalo solo para
 * contar o validar; para renderizar usa listClosed() y listBridge() por
 * separado, porque la pantalla tiene que distinguirlos.
 */
export function listEditable(): Service[] {
  return listServices().filter(
    (s) => s.editable && s.support_status === "soportado",
  );
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
    .prepare<[], PublicPriceRow>(
      "SELECT * FROM public_prices ORDER BY service_id, plan",
    )
    .all();
}

/**
 * Los precios de lista cambian y el detector de promo depende de ellos.
 * Si llevan más de `days` sin verificar, la comparación ya no es confiable.
 */
export function stalePrices(days = 90): PublicPriceRow[] {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  return db()
    .prepare<[string], PublicPriceRow>(
      "SELECT * FROM public_prices WHERE checked_at < ? ORDER BY checked_at",
    )
    .all(cutoff);
}
