import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { listCharges } from "@/lib/db/repo/charges";
import { reconcileUserCharges } from "@/lib/billing/reconcile";
import Logo from "@/components/brand/Logo";
import PagarPendiente from "./PagarPendiente";

export const dynamic = "force-dynamic";

const ETIQUETA: Record<string, string> = {
  pendiente: "Pendiente de pago",
  pagado: "Pagado",
  fallido: "No se completó",
  cancelado: "Cancelado",
};

export default async function CobrosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const user = await currentUser();
  if (!user) redirect("/pay?next=%2Fcuenta%2Fcobros");

  // Antes de mostrar nada, se le pregunta a Stripe por los cobros pendientes.
  // Sin esto, un webhook perdido —o un localhost al que Stripe no puede
  // llegar— dejaría un cobro pagado marcado como pendiente para siempre.
  await reconcileUserCharges(user);

  const cobros = listCharges(user.id);
  const aviso =
    sp.pago === "ok" ? "Gracias, recibimos tu pago."
    : sp.pago === "cancelado" ? "No completaste el pago. El cambio de fecha sí se hizo."
    : sp.premium === "ok" ? "Ya tienes Premium. Tus cambios de fecha ahora son ilimitados."
    : null;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[460px] flex-col px-5 py-8">
      <header className="mb-8">
        <Logo variant="full" className="text-[26px]" />
      </header>

      <h1 className="font-display text-2xl font-bold text-mist">Tus cobros</h1>
      <p className="dim mt-2 text-sm leading-relaxed">
        Lo que Ork te ha cobrado. Plan actual: <span className="text-mist">{user.plan === "premium" ? "Premium" : "Free"}</span>.
      </p>

      {aviso && (
        <p className="mt-5 rounded-card border border-[color:var(--line)] bg-white/[0.03] p-4 text-[14px] leading-relaxed text-mist">
          {aviso}
        </p>
      )}

      <div className="mt-7">
        {cobros.length === 0 ? (
          <div className="rounded-card border border-[color:var(--line)] p-6 text-center">
            <p className="text-[15px] text-mist">Todavía no te hemos cobrado nada.</p>
            <p className="dim mt-2 text-[13px] leading-relaxed">
              En el plan Free solo se cobra cuando un cambio de fecha se completa.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {cobros.map((c) => (
              <li key={c.id} className="flex items-start justify-between gap-3 rounded-card border border-[color:var(--line)] p-4">
                <div className="min-w-0">
                  <p className="text-[15px] text-mist">
                    {c.kind === "fee" ? "Cambio de fecha" : "Ork Premium"}
                  </p>
                  <p className="dim mt-0.5 text-[12px]">{fecha(c.created_at)}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="tnum text-[15px] text-mist">
                    ${c.amount.toLocaleString("es-MX", { minimumFractionDigits: 2 })}
                  </p>
                  <p className={`text-[12px] ${c.status === "pagado" ? "text-ok" : c.status === "fallido" ? "text-danger" : "dim"}`}>
                    {ETIQUETA[c.status] ?? c.status}
                  </p>
                  {c.kind === "fee" && c.status === "pendiente" && (
                    <PagarPendiente chargeId={c.id} />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <a href="/precios" className="btn-ghost mt-7 w-full">Ver planes</a>

      <footer className="dim mt-auto pt-10 text-center text-[12px] leading-relaxed">
        Ork nunca cobra por un cambio que no se completó.
      </footer>
    </main>
  );
}

function fecha(iso: string): string {
  try {
    return new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeStyle: "short", timeZone: "America/Mexico_City" }).format(new Date(iso));
  } catch { return iso; }
}
