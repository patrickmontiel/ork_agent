// Logo de Ork. Tres variantes, una sola fuente de verdad.
//
//   full  → wordmark "ork" + punto morado arriba a la derecha de la k
//   icon  → aro "o" con punto, para avatar y favicon
//   app   → el aro dentro de un cuadrado redondeado, para ícono de app
//
// El punto SIEMPRE es morado primario, incluso en la variante mono: es el
// único elemento de color de la marca y no se apaga.

type Variant = "full" | "icon" | "app";

const PRIMARY = "#6C2EFF";

export function Logo({
  variant = "full",
  className = "",
  mono = false,
  title = "Ork",
}: {
  variant?: Variant;
  className?: string;
  /** Wordmark en un solo color (el punto se mantiene morado). */
  mono?: boolean;
  title?: string;
}) {
  if (variant === "icon") return <IconMark className={className} title={title} />;
  if (variant === "app") return <AppIcon className={className} title={title} />;
  return <Wordmark className={className} mono={mono} title={title} />;
}

/** Wordmark "ork" en minúsculas, sans geométrica bold, con el punto. */
function Wordmark({
  className,
  mono,
  title,
}: {
  className?: string;
  mono?: boolean;
  title: string;
}) {
  return (
    <span
      className={`inline-flex items-start font-display font-bold leading-none tracking-tight ${className}`}
      role="img"
      aria-label={title}
    >
      <span className={mono ? "" : "text-mist"} aria-hidden="true">
        ork
      </span>
      {/* El punto: arriba a la derecha, alineado a la altura de x de la k. */}
      <span
        aria-hidden="true"
        className="ml-[0.08em] mt-[0.1em] inline-block rounded-full"
        style={{
          width: "0.19em",
          height: "0.19em",
          background: PRIMARY,
        }}
      />
    </span>
  );
}

/** Aro "o" con el punto. Escala con el font-size del contenedor. */
function IconMark({ className, title }: { className?: string; title: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      className={className}
      role="img"
      aria-label={title}
      fill="none"
    >
      <title>{title}</title>
      <circle cx="18" cy="22" r="11" stroke="currentColor" strokeWidth="5.5" />
      <circle cx="33.5" cy="8.5" r="4.5" fill={PRIMARY} />
    </svg>
  );
}

/** Ícono de app: el aro sobre cuadrado redondeado navy. */
function AppIcon({ className, title }: { className?: string; title: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label={title}
      fill="none"
    >
      <title>{title}</title>
      <rect width="64" height="64" rx="15" fill="#0B0D17" />
      <circle cx="29" cy="36" r="12" stroke="#FFFFFF" strokeWidth="6" />
      <circle cx="45" cy="21" r="5" fill={PRIMARY} />
    </svg>
  );
}

export default Logo;
