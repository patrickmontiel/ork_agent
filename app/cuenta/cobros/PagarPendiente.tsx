"use client";

import { useState } from "react";

// Botón para retomar un fee que quedó pendiente de pago. Lo único que hace es
// pedir el link; quién puede cobrarse y por qué lo decide el servidor.

export default function PagarPendiente({ chargeId }: { chargeId: string }) {
  const [yendo, setYendo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pagar() {
    setError(null);
    setYendo(true);
    try {
      const res = await fetch("/api/stripe/fee-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chargeId }),
      });
      const d = await res.json();
      if (!d.ok) {
        setError(d.error ?? "No pudimos abrir el pago.");
        return;
      }
      window.location.href = d.url;
    } catch {
      setError("No hay conexión.");
    } finally {
      setYendo(false);
    }
  }

  return (
    <>
      {/* min-h-[44px]: la misma área táctil mínima que el resto de Ork. */}
      <button
        type="button"
        onClick={pagar}
        disabled={yendo}
        className="mt-1 inline-flex min-h-[44px] items-center justify-center rounded-pill border border-primary px-4 text-[13px] font-medium text-mist disabled:opacity-50"
      >
        {yendo ? "Abriendo…" : "Pagar"}
      </button>
      {error && (
        <p role="alert" className="mt-1 text-[11px] leading-snug text-danger">
          {error}
        </p>
      )}
    </>
  );
}
