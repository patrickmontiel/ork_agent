# Pendientes — Ork v2

## Precios públicos — verificados 2026-10-15 ✅

Catálogo completo cargado y verificado contra páginas oficiales de México el
**2026-10-15**. 31 servicios, 50 precios. Fuente de verdad: `lib/db/seed.ts`.

Quedan tres grupos que el detector de promo **no puede usar**, marcados en la
base para que no se confundan con datos buenos:

**Sin precio verificado** — `needs_verification = 1`, `amount` null:
amazon_prime, xbox_game_pass, duolingo, rappi_pro, meli_plus.
meli_plus tiene promo temporal desde $49.90; el precio base no está verificado.

**El precio de lista ES una promo** — `is_promo = 1`: los tres planes de
Disney+ son promo de 6 meses y el precio base al que vuelven no está verificado.
Comparar contra ellos diría que todo el mundo tiene promo, que es lo mismo que
no decir nada.

**Falta decidir el mecanismo** — `orchestrable = NULL`: microsoft_365, canva,
ps_plus, amazon_prime, xbox_game_pass, duolingo, rappi_pro, meli_plus. Aparecen
en el catálogo pero no se listan como movibles. No se promete nada hasta
decidirlo.

Revisar a los 90 días: `stalePrices()` avisa y `/api/health` lo reporta en
`precios.rancios`, `precios.sin_verificar` y `precios.son_promo`.

---

## Decisiones pendientes

### Apple Music y Apple TV+ están marcados como `cancel_resubscribe`

Viene de la lista que mandaste, y lo respeté. Pero hay una tensión real con la
regla de al lado: *"not_supported: cualquier cobro vía Apple/Google IAP"*.

Una suscripción a Apple Music contratada **desde Apple** se gestiona en los
ajustes de suscripciones de Apple, que es justamente el caso que el propio plan
describe como no editable desde fuera. Cancelar y recontratar ahí no es lo
mismo que hacerlo en spotify.com.

Hoy ninguno de los dos tiene adaptador, así que no hay riesgo inmediato: están
en "próximamente". Pero antes de escribir ese adaptador hay que decidir si de
verdad son orquestables o si caen en el bucket de Apple.

### Mecanismo de los 8 servicios sin decidir

Ver arriba. Cada uno necesita una respuesta: ¿pausa, cancelar y recontratar, o
no soportado?

---

## Abierto de la Fase 4 (cobros)

### Un fee que queda en `fallido` no se reintenta

Si la sesión de Checkout expira o el pago falla, el webhook marca el cobro como
`fallido` y ahí se queda: `/api/stripe/fee-link` solo retoma los `pendiente`.
Hoy eso significa que Ork pierde ese cobro, lo cual es el lado seguro del error,
pero no es la conducta final.

Va con la Fase 5, junto al webhook de `payment_failed` y el mensaje de rescate.

### El fee se cobra con link, no con cargo automático

Ork no guarda la tarjeta ni cobra off-session: devuelve un link de Checkout que
la persona abre. Es deliberado —se ve lo que se paga antes de pagarlo— pero hay
que medir cuántos links terminan pagados antes de dar por buena la economía.
Es una de las métricas de la Fase 5.

---

## Deuda conocida

### Tipar `lib/agent.ts`, `lib/rails/reap-rail.ts`, `lib/reap.ts`
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

### El seed reescribe el catálogo en cada arranque
`seed()` corre un UPSERT en cada apertura de la base. Es lo correcto mientras el
catálogo viva en código, pero si algún día se edita un servicio desde el admin,
el siguiente arranque lo pisa. Decidir entonces quién manda.
