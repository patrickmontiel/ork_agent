"use client";

import Link from "next/link";
import { dayLabel, type DayChoice } from "@/components/DayPicker";
import type { ServicioLigero } from "../types";

export default function StepDone({
  servicio,
  dia,
  siguiente,
}: {
  servicio: ServicioLigero;
  dia: DayChoice;
  siguiente: string;
}) {
  const necesitaMandato = siguiente === "mandato";

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

      {necesitaMandato ? (
        <>
          <div className="mt-6 rounded-card border border-[color:var(--line)] p-4">
            <p className="eyebrow">Falta un paso</p>
            <p className="dim mt-2 text-[13px] leading-relaxed">
              Para mover la fecha de {servicio.nombre}, Ork tiene que cancelar y
              volver a contratar en tu nombre. Eso necesita tu permiso por
              escrito, y lo puedes revocar cuando quieras.
            </p>
          </div>
          <a
            href={`/mandate/${servicio.id}?next=${encodeURIComponent("/cuenta/mandatos")}`}
            className="btn-primary mt-5 w-full"
          >
            Leer y dar permiso
          </a>
          <Link href="/" className="btn-ghost mt-2 w-full">
            Después
          </Link>
        </>
      ) : (
        <Link href="/cuenta/mandatos" className="btn-ghost mt-6 w-full">
          Ver mis permisos
        </Link>
      )}
    </div>
  );
}
