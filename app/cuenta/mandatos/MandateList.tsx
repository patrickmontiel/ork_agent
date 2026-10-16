"use client";

import { useState } from "react";

export interface MandatoView {
  id: string;
  servicio: string;
  emoji: string;
  accion: string;
  version: string;
  otorgado: string;
  revocado: string | null;
  ip: string | null;
  /** El texto exacto que se firmó, reconstruido desde la versión. */
  textoFirmado: string[] | null;
  /** El hash guardado ya no coincide con el texto de esa versión. */
  textoDesincronizado: boolean;
}

export default function MandateList({ mandatos }: { mandatos: MandatoView[] }) {
  if (mandatos.length === 0) {
    return (
      <div className="rounded-card border border-[color:var(--line)] p-6 text-center">
        <p className="text-[15px] text-mist">Todavía no diste ningún permiso.</p>
        <p className="dim mt-2 text-[13px] leading-relaxed">
          Ork te lo va a pedir cuando quieras mover la fecha de un servicio que
          no tiene API, como Spotify o Netflix.
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {mandatos.map((m) => (
        <Item key={m.id} m={m} />
      ))}
    </ul>
  );
}

function Item({ m }: { m: MandatoView }) {
  const [abierto, setAbierto] = useState(false);
  const [revocando, setRevocando] = useState(false);
  const [revocado, setRevocado] = useState(!!m.revocado);
  const [error, setError] = useState<string | null>(null);

  async function revocar() {
    setError(null);
    setRevocando(true);
    try {
      const res = await fetch("/api/mandate", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mandateId: m.id }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? "No pudimos revocarlo.");
        return;
      }
      setRevocado(true);
    } catch {
      setError("No hay conexión. Inténtalo otra vez.");
    } finally {
      setRevocando(false);
    }
  }

  return (
    <li className="rounded-card border border-[color:var(--line)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] font-medium text-mist">
            <span aria-hidden>{m.emoji} </span>
            {m.servicio}
          </p>
          <p className="dim mt-0.5 text-[13px]">
            {m.accion === "pause" ? "Pausar y reanudar" : "Cancelar y recontratar"}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-pill px-2.5 py-1 text-[11px] font-medium ${
            revocado ? "bg-white/10 text-[color:var(--text-dim)]" : "bg-ok/15 text-ok"
          }`}
        >
          {revocado ? "Revocado" : "Vigente"}
        </span>
      </div>

      <dl className="mt-3 flex flex-col gap-1 text-[12px]">
        <Row k="Otorgado" v={fecha(m.otorgado)} />
        {m.revocado && <Row k="Revocado" v={fecha(m.revocado)} />}
        <Row k="Versión del texto" v={m.version} mono />
        {m.ip && <Row k="Desde" v={m.ip} mono />}
      </dl>

      {/* Si el hash guardado no coincide con el texto de esa versión, alguien
          editó el texto sin subir de versión. El mandato deja de valer. */}
      {m.textoDesincronizado && (
        <p className="mt-3 rounded-control border border-warn/30 bg-warn/5 px-3 py-2 text-[12px] leading-relaxed text-warn">
          El texto de esta versión cambió desde que lo firmaste. Por seguridad,
          Ork va a pedirte el permiso de nuevo antes de mover nada.
        </p>
      )}

      {m.textoFirmado && (
        <>
          <button
            type="button"
            onClick={() => setAbierto((v) => !v)}
            aria-expanded={abierto}
            className="eyebrow mt-3 flex min-h-touch w-full items-center justify-between"
          >
            <span>Ver el texto que firmaste</span>
            <span aria-hidden>{abierto ? "−" : "+"}</span>
          </button>
          {abierto && (
            <div className="mt-1 flex flex-col gap-3 rounded-control border border-[color:var(--line)] p-4">
              {m.textoFirmado.map((p, i) => (
                <p key={i} className="text-[13px] leading-relaxed text-[color:var(--text-dim)]">
                  {p}
                </p>
              ))}
            </div>
          )}
        </>
      )}

      {error && (
        <p role="alert" className="mt-3 text-[13px] text-danger">
          {error}
        </p>
      )}

      {!revocado && (
        <button
          type="button"
          onClick={revocar}
          disabled={revocando}
          className="btn-danger mt-3 w-full"
        >
          {revocando ? "Revocando…" : "Revocar permiso"}
        </button>
      )}
    </li>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="dim shrink-0">{k}</dt>
      <dd className={`text-right text-[color:var(--text-dim)] ${mono ? "tnum" : ""}`}>{v}</dd>
    </div>
  );
}

function fecha(iso: string): string {
  try {
    return new Intl.DateTimeFormat("es-MX", {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: "America/Mexico_City",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
