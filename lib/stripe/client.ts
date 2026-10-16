import "server-only";
import Stripe from "stripe";

// Cliente de Stripe.
//
// Sin pin de apiVersion a propósito: usa la versión de la cuenta, que es la
// que correría en producción. Pinar una vieja hace que las pruebas mientan.

const g = globalThis as unknown as { __orkStripe?: Stripe };

export function stripeEnabled(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

/** True solo si la llave es de prueba. El piloto no cobra de verdad. */
export function stripeIsTestMode(): boolean {
  return (process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_test_");
}

export function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "Falta STRIPE_SECRET_KEY. Ponla en .env (modo prueba: empieza con sk_test_).",
    );
  }
  if (!g.__orkStripe) {
    g.__orkStripe = new Stripe(key, {
      // Identifica a Ork en el dashboard de Stripe y en los logs de soporte.
      appInfo: { name: "Ork", version: "2.0.0" },
      maxNetworkRetries: 2,
    });
  }
  return g.__orkStripe;
}

// ─── Precios de Ork ─────────────────────────────────────────────────────────
// Configurables por entorno. En centavos al hablar con Stripe.

export function feeAmountMXN(): number {
  const n = Number(process.env.ORK_FEE_MXN);
  return Number.isFinite(n) && n > 0 ? n : 25;
}

export function premiumAmountMXN(): number {
  const n = Number(process.env.ORK_PREMIUM_MXN);
  return Number.isFinite(n) && n > 0 ? n : 99;
}

/** Stripe habla en la unidad mínima: centavos para MXN. */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

export function baseUrl(): string {
  return process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3001";
}
