import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { listMandates } from "@/lib/db/repo/mandates";
import { getService } from "@/lib/db/repo/services";
import { textByVersion, fullText } from "@/lib/mandate/texts";
import { sha256 } from "@/lib/db";
import Logo from "@/components/brand/Logo";
import MandateList, { type MandatoView } from "./MandateList";

export const dynamic = "force-dynamic";

export default async function MandatosPage() {
  const user = await currentUser();
  if (!user) redirect("/pay?next=%2Fcuenta%2Fmandatos");

  const mandatos: MandatoView[] = listMandates(user.id).map((m) => {
    const service = getService(m.service_id);
    const texto = textByVersion(m.text_version);
    // Si el texto de esa versión ya no hashea igual, alguien lo editó sin subir
    // de versión. Se muestra el aviso en vez de fingir que todo está bien.
    const desincronizado = !texto || sha256(fullText(texto)) !== m.text_hash;

    return {
      id: m.id,
      servicio: service?.name ?? m.service_id,
      emoji: service?.emoji ?? "",
      accion: m.action_type,
      version: m.text_version,
      otorgado: m.timestamp,
      revocado: m.revoked_at,
      ip: m.ip,
      textoFirmado: texto ? [texto.titulo, ...texto.parrafos] : null,
      textoDesincronizado: desincronizado,
    };
  });

  const vigentes = mandatos.filter((m) => !m.revocado).length;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[460px] flex-col px-5 py-8">
      <header className="mb-8">
        <Logo variant="full" className="text-[26px]" />
      </header>

      <h1 className="font-display text-2xl font-bold text-mist">Tus permisos</h1>
      <p className="dim mt-2 text-sm leading-relaxed">
        Lo que autorizaste a Ork a hacer en tu nombre. {vigentes === 0 ? "Ninguno vigente." : vigentes === 1 ? "Uno vigente." : `${vigentes} vigentes.`}{" "}
        Puedes revocar cualquiera cuando quieras.
      </p>

      <div className="mt-7">
        <MandateList mandatos={mandatos} />
      </div>

      <a href="/pay" className="btn-ghost mt-7 w-full">
        Volver
      </a>

      <footer className="dim mt-auto pt-10 text-center text-[12px] leading-relaxed">
        Revocar un permiso no cancela tus suscripciones. Solo le quita a Ork la
        autorización para moverlas.
      </footer>
    </main>
  );
}
