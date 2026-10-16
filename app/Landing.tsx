"use client";

import { useState } from "react";
import DayPicker, { dayLabel, type DayChoice } from "@/components/DayPicker";

// La pregunta es el producto.
//
// La landing no abre explicando qué es Ork: abre preguntando cuándo le cae el
// dinero a la persona, que es lo único que ella sabe de memoria y lo único que
// Ork necesita para servir de algo. La explicación viene después, y solo
// porque alguien que ya contestó merece saber en qué se metió.

export default function Landing({
  autenticado,
  diaGuardado,
  servicios,
}: {
  autenticado: boolean;
  diaGuardado: number | null;
  servicios: { id: string; name: string; emoji: string | null }[];
}) {
  const [choice, setChoice] = useState<DayChoice>({
    kind: diaGuardado ? "otra" : "quincenal",
    day: diaGuardado ?? 16,
  });

  return (
    <>
      <h1 className="font-display text-[30px] font-bold leading-[1.15] tracking-tight text-mist">
        ¿Cuándo te cae tu dinero?
      </h1>
      <p className="dim mt-3 text-[15px] leading-relaxed">
        Ork mueve el día en que te cobran tus suscripciones para que caiga justo
        después, cuando sí tienes saldo.
      </p>

      <div className="mt-7">
        <DayPicker value={choice} onChange={setChoice} legendHidden />
      </div>

      <p className="mt-6 rounded-card border border-[color:var(--line)] bg-white/[0.03] p-4 text-[14px] leading-relaxed text-mist">
        Entonces tus cobros se moverían a{" "}
        <span className="font-semibold text-violet-400">{dayLabel(choice.day)}</span>.
      </p>

      <a href={`/pay?dia=${choice.day}`} className="btn-primary mt-5 w-full">
        {autenticado ? "Elegir qué mover" : "Empezar"}
      </a>

      {/* Lo que Ork NO hace. Va arriba del fold a propósito: es la objeción
          real de alguien que acaba de leer "te muevo la fecha de cobro". */}
      <section className="mt-10">
        <p className="eyebrow">Antes de que preguntes</p>
        <ul className="mt-3 flex flex-col gap-2.5">
          {[
            "Ork no toca el dinero de tus suscripciones. Le sigues pagando a Spotify, no a Ork.",
            "Nunca guardamos tu contraseña ni tu tarjeta de ese servicio.",
            "No movemos nada sin que lo autorices una vez y lo confirmes cada vez.",
            "Si el cambio no se completa, no te cobramos nada.",
          ].map((t) => (
            <li key={t} className="flex gap-2.5 text-[14px] leading-relaxed text-mist">
              <span aria-hidden className="text-violet-400">
                ·
              </span>
              {t}
            </li>
          ))}
        </ul>
      </section>

      {/* Cómo funciona, en el orden real. */}
      <section className="mt-10">
        <p className="eyebrow">Cómo funciona</p>
        <ol className="mt-3 flex flex-col gap-3">
          {[
            ["Nos dices cuándo cobras", "Un día, no un formulario."],
            ["Eliges qué servicio mover", "Hoy Spotify y Netflix."],
            ["Te mostramos el costo en números", "Días sin servicio o días de más. Antes de tocar nada."],
            ["Tú confirmas y Ork lo hace", "Y verifica con el servicio que de verdad quedó movido."],
          ].map(([t, d], i) => (
            <li key={t} className="flex gap-3">
              <span className="tnum mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-[color:var(--line)] text-[12px] text-violet-400">
                {i + 1}
              </span>
              <span>
                <span className="block text-[14px] font-medium text-mist">{t}</span>
                <span className="dim block text-[13px] leading-relaxed">{d}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      {servicios.length > 0 && (
        <section className="mt-10">
          <p className="eyebrow">Listos hoy</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {servicios.map((s) => (
              <span
                key={s.id}
                className="rounded-pill border border-[color:var(--line)] px-3 py-1.5 text-[13px] text-mist"
              >
                {s.emoji} {s.name}
              </span>
            ))}
          </div>
          <p className="dim mt-3 text-[13px] leading-relaxed">
            El resto del catálogo está en la pantalla siguiente, marcado como
            próximamente o como no soportado. No prometemos lo que no podemos hacer.
          </p>
        </section>
      )}
    </>
  );
}
