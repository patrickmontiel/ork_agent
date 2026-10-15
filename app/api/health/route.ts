import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { listClosed, listUnverified, listBridge, listBlocked, stalePrices } from "@/lib/db/repo/services";
import { status as pilotStatus } from "@/lib/db/repo/pilot";

export const dynamic = "force-dynamic";

// Estado del sistema. Sirve para verificar que la base arrancó y migró, y para
// ver de un vistazo si los adaptadores reales están vivos.
// No expone datos de ningún usuario.

export async function GET() {
  try {
    const d = db();
    const tables = d
      .prepare<[], { n: number }>(
        "SELECT COUNT(*) n FROM sqlite_master WHERE type = 'table'",
      )
      .get()!.n;

    const pilot = pilotStatus();
    const stale = stalePrices();

    return NextResponse.json({
      ok: true,
      db: { path: process.env.DATABASE_PATH ?? "./ork.db", tables },
      catalogo: {
        protagonistas: listClosed().map((s) => s.id),
        por_verificar: listUnverified().map((s) => s.id),
        puente: listBridge().map((s) => s.id),
        no_editables: listBlocked().map((s) => s.id),
      },
      piloto: {
        adaptadores_vivos: pilot.live,
        modo_entorno: pilot.envMode,
        bloqueado_por: pilot.blockedBy,
        apagado_en: pilot.killedAt,
        motivo: pilot.killReason,
      },
      // El detector de promo compara contra estos precios: si están rancios,
      // la comparación deja de ser confiable.
      precios_sin_verificar: stale.length,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
