# Seguridad — Ork

## Vulnerabilidades conocidas y aceptadas

Estado al **16 de octubre de 2026**. Revisar antes de exponer el piloto a
internet, y de nuevo al terminarlo.

```
npm audit → 7 high, 0 critical, 0 moderate, 0 low
```

### Resumen

Las 7 vienen de **un solo origen**: `braces`, con un DoS por agotamiento de
pila ([GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm),
CVSS 7.5, CWE-674). Las otras seis entradas del reporte son la misma falla
contada a través de quien depende de ella.

**No tiene versión parcheada publicada.** El rango vulnerable es `<=3.0.3` y
3.0.3 es la última versión que existe. No hay a dónde actualizar.

| Paquete | Cómo llega |
|---|---|
| `braces` | el origen |
| `micromatch` | → `braces` |
| `chokidar` | → `braces` |
| `fast-glob` | → `micromatch` |
| `tailwindcss` | → `chokidar`, `fast-glob`, `micromatch` |
| `@next/eslint-plugin-next` | → `fast-glob` |
| `eslint-config-next` | → `@next/eslint-plugin-next` |

### Por qué se aceptan por ahora

Dos razones, y la primera es la que manda:

1. **Son `devDependencies`.** `tailwindcss` y `eslint-config-next` no están en
   `dependencies`. No entran al bundle de producción ni corren en el servidor:
   Tailwind genera el CSS en build y `chokidar` es su watcher, que solo vive en
   `npm run dev`. El código vulnerable nunca se ejecuta donde hay usuarios.

2. **El atacante tendría que controlar nuestros patrones de glob.** La falla se
   dispara con patrones anidados profundamente. Esos patrones los escribe este
   repo —`tailwind.config.ts`, la configuración de ESLint— y los archivos que
   escanea son los nuestros. No hay entrada de usuario en ese camino.

El riesgo real es que una máquina de desarrollo o un runner de CI se quede sin
pila durante un build. Es una molestia, no una brecha.

**Esto no es permiso indefinido.** Si algún día Tailwind o el plugin de ESLint
pasaran a procesar rutas que vengan de fuera, el razonamiento se cae y hay que
volver aquí.

### Cómo se cierran

Hace falta sacar la cadena entera, no parchearla:

- **Tailwind 4** — cambia a oxide y deja de usar `chokidar`/`micromatch`.
  Reescribe la configuración a CSS-first, o sea tocar `tailwind.config.ts` y
  `app/globals.css` completos. Es un cambio del sistema de diseño.
- **Plugin de ESLint de Next 16** — para la rama de `fast-glob`.

Decisión de Patrick (16-oct-2026): **se retoma después del piloto.** No se
mezcla una reescritura del sistema de diseño con un parche de seguridad.

---

## Lo que sí se arregló

### Next 14 → 15.5.28 (16-oct-2026)

Next 14 **no tenía ninguna versión parcheada**: toda la línea 14.x estaba en el
rango vulnerable, incluidas dos RCE críticas, una de ellas específica de
servidores en Windows. Quedarse en 14.2.35 no era una opción conservadora: era
la única opción insegura.

React 18 sigue siendo peer válido en Next 15, así que no hubo que saltar a
React 19 en el mismo movimiento.

Además se agregaron `overrides` en `package.json`:

- `postcss@^8.5.30` — Next fija `8.4.31`, que permite lectura arbitraria de
  archivos `.map` vía `sourceMappingURL`.
- `postcss-selector-parser@^7.1.6` — complejidad cuadrática al parsear
  selectores.

Resultado: de **12 (1 crítica, 9 high, 2 moderate)** a **7 (0 críticas)**.

---

## Decisiones de diseño que son de seguridad

No están aquí por completitud: son las que hay que defender si alguien propone
"simplificar".

- **Ork nunca guarda contraseñas, tokens de sesión de terceros ni PAN.** La
  sesión con el servicio cerrado se descarta al terminar la orquestación.
- **Mandato vigente + confirmación de cada evento.** El silencio no es
  consentimiento: una orquestación sin confirmar expira a los 15 minutos y no
  ejecuta nada.
- **El webhook de Stripe verifica firma e idempotencia por `event.id`.** Sin lo
  primero, cualquiera que conozca la URL activa Premium gratis. Sin lo segundo,
  un reenvío cobra dos veces — y Stripe reenvía ante cualquier duda.
- **El admin está CERRADO sin `ADMIN_TOKEN`, no abierto.** Un default permisivo
  es cómo se publican tableros internos por accidente. La comparación del token
  es en tiempo constante.
- **`/api/merchant/payment-failed` va firmado con HMAC** del cuerpo crudo, con
  la hora dentro de la firma para que un mensaje viejo no se pueda reenviar.
  Responde `200` aunque el email no exista: un `404` le diría al comercio quién
  tiene cuenta en Ork.
- **Una cuenta restringida apaga el piloto entero**, y reactivar exige escribir
  a mano el motivo exacto del apagado.
- **Secretos solo en `.env`**, que está en `.gitignore`. `.env.example`
  documenta cada variable sin valores.

---

## Reportar un problema

El piloto lo opera una persona. Escribir a patrick@lessio.ai antes de publicar
nada.
