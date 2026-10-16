"use client";

import { useEffect, useState, use } from "react";
import Logo from "@/components/brand/Logo";
import ConfirmTradeoff from "./ConfirmTradeoff";
import type { Tradeoff } from "@/lib/pilot/tradeoff";
import type { PromoVerdict } from "@/lib/pilot/promo";

interface Calculo {
  orquestacion: { id: string; expiraEn: string };
  serviceName: string;
  emoji: string;
  tradeoff: Tradeoff;
  promo: PromoVerdict;
  modo: string;
  aviso: string | null;
  estadoActual: { diaActual: number | null; finPeriodoPagado: string; pagas: number | null; moneda: string };
}

// Arranca la orquestación: pide el cálculo al servidor y muestra el trade-off.
//
// Es cliente porque el POST tiene que ocurrir al abrir la pantalla, y el plazo
// de 15 minutos corre desde ese momento. Calcularlo en el servidor al renderizar
// haría que el reloj empezara antes de que la persona viera nada.

// Desde Next 15, params y searchParams SON promesas, también en componentes de
// cliente. En Next 14 llegaban como objetos planos y use() sobre un objeto
// plano lanzaba; por eso aquí había un envoltorio que aceptaba las dos formas.
//
// Ese envoltorio se fue: llamaba a use() desde una función que no es un hook,
// y encima condicionalmente, que es justo lo que las reglas de hooks prohíben.
// Con Next 15 la ambigüedad ya no existe, así que use() va directo.

export default function OrquestarPage({
  params,
  searchParams,
}: {
  params: Promise<{ service: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { service } = use(params);
  const sp = use(searchParams);
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]?.[0] : sp[k]) as string | undefined;
  const targetDay = Number(one("dia") ?? 16);
  const scenario = one("escenario");

  const [data, setData] = useState<Calculo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [necesitaMandato, setNecesitaMandato] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const res = await fetch("/api/orchestrate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ serviceId: service, targetDay, scenario }),
        });
        const d = await res.json();
        if (!vivo) return;
        if (!d.ok) {
          setError(d.error ?? "No pudimos calcular el cambio.");
          setNecesitaMandato(!!d.necesitaMandato);
          return;
        }
        setData(d);
      } catch {
        if (vivo) setError("No hay conexión.");
      }
    })();
    return () => {
      vivo = false;
    };
  }, [service, targetDay, scenario]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[460px] flex-col px-5 py-8">
      <header className="mb-8">
        <Logo variant="full" className="text-[26px]" />
      </header>

      {!data && !error && (
        <div>
          <p className="eyebrow">Un momento</p>
          <p className="dim mt-2 text-[15px]">Estamos leyendo tu suscripción para darte los números exactos.</p>
          <div className="mt-6 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
          </div>
        </div>
      )}

      {error && (
        <div>
          <h1 className="font-display text-2xl font-bold text-mist">No podemos seguir</h1>
          <p className="dim mt-2 text-[15px] leading-relaxed">{error}</p>
          {necesitaMandato && (
            <a href={`/mandate/${service}?next=${encodeURIComponent(`/orquestar/${service}?dia=${targetDay}`)}`} className="btn-primary mt-6 w-full">
              Dar permiso
            </a>
          )}
          <a href="/cuenta/mandatos" className="btn-ghost mt-2 w-full">Volver</a>
        </div>
      )}

      {data && (
        <ConfirmTradeoff
          orchestrationId={data.orquestacion.id}
          serviceName={data.serviceName}
          emoji={data.emoji}
          targetDay={targetDay}
          tradeoff={data.tradeoff}
          promo={data.promo}
          modo={data.modo}
          aviso={data.aviso}
          estadoActual={data.estadoActual}
          scenario={scenario}
        />
      )}

      <footer className="dim mt-auto pt-10 text-center text-[12px] leading-relaxed">
        Nada se mueve hasta que lo confirmes.
      </footer>
    </main>
  );
}
