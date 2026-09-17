# ESTADO Y HANDOFF — CRM INTEGRA LEGAL

> Para retomar sin arqueología. Lo último primero.

---

## Cierre del 17/09/2026 (tarde) — reversión de cobros

**SHA de la app desplegado y verificado: `fd85a7b`** — deployment `dpl_7Phc1Ewr9zvQmakqeQ9N3AkougEH`,
READY, aliaseado a `https://crm-integra-legal-git-develop-olivercalvos-projects.vercel.app`
(el log del build dice `Commit: fd85a7b`). Encima va sólo el commit de estos documentos.

🔴 **`main` no se tocó. Producción no se tocó.** La migración `046` está aplicada SOLO en staging.

**963 tests, 963 pass.** `tsc --noEmit` limpio. `next build` exit 0.

### Qué entró (`fd85a7b`)

Reversar un cobro contabilizado, desde la fila del cobro en el detalle de la factura. Detalle en
`changelog.md` y `sop.md` SOP-030. Los tres puntos que importan:

1. **Es una función de Postgres (`reverse_payment`, 046)**: espejo + borrado de aplicaciones +
   cobro anulado en UNA transacción. Probado con una falla forzada después del posteo: no queda
   nada, ni el correlativo avanza.
2. **El espejo tiene UNA implementación** (`contabilidad/reversion.ts`), la usan la vista previa
   del diálogo y el servidor; el RPC la verifica, no la recalcula. Un test lee los archivos y lo
   vigila.
3. **El contador reversa** (`canReverse`), no registra ni elimina (`canMutate`).

### Lo verificado contra el deploy, por API con la sesión del CONTADOR de staging

La extensión de Chrome seguía caída. Se verificó con el mismo mecanismo de `render-pantalla.mts`
(sesión de Supabase + cookie de `@supabase/ssr` + bypass de Vercel), leyendo el HTML servido
antes y después, y disparando el POST real:

- **Antes**, `/finanzas/facturas/{FAC-HON-000002}` como contador: 1 pago de B/. 1,000.00, botón
  **Reversar** presente; "Registrar pago", "Eliminar pago" y "Anular factura" **ausentes**.
- **`POST /api/finanzas/payments/{id}/reverse`** → 200: asiento **21** revierte al **10**, fecha
  2026-09-17, FAC-HON-000002 → `emitida`, `amount_paid` 0.
- **Después**, la misma pantalla: *"Sin pagos vigentes · 1 reversado"*, Pagado 0.00, Saldo
  1,605.00, la fila del cobro con *"Reversado · asiento 21"* y el motivo, sin botón Reversar.
  Badge de estado: **Emitida**.
- **Diario General**: asiento 21, tipo Reversión, 100001 crédito 1,000.00 / 100004 débito
  1,000.00, descripción *"Reversión del asiento 10 — …"*.
- **Libro Mayor de 100004**: el payload trae el destino del cobro → `/finanzas/facturas/{id}`,
  o sea que los asientos 10 y 21 ofrecen "Abrir el documento".
- **Base**: cobro `anulado`, 0 aplicaciones, `payment_reversals` con la foto, cadena de hash
  íntegra (0 eslabones rotos).

**Lo que quedó SIN ver en pantalla** (no se puede desde un fetch): el modal abierto —textarea del
motivo, la tabla de la vista previa y el botón de confirmar habilitándose con 3 caracteres— y el
"Abrir el documento" del Mayor, que sólo se dibuja al expandir la fila (estado de cliente). La
lógica de esas dos cosas está cubierta por tests; lo que no está mirado es el render.

### Pendiente, en orden

1. **Abrir el modal de Reversar con un clic real** cuando vuelva la extensión (o dejar la pestaña
   activa, como dice el cierre del 10/09).
2. Lo del 10/09 que sigue: verificar por pantalla una compra con dos líneas; revisión de
   usabilidad del sitio completo; módulos de cobro y pago; las 20 líneas de trámite sin cuenta;
   tres mejoras contables; `HON-FAM`/`HON-OTROS`; el bloque `022`.
3. **Reversión de asientos manuales y de gastos de trámite** — sigue sin existir. Ver
   `task_plan.md` (arriba de todo).

---


## Cierre del 10/09/2026

**El último SHA con cambios de aplicación es `48bbd74`**, y es el que se verificó en la pantalla
desplegada — deployment `dpl_F4jHuPVcqQhYh57qwieBJu6kZnC9`, READY, aliaseado a
`https://crm-integra-legal-git-develop-olivercalvos-projects.vercel.app`.

Encima va sólo este documento, que no toca código: el deploy vivo al cerrar el día corre el mismo
build de la app. Para ver el SHA exacto que está arriba en cualquier momento:

```
npx vercel inspect crm-integra-legal-git-develop-olivercalvos-projects.vercel.app
```

Árbol limpio, nada sin commitear ni sin pushear (lo único sin trackear es `Claude outputs/`, un
PDF ajeno al código).

🔴 **`main` sigue en `d5ac249`. Producción NO se tocó en ningún momento.**

**912 tests, 912 pass.** `tsc --noEmit` limpio. `next build` exit 0.

### Qué se desplegó hoy, y con qué SHA quedó cada cosa

| SHA | Qué entró |
|---|---|
| `ad1d7d5` | **El botón del asiento manual dice por qué está apagado** — `estadoDelRegistro()` devuelve el MOTIVO y no un booleano. Más `account_code` en las condiciones. **Y los 13 campos de monto homologados** en 11 archivos: `MoneyInput`, sin flechitas, a la derecha, dos decimales con separador de miles |
| `53e654c` | **El campo de dinero selecciona sincrónico**, no por `requestAnimationFrame`. Encontrado verificando en el navegador: tecleando `1500` sobre un `0.00` quedaba `15000`, porque rAF no dispara en una pestaña oculta |
| `36b581f` | **La diferencia del Aging explica su causa real** (apertura 191,947.55 − 507.00 + 150.00 = 191,590.55, todos anteriores al cableado). **Separador de miles en Facturación y Cotizaciones** — 46 importes, 14 archivos. **La frase del corte por período** se declara por pantalla |
| `9324f09` | **Compras: cuenta por defecto vacía** (heredaba `130003`, la de trámite), **orden del formulario** como facturación, y **un solo bloque de totales** |
| `ab1dfaa` | **El Mayor con Débito y Crédito en columnas separadas**. **Drill-down desde el número**. Sin rótulo "Línea N". **"Distribución a Socias" pegada a la Utilidad Operativa** |
| `c7414bf` | **El saldo del Mayor se lee según la naturaleza de la cuenta**, no en balanza. La exportación a Excel también partida en Débito y Crédito |
| `48bbd74` | **Los cinco hallazgos del smoke test**: el rechazo mudo de compras, el drill-down por el monto en ER/Balance (y en Comprobación, que no tenía ninguno), el selector de impuesto igual al de facturación, el filtro de cuentas reemplazado por grupos, y el nombre del proveedor en el listado |

### Lo verificado en la pantalla desplegada

- Factura de honorarios civil **FAC-HON-000009** emitida → **asiento 14** en el mayor de `400004`,
  ITBMS −105.00 en `200003`, saldo coincidente con el Balance.
- **Asiento 15** registrado con el flujo completo: descuadrado 90/100 → corregido a 100/100 →
  el motivo cambia a *"Falta describir la naturaleza del asiento"* → botón habilitado.
- **Filtro de fecha** en pyl, balance, comprobación y mayor: las cuatro responden con el rango
  aplicado. (Aging **no tiene** filtro de fecha; tiene el toggle Por cobrar / Por pagar.)
- **El rechazo de Familia**: deja crear el borrador y bloquea la emisión con un mensaje que nombra
  el servicio y la cuenta `4101`.
- **Los campos de monto**: pintan `1,500.00` y al enfocarlos muestran `1500` sin formato.

---

## Pendiente, en orden

### 1. Verificar por pantalla el guardado de una compra con dos líneas

Es **lo único de la verificación del 09/09 que nunca se pudo cerrar**: una gravada al 7% y una
exenta, con número de factura del proveedor y vencimiento editado a mano, confirmando que guarda y
que genera su asiento.

⚠️ **Y ahora importa más que ayer**, porque toca justo lo que cambió el 10/09: el selector de
cuenta agrupado, el selector de impuesto nuevo y el mensaje de rechazo. Esos tres no se probaron
con una compra real guardada.

**Lo que lo bloqueó:** los clics de la extensión de Chrome no llegan a una pestaña con
`document.visibilityState === "hidden"`. Navegar y leer el DOM sí funciona; apretar "Guardar
gasto" no. Hay que dejar la pestaña del grupo de Claude **activa** en su ventana y la ventana sin
minimizar.

### 2. Revisión de usabilidad del sitio completo

El bloque siguiente. **Arranca escribiendo el estándar** —campos de dinero, selectores de cuenta,
botones deshabilitados, mensajes de error, orden de los formularios— y después **audita todas las
pantallas contra él**.

Insumos que ya existen y hay que consolidar, no reinventar: `MoneyInput` y `fmtImporte()`,
SOP-027 (un botón apagado dice por qué), el orden encabezado → líneas → totales, y el criterio de
que nada que el usuario necesite quede detrás de un filtro que no ve.

### 3. ~~`tax_code_id` en `expense_lines`~~ — HECHO el 16/09/2026

Migración `045` + servidor que resuelve la tasa contra `tax_codes` + `TaxCodeSelect` en el editor +
Línea 5 del Resumen de ITBMS desde las líneas + detalle de la compra con sus líneas. Commit
`df3ec3a`, aplicada en staging, verificada con clic real (compra mixta → asiento #20). Ver
`changelog.md` del 16/09 y `sop.md` SOP-028. Lo que quedó anotado: `task_plan.md`.

### 4. Los módulos de cobro y pago

Los dos que cierran el ciclo **vender → cobrar → comprar → pagar**.

### 5. Las 20 líneas de gasto de trámite sin cuenta contable

B/. 7.600. Ninguna está posteada y ninguna puede postearse hasta que se les asigne cuenta.
Necesita asignación masiva.

### 6. Tres mejoras del módulo contable

- **Clonar un asiento existente.**
- **Columna de proveedor por línea** en el asiento manual.
- **Export del mayor a Excel con nombre y RUC del cliente.**

### 7. `HON-FAM` y `HON-OTROS`

Siguen apuntando a `4101` y **rechazando a propósito**. Esperan que el bufete decida si Familia va
separado o dentro de Civil. Un rechazo con nombre y apellido es reversible; un ingreso mal
clasificado dentro de un libro inmutable, no.

### 8. El bloque `022` — backfill del DV en producción

---

## 🔴 La regla de método que se ganó esta semana

> **Ningún bloque se da por terminado sin abrir la URL de staging desplegada. El cierre de cada
> bloque dice qué SHA está vivo ahí.**

**Medir el mecanismo no es lo mismo que mirar la pantalla.** Esta semana esa diferencia costó una
reunión: el 09/09 los tests pasaban, el motor de posteo estaba probado contra la base con INSERTs
reales, y el deploy que corría la demo era de seis días antes —tres commits de cableado quedaron
commiteados en local y nunca subidos—. Todo lo que se había medido era cierto, y nada de eso
estaba en la pantalla que vio el cliente.

Y no es una sola vez. Lo que apareció **sólo** por abrir el deploy:

- Un `1500` tecleado sobre un `0.00` que quedaba en `15000` — `requestAnimationFrame` no dispara
  en una pestaña oculta. Tests en verde, `tsc` limpio, build OK.
- El Aging explicando su diferencia con una frase que había dejado de ser cierta el día anterior.
- Tres pantallas afirmando *"no hay corte por período"* justo encima del filtro de fechas que sí
  filtraba.
- Las líneas de compra naciendo en `130003`, la cuenta de gastos de trámite.
- El listado de gastos mostrando "—" **exactamente** en los gastos cargados bien.
- La Comprobación sin drill-down, la única de las tres hermanas.

Ninguno lo detecta un test, y ninguno lo detecta un `grep`. Ver `scripts/render-pantalla.mts`,
que existe por esto mismo.

**Para automatizarlo:** el secreto de Vercel ya está en `.env.local`
(`VERCEL_AUTOMATION_BYPASS_SECRET`), así que `RENDER_BASE_URL=<alias de develop>` alcanza para
renderizar cualquier pantalla del deploy sin pasar por el SSO.
