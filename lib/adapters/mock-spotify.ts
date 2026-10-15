import type {
  ClosedServiceAdapter,
  ServiceState,
  ActionResult,
  ResubscribeInput,
} from "./types.ts";

// Mock de Spotify. Determinista, sin red, sin navegador.
//
// Existe por dos razones y las dos importan igual:
//  1. Se puede construir y probar todo el motor sin tocar la cuenta de nadie.
//  2. Los cinco escenarios de abajo son los que hay que saber manejar ANTES de
//     escribir el adaptador real. Si el motor no sobrevive al mock, no tiene
//     por qué sobrevivir a Spotify.

export type MockScenario =
  | "feliz"              // todo sale bien
  | "con_promo"          // paga menos que el precio de lista
  | "falla_cancelacion"  // cancel() falla → nada cambió, no hay nada que revertir
  | "falla_recontrato"   // cancel() ok, resubscribe() falla → queda sin servicio
  | "cuenta_restringida" // Spotify bloqueó la cuenta → apagado del piloto
  | "exito_silencioso";  // las llamadas dicen ok, pero el estado NO cambió

export interface MockConfig {
  scenario: MockScenario;
  /** Estado inicial. Si no se da, se usa uno razonable. */
  initial?: Partial<ServiceState>;
  /** Cuántas veces falla el recontrato antes de funcionar. Para probar reintentos. */
  failResubscribeTimes?: number;
}

const PRECIO_LISTA = 139; // Spotify individual MX

export class MockSpotifyAdapter implements ClosedServiceAdapter {
  readonly serviceId = "spotify";
  readonly mechanism = "cancel_resubscribe" as const;
  readonly mode = "mock" as const;

  private state: ServiceState;
  private readonly scenario: MockScenario;
  private resubAttempts = 0;
  private readonly failResubTimes: number;

  constructor(cfg: MockConfig) {
    this.scenario = cfg.scenario;
    this.failResubTimes = cfg.failResubscribeTimes ?? (cfg.scenario === "falla_recontrato" ? 99 : 0);
    this.state = {
      status: cfg.scenario === "cuenta_restringida" ? "restringida" : "activa",
      plan: "individual",
      paidAmount: cfg.scenario === "con_promo" ? 69.5 : PRECIO_LISTA,
      currency: "MXN",
      billingDay: 10,
      periodEnd: "2026-11-10",
      evidence: "mock",
      ...cfg.initial,
    };
  }

  async getState(): Promise<ServiceState> {
    return { ...this.state };
  }

  async cancel(): Promise<ActionResult> {
    if (this.scenario === "cuenta_restringida") {
      return {
        ok: false,
        accountRestricted: true,
        code: "account_restricted",
        message:
          "Spotify restringió esta cuenta. Ork no va a tocar nada más y ya avisamos al equipo.",
      };
    }
    if (this.scenario === "falla_cancelacion") {
      return {
        ok: false,
        code: "cancel_failed",
        message: "No pudimos cancelar tu suscripción. No cambiamos nada.",
      };
    }

    // "Cancelada con acceso": la persona conserva lo que ya pagó. Ork no cobra
    // hacia atrás ni le pide pagar días muertos.
    if (this.scenario !== "exito_silencioso") {
      this.state = { ...this.state, status: "cancelada_con_acceso" };
    }
    return {
      ok: true,
      code: "cancelled",
      message: `Cancelamos tu suscripción. Sigues con acceso hasta el ${this.state.periodEnd}.`,
      evidence: "mock:cancel",
    };
  }

  async resubscribe(input: ResubscribeInput): Promise<ActionResult> {
    this.resubAttempts++;

    if (this.scenario === "cuenta_restringida") {
      return {
        ok: false,
        accountRestricted: true,
        code: "account_restricted",
        message: "Spotify restringió esta cuenta.",
      };
    }

    if (this.resubAttempts <= this.failResubTimes) {
      return {
        ok: false,
        code: "resubscribe_failed",
        message: `No pudimos volver a contratar (intento ${this.resubAttempts}).`,
      };
    }

    if (this.scenario === "exito_silencioso") {
      // Lo peor que puede pasar: la llamada dice que sí y el estado no cambió.
      // Solo verify() lo detecta. Si el motor confía en este `ok`, le miente
      // a la persona.
      return {
        ok: true,
        code: "resubscribed",
        message: "Listo (pero en realidad no cambió nada).",
        evidence: "mock:resubscribe:silent",
      };
    }

    const day = Number(input.onDate.slice(8, 10));
    this.state = {
      ...this.state,
      status: "activa",
      plan: input.plan ?? this.state.plan,
      // Al recontratar se pierde la promo: vuelve el precio de lista.
      paidAmount: PRECIO_LISTA,
      billingDay: day,
      periodEnd: addMonth(input.onDate),
    };

    return {
      ok: true,
      code: "resubscribed",
      message: `Volvimos a contratar. Tu próximo cobro es el ${this.state.periodEnd}.`,
      evidence: "mock:resubscribe",
    };
  }

  async verify(expected: Partial<ServiceState>) {
    const actual = await this.getState();
    const mismatches: string[] = [];

    for (const [k, v] of Object.entries(expected) as Array<
      [keyof ServiceState, ServiceState[keyof ServiceState]]
    >) {
      if (v === undefined) continue;
      if (actual[k] !== v) mismatches.push(`${k}: esperaba ${String(v)}, encontré ${String(actual[k])}`);
    }

    return { ok: mismatches.length === 0, actual, mismatches };
  }

  async dispose() {
    // El mock no abre nada.
  }
}

/** Suma un mes conservando el día, con clamp al último día del mes corto. */
function addMonth(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const nd = Math.min(d, last);
  return `${ny}-${String(nm).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}

export const MOCK_SCENARIOS: MockScenario[] = [
  "feliz",
  "con_promo",
  "falla_cancelacion",
  "falla_recontrato",
  "cuenta_restringida",
  "exito_silencioso",
];
