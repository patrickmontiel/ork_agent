// Contrato de un adaptador de servicio cerrado.
//
// Un servicio cerrado no tiene API: Ork actúa en nombre de la persona dentro de
// su propia sesión. Esta interfaz es lo único que el motor de orquestación
// conoce, así que agregar Deezer o Crunchyroll después es escribir otro
// adaptador, no tocar el motor.
//
// REGLA QUE ATRAVIESA TODO:
// ninguna operación se considera exitosa porque devolvió sin error. `verify()`
// relee el estado del servicio y compara. Un 200 no es evidencia de que algo
// haya cambiado — eso se aprendió en la revisión y aquí es parte del contrato.

export type ServiceStatus =
  | "activa"
  | "cancelada_con_acceso"  // cancelada, pero el periodo pagado sigue corriendo
  | "pausada"
  | "sin_suscripcion"
  | "restringida"           // el servicio bloqueó la cuenta → apagado del piloto
  | "desconocida";

export interface ServiceState {
  status: ServiceStatus;
  /** Plan detectado, con la nomenclatura del catálogo de Ork. */
  plan: string | null;
  /** Lo que la persona paga hoy. */
  paidAmount: number | null;
  currency: string;
  /** Día del mes en que se cobra. */
  billingDay: number | null;
  /** Fin del periodo YA pagado (YYYY-MM-DD). Es la fecha que manda todo. */
  periodEnd: string | null;
  /** Texto crudo de lo que se leyó, para el comprobante y para depurar. */
  evidence?: string;
}

export interface ActionResult {
  ok: boolean;
  /** Mensaje para la persona, en español. Nunca un stack trace. */
  message: string;
  /** Código interno, para métricas. */
  code?: string;
  /** Si el servicio restringió la cuenta. Dispara el apagado del piloto. */
  accountRestricted?: boolean;
  evidence?: string;
}

export interface ResubscribeInput {
  /** Fecha en la que debe quedar el cobro. */
  onDate: string;
  plan: string | null;
  /** Lo que se espera pagar. Si el real difiere, verify() lo reporta. */
  expectedAmount: number | null;
}

export interface ClosedServiceAdapter {
  readonly serviceId: string;
  /** 'cancel_resubscribe' | 'pause' */
  readonly mechanism: "cancel_resubscribe" | "pause";
  /** ¿Es el mock o el real? Se registra en cada orquestación. */
  readonly mode: "mock" | "real";

  /** Lee el estado actual. No muta nada. */
  getState(): Promise<ServiceState>;

  /**
   * Cancela (o pausa, según el mecanismo). La persona conserva los días que
   * ya pagó: Ork nunca cobra hacia atrás ni pide pagar días muertos.
   */
  cancel(): Promise<ActionResult>;

  /** Vuelve a contratar (o reanuda) en la fecha indicada. */
  resubscribe(input: ResubscribeInput): Promise<ActionResult>;

  /**
   * Relee y comprueba que el estado sea el que debería. Es lo que convierte
   * "la llamada no falló" en "el cambio ocurrió".
   */
  verify(expected: Partial<ServiceState>): Promise<{
    ok: boolean;
    actual: ServiceState;
    mismatches: string[];
  }>;

  /** Cierra la sesión del navegador y borra el perfil temporal. */
  dispose?(): Promise<void>;
}
