import { redirect } from "next/navigation";
import Logo from "@/components/brand/Logo";
import Deshacer from "./Deshacer";
import { currentUser } from "@/lib/auth/session";
import { getService } from "@/lib/db/repo/services";
import * as orch from "@/lib/db/repo/orchestrations";
import { todayCDMX } from "@/lib/db";
import type { ServiceState } from "@/lib/adapters/types";

export const dynamic = "force-dynamic";

export default async function DeshacerPage({
  params,
  searchParams,
}: {
  params: Promise<{ service: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { service: serviceId } = await params;
  const sp = await searchParams;
  const id = (Array.isArray(sp.id) ? sp.id[0] : sp.id) as string | undefined;

  const user = await currentUser();
  if (!user) {
    redirect(`/pay?next=${encodeURIComponent(`/orquestar/${serviceId}/deshacer?id=${id ?? ""}`)}`);
  }

  const service = getService(serviceId);
  const row = id ? orch.get(id, user.id) : undefined;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[460px] flex-col px-5 py-8">
      <header className="mb-8">
        <Logo variant="full" className="text-[26px]" />
      </header>

      {!service || !row ? (
        <Aviso titulo="No encontramos esa operación">
          Puede que el link sea viejo o que ya no exista. Desde tu cuenta puedes ver en qué va
          todo.
        </Aviso>
      ) : row.state !== "esperando_recontrato" ? (
        <Aviso titulo={tituloPorEstado(row.state)}>{mensajePorEstado(row.state)}</Aviso>
      ) : !row.undo_deadline || todayCDMX() > row.undo_deadline ? (
        <Aviso titulo="Ya no se puede deshacer" tono="malo">
          Tu periodo pagado terminó el {row.undo_deadline ?? "—"}, así que tu fecha de cobro
          anterior ya se perdió. Lo que sí puedes es volver a contratar{" "}
          {row.to_date ? `el ${row.to_date}` : "cuando quieras"} para dejar la fecha donde la
          querías.
        </Aviso>
      ) : (
        <Deshacer
          orchestrationId={row.id}
          serviceId={service.id}
          serviceName={service.name}
          undoDeadline={row.undo_deadline}
          diaOriginal={diaOriginal(row.prior_state_json) ?? row.from_day}
          diaObjetivo={row.to_day}
          recontratarEl={row.to_date}
        />
      )}

      <footer className="dim mt-auto pt-10 text-center text-[12px] leading-relaxed">
        Ork nunca cobra por un cambio que no se completó.
      </footer>
    </main>
  );
}

function diaOriginal(json: string | null): number | null {
  if (!json) return null;
  try {
    return (JSON.parse(json) as ServiceState).billingDay ?? null;
  } catch {
    return null;
  }
}

function tituloPorEstado(estado: string): string {
  if (estado === "completado") return "Esto ya se completó";
  if (estado === "deshecho") return "Ya lo habías deshecho";
  if (estado === "abandonado") return "Pasó demasiado tiempo";
  return "Esta operación ya no está en curso";
}

function mensajePorEstado(estado: string): string {
  if (estado === "completado") return "Tu fecha ya quedó movida, así que no hay nada que deshacer.";
  if (estado === "deshecho") return "Todo quedó como estaba. No te cobramos nada.";
  if (estado === "abandonado")
    return "Ya pasó la fecha en que tocaba recontratar. Empieza de nuevo para ver fechas y números frescos.";
  return "Revisa tu cuenta para ver en qué quedó.";
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
