import Logo from "@/components/brand/Logo";
import Landing from "./Landing";
import { currentUser } from "@/lib/auth/session";
import { paydays } from "@/lib/db/repo/users";
import { listPilot } from "@/lib/db/repo/services";

export const dynamic = "force-dynamic";

// Portada de Ork v2.
//
// La pantalla del buildathon (el rail de Reap con las 3 suscripciones físicas)
// NO se borró: vive en /legacy/reap y sigue funcionando. Esto es otra cosa —
// servicios cerrados, mandato y trade-off en números.

export default async function Home() {
  const user = await currentUser();
  const dias = user ? paydays(user) : [];

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[460px] flex-col px-5 py-8">
      <header className="mb-9 flex items-center justify-between gap-4">
        <Logo variant="full" className="text-[26px]" />
        {user ? (
          <a href="/cuenta/mandatos" className="dim text-[13px] underline-offset-4 hover:underline">
            Tu cuenta
          </a>
        ) : (
          <a href="/pay" className="dim text-[13px] underline-offset-4 hover:underline">
            Entrar
          </a>
        )}
      </header>

      <Landing
        autenticado={!!user}
        diaGuardado={dias.length > 0 ? dias[0] : null}
        servicios={listPilot().map((s) => ({ id: s.id, name: s.name, emoji: s.emoji }))}
      />

      <footer className="dim mt-auto pt-12 text-[12px] leading-relaxed">
        <p>Ork nunca te pide tu contraseña ni guarda tu tarjeta de ese servicio.</p>
        <p className="mt-2">
          <a href="/precios" className="underline-offset-4 hover:underline">
            Precios
          </a>
          {" · "}
          <a href="/legacy/reap" className="underline-offset-4 hover:underline">
            Demo de Reap
          </a>
        </p>
      </footer>
    </main>
  );
}
