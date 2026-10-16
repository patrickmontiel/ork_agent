import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe/client";
import { db, now } from "@/lib/db";
import { bySession, markPaid, markFailed } from "@/lib/db/repo/charges";
import { setPlan, findById } from "@/lib/db/repo/users";
import { track } from "@/lib/db/repo/events";

export const dynamic = "force-dynamic";
// El cuerpo crudo es obligatorio: la firma se calcula sobre los bytes exactos.
// Si Next parsea el JSON antes, la verificación falla siempre.
export const runtime = "nodejs";

// Webhook de Stripe.
//
// DOS COSAS QUE NO SON OPCIONALES:
//
// 1. Verificar la firma. Sin eso, cualquiera que conozca la URL puede fabricar
//    un "pago completado" y activar Premium gratis.
//
// 2. Idempotencia por event.id. Stripe NO garantiza entrega única: reenvía ante
//    cualquier duda, y reintenta durante días si algo falla. Sin la tabla
//    stripe_events, un reenvío cobraría dos veces o activaría Premium dos veces.
//
// Siempre se responde 200 salvo por firma inválida. Un 500 hace que Stripe
// reintente durante días, y si el fallo es nuestro el reintento no lo arregla.

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "Falta STRIPE_WEBHOOK_SECRET. Córrelo con: stripe listen --forward-to localhost:3001/api/stripe/webhook" },
      { status: 500 },
    );
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ ok: false, error: "Sin firma." }, { status: 400 });
  }

  const raw = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(raw, signature, secret);
  } catch (e) {
    // Firma inválida: 400 a propósito. No se registra el evento ni se procesa.
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Firma inválida." },
      { status: 400 },
    );
  }

  // ── Idempotencia ────────────────────────────────────────────────────────
  // El INSERT condicional es la parte atómica: si otro reenvío llegó primero,
  // `changes` viene en 0 y este se descarta sin tocar nada.
  const inserted = db()
    .prepare(
      `INSERT OR IGNORE INTO stripe_events (event_id, type, received_at) VALUES (?, ?, ?)`,
    )
    .run(event.id, event.type, now());

  if (inserted.changes === 0) {
    return NextResponse.json({ ok: true, duplicado: true, eventId: event.id });
  }

  let resultado = "ignorado";
  try {
    resultado = await handle(event);
  } catch (e) {
    resultado = e instanceof Error ? e.message : String(e);
    track({
      type: "fee.skipped",
      severity: "warn",
      payload: { eventId: event.id, tipo: event.type, error: resultado },
    });
  }

  db()
    .prepare("UPDATE stripe_events SET processed_at = ?, result = ? WHERE event_id = ?")
    .run(now(), resultado, event.id);

  return NextResponse.json({ ok: true, eventId: event.id, resultado });
}

async function handle(event: Stripe.Event): Promise<string> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;

      if (session.metadata?.orkKind === "premium") {
        const userId = session.metadata.orkUserId;
        if (userId && findById(userId)) {
          setPlan(userId, "premium");
          return "premium activado";
        }
        return "premium sin usuario";
      }

      const charge = bySession(session.id);
      if (!charge) return "sesión sin cobro asociado";

      // Una sesión completada puede venir sin pagar si el método es asíncrono.
      if (session.payment_status !== "paid") return "sesión completada pero sin pagar";

      const pi =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id;
      return markPaid(charge.id, pi) ? "cobro marcado pagado" : "cobro ya estaba pagado";
    }

    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object as Stripe.Checkout.Session;
      const charge = bySession(session.id);
      if (!charge) return "sesión sin cobro asociado";
      return markPaid(charge.id) ? "cobro marcado pagado" : "cobro ya estaba pagado";
    }

    case "checkout.session.async_payment_failed":
    case "checkout.session.expired": {
      const session = event.data.object as Stripe.Checkout.Session;
      const charge = bySession(session.id);
      if (!charge) return "sesión sin cobro asociado";
      markFailed(charge.id, event.type);
      return "cobro marcado fallido";
    }

    case "invoice.payment_failed": {
      // OJO: esto es el Premium de ORK, no el cobro de un comercio. El dinero
      // de la suscripción del comercio nunca pasa por la cuenta de Stripe de
      // Ork, así que este evento jamás puede hablar de Spotify ni de Netflix.
      // El aviso de un cobro fallido del comercio entra por
      // /api/merchant/payment-failed, que es el único que puede saberlo.
      const inv = event.data.object as Stripe.Invoice;
      const customerId = typeof inv.customer === "string" ? inv.customer : inv.customer?.id;
      if (!customerId) return "factura sin cliente";
      const user = db()
        .prepare<[string], { id: string }>("SELECT id FROM users WHERE stripe_customer_id = ?")
        .get(customerId);
      if (!user) return "factura sin usuario";

      // No se degrada aquí: Stripe reintenta durante días y la persona sigue
      // siendo Premium mientras tanto. El downgrade llega con
      // customer.subscription.deleted, cuando de verdad se acabó.
      track({
        type: "ork_premium.payment_failed",
        userId: user.id,
        severity: "warn",
        payload: { intento: inv.attempt_count, monto: inv.amount_due },
      });
      return "pago de Premium fallido, registrado";
    }

    case "customer.subscription.deleted": {
      // Se canceló Premium: vuelve a Free. No se le quita nada de lo ya hecho.
      const sub = event.data.object as Stripe.Subscription;
      const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
      const user = db()
        .prepare<[string], { id: string }>("SELECT id FROM users WHERE stripe_customer_id = ?")
        .get(customerId);
      if (!user) return "suscripción sin usuario";
      setPlan(user.id, "free");
      return "premium cancelado";
    }

    default:
      return "ignorado";
  }
}
