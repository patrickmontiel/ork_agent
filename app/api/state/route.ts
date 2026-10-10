import { NextResponse } from "next/server";
import { publicState } from "@/lib/store";
import { recoverActiveEnrollment, refreshEnrollment, refreshPendingCheckouts } from "@/lib/billing";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try { await recoverActiveEnrollment(); } catch { /* sin tarjeta recuperada; el usuario puede registrar una */ }
  // ?poll=1 consulta a Reap el estado de la enrollment (polling hasta ACTIVE)
  if (new URL(req.url).searchParams.get("poll")) {
    try { await refreshEnrollment(); } catch { /* el estado anterior sigue siendo válido */ }
    try { await refreshPendingCheckouts(); } catch { /* se reintenta en el siguiente poll */ }
  }
  return NextResponse.json(publicState());
}
