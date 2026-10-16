import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/session";
import { getService } from "@/lib/db/repo/services";
import { connect } from "@/lib/db/repo/user-services";
import { track } from "@/lib/db/repo/events";

export const dynamic = "force-dynamic";

// Guarda qué servicio y qué día quiere la persona.
//
// Esto NO mueve nada. Registrar la intención y ejecutarla son dos cosas
// distintas a propósito: mover la fecha de un servicio cerrado exige mandato
// vigente (Fase 2) y confirmación explícita del evento con el trade-off en
// números (Fase 3). El silencio no es consentimiento, y guardar una preferencia
// tampoco lo es.

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Necesitas iniciar sesión." }, { status: 401 });
  }

  let body: { serviceId?: string; desiredDay?: number; plan?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Cuerpo inválido." }, { status: 400 });
  }

  const service = body.serviceId ? getService(body.serviceId) : undefined;
  if (!service) {
    return NextResponse.json({ ok: false, error: "Ese servicio no existe." }, { status: 404 });
  }

  if (!service.editable) {
    return NextResponse.json(
      {
        ok: false,
        error: service.blocked_reason ?? "Ese servicio no se puede mover.",
        bloqueado: true,
      },
      { status: 422 },
    );
  }

  const day = Number(body.desiredDay);
  // 32 es la convención interna para "último día del mes": existe en todos los
  // meses, a diferencia del 29, 30 y 31.
  const valido = Number.isInteger(day) && ((day >= 1 && day <= 28) || day === 32);
  if (!valido) {
    return NextResponse.json(
      { ok: false, error: "Elige un día del 1 al 28, o el último día del mes." },
      { status: 400 },
    );
  }

  const row = connect({
    userId: user.id,
    serviceId: service.id,
    plan: body.plan,
    desiredDay: day,
  });

  track({
    type: "orchestration.started",
    userId: user.id,
    serviceId: service.id,
    payload: { desiredDay: day, etapa: "intencion_guardada", rol: service.role },
  });

  return NextResponse.json({
    ok: true,
    suscripcion: { id: row.id, serviceId: service.id, diaDeseado: day },
    // Lo que falta antes de tocar nada. La UI lo dice tal cual.
    siguiente:
      service.role === "cerrado"
        ? "mandato"       // Fase 2
        : "listo",        // puente: el comercio cobra, no hace falta mandato
  });
}
