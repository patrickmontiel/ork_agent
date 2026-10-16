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

export async function runOrchestration(input: RunInput): Promise<RunResult> {
  const { adapter, chosen, targetDay, retryMax } = input;
  const events: RunEvent[] = [];
  const push = (e: RunEvent) => events.push(e);

  let priorState: ServiceState | null = null;
  let retries = 0;

  // cancelacionVerificada: a partir de aquí la persona está fuera del servicio,
  // así que cualquier salida que no sea "completado" la deja sin él.
  let cancelacionVerificada = false;

  const fail = (
    state: RunState,
    userMessage: string,
    manualSteps?: string[],
    accountRestricted = false,
  ): RunResult => ({
    state,
    events,
    priorState,
    finalState: null,
    retries,
    accountRestricted,
    serviceGap: cancelacionVerificada,
    userMessage,
    manualSteps,
  });

  // ── 0. Estado previo ──────────────────────────────────────────────────────
  // Se lee y se guarda ANTES de tocar nada. Sin esto no hay forma de saber qué
  // revertir ni qué ponerle al comprobante.
  priorState = await adapter.getState();
  push({ type: "estado_previo", message: "Leímos el estado actual.", data: priorState });

  if (priorState.status === "restringida") {
    push({
      type: "cuenta_restringida",
      message: "La cuenta está restringida por el servicio.",
    });
    return fail(
      "incidente",
      `${capitalize(adapter.serviceId)} restringió tu cuenta. Ork no va a tocar nada más.`,
      ["Entra a tu cuenta y revisa si el servicio te pide algo.", "Escríbenos y lo vemos contigo."],
      true,
    );
  }

  // ── 1. Cancelar (o pausar) ────────────────────────────────────────────────
  const cancelRes = await adapter.cancel();

  if (cancelRes.accountRestricted) {
    push({ type: "cuenta_restringida", message: cancelRes.message });
    return fail("incidente", cancelRes.message, undefined, true);
  }

  if (!cancelRes.ok) {
    // Nada cambió, así que no hay rollback que hacer. Es el fallo bueno.
    push({ type: "cancelacion_fallo", message: cancelRes.message });
    return fail(
      "sin_cambios",
      "No pudimos hacer el cambio y no modificamos nada. Tu suscripción sigue igual.",
    );
  }

  push({ type: "cancelado", message: cancelRes.message });

  // ── 2. Verificar la cancelación ───────────────────────────────────────────
  const expectedAfterCancel =
    adapter.mechanism === "pause" ? "pausada" : "cancelada_con_acceso";
  const vCancel = await adapter.verify({ status: expectedAfterCancel });
  push({
    type: "verificacion_cancelacion",
    message: vCancel.ok ? "Confirmado con el servicio." : "El servicio no confirmó el cambio.",
    data: vCancel.mismatches,
  });

  if (!vCancel.ok) {
    // Dijo que sí pero no cambió nada. Como nada cambió, tampoco hay daño:
    // se corta aquí antes de intentar recontratar sobre un estado falso.
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

  cancelacionVerificada = true;

  // ── 3. Recontratar, con reintentos ────────────────────────────────────────
  let resubOk = false;
  let lastMessage = "";

  for (let intento = 0; intento <= retryMax; intento++) {
    if (intento > 0) {
      retries++;
      push({
        type: "recontrato_reintento",
        message: `Reintentando (${intento} de ${retryMax}).`,
      });
      if (input.retryDelayMs) await sleep(input.retryDelayMs);
    }

    const res = await adapter.resubscribe({
      onDate: chosen.resubDate,
      plan: priorState.plan,
      expectedAmount: priorState.paidAmount,
    });
    lastMessage = res.message;

    if (res.accountRestricted) {
      push({ type: "cuenta_restringida", message: res.message });
      return fail("incidente", res.message, manualStepsFor(adapter, chosen.resubDate), true);
    }

    if (res.ok) {
      resubOk = true;
      push({ type: "recontratado", message: res.message });
      break;
    }

    push({ type: "recontrato_fallo", message: res.message });
  }

  if (!resubOk) {
    // Este es el fallo caro: la persona está sin servicio y Ork no pudo
    // devolvérselo. Se declara incidente y se le dan pasos manuales.
    push({
      type: "incidente",
      message: `El recontrato falló tras ${retries} reintentos.`,
      data: { lastMessage },
    });
    return fail(
      "incidente",
      `No pudimos volver a contratar tu ${capitalize(adapter.serviceId)}. Lo sentimos — aquí está cómo reactivarlo tú, y ya avisamos al equipo.`,
      manualStepsFor(adapter, chosen.resubDate),
    );
  }

  // ── 4. Verificar el recontrato ────────────────────────────────────────────
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
      "incidente",
      `${capitalize(adapter.serviceId)} aceptó el cambio pero no podemos confirmar que tu fecha quedó movida. No te vamos a decir que sí hasta estar seguros.`,
      manualStepsFor(adapter, chosen.resubDate),
    );
  }

  push({ type: "completado", message: "Listo." });

  return {
    state: "completado",
    events,
    priorState,
    finalState: vResub.actual,
    retries,
    accountRestricted: false,
    serviceGap: false,
    userMessage: `Tu ${capitalize(adapter.serviceId)} ahora se cobra el día ${targetDay}.`,
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
