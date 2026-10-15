# Pendientes — Ork v2

## Bloqueantes de fase

### Verificar precios públicos antes de la Fase 3 — **bloqueante**

El detector de promo de la Fase 3 compara lo que el usuario paga contra el precio
de lista. Si el precio de lista está mal, Ork le va a decir a alguien que tiene
promo cuando no, o al revés — y la decisión de mover la fecha cuelga de ese dato.

Los del seed son **placeholders**, no verificados:

| Servicio | Plan | Seed (MXN) | Verificado |
|---|---|---|---|
| Spotify | individual | 129 | ☐ |
| Spotify | duo | 169 | ☐ |
| Spotify | familiar | 209 | ☐ |
| Netflix | básico | 119 | ☐ |
| Netflix | estándar | 219 | ☐ |
| Netflix | premium | 299 | ☐ |
| YouTube Premium | individual | 139 | ☐ |
| YouTube Premium | familiar | 259 | ☐ |

Contra las páginas oficiales de **México**, no de otro país ni de comparadores.
Al actualizar, corre también `checked_at`: `stalePrices()` avisa a los 90 días y
`/api/health` reporta `precios_sin_verificar`.

Fuente de verdad: `lib/db/index.ts` → constante `PRICES`.

---

## Deuda conocida

### Tipar `lib/agent.ts`, `lib/billing.ts`, `lib/reap.ts`
~25 `any` heredados del buildathon. Hoy están acotados a aviso en
`.eslintrc.json`; en el resto del código la regla es error. Al tiparlos, borrar
ese bloque de overrides.

### Vulnerabilidades de dependencias
12 reportadas por `npm audit` (1 crítica), todas preexistentes y todas en la
cadena de Next 14.2.35 / tailwind / eslint. Ninguna viene de lo que se agregó en
v2. Revisar antes de exponer el piloto a internet.

### `app/page.tsx` sigue siendo la pantalla del buildathon
486 líneas, con el flujo de Reap y las 3 suscripciones físicas. Se fue sola a la
paleta nueva al regenerar la escala violet, pero su contenido es de v1. Decidir
en qué fase se reemplaza por el dashboard de v2.
