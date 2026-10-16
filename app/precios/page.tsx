import { currentUser } from "@/lib/auth/session";
import { feeAmountMXN, premiumAmountMXN, stripeIsTestMode } from "@/lib/stripe/client";
import Logo from "@/components/brand/Logo";
import PlanPicker from "./PlanPicker";

export const dynamic = "force-dynamic";

export default async function PreciosPage() {
  const user = await currentUser();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[460px] flex-col px-5 py-8">
      <header className="mb-8">
        <Logo variant="full" className="text-[26px]" />
      </header>

      <h1 className="font-display text-2xl font-bold text-mist">Cuánto cuesta</h1>
      <p className="dim mt-2 text-sm leading-relaxed">
        Ork no toca el dinero de tus suscripciones. Solo cobra por mover la fecha.
      </p>

      <PlanPicker
        fee={feeAmountMXN()}
        premium={premiumAmountMXN()}
        planActual={user?.plan ?? null}
        autenticado={!!user}
        modoPrueba={stripeIsTestMode()}
      />

      <footer className="dim mt-auto pt-10 text-center text-[12px] leading-relaxed">
        Si un cambio de fecha falla, no se te cobra nada.
      </footer>
    </main>
  );
}
