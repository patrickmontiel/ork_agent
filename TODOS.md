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

**Falta decidir el mecanismo** — `orchestrable = NULL`: duolingo, rappi_pro y
meli_plus. Aparecen en el catálogo pero no se listan como movibles. No se
promete nada hasta decidirlo.

Decididos el 16-oct-2026: canva y amazon_prime como `cancel_resubscribe`
(amazon_prime solo en su plan mensual contratado directo, no el anual);
microsoft_365, ps_plus y xbox_game_pass como `not_supported`, porque se cobran
por tienda de apps o solo existen como plan largo.

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

### Mecanismo de los 3 servicios que siguen sin decidir

duolingo, rappi_pro y meli_plus. Cada uno necesita una respuesta: ¿pausa,
cancelar y recontratar, o no soportado? Los tres tienen además el precio sin
verificar, así que decidir el mecanismo sin verificar el precio no alcanza.

---

## Abierto de la Fase 4 (cobros)

### El rescate solo puede entrar por el comercio, no por Stripe

`invoice.payment_failed` en la cuenta de Stripe de Ork habla del Premium de
Ork, nunca del cobro de Spotify: el dinero de la suscripción no pasa por aquí,
que es la premisa del producto. Por eso el aviso de un cobro fallido del
comercio entra firmado por `POST /api/merchant/payment-failed`.

Lo que falta: ningún comercio lo está llamando todavía. Hasta que uno lo haga,
el mensaje de rescate existe y está probado, pero no se dispara solo en
producción. Es trabajo de integración, no de código.

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

### Vulnerabilidades de dependencias — de 12 a 7, sin críticas (16-oct-2026)

Next 14 **no tenía versión parcheada**: toda la línea 14.x era vulnerable,
incluidas dos RCE críticas. Se subió a **Next 15.5.28** (React 18 sigue siendo
peer válido, así que no hubo que saltar a React 19) y se agregaron `overrides`
para `postcss` (next fija 8.4.31) y `postcss-selector-parser`.

Quedan 7, todas `high` y **todas del mismo origen**: `braces`, con un DoS por
agotamiento de pila. No tiene versión parcheada publicada — la última, 3.0.3,
sigue en el rango vulnerable. Llega por `micromatch → fast-glob → chokidar`,
que usan el watcher de Tailwind 3 y el escáner de archivos del plugin de ESLint
de Next. Las dos son herramientas de build: el patrón de glob lo pone nuestro
propio repo, no un atacante, así que no es superficie de ataque en runtime.

Para llegar a cero hace falta **Tailwind 4** (cambia a oxide y deja de usar
chokidar/micromatch) y el plugin de ESLint de **Next 16**. Tailwind 4 reescribe
la configuración a CSS-first, o sea tocar `tailwind.config.ts` y `globals.css`
enteros. No se hizo aquí porque era cambiar el sistema de diseño en el mismo
movimiento que el parche de seguridad.

### `app/page.tsx` del buildathon: movido, no borrado (16-oct-2026)
Vive en `/legacy/reap`. Sigue siendo la demo del rail agéntico de Reap y del
rol "puente" con las 3 suscripciones físicas. Borrarlo cuando el rail de Reap
deje de ofrecerse; no evolucionarlo en paralelo a v2.

### El seed reescribe el catálogo en cada arranque
`seed()` corre un UPSERT en cada apertura de la base. Es lo correcto mientras el
catálogo viva en código, pero si algún día se edita un servicio desde el admin,
el siguiente arranque lo pisa. Decidir entonces quién manda.
