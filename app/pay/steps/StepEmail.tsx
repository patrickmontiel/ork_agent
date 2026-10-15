"use client";

import { useState } from "react";

const MENSAJE_LINK: Record<string, string> = {
  invalido: "Ese link no es válido. Pide uno nuevo.",
  expirado: "El link venció. Son 15 minutos; pide otro.",
  usado: "Ese link ya se usó. Pide uno nuevo.",
};

export default function StepEmail({
  linkError,
  onSent,
}: {
  linkError: string | null;
  onSent: (email: string, devUrl?: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(
    linkError ? (MENSAJE_LINK[linkError] ?? MENSAJE_LINK.invalido) : null,
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      const res = await fetch("/api/auth/magic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          redirectTo: window.location.pathname + window.location.search,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? "No pudimos enviar el correo.");
        return;
      }
      onSent(email.trim().toLowerCase(), data.devUrl);
    } catch {
      setError("No hay conexión. Inténtalo otra vez.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <h1 className="font-display text-2xl font-bold text-mist">
        ¿Cuál es tu correo?
      </h1>
      <p className="dim mt-2 text-sm leading-relaxed">
        Te mandamos un link para entrar. Sin contraseñas.
      </p>

      <label htmlFor="email" className="eyebrow mt-7 block">
        Correo
      </label>
      <input
        id="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoFocus
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="tu@correo.com"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "email-error" : undefined}
        className="mt-1.5 min-h-touch w-full rounded-control border border-[color:var(--line-strong)] bg-white/[0.04] px-4 text-[16px] text-mist outline-none placeholder:text-[color:var(--text-faint)] focus:border-primary"
      />

      {error && (
        <p id="email-error" role="alert" className="mt-2.5 text-sm text-danger">
          {error}
        </p>
      )}

      <button type="submit" disabled={enviando || !email} className="btn-primary mt-5 w-full">
        {enviando ? "Enviando…" : "Mandar link"}
      </button>
    </form>
  );
}
