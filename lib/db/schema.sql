-- Ork v2 — esquema.
-- Se aplica completo al arrancar; todo es CREATE ... IF NOT EXISTS, así que
-- correrlo dos veces no hace nada. Las migraciones futuras van en migrations/.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ─── Usuarios ───────────────────────────────────────────────────────────────
-- Identidad por correo, sin contraseña. El magic link es el único camino.

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL,
  last_seen_at TEXT,
  -- Día de pago del usuario: 'quincenal' | 'mensual' | 'semanal' | null
  payday_kind TEXT,
  -- Días concretos, JSON: [15,30]. Lo llena el chat del agente.
  payday_days TEXT,
  -- Plan de Ork: 'free' | 'premium'
  plan        TEXT NOT NULL DEFAULT 'free',
  stripe_customer_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

-- Tokens de magic link. Un solo uso, 15 minutos.
CREATE TABLE IF NOT EXISTS magic_tokens (
  token_hash  TEXT PRIMARY KEY,   -- SHA-256 del token; el token crudo nunca se guarda
  email       TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  ip          TEXT
);

CREATE INDEX IF NOT EXISTS idx_magic_expires ON magic_tokens (expires_at);

-- ─── Medios de pago ─────────────────────────────────────────────────────────
-- NUNCA se guarda el PAN. Solo la referencia de Stripe y los últimos 4 dígitos
-- para que la persona reconozca su tarjeta.

CREATE TABLE IF NOT EXISTS cards (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  stripe_payment_method_id TEXT,
  brand       TEXT,               -- visa | mastercard | amex
  last4       TEXT,
  exp_month   INTEGER,
  exp_year    INTEGER,
  is_default  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cards_user ON cards (user_id);

-- ─── Catálogo de servicios ──────────────────────────────────────────────────
-- role:
--   'puente'      → el comercio tiene API; Ork mueve la fecha y el comercio cobra
--   'cerrado'     → sin API; Ork cancela y recontrata con mandato del usuario
--   'no_editable' → Apple/Google IAP, anuales, contratos con penalización
-- mechanism para 'cerrado': 'cancel_resubscribe' | 'pause'

-- orchestrable: cómo se movería la fecha.
--   'pause'              → se pausa y al reanudar queda la fecha nueva (Netflix, Uber One)
--   'cancel_resubscribe' → se cancela y se vuelve a contratar en la fecha elegida
--   'api'                → el comercio expone API; Ork solo manda la instrucción
--   'not_supported'      → no se puede, y blocked_reason dice por qué
--   NULL                 → todavía sin determinar. No se promete nada.
CREATE TABLE IF NOT EXISTS services (
  id            TEXT PRIMARY KEY,   -- 'spotify', 'netflix', 'youtube_premium'
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('puente', 'cerrado', 'no_editable')),
  orchestrable  TEXT CHECK (orchestrable IN ('cancel_resubscribe', 'pause', 'api', 'not_supported')),
  -- ¿Existe adaptador real para el piloto? Solo Spotify y Netflix. El resto se
  -- muestra como "próximamente": tener mecanismo definido no es tener código.
  pilot_adapter INTEGER NOT NULL DEFAULT 0,
  -- Por qué no se puede, si role = 'no_editable'. Se muestra al usuario tal cual.
  blocked_reason TEXT,
  -- 'soportado' | 'por_verificar' | 'no_soportado'
  support_status TEXT NOT NULL DEFAULT 'por_verificar',
  emoji         TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 100,
  created_at    TEXT NOT NULL
);

-- Precio público de lista, por servicio y plan. Sirve para detectar promo:
-- si el usuario paga menos que el público, tiene promo y la pierde al recontratar.
--
-- `amount` es NULL cuando no se ha verificado. El detector de promo NO compara
-- contra un precio nulo: prefiere no opinar antes que opinar mal.
CREATE TABLE IF NOT EXISTS public_prices (
  id          TEXT PRIMARY KEY,
  service_id  TEXT NOT NULL REFERENCES services (id) ON DELETE CASCADE,
  plan        TEXT NOT NULL,       -- 'individual' | 'duo' | 'familiar' | 'estandar'...
  country     TEXT NOT NULL DEFAULT 'MX',
  amount      REAL,                -- NULL = sin verificar
  currency    TEXT NOT NULL DEFAULT 'MXN',
  -- El precio de lista es promocional y va a volver a subir. Comparar contra él
  -- haría creer que el usuario NO tiene promo cuando en realidad todos la tienen.
  is_promo    INTEGER NOT NULL DEFAULT 0,
  needs_verification INTEGER NOT NULL DEFAULT 0,
  note        TEXT,
  checked_at  TEXT NOT NULL,       -- '' si nunca se verificó
  source      TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_prices_lookup
  ON public_prices (service_id, plan, country);

-- ─── Suscripciones del usuario ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_services (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  service_id    TEXT NOT NULL REFERENCES services (id),
  plan          TEXT,
  -- Lo que el usuario paga hoy. Si es menor al público, hay promo.
  paid_amount   REAL,
  currency      TEXT NOT NULL DEFAULT 'MXN',
  billing_day   INTEGER CHECK (billing_day BETWEEN 1 AND 31),
  next_charge   TEXT,               -- YYYY-MM-DD
  desired_day   INTEGER CHECK (desired_day BETWEEN 1 AND 31),
  status        TEXT NOT NULL DEFAULT 'activa',
  connected_at  TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_services_user ON user_services (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_services_unique
  ON user_services (user_id, service_id);

-- ─── Mandatos ───────────────────────────────────────────────────────────────
-- APPEND-ONLY. Es el registro legal de que la persona autorizó algo.
-- Se guarda el hash del texto exacto que se firmó, no solo su versión: si el
-- texto cambiara sin subir de versión, el hash lo delata.
-- Los triggers de abajo impiden UPDATE (salvo revocar) y DELETE.

CREATE TABLE IF NOT EXISTS mandates (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  service_id    TEXT NOT NULL REFERENCES services (id),
  action_type   TEXT NOT NULL,      -- 'cancel_resubscribe' | 'pause'
  text_version  TEXT NOT NULL,      -- 'spotify.v1'
  text_hash     TEXT NOT NULL,      -- SHA-256 del texto mostrado
  timestamp     TEXT NOT NULL,
  ip            TEXT,
  user_agent    TEXT,
  -- ¿La persona llegó al final del texto antes de poder aceptar? El botón
  -- está deshabilitado hasta entonces, así que esto siempre debería ser 1.
  -- Se guarda igual: si algún día llega un 0, es que alguien saltó el gate.
  scrolled_to_end INTEGER NOT NULL DEFAULT 0,
  revoked_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_mandates_lookup
  ON mandates (user_id, service_id, action_type);

-- Un mandato no se edita: solo se revoca. Cualquier otro UPDATE se rechaza.
CREATE TRIGGER IF NOT EXISTS mandates_no_update
BEFORE UPDATE ON mandates
FOR EACH ROW
WHEN (
     OLD.id           IS NOT NEW.id
  OR OLD.user_id      IS NOT NEW.user_id
  OR OLD.service_id   IS NOT NEW.service_id
  OR OLD.action_type  IS NOT NEW.action_type
  OR OLD.text_version IS NOT NEW.text_version
  OR OLD.text_hash    IS NOT NEW.text_hash
  OR OLD.timestamp    IS NOT NEW.timestamp
  OR OLD.ip           IS NOT NEW.ip
  OR OLD.user_agent   IS NOT NEW.user_agent
  -- La prueba de que la persona leyó el texto es parte del registro, no un
  -- metadato editable.
  OR OLD.scrolled_to_end IS NOT NEW.scrolled_to_end
)
BEGIN
  SELECT RAISE(ABORT, 'Un mandato es inmutable: solo se puede revocar.');
END;

-- Y no se borra nunca.
CREATE TRIGGER IF NOT EXISTS mandates_no_delete
BEFORE DELETE ON mandates
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Un mandato no se borra.');
END;

-- ─── Orquestaciones ─────────────────────────────────────────────────────────
-- Una corrida = un intento de mover la fecha de un servicio.
-- state: registrado → confirmado → cancelado → verificado_cancelacion →
--        recontratado → verificado_recontrato → notificado
--        (o: expirado | rechazado | rollback | incidente)

CREATE TABLE IF NOT EXISTS orchestrations (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  service_id      TEXT NOT NULL REFERENCES services (id),
  user_service_id TEXT REFERENCES user_services (id) ON DELETE SET NULL,
  mandate_id      TEXT REFERENCES mandates (id),
  state           TEXT NOT NULL,
  from_day        INTEGER,
  to_day          INTEGER,
  from_date       TEXT,
  to_date         TEXT,
  -- Trade-off que se le mostró, en números. Se guarda para auditar lo que vio.
  tradeoff_json   TEXT,
  chosen_option   TEXT,             -- 'sin_servicio' | 'pagar_de_mas' | null
  -- Estado previo del servicio, para poder revertir y para el comprobante.
  prior_state_json TEXT,
  had_promo       INTEGER NOT NULL DEFAULT 0,
  promo_lost      INTEGER NOT NULL DEFAULT 0,
  retries         INTEGER NOT NULL DEFAULT 0,
  adapter_mode    TEXT NOT NULL,    -- 'mock' | 'real'
  -- El silencio no es consentimiento: sin confirmación antes de esto, se expira.
  confirm_deadline TEXT,
  confirmed_at    TEXT,
  error           TEXT,
  fee_charged     INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orch_user ON orchestrations (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orch_state ON orchestrations (state);

-- ─── Eventos del piloto ─────────────────────────────────────────────────────
-- APPEND-ONLY. De aquí salen las 5 métricas del tablero.

CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          TEXT NOT NULL,
  type        TEXT NOT NULL,
  user_id     TEXT,
  service_id  TEXT,
  orchestration_id TEXT,
  payload     TEXT,                 -- JSON
  severity    TEXT NOT NULL DEFAULT 'info'  -- info | warn | critical
);

CREATE INDEX IF NOT EXISTS idx_events_type ON events (type, at);
CREATE INDEX IF NOT EXISTS idx_events_orch ON events (orchestration_id);

CREATE TRIGGER IF NOT EXISTS events_no_update
BEFORE UPDATE ON events
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Los eventos del piloto son append-only.');
END;

-- ─── Encuesta de comprensión ────────────────────────────────────────────────
-- Una pregunta después de cada orquestación. Meta: ≥90% entendió.

CREATE TABLE IF NOT EXISTS survey_answers (
  id          TEXT PRIMARY KEY,
  orchestration_id TEXT NOT NULL REFERENCES orchestrations (id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  understood  INTEGER NOT NULL,     -- 1 | 0
  comment     TEXT,
  at          TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_survey_orch ON survey_answers (orchestration_id);

-- ─── Interruptor del piloto ─────────────────────────────────────────────────
-- Si aparece una cuenta restringida, el adaptador real se apaga solo y queda
-- registrado aquí. Reactivar es manual, a propósito.

CREATE TABLE IF NOT EXISTS pilot_switch (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  adapters_live INTEGER NOT NULL DEFAULT 0,
  killed_at     TEXT,
  kill_reason   TEXT,
  updated_at    TEXT NOT NULL
);

INSERT OR IGNORE INTO pilot_switch (id, adapters_live, updated_at)
VALUES (1, 0, datetime('now'));
