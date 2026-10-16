"use client";

import { useState } from "react";

// Una pregunta, sobre algo que la persona acaba de vivir.
//
// Se pregunta igual cuando salió bien y cuando salió mal: si solo se preguntara
// tras los éxitos, la métrica de comprensión mediría la suerte del sistema, no
// la claridad del texto. Y justo quien vio fallar algo que no entendió es quien
// más tiene que decir.
//
// No se puede saltar con silencio ni se insiste: se responde o se ignora.

export default function Encuesta({ orchestrationId }: { orchestrationId: string }) {
  const [respuesta, setRespuesta] = useState<boolean | null>(null);
  const [comentario, setComentario] = useState("");
  const [enviado, setEnviado] = useState(false);
  const [enviando, setEnviando] = useState(false);

  async function enviar(understood: boolean, comment?: string) {
    setEnviando(true);
    try {
      await fetch("/api/survey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orchestrationId, understood, comment }),
      });
      setEnviado(true);
    } catch {
      // Si falla, no se le insiste a la persona: es una encuesta, no un trámite.
      setEnviado(true);
    } finally {
      setEnviando(false);
    }
  }

  if (enviado) {
    return (
      <p className="dim mt-7 rounded-card border border-[color:var(--line)] p-4 text-[13px] leading-relaxed">
        Gracias. Nos sirve más de lo que parece.
      </p>
    );
  }

  // Dijo que no entendió: se le pide que cuente qué, pero puede saltarlo.
  if (respuesta === false) {
    return (
      <div className="mt-7 rounded-card border border-[color:var(--line)] p-4">
        <label htmlFor="q-comentario" className="block text-[14px] leading-relaxed text-mist">
          ¿Qué parte no quedó clara?
        </label>
        <textarea
          id="q-comentario"
          value={comentario}
          onChange={(e) => setComentario(e.target.value)}
          rows={3}
          maxLength={500}
          placeholder="Lo que sea. Nos ayuda a arreglar el texto."
          className="mt-2 w-full rounded-control border border-[color:var(--line)] bg-white/[0.03] p-3 text-[14px] leading-relaxed text-mist placeholder:text-[color:var(--dim)]"
        />
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={enviando}
            onClick={() => enviar(false, comentario)}
            className="btn-primary flex-1"
          >
            Enviar
          </button>
          <button
            type="button"
            disabled={enviando}
            onClick={() => enviar(false)}
            className="btn-ghost min-h-[44px] px-4"
          >
            Saltar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-7 rounded-card border border-[color:var(--line)] p-4">
      <p className="text-[14px] leading-relaxed text-mist">
        Antes de que pasara, ¿entendiste lo que iba a pasar?
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={enviando}
          onClick={() => {
            setRespuesta(true);
            enviar(true);
          }}
          className="btn-ghost min-h-[44px] flex-1"
        >
          Sí
        </button>
        <button
          type="button"
          disabled={enviando}
          onClick={() => setRespuesta(false)}
          className="btn-ghost min-h-[44px] flex-1"
        >
          No del todo
        </button>
      </div>
    </div>
  );
}
