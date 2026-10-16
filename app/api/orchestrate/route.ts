import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/session";
import { getService, priceUsability } from "@/lib/db/repo/services";
import { getUserService } from "@/lib/db/repo/user-services";
import { requireMandate } from "@/lib/mandate/guard";
import { getAdapter, hasAdapter } from "@/lib/adapters/registry";
import { kill } from "@/lib/db/repo/pilot";
import { computeTradeoff, type TradeoffOption } from "@/lib/pilot/tradeoff";
import { detectPromo, promoLost } from "@/lib/pilot/promo";
import { runCancelPhase } from "@/lib/pilot/run";
import { planSupport } from "@/lib/pilot/plan-support";
import * as orch from "@/lib/db/repo/orchestrations";
import { todayCDMX } from "@/lib/db";
import { track } from "@/lib/db/repo/events";

export const dynamic = "force-dynamic";

// Orquestar. DOS puertas, las dos obligatorias:
//
//   1. Mandato vigente — permiso general, firmado una vez (Fase 2).
//   2. Confirmación de ESTE evento, con el trade-off en números delante.
//
// El silencio no es consentimiento: una corrida sin confirmar expira a los 15
// minutos y no ejecuta nada.

/** POST /api/orchestrate — paso 1: calcula el trade-off y registra la intención. */
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Necesitas iniciar sesión." }, { status: 401 });
  }

  let body: { serviceId?: string; targetDay?: number; scenario?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Cuerpo inválido." }, { status: 400 });
  }

  const service = body.serviceId ? getService(body.serviceId) : undefined;
  if (!service) {
    return NextResponse.json({ ok: false, error: "Ese servicio no existe." }, { status: 404 });
  }
  if (!hasAdapter(service.id)) {
    return NextResponse.json(
      { ok: false, error: `${service.name} todavía no está listo. Te avisamos cuando lo esté.` },
      { status: 422 },
    );
  }

  const targetDay = Number(body.targetDay);
  if (!Number.isInteger(targetDay) || !((targetDay >= 1 && targetDay <= 28) || targetDay === 32)) {
    return NextResponse.json(
      { ok: false, error: "Elige un día del 1 al 28, o el último del mes." },
      { status: 400 },
    );
  }

  // ── Puerta 1: mandato ───────────────────────────────────────────────────
  const action = service.orchestrable === "pause" ? "pause" : "cancel_resubscribe";
  const check = requireMandate(user.id, service.id, action);
  if (!check.ok) {
    return NextResponse.json(
      { ok: false, error: check.message, necesitaMandato: check.reason === "sin_mandato" || check.reason === "texto_cambio" },
      { status: 403 },
    );
  }

  // ── Estado real del servicio ────────────────────────────────────────────
  const { adapter, mode, degradedBecause } = getAdapter({
    serviceId: service.id,
    scenario: body.scenario as never,
  });

  const state = await adapter.getState();

  if (state.status === "restringida") {
    kill(`${service.name} restringió la cuenta de un usuario`, {
      userId: user.id,
      serviceId: service.id,
    });
    return NextResponse.json(
      { ok: false, error: `${service.name} restringió esta cuenta. Ork no va a tocar nada.` },
      { status: 409 },
    );
  }

  if (!state.periodEnd) {
    return NextResponse.json(
      { ok: false, error: "No pudimos leer cuándo termina tu periodo pagado, así que no vamos a mover nada." },
      { status: 422 },
    );
  }

  // ── Reja de plan ────────────────────────────────────────────────────────
  // Spotify es orquestable, pero un plan Duo o Family no: cancelarlo deja sin
  // servicio a una segunda persona que nunca firmó nada con Ork. Esto va antes
  // del trade-off para que ni siquiera se le muestren números a alguien a quien
  // no le vamos a dejar seguir.
  const soporte = planSupport(state.plan);
  if (!soporte.supported) {
    track({
      type: "fee.skipped",
      userId: user.id,
      serviceId: service.id,
      severity: "warn",
      payload: { motivo: "plan no soportado", razon: soporte.reason, plan: state.plan },
    });
    return NextResponse.json(
      { ok: false, error: soporte.message, planNoSoportado: true, razon: soporte.reason },
      { status: 422 },
    );
  }

  // ── Promo ───────────────────────────────────────────────────────────────
  const price = state.plan
    ? priceUsability(service.id, state.plan)
    : ({ usable: false, reason: "no_existe" } as const);
  const promo = detectPromo(state.paidAmount, price);
  const pierdePromo = promoLost(promo) && action === "cancel_resubscribe";

  // ── Trade-off ───────────────────────────────────────────────────────────
  const tradeoff = computeTradeoff({
    periodEnd: state.periodEnd,
    targetDay,
    monthlyAmount: state.paidAmount ?? 0,
    currency: state.currency,
    today: todayCDMX(),
    losesPromo: pierdePromo,
    // Lo decide el adaptador, no la UI: es una propiedad del servicio real.
    allowEarlyResubscribe: !adapter.earlyResubscribeKeepsOldDate,
  });

  const us = getUserService(user.id, service.id);
  const row = orch.create({
    userId: user.id,
    serviceId: service.id,
    userServiceId: us?.id,
    mandateId: check.mandate.id,
    tradeoff,
    fromDay: state.billingDay,
    toDay: targetDay,
    hadPromo: promo.known && promo.hasPromo,
    adapterMode: mode,
  });

  return NextResponse.json({
    ok: true,
    orquestacion: { id: row.id, expiraEn: row.confirm_deadline },
    serviceName: service.name,
    emoji: service.emoji ?? "",
    estadoActual: {
      diaActual: state.billingDay,
      finPeriodoPagado: state.periodEnd,
      plan: state.plan,
      pagas: state.paidAmount,
      moneda: state.currency,
    },
    tradeoff,
    promo,
    // Honestidad sobre qué se está ejecutando. La UI lo muestra.
    modo: mode,
    aviso: degradedBecause,
  });
}

/** PUT /api/orchestrate — paso 2: la persona confirma, y recién entonces se ejecuta. */
export async function PUT(req: NextRequest) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Necesitas iniciar sesión." }, { status: 401 });
  }

  let body: { orchestrationId?: string; option?: "esperar" | "adelantar"; scenario?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Cuerpo inválido." }, { status: 400 });
  }

  const row = body.orchestrationId ? orch.get(body.orchestrationId, user.id) : undefined;
  if (!row) {
    return NextResponse.json({ ok: false, error: "Esa operación no existe." }, { status: 404 });
  }

  // El silencio no es consentimiento: fuera de la ventana, no se ejecuta.
  // Tres motivos distintos para no poder confirmar, y hay que decir cuál es:
  // "pasaron 15 minutos" sobre algo que YA se ejecutó es mentira.
  if (!orch.isConfirmable(row)) {
    if (row.confirmed_at || row.state !== "registrado") {
      return NextResponse.json(
        {
          ok: false,
          error: "Esta operación ya se procesó. Si quieres mover la fecha otra vez, empieza de nuevo.",
          yaProcesada: true,
          estado: row.state,
        },
        { status: 409 },
      );
    }
    orch.expire(row.id);
    return NextResponse.json(
      {
        ok: false,
        error: "Pasaron más de 15 minutos desde que te mostramos los números. Vuelve a empezar para ver cifras frescas.",
        expirado: true,
      },
      { status: 410 },
    );
  }

  const tradeoff = JSON.parse(row.tradeoff_json!) as ReturnType<typeof computeTradeoff>;
  const chosen: TradeoffOption | null =
    body.option === "adelantar" ? tradeoff.adelantar : tradeoff.esperar;

  if (!chosen) {
    return NextResponse.json({ ok: false, error: "Esa opción no está disponible." }, { status: 400 });
  }

  orch.confirm(row.id, chosen);

  const service = getService(row.service_id)!;
  const { adapter } = getAdapter({ serviceId: row.service_id, scenario: body.scenario as never });

  // FASE 1: cancelar y verificar. El recontrato NO ocurre hoy — ocurre el día
  // objetivo, y necesita a la persona presente otra vez.
  const result = await runCancelPhase({ adapter, resubDate: chosen.resubDate });

  // Una cuenta restringida apaga el piloto entero, no solo esta corrida.
  if (result.accountRestricted) {
    kill(`${service.name} restringió la cuenta de un usuario durante una orquestación`, {
      userId: user.id,
      serviceId: service.id,
      orchestrationId: row.id,
    });
  }

  const esperando = result.state === "esperando_recontrato";

  if (esperando) {
    orch.startWaiting(row.id, result.undoDeadline, result.priorState);
  } else {
    orch.finishPhase2(row.id, result.state, 0, result.userMessage);
  }

  // NO se cobra aquí. El fee se cobra solo tras un éxito VERIFICADO, y a estas
  // alturas todavía no hay éxito: falta la fase 2. Cobrar por haber cancelado
  // sería cobrar por dejar a alguien sin servicio.
  return NextResponse.json({
    ok: esperando,
    estado: result.state,
    mensaje: result.userMessage,
    pasosManuales: result.manualSteps ?? null,
    cuentaRestringida: result.accountRestricted,
    eventos: result.events.map((e) => ({ tipo: e.type, mensaje: e.message })),
    // Lo que la persona necesita saber ahora:
    esperandoRecontrato: esperando,
    puedesDeshacerHasta: result.undoDeadline,
    recontratarEl: esperando ? chosen.resubDate : null,
    cobro: null,
  });
}

/**
 * DELETE /api/orchestrate — la persona ve los números y dice que no.
 *
 * Existe para que ese "no" se pueda distinguir de un link que se venció solo.
 * Son cosas distintas: uno dice que el trade-off no compensa, el otro no dice
 * nada. Si se mezclan, Ork nunca se entera de que su oferta no vale la pena.
 */
export async function DELETE(req: NextRequest) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Necesitas iniciar sesión." }, { status: 401 });
  }

  let body: { orchestrationId?: string; motivo?: string; opcion?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Cuerpo inválido." }, { status: 400 });
  }

  const row = body.orchestrationId ? orch.get(body.orchestrationId, user.id) : undefined;
  if (!row) {
    return NextResponse.json({ ok: false, error: "Esa operación no existe." }, { status: 404 });
  }
  if (row.state !== "registrado") {
    return NextResponse.json(
      { ok: false, error: "Esta operación ya no se puede cancelar." },
      { status: 409 },
    );
  }

  const tradeoff = row.tradeoff_json
    ? (JSON.parse(row.tradeoff_json) as ReturnType<typeof computeTradeoff>)
    : undefined;

  orch.reject(row.id, body.motivo?.slice(0, 300) || "La persona decidió no mover la fecha.", {
    porDesventaja: true,
    tradeoff,
    opcion: body.opcion,
  });

  return NextResponse.json({ ok: true });
}
