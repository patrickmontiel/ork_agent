# Ork Agent: agentes que mueven tus fechas de cobro

> **Pagas suscripciones que quieres. No se cobran el día que quieres.**
> Ork es infraestructura de orquestación de fechas de cobro para LatAm. En este MVP, un **agente de IA** mueve las fechas y ejecuta cada ciclo de cobro con **Reap Agentic Payments**, siempre con tu aprobación.

Reap x AIBM Agentic Buildathon · Track: *Most Worthwhile Problem (Best Use of Latest Technology)*

## El problema

- Entre el 5 % y el 14 % de los cobros recurrentes fallan al primer intento, y del 20 % al 40 % del churn es **involuntario**.
- La causa número uno son los **fondos insuficientes** (44-47 % de los declines): el cobro cae *antes de la quincena*.
- Hoy, para cambiar la fecha de cobro hay que cancelar y volver a suscribirse.

## La solución

Le dices al agente en lenguaje natural cuándo te pagan y él:

1. **Propone** el día seguro para cada suscripción (el día después de tu quincena o de tu corte de tarjeta).
2. Valida las reglas de negocio en código: **la fecha solo se mueve hacia adelante**, calcula los días de hueco y la prorrata (por defecto la absorbe el merchant).
3. **Confirma** el cambio sin cancelar nada.
4. **Ejecuta el ciclo de cobro con Reap**: cotiza en el merchant real del sandbox y te muestra una **tarjeta de aprobación** con producto, envío, impuestos y total.
5. Solo si **tú apruebas** hace el checkout. El agente nunca ve datos de tarjeta.
6. Si un pago falla y el dunning se agota (estado C), hace un **rescate hacia adelante**: reinicia la suscripción en una fecha en la que sí puedes pagar y **condona los días bloqueados** (solo merchants de corte duro).

Arriba, el indicador muestra **cuántos cobros caen antes de quincena sin Ork y con Ork** (en la demo pasa de 3/3 a 0/3).

## Cómo usamos Reap Agentic Payments

Todo pasa por `lib/reap.ts`, que solo corre en el servidor (`import "server-only"`):

| Paso | Endpoint | Quién lo dispara |
|---|---|---|
| Registrar tarjeta | `POST /agentic/enrollments` (source `EXTERNAL`, REDIRECT) | Usuario (botón). La tarjeta se captura en la página alojada de Reap; Ork y el agente nunca la ven |
| Esperar tarjeta lista | `GET /agentic/enrollments/{id}` (polling hasta `ACTIVE`) | App |
| Cotizar el ciclo | `POST /agentic/quotes` (variant real del merchant y dirección de envío) | **Agente**, tool `run_billing_cycle` |
| Cobrar | `POST /agentic/checkouts` + `X-Simulate-Checkout: COMPLETED` | **Usuario** al aprobar la tarjeta |
| Confirmar | `GET /agentic/checkouts/{id}` (polling hasta `COMPLETED`) | App |

- `Idempotency-Key` es un UUID **nuevo por intento**, porque reusarlo devolvería la respuesta cacheada.
- Reintentos con backoff ante 503/502/429 y `AGENTIC_REQUEST_REJECTED`; la cotización tiene un timeout de 75 s porque coffeeam tarda hasta 40 s.
- Si la cotización caduca (~5 min), se bloquea la aprobación y se pide un ciclo nuevo.

**Autoridad de pago y controles de gasto, en código (no en el prompt):**
- El agente puede *cotizar*, pero no puede *cobrar*: el checkout solo sale del botón **Aprobar**.
- Límite por cobro ($30) y tope mensual ($80): si una cotización los supera, la aprobación queda **bloqueada** y el LLM no los puede cambiar.
- Toda decisión del agente y toda llamada a Reap queda en el **registro** visible.

### Merchants del sandbox (US, USD)

| Suscripción | Merchant | Producto | Tipo |
|---|---|---|---|
| ☕ Club de café | coffeeam.com | Freedom Blend Coffee 0.5LB | corte duro |
| 🍯 Caja de snacks | exoticsnacks.com | Lay's Mini Potato Bites Honey Butter | con gracia |
| 🧴 Limpieza del hogar | packagefreeshop.com | Multi-Purpose Cleaning Spray | corte duro |

El catálogo del sandbox no tiene suscripciones reales, así que cada "suscripción" es un pedido recurrente a un merchant real del sandbox.

## El agente

`lib/agent.ts` define 6 tools: `list_subscriptions`, `propose_date_change`, `confirm_date_change`, `run_billing_cycle`, `simulate_failed_payment` y `rescue_forward`.

- Con `ANTHROPIC_API_KEY` usa Claude con tool use; con `OPENAI_API_KEY`, OpenAI function calling.
- Sin llave, un **motor determinístico por reglas** llama exactamente las mismas tools (es el fallback para la demo).
- La lógica de fechas (`lib/orchestrator.ts`) es pura y tiene tests: `npm test`.

## Correr

```bash
npm install
# .env (NO se sube a git):
# REAP_API_KEY=...  REAP_BASE_URL=https://sg.sandbox.api.reap.global  REAP_VERSION=2025-02-14
# opcional: ANTHROPIC_API_KEY=... o OPENAI_API_KEY=...
npm run dev
npm test
```

**Modo demo:** el botón de arriba cambia a respuestas guardadas, marcadas como **SIMULADO**, por si el sandbox falla en vivo.

## Guion del demo (≈2 min)

1. **Problema** (15 s): "Mis tres suscripciones caen antes de quincena: 3/3 en rojo."
2. **Chat**: "Mi quincena cae el 15 y el 30". El agente propone 16, 16 y 1 (solo hacia adelante, hueco absorbido por el merchant). Respondes "sí" y el indicador pasa a **0/3**.
3. **Cobro con Reap**: "Cobra el café ahora". El registro muestra `POST /agentic/quotes` y aparece la tarjeta de aprobación con envío, impuestos y total reales.
4. **Aprobar**: `POST /agentic/checkouts` devuelve COMPLETED, con número de orden; el siguiente cobro avanza un ciclo.
5. **Control de gasto**: ejecuta varios ciclos hasta chocar con el tope mensual y la aprobación queda bloqueada.
6. **Rescate**: "Simular pago fallido" en limpieza y luego "rescata limpieza después de mi quincena". El agente la reinicia el día 1 o 16, condona los días bloqueados y pide aprobación para reintentar.
7. **Cierre**: "El agente no es un chatbot de compras: es el que decide *cuándo* cobrar para que el cobro pase, y nunca cobra sin ti."
