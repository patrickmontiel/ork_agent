import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

// Puerta del admin. Un solo token compartido, por ahora: el piloto lo opera
// una persona y un login completo sería ceremonia sin beneficio.
//
// Dos cosas que sí son obligatorias aunque sea un token suelto:
//   - comparación en tiempo constante, para no filtrar el token carácter a
//     carácter con un cronómetro;
//   - sin ADMIN_TOKEN configurado, el admin está CERRADO, no abierto. Un
//     default permisivo es cómo se publican tableros internos por accidente.

export const ADMIN_COOKIE = "ork_admin";

function hash(s: string): Buffer {
  return createHash("sha256").update(s).digest();
}

export function adminConfigured(): boolean {
  return !!process.env.ADMIN_TOKEN;
}

export function tokenIsValid(candidate: string | undefined): boolean {
  const real = process.env.ADMIN_TOKEN;
  if (!real || !candidate) return false;
  // Se comparan los hashes: misma longitud siempre, así que timingSafeEqual no
  // revela nada por el tamaño del intento.
  return timingSafeEqual(hash(candidate), hash(real));
}

export function isAdmin(): boolean {
  return tokenIsValid(cookies().get(ADMIN_COOKIE)?.value);
}
