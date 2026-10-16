import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { findByEmail, paydays } from "@/lib/db/repo/users";
import { getService } from "@/lib/db/repo/services";
import { bestDayAfterPayday } from "@/lib/orchestrator";
import { sendRescue } from "@/lib/mailer";
import { track } from "@/lib/db/repo/events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Un comercio avisa a Ork que no pudo cobrarle a alguien.
//
// POR QUÉ ESTE ENDPOINT Y NO EL WEBHOOK DE STRIPE:
// el dinero de la suscripción nunca pasa por Ork — esa es la premisa entera del
// producto. Así que `invoice.payment_failed` en la cuenta de Stripe de Ork solo
// puede hablar de lo que Ork cobra (su fee y su Premium), nunca del cobro de
// Spotify o de un comercio. El aviso de que falló el cobro del comercio solo
// puede venir del comercio. Eso es esto.
//
// Se firma igual que Stripe firma los suyos: HMAC del cuerpo crudo con un
// secreto compartido, y con la hora dentro de la firma para que un mensaje
// viejo no se pueda reenviar.

const TOLERANCIA_SEGUNDOS = 300;

function firmaValida(raw: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const partes = Object.fromEntries(
    header.split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const ts = Number(partes.t);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() / 1000 - ts) > TOLERANCIA_SEGUNDOS) return false;

  const esperado = createHmac("sha256", secret).update(`${ts}.${raw}`).digest();
  let recibido: Buffer;
  try {
    recibido = Buffer.from(partes.v1 ?? "", "hex");
  } catch {
    return false;
  }
  if (recibido.length !== esperado.length) return false;
  return timingSafeEqual(recibido, esperado);
}

export async function POST(req: NextRequest) {
  const secret = process.env.MERCHANT_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "Falta MERCHANT_WEBHOOK_SECRET." },
      { status: 503 },
    );
  }

  const raw = await req.text();
  if (!firmaValida(raw, req.headers.get("ork-signature"), secret)) {
    return NextResponse.json({ ok: false, error: "Firma inválida." }, { status: 400 });
  }

  let body: { email?: string; serviceId?: string; amount?: number; currency?: string };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: "Cuerpo inválido." }, { status: 400 });
  }

  const email = (body.email ?? "").trim().toLowerCase();
  const user = email ? findByEmail(email) : undefined;
  const service = body.serviceId ? getService(body.serviceId) : undefined;

  // Se responde 200 aunque no se conozca a la persona: un 404 aquí le diría al
  // comercio quién tiene cuenta en Ork y quién no, y eso no es asunto suyo.
  if (!user || !service) {
    return NextResponse.json({ ok: true, enviado: false });
  }

  // El día que se sugiere sale de SUS quincenas, no de un default bonito.
  let suggestedDay: number | null = null;
  try {
    const dias = paydays(user);
    if (dias.length > 0) suggestedDay = bestDayAfterPayday(dias);
  } catch {
    suggestedDay = null;
  }

  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3001";
  const r = await sendRescue({
    to: user.email,
    serviceName: service.name,
    amount: body.amount ?? null,
    currency: body.currency ?? "MXN",
    suggestedDay,
    orchestrateUrl: suggestedDay
      ? `${base}/orquestar/${service.id}?dia=${suggestedDay}`
      : `${base}/orquestar/${service.id}`,
  });

  track({
    type: "rescue.sent",
    userId: user.id,
    serviceId: service.id,
    severity: r.ok ? "info" : "warn",
    payload: { enviado: r.ok, modo: r.mode, diaSugerido: suggestedDay, error: r.error },
  });

  return NextResponse.json({ ok: true, enviado: r.ok, modo: r.mode });
}
