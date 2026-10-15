import type {
  ClosedServiceAdapter,
  ServiceState,
  ActionResult,
  ResubscribeInput,
} from "./types.ts";

// Mock de Netflix. Mecanismo distinto: PAUSA, no cancelación.
//
// Netflix deja pausar hasta un mes. Al quitar la pausa se cobra ese día y ese
// día queda como la fecha nueva. Es más limpio que cancelar y recontratar:
// no se pierde el historial ni el perfil, y no hay riesgo de que el precio
// cambie al volver.
//
// Dos límites reales que el adaptador tiene que respetar:
//  - El plan Básico no se puede pausar.
//  - Si paga alguien más (Netflix cobrado por un tercero), tampoco.
//  - La pausa no puede durar más de un mes.

export type NetflixScenario =
  | "feliz"
  | "plan_basico"          // no se puede pausar
  | "pago_por_tercero"     // lo paga alguien más
  | "pausa_muy_larga"      // el hueco pedido supera un mes
  | "falla_reanudacion"
  | "cuenta_restringida";

const MAX_PAUSA_DIAS = 30;

export class MockNetflixAdapter implements ClosedServiceAdapter {
  readonly serviceId = "netflix";
  readonly mechanism = "pause" as const;
  readonly mode = "mock" as const;

  private state: ServiceState;
  private readonly scenario: NetflixScenario;
  private resumeAttempts = 0;
  private readonly failResumeTimes: number;

  constructor(cfg: { scenario: NetflixScenario; initial?: Partial<ServiceState>; failResumeTimes?: number }) {
    this.scenario = cfg.scenario;
    this.failResumeTimes = cfg.failResumeTimes ?? (cfg.scenario === "falla_reanudacion" ? 99 : 0);
    this.state = {
      status: cfg.scenario === "cuenta_restringida" ? "restringida" : "activa",
      plan: cfg.scenario === "plan_basico" ? "basico" : "estandar",
      paidAmount: cfg.scenario === "plan_basico" ? 119 : 269,
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

  /** En Netflix "cancelar" es pausar. La persona conserva lo que ya pagó. */
  async cancel(): Promise<ActionResult> {
    if (this.scenario === "cuenta_restringida") {
      return { ok: false, accountRestricted: true, code: "account_restricted", message: "Netflix restringió esta cuenta." };
    }
    if (this.scenario === "plan_basico") {
      return {
        ok: false,
        code: "plan_no_pausable",
        message: "El plan Básico de Netflix no se puede pausar. Ork no puede mover esta fecha.",
      };
    }
    if (this.scenario === "pago_por_tercero") {
      return {
        ok: false,
        code: "pago_externo",
        message: "Esta cuenta la paga alguien más, así que Ork no puede pausarla.",
      };
    }

    this.state = { ...this.state, status: "pausada" };
    return {
      ok: true,
      code: "paused",
      message: `Pausamos tu Netflix. Sigues con acceso hasta el ${this.state.periodEnd}.`,
      evidence: "mock:pause",
    };
  }

  /** Quitar la pausa. El día que se reanuda queda como fecha de cobro. */
  async resubscribe(input: ResubscribeInput): Promise<ActionResult> {
    this.resumeAttempts++;

    if (this.scenario === "cuenta_restringida") {
      return { ok: false, accountRestricted: true, code: "account_restricted", message: "Netflix restringió esta cuenta." };
    }

    if (this.scenario === "pausa_muy_larga" || this.excedeLimite(input.onDate)) {
      return {
        ok: false,
        code: "pausa_excede_limite",
        message: `Netflix solo deja pausar hasta ${MAX_PAUSA_DIAS} días. La fecha que elegiste queda más lejos.`,
      };
    }

    if (this.resumeAttempts <= this.failResumeTimes) {
      return {
        ok: false,
        code: "resume_failed",
        message: `No pudimos quitar la pausa (intento ${this.resumeAttempts}).`,
      };
    }

    const day = Number(input.onDate.slice(8, 10));
    this.state = {
      ...this.state,
      status: "activa",
      billingDay: day,
      periodEnd: addMonth(input.onDate),
      // Al reanudar NO cambia el precio: es la ventaja de la pausa sobre
      // cancelar y recontratar.
      paidAmount: this.state.paidAmount,
    };

    return {
      ok: true,
      code: "resumed",
      message: `Quitamos la pausa. Tu próximo cobro es el ${this.state.periodEnd}.`,
      evidence: "mock:resume",
    };
  }

  private excedeLimite(onDate: string): boolean {
    if (!this.state.periodEnd) return false;
    const dias = Math.round(
      (Date.parse(onDate) - Date.parse(this.state.periodEnd)) / 86_400_000,
    );
    return dias > MAX_PAUSA_DIAS;
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

  async dispose() {}
}

function addMonth(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

export const NETFLIX_SCENARIOS: NetflixScenario[] = [
  "feliz",
  "plan_basico",
  "pago_por_tercero",
  "pausa_muy_larga",
  "falla_reanudacion",
  "cuenta_restringida",
];

export const NETFLIX_MAX_PAUSA_DIAS = MAX_PAUSA_DIAS;
