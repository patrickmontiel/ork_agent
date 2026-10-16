"use client";

import { useState } from "react";

export default function AdminLogin({ configurado }: { configurado: boolean }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [yendo, setYendo] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setYendo(true);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const d = await res.json();
      if (!d.ok) {
        setError(d.error ?? "No se pudo entrar.");
        return;
      }
      window.location.reload();
    } catch {
      setError("No hay conexión.");
    } finally {
      setYendo(false);
    }
  }

  if (!configurado) {
    return (
      <div className="rounded-card border border-danger/40 bg-danger/10 p-5">
        <p className="text-[15px] leading-relaxed text-mist">
          El admin está cerrado porque no hay <span className="tnum">ADMIN_TOKEN</span> en el
          entorno.
        </p>
        <p className="dim mt-2 text-[13px] leading-relaxed">
          Genera uno y ponlo en <span className="tnum">.env</span>:
          <br />
          <span className="tnum">
            node -e &quot;console.log(require(&apos;crypto&apos;).randomBytes(32).toString(&apos;hex&apos;))&quot;
          </span>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={entrar} className="rounded-card border border-[color:var(--line)] p-5">
      <label htmlFor="admin-token" className="block text-[15px] text-mist">
        Token de admin
      </label>
      <input
        id="admin-token"
        type="password"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        autoComplete="off"
        className="tnum mt-2 min-h-[44px] w-full rounded-control border border-[color:var(--line)] bg-white/[0.03] px-3 text-[14px] text-mist"
      />
      <button type="submit" disabled={yendo || !token} className="btn-primary mt-4 w-full">
        {yendo ? "Entrando…" : "Entrar"}
      </button>
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
