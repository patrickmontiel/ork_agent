import Logo from "@/components/brand/Logo";
import AdminLogin from "./AdminLogin";
import { isAdmin, adminConfigured } from "@/lib/admin/auth";
import { pilotMetrics, recentIncidents, funnel, money, type Verdict } from "@/lib/pilot/metrics";
import { status as pilotStatus } from "@/lib/db/repo/pilot";
import { confusedComments } from "@/lib/db/repo/survey";
import { railLabel } from "@/lib/rails";
import { stripeIsTestMode, stripeEnabled } from "@/lib/stripe/client";
import { mailMode } from "@/lib/mailer";

export const dynamic = "force-dynamic";

// Tablero del piloto.
//
// Lo primero que se ve no es un número bonito: es el estado del interruptor y
// lo que salió mal. Las métricas van después, porque un promedio verde con una
// cuenta restringida abajo es exactamente la forma de no enterarse.

const COLOR: Record<Verdict, string> = {
  bien: "text-ok",
  alerta: "text-warn",
  mal: "text-danger",
  sin_datos: "dim",
};

const ETIQUETA: Record<Verdict, string> = {
  bien: "bien",
  alerta: "ojo",
  mal: "mal",
  sin_datos: "sin datos",
};

export default function AdminPilotPage() {
  if (!isAdmin()) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-[460px] flex-col px-5 py-8">
        <header className="mb-8">
          <Logo variant="full" className="text-[26px]" />
        </header>
        <h1 className="font-display mb-6 text-2xl font-bold text-mist">Piloto</h1>
        <AdminLogin configurado={adminConfigured()} />
      </main>
    );
  }

  const metrics = pilotMetrics();
  const pilot = pilotStatus();
  const f = funnel();
  const m = money();
  const incidentes = recentIncidents(25);
  const confusiones = confusedComments(10);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[720px] flex-col px-5 py-8">
      <header className="mb-8 flex items-center justify-between gap-4">
        <Logo variant="full" className="text-[26px]" />
        <span className="dim text-[12px]">piloto</span>
      </header>

      {/* ── Lo primero: ¿está tocando cuentas reales ahora mismo? ── */}
      <section
        className={`rounded-card border p-5 ${
          pilot.live ? "border-warn/50 bg-warn/10" : "border-[color:var(--line)]"
        }`}
      >
        <p className="eyebrow">Adaptadores</p>
        <p className="mt-1 text-[17px] font-semibold text-mist">
          {pilot.live ? "TOCANDO CUENTAS REALES" : "Modo seguro (mock)"}
        </p>
        <p className="dim mt-1 text-[13px] leading-relaxed">
          {pilot.live
            ? "Cada orquestación entra a la cuenta real de una persona."
            : (pilot.blockedBy ?? "")}
        </p>
        {pilot.killedAt && (
          <p className="mt-3 rounded-control border border-danger/40 bg-danger/10 p-3 text-[13px] leading-relaxed text-mist">
            Apagado automático el {fecha(pilot.killedAt)}: {pilot.killReason}
            <br />
            <span className="dim">Reactivar es manual y pide escribir este motivo exacto.</span>
          </p>
        )}
      </section>

      {/* ── Las 5 métricas ── */}
      <h2 className="font-display mt-9 text-lg font-bold text-mist">Las 5 métricas</h2>
      <ul className="mt-3 flex flex-col gap-2">
        {metrics.map((x) => (
          <li key={x.key} className="rounded-card border border-[color:var(--line)] p-4">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-[15px] text-mist">{x.label}</p>
              <span className={`text-[12px] font-medium ${COLOR[x.verdict]}`}>
                {ETIQUETA[x.verdict]}
              </span>
            </div>
            <p className="mt-1 flex items-baseline gap-2">
              <span className={`tnum font-display text-2xl font-bold ${COLOR[x.verdict]}`}>
                {x.value}
              </span>
              <span className="dim text-[12px]">meta: {x.target}</span>
            </p>
            <p className="dim mt-2 text-[13px] leading-relaxed">{x.detail}</p>
            {x.action && x.verdict !== "bien" && x.verdict !== "sin_datos" && (
              <p className="mt-2 text-[13px] leading-relaxed text-warn">{x.action}</p>
            )}
          </li>
        ))}
      </ul>

      {/* ── Embudo ── */}
      <h2 className="font-display mt-9 text-lg font-bold text-mist">Dónde se cae la gente</h2>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Dato n={f.vieron} t="vieron números" />
        <Dato n={f.confirmaron} t="confirmaron" />
        <Dato n={f.ejecutaron} t="se ejecutaron" />
        <Dato n={f.completaron} t="completadas" />
        <Dato n={f.expiraron} t="expiraron" />
        <Dato n={f.rechazaron} t="dijeron que no" />
      </div>

      {/* ── Dinero ── */}
      <h2 className="font-display mt-9 text-lg font-bold text-mist">Cobros</h2>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Dato n={m.feesPagados} t={`fees pagados · $${m.montoPagado}`} />
        <Dato n={m.feesPendientes} t={`sin pagar · $${m.montoPendiente}`} />
        <Dato n={m.premium} t="premium" />
      </div>
      <p className="dim mt-3 text-[13px] leading-relaxed">
        Un fee pendiente es un link que se generó y nadie pagó. Si son muchos, el modelo de
        cobro por evento no funciona, aunque la orquestación sí.
      </p>

      {/* ── Qué salió mal ── */}
      <h2 className="font-display mt-9 text-lg font-bold text-mist">Lo que salió mal</h2>
      {incidentes.length === 0 ? (
        <p className="dim mt-3 text-[14px]">Nada registrado todavía.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-1.5">
          {incidentes.map((i) => (
            <li
              key={i.id}
              className="rounded-control border border-[color:var(--line)] px-3 py-2.5 text-[13px] leading-relaxed"
            >
              <span
                className={
                  i.severity === "critical" ? "text-danger"
                  : i.severity === "warn" ? "text-warn"
                  : "dim"
                }
              >
                {i.type}
              </span>
              <span className="dim"> · {fecha(i.at)}</span>
              {i.payload && (
                <span className="dim block break-words">{recorta(i.payload, 180)}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* ── Lo que nadie entendió ── */}
      <h2 className="font-display mt-9 text-lg font-bold text-mist">
        Lo que no quedó claro
      </h2>
      {confusiones.length === 0 ? (
        <p className="dim mt-3 text-[14px]">
          Nadie ha dejado comentario después de decir que no entendió.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {confusiones.map((c, i) => (
            <li
              key={i}
              className="rounded-card border border-[color:var(--line)] p-4 text-[14px] leading-relaxed text-mist"
            >
              “{c.comment}”
              <span className="dim block pt-1 text-[12px]">{fecha(c.at)}</span>
            </li>
          ))}
        </ul>
      )}

      {/* ── Entorno ── */}
      <h2 className="font-display mt-9 text-lg font-bold text-mist">Entorno</h2>
      <dl className="mt-3 flex flex-col gap-1.5 text-[13px]">
        <Linea t="Rail de cobro" v={railLabel()} />
        <Linea
          t="Stripe"
          v={
            !stripeEnabled() ? "sin configurar"
            : stripeIsTestMode() ? "modo prueba"
            : "MODO REAL — se cobra dinero de verdad"
          }
          alerta={stripeEnabled() && !stripeIsTestMode()}
        />
        <Linea t="Correo" v={mailMode() === "consola" ? "consola (dev)" : "Resend"} />
        <Linea t="ADAPTER_MODE" v={pilot.envMode} alerta={pilot.envMode === "real"} />
      </dl>

      <footer className="dim mt-auto pt-10 text-center text-[12px] leading-relaxed">
        Cero de cero no es 100%. Donde dice “sin datos”, es que todavía no hay nada que leer.
      </footer>
    </main>
  );
}

function Dato({ n, t }: { n: number; t: string }) {
  return (
    <div className="rounded-card border border-[color:var(--line)] p-3 text-center">
      <p className="tnum font-display text-xl font-bold text-mist">{n}</p>
      <p className="dim mt-0.5 text-[11px] leading-snug">{t}</p>
    </div>
  );
}

function Linea({ t, v, alerta }: { t: string; v: string; alerta?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[color:var(--line)] pb-1.5">
      <dt className="dim">{t}</dt>
      <dd className={alerta ? "text-warn" : "text-mist"}>{v}</dd>
    </div>
  );
}

function recorta(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function fecha(iso: string): string {
  try {
    return new Intl.DateTimeFormat("es-MX", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "America/Mexico_City",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
