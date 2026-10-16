"use client";

import { useEffect, useState } from "react";

// Deshacer, mientras todavía se puede.
//
// La cuenta regresiva no es un adorno: después de undoDeadline la fecha de
// cobro original se pierde para siempre, y eso tiene que verse, no leerse en
// letra chica. Por eso el número grande es el tiempo que queda, no el logo.

interface Props {
  orchestrationId: string;
  serviceName: string;
  serviceId: string;
  /** YYYY-MM-DD. Se puede deshacer durante TODO este día. */
  undoDeadline: string;
  diaOriginal: number | null;
  diaObjetivo: number | null;
  recontratarEl: string | null;
}

/** Fin del día límite en hora del centro de México (UTC-6, sin horario de verano). */
function limiteMs(undoDeadline: string): number {
  return new Date(`${undoDeadline}T23:59:59-06:00`).getTime();
}

function restante(ms: number) {
  const total = Math.max(0, ms);
  const dias = Math.floor(total / 86_400_000);
  const horas = Math.floor((total % 86_400_000) / 3_600_000);
  const min = Math.floor((total % 3_600_000) / 60_000);
  const seg = Math.floor((total % 60_000) / 1000);
  return { total, dias, horas, min, seg };
}

export default function Deshacer(props: Props) {
  const { orchestrationId, serviceName, undoDeadline, diaOriginal, diaObjetivo } = props;

  const [ahora, setAhora] = useState<number | null>(null);
  const [yendo, setYendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);

  // El reloj arranca en el cliente: si se calculara al renderizar en servidor,
  // la hidratación no coincidiría y React lo marcaría como error.
  useEffect(() => {
    setAhora(Date.now());
    const t = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const limite = limiteMs(undoDeadline);
  const r = ahora === null ? null : restante(limite - ahora);
  const vencido = r !== null && r.total === 0;

  async function deshacer() {
    setError(null);
    setYendo(true);
    try {
      const res = await fetch("/api/orchestrate/resubscribe", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orchestrationId }),
      });
      const d = await res.json();
      if (!d.ok) {
        setError(d.error ?? "No pudimos deshacerlo.");
        return;
      }
      setHecho(d.mensaje ?? "Listo, todo quedó como estaba.");
    } catch {
      setError("No hay conexión.");
    } finally {
      setYendo(false);
    }
  }

  if (hecho) {
    return (
      <div className="py-6">
        <div aria-hidden className="glowfade grid h-14 w-14 place-items-center rounded-full bg-primary">
          <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
        <h1 className="font-display mt-6 text-2xl font-bold text-mist">Todo quedó como estaba</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-mist">{hecho}</p>
        <p className="dim mt-4 text-[13px] leading-relaxed">
          No te cobramos nada: no movimos tu fecha.
        </p>
        <a href="/cuenta/mandatos" className="btn-ghost mt-7 w-full">
          Volver
        </a>
      </div>
    );
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-mist">
        ¿Dejamos tu {serviceName} como estaba?
      </h1>
      <p className="dim mt-2 text-[15px] leading-relaxed">
        Cancelamos tu {serviceName} para mover tu fecha de cobro. Todavía puedes echarlo atrás.
      </p>

      {/* ── La cuenta regresiva ── */}
      <section
        aria-live="polite"
        className={`mt-7 rounded-card border p-5 text-center ${
          vencido
            ? "border-danger/50 bg-danger/10"
            : r && r.dias < 1
              ? "border-warn/50 bg-warn/10"
              : "border-[color:var(--line)] bg-white/[0.03]"
        }`}
      >
        <p className="eyebrow">{vencido ? "Se acabó el tiempo" : "Puedes deshacerlo durante"}</p>
        {r === null ? (
          <p className="tnum font-display mt-2 text-3xl font-bold text-mist">—</p>
        ) : vencido ? (
          <p className="font-display mt-2 text-2xl font-bold text-danger">Ya no se puede</p>
        ) : (
          <p className="tnum font-display mt-2 text-[34px] font-bold leading-none text-mist">
            {r.dias > 0 && <>{r.dias}<span className="dim text-lg"> d </span></>}
            {String(r.horas).padStart(2, "0")}
            <span className="dim text-lg"> h </span>
            {String(r.min).padStart(2, "0")}
            <span className="dim text-lg"> m </span>
            {String(r.seg).padStart(2, "0")}
            <span className="dim text-lg"> s</span>
          </p>
        )}
        <p className="dim mt-3 text-[13px] leading-relaxed">
          Hasta el {fechaLarga(undoDeadline)}, que es cuando termina el periodo que ya pagaste.
        </p>
      </section>

      {/* ── Qué pasa si vence. Lo más importante de la pantalla. ── */}
      <section className="mt-5 rounded-card border border-[color:var(--line)] p-4">
        <p className="eyebrow">Qué pasa si se vence</p>
        <ul className="mt-3 flex flex-col gap-2.5 text-[14px] leading-relaxed text-mist">
          <li className="flex gap-2.5">
            <span aria-hidden className="text-danger">·</span>
            <span>
              Tu fecha de cobro de siempre
              {diaOriginal ? <> —el día <span className="tnum">{diaOriginal}</span>— </> : " "}
              <strong>se pierde para siempre</strong>. Ork no puede devolvértela.
            </span>
          </li>
          <li className="flex gap-2.5">
            <span aria-hidden className="text-danger">·</span>
            <span>
              Te quedas sin {serviceName} hasta que vuelvas a contratarlo
              {props.recontratarEl ? <> el {fechaLarga(props.recontratarEl)}</> : null}.
            </span>
          </li>
          <li className="flex gap-2.5">
            <span aria-hidden className="text-danger">·</span>
            <span>
              Si ese día no lo contratas, sigues sin servicio y la fecha podría no quedar
              {diaObjetivo ? <> en el día <span className="tnum">{diaObjetivo}</span></> : null}.
            </span>
          </li>
        </ul>
      </section>

      <p className="dim mt-5 text-[13px] leading-relaxed">
        Si deshaces, todo vuelve a como estaba: tu fecha, tu precio y tu periodo pagado. No te
        cobramos nada.
      </p>

      <button
        type="button"
        onClick={deshacer}
        disabled={yendo || vencido || r === null}
        className="btn-primary mt-5 w-full"
      >
        {vencido ? "Ya no se puede deshacer" : yendo ? "Deshaciendo…" : "Dejar todo como estaba"}
      </button>

      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}

      <a href="/cuenta/mandatos" className="btn-ghost mt-2 w-full">
        No, seguir con el cambio
      </a>
    </div>
  );
}

function fechaLarga(iso: string): string {
  try {
    return new Intl.DateTimeFormat("es-MX", {
      day: "numeric",
      month: "long",
      timeZone: "America/Mexico_City",
    }).format(new Date(`${iso}T12:00:00-06:00`));
  } catch {
    return iso;
  }
}
