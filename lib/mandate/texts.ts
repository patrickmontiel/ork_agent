// Textos de consentimiento, versionados.
//
// Reglas de este archivo:
//
//  1. Un texto publicado NUNCA se edita. Si hay que cambiar una coma, se crea
//     una versión nueva. El mandato guarda el hash del texto que se mostró, así
//     que editar en sitio rompería la correspondencia entre lo que la persona
//     firmó y lo que está escrito aquí.
//  2. El id de versión va en el mandato. Con él y con el hash se puede
//     reconstruir exactamente qué leyó la persona.
//  3. El texto va en español de México, en segunda persona, sin jerga legal
//     que nadie lee.

export interface MandateText {
  version: string;
  serviceId: string;
  actionType: "cancel_resubscribe" | "pause";
  titulo: string;
  /** Párrafos. Se renderizan en orden, con el botón bloqueado hasta el final. */
  parrafos: string[];
  /** Lo que la persona acepta, en una línea, junto al botón. */
  resumen: string;
}

const SPOTIFY_V1: MandateText = {
  version: "spotify.v1",
  serviceId: "spotify",
  actionType: "cancel_resubscribe",
  titulo: "Permiso para mover tu fecha de Spotify",
  parrafos: [
    "Autorizas a Ork a cancelar y volver a contratar tu suscripción de Spotify en la fecha del mes que tú elijas, usando tu propia tarjeta.",
    "Antes de cada movimiento, Ork te explicará qué va a pasar y solo actuará si lo confirmas.",
    "Ork nunca guarda tu contraseña.",
    "Ork no está afiliado a Spotify; si Spotify restringe cuentas por estos cambios, podría afectar la tuya.",
    "Si un recontrato falla, te avisaremos de inmediato y te diremos cómo reactivar.",
    "Puedes revocar esta autorización cuando quieras.",
  ],
  resumen: "Cancelar y volver a contratar Spotify en la fecha que elijas.",
};

const NETFLIX_V1: MandateText = {
  version: "netflix.v1",
  serviceId: "netflix",
  actionType: "pause",
  titulo: "Permiso para mover tu fecha de Netflix",
  parrafos: [
    "Autorizas a Ork a pausar tu suscripción de Netflix y reanudarla en la fecha del mes que tú elijas, usando tu propia tarjeta.",
    "Netflix permite pausar hasta un mes. Al reanudar, ese día se convierte en tu nueva fecha de cobro.",
    "Antes de cada movimiento, Ork te explicará qué va a pasar y solo actuará si lo confirmas.",
    "Mientras esté pausada no vas a poder ver Netflix. Te vamos a decir exactamente cuántos días son antes de hacer nada.",
    "Ork nunca guarda tu contraseña.",
    "Ork no está afiliado a Netflix; si Netflix restringe cuentas por estos cambios, podría afectar la tuya.",
    "Esto no aplica al plan Básico ni a suscripciones que paga alguien más por ti.",
    "Si la reanudación falla, te avisaremos de inmediato y te diremos cómo reactivar.",
    "Puedes revocar esta autorización cuando quieras.",
  ],
  resumen: "Pausar y reanudar Netflix en la fecha que elijas.",
};

/** Versión vigente por servicio. Lo que se muestra a quien firma hoy. */
const VIGENTES: Record<string, MandateText> = {
  spotify: SPOTIFY_V1,
  netflix: NETFLIX_V1,
};

/** Todas las versiones, incluidas las retiradas. Para auditar mandatos viejos. */
const TODAS: Record<string, MandateText> = {
  "spotify.v1": SPOTIFY_V1,
  "netflix.v1": NETFLIX_V1,
};

export function currentText(serviceId: string): MandateText | undefined {
  return VIGENTES[serviceId];
}

export function textByVersion(version: string): MandateText | undefined {
  return TODAS[version];
}

/** El texto completo, tal como se muestra. Es lo que se hashea. */
export function fullText(t: MandateText): string {
  return [t.titulo, ...t.parrafos].join("\n\n");
}

export function servicesWithMandate(): string[] {
  return Object.keys(VIGENTES);
}
