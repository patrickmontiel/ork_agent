import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/session";
import { paydays } from "@/lib/db/repo/users";
import { listCards } from "@/lib/db/repo/cards";
import { listUserServices } from "@/lib/db/repo/user-services";
import { listClosed, listBridge, listBlocked } from "@/lib/db/repo/services";

export const dynamic = "force-dynamic";

// Quién es el usuario, qué tarjetas tiene y qué servicios conectó.
// Es lo que el paso 2 de /pay necesita para reconocerlo y no volver a
// preguntarle nada que ya sabemos.

export async function GET() {
  const user = await currentUser();

  if (!user) {
    // Sin sesión también devolvemos el catálogo: la página lo necesita para
    // pintar las opciones antes de que la persona se identifique.
    return NextResponse.json({
      autenticado: false,
      catalogo: catalogo(),
    });
  }

  return NextResponse.json({
    autenticado: true,
    usuario: {
      id: user.id,
      email: user.email,
      plan: user.plan,
      paydayKind: user.payday_kind,
      paydays: paydays(user),
    },
    tarjetas: listCards(user.id),
    servicios: listUserServices(user.id).map((s) => ({
      id: s.id,
      serviceId: s.service_id,
      nombre: s.service.name,
      emoji: s.service.emoji,
      rol: s.service.role,
      plan: s.plan,
      montoPagado: s.paid_amount,
      diaActual: s.billing_day,
      diaDeseado: s.desired_day,
      proximoCobro: s.next_charge,
      estado: s.status,
    })),
    catalogo: catalogo(),
  });
}

function catalogo() {
  const map = (s: ReturnType<typeof listClosed>[number]) => ({
    id: s.id,
    nombre: s.name,
    emoji: s.emoji,
    rol: s.role,
    mecanismo: s.mechanism,
    motivoBloqueo: s.blocked_reason,
  });
  return {
    // Protagonistas: Ork los mueve cancelando y recontratando, con mandato.
    cerrados: listClosed().map(map),
    // Puente: el comercio tiene API. Ork no cancela nada, no hace falta mandato.
    puente: listBridge().map(map),
    // No editables: se muestran con su motivo, nunca se prometen.
    bloqueados: listBlocked().map(map),
  };
}
