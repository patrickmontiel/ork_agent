"use client";

import { useState } from "react";
import type { DayChoice } from "@/components/DayPicker";
import type { Catalogo, Paso, ServicioLigero, UsuarioLigero } from "./types";
import StepEmail from "./steps/StepEmail";
import StepCheckInbox from "./steps/StepCheckInbox";
import StepService from "./steps/StepService";
import StepDay from "./steps/StepDay";
import StepConfirm from "./steps/StepConfirm";
import StepDone from "./steps/StepDone";

// Orquesta los pasos. Un paso por pantalla: en cualquier momento hay una sola
// pregunta en la vista.

const ORDEN: Paso[] = ["correo", "servicio", "dia", "confirmar", "listo"];

export default function PayFlow({
  merchant,
  plan,
  linkError,
  mailMode,
  user,
  catalogo,
}: {
  merchant: string | null;
  plan: string | null;
  linkError: string | null;
  mailMode: "consola" | "resend";
  user: UsuarioLigero | null;
  catalogo: Catalogo;
}) {
  // Si ya hay sesión, el correo sobra.
  const [paso, setPaso] = useState<Paso>(user ? "servicio" : "correo");
  const [correoEnviadoA, setCorreoEnviadoA] = useState<string | null>(null);
  const [devUrl, setDevUrl] = useState<string | null>(null);
  const [servicio, setServicio] = useState<ServicioLigero | null>(null);
  const [dia, setDia] = useState<DayChoice | null>(null);

  const indice = ORDEN.indexOf(paso === "revisa_correo" ? "correo" : paso);
  const total = ORDEN.length - 1; // "listo" no cuenta como paso

  return (
    <div>
      {paso !== "listo" && <Progreso actual={indice} total={total} />}

      {paso === "correo" && (
        <StepEmail
          linkError={linkError}
          onSent={(email, url) => {
            setCorreoEnviadoA(email);
            setDevUrl(url ?? null);
            setPaso("revisa_correo");
          }}
        />
      )}

      {paso === "revisa_correo" && (
        <StepCheckInbox
          email={correoEnviadoA!}
          devUrl={devUrl}
          mailMode={mailMode}
          onBack={() => setPaso("correo")}
        />
      )}

      {paso === "servicio" && (
        <StepService
          catalogo={catalogo}
          seleccionado={servicio}
          onPick={(s) => {
            setServicio(s);
            setPaso("dia");
          }}
        />
      )}

      {paso === "dia" && servicio && (
        <StepDay
          servicio={servicio}
          paydays={user?.paydays ?? []}
          value={dia}
          onChange={setDia}
          onBack={() => setPaso("servicio")}
          onNext={() => setPaso("confirmar")}
        />
      )}

      {paso === "confirmar" && servicio && dia && (
        <StepConfirm
          servicio={servicio}
          dia={dia}
          merchant={merchant}
          plan={plan}
          tarjeta={user?.tarjetas.find((t) => t.isDefault) ?? user?.tarjetas[0] ?? null}
          onBack={() => setPaso("dia")}
          onDone={() => setPaso("listo")}
        />
      )}

      {paso === "listo" && servicio && dia && (
        <StepDone servicio={servicio} dia={dia} />
      )}
    </div>
  );
}

function Progreso({ actual, total }: { actual: number; total: number }) {
  return (
    <div className="mb-7">
      <div className="flex gap-1.5" role="presentation">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors ${
              i <= actual ? "bg-primary" : "bg-white/10"
            }`}
          />
        ))}
      </div>
      <p className="eyebrow mt-2.5">
        Paso {Math.min(actual + 1, total)} de {total}
      </p>
    </div>
  );
}
