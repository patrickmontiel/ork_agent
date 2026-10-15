// Tipos compartidos del flujo de /pay. Sin "server-only": los usan los pasos,
// que son componentes de cliente.

export interface ServicioLigero {
  id: string;
  nombre: string;
  emoji: string;
  rol: "puente" | "cerrado" | "no_editable";
  mecanismo: "cancel_resubscribe" | "pause" | "api" | null;
  motivoBloqueo: string | null;
}

export interface Catalogo {
  /** Protagonistas: Spotify, Netflix, YouTube. Requieren mandato. */
  cerrados: ServicioLigero[];
  /** El comercio tiene API. Ork no cancela nada, no hace falta mandato. */
  puente: ServicioLigero[];
  /** No se pueden mover. Se muestran con su motivo, nunca se prometen. */
  bloqueados: ServicioLigero[];
}

export interface TarjetaLigera {
  id: string;
  brand: string;
  last4: string;
  isDefault: boolean;
  label: string;
  expired: boolean;
}

export interface UsuarioLigero {
  email: string;
  plan: "free" | "premium";
  paydays: number[];
  tarjetas: TarjetaLigera[];
}

export type Paso = "correo" | "revisa_correo" | "servicio" | "dia" | "confirmar" | "listo";
