import "server-only";
import type { ClosedServiceAdapter } from "./types";
import { MockSpotifyAdapter, type MockScenario } from "./mock-spotify";
import { MockNetflixAdapter, type NetflixScenario } from "./mock-netflix";
import { adaptersLive, status as pilotStatus } from "@/lib/db/repo/pilot";

// Quién construye los adaptadores.
//
// La única puerta por la que se instancia un adaptador real, y por eso aquí
// vive la regla de seguridad del piloto: hacen falta TRES condiciones a la vez.
//
//   1. ADAPTER_MODE=real en el entorno
//   2. el interruptor de la base encendido
//   3. que nadie lo haya apagado por incidente
//
// Si falta alguna, se devuelve el mock. Nunca se lanza una excepción por esto:
// degradar a mock es seguro, y fallar duro tentaría a alguien a saltarse la
// comprobación "solo para probar".

export type AdapterMode = "mock" | "real";

export interface AdapterRequest {
  serviceId: string;
  /** Escenario del mock. Se ignora en modo real. */
  scenario?: MockScenario | NetflixScenario;
}

export interface AdapterResolution {
  adapter: ClosedServiceAdapter;
  mode: AdapterMode;
  /** Por qué se degradó a mock, si se degradó. */
  degradedBecause: string | null;
}

export function getAdapter(req: AdapterRequest): AdapterResolution {
  const live = adaptersLive();
  const degradedBecause = live ? null : pilotStatus().blockedBy;

  if (live) {
    // Aquí irían los adaptadores reales con Playwright. Todavía no existen:
    // la Fase 3 se entrega contra el mock a propósito. Mientras tanto, incluso
    // con el interruptor encendido se devuelve el mock — es la respuesta
    // honesta, no un adaptador a medias tocando cuentas de verdad.
    return {
      adapter: buildMock(req),
      mode: "mock",
      degradedBecause: "El adaptador real todavía no está escrito.",
    };
  }

  return { adapter: buildMock(req), mode: "mock", degradedBecause };
}

function buildMock(req: AdapterRequest): ClosedServiceAdapter {
  switch (req.serviceId) {
    case "spotify":
      return new MockSpotifyAdapter({ scenario: (req.scenario as MockScenario) ?? "feliz" });
    case "netflix":
      return new MockNetflixAdapter({ scenario: (req.scenario as NetflixScenario) ?? "feliz" });
    default:
      throw new Error(
        `No hay adaptador para "${req.serviceId}". Solo Spotify y Netflix tienen uno en el piloto.`,
      );
  }
}

/** ¿Este servicio tiene adaptador, aunque sea mock? */
export function hasAdapter(serviceId: string): boolean {
  return serviceId === "spotify" || serviceId === "netflix";
}

export function retryMax(): number {
  const n = Number(process.env.RETRY_MAX);
  return Number.isInteger(n) && n >= 0 ? n : 3;
}
