import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { listPilot, listComingSoon, listUndecided, listBridge, listBlocked, stalePrices, unverifiedPrices, promoPrices } from "@/lib/db/repo/services";
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
        piloto: listPilot().map((s) => s.id),
        proximamente: listComingSoon().map((s) => s.id),
        sin_mecanismo: listUndecided().map((s) => s.id),
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
      // El detector de promo compara contra estos precios. Tres formas de que
      // la comparación no sirva, y las tres se reportan por separado.
      precios: {
        // Verificados hace más de 90 días.
        rancios: stale.length,
        // Nunca verificados: amount null o needs_verification.
        sin_verificar: unverifiedPrices().map((p) => `${p.service_id}:${p.plan}`),
        // El precio de lista ES una promo, así que comparar contra él diría
        // que todo el mundo tiene promo.
        son_promo: promoPrices().map((p) => `${p.service_id}:${p.plan}`),
      },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
