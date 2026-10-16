"use client";

import DayPicker, { type DayChoice } from "@/components/DayPicker";
import type { ServicioLigero } from "../types";

export default function StepDay({
  servicio,
  paydays,
  value,
  onChange,
  onBack,
  onNext,
}: {
  servicio: ServicioLigero;
  paydays: number[];
  value: DayChoice | null;
  onChange: (c: DayChoice) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div>
      <p className="eyebrow mb-3">
        <span aria-hidden>{servicio.emoji} </span>
        {servicio.nombre}
      </p>

      <DayPicker value={value} onChange={onChange} />

      {paydays.length > 0 && (
        <p className="dim mt-4 text-[13px]">
          Nos dijiste que te pagan el{" "}
          <span className="tnum text-mist">{paydays.join(" y el ")}</span>.
        </p>
      )}

      <div className="mt-7 flex gap-2">
        <button type="button" onClick={onBack} className="btn-ghost flex-1">
          Atrás
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!value}
          className="btn-primary flex-[2]"
        >
          Continuar
        </button>
      </div>
    </div>
  );
}
