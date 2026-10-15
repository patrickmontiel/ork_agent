"use client";

import { useState } from "react";
import type { Tradeoff, TradeoffOption } from "@/lib/pilot/tradeoff";
import type { PromoVerdict } from "@/lib/pilot/promo";

// La pantalla donde la persona decide.
//
// Tres reglas que la gobiernan:
//
//  1. El trade-off va en NÚMEROS, siempre. "Unos días" no es un número.
//  2. Confirmación reforzada con 7+ días sin servicio o si se pierde promo:
//     hay que marcar una casilla que repite la consecuencia con sus cifras.
//  3. Cuando se pierde una promo, Ork recomienda NO mover. Es la única vez que
//     el producto se desaconseja a sí mismo, y por eso vale.

export interface Resultado {
  ok: boolean;
  estado: string;
  mensaje: string;
  pasosManuales: string[] | null;
  cuentaRestringida: boolean;
}

export default function ConfirmTradeoff({
  orchestrationId,
  serviceName,
  emoji,
  targetDay,
  tradeoff,
  promo,
  modo,
  aviso,
  estadoActual,
  scenario,
}: {
  orchestrationId: string;
  serviceName: string;
  emoji: string;
  targetDay: number;
  tradeoff: Tradeoff;
  promo: PromoVerdict;
  modo: string;
  aviso: string | null;
  estadoActual: { diaActual: number | null; finPeriodoPagado: string; pagas: number | null; moneda: string };
  scenario?: string;
}) {
  const [opcion, setOpcion] = useState<"esperar" | "adelantar">(tradeoff.recommended);
  const [aceptoReforzada, setAceptoReforzada] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  const elegida: TradeoffOption =
    opcion === "adelantar" && tradeoff.adelantar ? tradeoff.adelantar : tradeoff.esperar;

  const bloqueadoPorReforzada = tradeoff.reinforced && !aceptoReforzada;

  async function confirmar() {
    setError(null);
    setEnviando(true);
    try {
      const res = await fetch("/api/orchestrate", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orchestrationId, option: opcion, scenario }),
      });
      const data = await res.json();
      if (data.expirado) {
        setError(data.error);
        return;
      }
      setResultado({
        ok: data.ok,
        estado: data.estado ?? "error",
        mensaje: data.mensaje ?? data.error ?? "Algo salió mal.",
        pasosManuales: data.pasosManuales ?? null,
        cuentaRestringida: !!data.cuentaRestringida,
      });
    } catch {
      setError("No hay conexión. Inténtalo otra vez.");
    } finally {
      setEnviando(false);
    }
  }

  if (resultado) return <ResultadoVista r={resultado} serviceName={serviceName} />;

  if (tradeoff.alreadyOnTarget) {
    return (
      <div>
        <h1 className="font-display text-2xl font-bold text-mist">Ya se cobra ese día</h1>
        <p className="dim mt-2 text-[15px] leading-relaxed">
          {serviceName} ya se cobra el día {textoDia(targetDay)}. No hay nada que mover.
        </p>
        <a href="/cuenta/mandatos" className="btn-ghost mt-7 w-full">Volver</a>
      </div>
    );
  }

  return (
    <div>
      <p className="eyebrow">
        <span aria-hidden>{emoji} </span>
        {serviceName}
      </p>
      <h1 className="font-display mt-2 text-2xl font-bold text-mist">
        Esto es lo que va a pasar
      </h1>

      {/* Estado actual, para que la comparación tenga de dónde partir. */}
      <dl className="mt-5 rounded-card border border-[color:var(--line)] px-4">
        <Fila t="Hoy se cobra" v={`día ${estadoActual.diaActual ?? "?"}`} />
        <Fila t="Ya pagaste hasta" v={fecha(estadoActual.finPeriodoPagado)} />
        <Fila t="Quieres que se cobre" v={textoDia(targetDay)} destacado />
      </dl>

      {/* Por qué hay que elegir. Sin esto, las dos opciones parecen arbitrarias. */}
      <p className="dim mt-5 text-[13px] leading-relaxed">
        {serviceName} no deja cambiar la fecha directamente. Ork lo hace cancelando
        y volviendo a contratar — pero si reactivamos antes de que termine lo que
        ya pagaste, la fecha no se mueve. Por eso hay dos caminos.
      </p>

      {/* Promo */}
      {promo.known && promo.hasPromo && (
        <Aviso tono="warn" titulo="Vas a perder tu promoción">
          {promo.message}
        </Aviso>
      )}
      {!promo.known && (
        <Aviso tono="info" titulo="No sabemos si tienes promoción">
          {promo.message}
        </Aviso>
      )}

      {/* Las dos opciones, con números */}
      <div role="radiogroup" aria-label="Cómo mover la fecha" className="mt-6 flex flex-col gap-2">
        <Opcion
          checked={opcion === "esperar"}
          onSelect={() => setOpcion("esperar")}
          titulo="Esperar"
          recomendada={tradeoff.recommended === "esperar"}
          lineas={[
            [`${tradeoff.esperar.daysWithoutService}`, tradeoff.esperar.daysWithoutService === 1 ? "día sin servicio" : "días sin servicio"],
            ["$0", "de más"],
          ]}
          detalle={`Vuelves a tener ${serviceName} el ${fecha(tradeoff.esperar.resubDate)}.`}
        />

        {tradeoff.adelantar && (
          <Opcion
            checked={opcion === "adelantar"}
            onSelect={() => setOpcion("adelantar")}
            titulo="Adelantar"
            recomendada={tradeoff.recommended === "adelantar"}
            lineas={[
              ["0", "días sin servicio"],
              [money(tradeoff.adelantar.extraCost, tradeoff.adelantar.currency), "de más"],
            ]}
            detalle={`Pagas otra vez ${tradeoff.adelantar.daysPaidTwice} días que ya habías pagado.`}
          />
        )}
      </div>

      <p className="dim mt-3 text-[13px] leading-relaxed">
        <span className="text-mist">Ork sugiere {tradeoff.recommended === "esperar" ? "esperar" : "adelantar"}.</span>{" "}
        {tradeoff.recommendedReason}
      </p>

      {/* Confirmación reforzada */}
      {tradeoff.reinforced && (
        <div className="mt-6 rounded-card border border-warn/40 bg-warn/5 p-4">
          <p className="eyebrow" style={{ color: "var(--warn)" }}>
            Esto no es menor
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {tradeoff.reinforcedReasons.map((r, i) => (
              <li key={i} className="text-[14px] leading-relaxed text-mist">
                {r}
              </li>
            ))}
          </ul>
          {promo.known && promo.hasPromo && (
            <p className="dim mt-3 text-[13px] leading-relaxed">
              Ork te recomienda <span className="text-mist">no moverla</span>. La
              promoción vale más que la comodidad de la fecha.
            </p>
          )}
          <label className="mt-4 flex min-h-touch cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={aceptoReforzada}
              onChange={(e) => setAceptoReforzada(e.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 accent-[color:var(--primary)]"
            />
            <span className="text-[14px] leading-relaxed text-mist">
              Entiendo y quiero continuar de todos modos.
            </span>
          </label>
        </div>
      )}

      {/* Modo mock: no mentir sobre qué se está ejecutando. */}
      {modo === "mock" && (
        <p className="dim mt-5 rounded-control border border-[color:var(--line)] px-3 py-2 text-[12px] leading-relaxed">
          Simulación. No se va a tocar ninguna cuenta real.
          {aviso ? ` ${aviso}` : ""}
        </p>
      )}

      {error && (
        <p role="alert" className="mt-4 text-sm text-danger">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={confirmar}
        disabled={enviando || bloqueadoPorReforzada}
        className="btn-primary mt-5 w-full"
      >
        {enviando ? "Moviendo…" : `Confirmar: ${elegida.kind === "esperar" ? "esperar" : "adelantar"}`}
      </button>

      <a href="/cuenta/mandatos" className="btn-ghost mt-2 w-full">
        No mover
      </a>

      <p className="dim mt-3 text-center text-[12px] leading-relaxed">
        Tienes 15 minutos para confirmar. Después hay que volver a calcular.
      </p>
    </div>
  );
}

// ─── Piezas ─────────────────────────────────────────────────────────────────

function Opcion({
  checked,
  onSelect,
  titulo,
  recomendada,
  lineas,
  detalle,
}: {
  checked: boolean;
  onSelect: () => void;
  titulo: string;
  recomendada: boolean;
  lineas: Array<[string, string]>;
  detalle: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className={`w-full rounded-control border p-4 text-left transition-colors ${
        checked ? "border-primary bg-primary-soft" : "border-[color:var(--line-strong)] hover:bg-violet-500/10"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[15px] font-medium text-mist">{titulo}</span>
        {recomendada && (
          <span className="rounded-pill bg-violet-500/20 px-2 py-0.5 text-[11px] font-medium text-violet-200">
            sugerida
          </span>
        )}
      </div>
      <div className="mt-2.5 flex gap-5">
        {lineas.map(([n, t], i) => (
          <span key={i}>
            <span className="tnum font-display text-xl font-bold text-mist">{n}</span>{" "}
            <span className="dim text-[13px]">{t}</span>
          </span>
        ))}
      </div>
      <p className="dim mt-2 text-[13px] leading-relaxed">{detalle}</p>
    </button>
  );
}

function Aviso({
  tono,
  titulo,
  children,
}: {
  tono: "warn" | "info";
  titulo: string;
  children: React.ReactNode;
}) {
  const color = tono === "warn" ? "var(--warn)" : "var(--text-faint)";
  return (
    <div
      className="mt-5 rounded-card border p-4"
      style={{ borderColor: tono === "warn" ? "rgba(251,191,36,.3)" : "var(--line)" }}
    >
      <p className="eyebrow" style={{ color }}>
        {titulo}
      </p>
      <p className="dim mt-1.5 text-[13px] leading-relaxed">{children}</p>
    </div>
  );
}

function ResultadoVista({ r, serviceName }: { r: Resultado; serviceName: string }) {
  const bien = r.ok;
  return (
    <div className="py-6">
      <div
        aria-hidden
        className={`grid h-14 w-14 place-items-center rounded-full ${bien ? "glowfade bg-primary" : "bg-danger/20"}`}
      >
        {bien ? (
          <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="var(--danger)" strokeWidth="2.5" strokeLinecap="round">
            <path d="M12 8v5M12 17h.01" />
          </svg>
        )}
      </div>

      <h1 className="font-display mt-6 text-2xl font-bold text-mist">
        {bien ? "Listo" : r.cuentaRestringida ? "Detuvimos todo" : "No se pudo"}
      </h1>
      <p className="mt-2 text-[15px] leading-relaxed text-mist">{r.mensaje}</p>

      {r.pasosManuales && (
        <div className="mt-6 rounded-card border border-[color:var(--line)] p-4">
          <p className="eyebrow">Cómo arreglarlo tú</p>
          <ol className="mt-2 flex list-decimal flex-col gap-2 pl-5">
            {r.pasosManuales.map((p, i) => (
              <li key={i} className="text-[14px] leading-relaxed text-mist">
                {p}
              </li>
            ))}
          </ol>
        </div>
      )}

      {!bien && !r.pasosManuales && (
        <p className="dim mt-4 text-[13px] leading-relaxed">
          Tu {serviceName} quedó como estaba. No te cobramos nada.
        </p>
      )}

      <a href="/cuenta/mandatos" className="btn-ghost mt-7 w-full">
        Volver
      </a>
    </div>
  );
}

function Fila({ t, v, destacado }: { t: string; v: string; destacado?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[color:var(--line)] py-3.5 last:border-b-0">
      <dt className="dim shrink-0 text-[13px]">{t}</dt>
      <dd className={`text-right text-[15px] ${destacado ? "font-semibold text-violet-300" : "text-mist"}`}>
        {v}
      </dd>
    </div>
  );
}

function textoDia(d: number): string {
  return d === 32 ? "el último día del mes" : `el día ${d}`;
}

function money(n: number, currency: string): string {
  const s = n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency === "USD" ? `US$${s}` : `$${s}`;
}

function fecha(iso: string): string {
  try {
    return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "long", timeZone: "UTC" }).format(
      new Date(`${iso}T12:00:00Z`),
    );
  } catch {
    return iso;
  }
}
