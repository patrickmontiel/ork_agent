"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Sub = {
  id: string; name: string; emoji: string; merchant: string; merchantType: "corte_duro" | "gracia"; product: string;
  monthlyAmount: number; billingDay: number; nextCharge: string; status: "activa" | "pago_fallido" | "rescatada"; safe: boolean; lastOrderId?: string;
};
type Approval = {
  id: string; subId: string; status: string; reason: string; limitWarning?: string; error?: string; orderId?: string; finalAmount?: number; checkoutId?: string; actionUrl?: string;
  quote: { quoteId: string; subtotal: number; shipping: number; tax: number; total: number; currency: string; shippingName?: string; expiresAt?: string; simulated: boolean };
};
type LogE = { id: number; at: string; kind: string; title: string; detail?: string; simulated?: boolean };
type St = {
  today: string; paydays: number[]; limits: { perCycle: number; monthly: number }; spentThisMonth: number; demoMode: boolean;
  enrollment: { id: string; status: string; url?: string; expiresAt?: string; simulated?: boolean } | null;
  subs: Sub[]; approvals: Approval[]; log: LogE[]; chat: { role: string; content: string }[];
  metrics: { total: number; riskyWithoutOrk: number; riskyWithOrk: number }; llm: string;
  evidence: { subId: string; merchant: string; orderId: string; checkoutId: string; status: string; finalAmount: number; currency: string; at: string }[];
};

const KIND: Record<string, string> = {
  agente: "bg-violet-400/15 text-violet-300", reap: "bg-sky-400/15 text-sky-300", usuario: "bg-white/10 text-white/80",
  regla: "bg-amber-400/15 text-amber-300", error: "bg-rose-400/15 text-rose-300", sistema: "bg-white/5 text-white/50",
};

const SUGGESTIONS = ["Mi quincena cae el 15 y el 30", "Cobra todo el día 16", "Muévelo después de mi corte (día 8)", "Sí", "Cobra el café ahora"];

export default function Home() {
  const [st, setSt] = useState<St | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const chatEnd = useRef<HTMLDivElement>(null);

  const load = useCallback(async (poll = false) => {
    const r = await fetch(`/api/state${poll ? "?poll=1" : ""}`, { cache: "no-store" });
    setSt(await r.json());
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [st?.chat.length]);

  // Polling de la enrollment hasta ACTIVE
  const enrPending = st?.enrollment && st.enrollment.status !== "ACTIVE";
  const payPending = st?.approvals.some((a) => a.status === "confirmar_en_reap");
  useEffect(() => {
    if (!enrPending && !payPending) return;
    const t = setInterval(() => load(true), 4000);
    return () => clearInterval(t);
  }, [enrPending, payPending, load]);

  async function act(action: string, extra: Record<string, unknown> = {}, label = action) {
    setBusy(label);
    try {
      const r = await fetch("/api/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...extra }) });
      const j = await r.json();
      if (j.error) { setToast(j.error); if (j.state) setSt(j.state); } else setSt(j);
    } catch (e) { setToast(String(e)); }
    setBusy(null);
  }

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setInput("");
    setSt((s) => (s ? { ...s, chat: [...s.chat, { role: "user", content: text }] } : s));
    setBusy("chat");
    try {
      const r = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
      const j = await r.json();
      if (j.state) setSt(j.state); else setToast(j.error || "Error del agente");
    } catch (e) { setToast(String(e)); }
    setBusy(null);
  }

  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 6000); return () => clearTimeout(t); } }, [toast]);

  if (!st) return <main className="p-10 text-white/50">Cargando Ork…</main>;
  const subName = (id: string) => st.subs.find((s) => s.id === id);
  const cardOk = st.enrollment?.status === "ACTIVE";

  return (
    <main className="mx-auto max-w-7xl p-4 md:p-6 space-y-4">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold tracking-tight">Ork</span>
            <span className="rounded-full bg-violet-400/15 px-2 py-0.5 text-xs text-violet-300">Agente · Reap Agentic Payments</span>
          </div>
          <p className="text-sm text-white/60">Pagas suscripciones que quieres. No se cobran el día que quieres. <b className="text-white/90">Ahora sí.</b></p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-white/50">Hoy {st.today} · Quincenas {st.paydays.join(" y ")} · LLM: {st.llm}</span>
          <button className={st.demoMode ? "btn bg-amber-400 text-black" : "btn-ghost"} onClick={() => act("demo_mode", { on: !st.demoMode })}>
            {st.demoMode ? "MODO DEMO (simulado)" : "Reap sandbox en vivo"}
          </button>
          <button className="btn-ghost" onClick={() => act("reset")}>Reiniciar</button>
        </div>
      </header>

      {st.evidence?.[0] && (
        <section className="panel border-emerald-400/40 p-3 text-sm" aria-label="Evidencia de checkout real">
          <b className="text-emerald-300">Checkout real en Reap · COMPLETED</b> · {st.evidence[0].merchant} · orderId <code>{st.evidence[0].orderId}</code> · finalAmount <b>${st.evidence[0].finalAmount.toFixed(2)} {st.evidence[0].currency}</b> · checkout <code>{st.evidence[0].checkoutId.slice(0, 8)}…</code>
        </section>
      )}

      {/* Indicadores */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Metric label="Cobros que caen antes de quincena (sin Ork)" value={`${st.metrics.riskyWithoutOrk}/${st.metrics.total}`} tone="text-rose-300" />
        <Metric label="Con Ork" value={`${st.metrics.riskyWithOrk}/${st.metrics.total}`} tone={st.metrics.riskyWithOrk === 0 ? "text-emerald-300" : "text-amber-300"} />
        <Metric label="Gastado este mes (aprobado por ti)" value={`$${st.spentThisMonth.toFixed(2)}`} sub={`tope mensual $${st.limits.monthly}`} />
        <Metric label="Límite por cobro" value={`$${st.limits.perCycle}`} sub="el agente no lo puede cambiar" />
      </section>

      <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
        <div className="space-y-4">
          {/* Tarjeta / enrollment */}
          <section className="panel p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">Método de pago</div>
              <div className="text-xs text-white/60">
                {!st.enrollment && "Sin tarjeta. La captura Reap en su página segura: ni Ork ni el agente ven los datos."}
                {st.enrollment && (
                  <>
                    Enrollment <code>{st.enrollment.id.slice(0, 13)}…</code> ·{" "}
                    <b className={cardOk ? "text-emerald-300" : "text-amber-300"}>{st.enrollment.status}</b>
                    {st.enrollment.simulated && <span className="ml-1 text-amber-300">(SIMULADO)</span>}
                    {enrPending && " · esperando que completes la página de Reap…"}
                  </>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              {enrPending && st.enrollment?.url && (
                <a className="btn-primary" href={st.enrollment.url} target="_blank" rel="noreferrer">Abrir página segura de Reap ↗</a>
              )}
              {!cardOk && (
                <button className="btn-ghost" disabled={!!busy} onClick={() => act("register_card", {}, "card")}>
                  {busy === "card" ? "Creando…" : st.enrollment ? "Nuevo enlace" : "Registrar tarjeta"}
                </button>
              )}
            </div>
          </section>

          {/* Suscripciones */}
          <section className="space-y-2">
            {st.subs.map((s) => (
              <div key={s.id} className={`panel p-4 ${s.status === "pago_fallido" ? "border-rose-400/40" : ""}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="text-3xl">{s.emoji}</div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{s.name}</span>
                        <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-emerald-300">orquestable</span>
                        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/60">{s.merchantType === "corte_duro" ? "corte duro" : "con gracia"}</span>
                        {s.status === "pago_fallido" && <span className="rounded-full bg-rose-400/20 px-2 py-0.5 text-[10px] text-rose-300">PAGO FALLIDO</span>}
                        {s.status === "rescatada" && <span className="rounded-full bg-sky-400/20 px-2 py-0.5 text-[10px] text-sky-300">RESCATADA</span>}
                      </div>
                      <div className="text-xs text-white/50">{s.merchant} · {s.product}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-semibold">${s.monthlyAmount.toFixed(2)}</div>
                    <div className="text-xs text-white/50">USD / ciclo aprox.</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm">
                    Próximo cobro <b>{s.nextCharge}</b> · día {s.billingDay}{" "}
                    <span className={s.safe ? "text-emerald-300" : "text-rose-300"}>{s.safe ? "✓ después de quincena" : "⚠ antes de quincena"}</span>
                  </div>
                  <div className="flex gap-2">
                    <button className="btn-danger" disabled={!!busy || s.status === "pago_fallido"} onClick={() => act("fail", { subId: s.id })}>Simular pago fallido</button>
                    <button className="btn-primary" disabled={!!busy} onClick={() => act("run_cycle", { subId: s.id }, `cycle-${s.id}`)}>
                      {busy === `cycle-${s.id}` ? "Cotizando con Reap…" : "Ejecutar ciclo ahora"}
                    </button>
                  </div>
                </div>
                {s.status === "pago_fallido" && (
                  <div className="mt-2 rounded-lg bg-rose-400/10 p-2 text-xs text-rose-200">
                    Dunning agotado. Pídele al agente: <button className="underline" onClick={() => send(`Rescata ${s.name.toLowerCase()} después de mi quincena`)}>“rescata {s.name.toLowerCase()} después de mi quincena”</button>
                  </div>
                )}
              </div>
            ))}
          </section>

          {/* Aprobaciones */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-white/70">Aprobaciones de cobro</h2>
            {busy?.startsWith("cycle") || (busy === "chat") ? (
              <div className="panel p-4 text-sm text-white/60 animate-pulse">Esperando cotización de Reap (puede tardar hasta 45 s)…</div>
            ) : null}
            {st.approvals.length === 0 && !busy && <div className="panel p-4 text-sm text-white/40">Nada pendiente. El agente nunca cobra sin tu aprobación.</div>}
            {st.approvals.map((a) => {
              const s = subName(a.subId);
              return (
                <div key={a.id} className={`panel p-4 ${a.status === "pendiente" ? "border-emerald-400/50 ring-1 ring-emerald-400/20" : ""}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold">{s?.emoji} {s?.name} · <span className="text-white/60 font-normal">{s?.merchant}</span></div>
                      <div className="text-xs text-white/50">{a.reason}</div>
                    </div>
                    <StatusPill status={a.status} />
                  </div>
                  <div className="mt-3 grid grid-cols-4 gap-2 text-sm">
                    <Cell k="Producto" v={`$${a.quote.subtotal.toFixed(2)}`} />
                    <Cell k={`Envío${a.quote.shippingName ? ` · ${a.quote.shippingName}` : ""}`} v={`$${a.quote.shipping.toFixed(2)}`} />
                    <Cell k="Impuestos" v={`$${a.quote.tax.toFixed(2)}`} />
                    <Cell k="Total" v={`$${a.quote.total.toFixed(2)} ${a.quote.currency}`} strong />
                  </div>
                  <div className="mt-2 text-[11px] text-white/40">
                    Cotización Reap <code>{a.quote.quoteId.slice(0, 13)}…</code>
                    {a.quote.expiresAt && ` · caduca ${new Date(a.quote.expiresAt).toLocaleTimeString("es-MX")}`}
                    {a.quote.simulated && <span className="ml-1 text-amber-300">· SIMULADO</span>}
                    {a.orderId && <> · Orden <b className="text-emerald-300">{a.orderId}</b></>}
                  </div>
                  {a.limitWarning && <div className="mt-2 rounded-lg bg-amber-400/10 p-2 text-xs text-amber-200">Control de gasto: {a.limitWarning}</div>}
                  {a.error && <div className="mt-2 rounded-lg bg-rose-400/10 p-2 text-xs text-rose-200">{a.error}</div>}
                  {a.status === "confirmar_en_reap" && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {a.actionUrl && <a className="btn-primary" href={a.actionUrl} target="_blank" rel="noreferrer">Confirmar pago en Reap ↗</a>}
                      <span className="text-xs text-sky-300 animate-pulse">Esperando que Reap marque el pago como COMPLETED…</span>
                    </div>
                  )}
                  {a.status === "pendiente" && (
                    <div className="mt-3 flex items-center gap-2">
                      <button className="btn-primary" disabled={!!busy} onClick={() => act("approve", { approvalId: a.id }, "approve")}>
                        {busy === "approve" ? "Cobrando con Reap…" : `Aprobar $${a.quote.total.toFixed(2)}`}
                      </button>
                      <button className="btn-ghost" disabled={!!busy} onClick={() => act("reject", { approvalId: a.id })}>Rechazar</button>
                      {!cardOk && !a.quote.simulated && <span className="text-xs text-amber-300">Registra la tarjeta antes de aprobar.</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        </div>

        <div className="space-y-4">
          {/* Chat */}
          <section className="panel flex h-[460px] flex-col">
            <div className="border-b border-white/10 px-4 py-2 text-sm font-semibold">Habla con el agente</div>
            <div className="flex-1 space-y-2 overflow-y-auto p-4 text-sm">
              {st.chat.length === 0 && (
                <div className="text-white/50">Dime cuándo te pagan o qué día te conviene. Yo muevo las fechas (solo hacia adelante), cotizo con Reap y te pido aprobación para cada cobro.</div>
              )}
              {st.chat.map((m, i) => (
                <div key={i} className={`whitespace-pre-wrap rounded-xl px-3 py-2 ${m.role === "user" ? "ml-10 bg-emerald-400/15" : "mr-6 bg-white/5"}`}>{m.content}</div>
              ))}
              {busy === "chat" && <div className="mr-6 rounded-xl bg-white/5 px-3 py-2 text-white/50 animate-pulse">El agente está trabajando…</div>}
              <div ref={chatEnd} />
            </div>
            <div className="flex flex-wrap gap-1 px-3 pb-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-white/60 hover:bg-white/10" onClick={() => send(s)} disabled={!!busy}>{s}</button>
              ))}
            </div>
            <form className="flex gap-2 border-t border-white/10 p-3" onSubmit={(e) => { e.preventDefault(); send(input); }}>
              <input className="flex-1 rounded-lg bg-white/5 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-emerald-400/50" placeholder="Ej. cobra todo el día 16" value={input} onChange={(e) => setInput(e.target.value)} />
              <button className="btn-primary" disabled={!!busy || !input.trim()}>Enviar</button>
            </form>
          </section>

          {/* Línea de tiempo */}
          <section className="panel">
            <div className="border-b border-white/10 px-4 py-2 text-sm font-semibold">Registro de decisiones y llamadas a Reap</div>
            <ol className="max-h-[420px] space-y-1.5 overflow-y-auto p-3">
              {st.log.map((e) => (
                <li key={e.id} className="text-xs">
                  <div className="flex items-start gap-2">
                    <span className="w-14 shrink-0 text-white/30">{new Date(e.at).toLocaleTimeString("es-MX", { hour12: false })}</span>
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase ${KIND[e.kind] || ""}`}>{e.kind}</span>
                    <div>
                      <div className="font-mono text-white/85">{e.title}{e.simulated && <span className="ml-1 text-amber-300">[SIMULADO]</span>}</div>
                      {e.detail && <div className="text-white/45">{e.detail}</div>}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>

      {toast && <div className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-xl bg-rose-500 px-4 py-2 text-sm text-white shadow-lg">{toast}</div>}
    </main>
  );
}

function Metric({ label, value, tone = "", sub }: { label: string; value: string; tone?: string; sub?: string }) {
  return (
    <div className="panel p-3">
      <div className="text-[11px] text-white/50">{label}</div>
      <div className={`text-2xl font-bold ${tone}`}>{value}</div>
      {sub && <div className="text-[10px] text-white/40">{sub}</div>}
    </div>
  );
}

function Cell({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="rounded-lg bg-white/5 p-2">
      <div className="truncate text-[10px] text-white/45">{k}</div>
      <div className={strong ? "font-bold text-emerald-300" : ""}>{v}</div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const m: Record<string, string> = {
    pendiente: "bg-emerald-400/20 text-emerald-300", procesando: "bg-sky-400/20 text-sky-300", confirmar_en_reap: "bg-sky-400/20 text-sky-300", completada: "bg-emerald-400 text-black",
    rechazada: "bg-white/10 text-white/60", error: "bg-rose-400/20 text-rose-300", bloqueada: "bg-amber-400/20 text-amber-300",
  };
  const label: Record<string, string> = { pendiente: "Esperando tu aprobación", confirmar_en_reap: "Confirma en Reap", completada: "Pagado ✓", bloqueada: "Bloqueado por límite" };
  return <span className={`rounded-full px-2 py-0.5 text-[11px] ${m[status] || ""}`}>{label[status] || status}</span>;
}
