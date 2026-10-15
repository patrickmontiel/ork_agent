"use client";

import { dayLabel, type DayChoice } from "@/components/DayPicker";
import type { ServicioLigero } from "../types";

export default function StepDone({
  servicio,
  dia,
}: {
  servicio: ServicioLigero;
  dia: DayChoice;
}) {
  const esCerrado = servicio.rol === "cerrado";

  return (
    <div className="py-6">
      <div
        aria-hidden
        className="glowfade grid h-14 w-14 place-items-center rounded-full bg-primary"
      >
        <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </div>

      <h1 className="font-display mt-6 text-2xl font-bold text-mist">Listo</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-mist">
        {servicio.emoji} {servicio.nombre} se va a cobrar{" "}
        <span className="font-semibold text-violet-300">{dayLabel(dia.day)}</span>.
      </p>

      {esCerrado && (
        <div className="mt-6 rounded-card border border-[color:var(--line)] p-4">
          <p className="eyebrow">Lo que sigue</p>
          <p className="dim mt-2 text-[13px] leading-relaxed">
            Para mover la fecha de {servicio.nombre}, Ork necesita tu permiso por
            escrito y te va a mostrar antes, en números, qué cambia y cuánto
            cuesta. Te escribimos cuando esté listo.
          </p>
        </div>
      )}

      <a href="/" className="btn-ghost mt-6 w-full">
        Ver mis suscripciones
      </a>
    </div>
  );
}
