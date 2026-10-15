import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/session";
import { grant, revoke, activeMandate } from "@/lib/db/repo/mandates";
import { getService } from "@/lib/db/repo/services";
import { currentText, fullText } from "@/lib/mandate/texts";

export const dynamic = "force-dynamic";

function clientIp(req: NextRequest): string | undefined {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    undefined
  );
}

/** POST — otorga el mandato. */
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Necesitas iniciar sesión." }, { status: 401 });
  }

  let body: { serviceId?: string; textVersion?: string; scrolledToEnd?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Cuerpo inválido." }, { status: 400 });
  }

  const service = body.serviceId ? getService(body.serviceId) : undefined;
  if (!service) {
    return NextResponse.json({ ok: false, error: "Ese servicio no existe." }, { status: 404 });
  }
  if (service.role !== "cerrado") {
    return NextResponse.json(
      { ok: false, error: "Este servicio no necesita permiso." },
      { status: 422 },
    );
  }

  const texto = currentText(service.id);
  if (!texto) {
    return NextResponse.json(
      { ok: false, error: "Todavía no hay texto de permiso para este servicio." },
      { status: 422 },
    );
  }

  // La versión que manda el cliente tiene que ser la vigente. Si el usuario
  // tenía la pestaña abierta cuando se publicó una versión nueva, firmaría un
  // texto distinto del que quedaría registrado.
  if (body.textVersion && body.textVersion !== texto.version) {
    return NextResponse.json(
      {
        ok: false,
        error: "El texto cambió mientras lo leías. Vuelve a abrirlo para firmar la versión vigente.",
        versionVigente: texto.version,
      },
      { status: 409 },
    );
  }

  // El botón del cliente ya está bloqueado hasta el final del texto. Esto es la
  // segunda reja: un POST directo sin leer tampoco pasa.
  if (body.scrolledToEnd !== true) {
    return NextResponse.json(
      { ok: false, error: "Hay que leer el texto completo antes de aceptar." },
      { status: 422 },
    );
  }

  const ya = activeMandate(user.id, service.id, texto.actionType);
  if (ya) {
    return NextResponse.json({ ok: true, mandato: { id: ya.id, yaExistia: true } });
  }

  const m = grant({
    userId: user.id,
    serviceId: service.id,
    actionType: texto.actionType,
    textVersion: texto.version,
    fullText: fullText(texto),
    ip: clientIp(req),
    userAgent: req.headers.get("user-agent") ?? undefined,
    scrolledToEnd: true,
  });

  return NextResponse.json({
    ok: true,
    mandato: { id: m.id, version: m.text_version, otorgado: m.timestamp },
  });
}

/** DELETE — revoca. */
export async function DELETE(req: NextRequest) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Necesitas iniciar sesión." }, { status: 401 });
  }

  let body: { mandateId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Cuerpo inválido." }, { status: 400 });
  }
  if (!body.mandateId) {
    return NextResponse.json({ ok: false, error: "Falta el id del permiso." }, { status: 400 });
  }

  const ok = revoke(user.id, body.mandateId);
  if (!ok) {
    return NextResponse.json(
      { ok: false, error: "Ese permiso no existe o ya estaba revocado." },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true });
}
