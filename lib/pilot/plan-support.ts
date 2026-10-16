// Qué PLANES puede tocar Ork, no qué servicios.
//
// El catálogo dice si un servicio es orquestable, pero eso no alcanza: Spotify
// es orquestable y aun así Ork no debe tocar un plan Duo. La diferencia no está
// en el servicio, está en el plan, y solo se conoce al leer la cuenta.
//
// Por qué Duo y Family están fuera (documentación de Spotify):
//
//   1. Hay OTRA PERSONA. En Duo y Family los miembros tienen cuentas separadas
//      con Premium. Cancelar deja sin servicio a alguien que nunca firmó un
//      mandato con Ork. Todo nuestro modelo de consentimiento cubre al titular,
//      no al miembro.
//   2. "If you had a Duo or Family plan, you'll need to invite your members
//      again." El recontrato no termina al pagar: el miembro tiene que aceptar.
//   3. "Plan members can only switch plans once every 12 months." Si salir y
//      volver a entrar cuenta como cambiar de plan, el miembro podría quedar
//      bloqueado UN AÑO. Irreversible, y el daño no es del titular.
//
// Este módulo es puro a propósito: es una reja de seguridad y tiene que poder
// probarse sin base de datos ni navegador.

export type PlanSupport =
  | { supported: true }
  | { supported: false; reason: string; message: string };

/** Planes compartidos: tocarlos afecta a terceros que no dieron permiso. */
const PLANES_COMPARTIDOS = [
  "duo",
  "familiar",
  "family",
  "premium duo",
  "premium familiar",
  "premium family",
];

/** Planes con verificación o condiciones propias que Ork no modela todavía. */
const PLANES_CONDICIONADOS = ["estudiantes", "student", "premium student"];

function normaliza(plan: string): string {
  return plan
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * ¿Ork puede orquestar este plan?
 *
 * El default ante lo desconocido es NO. Un plan que no reconocemos puede ser
 * compartido, y equivocarse ahí le cuesta el servicio a alguien que ni siquiera
 * es nuestro usuario.
 */
export function planSupport(plan: string | null | undefined): PlanSupport {
  if (!plan || !plan.trim()) {
    return {
      supported: false,
      reason: "plan_desconocido",
      message:
        "No pudimos leer con certeza qué plan tienes, así que no vamos a tocar nada.",
    };
  }

  const p = normaliza(plan);

  if (PLANES_COMPARTIDOS.some((x) => p.includes(x))) {
    return {
      supported: false,
      reason: "plan_compartido",
      message:
        "Tu plan lo comparten varias personas. Mover la fecha dejaría sin servicio a alguien que no nos dio permiso, así que Ork no lo toca.",
    };
  }

  if (PLANES_CONDICIONADOS.some((x) => p.includes(x))) {
    return {
      supported: false,
      reason: "plan_condicionado",
      message:
        "Los planes de estudiante tienen verificación propia y podrías perderla al recontratar. Ork todavía no los soporta.",
    };
  }

  if (p.includes("individual") || p === "premium" || p.includes("premium individual")) {
    return { supported: true };
  }

  return {
    supported: false,
    reason: "plan_no_reconocido",
    message: `No reconocemos el plan "${plan}". Ork no toca lo que no entiende.`,
  };
}
