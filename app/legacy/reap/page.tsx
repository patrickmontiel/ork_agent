"use client";

// ─────────────────────────────────────────────────────────────────────────────
// LEGACY — la pantalla del buildathon de Reap (ex app/page.tsx).
//
// Se conserva tal cual porque FUNCIONA y es la demo del rail agéntico de Reap:
// las 3 suscripciones físicas (café, snacks, limpieza), el chat del agente y el
// ciclo de cobro simulado. Eso sigue siendo el mejor ejemplo del rol "puente".
//
// No es el producto de v2: Ork v2 arranca en / y orquesta servicios cerrados
// (Spotify, Netflix) con mandato, trade-off en números y cobro por evento.
//
// Si se toca esto, que sea para borrarlo cuando el rail de Reap deje de
// ofrecerse, no para evolucionarlo en paralelo.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from "react";

type Sub = {
  id: string; name: string; emoji: string; merchant: string; merchantType: "corte_duro" | "gracia"; product: string;
  monthlyAmount: number; billingDay: number; nextCharge: string; status: "activa" | "pago_fallido" | "rescatada"; safe: boolean;
};
type Approval = {
  id: string; subId: string; status: string; reason: string; limitWarning?: string; error?: string; orderId?: string; finalAmount?: number;
  actionUrl?: string;
  quote: { subtotal: number; shipping: number; tax: number; total: number; currency: string; simulated: boolean };
};
type Proposal = { subId: string; fromDate: string; toDate: string; targetDay: number; gapDays: number };
type LogE = { id: number; at: string; kind: string; title: string; detail?: string; simulated?: boolean };
type St = {
  today: string; paydays: number[]; limits: { perCycle: number; monthly: number }; spentThisMonth: number; demoMode: boolean;
  enrollment: { id: string; status: string; url?: string; simulated?: boolean } | null;
  subs: Sub[]; approvals: Approval[]; log: LogE[]; chat: { role: string; content: string }[];
  metrics: { total: number; riskyWithoutOrk: number; riskyWithOrk: number };
  evidence: { orderId: string; finalAmount: number; merchant: string }[];
  baselineDays: Record<string, number>; pendingProposals: Proposal[];
};

const EXAMPLES = ["Mi quincena cae el 15 y el 30", "Mi tarjeta corta el día 8", "Cobra todo después de mi corte", "Falló el pago del café"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const dia = (iso: string) => { const [, m, d] = iso.split("-").map(Number); return `${d} de ${MESES[m - 1]}`; };
const money = (n: number) => `$${n.toFixed(2)}`;

const TOOL_ICON: [string, string][] = [
  ["list_subscriptions", "📋"], ["propose_date_change", "🗓️"], ["confirm_date_change", "✅"], ["run_billing_cycle", "💳"],
  ["simulate_failed_payment", "⚠️"], ["rescue_forward", "🛟"], ["COMPLETED", "🟢"],
];
const KIND_ICON: Record<string, string> = { reap: "🔗", usuario: "👤", regla: "⚖️", error: "⛔", sistema: "·", agente: "◆" };
const iconFor = (e: LogE) => TOOL_ICON.find(([k]) => e.title.includes(k))?.[1] ?? KIND_ICON[e.kind] ?? "·";

export default function Home() {
  const [st, setSt] = useState<St | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
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
    } catch { setToast("No hubo conexión con el servidor. Intenta de nuevo."); }
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
      if (j.state) setSt(j.state); else setToast("El agente no respondió. Intenta de nuevo.");
    } catch { setToast("No hubo conexión con el servidor. Intenta de nuevo."); }
    setBusy(null);
  }

  if (!st) return <main className="grid min-h-screen place-items-center text-violet-200/70">Cargando Ork…</main>;

  // ---- La historia en 3 pasos se deriva del estado ----
  const proposals = st.pendingProposals ?? [];
  const improved = st.metrics.riskyWithOrk < st.metrics.riskyWithoutOrk;
  // Hubo cambio si alguna suscripción ya no se cobra en su día original (quincena, corte, nómina o día elegido).
  const changed = st.metrics.riskyWithOrk < st.metrics.riskyWithoutOrk || st.subs.some((s) => (st.baselineDays?.[s.id] ?? s.billingDay) !== s.billingDay);
  const current = st.approvals.find((a) => !dismissed.includes(a.id) && a.status !== "rechazada");
  const paid = st.approvals.some((a) => a.status === "completada");
  const step1: StepState = proposals.length || changed ? "done" : "active";
  const step2: StepState = proposals.length ? "active" : changed ? "done" : "todo";
  const step3: StepState = current && current.status !== "completada" ? "active" : paid ? "done" : changed && !proposals.length ? "active" : "todo";
  const cardOk = st.enrollment?.status === "ACTIVE";

  return (
    <main className="mx-auto max-w-6xl px-4 pb-16 pt-5 md:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-3xl font-black tracking-[-0.04em] text-white">
          ork<span className="text-violet-400">.</span>
        </span>
        <div className="flex items-center gap-2 text-xs">
          {st.demoMode && <span className="rounded-full bg-amber-300 px-2.5 py-1 font-semibold text-amber-950">Modo demo: simulado</span>}
          <button className="btn-ghost" onClick={() => { setDismissed([]); act("reset"); }}>Reiniciar demo</button>
        </div>
      </header>

      {/* Frase + indicador */}
      <section className="mt-8 text-center md:mt-12">
        <h1 className="mx-auto max-w-3xl text-balance text-3xl font-bold leading-tight tracking-[-0.02em] text-white md:text-5xl">
          Pagas suscripciones que quieres. Ahora se cobran el día que quieres.
        </h1>
        <div className="mt-8" aria-live="polite">
          <div className="text-sm font-medium text-violet-100/80 md:text-base">Cobros que caen antes de tu quincena</div>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 md:gap-x-6">
            {improved && (
              <>
                <span className="text-4xl font-bold tabular-nums text-rose-300/80 line-through decoration-rose-300/50 md:text-6xl">
                  {st.metrics.riskyWithoutOrk} de {st.metrics.total}
                </span>
                <span className="text-3xl text-violet-300 md:text-5xl" aria-hidden>→</span>
              </>
            )}
            <span
              key={st.metrics.riskyWithOrk}
              className={`settle text-5xl font-black tabular-nums tracking-[-0.03em] md:text-7xl ${st.metrics.riskyWithOrk === 0 ? "text-emerald-300" : improved ? "text-white" : "text-rose-300"}`}
            >
              {st.metrics.riskyWithOrk} de {st.metrics.total}
            </span>
          </div>
        </div>
      </section>

      {/* 3 pasos */}
      <ol className="mx-auto mt-10 grid max-w-4xl gap-2 sm:grid-cols-3" aria-label="Pasos del demo">
        <Step n={1} state={step1} label="Dile a Ork cuándo te conviene pagar" />
        <Step n={2} state={step2} label="Revisa y aprueba el cambio" />
        <Step n={3} state={step3} label="Cobra con Reap y confirma" />
      </ol>

      {/* Chat (protagonista) + pantalla de acción */}
      <div className="mt-6 grid gap-5 lg:grid-cols-[1.25fr_1fr]">
        <section className="panel flex min-h-[460px] flex-col" aria-labelledby="chat-h">
          <div className="border-b px-5 py-3" style={{ borderColor: "var(--line)" }}>
            <h2 id="chat-h" className="font-semibold text-white">Habla con el agente</h2>
          </div>
          <div ref={chatBox} className="max-h-[360px] flex-1 space-y-2.5 overflow-y-auto p-5 text-[15px]" aria-live="polite">
            {st.chat.length === 0 && (
              <p className="text-violet-100/80">Hola. Dime cuándo te conviene pagar: tu quincena, el día de tu nómina, el corte de tu tarjeta o un día para cada suscripción. Prueba con un ejemplo:</p>
            )}
            {st.chat.map((m, i) => (
              <div
                key={i}
                className={`w-fit max-w-[88%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 leading-relaxed ${m.role === "user" ? "ml-auto bg-violet-500 text-white" : "bg-white/[0.07] text-violet-50"}`}
              >
                {m.content}
              </div>
            ))}
            {busy === "chat" && <div className="w-fit rounded-2xl bg-white/[0.07] px-4 py-2.5 text-violet-100/75">Pensando…</div>}
          </div>
          <div className="grid gap-2 px-5 pb-3 sm:grid-cols-2">
            {EXAMPLES.map((e) => (
              <button
                key={e}
                onClick={() => send(e)}
                disabled={!!busy}
                className="rounded-xl border border-violet-300/30 bg-violet-400/10 px-3 py-3 text-left text-sm font-medium text-violet-50 transition-colors hover:bg-violet-400/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 disabled:opacity-40"
              >
                “{e}”
              </button>
            ))}
          </div>
          <form className="flex gap-2 border-t p-3" style={{ borderColor: "var(--line)" }} onSubmit={(e) => { e.preventDefault(); send(input); }}>
            <label htmlFor="chat-in" className="sr-only">Escribe al agente</label>
            <input
              id="chat-in"
              className="min-w-0 flex-1 rounded-lg bg-white/[0.07] px-3 py-2.5 text-sm text-white outline-none placeholder:text-violet-200/60 focus:ring-2 focus:ring-violet-400/60"
              placeholder="O escribe, por ejemplo: el café el 20 y la limpieza el 5"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <button className="btn-primary" disabled={!!busy || !input.trim()}>Enviar</button>
          </form>
        </section>

        <ActionPanel
          st={st} busy={busy} current={current} proposals={proposals} cardOk={cardOk} changed={changed}
          act={act} send={send} dismiss={(id) => setDismissed((d) => [...d, id])}
        />
      </div>

      {/* Suscripciones */}
      <section className="mt-10" aria-labelledby="subs-h">
        <h2 id="subs-h" className="text-lg font-semibold text-white">Tus suscripciones</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {st.subs.map((s) => {
            const before = st.baselineDays?.[s.id] ?? s.billingDay;
            const moved = before !== s.billingDay;
            const failed = s.status === "pago_fallido";
            return (
              <article key={s.id} className={`panel flex flex-col p-4 ${failed ? "border-rose-400/60" : ""}`}>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="flex items-center gap-2 font-semibold text-white">
                    <span className="text-2xl" aria-hidden>{s.emoji}</span>{s.name}
                  </h3>
                  <span className="font-semibold tabular-nums text-white">{money(s.monthlyAmount)}</span>
                </div>
                <p className="mt-3 text-[15px] text-violet-50">
                  {moved ? (
                    <>Hoy se cobra el día <b className="text-rose-200 line-through decoration-rose-300/60">{before}</b> → ahora el día <b className="text-emerald-300">{s.billingDay}</b></>
                  ) : (
                    <>Hoy se cobra el día <b>{s.billingDay}</b>{!s.safe && <span className="text-rose-200">, antes de tu quincena</span>}</>
                  )}
                </p>
                <p className="mt-1 text-xs text-violet-100/70">
                  {failed ? "El último pago falló" : `Próximo cobro: ${dia(s.nextCharge)}`}
                </p>
                <div className="mt-4 flex-1" />
                {failed ? (
                  <button className="btn-primary w-full" disabled={!!busy} onClick={() => send(`Rescata ${s.name.toLowerCase()} después de mi quincena`)}>Rescatar pago</button>
                ) : (
                  <button className="btn-primary w-full" disabled={!!busy} onClick={() => act("run_cycle", { subId: s.id }, `cycle-${s.id}`)}>
                    {busy === `cycle-${s.id}` ? "Preguntando el precio…" : "Cobrar ahora"}
                  </button>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <Calendar st={st} />

      {/* Registro técnico, escondido */}
      <details className="panel group mt-10">
        <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 font-medium text-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">
          Ver lo que hizo el agente
          <span className="text-violet-300 transition-transform group-open:rotate-180" aria-hidden>▾</span>
        </summary>
        <ol className="max-h-[480px] overflow-y-auto border-t px-5 py-4" style={{ borderColor: "var(--line)" }}>
          {st.log.map((e) => (
            <li key={e.id} className="flex gap-3 pb-3 text-xs last:pb-0">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/[0.07] text-sm" aria-hidden>{iconFor(e)}</span>
              <div className="min-w-0">
                <div className="break-words font-medium text-violet-50">
                  {e.title}{e.simulated && <span className="ml-1 text-amber-200">simulado</span>}
                </div>
                <div className="text-violet-100/60">{new Date(e.at).toLocaleTimeString("es-MX", { hour12: false })}</div>
                {e.detail && <div className="mt-0.5 break-words text-violet-100/75">{e.detail}</div>}
              </div>
            </li>
          ))}
        </ol>
      </details>

      <footer className="mt-6 flex flex-wrap items-center justify-between gap-3 text-xs text-violet-100/65">
        <span>
          {st.evidence?.[0] && <>Probado con un pago real en Reap: orden <code className="font-mono">{st.evidence[0].orderId}</code> por {money(st.evidence[0].finalAmount)}.</>}
        </span>
        <button className="underline underline-offset-2 hover:text-violet-50" onClick={() => act("demo_mode", { on: !st.demoMode })}>
          {st.demoMode ? "Volver a Reap en vivo" : "Usar respaldo sin conexión (simulado)"}
        </button>
      </footer>

      {toast && (
        <div role="alert" className="fixed bottom-4 left-1/2 max-w-[90vw] -translate-x-1/2 rounded-xl bg-rose-500 px-4 py-2 text-sm text-white shadow-[0_8px_24px_-6px_rgba(0,0,0,0.6)]">
          {toast}
        </div>
      )}
    </main>
  );
}

type StepState = "todo" | "active" | "done";

function Step({ n, state, label }: { n: number; state: StepState; label: string }) {
  const style = {
    active: "border-violet-400 bg-violet-500/15 text-white",
    done: "border-emerald-400/40 bg-emerald-400/5 text-violet-50",
    todo: "border-white/10 text-violet-100/60",
  }[state];
  return (
    <li className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${style}`} aria-current={state === "active" ? "step" : undefined}>
      <span
        className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold ${state === "done" ? "bg-emerald-400 text-emerald-950" : state === "active" ? "bg-violet-500 text-white" : "bg-white/10 text-violet-100/70"}`}
        aria-hidden
      >
        {state === "done" ? "✓" : n}
      </span>
      <span className="text-sm font-medium leading-snug">
        {label}
        <span className="sr-only">{state === "done" ? " (completado)" : state === "active" ? " (paso actual)" : ""}</span>
      </span>
    </li>
  );
}

function ActionPanel({ st, busy, current, proposals, cardOk, changed, act, send, dismiss }: {
  st: St; busy: string | null; current?: Approval; proposals: Proposal[]; cardOk: boolean; changed: boolean;
  act: (a: string, e?: Record<string, unknown>, l?: string) => void; send: (t: string) => void; dismiss: (id: string) => void;
}) {
  const sub = (id: string) => st.subs.find((s) => s.id === id)!;
  const quoting = busy?.startsWith("cycle");
  const limits = `Tu límite: ${money(st.limits.perCycle)} por cobro y ${money(st.limits.monthly)} al mes (llevas ${money(st.spentThisMonth)}).`;

  let body: React.ReactNode;

  if (quoting) {
    body = (
      <Screen kicker="Paso 3" title="Preguntando el precio a Reap…">
        <p className="text-violet-100/80">La tienda calcula envío e impuestos. Puede tardar hasta 45 segundos.</p>
        <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full w-1/3 animate-pulse rounded-full bg-violet-400" /></div>
      </Screen>
    );
  } else if (current?.status === "completada") {
    const s = sub(current.subId);
    body = (
      <Screen kicker="¡Listo!" title={`Pagaste ${money(current.finalAmount ?? current.quote.total)} por ${s.name.toLowerCase()}`} tone="ok">
        <p className="text-emerald-50/90">Reap confirmó el pago.</p>
        <dl className="mt-4 space-y-1 text-sm">
          <div className="flex justify-between gap-3"><dt className="text-emerald-100/70">Número de orden</dt><dd className="break-all text-right font-mono text-white">{current.orderId}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-emerald-100/70">Siguiente cobro</dt><dd className="text-white">{dia(s.nextCharge)}</dd></div>
        </dl>
        {current.quote.simulated && <p className="mt-3 text-xs text-amber-200">Simulado: modo demo sin conexión.</p>}
        <button className="btn-ok mt-5 w-full" onClick={() => dismiss(current.id)}>Listo</button>
      </Screen>
    );
  } else if (current?.status === "confirmar_en_reap") {
    body = (
      <Screen kicker="Paso 3" title="Confirma el pago en Reap">
        <p className="text-violet-100/80">Por seguridad, Reap te pide confirmar este cobro de {money(current.quote.total)}. Aquí se actualiza solo cuando termines.</p>
        {current.actionUrl && <a className="btn mt-5 w-full bg-sky-300 py-3 text-base text-sky-950 hover:bg-sky-200" href={current.actionUrl} target="_blank" rel="noreferrer">Confirmar en Reap ↗</a>}
        <p className="mt-3 text-center text-xs text-violet-100/70" role="status">Esperando la confirmación…</p>
      </Screen>
    );
  } else if (current?.status === "pendiente" || current?.status === "procesando") {
    const s = sub(current.subId);
    body = (
      <Screen kicker="Paso 3" title={`El agente quiere cobrar ${money(current.quote.total)} a ${s.name.toLowerCase()}`}>
        <p className="text-sm text-violet-100/75">
          Producto {money(current.quote.subtotal)} · envío {money(current.quote.shipping)} · impuestos {money(current.quote.tax)}
          {current.quote.simulated && <span className="text-amber-200"> · simulado</span>}
        </p>
        <p className="mt-2 text-sm text-violet-100/75">{limits}</p>
        {!cardOk && !current.quote.simulated ? (
          <CardPrompt st={st} busy={busy} act={act} />
        ) : (
          <div className="mt-5 grid grid-cols-2 gap-2">
            <button className="btn-ok py-3 text-base" disabled={!!busy} onClick={() => act("approve", { approvalId: current.id }, "approve")}>
              {busy === "approve" ? "Cobrando…" : "Aprobar"}
            </button>
            <button className="btn-ghost py-3 text-base" disabled={!!busy} onClick={() => act("reject", { approvalId: current.id })}>Rechazar</button>
          </div>
        )}
      </Screen>
    );
  } else if (current?.status === "bloqueada") {
    body = (
      <Screen kicker="Paso 3" title="Este cobro pasa tu límite de gasto" tone="warn">
        <p className="text-amber-50/90">{money(current.quote.total)} a {sub(current.subId).name.toLowerCase()}. {limits} El agente no puede cambiar tus límites.</p>
        <button className="btn-ghost mt-5 w-full" onClick={() => dismiss(current.id)}>Entendido</button>
      </Screen>
    );
  } else if (current?.status === "error") {
    body = (
      <Screen kicker="Paso 3" title="No se pudo completar el cobro" tone="bad">
        <p className="text-rose-50/90">{current.error?.includes("caduc") ? "El precio venció. Pide el cobro otra vez." : "Reap no aceptó el cobro. Intenta otra vez o usa el respaldo sin conexión."}</p>
        <button className="btn-ghost mt-5 w-full" onClick={() => dismiss(current.id)}>Cerrar</button>
      </Screen>
    );
  } else if (proposals.length) {
    body = (
      <Screen kicker="Paso 2" title="El agente quiere mover tus cobros">
        <ul className="space-y-2">
          {proposals.map((p) => {
            const s = sub(p.subId);
            return (
              <li key={p.subId} className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.05] px-3 py-2 text-sm">
                <span className="text-violet-50"><span aria-hidden>{s.emoji}</span> {s.name}</span>
                <span className="tabular-nums text-violet-50">
                  <span className="text-rose-200 line-through">{dia(p.fromDate)}</span> → <b className="text-emerald-300">{dia(p.toDate)}</b>
                </span>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-sm text-violet-100/75">Solo se mueven hacia adelante y no pagas de más.</p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button className="btn-ok py-3 text-base" disabled={!!busy} onClick={() => send("Sí")}>Aprobar cambio</button>
          <button className="btn-ghost py-3 text-base" disabled={!!busy} onClick={() => send("No")}>Rechazar</button>
        </div>
      </Screen>
    );
  } else if (changed) {
    body = (
      <Screen kicker="Paso 3" title="Tus fechas ya están listas">
        <p className="text-violet-100/80">Ahora cobra una suscripción con Reap: pulsa “Cobrar ahora” en una tarjeta de abajo. Nada se cobra sin tu aprobación.</p>
        {!cardOk && <CardPrompt st={st} busy={busy} act={act} />}
      </Screen>
    );
  } else {
    body = (
      <Screen kicker="Paso 1" title="Dile a Ork cuándo te conviene pagar">
        <p className="text-violet-100/80">Usa tu quincena, tu nómina, el corte de tu tarjeta o un día por suscripción. Toca un ejemplo del chat: Ork propone las fechas y tú decides.</p>
      </Screen>
    );
  }

  return <section className="lg:self-start" aria-live="polite" aria-label="Acción actual">{body}</section>;
}

function Screen({ kicker, title, tone = "base", children }: { kicker: string; title: string; tone?: "base" | "ok" | "warn" | "bad"; children: React.ReactNode }) {
  const t = {
    base: "border-violet-400/50",
    ok: "border-emerald-400/60 bg-emerald-950/30",
    warn: "border-amber-300/60 bg-amber-950/20",
    bad: "border-rose-400/60 bg-rose-950/20",
  }[tone];
  return (
    <div className={`panel glowfade p-6 ${t}`}>
      <div className="text-xs font-semibold text-violet-300">{kicker}</div>
      <h2 className="mt-1 text-balance text-2xl font-bold leading-tight text-white">{title}</h2>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function CardPrompt({ st, busy, act }: { st: St; busy: string | null; act: (a: string, e?: Record<string, unknown>, l?: string) => void }) {
  const waiting = st.enrollment && st.enrollment.status !== "ACTIVE";
  return (
    <div className="mt-5 rounded-xl bg-white/[0.05] p-3 text-sm">
      <p className="text-violet-50">Primero guarda tu tarjeta en Reap. Ork y el agente nunca ven sus datos.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {waiting && st.enrollment?.url && <a className="btn-primary" href={st.enrollment.url} target="_blank" rel="noreferrer">Abrir Reap ↗</a>}
        <button className="btn-ghost" disabled={!!busy} onClick={() => act("register_card", {}, "card")}>
          {busy === "card" ? "Preparando…" : waiting ? "Nuevo enlace" : "Guardar tarjeta"}
        </button>
      </div>
    </div>
  );
}

function Calendar({ st }: { st: St }) {
  const days = Array.from({ length: 31 }, (_, i) => i + 1);
  return (
    <section className="panel mt-10 p-5" aria-labelledby="cal-h">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="cal-h" className="text-lg font-semibold text-white">Tu mes de cobros</h2>
        <div className="flex flex-wrap gap-4 text-xs text-violet-100/75">
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-emerald-400/30 ring-1 ring-emerald-300/60" />Quincena</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded border border-dashed border-rose-300" />Antes</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-violet-500" />Con Ork</span>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-7 gap-1.5">
        {days.map((d) => {
          const payday = st.paydays.includes(d);
          const now = st.subs.filter((s) => s.billingDay === d);
          const before = st.subs.filter((s) => (st.baselineDays?.[s.id] ?? s.billingDay) === d && s.billingDay !== d);
          const label = [
            payday ? "quincena" : "",
            ...now.map((s) => `${s.name} se cobra con Ork`),
            ...before.map((s) => `${s.name} se cobraba antes`),
          ].filter(Boolean).join(", ");
          return (
            <div
              key={d}
              className={`flex min-h-[56px] flex-col rounded-lg p-1.5 ${payday ? "bg-emerald-400/15 ring-1 ring-emerald-300/50" : "bg-white/[0.035]"}`}
              aria-label={`Día ${d}${label ? `: ${label}` : ""}`}
            >
              <span className={`text-xs ${payday ? "font-bold text-emerald-200" : "text-violet-100/70"}`}>{d}</span>
              <span className="mt-auto flex flex-wrap gap-0.5 text-base leading-none">
                {before.map((s) => <span key={`b${s.id}`} className="rounded border border-dashed border-rose-300/70 opacity-50 grayscale" aria-hidden>{s.emoji}</span>)}
                {now.map((s) => <span key={s.id} className="rounded bg-violet-500 px-0.5" aria-hidden>{s.emoji}</span>)}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
