// Fase 4 de punta a punta, contra el servidor corriendo y contra Stripe en
// modo prueba. No hay mocks de Stripe aquí: las sesiones de pago son reales.
//
//   node scripts/stripe-e2e.mjs
//
// Lo que se verifica, en orden de importancia:
//
//   1. Una orquestación que NO movió la fecha no genera cobro, ni siquiera
//      cuando el servicio contestó "ok" (escenario exito_silencioso). Esta es
//      LA regla de la Fase 4.
//   2. Una orquestación exitosa sí genera un link de pago real de Stripe.
//   3. Repetir la confirmación no genera un segundo cobro.
//   4. Premium abre una sesión de suscripción real.
//
// No se completa ningún pago: eso requiere la tarjeta 4242 en el navegador.

const BASE = process.argv[2] ?? "http://localhost:3001";

let cookie = "";
let fallos = 0;

function check(nombre, cond, detalle) {
  console.log(`${cond ? "✓" : "✗"} ${nombre}${detalle ? `  → ${detalle}` : ""}`);
  if (!cond) fallos++;
}

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const set = res.headers.getSetCookie?.() ?? [];
  for (const c of set) {
    if (c.startsWith("ork_session=")) cookie = c.split(";")[0];
  }
  let data = null;
  const texto = await res.text();
  try {
    data = JSON.parse(texto);
  } catch {
    data = { _texto: texto.slice(0, 200) };
  }
  return { status: res.status, data, headers: res.headers };
}

// ─── Entrar ────────────────────────────────────────────────────────────────

const EMAIL = `e2e-fase4-${Date.now()}@ork.test`;

const pedido = await api("/api/auth/magic", { method: "POST", body: { email: EMAIL } });
if (!pedido.data?.devUrl) {
  console.error("No vino devUrl. ¿El mailer está en modo consola?", pedido.status, pedido.data);
  process.exit(1);
}
const canje = await api(pedido.data.devUrl.replace(BASE, ""));
check("sesión iniciada con magic link", !!cookie, `status ${canje.status}`);
if (!cookie) process.exit(1);

// ─── Mandato para Spotify ──────────────────────────────────────────────────

const mandato = await api("/api/mandate", {
  method: "POST",
  body: { serviceId: "spotify", scrolledToEnd: true },
});
check("mandato firmado", mandato.status === 200 && mandato.data?.ok, `status ${mandato.status}`);

// ─── Ayudas ────────────────────────────────────────────────────────────────

async function orquestar(scenario, targetDay = 16) {
  const paso1 = await api("/api/orchestrate", {
    method: "POST",
    body: { serviceId: "spotify", targetDay, scenario },
  });
  if (paso1.status !== 200) return { paso1, paso2: null };
  const paso2 = await api("/api/orchestrate", {
    method: "PUT",
    body: { orchestrationId: paso1.data.orquestacion.id, option: "esperar", scenario },
  });
  return { paso1, paso2, id: paso1.data.orquestacion.id };
}

const esUrlStripe = (u) => typeof u === "string" && /^https:\/\/checkout\.stripe\.com\//.test(u);

// ─── 1. LA regla: sin éxito verificado, sin cobro ──────────────────────────

console.log(`\n── 1. Orquestaciones que fallan NO se cobran ──`);

for (const escenario of ["exito_silencioso", "falla_recontrato", "falla_cancelacion"]) {
  const { paso2 } = await orquestar(escenario);
  if (!paso2) {
    check(`${escenario}: no se pudo correr`, false);
    continue;
  }
  check(
    `${escenario} → estado "${paso2.data?.estado}" y SIN cobro`,
    paso2.data?.cobro === null || paso2.data?.cobro === undefined,
    paso2.data?.cobro ? `¡COBRÓ! ${JSON.stringify(paso2.data.cobro)}` : "cobro = null",
  );
  check(
    `${escenario} → ok=false (Ork no dice que funcionó)`,
    paso2.data?.ok === false,
    `ok=${paso2.data?.ok}`,
  );
}

// ─── 2. El éxito sí se cobra, con link real de Stripe ──────────────────────

console.log(`\n── 2. Una orquestación exitosa genera un cobro real ──`);

const feliz = await orquestar("feliz", 17);
check(
  "feliz → estado completado",
  feliz.paso2?.data?.estado === "completado",
  `estado ${feliz.paso2?.data?.estado}`,
);
const cobro = feliz.paso2?.data?.cobro;
check("feliz → generó cobro", !!cobro, cobro ? `$${cobro.monto} ${cobro.moneda}` : "sin cobro");
check("el link es de Stripe de verdad", esUrlStripe(cobro?.url), cobro?.url?.slice(0, 42) + "…");
check("el monto es el fee configurado", cobro?.monto === 25, `monto ${cobro?.monto}`);

// ─── 3. Reconfirmar no cobra de nuevo ──────────────────────────────────────

console.log(`\n── 3. Reconfirmar la misma orquestación no cobra dos veces ──`);

const repetida = await api("/api/orchestrate", {
  method: "PUT",
  body: { orchestrationId: feliz.id, option: "esperar", scenario: "feliz" },
});
check(
  "segunda confirmación rechazada como ya procesada",
  repetida.status === 409 && repetida.data?.yaProcesada === true,
  `status ${repetida.status}`,
);

// ─── 4. Premium ────────────────────────────────────────────────────────────

console.log(`\n── 4. Premium abre una suscripción real en Stripe ──`);

const premium = await api("/api/stripe/checkout", { method: "POST", body: { plan: "premium" } });
check(
  "checkout de Premium creado",
  premium.status === 200 && esUrlStripe(premium.data?.url),
  premium.status === 200 ? premium.data?.url?.slice(0, 42) + "…" : JSON.stringify(premium.data),
);

const malPlan = await api("/api/stripe/checkout", { method: "POST", body: { plan: "fee" } });
check(
  "el fee NO se puede comprar desde checkout",
  malPlan.status === 400,
  `status ${malPlan.status}`,
);

// ─── 5. Recuperar un cobro que quedó huérfano ──────────────────────────────
//
// Este caso lo encontró esta misma prueba: Stripe se cayó a mitad de crear la
// sesión y la fila quedó en pendiente, sin link. Se simula a mano sobre la base
// y se verifica que /api/stripe/fee-link lo retome.

console.log(`\n── 5. Un cobro pendiente sin link se puede retomar ──`);

const { default: Database } = await import("better-sqlite3");
const db = new Database(process.env.DATABASE_PATH ?? "./ork.db");

const fila = db
  .prepare("SELECT id, orchestration_id FROM charges WHERE orchestration_id = ? AND kind = 'fee'")
  .get(feliz.id);

if (!fila) {
  check("había una fila de cobro para la orquestación exitosa", false);
} else {
  // Lo que deja Stripe cuando se cae a mitad: pendiente y sin sesión.
  db.prepare(
    "UPDATE charges SET status = 'pendiente', stripe_session_id = NULL WHERE id = ?",
  ).run(fila.id);

  const r = await api("/api/stripe/fee-link", { method: "POST", body: { chargeId: fila.id } });
  check(
    "fee-link devuelve link de Stripe para el cobro huérfano",
    r.status === 200 && esUrlStripe(r.data?.url),
    r.status === 200 ? r.data.url.slice(0, 42) + "…" : JSON.stringify(r.data),
  );

  const n = db
    .prepare("SELECT COUNT(*) n FROM charges WHERE orchestration_id = ? AND kind = 'fee'")
    .get(feliz.id);
  check("y NO creó un segundo cobro", n.n === 1, `${n.n} cobro(s)`);
}

// Intento de cobrar un cambio que no se completó, fabricando la fila a mano.
{
  const orchFallida = db
    .prepare("SELECT id FROM orchestrations WHERE state <> 'completado' ORDER BY rowid DESC LIMIT 1")
    .get();
  const userId = db
    .prepare("SELECT id FROM users WHERE email = ?")
    .get(EMAIL)?.id;

  if (orchFallida && userId) {
    const idFalso = "e2e-falso-" + Date.now();
    db.prepare(
      `INSERT INTO charges (id, user_id, kind, orchestration_id, amount, currency, status, created_at)
       VALUES (?, ?, 'fee', ?, 25, 'MXN', 'pendiente', ?)`,
    ).run(idFalso, userId, orchFallida.id, new Date().toISOString());

    const r = await api("/api/stripe/fee-link", { method: "POST", body: { chargeId: idFalso } });
    check(
      "fee-link se niega a cobrar una orquestación que no se completó",
      r.status === 422,
      `status ${r.status}: ${r.data?.error ?? ""}`,
    );
    db.prepare("DELETE FROM charges WHERE id = ?").run(idFalso);
  } else {
    check("había una orquestación fallida para la prueba", false);
  }
}

// Un cobro de alguien más no se puede tocar.
{
  const ajeno = db
    .prepare("SELECT id FROM charges WHERE user_id <> (SELECT id FROM users WHERE email = ?) LIMIT 1")
    .get(EMAIL);
  if (ajeno) {
    const r = await api("/api/stripe/fee-link", { method: "POST", body: { chargeId: ajeno.id } });
    check("un cobro de otra persona da 404", r.status === 404, `status ${r.status}`);
  }
}

// ─── 6. El webhook cierra el círculo: pendiente → pagado ───────────────────
//
// Hasta aquí el cobro existe y tiene link, pero nadie lo pagó. Completar el
// pago de verdad pide la tarjeta 4242 en el navegador, así que lo que se
// verifica es el tramo que sí es código nuestro: que un evento FIRMADO de
// sesión completada marque el cobro como pagado, y que un reenvío no reabra
// nada.

console.log(`\n── 6. Un pago confirmado marca el cobro como pagado ──`);

const { createHmac } = await import("node:crypto");
const { readFileSync } = await import("node:fs");

const SECRET = (() => {
  for (const linea of readFileSync(".env", "utf8").split(/\r?\n/)) {
    if (linea.startsWith("STRIPE_WEBHOOK_SECRET=")) return linea.slice(22).trim();
  }
  return null;
})();

const conSesion = db
  .prepare(
    "SELECT id, stripe_session_id, status FROM charges WHERE orchestration_id = ? AND kind = 'fee'",
  )
  .get(feliz.id);

if (!SECRET || !conSesion?.stripe_session_id) {
  check("había secreto de webhook y cobro con sesión", false);
} else {
  const payload = JSON.stringify({
    id: "evt_e2e_" + Date.now(),
    object: "event",
    type: "checkout.session.completed",
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: conSesion.stripe_session_id,
        object: "checkout.session",
        payment_status: "paid",
        payment_intent: "pi_e2e_simulado",
        metadata: {},
      },
    },
  });
  const ts = Math.floor(Date.now() / 1000);
  const header = `t=${ts},v1=${createHmac("sha256", SECRET).update(`${ts}.${payload}`).digest("hex")}`;

  const r1 = await fetch(BASE + "/api/stripe/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": header },
    body: payload,
  });
  const d1 = await r1.json();
  check(
    "evento de pago procesado",
    r1.status === 200 && d1.resultado === "cobro marcado pagado",
    `resultado "${d1.resultado}"`,
  );

  const despues = db.prepare("SELECT status, paid_at, stripe_payment_intent FROM charges WHERE id = ?").get(conSesion.id);
  check("el cobro quedó en pagado", despues.status === "pagado", `status ${despues.status}`);
  check("y con fecha de pago", !!despues.paid_at, despues.paid_at ?? "sin fecha");

  // Reenvío del MISMO evento: no se vuelve a procesar.
  const r2 = await fetch(BASE + "/api/stripe/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": header },
    body: payload,
  });
  const d2 = await r2.json();
  check("el reenvío se descarta como duplicado", d2.duplicado === true, `duplicado=${d2.duplicado}`);

  // Un evento NUEVO para la misma sesión tampoco debe cobrar de nuevo.
  const otroId = JSON.parse(payload);
  otroId.id = "evt_e2e_otro_" + Date.now();
  const p2 = JSON.stringify(otroId);
  const ts2 = Math.floor(Date.now() / 1000);
  const h2 = `t=${ts2},v1=${createHmac("sha256", SECRET).update(`${ts2}.${p2}`).digest("hex")}`;
  const r3 = await fetch(BASE + "/api/stripe/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": h2 },
    body: p2,
  });
  const d3 = await r3.json();
  check(
    "otro evento para la misma sesión no vuelve a cobrar",
    d3.resultado === "cobro ya estaba pagado",
    `resultado "${d3.resultado}"`,
  );

  // Y ya pagado, fee-link se niega.
  const r4 = await api("/api/stripe/fee-link", { method: "POST", body: { chargeId: conSesion.id } });
  check("fee-link se niega sobre un cobro ya pagado", r4.status === 409, `status ${r4.status}`);
}

db.close();

// ─── Cierre ────────────────────────────────────────────────────────────────

console.log(`\n${fallos === 0 ? "Todo bien." : `${fallos} fallo(s).`}`);
process.exit(fallos === 0 ? 0 : 1);
