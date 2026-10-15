import { currentUser, sessionUserId } from "@/lib/auth/session";
import { listCards } from "@/lib/db/repo/cards";
import { listClosed, listBridge, listBlocked } from "@/lib/db/repo/services";
import { paydays } from "@/lib/db/repo/users";
import { mailMode } from "@/lib/mailer";
import Logo from "@/components/brand/Logo";
import PayFlow from "./PayFlow";

export const dynamic = "force-dynamic";

// Página pública del botón: /pay?merchant=...&plan=...
//
// Es el punto de entrada del link "Pagar con Ork — elige tu fecha". No pide
// contraseña: si ya hay sesión, reconoce a la persona y se salta el correo.

export default async function PayPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]?.[0] : sp[k]) as string | undefined;

  const merchant = one("merchant") ?? null;
  const plan = one("plan") ?? null;
  const linkError = one("link") ?? null;

  await sessionUserId();
  const user = await currentUser();

  const catalogo = {
    cerrados: listClosed().map(slim),
    puente: listBridge().map(slim),
    bloqueados: listBlocked().map(slim),
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[460px] flex-col px-5 py-8">
      <header className="mb-8 flex items-center justify-between">
        <Logo variant="full" className="text-[26px]" />
        {merchant && (
          <span className="eyebrow truncate" title={merchant}>
            para {merchant}
          </span>
        )}
      </header>

      <PayFlow
        merchant={merchant}
        plan={plan}
        linkError={linkError}
        mailMode={mailMode()}
        user={
          user
            ? {
                email: user.email,
                plan: user.plan,
                paydays: paydays(user),
                tarjetas: listCards(user.id),
              }
            : null
        }
        catalogo={catalogo}
      />

      <footer className="dim mt-auto pt-10 text-center text-[12px] leading-relaxed">
        Ork nunca guarda tu contraseña ni los datos de tu tarjeta.
      </footer>
    </main>
  );
}

function slim(s: ReturnType<typeof listClosed>[number]) {
  return {
    id: s.id,
    nombre: s.name,
    emoji: s.emoji ?? "",
    rol: s.role,
    mecanismo: s.mechanism,
    motivoBloqueo: s.blocked_reason,
  };
}
