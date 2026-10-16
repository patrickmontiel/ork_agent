// Los umbrales del piloto, sin base de datos alrededor.
//
// Están aquí sueltos porque son la parte que puede mentir. Un tablero que
// redondea cero de cero a "100% de éxito" es peor que no tener tablero: da
// permiso para seguir. Estas funciones existen para que esa regla tenga tests.

export type Verdict = "bien" | "alerta" | "mal" | "sin_datos";

/** Mínimo de observaciones antes de que un porcentaje signifique algo. */
export const MIN_ORQUESTACIONES = 10;
export const MIN_ENCUESTAS = 5;
export const MIN_TRADEOFFS_VISTOS = 5;

/**
 * Éxito técnico. Meta ≥85%.
 *
 * Con pocas corridas el porcentaje es ruido —una falla mueve diez puntos—, así
 * que se dice "sin datos" en vez de pintar verde con 2 de 2.
 */
export function verdictExito(completadas: number, ejecutadas: number): Verdict {
  if (ejecutadas < MIN_ORQUESTACIONES) return "sin_datos";
  const p = (completadas / ejecutadas) * 100;
  return p >= 85 ? "bien" : p >= 70 ? "alerta" : "mal";
}

/**
 * Cortes de servicio. Meta ≤1 de cada 20.
 *
 * Sin orquestaciones no hay dato. Con orquestaciones y cero cortes, sí: ahí el
 * cero sí es información.
 */
export function verdictCorte(cortes: number, ejecutadas: number): Verdict {
  if (ejecutadas === 0) return "sin_datos";
  if (cortes === 0) return "bien";
  const razon = cortes / ejecutadas;
  return razon <= 0.05 ? "bien" : razon <= 0.1 ? "alerta" : "mal";
}

/**
 * Cuentas restringidas. Meta 0, sin excepción.
 *
 * No hay "alerta" a propósito: una sola cuenta restringida es el peor resultado
 * posible del piloto y además apaga los adaptadores. Un amarillo aquí sería una
 * forma elegante de seguir adelante.
 */
export function verdictRestringidas(n: number): Verdict {
  return n === 0 ? "bien" : "mal";
}

/** Comprensión. Meta ≥90%. */
export function verdictComprension(entendieron: number, respuestas: number): Verdict {
  if (respuestas < MIN_ENCUESTAS) return "sin_datos";
  const p = (entendieron / respuestas) * 100;
  return p >= 90 ? "bien" : p >= 75 ? "alerta" : "mal";
}

/**
 * Cancelaciones por desventaja. Sin umbral de aprobación.
 *
 * Esta métrica NO puede dar "mal": que alguien vea los números y diga que no es
 * el producto funcionando, no fallando. Lo que mide es si el trade-off de Ork
 * vale la pena, y eso es una señal sobre la oferta, no una nota sobre la gente.
 */
export function verdictDesventaja(rechazos: number, vieron: number): Verdict {
  if (vieron < MIN_TRADEOFFS_VISTOS) return "sin_datos";
  return (rechazos / vieron) * 100 >= 50 ? "alerta" : "bien";
}


/**
 * Sesiones 2 que nunca ocurrieron. Meta: 0.
 *
 * Es el peor caso del piloto: Ork canceló, la persona nunca volvió a
 * recontratar y se quedó sin su servicio. No hay "alerta" porque no hay una
 * cantidad aceptable: una sola persona en ese estado ya es un fracaso del
 * producto, no una estadística.
 *
 * Con cero fases 1 no hay dato; con fases 1 y ninguna abandonada, el cero SÍ
 * es información.
 */
export function verdictSesion2Perdida(abandonadas: number, fase1: number): Verdict {
  if (fase1 === 0) return "sin_datos";
  return abandonadas === 0 ? "bien" : "mal";
}
