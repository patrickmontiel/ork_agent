import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { getService } from "@/lib/db/repo/services";
import { activeMandate } from "@/lib/db/repo/mandates";
import { currentText } from "@/lib/mandate/texts";
import { safeRedirect } from "@/lib/auth/token";
import Logo from "@/components/brand/Logo";
import MandateConsent from "./MandateConsent";

export const dynamic = "force-dynamic";

export default async function MandatePage({
  params,
  searchParams,
}: {
  params: Promise<{ service: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { service: serviceId } = await params;
  const sp = await searchParams;
  const next = safeRedirect(
    (Array.isArray(sp.next) ? sp.next[0] : sp.next) as string | undefined,
    "/pay",
  );

  const user = await currentUser();
  if (!user) redirect(`/pay?next=${encodeURIComponent(`/mandate/${serviceId}`)}`);

  const service = getService(serviceId);
  const texto = currentText(serviceId);

  if (!service || !texto) {
    return (
      <Shell>
        <h1 className="font-display text-2xl font-bold text-mist">
          Todavía no hay permiso para este servicio
        </h1>
        <p className="dim mt-2 text-[15px] leading-relaxed">
          {service
            ? `${service.name} está en camino, pero Ork aún no puede mover su fecha.`
            : "Ese servicio no existe."}
        </p>
        <a href="/pay" className="btn-ghost mt-7 w-full">
          Volver
        </a>
      </Shell>
    );
  }

  const ya = activeMandate(user.id, service.id, texto.actionType);

  return (
    <Shell>
      <MandateConsent
        texto={texto}
        serviceName={service.name}
        emoji={service.emoji ?? ""}
        yaOtorgado={!!ya}
        volverA={next}
      />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[460px] flex-col px-5 py-8">
      <header className="mb-8">
        <Logo variant="full" className="text-[26px]" />
      </header>
      {children}
      <footer className="dim mt-auto pt-10 text-center text-[12px] leading-relaxed">
        Puedes revocar este permiso cuando quieras desde tu cuenta.
      </footer>
    </main>
  );
}
