// Cliente de Reap Agentic Payments. SOLO servidor: la API key nunca llega al navegador ni a los logs.
import "server-only";
import { randomUUID } from "crypto";

const BASE = process.env.REAP_BASE_URL || "https://sg.sandbox.api.reap.global";
const VERSION = process.env.REAP_VERSION || "2025-02-14";

export class ReapError extends Error {
  constructor(public status: number, public code: string, message: string, public body?: unknown) {
    super(message);
  }
}

interface CallOpts {
  method?: "GET" | "POST";
  body?: unknown;
  idempotent?: boolean; // añade Idempotency-Key nuevo en cada intento
  simulateCheckout?: boolean;
  timeoutMs?: number;
  retries?: number;
}

export async function reap<T = any>(path: string, opts: CallOpts = {}): Promise<T> {
  const key = process.env.REAP_API_KEY;
  if (!key) throw new ReapError(500, "NO_API_KEY", "Falta REAP_API_KEY en .env");
  const { method = "GET", body, idempotent, simulateCheckout, timeoutMs = 90_000, retries = 2 } = opts;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${key}`,
      "Reap-Version": VERSION,
    };
    if (method === "POST") headers["Content-Type"] = "application/json";
    // Idempotency-Key NUEVO por intento: reusar uno repite la respuesta (posiblemente de error) cacheada.
    if (idempotent) headers["Idempotency-Key"] = randomUUID();
    if (simulateCheckout) headers["X-Simulate-Checkout"] = "COMPLETED";

    try {
      const res = await fetch(BASE + path, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
      const text = await res.text();
      let json: any = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 300) }; }
      if (res.ok) return json as T;
      const code = json?.code || json?.error?.code || `HTTP_${res.status}`;
      const msg = json?.message || json?.error?.message || `Reap respondió ${res.status}`;
      const err = new ReapError(res.status, code, msg, json);
      // Reintenta solo errores transitorios conocidos del sandbox.
      const retryable = res.status === 503 || res.status === 502 || res.status === 429 || code === "AGENTIC_REQUEST_REJECTED";
      if (!retryable || attempt === retries) throw err;
      lastErr = err;
    } catch (e) {
      if (e instanceof ReapError && !(e.status >= 500 || e.code === "AGENTIC_REQUEST_REJECTED")) throw e;
      lastErr = e;
      if (attempt === retries) break;
    }
    await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
  }
  if (lastErr instanceof ReapError) throw lastErr;
  throw new ReapError(504, "NETWORK", lastErr instanceof Error ? lastErr.message : "Error de red con Reap");
}

export const DEMO_OWNER = { type: "CLIENT_REFERENCE", id: "ork-hackathon-user", email: "avery.tan@reap.hk" };

export const DEMO_ADDRESS = {
  firstName: "Avery",
  lastName: "Tan",
  phone: "+14155550132",
  addressLine1: "1600 Amphitheatre Parkway",
  city: "Mountain View",
  region: "CA",
  postalCode: "94043",
  country: "US",
};

export function createEnrollment(returnUrl: string) {
  return reap("/agentic/enrollments", {
    method: "POST",
    idempotent: true,
    body: { source: "EXTERNAL", owner: DEMO_OWNER, presentation: { type: "REDIRECT", returnUrl } },
  });
}

export function getEnrollment(id: string) {
  return reap(`/agentic/enrollments/${id}`);
}

export function listEnrollments() {
  return reap(`/agentic/enrollments?ownerId=${encodeURIComponent(DEMO_OWNER.id)}`);
}

export function searchProducts(query: string, merchantName: string) {
  return reap("/agentic/products/search", {
    method: "POST",
    body: { query, context: { country: "US", currency: "USD" }, merchantPreference: { mode: "ONLY", merchantName }, pagination: { limit: 3 } },
  });
}

export function createQuote(variantId: string, quantity = 1) {
  return reap("/agentic/quotes", {
    method: "POST",
    idempotent: true,
    timeoutMs: 75_000,
    body: { items: [{ variantId, quantity }], email: DEMO_OWNER.email, shippingAddress: DEMO_ADDRESS },
  });
}

export function createCheckout(quoteId: string, enrollmentId: string, returnUrl: string) {
  return reap("/agentic/checkouts", {
    method: "POST",
    idempotent: true,
    simulateCheckout: true,
    retries: 1,
    body: { quoteId, enrollmentId, presentation: { type: "REDIRECT", returnUrl } },
  });
}

export function getCheckout(id: string) {
  return reap(`/agentic/checkouts/${id}`);
}
