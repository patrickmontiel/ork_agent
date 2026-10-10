import { NextResponse } from "next/server";
import { publicState } from "@/lib/store";
import { refreshEnrollment } from "@/lib/billing";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // ?poll=1 consulta a Reap el estado de la enrollment (polling hasta ACTIVE)
  if (new URL(req.url).searchParams.get("poll")) {
    try { await refreshEnrollment(); } catch { /* el estado anterior sigue siendo válido */ }
  }
  return NextResponse.json(publicState());
}
