import "server-only";
import { MAGIC_TTL_MINUTES } from "@/lib/auth/magic-link";

// Envío de correo con dos modos:
//
//   consola → imprime el link en la terminal. Es el default en desarrollo y no
//             necesita cuenta, dominio ni llave.
//   resend  → se activa SOLO si hay RESEND_API_KEY. Sin dependencias: la API
//             de Resend es un POST con fetch.
//
// Para el piloto: crea la cuenta, verifica el dominio, pon RESEND_API_KEY y
// RESEND_FROM en .env, y este archivo cambia de modo solo.

export type MailMode = "consola" | "resend";

export function mailMode(): MailMode {
  return process.env.RESEND_API_KEY ? "resend" : "consola";
}

export interface MailResult {
  ok: boolean;
  mode: MailMode;
  /** En modo consola se devuelve el link para que la UI lo pueda mostrar en dev. */
  devUrl?: string;
  error?: string;
}

interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

async function send(mail: Mail): Promise<MailResult> {
  const mode = mailMode();

  if (mode === "consola") {
    // eslint-disable-next-line no-console
    console.log(
      [
        "",
        "┌─────────────────────────────────────────────────────────────",
        `│ CORREO (modo consola) → ${mail.to}`,
        `│ ${mail.subject}`,
        "├─────────────────────────────────────────────────────────────",
        ...mail.text.split("\n").map((l) => `│ ${l}`),
        "└─────────────────────────────────────────────────────────────",
        "",
      ].join("\n"),
    );
    return { ok: true, mode };
  }

  const from = process.env.RESEND_FROM;
  if (!from) {
    return { ok: false, mode, error: "Hay RESEND_API_KEY pero falta RESEND_FROM." };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [mail.to],
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, mode, error: `Resend respondió ${res.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true, mode };
  } catch (e) {
    return { ok: false, mode, error: e instanceof Error ? e.message : String(e) };
  }
}

// ─── Correos de Ork ─────────────────────────────────────────────────────────

export async function sendMagicLink(to: string, url: string): Promise<MailResult> {
  const text = [
    "Entra a Ork",
    "",
    "Toca este link para continuar. No necesitas contraseña.",
    "",
    url,
    "",
    `El link sirve una sola vez y vence en ${MAGIC_TTL_MINUTES} minutos.`,
    "Si no lo pediste, ignora este correo.",
  ].join("\n");

  const html = `<!doctype html>
<html lang="es-MX"><body style="margin:0;background:#0B0D17;color:#F2F4F7;font-family:system-ui,-apple-system,sans-serif;padding:40px 20px">
  <div style="max-width:440px;margin:0 auto">
    <div style="font-size:28px;font-weight:700;letter-spacing:-.02em">ork<span style="color:#6C2EFF">.</span></div>
    <h1 style="font-size:22px;font-weight:600;margin:28px 0 10px">Entra a Ork</h1>
    <p style="color:#9AA1B4;line-height:1.6;margin:0 0 26px">Toca el botón para continuar. No necesitas contraseña.</p>
    <a href="${url}" style="display:inline-block;background:#6C2EFF;color:#fff;text-decoration:none;padding:14px 26px;border-radius:10px;font-weight:600">Continuar</a>
    <p style="color:#6B7385;font-size:13px;line-height:1.6;margin:28px 0 0">
      El link sirve una sola vez y vence en ${MAGIC_TTL_MINUTES} minutos.<br>
      Si no lo pediste, ignora este correo.
    </p>
  </div>
</body></html>`;

  const r = await send({ to, subject: "Entra a Ork", html, text });
  // En dev devolvemos el link para que la pantalla lo muestre y no haya que
  // ir a buscar la terminal.
  return r.mode === "consola" ? { ...r, devUrl: url } : r;
}
