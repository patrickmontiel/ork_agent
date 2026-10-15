# Ork v2 — Plan de archivos

Estado: **esperando OK**. Nada implementado todavía.
Base: repo `ork-agent` en `main`, limpio, 9 commits, 7 tests pasando.

---

## Lo que se conserva intacto

| Archivo | Qué vive ahí | Destino en v2 |
|---|---|---|
| `lib/orchestrator.ts` | `nextOccurrence`, `clampDate`, `addOneCycle`, `daysBetween`, regla "solo hacia adelante", `isSafeDay`, `rescueForward` | **Se conserva.** Se corrigen dos bugs (abajo) y se le agrega prorrateo exacto |
| `tests/orchestrator.test.ts` | 7 tests de fechas | **Se conservan los 7.** Se agregan ~14 más |
| `lib/billing.ts` | Límites por cobro y tope mensual, aprobación humana, máquina de estados de `Approval` | **Se conserva la lógica**, se renombra a `lib/rails/reap-rail.ts` |
| `lib/reap.ts` | Cliente de la API de Reap | **Se conserva**, pasa a ser rail opcional |
| `lib/agent.ts` | Chat que entiende quincena, nómina y fecha de corte | **Se conserva**, se le agregan herramientas nuevas |

## Los dos bugs que hay que arreglar primero

**`proposeDateChange` prorratea entre 30 fijo.**
```ts
const proratedAmount = round2((sub.monthlyAmount * gapDays) / 30);
```
Tu requisito es que el trade-off se muestre en números exactos. Con divisor fijo, un hueco de
10 días en febrero se cotiza igual que en marzo, y no lo es. Se cambia a prorrateo sobre los
días reales del ciclo que se está pagando.

**`bestDayAfterPayday` no hace lo que dice su comentario.**
```ts
/** Mejor día seguro: ... hacia adelante desde `fromDay`. */
export function bestDayAfterPayday(paydays: number[]): number  // ← no recibe fromDay
```
Siempre devuelve `min(paydays) + 1`. Con `[15, 30]` da 16 y nunca 1, aunque el usuario esté
a día 20. Se agrega el parámetro y se elige la quincena más próxima hacia adelante.

---

## Decisiones de arquitectura

**Persistencia: SQLite con `better-sqlite3`.** Hoy el estado vive en `globalThis` y muere al
reiniciar. V2 necesita mandatos inmutables con sello de tiempo, eventos de piloto
consultables, usuarios con magic link y registros de Stripe. Nada de eso sobrevive en
memoria. SQLite es un archivo, cero infraestructura, y las métricas del piloto se consultan
con SQL en vez de a mano.

> Riesgo único: `better-sqlite3` compila nativo en Windows. Si truena al instalar, el plan B
> es JSONL append-only por tabla — más que suficiente para 20 usuarios de piloto, y de hecho
> encaja mejor con "mandato inmutable". Lo verifico antes de escribir código.

**Magic link sin dependencias.** Token HMAC con `node:crypto`, expira en 15 minutos, un solo
uso. No hace falta `jose` ni NextAuth para esto.

**Playwright headed y efímero.** `chromium.launchPersistentContext` en un directorio temporal
que se borra al terminar. La sesión de Spotify nunca toca disco permanente.

**Branding como tokens.** Nada de colores sueltos: `tailwind.config.ts` + `globals.css`
definen la paleta y todo lo demás la consume.

---

## Fase 0 — Cimientos (branding, persistencia, entorno)

Sin esto las otras cuatro fases se construyen torcidas.

| Archivo | Acción | Contenido |
|---|---|---|
| `tailwind.config.ts` | modificar | Tokens de color de la identidad, `fontFamily` Space Grotesk / Inter, radios de card |
| `app/globals.css` | modificar | Variables CSS de la paleta, tipografías, botón primario morado, foco accesible, `prefers-reduced-motion` (ya está) |
| `app/layout.tsx` | modificar | Carga de Space Grotesk + Inter desde `next/font`, metadata, `lang="es-MX"` |
| `components/brand/Logo.tsx` | crear | Wordmark `ork` minúsculas + punto morado arriba a la derecha de la "k". Variantes: full, icon, mono |
| `lib/db/schema.sql` | crear | `users`, `cards`, `services`, `user_services`, `mandates`, `orchestrations`, `events`, `public_prices` |
| `lib/db/index.ts` | crear | Conexión, migración al arrancar, helpers tipados |
| `lib/db/repo/*.ts` | crear | Un repositorio por tabla. Nada de SQL suelto en rutas |
| `.env.example` | crear | Todas las variables, con comentarios y valores placeholder |
| `.gitignore` | modificar | `.env`, `*.db`, `*.db-journal`, `.playwright/` |

**Cómo probarlo:** `npm run dev`, la home se ve en paleta nueva con el logo correcto; `npm test` sigue en verde; el archivo `.db` aparece y `sqlite3 ork.db ".tables"` lista las 8 tablas.

---

## Fase 1 — Botón/link "Pagar con Ork" + magic link

| Archivo | Acción | Contenido |
|---|---|---|
| `app/pay/page.tsx` | crear | Página pública `/pay?merchant=...&plan=...`. Un paso por pantalla |
| `app/pay/steps/*.tsx` | crear | `StepEmail`, `StepService`, `StepDay`, `StepConfirm`, `StepDone` |
| `app/api/auth/magic/route.ts` | crear | `POST` genera token, `GET` lo canjea y abre sesión |
| `lib/auth/magic-link.ts` | crear | Firma y verificación HMAC, un solo uso, 15 min |
| `lib/auth/session.ts` | crear | Cookie `httpOnly`, `sameSite=lax`, `secure` en prod |
| `app/api/users/me/route.ts` | crear | Usuario + tarjetas + servicios conectados |
| `public/ork.js` | crear | Snippet embebible. `<5 KB`, Shadow DOM, sin dependencias |
| `app/embed/button/route.ts` | crear | Sirve `ork.js` con CORS y cabeceras de caché |
| `components/DayPicker.tsx` | crear | **Tres opciones primero** (quincena / mensual / otra fecha), grid 1-28 detrás de "otra fecha". Targets de 44 px |
| `lib/mailer.ts` | crear | Envío del magic link. En dev imprime la URL en consola |

**Decisión de UX que tomo y señalo:** el selector no abre con un grid de 31 celdas. Abre con
*"¿cuándo te cae tu dinero?"* y tres opciones. En 360 px un grid de 7 columnas deja celdas de
~40 px, por debajo del mínimo accesible de 44 que tú mismo pides. El grid sobrevive como
escotilla.

**Cómo probarlo:** abrir `/pay?merchant=demo&plan=basico`, meter correo, copiar el link de la
consola, canjearlo, elegir servicio y día, ver la confirmación. Y un `demo-merchant.html` que
carga `ork.js` para ver el botón embebido.

---

## Fase 2 — Mandato por servicio

| Archivo | Acción | Contenido |
|---|---|---|
| `lib/mandate/types.ts` | crear | `Mandate { id, userId, service, actionType, textVersion, textHash, timestamp, ip, userAgent, revokedAt }` |
| `lib/mandate/texts.ts` | crear | Textos versionados. `spotify.v1` es el que mandaste, literal |
| `lib/db/repo/mandates.ts` | crear | **Append-only.** Sin `UPDATE` salvo `revokedAt`. Hash del texto guardado con el mandato |
| `app/mandate/[service]/page.tsx` | crear | Pantalla de consentimiento. Botón deshabilitado hasta scroll al final |
| `app/api/mandate/route.ts` | crear | `POST` crea, `DELETE` revoca. Captura IP y user-agent |
| `app/cuenta/mandatos/page.tsx` | crear | Mandatos vigentes y revocados, con fecha y texto exacto que se firmó |
| `lib/mandate/guard.ts` | crear | `requireMandate(userId, service, actionType)`. Toda acción sobre servicio cerrado pasa por aquí |

**Cómo probarlo:** firmar el mandato de Spotify, ver el registro en `/cuenta/mandatos`,
revocarlo, y comprobar que `requireMandate` bloquea con mandato revocado.

---

## Fase 3 — Piloto Spotify (mock primero, real después)

La fase más delicada. Se construye contra el mock y solo al final se enchufa el navegador.

| Archivo | Acción | Contenido |
|---|---|---|
| `lib/adapters/types.ts` | crear | `interface ClosedServiceAdapter { getState, cancel, resubscribe, verify }` + `ServiceState` |
| `lib/adapters/mock-spotify.ts` | crear | Determinista. Escenarios: con promo, sin promo, cancelación falla, recontrato falla, cuenta restringida |
| `lib/adapters/spotify.ts` | crear | Playwright headed, contexto efímero, selectores en un solo bloque para repararlos rápido |
| `lib/adapters/netflix.ts` | crear | Vía **pausa de 1 mes**, no cancelar. Detecta plan Básico y pago por terceros → no aplicable |
| `lib/adapters/registry.ts` | crear | `getAdapter(service)`. `ADAPTER_MODE=mock\|real` |
| `lib/pilot/tradeoff.ts` | crear | **El corazón.** Calcula las dos opciones con números exactos: (a) días sin servicio, (b) días pagados de más |
| `lib/pilot/promo.ts` | crear | Precio pagado vs `public_prices`. Si pagado < público → promo, y se pierde al recontratar |
| `lib/pilot/run.ts` | crear | Máquina de estados: `registrado → cancelado → verificado → recontratado → verificado → notificado`, con rollback y `RETRY_MAX` |
| `app/orquestar/[service]/page.tsx` | crear | Pantalla de confirmación con el trade-off. Botones: Confirmar / No mover / Otra fecha |
| `app/api/orchestrate/route.ts` | crear | Arranca la corrida. Exige mandato vigente **y** confirmación del evento |
| `tests/tradeoff.test.ts` | crear | Trade-off en meses de 28/30/31, con y sin promo |
| `tests/pilot-run.test.ts` | crear | Rollback: falla cancelación → nada cambia. Falla recontrato → N reintentos → incidente |

**Regla que codifico:** el silencio no es consentimiento. Sin clic explícito en Confirmar, la
corrida expira a los 15 minutos y no se ejecuta nada.

**Cómo probarlo:** `ADAPTER_MODE=mock npm test`, y recorrer los 5 escenarios del mock desde la
UI. El adaptador real queda detrás de la bandera, apagado.

---

## Fase 4 — Cobro al usuario con Stripe (modo test)

| Archivo | Acción | Contenido |
|---|---|---|
| `lib/stripe/client.ts` | crear | Cliente, sin pin de versión de API |
| `lib/stripe/checkout.ts` | crear | Sesión de pago único (fee) y de suscripción (Premium) |
| `app/api/stripe/webhook/route.ts` | crear | Firma verificada, **idempotente por `event.id`** |
| `app/api/stripe/checkout/route.ts` | crear | Crea la sesión según plan |
| `lib/billing/fee.ts` | crear | El fee se cobra **solo tras orquestación exitosa**. `ORK_FEE_MXN`, `ORK_PREMIUM_MXN` |
| `app/precios/page.tsx` | crear | Free con fee por evento vs Premium ilimitado |
| `lib/rails/index.ts` | crear | `PAYMENT_RAIL=user_card\|reap`, default `user_card` |
| `lib/rails/reap-rail.ts` | mover | `lib/billing.ts` actual, intacto, detrás del rail |

**Cómo probarlo:** tarjeta `4242…` en modo test, completar una orquestación con el mock y
verificar que el fee se cobra después del éxito y no antes. Webhook con `stripe listen`.

---

## Fase 5 — Métricas del piloto

| Archivo | Acción | Contenido |
|---|---|---|
| `lib/pilot/events.ts` | crear | `track(type, payload)`. Append-only |
| `app/admin/pilot/page.tsx` | crear | Tablero con las 5 métricas |
| `app/api/admin/pilot/route.ts` | crear | Agregados. Protegido por `ADMIN_TOKEN` |
| `app/api/survey/route.ts` | crear | Encuesta de una pregunta post-evento |
| `components/SurveyPrompt.tsx` | crear | Aparece tras la notificación de éxito |

Métricas, con sus metas:

```
  % éxito técnico .................. meta ≥85%
  incidentes sin servicio .......... ≤1 de cada 20
  cuentas restringidas ............. 0
  % comprensión (encuesta) ......... meta ≥90%
  cancelaciones por desventaja ..... se cuenta, sin meta
```

**Cambio que propongo sobre tu especificación:** pediste banner rojo si aparece 1 cuenta
restringida. Propongo que además **apague el adaptador real automáticamente** y deje todo en
mock hasta que tú lo reactives a mano. Un banner lo ve quien entra al admin; el daño le pasa
al siguiente usuario en la cola. Si prefieres solo el banner, lo dejo así.

---

## Variables de entorno

```
# Núcleo
ORK_SECRET=                 # HMAC de magic links y sesiones
DATABASE_PATH=./ork.db
NEXT_PUBLIC_BASE_URL=http://localhost:3001

# Agente
ANTHROPIC_API_KEY=
OPENAI_API_KEY=

# Adaptadores de servicios cerrados
ADAPTER_MODE=mock           # mock | real
RETRY_MAX=3
PLAYWRIGHT_HEADED=true

# Stripe (modo test)
STRIPE_SECRET_KEY=sk_test_
STRIPE_WEBHOOK_SECRET=whsec_
ORK_FEE_MXN=25
ORK_PREMIUM_MXN=99

# Rails
PAYMENT_RAIL=user_card      # user_card | reap
REAP_API_KEY=

# Admin
ADMIN_TOKEN=
```

---

## Lo que NO voy a hacer sin que lo digas

- Tocar el adaptador real de Spotify contra tu cuenta. Fase 3 se entrega en mock.
- Borrar `lib/reap.ts` ni la lógica de límites.
- Cobrar de verdad: Stripe queda en modo test.
- Publicar nada fuera de localhost.

---

## Tres decisiones que necesito de ti

1. **Color.** El prompt dice `Electric Violet #3427B4`; la identidad dice `#A959FF`. ¿Cuál manda?
2. **Las 3 suscripciones demo** (café, snacks, limpieza vía Reap): ¿las quito y dejo solo
   Netflix/Spotify/YouTube, o las conservo como ejemplos del rol "puente"?
3. **Cuenta restringida:** ¿banner solamente, o banner + apagado automático del adaptador real?
