"use client";

import { useState } from "react";
import type { GuiaPasos } from "@/lib/pilot/steps";

// La fase 2, asistida: Ork guía y verifica; la persona hace los clics.
//
// Un paso por pantalla, a propósito. Esta pantalla se abre desde un correo, muy
// probablemente en el celular y a media cosa, y con los cuatro pasos juntos la
// persona se salta el que importa.
//
// Al final Ork RELEE la cuenta. Si no puede confirmar que la fecha quedó
// movida, lo dice. No hay "listo" sin evidencia.

interface Props {
  orchestrationId: string;
  serviceName: string;
  emoji: string;
  targetDay: number;
  guia: GuiaPasos;
  /** Solo en dev: permite forzar un escenario del mock. */
  scenario?: string;
}

type Resultado = {
  ok: boolean;
  estado: string;
  mensaje: string;
  pasosManuales: string[] | null;
  seQuedoSinServicio: boolean;
  cobro: { url: string; monto: number; moneda: string } | null;
};

export default function Recontratar({
  orchestrationId,
  serviceName,
  emoji,
  targetDay,
  guia,
  scenario,
}: Props) {
  const [i, setI] = useState(0);
  const [verificando, setVerificando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  const total = guia.pasos.length;
  const paso = guia.pasos[i];
  const ultimo = i === total - 1;

  async function verificar() {
    setError(null);
    setVerificando(true);
    try {
      const res = await fetch("/api/orchestrate/resubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orchestrationId, scenario }),
      });
      const d = await res.json();
      if (d.estado === undefined) {
        setError(d.error ?? "No pudimos verificarlo.");
        return;
      }
      setResultado({
        ok: !!d.ok,
        estado: d.estado,
        mensaje: d.mensaje ?? "",
        pasosManuales: d.pasosManuales ?? null,
        seQuedoSinServicio: !!d.seQuedoSinServicio,
        cobro: d.cobro ?? null,
      });
    } catch {
      setError("No hay conexión. Inténtalo otra vez.");
    } finally {
      setVerificando(false);
    }
  }

  if (resultado) return <Resultado r={resultado} serviceName={serviceName} targetDay={targetDay} />;

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-mist">
        {emoji} Reactiva tu {serviceName}
      </h1>
      <p className="dim mt-2 text-[15px] leading-relaxed">{guia.intro}</p>

      {/* Progreso: tres de cuatro, no una barra abstracta. */}
      <div className="mt-7 flex items-center gap-2" aria-hidden>
        {guia.pasos.map((_, n) => (
          <span
            key={n}
            className={`h-1 flex-1 rounded-pill ${n <= i ? "bg-primary" : "bg-white/10"}`}
          />
        ))}
      </div>
      <p className="dim mt-2 text-[12px]">
        Paso {i + 1} de {total}
      </p>

      <section className="mt-5 rounded-card border border-[color:var(--line)] p-5">
        <h2 className="font-display text-lg font-bold text-mist">{paso.titulo}</h2>
        <p className="mt-2 text-[15px] leading-relaxed text-mist">{paso.detalle}</p>

        {paso.url && (
          <a
            href={paso.url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost mt-4 w-full"
          >
            Abrir {serviceName} en otra pestaña
          </a>
        )}

        {paso.confirmacion && (
          <p className="dim mt-4 border-t border-[color:var(--line)] pt-3 text-[13px] leading-relaxed">
            <span className="text-violet-400">Deberías ver:</span> {paso.confirmacion}
          </p>
        )}
      </section>

      {ultimo ? (
        <>
          <p className="dim mt-5 text-[13px] leading-relaxed">{guia.cierre}</p>
          <button
            type="button"
            onClick={verificar}
            disabled={verificando}
            className="btn-primary mt-4 w-full"
          >
            {verificando ? "Comprobando con el servicio…" : "Ya lo hice, compruébalo"}
          </button>
        </>
      ) : (
        <button type="button" onClick={() => setI(i + 1)} className="btn-primary mt-5 w-full">
          Ya hice esto
        </button>
      )}

      {i > 0 && (
        <button
          type="button"
          onClick={() => setI(i - 1)}
          className="btn-ghost mt-2 w-full"
          disabled={verificando}
        >
          Atrás
        </button>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function Resultado({
  r,
  serviceName,
  targetDay,
}: {
  r: Resultado;
  serviceName: string;
  targetDay: number;
}) {
  return (
    <div className="py-6">
      <div
        aria-hidden
        className={`grid h-14 w-14 place-items-center rounded-full ${
          r.ok ? "glowfade bg-primary" : "bg-danger/20"
        }`}
      >
        {r.ok ? (
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
        {r.ok ? "Listo" : "No pudimos confirmarlo"}
      </h1>
      <p className="mt-2 text-[15px] leading-relaxed text-mist">{r.mensaje}</p>

      {r.ok && (
        <p className="mt-4 rounded-card border border-[color:var(--line)] bg-white/[0.03] p-4 text-[14px] leading-relaxed text-mist">
          Tu {serviceName} ahora se cobra el día{" "}
          <span className="tnum font-semibold text-violet-400">{targetDay}</span> de cada mes.
        </p>
      )}

      {r.seQuedoSinServicio && (
        <p className="mt-4 rounded-card border border-danger/40 bg-danger/10 p-4 text-[14px] leading-relaxed text-mist">
          Ahora mismo estás sin {serviceName}. Abajo están los pasos para reactivarlo tú, y ya
          avisamos al equipo.
        </p>
      )}

      {r.pasosManuales && (
        <div className="mt-5 rounded-card border border-[color:var(--line)] p-4">
          <p className="eyebrow">Cómo arreglarlo tú</p>
          <ol className="mt-2 flex list-decimal flex-col gap-2 pl-5">
            {r.pasosManuales.map((p, n) => (
              <li key={n} className="text-[14px] leading-relaxed text-mist">
                {p}
              </li>
            ))}
          </ol>
        </div>
      )}

      {r.cobro ? (
        <>
          <p className="dim mt-6 text-[13px] leading-relaxed">
            El cambio se completó, así que ahora sí corresponde la tarifa de Ork: $
            <span className="tnum">{r.cobro.monto}</span> {r.cobro.moneda}.
          </p>
          <a href={r.cobro.url} className="btn-primary mt-3 w-full">
            Pagar ${r.cobro.monto}
          </a>
          <a href="/cuenta/cobros" className="btn-ghost mt-2 w-full">
            Pagarlo después
          </a>
        </>
      ) : (
        <>
          {!r.ok && (
            <p className="dim mt-5 text-[13px] leading-relaxed">
              No te cobramos nada: Ork no cobra un cambio que no se completó.
            </p>
          )}
          <a href="/cuenta/mandatos" className="btn-ghost mt-6 w-full">
            Volver
          </a>
        </>
      )}
    </div>
  );
}
