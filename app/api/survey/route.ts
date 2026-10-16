import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/session";
import { answer, answeredFor } from "@/lib/db/repo/survey";
import * as orch from "@/lib/db/repo/orchestrations";

export const dynamic = "force-dynamic";

// Una pregunta, una respuesta, sobre una orquestación que la persona vivió.
//
// No se pregunta en abstracto ni antes de tiempo: solo se acepta respuesta
// sobre una orquestación propia y ya ejecutada.

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Necesitas iniciar sesión." }, { status: 401 });
  }

  let body: { orchestrationId?: string; understood?: boolean; comment?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Cuerpo inválido." }, { status: 400 });
  }

  if (typeof body.understood !== "boolean") {
    return NextResponse.json({ ok: false, error: "Falta la respuesta." }, { status: 400 });
  }

  const row = body.orchestrationId ? orch.get(body.orchestrationId, user.id) : undefined;
  if (!row) {
    return NextResponse.json({ ok: false, error: "Esa operación no existe." }, { status: 404 });
  }
  if (!row.confirmed_at) {
    return NextResponse.json(
      { ok: false, error: "Todavía no pasó nada sobre lo que preguntar." },
      { status: 422 },
    );
  }

  if (answeredFor(row.id)) {
    // Ya respondió. No es un error y no se pisa: una por orquestación.
    return NextResponse.json({ ok: true, yaRespondida: true });
  }

  answer({
    orchestrationId: row.id,
    userId: user.id,
    understood: body.understood,
    comment: body.comment,
  });

  return NextResponse.json({ ok: true });
}
