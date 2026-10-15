"use client";

import { useState } from "react";
import { dayLabel, type DayChoice } from "@/components/DayPicker";
import type { ServicioLigero, TarjetaLigera } from "../types";

export default function StepConfirm({
  servicio,
  dia,
  merchant,
  plan,
  tarjeta,
  onBack,
  onDone,
}: {
  servicio: ServicioLigero;
  dia: DayChoice;
  merchant: string | null;
  plan: string | null;
  tarjeta: TarjetaLigera | null;
  onBack: () => void;
  onDone: (siguiente: string) => void;
}) {
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const esCerrado = servicio.rol === "cerrado";

  async function guardar() {
    setError(null);
    setGuardando(true);
    try {
      const res = await fetch("/api/subscriptions/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceId: servicio.id, desiredDay: dia.day, plan }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? "No pudimos guardarlo.");
        return;
      }
      onDone(data.siguiente ?? "listo");
    } catch {
      setError("No hay conexión. Inténtalo otra vez.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-mist">Confirma</h1>

      <dl className="mt-6 rounded-card border border-[color:var(--line)] px-4">
        <Fila termino="Suscripción" valor={`${servicio.emoji} ${servicio.nombre}`} />
        <Fila termino="Se cobrará" valor={dayLabel(dia.day)} destacado />
        {merchant && <Fila termino="Desde" valor={merchant} />}
        {tarjeta && (
          <Fila
            termino="Con tu tarjeta"
            valor={tarjeta.label}
            aviso={tarjeta.expired ? "Esta tarjeta ya venció" : undefined}
          />
        )}
      </dl>

      {/* Lo que SÍ pasa ahora y lo que NO. Si esto no queda claro aquí, la
          persona cree que ya movimos algo. */}
      <div className="mt-5 rounded-card border border-[color:var(--line)] bg-white/[0.02] p-4">
        <p className="text-[13px] leading-relaxed text-mist">
          Ahora solo guardamos tu elección.
        </p>
        <p className="dim mt-2 text-[13px] leading-relaxed">
          {esCerrado ? (
            <>
              Antes de mover nada, Ork te va a explicar exactamente qué va a
              pasar y cuánto cuesta, en números. Nada se mueve sin que lo
              confirmes.
            </>
          ) : (
            <>
              Ork le avisa la fecha nueva a {servicio.nombre} y el comercio cobra
              ese día. Ork no toca tu dinero.
            </>
          )}
        </p>
      </div>

      {error && (
        <p role="alert" className="mt-4 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="mt-6 flex gap-2">
        <button type="button" onClick={onBack} className="btn-ghost flex-1" disabled={guardando}>
          Atrás
        </button>
        <button type="button" onClick={guardar} className="btn-primary flex-[2]" disabled={guardando}>
          {guardando ? "Guardando…" : "Guardar"}
        </button>
      </div>
    </div>
  );
}

function Fila({
  termino,
  valor,
  destacado,
  aviso,
}: {
  termino: string;
  valor: string;
  destacado?: boolean;
  aviso?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[color:var(--line)] py-3.5 last:border-b-0">
      <dt className="dim shrink-0 text-[13px]">{termino}</dt>
      <dd className="min-w-0 text-right">
        <span className={`text-[15px] ${destacado ? "font-semibold text-violet-300" : "text-mist"}`}>
          {valor}
        </span>
        {aviso && <span className="block text-[12px] text-warn">{aviso}</span>}
      </dd>
    </div>
  );
}
