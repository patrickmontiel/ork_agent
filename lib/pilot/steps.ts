// Los pasos que la persona hace con sus propias manos.
//
// En el piloto, Ork lee, calcula, avisa el momento exacto y VERIFICA. Los clics
// irreversibles los hace la persona. Estos pasos son esa guía.
//
// Van como datos y no como JSX por dos razones:
//   1. La pantalla los muestra uno por uno, y el correo los manda en texto.
//   2. Cuando exista el adaptador delegado (fase 2 del proyecto), esta misma
//      lista es lo que el agente va a ejecutar. Misma fuente, dos lectores.

export interface Paso {
  titulo: string;
  detalle: string;
  /** Link que abre la pantalla correcta del servicio, si lo hay. */
  url?: string;
  /** Lo que la persona debería estar viendo al terminar el paso. */
  confirmacion?: string;
}

export interface GuiaPasos {
  intro: string;
  pasos: Paso[];
  /** Lo que Ork hará al final, dicho antes de que lo haga. */
  cierre: string;
}

const SPOTIFY_CUENTA = "https://www.spotify.com/mx/account/overview/";
const SPOTIFY_PLANES = "https://www.spotify.com/mx/account/subscription/change/";

export function guiaRecontratar(
  serviceId: string,
  targetDay: number,
  plan: string | null,
  esHoy = true,
): GuiaPasos {
  // El intro NO puede decir "hoy es el día" cuando no lo es: la pantalla ya
  // muestra un aviso arriba diciendo lo contrario, y dos textos que se
  // contradicen enseñan a no leer ninguno.
  const introSpotify = esHoy
    ? "Hoy es el día. Si vuelves a contratar hoy, tu cobro queda fijado en esta fecha cada mes."
    : "Estos son los pasos para cuando llegue el día. Hazlos ese día, no antes, o la fecha no se mueve.";
  const introPausa = esHoy
    ? "Hoy toca reanudar tu suscripción para que la fecha quede donde la quieres."
    : "Estos son los pasos para cuando llegue el día. Hazlos ese día, no antes.";

  if (serviceId === "spotify") {
    return {
      intro: introSpotify,
      pasos: [
        {
          titulo: "Abre tu cuenta de Spotify",
          detalle:
            "Vas a la página real de Spotify. Inicia sesión tú: Ork nunca guarda tu contraseña.",
          url: SPOTIFY_CUENTA,
          confirmacion: "Deberías ver tu cuenta, con el plan en estado gratuito.",
        },
        {
          titulo: "Entra a elegir plan",
          detalle: `Busca la opción de contratar Premium y elige el plan ${plan ?? "que tenías"}.`,
          url: SPOTIFY_PLANES,
          confirmacion: "Deberías ver la lista de planes disponibles.",
        },
        {
          titulo: "Completa el pago",
          detalle:
            "Confirma con tu método de pago. Ork no toca datos de tarjeta: esto lo haces tú, en Spotify.",
          confirmacion: "Spotify debería confirmarte que tu Premium está activo.",
        },
        {
          titulo: "Vuelve aquí",
          detalle:
            "Cuando Spotify te confirme, regresa y toca el botón. Ork va a comprobarlo con el servicio.",
        },
      ],
      cierre: `Ork va a releer tu cuenta y confirmar que el cobro quedó el día ${targetDay}. Si no podemos confirmarlo, te lo decimos — no te vamos a decir que sí hasta estar seguros.`,
    };
  }

  // Netflix y cualquier otro con mecanismo de pausa.
  return {
    intro: introPausa,
    pasos: [
      {
        titulo: "Abre tu cuenta",
        detalle: "Entra tú. Ork nunca guarda tu contraseña.",
        confirmacion: "Deberías ver tu suscripción en pausa.",
      },
      {
        titulo: "Quita la pausa",
        detalle: "Busca la suscripción pausada y reanúdala.",
        confirmacion: "El servicio debería confirmarte que está activa otra vez.",
      },
      {
        titulo: "Vuelve aquí",
        detalle: "Regresa y toca el botón para que Ork lo verifique.",
      },
    ],
    cierre: `Ork va a releer tu cuenta y confirmar que el cobro quedó el día ${targetDay}.`,
  };
}
