import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/session";
import { getService, priceUsability } from "@/lib/db/repo/services";
import { getUserService, applyNewDate } from "@/lib/db/repo/user-services";
import { requireMandate } from "@/lib/mandate/guard";
import { getAdapter, hasAdapter, retryMax } from "@/lib/adapters/registry";
import { kill } from "@/lib/db/repo/pilot";
import { computeTradeoff, type TradeoffOption } from "@/lib/pilot/tradeoff";
import { detectPromo, promoLost } from "@/lib/pilot/promo";
import { runOrchestration } from "@/lib/pilot/run";
import * as orch from "@/lib/db/repo/orchestrations";
import { todayCDMX } from "@/lib/db";
import { chargeFeeAfterSuccess } from "@/lib/billing/fee";
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

  const result = await runOrchestration({
    adapter,
    tradeoff,
    chosen,
    targetDay: row.to_day!,
    retryMax: retryMax(),
    retryDelayMs: 0,
  });

  orch.finish(row.id, result, result.priorState);

  // Una cuenta restringida apaga el piloto entero, no solo esta corrida.
  if (result.accountRestricted) {
    kill(`${service.name} restringió la cuenta de un usuario durante una orquestación`, {
      userId: user.id,
      serviceId: service.id,
      orchestrationId: row.id,
    });
  }

  const exito = result.state === "completado";

  // Solo se escribe la fecha nueva si de verdad quedó movida y verificada.
  if (exito && row.user_service_id && result.finalState?.periodEnd) {
    applyNewDate(row.user_service_id, row.to_day!, result.finalState.periodEnd);
  }

  // El fee se cobra SOLO tras un éxito verificado. Si Ork no movió la fecha,
  // Ork no cobra — y "la API no falló" no cuenta como haberla movido.
  // Que el cobro falle nunca invalida una orquestación que sí funcionó: por eso
  // va al final y su error no tumba la respuesta.
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
    eventos: result.events.map((e) => ({ tipo: e.type, mensaje: e.message })),
    cobro,
  });
}
