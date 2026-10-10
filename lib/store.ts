// Estado en memoria (sin base de datos). Vive en globalThis para sobrevivir al hot reload de Next.
import { Subscription, isSafeDay } from "./orchestrator";
import { readEvidence } from "./evidence";

export type LogKind = "agente" | "reap" | "usuario" | "regla" | "error" | "sistema";

export interface LogEntry {
  id: number;
  at: string;
  kind: LogKind;
  title: string;
  detail?: string;
  simulated?: boolean;
}

export interface QuoteView {
  quoteId: string;
  subtotal: number;
  shipping: number;
  tax: number;
  total: number;
  currency: string;
  shippingName?: string;
  expiresAt?: string;
  simulated: boolean;
}

export interface Approval {
  id: string;
  subId: string;
  createdAt: string;
  status: "pendiente" | "aprobada" | "rechazada" | "procesando" | "completada" | "error" | "bloqueada" | "confirmar_en_reap";
  quote: QuoteView;
  reason: string; // por qué el agente pide este cobro
  checkoutId?: string;
  actionUrl?: string; // página de Reap donde la persona confirma el pago
  orderId?: string;
  finalAmount?: number;
  error?: string;
  limitWarning?: string;
}

export interface Enrollment {
  id: string;
  status: string;
  url?: string;
  expiresAt?: string;
  simulated?: boolean;
}

export interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

export interface State {
  today: string;
  paydays: number[];
  limits: { perCycle: number; monthly: number };
  spentThisMonth: number;
  demoMode: boolean;
  enrollment: Enrollment | null;
  subs: Subscription[];
  baselineDays: Record<string, number>; // días originales, para el indicador "sin Ork"
  approvals: Approval[];
  log: LogEntry[];
  chat: ChatMsg[];
  logSeq: number;
}

function todayCDMX(): string {
  return new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);
}

function initialSubs(): Subscription[] {
  return [
    {
      id: "cafe", name: "Club de café", emoji: "☕", merchant: "coffeeam.com", merchantType: "corte_duro",
      product: "Freedom Blend Coffee 0.5LB Whole Bean", variantId: "var_1571f43d4aa343d6b5aa0d3c1ac95837",
      monthlyAmount: 19.9, billingDay: 10, nextCharge: "2026-10-10", status: "activa",
    },
    {
      id: "snacks", name: "Caja de snacks", emoji: "🍯", merchant: "exoticsnacks.com", merchantType: "gracia",
      product: "Lay's Mini Potato Bites Honey Butter 40g", variantId: "var_29022beb35b0474085db49a9836ba3de",
      monthlyAmount: 12.31, billingDay: 12, nextCharge: "2026-10-12", status: "activa",
    },
    {
      id: "limpieza", name: "Limpieza del hogar", emoji: "🧴", merchant: "packagefreeshop.com", merchantType: "corte_duro",
      product: "Multi-Purpose Cleaning Spray, Lavender", variantId: "var_f904723015464896bf55342d8bd8719f",
      monthlyAmount: 21.6, billingDay: 27, nextCharge: "2026-10-27", status: "activa",
    },
  ];
}

function fresh(): State {
  const subs = initialSubs();
  const s: State = {
    today: todayCDMX(),
    paydays: [15, 30],
    limits: { perCycle: 30, monthly: 80 },
    spentThisMonth: 0,
    demoMode: false,
    enrollment: null,
    subs,
    baselineDays: Object.fromEntries(subs.map((x) => [x.id, x.billingDay])),
    approvals: [],
    log: [],
    chat: [],
    logSeq: 0,
  };
  return s;
}

const g = globalThis as unknown as { __ork?: State };

export function state(): State {
  if (!g.__ork) {
    g.__ork = fresh();
    log("sistema", "Ork listo", "3 suscripciones cargadas. Quincenas: día 15 y 30.");
  }
  return g.__ork;
}

export function reset(): State {
  const keepEnrollment = g.__ork?.enrollment ?? null;
  g.__ork = fresh();
  g.__ork.enrollment = keepEnrollment;
  log("sistema", "Estado reiniciado", keepEnrollment ? "Se conservó la tarjeta registrada." : undefined);
  return g.__ork;
}

export function log(kind: LogKind, title: string, detail?: string, simulated?: boolean): LogEntry {
  const s = g.__ork ?? state();
  const e: LogEntry = { id: ++s.logSeq, at: new Date().toISOString(), kind, title, detail, simulated };
  s.log.unshift(e);
  if (s.log.length > 200) s.log.pop();
  return e;
}

export function findSub(idOrName: string): Subscription | undefined {
  const q = idOrName.toLowerCase();
  return state().subs.find((s) => s.id === q || s.name.toLowerCase().includes(q) || s.merchant.includes(q));
}

export function metrics(s: State) {
  const before = s.subs.filter((x) => !isSafeDay(s.baselineDays[x.id], s.paydays)).length;
  const now = s.subs.filter((x) => !isSafeDay(x.billingDay, s.paydays)).length;
  return { total: s.subs.length, riskyWithoutOrk: before, riskyWithOrk: now };
}

export function publicState() {
  const s = state();
  return {
    today: s.today,
    paydays: s.paydays,
    limits: s.limits,
    spentThisMonth: s.spentThisMonth,
    demoMode: s.demoMode,
    enrollment: s.enrollment ? { id: s.enrollment.id, status: s.enrollment.status, url: s.enrollment.url, expiresAt: s.enrollment.expiresAt, simulated: s.enrollment.simulated } : null,
    subs: s.subs.map((x) => ({ ...x, safe: isSafeDay(x.billingDay, s.paydays) })),
    approvals: s.approvals.slice(0, 12),
    log: s.log.slice(0, 80),
    chat: s.chat,
    metrics: metrics(s),
    llm: llmProvider(),
    evidence: readEvidence().slice(0, 5),
  };
}

export function llmProvider(): "anthropic" | "openai" | "reglas" {
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENAI_API_KEY) return "openai";
  return "reglas";
}
