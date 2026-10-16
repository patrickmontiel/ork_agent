import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/session";
import { byId } from "@/lib/db/repo/charges";
import * as orch from "@/lib/db/repo/orchestrations";
import { chargeFeeAfterSuccess } from "@/lib/billing/fee";
import { isBillableState } from "@/lib/billing/rules";

export const dynamic = "force-dynamic";

// Recupera el link de pago de un fee que quedó pendiente.
//
// Existe porque la prueba de punta a punta encontró el caso: Stripe se cayó a
// mitad de crear la sesión, la fila del cobro quedó en pendiente y sin link, y
// la persona se quedaba viendo "Pendiente de pago" sin nada que tocar.
//
// NO es un atajo para cobrar: el estado de la orquestación se vuelve a leer de
// la base aquí mismo. Si no está en 'completado', esto no cobra, y da lo mismo
// lo que mande el cliente.

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Necesitas iniciar sesión." }, { status: 401 });
  }

  let body: { chargeId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Cuerpo inválido." }, { status: 400 });
  }

  const charge = body.chargeId ? byId(body.chargeId, user.id) : undefined;
  if (!charge) {
    return NextResponse.json({ ok: false, error: "Ese cobro no existe." }, { status: 404 });
  }
  if (charge.kind !== "fee" || !charge.orchestration_id) {
    return NextResponse.json(
      { ok: false, error: "Este cobro no se paga por aquí." },
      { status: 422 },
    );
  }
  if (charge.status === "pagado") {
    return NextResponse.json({ ok: false, error: "Este cobro ya está pagado." }, { status: 409 });
  }

  // La verdad sobre si hubo éxito vive en la orquestación, no en la petición.
  const row = orch.get(charge.orchestration_id, user.id);
  if (!row || !isBillableState(row.state)) {
    return NextResponse.json(
      { ok: false, error: "Ese cambio de fecha no se completó, así que no hay nada que pagar." },
      { status: 422 },
    );
  }

  try {
    const fee = await chargeFeeAfterSuccess(user, charge.orchestration_id, true);
    if (!fee.charged) {
      return NextResponse.json({ ok: false, error: `No hay cobro pendiente (${fee.reason}).` }, { status: 409 });
    }
    return NextResponse.json({ ok: true, url: fee.checkoutUrl });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Stripe no respondió. Vuelve a intentarlo en un momento." },
      { status: 502 },
    );
  }
}
