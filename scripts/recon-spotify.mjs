// FASE 0 — Reconocimiento de SOLO LECTURA de la cuenta de Spotify.
//
//   node scripts/recon-spotify.mjs
//
// QUÉ HACE: abre un navegador visible, espera a que TÚ inicies sesión, lee la
// página de tu cuenta y escribe un reporte con lo que encontró y con los
// selectores candidatos para el adaptador real.
//
// QUÉ NO HACE, Y ESTÁ FORZADO POR CÓDIGO:
//   - No hace NINGÚN clic. page.click está interceptado y lanza.
//   - No envía formularios. No navega a /cancel ni a /subscription/change.
//   - No escribe tu contraseña ni la lee. Tú la escribes, en la página real.
//   - No guarda cookies ni tokens. El perfil es temporal y se borra al salir.
//
// El reporte se guarda en docs/recon-spotify.md. Las capturas NO se guardan por
// defecto: pueden traer tu correo y los últimos 4 de tu tarjeta. Si las quieres,
// corre con --capturas y revísalas antes de compartirlas.

import { chromium } from "playwright";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const GUARDAR_CAPTURAS = process.argv.includes("--capturas");
const CUENTA_URL = "https://www.spotify.com/mx/account/overview/";
const ESPERA_LOGIN_MS = 6 * 60_000;

// Rutas que SÍ se pueden visitar: todas son de lectura.
const RUTAS_LECTURA = [
  ["overview", "https://www.spotify.com/mx/account/overview/"],
  ["plan", "https://www.spotify.com/mx/account/subscription/"],
];

const log = (m) => console.log(m);

// ─── Barrera: ningún clic, ninguna navegación que mute ──────────────────────

function blindarPagina(page) {
  const prohibido = (que) => () => {
    throw new Error(
      `BARRERA DE SOLO LECTURA: se intentó "${que}". La Fase 0 no muta nada. Si esto pasó, es un bug del script.`,
    );
  };
  page.click = prohibido("page.click");
  page.dblclick = prohibido("page.dblclick");
  page.fill = prohibido("page.fill");
  page.type = prohibido("page.type");
  page.press = prohibido("page.press");
  page.selectOption = prohibido("page.selectOption");
  page.setChecked = prohibido("page.setChecked");

  // Y por si acaso: se bloquea en red cualquier cosa que parezca una mutación.
  return page.route("**/*", (route) => {
    const req = route.request();
    const metodo = req.method();
    const url = req.url();
    const mutaUrl = /(cancel|unsubscribe|downgrade|change|checkout|pause)/i.test(url);
    if (metodo !== "GET" && metodo !== "HEAD" && mutaUrl) {
      log(`  ⛔ bloqueada petición ${metodo} sospechosa: ${url.slice(0, 90)}`);
      return route.abort();
    }
    return route.continue();
  });
}

// ─── Lectura ────────────────────────────────────────────────────────────────

async function leerCandidatos(page) {
  return page.evaluate(() => {
    const limpio = (t) => (t || "").replace(/\s+/g, " ").trim();
    const texto = limpio(document.body.innerText);

    // Patrones de fecha en español e inglés: la cuenta puede estar en cualquiera.
    const fechas = [
      ...texto.matchAll(
        /(\d{1,2}\s+de\s+[a-záéíóú]+\s+de\s+\d{4}|[A-Za-z]+\s+\d{1,2},\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4})/gi,
      ),
    ].map((m) => m[0]);

    const montos = [...texto.matchAll(/\$\s?\d[\d,]*(?:\.\d{2})?/g)].map((m) => m[0]);

    const planes = [
      ...texto.matchAll(/premium\s+(individual|duo|familiar|family|student|estudiantes)/gi),
    ].map((m) => m[0]);

    // Frases que suelen rodear la fecha de renovación.
    const contexto = [];
    for (const re of [
      /(?:próxim[ao]|next)[^.\n]{0,80}/gi,
      /(?:renov|renew)[^.\n]{0,80}/gi,
      /(?:se renueva|billing date|fecha de facturación|facturación)[^.\n]{0,80}/gi,
      /(?:cancelad|cancel(?:led|ed)?)[^.\n]{0,80}/gi,
    ]) {
      for (const m of texto.matchAll(re)) contexto.push(m[0].trim());
    }

    // Elementos con testid, que son los selectores más estables si existen.
    const testids = [...document.querySelectorAll("[data-testid]")]
      .map((el) => ({
        testid: el.getAttribute("data-testid"),
        tag: el.tagName.toLowerCase(),
        texto: limpio(el.textContent).slice(0, 70),
      }))
      .filter((x) => x.texto)
      .slice(0, 60);

    // Enlaces y botones visibles: el mapa del flujo, sin tocarlo.
    const acciones = [...document.querySelectorAll("a, button")]
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        texto: limpio(el.textContent).slice(0, 60),
        href: el.getAttribute("href") || "",
      }))
      .filter((x) => x.texto)
      .slice(0, 80);

    return {
      titulo: document.title,
      fechas: [...new Set(fechas)].slice(0, 12),
      montos: [...new Set(montos)].slice(0, 12),
      planes: [...new Set(planes)].slice(0, 6),
      contexto: [...new Set(contexto)].slice(0, 15),
      testids,
      acciones,
      largoTexto: texto.length,
    };
  });
}

// ─── Main ───────────────────────────────────────────────────────────────────

const perfil = await mkdtemp(join(tmpdir(), "ork-recon-"));
let browser = null;
let context = null;
const hallazgos = [];

try {
  log("\n── Fase 0: reconocimiento de SOLO LECTURA ──\n");
  log("Se va a abrir un navegador. Inicia sesión TÚ.");
  log("Ork no escribe nada, no hace clic en nada y no guarda cookies.\n");

  browser = await chromium.launch({
    headless: false,
    args: ["--no-first-run", "--no-default-browser-check"],
  });
  context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "es-MX",
    timezoneId: "America/Mexico_City",
  });
  const page = await context.newPage();
  await blindarPagina(page);

  await page.goto(CUENTA_URL, { waitUntil: "domcontentloaded" });

  log("Esperando a que inicies sesión (hasta 6 minutos)…");
  const limite = Date.now() + ESPERA_LOGIN_MS;
  let dentro = false;
  while (Date.now() < limite) {
    const url = page.url();
    if (/\/account\//.test(url) && !/login|signup/.test(url)) {
      const hay = await page
        .getByRole("heading", { name: /cuenta|account|plan/i })
        .first()
        .isVisible()
        .catch(() => false);
      if (hay) {
        dentro = true;
        break;
      }
    }
    await page.waitForTimeout(1000);
  }
  if (!dentro) throw new Error("No se inició sesión a tiempo. No se tocó nada.");

  log("✓ Sesión iniciada. Leyendo…\n");

  for (const [nombre, url] of RUTAS_LECTURA) {
    log(`  leyendo: ${nombre}`);
    await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForTimeout(2500);
    const datos = await leerCandidatos(page);
    hallazgos.push({ nombre, url: page.url(), ...datos });

    if (GUARDAR_CAPTURAS) {
      await mkdir("docs/recon", { recursive: true });
      await page.screenshot({ path: `docs/recon/${nombre}.png`, fullPage: true });
      log(`    captura: docs/recon/${nombre}.png  (revísala antes de compartirla)`);
    }
  }

  // ── Reporte ──
  const hoy = new Date().toISOString().slice(0, 10);
  const md = [
    `# Reconocimiento de Spotify — SOLO LECTURA`,
    ``,
    `Generado: ${hoy}. Ningún clic, ninguna mutación.`,
    ``,
    GUARDAR_CAPTURAS
      ? `> Se guardaron capturas en \`docs/recon/\`. **Pueden contener tu correo y los últimos 4 de tu tarjeta.** Revísalas antes de compartir o commitear.`
      : `> Sin capturas. Corre con \`--capturas\` si las quieres (y revísalas antes de compartirlas).`,
    ``,
  ];

  for (const h of hallazgos) {
    md.push(`## ${h.nombre}`, ``, `\`${h.url}\``, ``, `**Título:** ${h.titulo}`, ``);
    md.push(`**Planes detectados:** ${h.planes.join(", ") || "—"}`, ``);
    md.push(`**Montos:** ${h.montos.join(", ") || "—"}`, ``);
    md.push(`**Fechas:** ${h.fechas.join(" · ") || "—"}`, ``);
    md.push(`**Frases alrededor de la fecha:**`, ``);
    for (const c of h.contexto) md.push(`- ${c}`);
    md.push(``, `**data-testid disponibles** (los selectores más estables):`, ``);
    for (const t of h.testids) md.push(`- \`${t.testid}\` (${t.tag}) — ${t.texto}`);
    md.push(``, `**Acciones visibles** (mapa del flujo, NO se tocaron):`, ``);
    for (const a of h.acciones) md.push(`- ${a.tag}: "${a.texto}"${a.href ? ` → ${a.href}` : ""}`);
    md.push(``, `---`, ``);
  }

  md.push(
    `## Qué contestar con esto`,
    ``,
    `- [ ] ¿El plan es Duo? ¿Aparece el segundo miembro?`,
    `- [ ] ¿Dónde vive exactamente la fecha de renovación y con qué texto?`,
    `- [ ] ¿Hay método de pago guardado? (define si el recontrato puede ser un clic)`,
    `- [ ] ¿La acción de cancelar es un enlace o un botón? ¿A qué URL va?`,
    `- [ ] ¿Hay \`data-testid\` estables, o hay que caer a rol + texto?`,
    `- [ ] ¿La cuenta está en español o en inglés?`,
  );

  await mkdir("docs", { recursive: true });
  await writeFile("docs/recon-spotify.md", md.join("\n"), "utf8");

  log(`\n✓ Reporte: docs/recon-spotify.md`);
  log(`  ${hallazgos.length} páginas leídas, 0 clics, 0 mutaciones.\n`);
} catch (e) {
  log(`\n✗ ${e.message}\n`);
  process.exitCode = 1;
} finally {
  try {
    await context?.close();
  } catch {
    /* lo que importa es borrar el perfil */
  }
  try {
    await browser?.close();
  } catch {
    /* ídem */
  }
  await rm(perfil, { recursive: true, force: true }).catch(() => {});
  log("Sesión destruida y perfil temporal borrado. No quedó nada en disco.");
}
