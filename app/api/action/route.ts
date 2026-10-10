import { NextResponse } from "next/server";
import { log, publicState, reset, state } from "@/lib/store";
import { adoptEnrollment, decide, registerCard } from "@/lib/billing";
import { runTool } from "@/lib/agent";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Acciones directas de la UI. Los botones pasan por las MISMAS tools del agente.
export async function POST(req: Request) {
  const body = await req.json();
  try {
    switch (body.action) {
      case "run_cycle":
        await runTool("run_billing_cycle", { sub_id: body.subId, reason: "Botón “Ejecutar ciclo ahora”." });
        break;
      case "fail":
        await runTool("simulate_failed_payment", { sub_id: body.subId });
        break;
      case "approve":
      case "reject":
        await decide(body.approvalId, body.action === "approve");
        break;
      case "register_card":
        await registerCard(new URL(req.url).origin);
        break;
      case "adopt_enrollment":
        await adoptEnrollment(String(body.enrollmentId));
        break;
      case "demo_mode":
        state().demoMode = !!body.on;
        log("sistema", body.on ? "MODO DEMO activado" : "Modo real (Reap sandbox)", body.on ? "Respuestas guardadas, marcadas como SIMULADO." : undefined);
        break;
      case "reset":
        reset();
        break;
      default:
        return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("error", "Acción falló", msg);
    return NextResponse.json({ error: msg, state: publicState() }, { status: 500 });
  }
  return NextResponse.json(publicState());
}
