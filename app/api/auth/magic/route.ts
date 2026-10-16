import { NextRequest, NextResponse } from "next/server";
import { createToken, redeemToken, purgeExpired, safeRedirect, MAGIC_TTL_MINUTES } from "@/lib/auth/magic-link";
import { createSession } from "@/lib/auth/session";
import { upsertByEmail } from "@/lib/db/repo/users";
import { sendMagicLink } from "@/lib/mailer";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function baseUrl(req: NextRequest): string {
  return process.env.NEXT_PUBLIC_BASE_URL ?? req.nextUrl.origin;
}

function clientIp(req: NextRequest): string | undefined {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    undefined
  );
}

/** POST — pide el link. Responde igual exista o no la cuenta. */
export async function POST(req: NextRequest) {
  let body: { email?: string; redirectTo?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Cuerpo inválido." }, { status: 400 });
  }

  const email = (body.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json(
      { ok: false, error: "Revisa tu correo: parece que falta algo." },
      { status: 400 },
    );
  }

  purgeExpired();

  const { token } = createToken(email, safeRedirect(body.redirectTo));
  const url = `${baseUrl(req)}/api/auth/magic?token=${encodeURIComponent(token)}`;
  const sent = await sendMagicLink(email, url);

  if (!sent.ok) {
    return NextResponse.json(
      { ok: false, error: "No pudimos enviar el correo. Inténtalo otra vez." },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    mode: sent.mode,
    expiraEnMinutos: MAGIC_TTL_MINUTES,
    // Solo en modo consola: así no hay que ir a buscar la terminal en dev.
    devUrl: sent.devUrl,
  });
}

/** GET — canjea el link y abre sesión. */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) return redirectWithError(req, "invalido");

  const result = redeemToken(token, clientIp(req));
  if (!result.ok) return redirectWithError(req, result.reason);

  const user = upsertByEmail(result.email);
  await createSession(user.id);

  return NextResponse.redirect(new URL(result.redirectTo, baseUrl(req)));
}

function redirectWithError(req: NextRequest, reason: "invalido" | "expirado" | "usado") {
  const url = new URL("/pay", baseUrl(req));
  url.searchParams.set("link", reason);
  return NextResponse.redirect(url);
}
