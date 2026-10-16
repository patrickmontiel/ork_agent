import "server-only";
import type { Database } from "better-sqlite3";

// Migraciones.
//
// schema.sql usa CREATE TABLE IF NOT EXISTS, así que una base que ya existe
// nunca recibe columnas nuevas. Esto las agrega.
//
// Cada paso es idempotente y se puede correr mil veces. No hay tabla de
// versiones a propósito: con pocas migraciones, comprobar el estado real del
// esquema es más confiable que confiar en un número que alguien pudo olvidar
// de subir.

function columns(d: Database, table: string): Set<string> {
  try {
    const rows = d
      .prepare<[], { name: string }>(`PRAGMA table_info(${table})`)
      .all();
    return new Set(rows.map((r) => r.name));
  } catch {
    return new Set();
  }
}

function tableExists(d: Database, name: string): boolean {
  return !!d
    .prepare<[string], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
    )
    .get(name);
}

function addColumn(d: Database, table: string, column: string, ddl: string): boolean {
  if (!tableExists(d, table)) return false;
  if (columns(d, table).has(column)) return false;
  d.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  return true;
}

export function migrate(d: Database): string[] {
  const done: string[] = [];

  // ─── services: mechanism → orchestrable, + pilot_adapter ──────────────────
  if (tableExists(d, "services")) {
    const cols = columns(d, "services");

    if (!cols.has("orchestrable")) {
      // No se puede renombrar con CHECK nuevo, así que se agrega y se copia.
      // El CHECK vive en schema.sql para bases nuevas; en las migradas se
      // confía en el seed, que es la única vía que escribe esta columna.
      d.exec("ALTER TABLE services ADD COLUMN orchestrable TEXT");
      if (cols.has("mechanism")) {
        d.exec("UPDATE services SET orchestrable = mechanism WHERE orchestrable IS NULL");
      }
      done.push("services.orchestrable");
    }

    if (addColumn(d, "services", "pilot_adapter", "INTEGER NOT NULL DEFAULT 0")) {
      done.push("services.pilot_adapter");
    }
  }

  // ─── public_prices: amount nullable, + is_promo, needs_verification, note ──
  if (tableExists(d, "public_prices")) {
    if (addColumn(d, "public_prices", "is_promo", "INTEGER NOT NULL DEFAULT 0")) {
      done.push("public_prices.is_promo");
    }
    if (addColumn(d, "public_prices", "needs_verification", "INTEGER NOT NULL DEFAULT 0")) {
      done.push("public_prices.needs_verification");
    }
    if (addColumn(d, "public_prices", "note", "TEXT")) {
      done.push("public_prices.note");
    }

    // `amount` nació NOT NULL. SQLite no permite quitar una restricción con
    // ALTER, así que hay que reconstruir la tabla.
    const notNull = d
      .prepare<[], { name: string; notnull: number }>("PRAGMA table_info(public_prices)")
      .all()
      .find((c) => c.name === "amount")?.notnull;

    if (notNull === 1) {
      d.pragma("foreign_keys = OFF");
      d.transaction(() => {
        d.exec(`
          CREATE TABLE public_prices_new (
            id          TEXT PRIMARY KEY,
            service_id  TEXT NOT NULL REFERENCES services (id) ON DELETE CASCADE,
            plan        TEXT NOT NULL,
            country     TEXT NOT NULL DEFAULT 'MX',
            amount      REAL,
            currency    TEXT NOT NULL DEFAULT 'MXN',
            is_promo    INTEGER NOT NULL DEFAULT 0,
            needs_verification INTEGER NOT NULL DEFAULT 0,
            note        TEXT,
            checked_at  TEXT NOT NULL,
            source      TEXT
          );
          INSERT INTO public_prices_new
            (id, service_id, plan, country, amount, currency, is_promo, needs_verification, note, checked_at, source)
          SELECT id, service_id, plan, country, amount, currency,
                 COALESCE(is_promo, 0), COALESCE(needs_verification, 0), note, checked_at, source
            FROM public_prices;
          DROP TABLE public_prices;
          ALTER TABLE public_prices_new RENAME TO public_prices;
          CREATE UNIQUE INDEX IF NOT EXISTS idx_prices_lookup
            ON public_prices (service_id, plan, country);
        `);
      })();
      d.pragma("foreign_keys = ON");
      done.push("public_prices.amount → nullable");
    }
  }

  // ─── Renombrar servicio 'youtube' → 'youtube_premium' ─────────────────────
  // El id cambió al adoptar el catálogo completo. Hay que arrastrar las filas
  // que lo referencian o quedarían huérfanas.
  if (tableExists(d, "services")) {
    const viejo = d
      .prepare<[], { id: string }>("SELECT id FROM services WHERE id = 'youtube'")
      .get();
    if (viejo) {
      d.pragma("foreign_keys = OFF");
      d.transaction(() => {
        // Si ya existe el nuevo, se reapunta lo viejo y se borra el duplicado.
        const yaExiste = d
          .prepare<[], { id: string }>("SELECT id FROM services WHERE id = 'youtube_premium'")
          .get();
        if (!yaExiste) {
          d.exec("UPDATE services SET id = 'youtube_premium' WHERE id = 'youtube'");
        } else {
          d.exec("DELETE FROM services WHERE id = 'youtube'");
        }
        for (const t of ["user_services", "public_prices", "mandates", "orchestrations"]) {
          if (tableExists(d, t)) {
            d.exec(`UPDATE ${t} SET service_id = 'youtube_premium' WHERE service_id = 'youtube'`);
          }
        }
      })();
      d.pragma("foreign_keys = ON");
      done.push("youtube → youtube_premium");
    }
  }

  // ─── mandates: prueba de lectura ──────────────────────────────────────────
  if (addColumn(d, "mandates", "scrolled_to_end", "INTEGER NOT NULL DEFAULT 0")) {
    done.push("mandates.scrolled_to_end");
  }

  // El trigger de inmutabilidad nació sin cubrir scrolled_to_end, así que en
  // bases creadas antes esa columna se podía editar. CREATE TRIGGER IF NOT
  // EXISTS no actualiza uno existente: hay que tirarlo y rehacerlo.
  if (tableExists(d, "mandates")) {
    const sql = d
      .prepare<[], { sql: string }>(
        "SELECT sql FROM sqlite_master WHERE type='trigger' AND name='mandates_no_update'",
      )
      .get()?.sql;
    if (sql && !sql.includes("scrolled_to_end")) {
      d.exec(`
        DROP TRIGGER mandates_no_update;
        CREATE TRIGGER mandates_no_update
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
          OR OLD.scrolled_to_end IS NOT NEW.scrolled_to_end
        )
        BEGIN
          SELECT RAISE(ABORT, 'Un mandato es inmutable: solo se puede revocar.');
        END;
      `);
      done.push("mandates_no_update → cubre scrolled_to_end");
    }
  }

  return done;
}
