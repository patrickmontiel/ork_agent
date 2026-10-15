// Agente de Ork: orquesta fechas y ejecuta ciclos con Reap mediante tool calling.
// Proveedor: ANTHROPIC_API_KEY → Claude; OPENAI_API_KEY → OpenAI; si no hay, motor determinístico por reglas
// que llama EXACTAMENTE las mismas tools.
import "server-only";
import { DateProposal, applyProposal, bestDayAfterPayday, isSafeDay, proposeDateChange, rescueForward } from "./orchestrator";
import { findSub, llmProvider, log, state } from "./store";
import { startBillingCycle } from "./billing";

type Json = Record<string, any>;

export const TOOLS = [
  {
    name: "list_subscriptions",
    description: "Lista las suscripciones del usuario con día de cobro, próximo cobro, monto, tipo de merchant, estado y si el día es seguro (cae justo después de quincena).",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "propose_date_change",
    description: "Propone mover el día de cobro de una suscripción. Valida que sea SOLO hacia adelante, calcula días de hueco y prorrata. NO aplica el cambio: hay que confirmarlo con el usuario.",
    input_schema: {
      type: "object",
      properties: { sub_id: { type: "string", description: "cafe | snacks | limpieza" }, target_day: { type: "integer", minimum: 1, maximum: 31 } },
      required: ["sub_id", "target_day"],
    },
  },
  {
    name: "confirm_date_change",
    description: "Aplica un cambio de fecha previamente propuesto. Úsalo solo cuando el usuario haya confirmado.",
    input_schema: { type: "object", properties: { sub_id: { type: "string" } }, required: ["sub_id"] },
  },
  {
    name: "run_billing_cycle",
    description: "Ejecuta el ciclo de cobro con Reap Agentic Payments: pide cotización real al merchant y crea una tarjeta de aprobación. El cobro solo ocurre si el usuario aprueba; el agente nunca ve datos de tarjeta.",
    input_schema: { type: "object", properties: { sub_id: { type: "string" }, reason: { type: "string" } }, required: ["sub_id"] },
  },
  {
    name: "simulate_failed_payment",
    description: "Simula que el cobro de una suscripción falló por fondos insuficientes y que el dunning se agotó (estado C).",
    input_schema: { type: "object", properties: { sub_id: { type: "string" } }, required: ["sub_id"] },
  },
  {
    name: "rescue_forward",
    description: "Rescate hacia adelante (estado C): reinicia una suscripción con pago fallido en una fecha futura en la que el usuario sí puede pagar, condonando los días bloqueados. Solo merchants de corte duro.",
    input_schema: { type: "object", properties: { sub_id: { type: "string" }, target_day: { type: "integer", minimum: 1, maximum: 31 } }, required: ["sub_id", "target_day"] },
  },
] as const;

const g = globalThis as unknown as { __orkProposals?: Record<string, DateProposal>; __orkCorte?: number; __orkAsk?: "corte" | "pago" };
const proposals = () => (g.__orkProposals ??= {});

function short(o: Json) {
  return Object.entries(o).map(([k, v]) => `${k}=${v}`).join(", ");
}

export async function runTool(name: string, input: Json): Promise<Json> {
  const s = state();
  log("agente", `→ ${name}(${short(input)})`);
  const sub = input.sub_id ? findSub(String(input.sub_id)) : undefined;
  if (input.sub_id && !sub) return { error: `No existe la suscripción "${input.sub_id}". Usa cafe, snacks o limpieza.` };

  try {
    switch (name) {
      case "list_subscriptions":
        return {
          today: s.today,
          paydays: s.paydays,
          subscriptions: s.subs.map((x) => ({
            id: x.id, name: x.name, merchant: x.merchant, merchantType: x.merchantType, billingDay: x.billingDay,
            nextCharge: x.nextCharge, amountUSD: x.monthlyAmount, status: x.status, safeDay: isSafeDay(x.billingDay, s.paydays),
          })),
          spendLimits: { ...s.limits, spentThisMonth: s.spentThisMonth },
          cardRegistered: s.enrollment?.status === "ACTIVE",
        };

      case "propose_date_change": {
        const p = proposeDateChange(sub!, Number(input.target_day), s.today);
        proposals()[sub!.id] = p;
        log("regla", `Propuesta ${sub!.name}: ${p.fromDate} → ${p.toDate}`, p.explanation);
        return { ...p, requiresUserConfirmation: p.gapDays > 0 };
      }

      case "confirm_date_change": {
        const p = proposals()[sub!.id];
        if (!p) return { error: `No hay propuesta pendiente para ${sub!.name}. Llama primero propose_date_change.` };
        const i = s.subs.findIndex((x) => x.id === sub!.id);
        s.subs[i] = applyProposal(s.subs[i], p);
        delete proposals()[sub!.id];
        log("agente", `Fecha cambiada: ${sub!.name} → día ${p.targetDay}`, `Próximo cobro ${p.toDate}. Sin cancelar ni volver a suscribirse.`);
        return { ok: true, sub_id: sub!.id, newBillingDay: p.targetDay, nextCharge: p.toDate };
      }

      case "run_billing_cycle": {
        const a = await startBillingCycle(sub!.id, input.reason || `Ciclo de ${sub!.name} del ${sub!.nextCharge}`);
        return {
          approvalId: a.id, status: a.status, total: a.quote.total, currency: a.quote.currency,
          shipping: a.quote.shipping, tax: a.quote.tax, simulated: a.quote.simulated, limitWarning: a.limitWarning,
          note: a.status === "bloqueada" ? "Bloqueado por control de gasto." : "Esperando aprobación humana en la tarjeta de la UI. No se ha cobrado nada.",
        };
      }

      case "simulate_failed_payment": {
        sub!.status = "pago_fallido";
        log("error", `Pago fallido: ${sub!.name} (${sub!.nextCharge})`, "Fondos insuficientes. Dunning: 3 reintentos agotados. El cobro cayó antes de quincena.");
        return { ok: true, sub_id: sub!.id, failedDate: sub!.nextCharge, merchantType: sub!.merchantType, dunning: "agotado" };
      }

      case "rescue_forward": {
        const plan = rescueForward(sub!, Number(input.target_day), s.today);
        sub!.billingDay = plan.targetDay;
        sub!.nextCharge = plan.newDate;
        sub!.status = "rescatada";
        log("agente", `Rescate hacia adelante: ${sub!.name}`, plan.explanation);
        return { ...plan, next: "Ejecuta run_billing_cycle para reintentar el cobro en la nueva fecha (con aprobación)." };
      }
    }
    return { error: `Tool desconocida: ${name}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("error", `${name} falló`, msg);
    return { error: msg };
  }
}

function systemPrompt() {
  const s = state();
  return `Eres el agente de Ork, infraestructura de orquestación de fechas de cobro de suscripciones para LatAm. Hoy es ${s.today}. Las quincenas del usuario caen los días ${s.paydays.join(" y ")}.
Ork es "puente, no procesador": los cobros se ejecutan con Reap Agentic Payments (sandbox) y el usuario aprueba cada cobro. Nunca pides ni ves datos de tarjeta.
Reglas que DEBES respetar:
- La fecha solo se mueve HACIA ADELANTE. Nunca hacia atrás ni con crédito; el hueco se cubre por adelantado (el merchant lo absorbe por defecto).
- "Se condona lo que se bloqueó; se cobra lo que se consumió". Corte duro (café, limpieza): rescate sin cobrar el hueco. Con gracia (snacks): se cobran los días usados, sin rescate.
- Rescate hacia adelante solo tras pago fallido y solo para corte duro.
- Fechas buenas: 16 (post-quincena 15), 1 (post-30), el día después del corte de tarjeta, el día después del pago de nómina, o el día que el usuario pida para cada suscripción.
- Si falta un dato, pregunta en una frase: "¿Qué día corta tu tarjeta?" o "¿Cuándo te cae tu pago?".
Flujo: para cambiar fechas llama propose_date_change por cada suscripción, explica en 1-2 frases y pide confirmación; cuando el usuario confirme, llama confirm_date_change. Para cobrar usa run_billing_cycle (crea una tarjeta de aprobación; no digas que ya se cobró). Tras rescue_forward, llama run_billing_cycle.
Responde en español de México con frases cortas y simples (máx. 3), sin jerga técnica: no digas enrollment, quote, checkout, merchant, dunning ni prorrata. Montos en USD.`;
}

// ---------- Anthropic ----------
async function runAnthropic(): Promise<string> {
  const s = state();
  const messages: any[] = s.chat.slice(-12).map((m) => ({ role: m.role, content: m.content }));
  for (let step = 0; step < 8; step++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: process.env.ORK_MODEL || "claude-sonnet-5-5", max_tokens: 1024, system: systemPrompt(), tools: TOOLS, messages }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    messages.push({ role: "assistant", content: data.content });
    const uses = data.content.filter((c: any) => c.type === "tool_use");
    if (!uses.length) return data.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
    const results = [];
    for (const u of uses) results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(await runTool(u.name, u.input)) });
    messages.push({ role: "user", content: results });
  }
  return "Listo.";
}

// ---------- OpenAI ----------
async function runOpenAI(): Promise<string> {
  const s = state();
  const messages: any[] = [{ role: "system", content: systemPrompt() }, ...s.chat.slice(-12)];
  const tools = TOOLS.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } }));
  for (let step = 0; step < 8; step++) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ model: process.env.ORK_MODEL || "gpt-4o-mini", messages, tools }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const msg = (await res.json()).choices[0].message;
    messages.push(msg);
    if (!msg.tool_calls?.length) return msg.content || "Listo.";
    for (const c of msg.tool_calls) {
      const out = await runTool(c.function.name, JSON.parse(c.function.arguments || "{}"));
      messages.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify(out) });
    }
  }
  return "Listo.";
}

// ---------- Fallback determinístico (mismas tools) ----------
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
/** "2026-10-16" → "16 de oct" */
function dia(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} de ${MESES[m - 1]}`;
}
function targetSubs(text: string): string[] {
  const t = text.toLowerCase();
  const ids: string[] = [];
  if (/caf[eé]/.test(t)) ids.push("cafe");
  if (/snack|botana|papas/.test(t)) ids.push("snacks");
  if (/limpi|spray/.test(t)) ids.push("limpieza");
  return ids.length ? ids : state().subs.map((x) => x.id);
}

async function runRules(text: string): Promise<string> {
  const s = state();
  let t = text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const ask = g.__orkAsk;
  g.__orkAsk = undefined;
  if (ask && /\d/.test(t) &&!/cort[ea]|quincena|nomina|pago|fall|rescat/.test(t)) {
    t = ask === "corte" ? `mi tarjeta corta el dia ${t}` : `me pagan el dia ${t}`;
  }
  const subs = targetSubs(text);
  const pending = Object.values(proposals());

  // Confirmación
  if (pending.length && /^(si|sí|dale|confirm|ok|va|hazlo|aplica|claro)/.test(t.trim())) {
    for (const p of pending) await runTool("confirm_date_change", { sub_id: p.subId });
    const allSafe = state().subs.every((x) => isSafeDay(x.billingDay, state().paydays));
    const done = allSafe ? "Listo. Ya ningún cobro cae antes de tu quincena, y no cancelaste nada." : "Listo. Ya moví tus cobros a las fechas nuevas, y no cancelaste nada.";
    return `${done}\nAhora puedes cobrar con Reap: elige una suscripción y pulsa “Cobrar ahora”.`;
  }
  if (pending.length && /^(no|cancela|olvidalo)/.test(t.trim())) {
    g.__orkProposals = {};
    log("usuario", "Propuestas descartadas");
    return "Va, no cambio nada. Tus fechas siguen igual.";
  }

  // Rescate o pago fallido
  const failed = s.subs.find((x) => x.status === "pago_fallido" && subs.includes(x.id));
  if (/rescat/.test(t) || (/fall|rechaz|no pas|sin fondos/.test(t))) {
    const id = /rescat/.test(t) && failed ? failed.id : subs.length === s.subs.length ? "cafe" : subs[0];
    if (/rescat/.test(t) && !failed) return "No hay ningún pago fallido que rescatar.";
    if (!/rescat/.test(t)) await runTool("simulate_failed_payment", { sub_id: id });
    const sub = s.subs.find((x) => x.id === id)!;
    if (sub.merchantType !== "corte_duro") return `El pago de ${sub.name.toLowerCase()} falló. Esta tienda cobra los días que ya usaste, así que no puedo moverlo sin costo.`;
    // La quincena que viene, contada desde hoy — no la primera del mes.
    const day = bestDayAfterPayday(s.paydays, Number(s.today.slice(8, 10)));
    const r = await runTool("rescue_forward", { sub_id: id, target_day: day });
    if (r.error) return r.error;
    const c = await runTool("run_billing_cycle", { sub_id: id, reason: `Reintento tras rescate: nueva fecha ${r.newDate}, ${r.blockedDays} días condonados.` });
    return `El pago de ${sub.name.toLowerCase()} falló. Lo moví al ${dia(r.newDate)}, después de tu quincena, y no te cobro los ${r.blockedDays} días perdidos.\nAprueba el cobro de $${c.total} para reintentar.`;
  }

  // Referencias de fecha que el usuario puede dar
  const corteKw = /\bcort[ea]\b|fecha de corte/.test(t);
  const payKw = /quincena|nomina|me pagan|me depositan|sueldo|dia de pago|mi pago|cae (el |mi )?pago/.test(t);

  // Cobrar / ejecutar ciclo (no si el mensaje habla de cuándo cobrar)
  const aboutWhen = corteKw || payKw || /despues/.test(t);
  if (!aboutWhen && (/cobra(lo|r)? (ya|ahora)|ejecuta|corre el ciclo|reintenta|paga(lo)? ya/.test(t) || (/^cobra/.test(t) && !/\d/.test(t)))) {
    const out: string[] = [];
    for (const id of subs.slice(0, 3)) {
      const r = await runTool("run_billing_cycle", { sub_id: id, reason: "Pedido por el usuario desde el chat." });
      const n = s.subs.find((x) => x.id === id)!.name;
      out.push(r.error ? `${n.toLowerCase()}: no pude obtener el precio` : `${n.toLowerCase()} cuesta $${r.total}${r.status === "bloqueada" ? ", pero pasa tu límite de gasto" : ""}`);
    }
    return `Le pregunté el precio a Reap: ${out.join("; ")}.\nNo cobro nada hasta que lo apruebes.`;
  }

  // Cambio de fecha: corte de tarjeta, quincena/nómina, día por suscripción o día explícito
  const nums = (t.match(/\d{1,2}/g) || []).map(Number).filter((n) => n >= 1 && n <= 31);
  const targets: Record<string, number> = {}; // sub_id → día objetivo
  let why = "";

  if (corteKw) {
    const corteDay = nums[0] ?? g.__orkCorte;
    if (!corteDay) { g.__orkAsk = "corte"; return "¿Qué día corta tu tarjeta?"; }
    g.__orkCorte = corteDay;
    log("usuario", `Corte de tarjeta: día ${corteDay}`);
    const day = (corteDay % 31) + 1; // el día siguiente al corte
    for (const id of subs) targets[id] = day;
    why = `el día después de tu corte (día ${corteDay})`;
  } else if (payKw) {
    if (nums.length) s.paydays = Array.from(new Set(nums)).sort((a, b) => a - b);
    else if (!/quincena/.test(t)) { g.__orkAsk = "pago"; return "¿Cuándo te cae tu pago?"; }
    log("usuario", `Días de pago: ${s.paydays.join(" y ")}`);
    // Para cada suscripción, el día post-pago con el menor hueco hacia adelante.
    const candidates = s.paydays.map((p) => (p >= 30 ? 1 : p + 1));
    for (const id of subs) {
      const sub = s.subs.find((x) => x.id === id)!;
      targets[id] = [...candidates].sort((a, b) => proposeDateChange(sub, a, s.today).gapDays - proposeDateChange(sub, b, s.today).gapDays)[0];
    }
    why = /quincena/.test(t) ? "justo después de tu quincena" : "justo después de tu día de pago";
  } else {
    // "el café el 20 y la limpieza el 5": un día por suscripción
    const KEY: [RegExp, string][] = [[/cafe/, "cafe"], [/snack|botana|papas/, "snacks"], [/limpi|spray/, "limpieza"]];
    for (const m of Array.from(t.matchAll(/(cafe|snacks?|botanas?|papas|limpieza|limpiar|spray)[^\d]{0,25}?(\d{1,2})/g))) {
      const id = KEY.find(([re]) => re.test(m[1]))?.[1];
      const n = Number(m[2]);
      if (id && n >= 1 && n <= 31) targets[id] = n;
    }
    if (Object.keys(targets).length) why = "en los días que pediste";
    else if (nums.length) {
      for (const id of subs) targets[id] = nums[nums.length - 1];
      why = `el día ${nums[nums.length - 1]}`;
    }
  }

  if (Object.keys(targets).length) {
    const lines: string[] = [];
    for (const [id, target] of Object.entries(targets)) {
      const p = await runTool("propose_date_change", { sub_id: id, target_day: target });
      const name = state().subs.find((x) => x.id === id)!.name;
      if (p.error) lines.push(`${name}: ${p.error}`);
      else if (p.gapDays === 0) { delete proposals()[id]; lines.push(`${name}: ya se cobra el día ${target}`); }
      else lines.push(`${name}: del ${dia(p.fromDate)} al ${dia(p.toDate)}`);
    }
    const any = Object.keys(proposals()).length > 0;
    return `Te propongo cobrar ${why}:\n• ${lines.join("\n• ")}\n${any ? "Solo muevo fechas hacia adelante y no pagas de más. ¿Lo aplico?" : ""}`.trim();
  }

  if (/lista|suscrip|que tengo|estado/.test(t)) {
    const r = await runTool("list_subscriptions", {});
    return r.subscriptions.map((x: any) => `${x.name}: día ${x.billingDay} (${x.safeDay ? "seguro" : "antes de quincena"}), próximo ${x.nextCharge}, $${x.amountUSD}`).join("\n");
  }

  return "Dime cuándo te pagan (por ejemplo: “mi quincena cae el 15 y el 30”) y muevo tus cobros. También puedo cobrar una suscripción ahora o rescatar un pago fallido.";
}

export async function chat(text: string): Promise<{ reply: string; provider: string }> {
  const s = state();
  s.chat.push({ role: "user", content: text });
  log("usuario", `“${text}”`);
  let provider = llmProvider();
  let reply: string;
  try {
    reply = provider === "anthropic" ? await runAnthropic() : provider === "openai" ? await runOpenAI() : await runRules(text);
  } catch (e) {
    log("error", `LLM (${provider}) falló; uso el motor de reglas`, e instanceof Error ? e.message : String(e));
    provider = "reglas";
    reply = await runRules(text);
  }
  s.chat.push({ role: "assistant", content: reply });
  return { reply, provider };
}
