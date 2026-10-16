// Sonda del webhook de Stripe contra el servidor corriendo de verdad.
//
// Los tests de tests/billing.test.ts prueban las reglas; esto prueba la ruta:
// que el cuerpo llegue crudo, que la firma se verifique, y que un reenvío no
// se procese dos veces. Es lo que Stripe CLI haría, sin necesitar Stripe CLI.
//
//   node scripts/webhook-probe.mjs [url]
//
// Lee STRIPE_WEBHOOK_SECRET de .env y nunca lo imprime.

import { readFileSync } from "node:fs";
import { createHmac, randomUUID } from "node:crypto";

const URL_WEBHOOK = process.argv[2] ?? "http://localhost:3001/api/stripe/webhook";

function leerEnv() {
  const env = {};
  for (const linea of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const i = linea.indexOf("=");
    if (i > 0 && !linea.startsWith("#")) env[linea.slice(0, i).trim()] = linea.slice(i + 1).trim();
  }
  return env;
}

const env = leerEnv();
const SECRET = env.STRIPE_WEBHOOK_SECRET;
if (!SECRET) {
  console.error("Falta STRIPE_WEBHOOK_SECRET en .env");
  process.exit(1);
}

function firmar(payload, secret = SECRET, ts = Math.floor(Date.now() / 1000)) {
  const v1 = createHmac("sha256", secret).update(`${ts}.${payload}`).digest("hex");
  return `t=${ts},v1=${v1}`;
}

function evento(id, extra = {}) {
  return JSON.stringify({
    id,
    object: "event",
    type: "checkout.session.completed",
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: "cs_test_" + randomUUID().slice(0, 8),
        object: "checkout.session",
        payment_status: "paid",
        metadata: {},
        ...extra,
      },
    },
  });
}

async function enviar(payload, header) {
  const res = await fetch(URL_WEBHOOK, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(header ? { "stripe-signature": header } : {}),
    },
    body: payload,
  });
  let cuerpo;
  try {
    cuerpo = await res.json();
  } catch {
    cuerpo = { texto: (await res.text()).slice(0, 120) };
  }
  return { status: res.status, cuerpo };
}

let fallos = 0;
function check(nombre, cond, detalle) {
  console.log(`${cond ? "✓" : "✗"} ${nombre}${detalle ? `  → ${detalle}` : ""}`);
  if (!cond) fallos++;
}

const casos = [];

// 1. Sin firma.
{
  const p = evento("evt_probe_sin_firma");
  const r = await enviar(p, null);
  casos.push(["sin firma → 400", r.status === 400, `status ${r.status}`]);
}

// 2. Firma con la llave equivocada: el ataque real.
{
  const p = evento("evt_probe_falso", { metadata: { orkKind: "premium", orkUserId: "u1" } });
  const r = await enviar(p, firmar(p, "whsec_" + "0".repeat(48)));
  casos.push(["firma de otra llave → 400", r.status === 400, `status ${r.status}`]);
}

// 3. Cuerpo alterado después de firmar.
{
  const p = evento("evt_probe_alterado");
  const header = firmar(p);
  const r = await enviar(p.replace('"paid"', '"unpaid"'), header);
  casos.push(["cuerpo alterado → 400", r.status === 400, `status ${r.status}`]);
}

// 4. Firma vieja (replay).
{
  const p = evento("evt_probe_viejo");
  const r = await enviar(p, firmar(p, SECRET, Math.floor(Date.now() / 1000) - 7200));
  casos.push(["firma de hace 2 h → 400", r.status === 400, `status ${r.status}`]);
}

// 5. Firma válida. Y 6: el MISMO evento otra vez.
{
  const id = "evt_probe_" + randomUUID().slice(0, 8);
  const p = evento(id);
  const header = firmar(p);

  const r1 = await enviar(p, header);
  casos.push([
    "firma válida → 200 y se procesa",
    r1.status === 200 && r1.cuerpo?.ok === true && !r1.cuerpo?.duplicado,
    `status ${r1.status}, resultado "${r1.cuerpo?.resultado}"`,
  ]);

  const r2 = await enviar(p, firmar(p));
  casos.push([
    "reenvío del mismo event.id → 200 y duplicado",
    r2.status === 200 && r2.cuerpo?.duplicado === true,
    `status ${r2.status}, duplicado=${r2.cuerpo?.duplicado}`,
  ]);
}

console.log(`\n── sonda del webhook: ${URL_WEBHOOK} ──`);
for (const [n, ok, d] of casos) check(n, ok, d);
console.log(fallos === 0 ? "\nTodo bien." : `\n${fallos} fallo(s).`);
process.exit(fallos === 0 ? 0 : 1);
