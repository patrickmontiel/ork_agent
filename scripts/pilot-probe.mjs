// Sonda de la Fase 5 contra el servidor corriendo.
//
//   node scripts/pilot-probe.mjs
//
// Verifica las piezas que no se pueden probar con node --test porque viven en
// rutas: la puerta del admin, la encuesta, el rechazo explícito y el rescate
// firmado desde el comercio.

import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";

const BASE = process.argv[2] ?? "http://localhost:3001";

const env = {};
for (const l of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const i = l.indexOf("=");
  if (i > 0 && !l.startsWith("#")) env[l.slice(0, i).trim()] = l.slice(i + 1).trim();
}

let fallos = 0;
function check(nombre, cond, detalle) {
  console.log(`${cond ? "✓" : "✗"} ${nombre}${detalle ? `  → ${detalle}` : ""}`);
  if (!cond) fallos++;
}

function cliente() {
  let cookies = {};
  return {
    get cookieHeader() {
      return Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");
    },
    async call(path, { method = "GET", body, raw, headers = {} } = {}) {
      const res = await fetch(BASE + path, {
        method,
        headers: {
          ...(body || raw ? { "Content-Type": "application/json" } : {}),
          ...(Object.keys(cookies).length ? { cookie: this.cookieHeader } : {}),
          ...headers,
        },
        body: raw ?? (body ? JSON.stringify(body) : undefined),
        redirect: "manual",
      });
      for (const c of res.headers.getSetCookie?.() ?? []) {
        const [kv] = c.split(";");
        const i = kv.indexOf("=");
        cookies[kv.slice(0, i)] = kv.slice(i + 1);
      }
      const texto = await res.text();
      let data = null;
      try {
        data = JSON.parse(texto);
      } catch {
        data = null;
      }
      return { status: res.status, data, texto };
    },
  };
}

// ─── 1. La puerta del admin ─────────────────────────────────────────────────

console.log("\n── 1. El admin no se abre solo ──");
{
  const anon = cliente();
  const r = await anon.call("/admin/pilot");
  check("sin token, /admin/pilot pide el token", r.texto.includes("Token de admin"), `status ${r.status}`);
  check(
    "y NO filtra métricas",
    !r.texto.includes("Las 5 métricas") && !r.texto.includes("Lo que salió mal"),
    "sin datos del piloto en el HTML",
  );

  const mal = await anon.call("/api/admin/login", { method: "POST", body: { token: "equivocado" } });
  check("token equivocado → 401", mal.status === 401, `status ${mal.status}`);

  const vacio = await anon.call("/api/admin/login", { method: "POST", body: { token: "" } });
  check("token vacío → 401", vacio.status === 401, `status ${vacio.status}`);
}

const admin = cliente();
{
  const ok = await admin.call("/api/admin/login", {
    method: "POST",
    body: { token: env.ADMIN_TOKEN },
  });
  check("token correcto → entra", ok.status === 200 && ok.data?.ok === true, `status ${ok.status}`);

  const panel = await admin.call("/admin/pilot");
  check("el tablero carga", panel.texto.includes("Las 5 métricas"), `status ${panel.status}`);
  for (const m of [
    "Éxito técnico",
    "Cortes de servicio",
    "Cuentas restringidas",
    "Entendieron qué iba a pasar",
    "Dijeron que no al ver los números",
  ]) {
    check(`métrica presente: ${m}`, panel.texto.includes(m));
  }
  check(
    "advierte si Stripe estuviera en modo real",
    panel.texto.includes("modo prueba"),
    "hoy está en prueba",
  );
}

// ─── 2. Encuesta y rechazo explícito ────────────────────────────────────────

console.log("\n── 2. Encuesta de comprensión y rechazo ──");

const u = cliente();
{
  const email = `probe-f5-${Date.now()}@ork.test`;
  const m = await u.call("/api/auth/magic", { method: "POST", body: { email } });
  await u.call(m.data.devUrl.replace(BASE, ""));
  await u.call("/api/mandate", { method: "POST", body: { serviceId: "spotify", scrolledToEnd: true } });

  // (a) Rechazo explícito: ve los números y dice que no.
  const r1 = await u.call("/api/orchestrate", {
    method: "POST",
    body: { serviceId: "spotify", targetDay: 20, scenario: "feliz" },
  });
  const rech = await u.call("/api/orchestrate", {
    method: "DELETE",
    body: { orchestrationId: r1.data.orquestacion.id, opcion: "esperar" },
  });
  check("un 'no mover' se registra", rech.status === 200 && rech.data?.ok, `status ${rech.status}`);

  const otra = await u.call("/api/orchestrate", {
    method: "DELETE",
    body: { orchestrationId: r1.data.orquestacion.id },
  });
  check("y no se puede rechazar dos veces", otra.status === 409, `status ${otra.status}`);

  // (b) Encuesta sobre una orquestación ejecutada.
  const r2 = await u.call("/api/orchestrate", {
    method: "POST",
    body: { serviceId: "spotify", targetDay: 21, scenario: "feliz" },
  });
  const id2 = r2.data.orquestacion.id;

  const temprano = await u.call("/api/survey", {
    method: "POST",
    body: { orchestrationId: id2, understood: true },
  });
  check(
    "no se puede responder antes de que pase nada",
    temprano.status === 422,
    `status ${temprano.status}`,
  );

  await u.call("/api/orchestrate", {
    method: "PUT",
    body: { orchestrationId: id2, option: "esperar", scenario: "feliz" },
  });

  const enc = await u.call("/api/survey", {
    method: "POST",
    body: { orchestrationId: id2, understood: false, comment: "No entendí lo de los días sin servicio." },
  });
  check("la respuesta se guarda", enc.status === 200 && enc.data?.ok, `status ${enc.status}`);

  const dup = await u.call("/api/survey", {
    method: "POST",
    body: { orchestrationId: id2, understood: true },
  });
  check(
    "responder otra vez no pisa la primera",
    dup.data?.yaRespondida === true,
    `yaRespondida=${dup.data?.yaRespondida}`,
  );

  // (c) No se puede responder por una orquestación ajena.
  const otro = cliente();
  const m2 = await otro.call("/api/auth/magic", { method: "POST", body: { email: `ajeno-${Date.now()}@ork.test` } });
  await otro.call(m2.data.devUrl.replace(BASE, ""));
  const ajena = await otro.call("/api/survey", {
    method: "POST",
    body: { orchestrationId: id2, understood: true },
  });
  check("no se responde por la orquestación de otro", ajena.status === 404, `status ${ajena.status}`);

  // (d) El comentario de confusión llega al tablero.
  const panel = await admin.call("/admin/pilot");
  check(
    "el comentario aparece en 'Lo que no quedó claro'",
    panel.texto.includes("No entendí lo de los días sin servicio"),
  );
}

// ─── 3. Rescate firmado desde el comercio ───────────────────────────────────

console.log("\n── 3. Rescate: el comercio avisa que no pudo cobrar ──");
{
  const SECRET = env.MERCHANT_WEBHOOK_SECRET;
  const anon = cliente();

  function firmar(raw, secret = SECRET, ts = Math.floor(Date.now() / 1000)) {
    return `t=${ts},v1=${createHmac("sha256", secret).update(`${ts}.${raw}`).digest("hex")}`;
  }

  const email = `rescate-${Date.now()}@ork.test`;
  const reg = cliente();
  const m = await reg.call("/api/auth/magic", { method: "POST", body: { email } });
  await reg.call(m.data.devUrl.replace(BASE, ""));

  const cuerpo = JSON.stringify({ email, serviceId: "spotify", amount: 139, currency: "MXN" });

  const sinFirma = await anon.call("/api/merchant/payment-failed", { method: "POST", raw: cuerpo });
  check("sin firma → 400", sinFirma.status === 400, `status ${sinFirma.status}`);

  const malFirma = await anon.call("/api/merchant/payment-failed", {
    method: "POST",
    raw: cuerpo,
    headers: { "ork-signature": firmar(cuerpo, "secreto-equivocado") },
  });
  check("firma de otro secreto → 400", malFirma.status === 400, `status ${malFirma.status}`);

  const vieja = await anon.call("/api/merchant/payment-failed", {
    method: "POST",
    raw: cuerpo,
    headers: { "ork-signature": firmar(cuerpo, SECRET, Math.floor(Date.now() / 1000) - 3600) },
  });
  check("firma de hace una hora → 400", vieja.status === 400, `status ${vieja.status}`);

  const alterado = await anon.call("/api/merchant/payment-failed", {
    method: "POST",
    raw: cuerpo.replace("139", "999"),
    headers: { "ork-signature": firmar(cuerpo) },
  });
  check("cuerpo alterado → 400", alterado.status === 400, `status ${alterado.status}`);

  const bien = await anon.call("/api/merchant/payment-failed", {
    method: "POST",
    raw: cuerpo,
    headers: { "ork-signature": firmar(cuerpo) },
  });
  check(
    "firma válida → se manda el rescate",
    bien.status === 200 && bien.data?.enviado === true,
    `status ${bien.status}, modo ${bien.data?.modo}`,
  );

  // Alguien que no tiene cuenta: responde 200 igual, sin decir que no existe.
  const cuerpoDesconocido = JSON.stringify({
    email: `nadie-${Date.now()}@ork.test`,
    serviceId: "spotify",
  });
  const desconocido = await anon.call("/api/merchant/payment-failed", {
    method: "POST",
    raw: cuerpoDesconocido,
    headers: { "ork-signature": firmar(cuerpoDesconocido) },
  });
  check(
    "un email desconocido no revela si tiene cuenta",
    desconocido.status === 200 && desconocido.data?.enviado === false,
    `status ${desconocido.status}, enviado=${desconocido.data?.enviado}`,
  );
}

console.log(`\n${fallos === 0 ? "Todo bien." : `${fallos} fallo(s).`}`);
process.exit(fallos === 0 ? 0 : 1);
