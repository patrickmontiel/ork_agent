// Cuándo cobra Ork y cuándo no. Nada más.
//
// Este archivo no importa Stripe, ni la base, ni "server-only": es una decisión
// pura, y vive aparte justamente para poder probarla sola. La regla que protege
// al usuario no debería necesitar una llave de API para verificarse.
//
//   LA REGLA: el fee se cobra SOLO después de una orquestación exitosa y
//   verificada. Si Ork no movió la fecha, Ork no cobra. "La API no devolvió
//   error" no es haberla movido.

export type FeeSkipReason =
  | "premium"
  | "ya_cobrado"
  | "stripe_apagado"
  | "orquestacion_fallida";

export type FeeDecision = { charge: true } | { charge: false; reason: FeeSkipReason };

export interface FeeContext {
  /** Plan de la persona. Premium no paga por evento. */
  plan: string | null | undefined;
  /** ¿La orquestación terminó en éxito VERIFICADO? */
  orchestrationSucceeded: boolean;
  /** ¿Ya hay un fee para esta orquestación? */
  alreadyCharged: boolean;
  /** ¿Stripe está configurado? */
  stripeEnabled: boolean;
}

/**
 * Decide si corresponde cobrar el fee.
 *
 * El orden importa y es deliberado: "falló" se evalúa antes que "ya cobrado" y
 * antes que "Stripe apagado", porque de los cuatro motivos el único que podría
 * dañar a la persona es cobrar algo que no funcionó. Ese se descarta primero.
 */
export function feeDecision(ctx: FeeContext): FeeDecision {
  if (ctx.plan === "premium") return { charge: false, reason: "premium" };
  if (!ctx.orchestrationSucceeded) return { charge: false, reason: "orquestacion_fallida" };
  if (ctx.alreadyCharged) return { charge: false, reason: "ya_cobrado" };
  if (!ctx.stripeEnabled) return { charge: false, reason: "stripe_apagado" };
  return { charge: true };
}

/** Estados del motor que cuentan como éxito para efectos de cobro. Solo uno. */
export const BILLABLE_STATES = ["completado"] as const;

export function isBillableState(state: string): boolean {
  return (BILLABLE_STATES as readonly string[]).includes(state);
}

/**
 * ¿Este cobro ya está cobrado de verdad?
 *
 * Solo 'pagado'. Un cobro en 'pendiente' es una fila que se creó antes de
 * hablar con Stripe: si la llamada se cayó a mitad, queda sin sesión de pago.
 * Contarla como cobrada dejaría a la persona sin link para pagar y a Ork sin
 * forma de reintentar, para siempre. Y un 'fallido' o 'cancelado' tampoco
 * entró: cerrarle la puerta al reintento solo le regala el cobro a nadie.
 */
export function countsAsCharged(status: string | null | undefined): boolean {
  return status === "pagado";
}
