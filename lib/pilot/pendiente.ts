// Qué decirle a alguien que tiene una orquestación a medias.
//
// Entre cancelar y recontratar la persona está SIN su servicio. Si cierra el
// correo, hoy no hay forma de volver a esas pantallas salvo buscándolas. Esta
// tarjeta es lo que evita justo el caso que mide la métrica de "sesión 2 que
// nunca ocurrió".
//
// La derivación va aparte y pura porque el riesgo real no es pintar la tarjeta,
// es decir mal la urgencia: pedirle que actúe cuando todavía no toca, o no
// avisarle el día que sí.

export type UrgenciaPendiente = "hoy" | "vencido" | "esperando";

export interface Pendiente {
  urgencia: UrgenciaPendiente;
  /** Días que faltan para el recontrato. Negativo si ya pasó. */
  diasParaRecontratar: number | null;
  /** ¿Todavía se puede dejar todo como estaba? */
  puedeDeshacer: boolean;
  /** Título, ya resuelto, para no repetir la lógica en el JSX. */
  titulo: string;
  detalle: string;
}

export interface PendienteInput {
  serviceName: string;
  /** Día en que toca recontratar (YYYY-MM-DD). */
  resubDate: string | null;
  /** Hasta cuándo se puede deshacer (YYYY-MM-DD). */
  undoDeadline: string | null;
  targetDay: number | null;
  today: string;
}

function diasEntre(a: string, b: string): number {
  const ms = Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export function derivarPendiente(i: PendienteInput): Pendiente {
  const { serviceName, resubDate, undoDeadline, targetDay, today } = i;

  const dias = resubDate ? diasEntre(today, resubDate) : null;

  // Se puede deshacer durante TODO el día límite, igual que en el API. Si la
  // UI y el servidor no coincidieran aquí, alguien vería un botón que falla.
  const puedeDeshacer = !!undoDeadline && today <= undoDeadline;

  // Ya pasó el día: es lo más urgente que puede mostrar esta tarjeta, porque
  // cada día que pasa es un día sin servicio.
  if (dias !== null && dias < 0) {
    return {
      urgencia: "vencido",
      diasParaRecontratar: dias,
      puedeDeshacer,
      titulo: `Tu ${serviceName} sigue sin reactivarse`,
      detalle: `El día de reactivarlo era hace ${Math.abs(dias)} ${Math.abs(dias) === 1 ? "día" : "días"}. Mientras no lo hagas, sigues sin servicio.`,
    };
  }

  if (dias === 0) {
    return {
      urgencia: "hoy",
      diasParaRecontratar: 0,
      puedeDeshacer,
      titulo: `Hoy toca reactivar tu ${serviceName}`,
      detalle: targetDay
        ? `Si lo haces hoy, tu cobro queda fijado el día ${targetDay} de cada mes.`
        : "Si lo haces hoy, tu fecha queda donde la querías.",
    };
  }

  return {
    urgencia: "esperando",
    diasParaRecontratar: dias,
    puedeDeshacer,
    titulo: `Tu ${serviceName} se reactiva en ${dias} ${dias === 1 ? "día" : "días"}`,
    detalle: puedeDeshacer
      ? "Todavía puedes dejar todo como estaba y conservar tu fecha de siempre."
      : "Ya no se puede deshacer: tu fecha anterior se perdió al vencer el periodo que pagaste.",
  };
}
