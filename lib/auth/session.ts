import "server-only";
import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";
import { findById } from "@/lib/db/repo/users";
import type { UserRow } from "@/lib/db/types";

// Sesión en cookie firmada. Sin base de sesiones: la cookie lleva el userId y
// su firma, y se valida contra el usuario en cada lectura.
//
// La cookie es httpOnly (JavaScript no la ve), sameSite=lax (sobrevive al
// regreso del magic link desde el correo, pero no viaja en peticiones
// cross-site) y secure en producción.

const COOKIE = "ork_session";
const MAX_AGE_DAYS = 30;

function secret(): string {
  const s = process.env.ORK_SECRET;
  if (!s || s.length < 16) throw new Error("Falta ORK_SECRET (mínimo 16 caracteres).");
  return s;
}

function sign(v: string): string {
  return createHmac("sha256", secret()).update(v).digest("base64url");
}

function verify(value: string): string | null {
  const i = value.lastIndexOf(".");
  if (i < 1) return null;
  const body = value.slice(0, i);
  const sig = value.slice(i + 1);
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return body;
}

export async function createSession(userId: string): Promise<void> {
  const value = `${userId}.${sign(userId)}`;
  (await cookies()).set(COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_DAYS * 86_400,
  });
}

export async function destroySession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

/** userId de la sesión vigente, o null. No toca la base. */
export async function sessionUserId(): Promise<string | null> {
  const c = (await cookies()).get(COOKIE)?.value;
  if (!c) return null;
  return verify(c);
}

/** Usuario completo de la sesión vigente, o null si la cookie ya no corresponde a nadie. */
export async function currentUser(): Promise<UserRow | null> {
  const id = await sessionUserId();
  if (!id) return null;
  return findById(id) ?? null;
}
