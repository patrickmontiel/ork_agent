> # ⚠️ BORRADOR — NO PUBLICAR
>
> Este documento **no ha sido revisado por un abogado**. Lo redactó Claude, que
> no es abogado y no está dando asesoría legal.
>
> Las cláusulas de **limitación de responsabilidad** (§10) son justamente donde
> un borrador sin revisar es más peligroso: en México hay límites a lo que se
> puede excluir frente a un consumidor, y la LFPC puede considerar abusivas
> ciertas renuncias. **No publicar sin revisión profesional.**
>
> **§4 contiene un riesgo de negocio, no de redacción**, que hay que decidir
> antes que nada. Está marcado.
>
> Redactado: 16-oct-2026.

---

# Términos del Servicio — Ork (piloto cerrado)

**Vigencia:** `[PENDIENTE]` · **Versión:** borrador 1, sin revisión legal

## 1. Qué es Ork

Ork mueve el **día del mes en que te cobran** tus suscripciones, para que caiga
después de que recibes tu dinero y no antes.

**Esto es un piloto cerrado**, por invitación. No es un producto terminado.
Puede fallar, puede cambiar y puede terminarse en cualquier momento.

## 2. Qué hace Ork, en concreto

Para cambiar tu fecha de cobro, Ork:

1. Lee el estado actual de tu suscripción (plan, monto, fecha).
2. Calcula el costo real de moverla y **te lo muestra en números antes de tocar
   nada**.
3. Si lo confirmas, cancela tu suscripción.
4. El día que elegiste, vuelve a contratarla. **Ese día se convierte en tu nueva
   fecha de cobro.**
5. Verifica con el servicio que el cambio ocurrió de verdad.

Este es el procedimiento que el propio servicio indica para cambiar la fecha de
cobro. Ork lo organiza, lo hace en el momento correcto y lo verifica.

## 3. Lo que Ork NO hace

- **Ork no cobra tus suscripciones.** Le sigues pagando a Spotify, a Netflix o a
  quien sea, directamente. **Tu dinero nunca pasa por Ork.**
- **Ork no guarda tu contraseña** de esos servicios. La escribes tú, en la
  página del servicio, en una ventana que ves.
- **Ork no guarda tokens ni cookies** de esos servicios. La sesión se descarta
  al terminar.
- **Ork no guarda tu tarjeta.** Los cobros de Ork los procesa Stripe.
- **Ork no te presta dinero, no difiere pagos y no es una institución
  financiera.** No estamos regulados como tal porque no lo somos.
- **Ork no da asesoría financiera.**

## 4. Lo que tienes que entender antes de usarlo

Esta sección es la más importante. Si algo aquí no te parece, no uses Ork.

### 4.1 Cambiar la fecha **cuesta** algo, y tú eliges qué

Para que tu fecha se mueva, tu cuenta tiene que quedar sin el servicio hasta el
día que elegiste. Eso significa **días reales sin servicio**, y Ork te dice
cuántos y qué día vuelve, antes de que confirmes.

### 4.2 Hay un punto sin retorno

Mientras no termine el periodo que ya pagaste, se puede deshacer: reactivar la
suscripción restaura tu fecha original.

**Después de esa fecha, no.** Tu fecha de cobro anterior se pierde de forma
definitiva. Ork te muestra esa fecha límite antes de que confirmes.

### 4.3 Tienes que estar presente dos veces

Como Ork nunca guarda tu contraseña, necesitas iniciar sesión tú: una vez para
cancelar y **otra vez el día del recontrato**.

> **Si no completas el segundo paso, tu suscripción no se reactiva y te quedas
> sin el servicio.** Ork te lo va a recordar, pero no puede hacerlo por ti.

### 4.4 El precio puede cambiar

Al volver a contratar, se aplica el **precio de lista vigente** del servicio. Si
subió, pagarás el nuevo precio. Si tenías una **promoción o descuento, es muy
probable que lo pierdas**: Ork intenta detectarlo y avisarte, pero no puede
garantizar que lo detecte siempre.

### 4.5 `[DECISIÓN DE NEGOCIO PENDIENTE — no es redacción]`

> Los Términos de Servicio de Spotify, Netflix y otros servicios **pueden
> prohibir el acceso automatizado a tu cuenta**, aunque el procedimiento de
> cambiar la fecha sea el que ellos mismos documentan.
>
> El riesgo de que un servicio **restrinja o suspenda tu cuenta** existe y no es
> de cero.
>
> **Hay que decidir, con el abogado, dos cosas:**
> 1. Si el piloto se lanza asumiendo ese riesgo, y cómo se divulga de forma que
>    el consentimiento sea informado de verdad.
> 2. Si Ork hace los clics o si los hace la persona (ver
>    `docs/ADAPTADOR-SPOTIFY.md`, Decisión 2). **No es lo mismo legalmente.**
>
> Esta cláusula no se puede redactar hasta tomar esa decisión.

## 5. El permiso (mandato)

Antes de tocar cualquier servicio, firmas un **permiso específico para ese
servicio**: qué puede hacer Ork, sobre qué cuenta y con qué límites.

- El permiso **se firma una vez**; la ejecución **se confirma cada vez**.
- El texto del permiso es **inmutable**: queda guardado exactamente como lo
  leíste y aceptaste.
- **Puedes revocarlo cuando quieras**, sin explicar por qué, desde tu cuenta.
- **El silencio no es consentimiento.** Si no confirmas dentro del plazo que se
  te muestra, la operación expira y **no se ejecuta nada**.

Revocar el permiso detiene operaciones futuras. **No deshace lo ya ejecutado**
(ver §4.2).

## 6. Cuánto cuesta Ork

| Plan | Precio |
|---|---|
| Free | `[PENDIENTE: $25 MXN]` por cambio de fecha completado |
| Premium | `[PENDIENTE: $99 MXN]` al mes, cambios ilimitados |

**La regla que gobierna el cobro: si el cambio no se completó, Ork no cobra.**

No se cobra por intentarlo, no se cobra si falla, y no se cobra si no pudimos
verificar con el servicio que la fecha quedó movida. Que el servicio responda
"listo" no cuenta como completado: tiene que verificarse.

**Lo que Ork cobra no tiene nada que ver con lo que pagas por tu suscripción.**
Son cobros distintos, de quien corresponde.

> `[PENDIENTE]` Definir política de reembolso. En México, la LFPC da derechos al
> consumidor que conviene reflejar explícitamente.

## 7. Qué necesitas para usar Ork

- Ser mayor de edad y tener capacidad legal para contratar.
- Que la cuenta del servicio **sea tuya** y que tengas derecho a administrarla.
- Darnos información veraz.

**No uses Ork sobre la cuenta de otra persona**, aunque tengas su contraseña.

## 8. Alcance del piloto

- Solo los servicios que aparezcan marcados como disponibles.
- **Sin garantía de disponibilidad, sin SLA y sin soporte 24/7.**
- Podemos suspender el piloto en cualquier momento. Si eso pasa, te avisamos y
  no se te cobra nada pendiente.

## 9. Interrupción por seguridad

Si detectamos que un servicio restringió una cuenta, **Ork se apaga solo** y
deja de operar sobre cuentas reales hasta que una persona revise qué pasó. Es a
propósito: preferimos detenernos a seguir.

## 10. Responsabilidad

> `[PENDIENTE — REVISIÓN LEGAL PRIORITARIA]`
>
> Aquí va la cláusula de limitación de responsabilidad. **No la redacto sin
> abogado**, porque frente a un consumidor en México hay límites reales a lo que
> puede excluirse y una cláusula mal escrita puede ser nula, además de injusta.
>
> Lo que el abogado necesita saber para redactarla:
>
> - Ork ejecuta una acción **irreversible** (§4.2) sobre un servicio de un
>   tercero, **con autorización expresa** de la persona (§5).
> - El daño realista: días sin servicio, pérdida de una promoción, pago de un
>   precio mayor, y en el peor caso **restricción de la cuenta** por el tercero.
> - Ork **sí** verifica antes de declarar éxito y **no cobra** si no se
>   completó. Eso acota el daño económico directo causado por Ork, no el
>   indirecto.

## 11. Terminación

Puedes dejar de usar Ork cuando quieras y pedir la baja de tu cuenta conforme al
Aviso de Privacidad. Los registros de permisos y de cambios ejecutados se
conservan por las razones explicadas ahí.

## 12. Ley aplicable

Estos términos se rigen por las leyes de los Estados Unidos Mexicanos.

> `[PENDIENTE]` Jurisdicción. Ojo: frente a consumidores, la competencia de la
> PROFECO y los derechos de la LFPC no se pueden renunciar por contrato.

## 13. Contacto

`[PENDIENTE: correo de soporte]`

---

**Versión:** borrador 1 — sin revisión legal
**No publicar sin resolver todos los `[PENDIENTE]` y sin revisión profesional.**
