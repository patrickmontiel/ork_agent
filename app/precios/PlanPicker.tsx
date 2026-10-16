"use client";

import { useState } from "react";

export default function PlanPicker({
  fee,
  premium,
  planActual,
  autenticado,
  modoPrueba,
}: {
  fee: number;
  premium: number;
  planActual: "free" | "premium" | null;
  autenticado: boolean;
  modoPrueba: boolean;
}) {
  const [yendo, setYendo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function contratar() {
    setError(null);
    setYendo(true);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: "premium" }),
      });
      const d = await res.json();
      if (!d.ok) {
        setError(d.error ?? "No pudimos iniciar el pago.");
        return;
      }
      window.location.href = d.url;
    } catch {
      setError("No hay conexión.");
    } finally {
      setYendo(false);
    }
  }

  const esPremium = planActual === "premium";

  return (
    <div className="mt-8 flex flex-col gap-3">
      <Plan
        nombre="Free"
        precio="$0"
        periodo="al mes"
        actual={planActual === "free"}
        puntos={[
          `${money(fee)} por cada cambio de fecha`,
          "Se cobra solo si el cambio funcionó",
          "Si falla, no pagas nada",
        ]}
      />

      <Plan
        nombre="Premium"
        precio={money(premium)}
        periodo="al mes"
        destacado
        actual={esPremium}
        puntos={[
          "Cambios de fecha ilimitados",
          "Sin cobro por evento",
          "Cancelas cuando quieras",
        ]}
        accion={
          esPremium ? null : (
            <button
              type="button"
              onClick={contratar}
              disabled={yendo || !autenticado}
              className="btn-primary mt-4 w-full"
            >
              {yendo ? "Abriendo…" : autenticado ? "Contratar Premium" : "Entra para contratar"}
            </button>
          )
        }
      />

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      {modoPrueba && (
        <p className="dim rounded-control border border-[color:var(--line)] px-3 py-2 text-[12px] leading-relaxed">
          Modo de prueba de Stripe. Usa la tarjeta <span className="tnum">4242 4242 4242 4242</span>,
          cualquier fecha futura y cualquier CVC. No se cobra dinero real.
        </p>
      )}
    </div>
  );
}

function Plan({
  nombre,
  precio,
  periodo,
  puntos,
  destacado,
  actual,
  accion,
}: {
  nombre: string;
  precio: string;
  periodo: string;
  puntos: string[];
  destacado?: boolean;
  actual?: boolean;
  accion?: React.ReactNode;
}) {
  return (
    <section
      className={`rounded-card border p-5 ${
        destacado ? "border-primary bg-primary-soft" : "border-[color:var(--line)]"
      }`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-lg font-bold text-mist">{nombre}</h2>
        {actual && (
          <span className="rounded-pill bg-ok/15 px-2.5 py-1 text-[11px] font-medium text-ok">
            tu plan
          </span>
        )}
      </div>
      <p className="mt-2">
        <span className="tnum font-display text-3xl font-bold text-mist">{precio}</span>{" "}
        <span className="dim text-[13px]">{periodo}</span>
      </p>
      <ul className="mt-4 flex flex-col gap-2">
        {puntos.map((p, i) => (
          <li key={i} className="flex gap-2.5 text-[14px] leading-relaxed text-mist">
            <span aria-hidden className="text-violet-400">
              ·
            </span>
            {p}
          </li>
        ))}
      </ul>
      {accion}
    </section>
  );
}

function money(n: number): string {
  return `$${n.toLocaleString("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}
