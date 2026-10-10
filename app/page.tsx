"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Sub = {
  id: string; name: string; emoji: string; merchant: string; merchantType: "corte_duro" | "gracia"; product: string;
  monthlyAmount: number; billingDay: number; nextCharge: string; status: "activa" | "pago_fallido" | "rescatada"; safe: boolean; lastOrderId?: string;
};
type Approval = {
  id: string; subId: string; status: string; reason: string; limitWarning?: string; error?: string; orderId?: string; finalAmount?: number;
  checkoutId?: string; actionUrl?: string;
  quote: { quoteId: string; subtotal: number; shipping: number; tax: number; total: number; currency: string; shippingName?: string; expiresAt?: string; simulated: boolean };
};
type LogE = { id: number; at: string; kind: string; title: string; detail?: string; simulated?: boolean };
type Evidence = { subId: string; merchant: string; orderId: string; checkoutId: string; status: string; finalAmount: number; currency: string; at: string };
type St = {
  today: string; paydays: number[]; limits: { perCycle: number; monthly: number }; spentThisMonth: number; demoMode: boolean;
  enrollment: { id: string; status: string; url?: string; expiresAt?: string; simulated?: boolean } | null;
  subs: Sub[]; approvals: Approval[]; log: LogE[]; chat: { role: string; content: string }[];
  metrics: { total: number; riskyWithoutOrk: number; riskyWithOrk: number }; llm: string;
  evidence: Evidence[]; baselineDays: Record<string, number>;
};

const SUGGESTIONS = ["Mi quincena cae el 15 y el 30", "Sí", "Cobra los snacks ahora", "Falló el café", "Muévelo después de mi corte (día 8)"];
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MONTHS_LONG = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

const pd = (s: string) => { const [y, m, d] = s.split("-").map(Number); return { y, m: m - 1, d }; };
const short = (s: string) => { const { m, d } = pd(s); return `${d} ${MONTHS[m]}`; };
const money = (n: number) => `$${n.toFixed(2)}`;

/** Fecha original (sin Ork) del próximo cobro: primera ocurrencia del día base desde hoy. */
function baselineDate(today: string, day: number): string {
  const { y, m, d } = pd(today);
  const mk = (yy: number, mm: number) => {
    const last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
    return new Date(Date.UTC(yy, mm, Math.min(day, last))).toISOString().slice(0, 10);
  };
  return day >= d ? mk(y, m) : mk(m === 11 ? y + 1 : y, (m + 1) % 12);
}

function toolIcon(e: LogE): string {
  const t = e.title;
  if (t.includes("list_subscriptions")) return "📋";
  if (t.includes("propose_date_change")) return "🗓️";
  if (t.includes("confirm_date_change")) return "✅";
  if (t.includes("run_billing_cycle")) return "💳";
  if (t.includes("simulate_failed_payment")) return "⚠️";
  if (t.includes("rescue_forward")) return "🛟";
  if (t.includes("COMPLETED")) return "🟢";
  return ({ reap: "🔗", usuario: "👤", regla: "⚖️", error: "⛔", sistema: "·", agente: "◆" } as Record<string, string>)[e.kind] || "·";
}

const KIND_STYLE: Record<string, string> = {
  agente: "text-violet-200", reap: "text-sky-200", usuario: "text-violet-50", regla: "text-amber-200", error: "text-rose-200", sistema: "text-violet-200/60",
};

export default function Home() {
  const [st, setSt] = useState<St | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const chatBox = useRef<HTMLDivElement>(null);

  const load = useCallback(async (poll = false) => {
    const r = await fetch(`/api/state${poll ? "?poll=1" : ""}`, { cache: "no-store" });
    setSt(await r.json());
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { chatBox.current?.scrollTo({ top: chatBox.current.scrollHeight, behavior: "smooth" }); }, [st?.chat.length, busy]);

  const enrPending = !!st?.enrollment && st.enrollment.status !== "ACTIVE";
  const payPending = !!st?.approvals.some((a) => a.status === "confirmar_en_reap");
  useEffect(() => {
    if (!enrPending && !payPending) return;
    const t = setInterval(() => load(true), 4000);
    return () => clearInterval(t);
  }, [enrPending, payPending, load]);

  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 6000); return () => clearTimeout(t); } }, [toast]);

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
      if (j.state) setSt(j.state); else setToast(j.error || "El agente no respondió. Intenta de nuevo.");
    } catch (e) { setToast(String(e)); }
    setBusy(null);
  }

  if (!st) return <main className="grid min-h-screen place-items-center text-violet-200/60">Cargando Ork…</main>;
  const cardOk = st.enrollment?.status === "ACTIVE";
  const evidence = st.evidence?.[0];
  const quoting = busy?.startsWith("cycle") || busy === "chat";

  return (
    <main className="mx-auto max-w-7xl space-y-5 px-4 py-5 md:px-6 md:py-8">
      {/* Barra superior */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <span className="text-3xl font-black tracking-[-0.04em] text-white">
            ork<span className="text-violet-400">.</span>
          </span>
          <span className="hidden text-sm text-violet-200/75 sm:inline">Más control. Menos fricción. Mejores resultados.</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-violet-200/70">Hoy {short(st.today)} · Quincenas {st.paydays.join(" y ")} · Agente: {st.llm}</span>
          <button
            className={st.demoMode ? "btn bg-amber-300 text-amber-950" : "btn-ghost"}
            onClick={() => act("demo_mode", { on: !st.demoMode })}
            aria-pressed={st.demoMode}
          >
            {st.demoMode ? "Modo demo: SIMULADO" : "Reap sandbox en vivo"}
          </button>
          <button className="btn-ghost" onClick={() => act("reset")}>Reiniciar</button>
        </div>
      </header>

      {/* Hero */}
      <section className="panel relative overflow-hidden p-5 md:p-8">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-violet-600/25 blur-3xl" />
        <div className="relative grid gap-6 md:grid-cols-[1.4fr_1fr] md:items-end">
          <div>
            <h1 className="max-w-xl text-balance text-2xl font-semibold leading-tight text-white md:text-4xl">
              Pagas suscripciones que quieres. Ahora se cobran el día que quieres.
            </h1>
            <p className="mt-2 max-w-lg text-sm text-violet-100/75">
              Un agente mueve tus fechas de cobro después de tu quincena, siempre hacia adelante, y cobra cada ciclo con Reap Agentic Payments solo cuando tú apruebas.
            </p>
          </div>
          <div aria-live="polite">
            <div className="text-xs font-medium text-violet-200/75">Cobros que caen antes de quincena</div>
            <div className="mt-1 flex items-end gap-4">
              <div>
                <div className="text-3xl font-bold tabular-nums text-rose-300/80 line-through decoration-rose-300/40 md:text-4xl">
                  {st.metrics.riskyWithoutOrk}/{st.metrics.total}
                </div>
                <div className="text-[11px] text-violet-200/70">sin Ork</div>
              </div>
              <div className="pb-3 text-2xl text-violet-300/70" aria-hidden>→</div>
              <div>
                <div
                  key={st.metrics.riskyWithOrk}
                  className={`settle text-6xl font-black tabular-nums tracking-[-0.04em] md:text-7xl ${st.metrics.riskyWithOrk === 0 ? "text-emerald-300" : "text-white"}`}
                >
                  {st.metrics.riskyWithOrk}/{st.metrics.total}
                </div>
                <div className="text-[11px] text-violet-200/70">con Ork</div>
              </div>
            </div>
          </div>
        </div>

        {/* Pago: tarjeta + evidencia */}
        <div className="relative mt-6 grid gap-3 border-t pt-4 text-sm md:grid-cols-2" style={{ borderColor: "var(--line)" }}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-medium text-white">Tarjeta</div>
              <div className="text-xs text-violet-100/70">
                {!st.enrollment && "Sin tarjeta. Reap la captura en su página segura; Ork y el agente nunca la ven."}
                {st.enrollment && (
                  <>
                    Enrollment <code className="font-mono">{st.enrollment.id.slice(0, 8)}…</code>{" "}
                    <b className={cardOk ? "text-emerald-300" : "text-amber-200"}>{st.enrollment.status}</b>
                    {st.enrollment.simulated && <span className="text-amber-200"> · SIMULADO</span>}
                    {" "}· Ork y el agente nunca ven los datos de la tarjeta
                  </>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              {enrPending && st.enrollment?.url && <a className="btn-primary" href={st.enrollment.url} target="_blank" rel="noreferrer">Abrir página de Reap ↗</a>}
              {!cardOk && (
                <button className="btn-ghost" disabled={!!busy} onClick={() => act("register_card", {}, "card")}>
                  {busy === "card" ? "Creando enlace…" : st.enrollment ? "Nuevo enlace" : "Registrar tarjeta"}
                </button>
              )}
            </div>
          </div>
          {evidence ? (
            <div className="rounded-xl bg-emerald-400/10 px-3 py-2 text-xs text-emerald-100" aria-label="Evidencia de checkout real">
              <div className="font-semibold text-emerald-300">Checkout real en Reap · COMPLETED</div>
              <div className="mt-0.5 break-words">
                {evidence.merchant} · <b>{money(evidence.finalAmount)} {evidence.currency}</b> · orderId <code className="font-mono">{evidence.orderId}</code>
              </div>
            </div>
          ) : (
            <div className="text-xs text-violet-100/60">Aún no hay checkouts reales completados.</div>
          )}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
        <div className="min-w-0 space-y-5">
          <Calendar st={st} />

          {/* Suscripciones */}
          <section aria-labelledby="subs-h" className="space-y-2">
            <h2 id="subs-h" className="text-sm font-semibold text-violet-100">Suscripciones</h2>
            {st.subs.map((s) => (
              <article key={s.id} className={`panel p-4 ${s.status === "pago_fallido" ? "border-rose-400/50" : ""}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-violet-400/10 text-2xl" aria-hidden>{s.emoji}</div>
                    <div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <h3 className="font-semibold text-white">{s.name}</h3>
                        <span className="rounded-full bg-violet-400/20 px-2 py-0.5 text-[11px] font-medium text-violet-100">orquestable</span>
                        <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-violet-100/75">{s.merchantType === "corte_duro" ? "corte duro" : "con gracia"}</span>
                        {s.status === "pago_fallido" && <span className="rounded-full bg-rose-400/20 px-2 py-0.5 text-[11px] font-medium text-rose-200">pago fallido</span>}
                        {s.status === "rescatada" && <span className="rounded-full bg-sky-400/20 px-2 py-0.5 text-[11px] font-medium text-sky-200">rescatada</span>}
                      </div>
                      <div className="text-xs text-violet-100/65">{s.merchant} · {s.product}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-semibold tabular-nums text-white">{money(s.monthlyAmount)}</div>
                    <div className="text-[11px] text-violet-100/65">USD por ciclo</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm text-violet-50">
                    Próximo cobro <b>{short(s.nextCharge)}</b>{" "}
                    <span className={s.safe ? "text-emerald-300" : "text-rose-300"}>{s.safe ? "· después de quincena" : "· antes de quincena"}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button className="btn-danger" disabled={!!busy || s.status === "pago_fallido"} onClick={() => act("fail", { subId: s.id })}>Simular pago fallido</button>
                    <button className="btn-primary" disabled={!!busy} onClick={() => act("run_cycle", { subId: s.id }, `cycle-${s.id}`)}>
                      {busy === `cycle-${s.id}` ? "Cotizando con Reap…" : "Ejecutar ciclo ahora"}
                    </button>
                  </div>
                </div>
                {s.status === "pago_fallido" && (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-rose-400/10 px-3 py-2 text-xs text-rose-100">
                    <span>Dunning agotado. El agente puede reiniciarla después de tu quincena sin cobrarte los días bloqueados.</span>
                    <button className="btn-ghost" disabled={!!busy} onClick={() => send(`Rescata ${s.name.toLowerCase()} después de mi quincena`)}>Rescatar hacia adelante</button>
                  </div>
                )}
              </article>
            ))}
          </section>

          {/* Aprobaciones */}
          <section aria-labelledby="appr-h" className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-1">
              <h2 id="appr-h" className="text-sm font-semibold text-violet-100">Aprobaciones de cobro</h2>
              <span className="text-xs text-violet-100/70">
                Gastado {money(st.spentThisMonth)} de {money(st.limits.monthly)} al mes · máximo {money(st.limits.perCycle)} por cobro
              </span>
            </div>
            {quoting && (
              <div className="panel p-4 text-sm text-violet-100/75" role="status">
                <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-violet-400" />
                Pidiendo cotización a Reap. Puede tardar hasta 45 s.
              </div>
            )}
            {st.approvals.length === 0 && !quoting && (
              <div className="panel p-4 text-sm text-violet-100/65">Nada pendiente. El agente cotiza, pero solo tú puedes aprobar un cobro.</div>
            )}
            {st.approvals.map((a) => <ApprovalCard key={a.id} a={a} st={st} busy={busy} cardOk={cardOk} act={act} />)}
          </section>
        </div>

        <div className="min-w-0 space-y-5">
          {/* Chat */}
          <section className="panel flex h-[480px] flex-col" aria-labelledby="chat-h">
            <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "var(--line)" }}>
              <h2 id="chat-h" className="text-sm font-semibold text-white">Agente de Ork</h2>
              <span className="text-[11px] text-violet-100/65">6 tools · Reap Agentic</span>
            </div>
            <div ref={chatBox} className="flex-1 space-y-2 overflow-y-auto p-4 text-sm" aria-live="polite">
              {st.chat.length === 0 && (
                <p className="max-w-[60ch] text-violet-100/75">
                  Dime cuándo te pagan o qué día te conviene. Muevo tus fechas solo hacia adelante, cotizo con Reap y te pido aprobación para cada cobro.
                </p>
              )}
              {st.chat.map((m, i) => (
                <div
                  key={i}
                  className={`w-fit max-w-[88%] whitespace-pre-wrap rounded-2xl px-3 py-2 leading-relaxed ${m.role === "user" ? "ml-auto bg-violet-500 text-white" : "bg-white/[0.06] text-violet-50"}`}
                >
                  {m.content}
                </div>
              ))}
              {busy === "chat" && <div className="w-fit rounded-2xl bg-white/[0.06] px-3 py-2 text-violet-100/70">El agente está llamando sus tools…</div>}
            </div>
            <div className="flex flex-wrap gap-1.5 px-3 pb-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="rounded-full border border-violet-200/20 px-2.5 py-1 text-xs text-violet-100 hover:bg-violet-300/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 disabled:opacity-40" onClick={() => send(s)} disabled={!!busy}>
                  {s}
                </button>
              ))}
            </div>
            <form className="flex gap-2 border-t p-3" style={{ borderColor: "var(--line)" }} onSubmit={(e) => { e.preventDefault(); send(input); }}>
              <label htmlFor="chat-in" className="sr-only">Mensaje para el agente</label>
              <input
                id="chat-in"
                className="min-w-0 flex-1 rounded-lg bg-white/[0.06] px-3 py-2 text-sm text-white outline-none placeholder:text-violet-200/60 focus:ring-2 focus:ring-violet-400/60"
                placeholder="Ej. cobra todo el día 16"
                value={input}
                onChange={(e) => setInput(e.target.value)}
              />
              <button className="btn-primary" disabled={!!busy || !input.trim()}>Enviar</button>
            </form>
          </section>

          {/* Línea de tiempo */}
          <section className="panel" aria-labelledby="log-h">
            <div className="border-b px-4 py-3" style={{ borderColor: "var(--line)" }}>
              <h2 id="log-h" className="text-sm font-semibold text-white">Registro del agente y de Reap</h2>
            </div>
            <ol className="max-h-[460px] overflow-y-auto px-4 py-3">
              {st.log.map((e) => (
                <li key={e.id} className="flex gap-3 pb-3 last:pb-0">
                  <div className="flex flex-col items-center">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/[0.06] text-sm" aria-hidden>{toolIcon(e)}</span>
                    <span className="mt-1 w-px flex-1 bg-violet-200/10" aria-hidden />
                  </div>
                  <div className="min-w-0 pb-1 text-xs">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className={`break-words font-medium ${KIND_STYLE[e.kind] || ""}`}>{e.title}</span>
                      {e.simulated && <span className="text-amber-200">SIMULADO</span>}
                    </div>
                    <div className="text-violet-100/55">
                      {new Date(e.at).toLocaleTimeString("es-MX", { hour12: false })} · {e.kind}
                    </div>
                    {e.detail && <div className="mt-0.5 break-words text-violet-100/70">{e.detail}</div>}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>

      {toast && (
        <div role="alert" className="fixed bottom-4 left-1/2 max-w-[90vw] -translate-x-1/2 rounded-xl bg-rose-500 px-4 py-2 text-sm text-white shadow-[0_8px_24px_-6px_rgba(0,0,0,0.6)]">
          {toast}
        </div>
      )}
    </main>
  );
}

function Calendar({ st }: { st: St }) {
  const { y, m } = pd(st.today);
  const months = [{ y, m }, { y: m === 11 ? y + 1 : y, m: (m + 1) % 12 }];
  const moves = st.subs.map((s) => {
    const from = baselineDate(st.today, st.baselineDays?.[s.id] ?? s.billingDay);
    return { s, from, to: s.nextCharge, moved: from !== s.nextCharge };
  });
  const iso = (yy: number, mm: number, d: number) => `${yy}-${String(mm + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  return (
    <section className="panel p-4 md:p-5" aria-labelledby="cal-h">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="cal-h" className="text-sm font-semibold text-white">Calendario de cobros</h2>
        <div className="flex flex-wrap gap-3 text-[11px] text-violet-100/70">
          <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-emerald-400/70" />quincena</span>
          <span><span className="mr-1 inline-block h-2 w-2 rounded-sm border border-dashed border-rose-300/70" />fecha original</span>
          <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-violet-500" />cobro con Ork</span>
        </div>
      </div>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        {months.map(({ y: yy, m: mm }) => {
          const first = new Date(Date.UTC(yy, mm, 1)).getUTCDay();
          const offset = (first + 6) % 7; // semana inicia lunes
          const days = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
          return (
            <div key={`${yy}-${mm}`}>
              <div className="mb-1.5 text-xs font-medium text-violet-100/85">{MONTHS_LONG[mm]} {yy}</div>
              <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-violet-100/55" aria-hidden>
                {["L", "M", "M", "J", "V", "S", "D"].map((d, i) => <div key={i}>{d}</div>)}
              </div>
              <div className="mt-1 grid grid-cols-7 gap-1">
                {Array.from({ length: offset }).map((_, i) => <div key={`e${i}`} />)}
                {Array.from({ length: days }, (_, i) => i + 1).map((d) => {
                  const date = iso(yy, mm, d);
                  const payday = st.paydays.includes(d);
                  const charges = moves.filter((x) => x.to === date);
                  const ghosts = moves.filter((x) => x.moved && x.from === date);
                  const isToday = date === st.today;
                  return (
                    <div
                      key={d}
                      className={`flex min-h-[38px] flex-col items-center rounded-md p-0.5 text-[10px] ${payday ? "bg-emerald-400/15" : "bg-white/[0.03]"} ${isToday ? "ring-1 ring-violet-300" : ""}`}
                      title={[...charges.map((c) => `${c.s.name}: cobro con Ork`), ...ghosts.map((g) => `${g.s.name}: fecha original`)].join(" · ") || undefined}
                    >
                      <span className={payday ? "font-semibold text-emerald-200" : "text-violet-100/60"}>{d}</span>
                      <span className="flex flex-wrap justify-center leading-none">
                        {ghosts.map((g) => <span key={`g${g.s.id}`} className="rounded border border-dashed border-rose-300/60 opacity-60 grayscale">{g.s.emoji}</span>)}
                        {charges.map((c) => <span key={c.s.id} className="rounded bg-violet-500/80 px-px">{c.s.emoji}</span>)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {/* Movimientos: siempre hacia adelante */}
      <ul className="mt-4 space-y-1.5">
        {moves.map(({ s, from, to, moved }) => {
          const gap = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
          return (
            <li key={s.id} className="flex items-center gap-2 text-xs">
              <span aria-hidden className="w-5 text-center">{s.emoji}</span>
              <span className={`w-14 tabular-nums ${moved ? "text-rose-200/75 line-through" : "text-violet-50"}`}>{short(from)}</span>
              {moved ? (
                <>
                  <span aria-hidden className="relative h-px flex-1 bg-gradient-to-r from-rose-300/40 to-violet-400">
                    <span className="absolute -right-1 -top-[6px] text-[10px] leading-none text-violet-300">▶</span>
                  </span>
                  <span className="w-14 text-right font-semibold tabular-nums text-white">{short(to)}</span>
                  <span className="w-16 text-right text-violet-200/75">+{gap} días</span>
                  <span className="sr-only">{s.name}: se mueve del {short(from)} al {short(to)}, {gap} días hacia adelante</span>
                </>
              ) : (
                <span className="flex-1 text-violet-100/55">sin cambio</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ApprovalCard({ a, st, busy, cardOk, act }: { a: Approval; st: St; busy: string | null; cardOk: boolean; act: (x: string, e?: Record<string, unknown>, l?: string) => void }) {
  const s = st.subs.find((x) => x.id === a.subId);
  const look: Record<string, { ring: string; pill: string; label: string }> = {
    pendiente: { ring: "border-violet-400/60 glowfade", pill: "bg-violet-500 text-white", label: "Esperando tu aprobación" },
    procesando: { ring: "border-sky-300/40", pill: "bg-sky-400/20 text-sky-100", label: "Procesando" },
    confirmar_en_reap: { ring: "border-sky-300/60", pill: "bg-sky-400/25 text-sky-100", label: "Confirma en Reap" },
    completada: { ring: "border-emerald-400/50", pill: "bg-emerald-400 text-emerald-950", label: "COMPLETED" },
    error: { ring: "border-rose-400/50", pill: "bg-rose-400/25 text-rose-100", label: "Error" },
    bloqueada: { ring: "border-amber-300/50", pill: "bg-amber-300/25 text-amber-100", label: "Bloqueado por límite" },
    rechazada: { ring: "opacity-60", pill: "bg-white/10 text-violet-100/75", label: "Rechazada" },
  };
  const L = look[a.status] || look.procesando;
  const pct = Math.min(100, Math.round((a.quote.total / st.limits.perCycle) * 100));

  return (
    <article className={`panel p-4 ${L.ring}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-white">
            <span aria-hidden>{s?.emoji}</span> {s?.name} <span className="font-normal text-violet-100/65">· {s?.merchant}</span>
          </h3>
          <div className="text-xs text-violet-100/70">{a.reason}</div>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${L.pill}`}>{L.label}</span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <Cell k="Producto" v={money(a.quote.subtotal)} />
        <Cell k={`Envío${a.quote.shippingName ? ` · ${a.quote.shippingName}` : ""}`} v={money(a.quote.shipping)} />
        <Cell k="Impuestos" v={money(a.quote.tax)} />
        <Cell k="Total" v={`${money(a.quote.total)} ${a.quote.currency}`} strong />
      </dl>
      <div className="mt-2 text-[11px] text-violet-100/65">
        Usa {pct}% del límite por cobro ({money(st.limits.perCycle)}) · cotización <code className="font-mono">{a.quote.quoteId.slice(0, 8)}…</code>
        {a.quote.expiresAt && a.status === "pendiente" && ` · caduca ${new Date(a.quote.expiresAt).toLocaleTimeString("es-MX", { hour12: false })}`}
        {a.quote.simulated && <span className="text-amber-200"> · SIMULADO</span>}
      </div>

      {a.status === "completada" && (
        <div className="mt-3 break-words rounded-xl bg-emerald-400/10 px-3 py-2 text-xs text-emerald-100">
          Checkout <b>COMPLETED</b> · finalAmount <b>{money(a.finalAmount ?? a.quote.total)}</b> · orderId <code className="font-mono">{a.orderId}</code>
          {a.quote.simulated && <span className="text-amber-200"> · SIMULADO</span>}
        </div>
      )}
      {a.limitWarning && <div className="mt-3 rounded-xl bg-amber-300/10 px-3 py-2 text-xs text-amber-100">Control de gasto: {a.limitWarning}</div>}
      {a.error && <div className="mt-3 rounded-xl bg-rose-400/10 px-3 py-2 text-xs text-rose-100">{a.error}</div>}

      {a.status === "confirmar_en_reap" && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {a.actionUrl && <a className="btn bg-sky-300 text-sky-950 hover:bg-sky-200" href={a.actionUrl} target="_blank" rel="noreferrer">Confirmar pago en Reap ↗</a>}
          <span className="text-xs text-sky-100/85" role="status">Esperando que Reap marque el pago como COMPLETED…</span>
        </div>
      )}
      {a.status === "pendiente" && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button className="btn-ok" disabled={!!busy} onClick={() => act("approve", { approvalId: a.id }, "approve")}>
            {busy === "approve" ? "Cobrando con Reap…" : `Aprobar ${money(a.quote.total)}`}
          </button>
          <button className="btn-ghost" disabled={!!busy} onClick={() => act("reject", { approvalId: a.id })}>Rechazar</button>
          {!cardOk && !a.quote.simulated && <span className="text-xs text-amber-200">Registra la tarjeta antes de aprobar.</span>}
        </div>
      )}
    </article>
  );
}

function Cell({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="rounded-lg bg-white/[0.04] p-2">
      <dt className="truncate text-[11px] text-violet-100/65">{k}</dt>
      <dd className={`tabular-nums ${strong ? "font-bold text-white" : "text-violet-50"}`}>{v}</dd>
    </div>
  );
}
