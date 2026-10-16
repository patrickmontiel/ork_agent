"use client";

import { useEffect, useRef, useState } from "react";
import type { MandateText } from "@/lib/mandate/texts";

// Pantalla de consentimiento.
//
// El botón de aceptar está bloqueado hasta que la persona llega al final del
// texto. Añade fricción a propósito: un permiso para cancelar y recontratar la
// suscripción de alguien no se da con un clic reflejo, y si algún día hay una
// disputa, "el botón no se habilitaba hasta el final" es mucho más defendible
// que "estaba ahí, pudo leerlo".
//
// El servidor también lo exige, así que un POST directo tampoco se salta esto.

export default function MandateConsent({
  texto,
  serviceName,
  emoji,
  yaOtorgado,
  volverA,
}: {
  texto: MandateText;
  serviceName: string;
  emoji: string;
  yaOtorgado: boolean;
  volverA: string;
}) {
  const [alFinal, setAlFinal] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(yaOtorgado);
  const finRef = useRef<HTMLDivElement>(null);

  // Observamos un ancla al final del texto en vez de medir scrollTop: funciona
  // igual si el texto cabe sin scroll, si el usuario hace zoom, o si navega con
  // teclado en vez de rueda.
  useEffect(() => {
    const el = finRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setAlFinal(true);
          io.disconnect();
        }
      },
      { threshold: 1 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  async function aceptar() {
    setError(null);
    setEnviando(true);
    try {
      const res = await fetch("/api/mandate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceId: texto.serviceId,
          textVersion: texto.version,
          scrolledToEnd: true,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? "No pudimos registrar el permiso.");
        return;
      }
      setListo(true);
    } catch {
      setError("No hay conexión. Inténtalo otra vez.");
    } finally {
      setEnviando(false);
    }
  }

  if (listo) {
    return (
      <div className="py-6">
        <div aria-hidden className="glowfade grid h-14 w-14 place-items-center rounded-full bg-primary">
          <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
        <h1 className="font-display mt-6 text-2xl font-bold text-mist">Permiso guardado</h1>
        <p className="dim mt-2 text-[15px] leading-relaxed">
          Ork ya puede mover la fecha de {serviceName}. Aun así, antes de cada
          movimiento te va a mostrar en números qué cambia, y nada pasa sin que
          lo confirmes.
        </p>
        <a href={volverA} className="btn-primary mt-7 w-full">
          Continuar
        </a>
        <a href="/cuenta/mandatos" className="btn-ghost mt-2 w-full">
          Ver mis permisos
        </a>
      </div>
    );
  }

  return (
    <div>
      <p className="eyebrow">
        <span aria-hidden>{emoji} </span>
        {serviceName}
      </p>
      <h1 className="font-display mt-2 text-2xl font-bold text-mist">{texto.titulo}</h1>

      <div className="mt-6 flex flex-col gap-4 rounded-card border border-[color:var(--line)] p-5">
        {texto.parrafos.map((p, i) => (
          <p key={i} className="text-[15px] leading-relaxed text-mist">
            {p}
          </p>
        ))}
        {/* Ancla del final. Cuando entra en pantalla, el botón se habilita. */}
        <div ref={finRef} aria-hidden className="h-px w-full" />
      </div>

      {!alFinal && (
        <p className="dim mt-4 flex items-center gap-2 text-[13px]">
          <span aria-hidden>↓</span>
          Lee hasta el final para poder aceptar.
        </p>
      )}

      {error && (
        <p role="alert" className="mt-4 text-sm text-danger">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={aceptar}
        disabled={!alFinal || enviando}
        className="btn-primary mt-5 w-full"
      >
        {enviando ? "Guardando…" : "Acepto"}
      </button>
      <p className="dim mt-2 text-center text-[12px] leading-relaxed">{texto.resumen}</p>

      <a href={volverA} className="btn-ghost mt-4 w-full">
        Ahora no
      </a>

      {/* Para lector de pantalla: el estado del botón cambia sin que nada
          visible lo anuncie. */}
      <p aria-live="polite" className="sr-only">
        {alFinal ? "Ya puedes aceptar el permiso." : "Sigue leyendo para poder aceptar."}
      </p>
    </div>
  );
}
