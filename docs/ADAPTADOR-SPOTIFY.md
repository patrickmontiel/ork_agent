# Adaptador real de Spotify (Individual) — diseño para discutir

**Estado: propuesta. No hay código escrito.** 16-oct-2026.

---

## 0. Lo que encontré antes de diseñar nada

Fui a la documentación de Spotify en vez de asumir. Dos hallazgos cambian el
diseño, y uno de ellos contradice algo que ya está implementado.

### 0.1 Spotify documenta este procedimiento él mismo

De [support.spotify.com/us/article/billing-date](https://support.spotify.com/us/article/billing-date/):

> *"You can't change your billing date, but you can: 1. Cancel your plan.
> 2. Wait for your plan to switch to free (at your next billing date).
> 3. Resubscribe on the day you'd like to be charged."*

Esto importa para el riesgo legal: Ork no estaría inventando un truco, estaría
automatizando **el procedimiento que Spotify le indica al usuario**. No elimina
el riesgo de los Términos (automatizar sigue siendo distinto de hacerlo a mano),
pero cambia la conversación.

### 0.2 La opción "adelantar" NO funciona en Spotify

La misma página, la nota al pie:

> *"Your account needs to stay free until the day you want the new billing to
> start. **If you resubscribe before then, it will stay the same.**"*

`computeTradeoff()` ofrece hoy dos opciones:

| Opción | Qué hace | ¿Funciona en Spotify? |
|---|---|---|
| `esperar` | recontratar **después** de que venza | ✅ sí |
| `adelantar` | recontratar **antes** de que venza, pagando los días repetidos | ❌ **no mueve la fecha** |

En `adelantar`, `resubDate` es anterior a `periodEnd` (`occurrenceBefore`). Según
Spotify, reactivar ahí **conserva la fecha original**. Es decir: la persona
aceptaría pagar de más y **no obtendría nada**.

El mock nunca lo detectó porque su `resubscribe()` fija `billingDay = targetDay`
sin mirar la fecha. El mock codifica un modelo falso de Spotify.

**La red sí aguanta:** `verify({billingDay: targetDay})` fallaría, el motor
declararía `incidente` y **no se cobraría el fee**. Pero la persona ya habría
pagado de más a Spotify. Que no cobremos no repara eso.

→ **Decisión 1 (abajo).** Para Spotify, `adelantar` debe desaparecer de la UI.

### 0.3 El regalo escondido: ese mismo mecanismo es el rollback

Si reactivar antes de `periodEnd` conserva la fecha original, entonces
**reactivar antes de `periodEnd` es exactamente "deshacer"**.

```
cancelar ──────────────── periodEnd ──────────── targetDay
         └─ reversible ──┘└─ YA NO HAY VUELTA ATRÁS ─┘
```

La ventana de rollback es precisa y conocida: **hasta `periodEnd`**. Pasada esa
fecha, la fecha de cobro original se perdió para siempre y la persona está fuera
del servicio. No hay "rollback" después. Hay que decirlo antes de cancelar, no
después.

---

## 1. El problema de fondo: el motor asume algo que la realidad no permite

`runOrchestration()` corre así, en una sola pasada:

```
getState → cancel → verify → resubscribe → verify → completado
```

El mock lo cumple porque miente sobre el tiempo. **La realidad no puede:**

1. `resubscribe` tiene que ocurrir **el día objetivo**, días o semanas después.
2. Ruta A significa que no guardamos credenciales → **tiene que haber una
   persona presente** en cada sesión de navegador.
3. Por lo tanto: **dos sesiones asistidas, separadas por el hueco.**

```
Sesión 1 (hoy)          periodEnd           Sesión 2 (día objetivo)
   cancelar      ──→   se vuelve free  ──→      recontratar
   [persona]                                     [persona]
```

Esto no es un detalle de implementación. **El motor, tal como está, no puede
expresar esta operación**, y ningún adaptador de Playwright lo arregla.

### 1.1 Lo que esto le hace a las métricas

- `serviceGap` hoy significa "Ork canceló y no supo devolver el servicio". Entre
  sesión 1 y sesión 2 la persona **está** sin servicio **a propósito y avisada**.
  Eso NO es un incidente.
- Pero si la sesión 2 nunca ocurre —la persona no aparece—, el hueco avisado se
  vuelve **indefinido**. Ese sí es el peor caso del piloto, y hoy nada lo mide.

→ **Decisión 3.**

---

## 2. Diseño propuesto

### 2.1 Fase 0: reconocimiento de solo lectura (primero esto, siempre)

Antes de escribir una línea que mute algo:

- Script de Playwright que **solo lee** la página de cuenta de Spotify.
- Confirma: dónde vive la fecha de renovación, el texto exacto, el plan, si hay
  método de pago guardado, cómo luce el flujo de cancelación **sin completarlo**.
- Produce un reporte con selectores candidatos y capturas.
- **Cero clics que cambien estado.**

Esto es barato, es seguro, y convierte todo lo demás de suposición en hecho.
Ahora mismo ni tú ni yo sabemos con certeza cómo luce esa UI en México en 2026.

### 2.2 El modelo de sesión (Ruta A, estricto)

```
1. Ork lanza Chromium VISIBLE, con perfil temporal nuevo (userDataDir en temp).
2. Ork navega a spotify.com/account y SE DETIENE.
3. La persona escribe su contraseña y resuelve su 2FA. Ork no toca el teclado,
   no lee el campo, no toma capturas durante el login.
4. Ork detecta "ya entró" buscando una señal POSTERIOR al login (la página de
   cuenta renderizada), nunca observando credenciales.
5. Al terminar: context.close() y borrado del perfil temporal.
```

Invariantes que deben ser **código, no promesa**:

- Nunca se llama `context.storageState()`. Nunca se escribe cookie/token a disco.
- El `userDataDir` va a un temporal y se borra en `dispose()`, también si truena.
- Un test que recorra `lib/adapters/` y falle si aparece `storageState`,
  `cookies()`, o escritura de sesión. Barato y defiende la promesa central.

### 2.3 Qué automatiza Ork y qué devuelve a la persona

| Paso | Quién | Por qué |
|---|---|---|
| Navegar, leer plan y fecha | **Ork** | Es lectura. Es donde está el valor real. |
| Login y 2FA | **Persona** | Ruta A. Innegociable. |
| Clics del flujo de cancelación | **a decidir** | Ver Decisión 2 |
| Pantallas de retención ("¿seguro?", ofertas) | **a decidir** | Ídem |
| Cualquier campo de tarjeta | **Persona, siempre** | Ork no toca datos de pago. Nunca. |
| Releer y verificar el resultado | **Ork** | Es lo que convierte "no falló" en "ocurrió". |

### 2.4 Detección de fallos

**Nunca confiar en un clic.** Después de cada mutación: recargar la página de
cuenta y reparsear. Eso ya es el contrato (`verify()`), y aquí se gana su sueldo.

Estrategia de selectores, en orden, y si los tres fallan **se aborta**:

1. `data-testid` estable
2. rol accesible + nombre (`getByRole`)
3. texto visible por regex (ES y EN: la cuenta puede estar en cualquiera)

Si no se puede leer el estado con confianza → `status: "desconocida"` → **no se
toca nada**. El motor ya sabe parar ahí.

**Paradas duras** (→ `accountRestricted: true`, que apaga el piloto entero):

- captcha, "verifica que eres tú", "cuenta deshabilitada"
- redirección inesperada al login a media operación
- cualquier página que no se pueda clasificar después de reintentar la lectura

Timeouts son fallos, no motivo para reintentar indefinidamente.

### 2.5 Rollback

| Momento | ¿Se puede deshacer? | Cómo |
|---|---|---|
| Después de cancelar, **antes de `periodEnd`** | ✅ sí | Reactivar → la fecha original vuelve |
| Después de `periodEnd` | ❌ **no** | La fecha se perdió. Solo queda recontratar y elegir fecha de nuevo |

Consecuencias de diseño:

- El texto de confirmación debe decir la fecha exacta a partir de la cual ya no
  hay marcha atrás.
- Ork debería vigilar la ventana: si se acerca `periodEnd` y la persona no ha
  confirmado que seguirá, **ofrecer deshacer** mientras todavía se puede.
- **Abierto:** reactivar, ¿pide tarjeta otra vez o es un clic con el método
  guardado? La Fase 0 lo contesta. Si pide tarjeta, el rollback también necesita
  a la persona presente, y entonces el "deshacer automático" no existe.

---

## 3. Riesgos

Ordenados por lo que me quitaría el sueño.

1. **La sesión 2 nunca ocurre.** La persona cancela, se distrae, y se queda sin
   Spotify indefinidamente por culpa de Ork. Es el peor caso y hoy no está
   medido ni mitigado.
2. **Irreversibilidad después de `periodEnd`.** No hay deshacer. Si el
   recontrato falla ese día, la persona está fuera y sin su fecha vieja.
3. **Términos de servicio de Spotify.** Automatizar la cuenta de alguien, aunque
   el procedimiento esté documentado, puede chocar con sus Términos. El riesgo
   es la restricción de la cuenta. Mitigado hoy porque el piloto es tu cuenta.
4. **El recontrato pide tarjeta.** Ork no puede completarlo. Si esto es así
   siempre, el "recontrato automático" no existe en Ruta A.
5. **Precio distinto al recontratar.** Vuelve a la lista actual. Si subió, la
   persona paga más para siempre. El detector de promo cubre parte, no todo.
6. **La UI de Spotify cambia** y los selectores se rompen. Por eso `verify()`
   relee en vez de confiar — un selector roto debe dar "desconocida", no un
   falso éxito.
7. **2FA / verificación por dispositivo** en medio de la operación.
8. **Capturas con datos personales.** La evidencia puede incluir correo, nombre,
   últimos 4 de la tarjeta. Hace falta política de redacción antes de guardar.
9. **Planes fuera de alcance:** Duo, Family (hay que reinvitar a los miembros),
   Student, y los contratados por tienda de apps o por telco. Solo Individual
   contratado directo.

---

## 4. Puntos de decisión — necesito tu respuesta antes de programar

### Decisión 1 — `adelantar` en Spotify

La opción que paga días de más **no mueve la fecha**. Opciones:

- **(a)** Quitarla para Spotify (por servicio, con bandera en el catálogo).
- **(b)** Quitarla del producto completo hasta confirmar servicio por servicio.
- **(c)** Dejarla y que `verify()` la atrape — **no lo recomiendo**: la persona
  ya le pagó de más a Spotify aunque Ork no cobre.

*Mi recomendación: (a), y que la Fase 0 lo confirme empíricamente en tu cuenta
antes de escribir el adaptador.*

### Decisión 2 — ¿Ork hace clic, o solo lee y guía?

- **(a) Automatizar los clics.** Es lo que suena a producto, y carga todo el
  riesgo de Términos y de romperse.
- **(b) Ork lee, calcula, avisa el día exacto, abre la página y **verifica**; la
  persona hace los clics irreversibles.** Casi todo el valor (el cálculo, el
  momento, la verificación) con una fracción del riesgo.

*Mi recomendación: (b) para el piloto contigo, con (a) detrás de bandera para
medir si los clics siquiera funcionan de forma estable.* En Ruta A, el clic es
la parte menos valiosa y la más peligrosa.

### Decisión 3 — El motor de dos fases

Hace falta de todos modos. ¿Lo hacemos ahora o después del reconocimiento?

- `orchestrations` necesita un estado intermedio (`esperando_recontrato`) con su
  fecha programada.
- Recordatorios antes de `periodEnd` (todavía se puede deshacer) y el día
  objetivo (hay que actuar).
- Una métrica nueva: **sesiones 2 que nunca ocurrieron**.

*Mi recomendación: el reconocimiento primero (es barato y puede cambiar todo),
el motor de dos fases inmediatamente después.*

### Decisión 4 — Alcance del primer piloto

Tu cuenta, Individual, contratada directo. ¿Confirmas que tu Spotify **no** es
Duo/Family/Student y **no** se paga por App Store/Google Play ni por telco? Si
se paga por tienda de apps, el adaptador no aplica y hay que verlo antes.

---

## 5. Lo que NO voy a hacer sin que lo digas

- Tocar tu cuenta real de Spotify.
- Escribir un adaptador que haga clic en "cancelar".
- Pasar `ADAPTER_MODE=real`.
