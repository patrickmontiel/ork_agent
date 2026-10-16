import { redirect } from "next/navigation";
import Logo from "@/components/brand/Logo";
import Recontratar from "./Recontratar";
import { currentUser } from "@/lib/auth/session";
import { getService } from "@/lib/db/repo/services";
import * as orch from "@/lib/db/repo/orchestrations";
import { guiaRecontratar } from "@/lib/pilot/steps";
import { todayCDMX } from "@/lib/db";
import type { ServiceState } from "@/lib/adapters/types";

export const dynamic = "force-dynamic";

export default async function RecontratarPage({
  params,
  searchParams,
}: {
  params: Promise<{ service: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { service: serviceId } = await params;
  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]?.[0] : sp[k]) as string | undefined;
  const id = one("id");

  const user = await currentUser();
  if (!user) {
    redirect(
      `/pay?next=${encodeURIComponent(`/orquestar/${serviceId}/recontratar?id=${id ?? ""}`)}`,
    );
  }

  const service = getService(serviceId);
  const row = id ? orch.get(id, user.id) : undefined;

  let contenido: React.ReactNode;

  if (!service || !row) {
    contenido = (
      <Aviso titulo="No encontramos esa operación">
        Puede que el link sea viejo. Desde tu cuenta puedes ver en qué va todo.
      </Aviso>
    );
  } else if (row.state === "completado") {
    contenido = (
      <Aviso titulo="Esto ya está hecho">
        Tu {service.name} ya se cobra el día {row.to_day}. No hay nada más que hacer.
      </Aviso>
    );
  } else if (row.state === "abandonado") {
    contenido = (
      <Aviso titulo="Pasó demasiado tiempo" tono="malo">
        Ya pasó bastante desde la fecha en que tocaba recontratar, así que los números que te
        mostramos ya no sirven. Empieza de nuevo y te calculamos todo otra vez.
      </Aviso>
    );
  } else if (row.state !== "esperando_recontrato") {
    contenido = (
      <Aviso titulo="Esta operación ya no está en curso">
        Revisa tu cuenta para ver en qué quedó.
      </Aviso>
    );
  } else {
    const prior = leerPrior(row.prior_state_json);
    const hoy = todayCDMX();
    const antesDeTiempo = !!row.to_date && hoy < row.to_date;

    contenido = (
      <>
        {antesDeTiempo && (
          <p className="mb-5 rounded-card border border-warn/40 bg-warn/10 p-4 text-[14px] leading-relaxed text-mist">
            Ojo: todavía no es el día. Si vuelves a contratar hoy, tu fecha de cobro{" "}
            <strong>no se va a mover</strong> y seguirá siendo la de siempre. El día bueno es el{" "}
            {row.to_date}.
          </p>
        )}
        <Recontratar
          orchestrationId={row.id}
          serviceName={service.name}
          emoji={service.emoji ?? ""}
          targetDay={row.to_day ?? 1}
          guia={guiaRecontratar(service.id, row.to_day ?? 1, prior?.plan ?? null, !antesDeTiempo)}
          scenario={one("escenario")}
        />
      </>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[460px] flex-col px-5 py-8">
      <header className="mb-8">
        <Logo variant="full" className="text-[26px]" />
      </header>
      {contenido}
      <footer className="dim mt-auto pt-10 text-center text-[12px] leading-relaxed">
        Ork nunca te pide tu contraseña. Los pasos los haces tú, en la página del servicio.
      </footer>
    </main>
  );
}

function leerPrior(json: string | null): ServiceState | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as ServiceState;
  } catch {
    return null;
  }
}

function Aviso({
  titulo,
  tono = "neutro",
  children,
}: {
  titulo: string;
  tono?: "neutro" | "malo";
  children: React.ReactNode;
}) {
  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-mist">{titulo}</h1>
      <p
        className={`mt-4 rounded-card border p-4 text-[14px] leading-relaxed text-mist ${
          tono === "malo" ? "border-danger/40 bg-danger/10" : "border-[color:var(--line)]"
        }`}
      >
        {children}
      </p>
      <a href="/cuenta/mandatos" className="btn-ghost mt-7 w-full">
        Ver mi cuenta
      </a>
    </div>
  );
}
