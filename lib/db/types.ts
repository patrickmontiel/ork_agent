// Tipos de las filas de SQLite. Reflejan el esquema 1:1.
// SQLite no tiene booleanos: los campos 0/1 se exponen como number aquí y se
// convierten en los repositorios.

export type ServiceRole = "puente" | "cerrado" | "no_editable";
export type Orchestrable = "cancel_resubscribe" | "pause" | "api" | "not_supported";
export type SupportStatus = "soportado" | "por_verificar" | "no_soportado";

export interface ServiceRow {
  id: string;
  name: string;
  role: ServiceRole;
  orchestrable: Orchestrable | null;
  pilot_adapter: number;
  blocked_reason: string | null;
  support_status: SupportStatus;
  emoji: string | null;
  sort_order: number;
  created_at: string;
}

export interface UserRow {
  id: string;
  email: string;
  created_at: string;
  last_seen_at: string | null;
  payday_kind: string | null;
  payday_days: string | null; // JSON: "[15,30]"
  plan: "free" | "premium";
  stripe_customer_id: string | null;
}

export interface MandateRow {
  id: string;
  user_id: string;
  service_id: string;
  action_type: string;
  text_version: string;
  text_hash: string;
  timestamp: string;
  ip: string | null;
  user_agent: string | null;
  revoked_at: string | null;
}

export interface PublicPriceRow {
  id: string;
  service_id: string;
  plan: string;
  country: string;
  amount: number | null;
  currency: string;
  is_promo: number;
  needs_verification: number;
  note: string | null;
  checked_at: string;
  source: string | null;
}

export type EventSeverity = "info" | "warn" | "critical";

export interface EventRow {
  id: number;
  at: string;
  type: string;
  user_id: string | null;
  service_id: string | null;
  orchestration_id: string | null;
  payload: string | null;
  severity: EventSeverity;
}

export interface PilotSwitchRow {
  id: 1;
  adapters_live: number;
  killed_at: string | null;
  kill_reason: string | null;
  updated_at: string;
}

/** Servicio con los booleanos ya resueltos, listo para la UI. */
export interface Service extends Omit<ServiceRow, "created_at" | "pilot_adapter"> {
  /** Ork puede mover la fecha de este servicio. */
  editable: boolean;
  /** Hay adaptador real en el piloto. Si no, se muestra como "próximamente". */
  hasPilotAdapter: boolean;
}
