// Acciones de cobro: cotización con Reap → aprobación humana → checkout. Controles de gasto aquí, no en el LLM.
import "server-only";
import { randomUUID } from "crypto";
import * as reapApi from "../reap";
import { ReapError } from "../reap";
import { addOneCycle, round2 } from "../orchestrator";
import { Approval, QuoteView, log, state } from "../store";
import { addEvidence } from "../evidence";

const RETURN_URL = "https://example.com/ork/orders/done";

const CANNED: Record<string, Omit<QuoteView, "quoteId" | "simulated">> = {
  cafe: { subtotal: 11.95, shipping: 7.95, tax: 0, total: 19.9, currency: "USD", shippingName: "Ground" },
  snacks: { subtotal: 4.99, shipping: 6.23, tax: 1.09, total: 12.31, currency: "USD", shippingName: "Ground Advantage" },
  limpieza: { subtotal: 14, shipping: 6.5, tax: 1.1, total: 21.6, currency: "USD", shippingName: "Ground" },
};

const amt = (x: any): number => (typeof x === "number" ? x : typeof x?.amount === "number" ? x.amount : typeof x?.amount?.amount === "number" ? x.amount.amount : 0);

function toQuoteView(q: any): QuoteView {
  const b = q.amountBreakdown || {};
  const sel = (q.shippingOptions || []).find((o: any) => o.selected);
  return {
    quoteId: q.id,
    subtotal: amt(b.itemsSubtotal),
    shipping: amt(b.shipping),
    tax: amt(b.tax),
    total: amt(b.finalAmount),
    currency: b.finalAmount?.currency || "USD",
    shippingName: sel?.name,
    expiresAt: q.expiresAt,
    simulated: false,
  };
}

function errMsg(e: unknown): string {
  if (e instanceof ReapError) return `${e.code} (${e.status}): ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}

/** Paso 1 del ciclo: el agente pide cotización a Reap y deja una tarjeta de aprobación. Nunca cobra solo. */
export async function startBillingCycle(subId: string, reason: string): Promise<Approval> {
  const s = state();
  const sub = s.subs.find((x) => x.id === subId);
  if (!sub) throw new Error(`No existe la suscripción ${subId}`);

  let quote: QuoteView;
  if (s.demoMode) {
    quote = { ...CANNED[sub.id], quoteId: `sim-${randomUUID()}`, simulated: true };
    log("reap", `Cotización ${sub.name}: $${quote.total}`, "MODO DEMO: respuesta guardada, sin llamada a Reap.", true);
  } else {
    log("reap", `POST /agentic/quotes → ${sub.merchant}`, `variant ${sub.variantId} · envío a Mountain View, CA`);
    const t = Date.now();
    try {
      const q = await reapApi.createQuote(sub.variantId);
      quote = toQuoteView(q);
      log("reap", `Cotización ${sub.name}: $${quote.total} USD`, `quote ${quote.quoteId} · ${((Date.now() - t) / 1000).toFixed(1)} s · caduca ${quote.expiresAt?.slice(11, 19)} UTC`);
    } catch (e) {
      log("error", `Reap falló al cotizar ${sub.name}`, errMsg(e) + " · Activa el modo demo si persiste.");
      throw new Error(`Reap no pudo cotizar: ${errMsg(e)}`);
    }
  }

  const a: Approval = { id: randomUUID(), subId, createdAt: new Date().toISOString(), status: "pendiente", quote, reason };

  // Controles de gasto: duros, en código. El LLM no puede saltárselos.
  if (quote.total > s.limits.perCycle) {
    a.status = "bloqueada";
    a.limitWarning = `Supera el límite por cobro ($${s.limits.perCycle}).`;
  } else if (s.spentThisMonth + quote.total > s.limits.monthly) {
    a.status = "bloqueada";
    a.limitWarning = `Supera el tope mensual ($${s.limits.monthly}; llevas $${round2(s.spentThisMonth)}).`;
  }
  if (a.status === "bloqueada") log("regla", `Cobro de ${sub.name} bloqueado`, a.limitWarning);
  else log("agente", `Pide tu aprobación: ${sub.name} $${quote.total}`, reason);

  s.approvals.unshift(a);
  return a;
}

export async function decide(approvalId: string, approve: boolean): Promise<Approval> {
  const s = state();
  const a = s.approvals.find((x) => x.id === approvalId);
  if (!a) throw new Error("Aprobación no encontrada");
  if (a.status !== "pendiente") throw new Error(`Esta aprobación ya está ${a.status}`);
  const sub = s.subs.find((x) => x.id === a.subId)!;

  if (!approve) {
    a.status = "rechazada";
    log("usuario", `Rechazaste el cobro de ${sub.name}`, "No se llamó a checkout. La fecha no cambia.");
    return a;
  }
  if (a.quote.expiresAt && new Date(a.quote.expiresAt).getTime() < Date.now()) {
    a.status = "error";
    a.error = "La cotización caducó (~5 min). Ejecuta el ciclo de nuevo.";
    log("error", `Cotización de ${sub.name} caducada`, a.error);
    return a;
  }

  log("usuario", `Aprobaste el cobro de ${sub.name}: $${a.quote.total}`);
  a.status = "procesando";

  try {
    if (a.quote.simulated || s.demoMode) {
      a.checkoutId = `sim-chk-${randomUUID().slice(0, 8)}`;
      a.orderId = `SIM-${Math.floor(Math.random() * 1e6)}`;
      a.finalAmount = a.quote.total;
      log("reap", `Checkout COMPLETED · orden ${a.orderId}`, "MODO DEMO: simulado sin Reap.", true);
    } else {
      const enr = s.enrollment;
      if (!enr || enr.status !== "ACTIVE" || enr.simulated) {
        throw new Error("No hay tarjeta ACTIVA en Reap. Usa “Registrar tarjeta” primero.");
      }
      log("reap", "POST /agentic/checkouts", `quote ${a.quote.quoteId} · enrollment ${enr.id.slice(0, 8)}… · X-Simulate-Checkout: COMPLETED`);
      const c: any = await reapApi.createCheckout(a.quote.quoteId, enr.id, RETURN_URL);
      a.checkoutId = c.id;
      log("reap", `Checkout ${String(c.id).slice(0, 8)}… → ${c.status}`, `${amt(c.amount) || a.quote.total} USD`);
      if (c.status === "REQUIRES_ACTION") {
        // Reap pide que la persona confirme el pago en su página alojada. El agente no puede saltarse este paso.
        a.status = "confirmar_en_reap";
        a.actionUrl = c.nextAction?.url;
        log("agente", `Falta tu confirmación en Reap: ${sub.name}`, "Abre “Confirmar pago en Reap”. La app espera el COMPLETED.");
        return a;
      }
      if (c.status !== "COMPLETED") throw new Error(`Checkout en estado ${c.status}`);
      a.orderId = c.orderId || c.order?.id || c.id;
      a.finalAmount = amt(c.finalAmount) || a.quote.total;
    }
    finalize(a);
  } catch (e) {
    a.status = "error";
    a.error = errMsg(e);
    log("error", `Checkout de ${sub.name} falló`, a.error);
  }
  return a;
}

function finalize(a: Approval) {
  const s = state();
  const sub = s.subs.find((x) => x.id === a.subId)!;
  a.status = "completada";
  s.spentThisMonth = round2(s.spentThisMonth + (a.finalAmount ?? a.quote.total));
  const prev = sub.nextCharge;
  sub.nextCharge = addOneCycle(sub.nextCharge < s.today ? s.today : sub.nextCharge, sub.billingDay);
  sub.status = sub.status === "pago_fallido" ? "rescatada" : sub.status;
  sub.lastOrderId = a.orderId;
  log("agente", `Ciclo cobrado: ${sub.name}`, `Orden ${a.orderId} · $${a.finalAmount} USD. Siguiente cobro: ${sub.nextCharge} (antes ${prev}).`);
  if (!a.quote.simulated && a.orderId && a.checkoutId) {
    addEvidence({ subId: sub.id, merchant: sub.merchant, orderId: a.orderId, checkoutId: a.checkoutId, enrollmentId: s.enrollment?.id, status: "COMPLETED", finalAmount: a.finalAmount ?? a.quote.total, currency: a.quote.currency, at: new Date().toISOString() });
  }
}

/** Polling de checkouts que esperan confirmación humana en Reap. Una lectura por aprobación por llamada. */
export async function refreshPendingCheckouts() {
  const s = state();
  for (const a of s.approvals.filter((x) => x.status === "confirmar_en_reap" && x.checkoutId)) {
    const c: any = await reapApi.getCheckout(a.checkoutId!);
    if (c.status === "COMPLETED") {
      a.orderId = c.orderId || c.order?.id || c.id;
      a.finalAmount = amt(c.finalAmount) || amt(c.amount) || a.quote.total;
      log("reap", `Checkout ${String(c.id).slice(0, 8)}… → COMPLETED`, `Orden ${a.orderId} · finalAmount $${a.finalAmount} USD`);
      finalize(a);
    } else if (["FAILED", "CANCELED", "CANCELLED", "EXPIRED"].includes(c.status)) {
      a.status = "error";
      a.error = `Reap: checkout ${c.status}`;
      log("error", `Checkout ${c.status}`, a.error);
    }
  }
}

export async function registerCard(origin: string) {
  const s = state();
  if (s.demoMode) {
    s.enrollment = { id: `sim-enr-${randomUUID().slice(0, 8)}`, status: "ACTIVE", simulated: true };
    log("reap", "Tarjeta registrada (simulada)", "MODO DEMO: sin página alojada.", true);
    return s.enrollment;
  }
  log("reap", "POST /agentic/enrollments", "source EXTERNAL · la tarjeta la captura Reap, Ork y el agente nunca la ven");
  // Reap exige https en returnUrl; en local usamos una URL neutra (la app detecta ACTIVE por polling).
  const returnUrl = origin.startsWith("https://") ? `${origin}/?card=added` : "https://example.com/ork/cards/added";
  const e: any = await reapApi.createEnrollment(returnUrl);
  s.enrollment = { id: e.id, status: e.status, url: e.nextAction?.url, expiresAt: e.nextAction?.expiresAt };
  log("reap", `Enrollment ${e.status}`, "Abre la página segura de Reap para capturar la tarjeta (dura ~15 min).");
  return s.enrollment;
}

export async function refreshEnrollment() {
  const s = state();
  const enr = s.enrollment;
  if (!enr || enr.simulated) return enr;
  const e: any = await reapApi.getEnrollment(enr.id);
  if (e.status !== enr.status) log("reap", `Enrollment → ${e.status}`, e.status === "ACTIVE" ? "Tarjeta lista. El agente ya puede ejecutar ciclos (con tu aprobación)." : undefined);
  enr.status = e.status;
  return enr;
}

/** Usar una enrollment existente por id (por si se registró desde otro lado). */
export async function adoptEnrollment(id: string) {
  const s = state();
  const e: any = await reapApi.getEnrollment(id);
  s.enrollment = { id: e.id, status: e.status, url: e.nextAction?.url, expiresAt: e.nextAction?.expiresAt };
  log("reap", `Enrollment ${id.slice(0, 8)}… adoptada: ${e.status}`);
  return s.enrollment;
}

/** Tras un reinicio el estado en memoria se pierde: recupera UNA vez la enrollment ACTIVE más reciente desde Reap. */
const rg = globalThis as unknown as { __orkEnrRecovered?: boolean };
export async function recoverActiveEnrollment() {
  const s = state();
  if (s.enrollment || s.demoMode || rg.__orkEnrRecovered) return;
  rg.__orkEnrRecovered = true;
  const list: any = await reapApi.listEnrollments();
  const active = (list.items || []).filter((e: any) => e.status === "ACTIVE").sort((a: any, b: any) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!active) return;
  s.enrollment = { id: active.id, status: "ACTIVE" };
  const pm = active.paymentMethod;
  log("reap", "Tarjeta recuperada de Reap", `Enrollment ${active.id.slice(0, 8)}… ACTIVE${pm?.last4 ? ` · ${pm.network} •${pm.last4}` : ""}`);
}
