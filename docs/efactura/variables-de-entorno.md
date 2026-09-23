# Variables que necesita hablar con el PAC — solo nombres

**Para qué:** hoy `POST /api/finanzas/invoices/[id]/emit-efactura` devuelve **500** desde los
deploys de Preview porque estas variables no están cargadas ahí. La anulación
(`…/cancel` cuando la factura tiene CUFE) usa **exactamente las mismas**: las dos pasan por
`loadEmisorConfig()` y por el mismo cliente HTTP.

🔴 **Este archivo no lleva ningún valor, ni completo ni recortado.** Los del sandbox están en
`.env.local` (ignorado por git); cargarlos en Vercel es una decisión de Oliver.

## Las 16 obligatorias

Si falta **una sola**, `loadEmisorConfig()` lanza y la ruta responde 500 — que es el síntoma
que se ve hoy en Preview.

| Variable | Secreta | Dónde está el valor del sandbox |
|---|---|---|
| `EFACTURA_API_KEY` | 🔴 **sí** | `.env.local` |
| `EFACTURA_API_BASE_URL` | no | `.env.local` |
| `EFACTURA_I_AMB` | no | `.env.local` — **tiene que ser `2`** |
| `EFACTURA_EMISOR_RUC` | no | `.env.local` |
| `EFACTURA_EMISOR_DV` | no | `.env.local` |
| `EFACTURA_EMISOR_TIPO_CONTRIBUYENTE` | no | `.env.local` |
| `EFACTURA_EMISOR_RAZON_SOCIAL` | no | `.env.local` |
| `EFACTURA_EMISOR_SUCURSAL` | no | `.env.local` |
| `EFACTURA_EMISOR_DIRECCION` | no | `.env.local` |
| `EFACTURA_EMISOR_UBICACION_CODIGO` | no | `.env.local` |
| `EFACTURA_EMISOR_CORREGIMIENTO` | no | `.env.local` |
| `EFACTURA_EMISOR_DISTRITO` | no | `.env.local` |
| `EFACTURA_EMISOR_PROVINCIA` | no | `.env.local` |
| `EFACTURA_EMISOR_PUNTO_FACTURACION` | no | `.env.local` |
| `EFACTURA_EMISOR_CPBS_HON` | no | `.env.local` |
| `EFACTURA_EMISOR_CPBS_REI` | no | `.env.local` |

**Sólo una es secreta**: `EFACTURA_API_KEY`. Las demás son datos del emisor que salen impresos
en cada factura.

## Las 2 opcionales

| Variable | Secreta | Dónde |
|---|---|---|
| `EFACTURA_EMISOR_TELEFONO` | no | `.env.local` |
| `EFACTURA_EMISOR_EMAIL` | no | `.env.local` |

## Las 2 que ya están en Preview

No hay que tocarlas; se listan porque **el candado de ambiente depende de ellas**:

| Variable | Secreta | Para qué |
|---|---|---|
| `NEXT_PUBLIC_APP_ENV` | no | decide el ambiente (`local` / `staging` / `production`) |
| `NEXT_PUBLIC_SUPABASE_URL` | no | respaldo del ambiente si la anterior falta |

## 🔴 El candado que impide `i_amb = 1` fuera de producción

**`src/lib/finanzas/efactura/config/emisor-config.ts`, líneas 150-158.**

```ts
const appEnv = currentAppEnv();
if (iAmbRaw === 1 && appEnv !== "production") {
  throw new Error(…);
}
```

- **Qué variable lee para saber el ambiente:** `currentAppEnv()`
  (`src/lib/env/app-env.ts:77-82`) lee **`NEXT_PUBLIC_APP_ENV`**, y si falta o no reconoce el
  valor, cae a **`NEXT_PUBLIC_SUPABASE_URL`** — si el project ref es el de producción,
  devuelve `production`; si no, `unknown`.
- **Falla hacia el lado seguro:** con las dos ausentes el resultado es `unknown`, que **no es**
  `production`, así que `i_amb = 1` queda bloqueado igual. Para emitir de verdad hacen falta
  las dos cosas a la vez: `i_amb = 1` **y** un ambiente que se declare producción.
- **No bloquea el sandbox.** `i_amb = 2` pasa en cualquier ambiente: probar contra el PAC de
  pruebas desde staging es justamente para lo que existe.
- Antes que eso, en la **línea 129-134**, hay un guard más simple: `EFACTURA_I_AMB` sólo admite
  `1` o `2`; cualquier otra cosa aborta.

## Qué pasa hoy sin estas variables

`loadEmisorConfig()` lanza un `Error` plano —no un `MutationError`— así que la ruta lo toma
por el `catch` genérico y responde **500 "Error interno"**. Es lo que se ve al apretar
«Enviar al PAC» en el deploy de la rama.

⚠️ Vale la pena notarlo: el mensaje no dice qué falta. Mejorarlo es un cambio chico —
distinguir "falta configuración" de "error interno"— pero toca el manejo de errores de la
ruta y no estaba en el pedido; queda anotado.
