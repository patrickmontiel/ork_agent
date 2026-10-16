import "server-only";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Sesión de navegador para Spotify — Ruta A.
//
// LA PROMESA QUE ESTE ARCHIVO TIENE QUE CUMPLIR:
// Ork nunca ve, ni guarda, ni toca la contraseña. La persona inicia sesión
// ella misma, en una ventana que ve, en la página real de Spotify. Al terminar,
// la sesión se destruye.
//
// Tres invariantes, y están escritas como código para que no sean solo buenas
// intenciones:
//
//   1. NUNCA se llama context.storageState(). No hay forma de persistir la
//      sesión, ni por accidente.
//   2. El perfil vive en un directorio temporal NUEVO por corrida, y se borra
//      en dispose() — también cuando algo truena.
//   3. El navegador es VISIBLE. Si la persona no puede ver lo que pasa en su
//      cuenta, no está dando consentimiento informado, está firmando a ciegas.

export const CUENTA_URL = "https://www.spotify.com/mx/account/overview/";

/** Señales de que la cuenta quedó trabada. Ninguna se reintenta: se aborta. */
const SENALES_BLOQUEO = [
  /captcha/i,
  /verifica que eres tú/i,
  /verify (it'?s )?you/i,
  /cuenta (deshabilitada|suspendida)/i,
  /account (disabled|suspended)/i,
  /unusual activity/i,
  /actividad inusual/i,
];

export interface SesionSpotify {
  page: Page;
  dispose: () => Promise<void>;
}

/**
 * Abre un navegador visible en la página de cuenta y ESPERA a que la persona
 * inicie sesión. Ork no escribe nada: solo mira si ya apareció la página de
 * cuenta.
 *
 * @param esperaMs cuánto esperar a que la persona termine de entrar.
 */
export async function abrirSesionAsistida(opts: {
  esperaMs?: number;
  onPaso?: (mensaje: string) => void;
} = {}): Promise<SesionSpotify> {
  const esperaMs = opts.esperaMs ?? 5 * 60_000;
  const paso = opts.onPaso ?? (() => {});

  const perfil = await mkdtemp(join(tmpdir(), "ork-spotify-"));
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;

  const dispose = async () => {
    // Orden importante: cerrar antes de borrar, y que un fallo al cerrar no
    // impida el borrado del perfil. Un perfil que sobrevive es una sesión que
    // sobrevive.
    try {
      await context?.close();
    } catch {
      /* se ignora: lo que importa es borrar el perfil */
    }
    try {
      await browser?.close();
    } catch {
      /* ídem */
    }
    await rm(perfil, { recursive: true, force: true }).catch(() => {});
  };

  try {
    browser = await chromium.launch({
      headless: false, // innegociable: la persona tiene que ver qué pasa
      args: ["--no-first-run", "--no-default-browser-check"],
    });
    context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      locale: "es-MX",
      timezoneId: "America/Mexico_City",
    });
    const page = await context.newPage();

    paso("Abriendo la página de tu cuenta de Spotify…");
    await page.goto(CUENTA_URL, { waitUntil: "domcontentloaded" });

    paso("Inicia sesión tú. Ork no va a escribir nada ni a leer tu contraseña.");
    await esperarSesionIniciada(page, esperaMs);
    paso("Listo, ya estás dentro.");

    return { page, dispose };
  } catch (e) {
    await dispose();
    throw e;
  }
}

/**
 * Espera a que la página de cuenta esté renderizada.
 *
 * Se detecta por una señal POSTERIOR al login —que la página de cuenta exista—
 * nunca observando el formulario ni sus campos.
 */
async function esperarSesionIniciada(page: Page, timeout: number): Promise<void> {
  const limite = Date.now() + timeout;

  while (Date.now() < limite) {
    const bloqueo = await detectarBloqueo(page);
    if (bloqueo) {
      throw new BloqueoDeCuenta(bloqueo);
    }

    const url = page.url();
    const enCuenta = /\/account\//.test(url) && !/login|signup/.test(url);
    if (enCuenta) {
      // La URL no basta: hace falta que el contenido de la cuenta esté ahí.
      const hayContenido = await page
        .getByRole("heading", { name: /cuenta|account|plan/i })
        .first()
        .isVisible()
        .catch(() => false);
      if (hayContenido) return;
    }

    await page.waitForTimeout(1000);
  }

  throw new Error(
    "Pasó el tiempo de espera y la sesión no se inició. No se tocó nada.",
  );
}

export class BloqueoDeCuenta extends Error {
  readonly accountRestricted = true;
  constructor(public readonly senal: string) {
    super(`Spotify pidió una verificación o bloqueó la cuenta: "${senal}". Ork se detiene.`);
    this.name = "BloqueoDeCuenta";
  }
}

/** Devuelve el texto que disparó la sospecha, o null. */
export async function detectarBloqueo(page: Page): Promise<string | null> {
  const texto = await page.content().catch(() => "");
  for (const re of SENALES_BLOQUEO) {
    const m = texto.match(re);
    if (m) return m[0];
  }
  return null;
}
