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

/**
 * Mensaje de rescate: el cobro del comercio falló.
 *
 * Tres decisiones que hacen que esto no sea spam:
 *
 *  1. Va con la marca de Ork y DICE de qué comercio habla. Un correo que
 *     avisa de un cobro fallido sin nombrar el servicio es indistinguible de
 *     una estafa, y enseña a la gente a hacerle caso a los que sí lo son.
 *  2. No pide datos ni lleva a un formulario de Ork: manda a la cuenta del
 *     propio servicio. Ork nunca va a pedir una tarjeta por correo.
 *  3. Ofrece lo único que Ork sabe hacer —mover la fecha— solo cuando de
 *     verdad viene al caso, y sin prometer que lo arregla.
 */
export async function sendRescue(input: {
  to: string;
  serviceName: string;
  amount?: number | null;
  currency?: string;
  /** Día al que convendría mover el cobro, si se sabe. */
  suggestedDay?: number | null;
  orchestrateUrl?: string;
}): Promise<MailResult> {
  const { to, serviceName } = input;
  const monto =
    input.amount != null
      ? ` de $${input.amount.toLocaleString("es-MX")} ${input.currency ?? "MXN"}`
      : "";

  const sugerencia =
    input.suggestedDay != null
      ? `Si el problema es que te cae en mala fecha, puedes mover el cobro de ${serviceName} al día ${input.suggestedDay}.`
      : `Si el problema es que te cae en mala fecha, puedes mover el día de cobro de ${serviceName}.`;

  const text = [
    `No se pudo cobrar tu ${serviceName}`,
    "",
    `El cobro${monto} de ${serviceName} no pasó. Normalmente es que no había fondos ese día, no que haya algo mal con tu tarjeta.`,
    "",
    `Primero: entra a tu cuenta de ${serviceName} y revisa el estado de tu suscripción. Ork no puede pagarlo por ti.`,
    "",
    sugerencia,
    ...(input.orchestrateUrl ? ["", input.orchestrateUrl] : []),
    "",
    "Ork nunca te va a pedir tu tarjeta ni tu contraseña por correo.",
  ].join("\n");

  const html = `<!doctype html>
<html lang="es-MX"><body style="margin:0;background:#0B0D17;color:#F2F4F7;font-family:system-ui,-apple-system,sans-serif;padding:40px 20px">
  <div style="max-width:440px;margin:0 auto">
    <div style="font-size:28px;font-weight:700;letter-spacing:-.02em">ork<span style="color:#6C2EFF">.</span></div>
    <h1 style="font-size:22px;font-weight:600;margin:28px 0 10px">No se pudo cobrar tu ${serviceName}</h1>
    <p style="color:#9AA1B4;line-height:1.6;margin:0 0 18px">
      El cobro${monto} de <strong style="color:#F2F4F7">${serviceName}</strong> no pasó.
      Normalmente es que no había fondos ese día, no que haya algo mal con tu tarjeta.
    </p>
    <p style="color:#9AA1B4;line-height:1.6;margin:0 0 18px">
      Entra a tu cuenta de ${serviceName} y revisa el estado de tu suscripción. Ork no puede pagarlo por ti.
    </p>
    <p style="color:#9AA1B4;line-height:1.6;margin:0 0 26px">${sugerencia}</p>
    ${
      input.orchestrateUrl
        ? `<a href="${input.orchestrateUrl}" style="display:inline-block;background:#6C2EFF;color:#fff;text-decoration:none;padding:14px 26px;border-radius:10px;font-weight:600">Mover el día de cobro</a>`
        : ""
    }
    <p style="color:#6B7385;font-size:13px;line-height:1.6;margin:28px 0 0">
      Ork nunca te va a pedir tu tarjeta ni tu contraseña por correo.
    </p>
  </div>
</body></html>`;

  return send({ to, subject: `No se pudo cobrar tu ${serviceName}`, html, text });
}
