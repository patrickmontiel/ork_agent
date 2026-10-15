// Lógica pura del token del magic link: firmar, verificar y acotar el redirect.
//
// Vive aparte de magic-link.ts (que sí toca la base y lleva "server-only") para
// que se pueda probar. Lo que se prueba aquí es lo que, si falla, deja entrar a
// quien no debe: firma manipulada, token vencido, redirect a otro dominio.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export interface TokenPayload {
  e: string; // email
  r: string; // ruta de retorno
  n: string; // nonce
  x: number; // expira (epoch ms)
}

export type VerifyResult =
  | { ok: true; payload: TokenPayload }
  | { ok: false; reason: "invalido" | "expirado" };

function b64url(b: Buffer): string {
  return b.toString("base64url");
}

export function signPart(data: string, secret: string): string {
  return b64url(createHmac("sha256", secret).update(data).digest());
}

function sameSignature(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Solo rutas internas. Sin esto, un link con `?redirect=https://sitio-falso.mx`
 * llevaría al usuario ahí ya con la sesión abierta.
 *
 * Se rechaza: otro origen, protocol-relative (//host), backslash (algunos
 * navegadores lo normalizan a /), y saltos de línea (inyección de cabecera).
 */
export function safeRedirect(r: string | null | undefined, fallback = "/pay"): string {
  if (!r) return fallback;
  if (/[\r\n\t]/.test(r)) return fallback;
  if (!r.startsWith("/")) return fallback;
  if (r.startsWith("//")) return fallback;
  if (r.startsWith("/\\") || r.startsWith("/%2F") || r.startsWith("/%5C")) return fallback;
  return r;
}

export function buildToken(
  email: string,
  redirectTo: string,
  secret: string,
  ttlMs: number,
  nowMs = Date.now(),
): { token: string; payload: TokenPayload } {
  const payload: TokenPayload = {
    e: email.trim().toLowerCase(),
    r: safeRedirect(redirectTo),
    n: b64url(randomBytes(9)),
    x: nowMs + ttlMs,
  };
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  return { token: `${body}.${signPart(body, secret)}`, payload };
}

export function verifyToken(token: string, secret: string, nowMs = Date.now()): VerifyResult {
  const i = token.indexOf(".");
  if (i < 1 || i === token.length - 1) return { ok: false, reason: "invalido" };
  const body = token.slice(0, i);
  const sig = token.slice(i + 1);

  if (!sameSignature(sig, signPart(body, secret))) return { ok: false, reason: "invalido" };

  let payload: TokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "invalido" };
  }

  if (!payload || typeof payload.e !== "string" || typeof payload.x !== "number") {
    return { ok: false, reason: "invalido" };
  }
  if (nowMs > payload.x) return { ok: false, reason: "expirado" };

  return { ok: true, payload };
}
