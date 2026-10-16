import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/session";
import { createPremiumCheckout } from "@/lib/billing/fee";
import { stripeEnabled } from "@/lib/stripe/client";

export const dynamic = "force-dynamic";

// Inicia el pago de Premium. El fee por evento NO pasa por aquí: lo crea el
// motor de orquestación después de un éxito verificado, nunca antes.

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Necesitas iniciar sesión." }, { status: 401 });
  }
  if (!stripeEnabled()) {
    return NextResponse.json(
      { ok: false, error: "Los pagos todavía no están configurados." },
      { status: 503 },
    );
  }

  let body: { plan?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  if (body.plan !== "premium") {
    return NextResponse.json(
      { ok: false, error: "Solo Premium se contrata desde aquí." },
      { status: 400 },
    );
  }

  if (user.plan === "premium") {
    return NextResponse.json({ ok: false, error: "Ya tienes Premium." }, { status: 409 });
  }

  try {
    const url = await createPremiumCheckout(user);
    return NextResponse.json({ ok: true, url });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "No pudimos iniciar el pago." },
      { status: 502 },
    );
  }
}
