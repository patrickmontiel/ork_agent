import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/session";
import { getService } from "@/lib/db/repo/services";
import { applyNewDate } from "@/lib/db/repo/user-services";
import { getAdapter, retryMax } from "@/lib/adapters/registry";
import { kill } from "@/lib/db/repo/pilot";
import { runResubscribePhase, runUndo } from "@/lib/pilot/run";
import * as orch from "@/lib/db/repo/orchestrations";
import { chargeFeeAfterSuccess } from "@/lib/billing/fee";
import { track } from "@/lib/db/repo/events";
import { todayCDMX } from "@/lib/db";
import type { ServiceState } from "@/lib/adapters/types";

export const dynamic = "force-dynamic";

// FASE 2 — el recontrato, días después de haber cancelado.
//
// Aquí sí termina la operación, así que aquí —y solo aquí— se cobra el fee.
// Cobrar en la fase 1 habría sido cobrar por haber dejado a alguien sin
// servicio.
//
// DELETE en esta misma ruta es "deshacer", y solo funciona mientras no venza
// el periodo pagado.

/** POST — recontrata y verifica. */
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Necesitas iniciar sesión." }, { status: 401 });
  }

  let body: { orchestrationId?: string; scenario?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Cuerpo inválido." }, { status: 400 });
  }

  const row = body.orchestrationId ? orch.get(body.orchestrationId, user.id) : undefined;
  if (!row) {
    return NextResponse.json({ ok: false, error: "Esa operación no existe." }, { status: 404 });
  }
  if (row.state !== "esperando_recontrato") {
    return NextResponse.json(
      {
        ok: false,
        error:
          row.state === "abandonado"
            ? "Pasó demasiado tiempo. Empieza de nuevo para ver fechas y números frescos."
            : "Esta operación no está esperando un recontrato.",
        estado: row.state,
      },
      { status: 409 },
    );
  }

  const service = getService(row.service_id)!;
  const { adapter } = getAdapter({ serviceId: row.service_id, scenario: body.scenario as never });
  const prior = row.prior_state_json
    ? (JSON.parse(row.prior_state_json) as ServiceState)
    : null;

  const result = await runResubscribePhase({
    adapter,
    resubDate: row.to_date ?? todayCDMX(),
    targetDay: row.to_day!,
    plan: prior?.plan ?? null,
    expectedAmount: prior?.paidAmount ?? null,
    retryMax: retryMax(),
    retryDelayMs: 0,
  });

  orch.finishPhase2(
    row.id,
    result.state,
    result.retries,
    result.state === "completado" ? null : result.userMessage,
  );

  if (result.accountRestricted) {
    kill(`${service.name} restringió la cuenta durante el recontrato`, {
      userId: user.id,
      serviceId: service.id,
      orchestrationId: row.id,
    });
  }

  // El corte de servicio se cuenta aquí: si el recontrato falló, la persona
  // está fuera y Ork no supo devolvérselo.
  if (result.serviceGap) {
    track({
      type: "pilot.service_gap",
      userId: user.id,
      serviceId: service.id,
      orchestrationId: row.id,
      severity: "critical",
      payload: { estado: result.state, retries: result.retries },
    });
  }

  const exito = result.state === "completado";

  if (exito && row.user_service_id && result.finalState?.periodEnd) {
    applyNewDate(row.user_service_id, row.to_day!, result.finalState.periodEnd);
  }

  // AHORA sí: éxito verificado, fee cobrable. Que el cobro falle no invalida
  // una orquestación que sí funcionó, por eso va al final y envuelto.
  let cobro: { url: string; monto: number; moneda: string } | null = null;
  try {
    const fee = await chargeFeeAfterSuccess(user, row.id, exito);
    if (fee.charged) cobro = { url: fee.checkoutUrl, monto: fee.amount, moneda: fee.currency };
  } catch (e) {
    track({
      type: "fee.skipped",
      userId: user.id,
      orchestrationId: row.id,
      severity: "warn",
      payload: { motivo: e instanceof Error ? e.message : String(e) },
    });
  }

  return NextResponse.json({
    ok: exito,
    estado: result.state,
    mensaje: result.userMessage,
    pasosManuales: result.manualSteps ?? null,
    reintentos: result.retries,
    cuentaRestringida: result.accountRestricted,
    seQuedoSinServicio: result.serviceGap,
    eventos: result.events.map((e) => ({ tipo: e.type, mensaje: e.message })),
    cobro,
  });
}

/** DELETE — deshacer, mientras el periodo pagado no haya vencido. */
export async function DELETE(req: NextRequest) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Necesitas iniciar sesión." }, { status: 401 });
  }

  let body: { orchestrationId?: string; scenario?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Cuerpo inválido." }, { status: 400 });
  }

  const row = body.orchestrationId ? orch.get(body.orchestrationId, user.id) : undefined;
  if (!row) {
    return NextResponse.json({ ok: false, error: "Esa operación no existe." }, { status: 404 });
  }
  if (row.state !== "esperando_recontrato") {
    return NextResponse.json(
      { ok: false, error: "Esta operación no se puede deshacer." },
      { status: 409 },
    );
  }

  // La ventana es exactamente el periodo que ya pagó. Pasada esa fecha, la
  // fecha de cobro original se perdió y reactivar ya no la trae de vuelta.
  const hoy = todayCDMX();
  if (!row.undo_deadline || hoy > row.undo_deadline) {
    return NextResponse.json(
      {
        ok: false,
        error: `Ya no se puede deshacer: tu periodo pagado venció el ${row.undo_deadline ?? "—"}. Lo que sí puedes es volver a contratar cuando quieras.`,
        ventanaCerrada: true,
      },
      { status: 409 },
    );
  }

  const prior = row.prior_state_json
    ? (JSON.parse(row.prior_state_json) as ServiceState)
    : null;
  if (!prior) {
    return NextResponse.json(
      { ok: false, error: "No tenemos el estado anterior, así que no vamos a adivinar." },
      { status: 422 },
    );
  }

  const { adapter } = getAdapter({ serviceId: row.service_id, scenario: body.scenario as never });
  const r = await runUndo(adapter, prior);

  if (!r.ok) {
    return NextResponse.json({ ok: false, error: r.message }, { status: 502 });
  }

  orch.finishPhase2(row.id, "deshecho", 0, null);
  track({
    type: "orchestration.undone",
    userId: user.id,
    serviceId: row.service_id,
    orchestrationId: row.id,
    payload: { fechaRestaurada: prior.billingDay },
  });

  return NextResponse.json({ ok: true, mensaje: r.message });
}
