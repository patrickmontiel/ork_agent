"use client";

export default function StepCheckInbox({
  email,
  devUrl,
  mailMode,
  onBack,
}: {
  email: string;
  devUrl: string | null;
  mailMode: "consola" | "resend";
  onBack: () => void;
}) {
  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-mist">Revisa tu correo</h1>
      <p className="dim mt-2 text-sm leading-relaxed">
        Mandamos un link a <span className="text-mist">{email}</span>. Ábrelo
        para continuar. Vence en 15 minutos.
      </p>

      {/* Modo desarrollo: el correo no sale, se imprime en la terminal. Lo
          mostramos aquí para no tener que ir a buscarlo. */}
      {mailMode === "consola" && devUrl && (
        <div className="mt-6 rounded-card border border-warn/30 bg-warn/5 p-4">
          <p className="eyebrow" style={{ color: "var(--warn)" }}>
            Modo desarrollo
          </p>
          <p className="dim mt-1.5 text-[13px] leading-relaxed">
            No se envió ningún correo: el link se imprimió en la terminal y aquí.
            En el piloto esto sale por Resend.
          </p>
          <a href={devUrl} className="btn-primary mt-3 w-full">
            Entrar con el link
          </a>
        </div>
      )}

      <button type="button" onClick={onBack} className="btn-ghost mt-5 w-full">
        Usar otro correo
      </button>
    </div>
  );
}
