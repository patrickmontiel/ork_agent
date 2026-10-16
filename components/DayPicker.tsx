"use client";

import { useId, useRef, useState } from "react";

// ¿Qué día quieres que se cobre?
//
// No abre con un grid de 1-31. Abre con "¿cuándo te cae tu dinero?", que es la
// pregunta que la persona sí sabe contestar, y son tres opciones en lugar de
// treinta y una. Dos razones:
//
//   1. En 360 px un grid de 7 columnas deja celdas de ~40 px, por debajo del
//      mínimo táctil de 44. El control central del producto quedaría apenas
//      tocable justo en móvil, que es donde ocurre el checkout.
//   2. Nadie piensa "quiero el 22". Piensa "cuando me cae el dinero".
//
// El grid sobrevive detrás de "Otra fecha", como escotilla para quien sí sabe
// qué día quiere.
//
// Semántica: radiogroup con flechas, no 31 tabs. El día resultante va en una
// región aria-live, porque si no, quien usa lector de pantalla cambia de opción
// y nunca se entera de que el día cambió.

export type PaydayKind = "quincenal" | "mensual" | "otra";

export interface DayChoice {
  kind: PaydayKind;
  /** Día del mes en que se cobraría. 32 = último día del mes. */
  day: number;
}

const LAST_DAY = 32;

const PRESETS: Array<{ kind: PaydayKind; label: string; hint: string; day: number }> = [
  { kind: "quincenal", label: "Cada quincena", hint: "los días 15 y 30", day: 16 },
  { kind: "mensual", label: "Una vez al mes", hint: "a fin de mes", day: 2 },
];

export function dayLabel(day: number): string {
  if (day === LAST_DAY) return "el último día del mes";
  return `el día ${day}`;
}

export default function DayPicker({
  value,
  onChange,
  disabled = false,
  legendHidden = false,
}: {
  value: DayChoice | null;
  onChange: (c: DayChoice) => void;
  disabled?: boolean;
  /**
   * Oculta la pregunta A LA VISTA cuando la pantalla ya la hizo como título,
   * para no leerla dos veces. La leyenda sigue en el DOM: el fieldset la
   * necesita para que un lector de pantalla sepa de qué va el grupo.
   */
  legendHidden?: boolean;
}) {
  const [gridOpen, setGridOpen] = useState(value?.kind === "otra");
  const groupId = useId();
  const liveId = `${groupId}-live`;

  const isOther = value?.kind === "otra";

  return (
    <div>
      <fieldset disabled={disabled} className="border-0 p-0">
        <legend
          className={
            legendHidden ? "sr-only" : "font-display text-xl font-bold text-mist"
          }
        >
          ¿Cuándo te cae tu dinero?
        </legend>
        <p className={legendHidden ? "sr-only" : "dim mt-1.5 text-sm"}>
          Ork va a cobrar justo después, cuando sí tengas saldo.
        </p>

        <div
          role="radiogroup"
          aria-labelledby={groupId}
          className="mt-5 flex flex-col gap-2"
        >
          <span id={groupId} className="sr-only">
            Cuándo te cae tu dinero
          </span>

          {PRESETS.map((p) => (
            <Option
              key={p.kind}
              checked={value?.kind === p.kind}
              label={p.label}
              hint={p.hint}
              trailing={`se cobra ${dayLabel(p.day)}`}
              onSelect={() => {
                setGridOpen(false);
                onChange({ kind: p.kind, day: p.day });
              }}
            />
          ))}

          <Option
            checked={isOther}
            label="Otra fecha"
            hint="yo elijo el día"
            trailing={isOther && value ? `se cobra ${dayLabel(value.day)}` : undefined}
            onSelect={() => {
              setGridOpen(true);
              if (!isOther) onChange({ kind: "otra", day: 16 });
            }}
          />
        </div>

        {gridOpen && (
          <DayGrid
            selected={isOther ? value!.day : 16}
            onPick={(d) => onChange({ kind: "otra", day: d })}
          />
        )}
      </fieldset>

      {/* Sin esto, quien usa lector de pantalla cambia de opción y no se entera
          de que el día resultante cambió. */}
      <p id={liveId} aria-live="polite" className="sr-only">
        {value ? `Se cobrará ${dayLabel(value.day)} de cada mes.` : "Sin fecha elegida."}
      </p>
    </div>
  );
}

function Option({
  checked,
  label,
  hint,
  trailing,
  onSelect,
}: {
  checked: boolean;
  label: string;
  hint: string;
  trailing?: string;
  onSelect: () => void;
}) {
  // Sin aria-expanded: no es un atributo válido en role="radio" y los lectores
  // de pantalla lo ignoran o lo anuncian mal. Que el grid aparezca se comunica
  // por la región aria-live que ya dice el día resultante.
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className={`flex min-h-touch w-full items-center justify-between gap-3 rounded-control border px-4 py-3 text-left transition-colors ${
        checked
          ? "border-primary bg-primary-soft"
          : "border-[color:var(--line-strong)] hover:bg-violet-500/10"
      }`}
    >
      <span className="min-w-0">
        <span className="block text-[15px] font-medium text-mist">{label}</span>
        <span className="dim block text-[13px]">{hint}</span>
      </span>
      {trailing && (
        <span className="tnum shrink-0 text-[13px] text-violet-300">{trailing}</span>
      )}
    </button>
  );
}

/**
 * Escotilla: 1 al 28 más "último día".
 * No hay 29, 30 ni 31 a propósito. Esos días no existen en todos los meses, y
 * quien elige "30" termina cobrado el 28 de febrero — dos días ANTES de su
 * quincena, que es justo el problema que Ork existe para evitar. "Último día"
 * dice exactamente lo que va a pasar, todos los meses.
 */
function DayGrid({
  selected,
  onPick,
}: {
  selected: number;
  onPick: (d: number) => void;
}) {
  const days = Array.from({ length: 28 }, (_, i) => i + 1);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function move(from: number, delta: number) {
    const all = [...days, LAST_DAY];
    const i = all.indexOf(from);
    const next = all[Math.min(all.length - 1, Math.max(0, i + delta))];
    onPick(next);
    refs.current[all.indexOf(next)]?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent, day: number) {
    const map: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: 7,
      ArrowUp: -7,
    };
    const delta = map[e.key];
    if (delta === undefined) return;
    e.preventDefault();
    move(day, delta);
  }

  return (
    <div className="mt-3 rounded-card border border-[color:var(--line)] p-3">
      <div role="radiogroup" aria-label="Día del mes" className="grid grid-cols-7 gap-1.5">
        {days.map((d, i) => (
          <button
            key={d}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected === d}
            tabIndex={selected === d ? 0 : -1}
            onKeyDown={(e) => onKeyDown(e, d)}
            onClick={() => onPick(d)}
            className={`tnum grid aspect-square min-h-[40px] place-items-center rounded-lg border text-[13px] transition-colors ${
              selected === d
                ? "border-primary bg-primary text-white"
                : "border-[color:var(--line)] text-violet-100 hover:bg-violet-500/15"
            }`}
          >
            {d}
          </button>
        ))}
      </div>

      <button
        ref={(el) => {
          refs.current[28] = el;
        }}
        type="button"
        role="radio"
        aria-checked={selected === LAST_DAY}
        tabIndex={selected === LAST_DAY ? 0 : -1}
        onKeyDown={(e) => onKeyDown(e, LAST_DAY)}
        onClick={() => onPick(LAST_DAY)}
        className={`mt-2 flex min-h-touch w-full items-center justify-center rounded-control border text-sm transition-colors ${
          selected === LAST_DAY
            ? "border-primary bg-primary text-white"
            : "border-[color:var(--line)] text-violet-100 hover:bg-violet-500/15"
        }`}
      >
        Último día del mes
      </button>

      <p className="dim mt-3 text-[12px] leading-relaxed">
        No ofrecemos 29, 30 ni 31: no existen todos los meses. Si eliges 30, en
        febrero te cobrarían el 28 — antes de tu quincena, que es justo lo que
        Ork evita.
      </p>
    </div>
  );
}
