"use client";

import { useEffect, useState } from "react";
import type { Pendiente } from "@/lib/pilot/pendiente";

// La tarjeta de "tienes algo esperando".
//
// Aparece en la portada y en la cuenta, para que nadie dependa de encontrar un
// correo viejo. El reloj corre en el cliente: calcularlo también en el servidor
// daría una discrepancia de hidratación.

interface Props {
  p: Pendiente;
  serviceId: string;
  serviceName: string;
  emoji: string;
  orchestrationId: string;
  undoDeadline: string | null;
  resubDate: string | null;
}

function restante(hastaMs: number) {
  const t = Math.max(0, hastaMs - Date.now());
  return {
    total: t,
    dias: Math.floor(t / 86_400_000),
    horas: Math.floor((t % 86_400_000) / 3_600_000),
    min: Math.floor((t % 3_600_000) / 60_000),
  };
}

export default function PendienteCard({
  p,
  serviceId,
  emoji,
  orchestrationId,
  undoDeadline,
  resubDate,
}: Props) {
  const [r, setR] = useState<ReturnType<typeof restante> | null>(null);

  useEffect(() => {
    if (!p.puedeDeshacer || !undoDeadline) return;
    const hasta = new Date(`${undoDeadline}T23:59:59-06:00`).getTime();
    const tick = () => setR(restante(hasta));
    tick();
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, [p.puedeDeshacer, undoDeadline]);

  const urgente = p.urgencia === "hoy" || p.urgencia === "vencido";

  return (
    <section
      className={`rounded-card border p-5 ${
        p.urgencia === "vencido"
          ? "border-danger/50 bg-danger/10"
          : p.urgencia === "hoy"
            ? "border-warn/50 bg-warn/10"
            : "border-primary bg-primary-soft"
      }`}
    >
      <p className="eyebrow">{urgente ? "Necesita que hagas algo" : "Tienes algo en curso"}</p>

      <h2 className="font-display mt-1 text-lg font-bold leading-snug text-mist">
        {emoji} {p.titulo}
      </h2>
      <p className="dim mt-2 text-[14px] leading-relaxed">{p.detalle}</p>

      {/* El tiempo para deshacer solo aparece si de verdad queda. */}
      {p.puedeDeshacer && r !== null && r.total > 0 && (
        <p className="mt-3 text-[13px] leading-relaxed text-mist">
          Puedes deshacerlo durante{" "}
          <span className="tnum font-semibold text-violet-400">
            {r.dias > 0 ? `${r.dias} d ` : ""}
            {String(r.horas).padStart(2, "0")} h {String(r.min).padStart(2, "0")} m
          </span>
        </p>
      )}

      <div className="mt-4 flex flex-col gap-2">
        {urgente ? (
          <a href={`/orquestar/${serviceId}/recontratar?id=${orchestrationId}`} className="btn-primary w-full">
            Reactivar ahora
          </a>
        ) : (
          <a
            href={`/orquestar/${serviceId}/recontratar?id=${orchestrationId}`}
            className="btn-ghost w-full"
          >
            Ver los pasos {resubDate ? `del ${fechaCorta(resubDate)}` : ""}
          </a>
        )}

        {p.puedeDeshacer && (
          <a
            href={`/orquestar/${serviceId}/deshacer?id=${orchestrationId}`}
            className="btn-ghost w-full"
          >
            Dejar todo como estaba
          </a>
        )}
      </div>
    </section>
  );
}

function fechaCorta(iso: string): string {
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
