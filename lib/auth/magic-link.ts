import "server-only";
import { db, now, sha256 } from "@/lib/db";
import { buildToken, verifyToken, safeRedirect } from "./token";

// Magic link sin contraseña.
//
// La lógica de firmar y verificar vive en ./token.ts (pura, probada). Aquí solo
// queda lo que necesita la base: que un token no se pueda usar dos veces.
//
// Lo que NUNCA se guarda es el token crudo. En la tabla vive su SHA-256, igual
// que una contraseña. Si alguien se lleva la base, no puede iniciar sesión.

const TTL_MINUTES = 15;
const TTL_MS = TTL_MINUTES * 60_000;

function secret(): string {
  const s = process.env.ORK_SECRET;
  if (!s || s.length < 16) {
    throw new Error(
      "Falta ORK_SECRET (mínimo 16 caracteres). Genera uno con:\n" +
        '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  return s;
}

export function createToken(email: string, redirectTo: string): { token: string; expiresAt: string } {
  const { token, payload } = buildToken(email, redirectTo, secret(), TTL_MS);

  db()
    .prepare(
      `INSERT INTO magic_tokens (token_hash, email, created_at, expires_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(sha256(token), payload.e, now(), new Date(payload.x).toISOString());

  return { token, expiresAt: new Date(payload.x).toISOString() };
}

export type RedeemResult =
  | { ok: true; email: string; redirectTo: string }
  | { ok: false; reason: "invalido" | "expirado" | "usado" };

/** Canjea el token. Un token solo sirve una vez: el segundo intento falla. */
export function redeemToken(token: string, ip?: string): RedeemResult {
  const v = verifyToken(token, secret());
  if (!v.ok) return { ok: false, reason: v.reason };

  // Un solo uso. El UPDATE condicional es la parte atómica: si otra petición
  // llegó primero, `changes` viene en 0 y este canje pierde.
  const hash = sha256(token);
  const res = db()
    .prepare(
      `UPDATE magic_tokens SET used_at = ?, ip = ?
       WHERE token_hash = ? AND used_at IS NULL`,
    )
    .run(now(), ip ?? null, hash);

  if (res.changes === 0) {
    const exists = db()
      .prepare<[string], { used_at: string | null }>(
        "SELECT used_at FROM magic_tokens WHERE token_hash = ?",
      )
      .get(hash);
    return { ok: false, reason: exists ? "usado" : "invalido" };
  }

  return { ok: true, email: v.payload.e, redirectTo: safeRedirect(v.payload.r) };
}

/** Limpieza de tokens vencidos. Se puede llamar sin miedo en cada envío. */
export function purgeExpired(): number {
  return db()
    .prepare("DELETE FROM magic_tokens WHERE expires_at < ?")
    .run(new Date(Date.now() - 86_400_000).toISOString()).changes;
}

export { safeRedirect };
export const MAGIC_TTL_MINUTES = TTL_MINUTES;
