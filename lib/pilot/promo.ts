// Detector de promoción.
//
// La pregunta es simple: ¿la persona paga menos que el precio de lista?
// Si sí, tiene promo, y al cancelar y recontratar la pierde para siempre.
// Esa pérdida dispara confirmación reforzada y hace que Ork recomiende NO mover.
//
// Lo delicado no es la comparación, es saber cuándo NO se puede comparar.
// Hay tres casos en que el precio de lista no sirve, y en los tres Ork prefiere
// decir "no sé" antes que opinar mal:
//
//   sin_verificar → nunca se verificó contra la página oficial
//   es_promo      → el precio de lista ES a su vez una promo (Disney+), así que
//                   "pagar menos que él" no significa nada
//   no_existe     → no hay precio registrado para ese plan
//
// Lógica pura: no toca la base. Quien llama le pasa el precio ya resuelto.

export type PriceRef =
  | { usable: true; amount: number; currency: string }
  | { usable: false; reason: "sin_verificar" | "es_promo" | "no_existe"; note?: string | null };

export type PromoVerdict =
  | {
      known: true;
      hasPromo: boolean;
      paid: number;
      list: number;
      currency: string;
      /** Cuánto más pagaría al mes si recontrata. 0 si no hay promo. */
      monthlyIncrease: number;
      message: string;
    }
  | {
      known: false;
      reason: "sin_verificar" | "es_promo" | "no_existe" | "sin_monto";
      message: string;
    };

/** Margen de tolerancia: diferencias de centavos no son una promo. */
const EPSILON = 1;

export function detectPromo(
  paidAmount: number | null,
  listPrice: PriceRef,
): PromoVerdict {
  if (paidAmount === null || Number.isNaN(paidAmount)) {
    return {
      known: false,
      reason: "sin_monto",
      message: "No pudimos leer cuánto pagas, así que no sabemos si tienes promoción.",
    };
  }

  if (!listPrice.usable) {
    return {
      known: false,
      reason: listPrice.reason,
      message: mensajeNoSe(listPrice.reason),
    };
  }

  const diff = listPrice.amount - paidAmount;
  const hasPromo = diff > EPSILON;

  return {
    known: true,
    hasPromo,
    paid: paidAmount,
    list: listPrice.amount,
    currency: listPrice.currency,
    monthlyIncrease: hasPromo ? round2(diff) : 0,
    message: hasPromo
      ? `Hoy pagas ${money(paidAmount, listPrice.currency)} y el precio normal es ${money(listPrice.amount, listPrice.currency)}. Si movemos la fecha, pierdes esa promoción y pasarías a pagar ${money(listPrice.amount, listPrice.currency)} al mes.`
      : `Pagas el precio normal, ${money(listPrice.amount, listPrice.currency)}. No hay promoción que perder.`,
  };
}

function mensajeNoSe(reason: "sin_verificar" | "es_promo" | "no_existe"): string {
  switch (reason) {
    case "sin_verificar":
      return "No tenemos verificado el precio de lista de este servicio, así que no podemos decirte si tienes promoción. Revísalo tú antes de confirmar.";
    case "es_promo":
      return "El precio de lista de este servicio es a su vez una promoción temporal, así que compararlo no dice nada. Revisa tú cuánto pagarías al recontratar.";
    case "no_existe":
      return "No tenemos registrado el precio de tu plan, así que no podemos decirte si tienes promoción.";
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function money(n: number, currency: string): string {
  const s = n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency === "USD" ? `US$${s}` : `$${s}`;
}

/**
 * ¿La incertidumbre debe tratarse como riesgo?
 *
 * Cuando no sabemos si hay promo, Ork NO activa la confirmación reforzada por
 * ese motivo —sería ruido en cada movimiento— pero sí se lo dice a la persona
 * para que lo revise. Lo que nunca hace es afirmar que no hay promo.
 */
export function promoLost(v: PromoVerdict): boolean {
  return v.known && v.hasPromo;
}
