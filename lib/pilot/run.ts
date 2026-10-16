import type { ClosedServiceAdapter, ServiceState } from "../adapters/types.ts";
import type { Tradeoff, TradeoffOption } from "./tradeoff.ts";

// Motor de orquestación.
//
// Sin dependencias de base ni de Next: recibe un adaptador y emite eventos.
// Quien lo llama decide qué persistir. Así se prueba entero contra el mock.
//
// LAS TRES REGLAS QUE GOBIERNAN ESTE ARCHIVO
//
// 1. Un `ok` no es evidencia. Después de cada mutación se RELEE el estado y se
//    compara. El escenario "exito_silencioso" del mock existe justo para que
//    esta regla tenga un test que la defienda.
//
// 2. Si falla la cancelación, no hay nada que revertir: nada cambió. Si falla
//    el recontrato, la persona quedó sin servicio y eso SÍ es un incidente —
//    se reintenta, y si no, se avisa con instrucciones manuales.
//
// 3. Una cuenta restringida detiene todo y apaga el piloto. No se reintenta.

export type RunState =
  | "registrado"
  | "cancelado"
  | "verificado_cancelacion"
  | "recontratado"
  | "verificado_recontrato"
  | "completado"
  | "rechazado"
  | "expirado"
  | "sin_cambios"
  | "incidente";

export interface RunEvent {
  type:
    | "estado_previo"
    | "cancelado"
    | "cancelacion_fallo"
    | "verificacion_cancelacion"
    | "recontratado"
    | "recontrato_fallo"
    | "recontrato_reintento"
    | "verificacion_recontrato"
    | "exito_silencioso"
    | "completado"
    | "incidente"
    | "cuenta_restringida";
  message: string;
  data?: unknown;
}

// ─── Dos fases ──────────────────────────────────────────────────────────────
//
// La operación real NO cabe en una sola pasada. Cancelar ocurre hoy; recontratar
// ocurre el día objetivo, días después. Y en Ruta A hace falta una persona
// presente en cada una, porque Ork no guarda credenciales.
//
//   Fase 1 (hoy)            periodEnd            Fase 2 (día objetivo)
//      cancelar      ──→   se vuelve free  ──→      recontratar
//      [persona]                                     [persona]
//
// Entre las dos, la orquestación vive en `esperando_recontrato`. Ese estado es
// el que antes no existía, y por eso el motor solo podía funcionar contra un
// mock que mentía sobre el tiempo.

export interface Phase1Input {
  adapter: ClosedServiceAdapter;
  /** Fecha en que se recontratará. Solo se guarda; aquí no se usa. */
  resubDate: string;
}

export interface Phase1Result {
  /** 'esperando_recontrato' | 'sin_cambios' | 'incidente' */
  state: "esperando_recontrato" | "sin_cambios" | "incidente";
  events: RunEvent[];
  priorState: ServiceState | null;
  accountRestricted: boolean;
  userMessage: string;
  manualSteps?: string[];
  /**
   * Hasta cuándo se puede deshacer reactivando. Es exactamente el fin del
   * periodo ya pagado: después de esa fecha, la fecha de cobro vieja se perdió
   * y no hay vuelta atrás.
   */
  undoDeadline: string | null;
}

export interface Phase2Input {
  adapter: ClosedServiceAdapter;
  resubDate: string;
  targetDay: number;
  plan: string | null;
  expectedAmount: number | null;
  retryMax: number;
  retryDelayMs?: number;
}

export interface Phase2Result {
  state: "completado" | "incidente";
  events: RunEvent[];
  finalState: ServiceState | null;
  retries: number;
  accountRestricted: boolean;
  /** La persona se quedó sin servicio y Ork no supo devolvérselo. */
  serviceGap: boolean;
  userMessage: string;
  manualSteps?: string[];
}

export interface RunInput {
  adapter: ClosedServiceAdapter;
  tradeoff: Tradeoff;
  /** Opción que la persona eligió explícitamente. */
  chosen: TradeoffOption;
  /** Día del mes al que se mueve. */
  targetDay: number;
  retryMax: number;
  /** Espera entre reintentos, en ms. 0 en tests. */
  retryDelayMs?: number;
}

export interface RunResult {
  state: RunState;
  events: RunEvent[];
  /** Estado leído antes de tocar nada. Sirve para el comprobante y para revertir. */
  priorState: ServiceState | null;
  finalState: ServiceState | null;
  retries: number;
  accountRestricted: boolean;
  /**
   * ¿La persona se quedó SIN servicio por culpa de esta corrida?
   *
   * Solo es cierto si la cancelación se verificó y el servicio nunca volvió a
   * quedar activo. No cuenta el fallo bueno (cancelar falló, nada cambió), ni
   * los días sin servicio que la persona eligió a sabiendas en el trade-off:
   * eso está avisado y aceptado. Esto es el corte que Ork provocó y no supo
   * deshacer, y es la métrica que puede hundir el piloto.
   */
  serviceGap: boolean;
  /** Qué decirle a la persona cuando algo salió mal. */
  userMessage: string;
  /** Pasos manuales, cuando Ork ya no puede arreglarlo solo. */
  manualSteps?: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Las dos fases, una tras otra, SIN esperar los días de por medio.
 *
 * ESTO NO ES LO QUE PASA EN PRODUCCIÓN. Ninguna ruta lo llama: el recontrato
 * ocurre días después y con la persona presente. Existe para poder ejercitar
 * las dos fases de un jalón contra el mock, y está escrito como COMPOSICIÓN de
 * runCancelPhase y runResubscribePhase a propósito — tener dos copias de las
 * mismas reglas era la forma segura de que se desincronizaran.
 */
export async function runOrchestration(input: RunInput): Promise<RunResult> {
  const f1 = await runCancelPhase({ adapter: input.adapter, resubDate: input.chosen.resubDate });

  if (f1.state !== "esperando_recontrato") {
    return {
      state: f1.state === "sin_cambios" ? "sin_cambios" : "incidente",
      events: f1.events,
      priorState: f1.priorState,
      finalState: null,
      retries: 0,
      accountRestricted: f1.accountRestricted,
      serviceGap: false,
      userMessage: f1.userMessage,
      manualSteps: f1.manualSteps,
    };
  }

  const f2 = await runResubscribePhase({
    adapter: input.adapter,
    resubDate: input.chosen.resubDate,
    targetDay: input.targetDay,
    plan: f1.priorState?.plan ?? null,
    expectedAmount: f1.priorState?.paidAmount ?? null,
    retryMax: input.retryMax,
    retryDelayMs: input.retryDelayMs,
  });

  return {
    state: f2.state,
    events: [...f1.events, ...f2.events],
    priorState: f1.priorState,
    finalState: f2.finalState,
    retries: f2.retries,
    accountRestricted: f1.accountRestricted || f2.accountRestricted,
    serviceGap: f2.serviceGap,
    userMessage: f2.userMessage,
    manualSteps: f2.manualSteps,
  };
}

function manualStepsFor(adapter: ClosedServiceAdapter, onDate: string): string[] {
  const nombre = capitalize(adapter.serviceId);
  if (adapter.mechanism === "pause") {
    return [
      `Entra a tu cuenta de ${nombre}.`,
      "Busca la suscripción en pausa y quítale la pausa.",
      "El día que la reanudes se convierte en tu fecha de cobro.",
    ];
  }
  return [
    `Entra a tu cuenta de ${nombre}.`,
    `Vuelve a contratar tu plan el ${onDate}.`,
    "Ese día queda como tu nueva fecha de cobro.",
    "Si te cobran antes o un monto distinto, escríbenos y lo resolvemos.",
  ];
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── Fase 1: cancelar ───────────────────────────────────────────────────────

/**
 * Cancela y verifica. NO recontrata: eso es la fase 2, días después.
 *
 * Al terminar bien, la persona conserva el servicio hasta `undoDeadline` y
 * todavía puede deshacerse todo reactivando.
 */
export async function runCancelPhase(input: Phase1Input): Promise<Phase1Result> {
  const { adapter } = input;
  const events: RunEvent[] = [];
  const push = (e: RunEvent) => events.push(e);

  let priorState: ServiceState | null = null;

  const fail = (
    state: Phase1Result["state"],
    userMessage: string,
    manualSteps?: string[],
    accountRestricted = false,
  ): Phase1Result => ({
    state,
    events,
    priorState,
    accountRestricted,
    userMessage,
    manualSteps,
    undoDeadline: null,
  });

  priorState = await adapter.getState();
  push({ type: "estado_previo", message: "Leímos el estado actual.", data: priorState });

  if (priorState.status === "restringida") {
    push({ type: "cuenta_restringida", message: "La cuenta está restringida por el servicio." });
    return fail(
      "incidente",
      `${capitalize(adapter.serviceId)} restringió tu cuenta. Ork no va a tocar nada más.`,
      ["Entra a tu cuenta y revisa si el servicio te pide algo.", "Escríbenos y lo vemos contigo."],
      true,
    );
  }

  const cancelRes = await adapter.cancel();

  if (cancelRes.accountRestricted) {
    push({ type: "cuenta_restringida", message: cancelRes.message });
    return fail("incidente", cancelRes.message, undefined, true);
  }

  if (!cancelRes.ok) {
    // El fallo bueno: nada cambió, no hay nada que revertir.
    push({ type: "cancelacion_fallo", message: cancelRes.message });
    return fail(
      "sin_cambios",
      "No pudimos hacer el cambio y no modificamos nada. Tu suscripción sigue igual.",
    );
  }

  push({ type: "cancelado", message: cancelRes.message });

  const esperado = adapter.mechanism === "pause" ? "pausada" : "cancelada_con_acceso";
  const vCancel = await adapter.verify({ status: esperado });
  push({
    type: "verificacion_cancelacion",
    message: vCancel.ok ? "Confirmado con el servicio." : "El servicio no confirmó el cambio.",
    data: vCancel.mismatches,
  });

  if (!vCancel.ok) {
    push({
      type: "exito_silencioso",
      message: "La cancelación respondió ok pero el estado no cambió.",
      data: vCancel.mismatches,
    });
    return fail(
      "sin_cambios",
      "No pudimos confirmar el cambio con el servicio, así que lo detuvimos. Tu suscripción sigue igual.",
    );
  }

  // La ventana para deshacer es el periodo que la persona YA pagó.
  const undoDeadline = vCancel.actual.periodEnd ?? priorState.periodEnd ?? null;

  return {
    state: "esperando_recontrato",
    events,
    priorState,
    accountRestricted: false,
    userMessage: `Listo. Sigues con ${capitalize(adapter.serviceId)} hasta el ${undoDeadline}. El ${input.resubDate} hay que volver a contratarlo para que tu fecha quede movida.`,
    undoDeadline,
  };
}

// ─── Fase 2: recontratar ────────────────────────────────────────────────────

/**
 * Vuelve a contratar el día objetivo y verifica que la fecha SÍ quedó movida.
 *
 * Si esto falla, la persona está sin servicio: `serviceGap` es true y se le dan
 * pasos manuales. No hay rollback posible aquí — la fecha vieja ya se perdió
 * cuando venció el periodo pagado.
 */
export async function runResubscribePhase(input: Phase2Input): Promise<Phase2Result> {
  const { adapter, resubDate, targetDay, retryMax } = input;
  const events: RunEvent[] = [];
  const push = (e: RunEvent) => events.push(e);
  let retries = 0;

  const fail = (
    userMessage: string,
    manualSteps?: string[],
    accountRestricted = false,
  ): Phase2Result => ({
    state: "incidente",
    events,
    finalState: null,
    retries,
    accountRestricted,
    // Llegar aquí significa que la cancelación ya ocurrió: está sin servicio.
    serviceGap: true,
    userMessage,
    manualSteps,
  });

  let resubOk = false;
  let lastMessage = "";

  for (let intento = 0; intento <= retryMax; intento++) {
    if (intento > 0) {
      retries++;
      push({ type: "recontrato_reintento", message: `Reintentando (${intento} de ${retryMax}).` });
      if (input.retryDelayMs) await sleep(input.retryDelayMs);
    }

    const res = await adapter.resubscribe({
      onDate: resubDate,
      plan: input.plan,
      expectedAmount: input.expectedAmount,
    });
    lastMessage = res.message;

    if (res.accountRestricted) {
      push({ type: "cuenta_restringida", message: res.message });
      return fail(res.message, manualStepsFor(adapter, resubDate), true);
    }

    if (res.ok) {
      resubOk = true;
      push({ type: "recontratado", message: res.message });
      break;
    }

    push({ type: "recontrato_fallo", message: res.message });
  }

  if (!resubOk) {
    push({
      type: "incidente",
      message: `El recontrato falló tras ${retries} reintentos.`,
      data: { lastMessage },
    });
    return fail(
      `No pudimos volver a contratar tu ${capitalize(adapter.serviceId)}. Lo sentimos — aquí está cómo reactivarlo tú, y ya avisamos al equipo.`,
      manualStepsFor(adapter, resubDate),
    );
  }

  const vResub = await adapter.verify({ status: "activa", billingDay: targetDay });
  push({
    type: "verificacion_recontrato",
    message: vResub.ok ? "Confirmado: tu fecha quedó movida." : "El servicio no confirmó la fecha nueva.",
    data: vResub.mismatches,
  });

  if (!vResub.ok) {
    push({
      type: "exito_silencioso",
      message: "El recontrato respondió ok pero el estado no coincide.",
      data: vResub.mismatches,
    });
    return fail(
      `${capitalize(adapter.serviceId)} aceptó el cambio pero no podemos confirmar que tu fecha quedó movida. No te vamos a decir que sí hasta estar seguros.`,
      manualStepsFor(adapter, resubDate),
    );
  }

  push({ type: "completado", message: "Listo." });

  return {
    state: "completado",
    events,
    finalState: vResub.actual,
    retries,
    accountRestricted: false,
    serviceGap: false,
    userMessage: `Tu ${capitalize(adapter.serviceId)} ahora se cobra el día ${targetDay}.`,
  };
}

/**
 * Deshacer la fase 1, mientras todavía se puede.
 *
 * Reactivar antes de que venza el periodo pagado restaura la fecha original —
 * es la misma regla que invalida la opción "adelantar". Después de `periodEnd`
 * esto ya no funciona, y por eso el llamador tiene que comprobar la fecha.
 */
export async function runUndo(
  adapter: ClosedServiceAdapter,
  prior: ServiceState,
): Promise<{ ok: boolean; message: string; actual: ServiceState | null }> {
  const res = await adapter.resubscribe({
    onDate: prior.periodEnd ?? "",
    plan: prior.plan,
    expectedAmount: prior.paidAmount,
  });
  if (!res.ok) return { ok: false, message: res.message, actual: null };

  const v = await adapter.verify({ status: "activa", billingDay: prior.billingDay ?? undefined });
  return {
    ok: v.ok,
    message: v.ok
      ? `Listo, todo quedó como estaba: tu cobro sigue el día ${prior.billingDay}.`
      : "Intentamos deshacerlo pero el servicio no lo confirmó. Revisa tu cuenta.",
    actual: v.actual,
  };
}
