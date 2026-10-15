import "server-only";
import { activeMandate } from "@/lib/db/repo/mandates";
import { getService } from "@/lib/db/repo/services";
import { currentText, textByVersion, fullText } from "./texts";
import { sha256 } from "@/lib/db";
import type { MandateRow } from "@/lib/db/types";

// El cuello de botella del consentimiento.
//
// TODA acción sobre un servicio cerrado pasa por aquí antes de tocar nada. No
// hay segunda puerta: si una ruta nueva olvida llamar a requireMandate, ese es
// el bug, no una excepción aceptable.
//
// Importante: el mandato es permiso GENERAL para la acción. No sustituye la
// confirmación del evento concreto, que llega en la Fase 3 con el trade-off en
// números. Son dos puertas distintas y las dos tienen que abrirse.

export type MandateCheck =
  | { ok: true; mandate: MandateRow }
  | {
      ok: false;
      reason: "servicio_desconocido" | "no_requiere" | "sin_mandato" | "texto_cambio";
      message: string;
      /** Versión que la persona tendría que firmar ahora. */
      needsVersion?: string;
    };

export function requireMandate(
  userId: string,
  serviceId: string,
  actionType: string,
): MandateCheck {
  const service = getService(serviceId);
  if (!service) {
    return {
      ok: false,
      reason: "servicio_desconocido",
      message: "Ese servicio no existe.",
    };
  }

  // Los de puente no cancelan nada: el comercio cobra con su propia API y el
  // usuario ya aceptó sus términos. Pedir mandato aquí sería teatro.
  if (service.role === "puente") {
    return {
      ok: false,
      reason: "no_requiere",
      message: "Este comercio mueve la fecha por su cuenta. No hace falta permiso.",
    };
  }

  const m = activeMandate(userId, serviceId, actionType);
  if (!m) {
    return {
      ok: false,
      reason: "sin_mandato",
      message: `Necesitas darle permiso a Ork para mover ${service.name}.`,
      needsVersion: currentText(serviceId)?.version,
    };
  }

  // El texto que firmó, ¿sigue siendo el mismo objeto que dice ser?
  // Si alguien editó texts.ts sin subir de versión, el hash no cuadra y el
  // mandato deja de valer: la persona firmó otra cosa.
  const t = textByVersion(m.text_version);
  if (!t || sha256(fullText(t)) !== m.text_hash) {
    return {
      ok: false,
      reason: "texto_cambio",
      message:
        "El permiso que diste corresponde a un texto que ya no coincide. Por seguridad hay que firmarlo de nuevo.",
      needsVersion: currentText(serviceId)?.version,
    };
  }

  return { ok: true, mandate: m };
}

/** ¿Este servicio necesita mandato? Para decidir qué mostrar en la UI. */
export function needsMandate(serviceId: string): boolean {
  const s = getService(serviceId);
  return !!s && s.role === "cerrado";
}
