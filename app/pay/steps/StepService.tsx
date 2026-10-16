"use client";

import { useState } from "react";
import type { Catalogo, ServicioLigero } from "../types";

// Elegir qué suscripción mover.
//
// Los tres grupos van separados a propósito. El modelo de confianza de cada uno
// es distinto: en "puente" Ork solo manda una instrucción y el comercio cobra;
// en "cerrado" Ork cancela y recontrata en nombre de la persona, y eso exige
// mandato. Mezclarlos en una sola lista escondería esa diferencia.

export default function StepService({
  catalogo,
  seleccionado,
  onPick,
}: {
  catalogo: Catalogo;
  seleccionado: ServicioLigero | null;
  onPick: (s: ServicioLigero) => void;
}) {
  const [verBloqueados, setVerBloqueados] = useState(false);

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-mist">
        ¿Cuál quieres mover?
      </h1>
      <p className="dim mt-2 text-sm leading-relaxed">
        Elige la suscripción que se te cae antes de tiempo.
      </p>

      <Grupo
        titulo="Tus suscripciones"
        items={catalogo.cerrados}
        seleccionado={seleccionado}
        onPick={onPick}
      />

      {/* Mecanismo definido pero sin adaptador escrito. Se listan para que la
          persona sepa que vienen, y NO se pueden elegir: prometer una fecha
          que no podemos mover es peor que no listarlos. */}
      {catalogo.proximamente.length > 0 && (
        <section className="mt-7">
          <h2 className="eyebrow">Próximamente</h2>
          <p className="dim mt-1 text-[12px] leading-relaxed">
            Ya sabemos cómo moverlos. Todavía no están listos.
          </p>
          <ul className="mt-2.5 flex flex-wrap gap-1.5">
            {catalogo.proximamente.map((s) => (
              <li
                key={s.id}
                className="rounded-pill border border-[color:var(--line)] px-3 py-1.5 text-[13px] text-[color:var(--text-dim)]"
              >
                <span aria-hidden>{s.emoji} </span>
                {s.nombre}
              </li>
            ))}
          </ul>
        </section>
      )}

      {catalogo.puente.length > 0 && (
        <Grupo
          titulo="Comercios con Ork integrado"
          nota="Aquí Ork solo avisa la fecha nueva y el comercio cobra. No cancela nada."
          items={catalogo.puente}
          seleccionado={seleccionado}
          onPick={onPick}
        />
      )}

      {catalogo.bloqueados.length > 0 && (
        <section className="mt-7">
          <button
            type="button"
            onClick={() => setVerBloqueados((v) => !v)}
            aria-expanded={verBloqueados}
            className="eyebrow flex min-h-touch w-full items-center justify-between"
          >
            <span>Lo que no se puede mover ({catalogo.bloqueados.length})</span>
            <span aria-hidden>{verBloqueados ? "−" : "+"}</span>
          </button>

          {verBloqueados && (
            <ul className="mt-2 flex flex-col gap-2">
              {catalogo.bloqueados.map((s) => (
                <li
                  key={s.id}
                  className="rounded-control border border-[color:var(--line)] px-4 py-3"
                >
                  <p className="text-[15px] font-medium text-[color:var(--text-dim)]">
                    <span aria-hidden>{s.emoji} </span>
                    {s.nombre}
                  </p>
                  {s.motivoBloqueo && (
                    <p className="dim mt-1 text-[13px] leading-relaxed">
                      {s.motivoBloqueo}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function Grupo({
  titulo,
  nota,
  items,
  seleccionado,
  onPick,
}: {
  titulo: string;
  nota?: string;
  items: ServicioLigero[];
  seleccionado: ServicioLigero | null;
  onPick: (s: ServicioLigero) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section className="mt-7">
      <h2 className="eyebrow">{titulo}</h2>
      {nota && <p className="dim mt-1 text-[12px] leading-relaxed">{nota}</p>}
      <div className="mt-2.5 flex flex-col gap-2">
        {items.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onPick(s)}
            aria-pressed={seleccionado?.id === s.id}
            className={`flex min-h-touch w-full items-center gap-3 rounded-control border px-4 py-3 text-left transition-colors ${
              seleccionado?.id === s.id
                ? "border-primary bg-primary-soft"
                : "border-[color:var(--line-strong)] hover:bg-violet-500/10"
            }`}
          >
            <span aria-hidden className="text-lg">
              {s.emoji}
            </span>
            <span className="text-[15px] font-medium text-mist">{s.nombre}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
