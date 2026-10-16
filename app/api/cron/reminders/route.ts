import { NextRequest, NextResponse } from "next/server";
import { runReminderSweep } from "@/lib/pilot/reminders";
import { tokenIsValid, adminConfigured } from "@/lib/admin/auth";
import { todayCDMX } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Barrido de recordatorios de la fase 2.
//
// Pensado para que lo dispare un cron (Vercel Cron, un systemd timer, lo que
// sea) una vez al día. Es idempotente: cada aviso se marca al mandarse, así que
// correrlo varias veces el mismo día no manda nada dos veces.
//
// Protegido con ADMIN_TOKEN por cabecera. Sin token configurado, cerrado.

function autorizado(req: NextRequest): boolean {
  const h = req.headers.get("authorization") ?? "";
  const bearer = h.startsWith("Bearer ") ? h.slice(7) : undefined;
  return tokenIsValid(bearer ?? req.headers.get("x-ork-cron") ?? undefined);
}

export async function POST(req: NextRequest) {
  if (!adminConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Falta ADMIN_TOKEN. El barrido está cerrado." },
      { status: 503 },
    );
  }
  if (!autorizado(req)) {
    return NextResponse.json({ ok: false, error: "No autorizado." }, { status: 401 });
  }

  const hoy = req.nextUrl.searchParams.get("hoy") ?? todayCDMX();
  const r = await runReminderSweep(hoy);

  return NextResponse.json({ ok: true, hoy, ...r });
}
