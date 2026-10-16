import "server-only";

// Rail de pago: cómo cobra Ork a la persona.
//
//   user_card → tarjeta de la persona vía Stripe Checkout. Es el default.
//   reap      → rail agéntico de Reap, el del buildathon. Se conserva porque
//               funciona y está probado, no porque sea el camino principal.
//
// La elección NO cambia nada del lado del merchant: el dinero de la suscripción
// nunca pasa por Ork en ninguno de los dos.

export type PaymentRail = "user_card" | "reap";

export function paymentRail(): PaymentRail {
  return process.env.PAYMENT_RAIL === "reap" ? "reap" : "user_card";
}

export function railIsReap(): boolean {
  return paymentRail() === "reap";
}

/** Nombre legible, para el admin y los logs. */
export function railLabel(): string {
  return railIsReap() ? "Reap (agéntico)" : "Tarjeta del usuario (Stripe)";
}
