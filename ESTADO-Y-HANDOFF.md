# ESTADO Y HANDOFF — CRM INTEGRA LEGAL

> Para retomar sin arqueología. Lo último primero.

---

## Cierre del 21/09/2026 (tarde) — Parte A: el contador ve Cobros; Parte B: plan multi-factura

**SHA de la app en staging: `1fed5f1`** — deployment `dpl_Atui5PWuwesvCqVK2tDobUC634At`, READY,
aliaseado al dominio de develop. Encima van solo commits de docs. **`main` sigue en `24b227a`.**

**1009/1009.** `tsc` y lint limpios.

Las cuatro respuestas de Josuarth están **textuales** arriba de todo en `task_plan.md`. La 1 se
hizo (Parte A); la 2 está planeada, no construida (Parte B, en `task_plan.md`); la 3 y la 4 son
del Bloque 3 (pagos a proveedores: parcial SÍ, un pago por factura).

### Parte A — verificado por API como contador contra el deploy

`/finanzas/cobros` → 200, 5 recibos, Recibo + Reversar, sin "Registrar cobro". `/nuevo` → 307.
**Sin clic real:** Chrome se cerró y la extensión no reconectó. Falta abrir el modal de Reversar
como contador en pantalla (la lógica es la misma que la abogada usó con clic real más temprano).

### Pendiente

1. Oliver decide si arranca la Parte B (construcción) con el plan de `task_plan.md`.
2. Lo que quedó sin ver: ancho de teléfono; el modal de Reversar como contador.
3. Lo anterior sigue igual (ver el cierre de abajo).

---


## Cierre del 21/09/2026 — Bloque 2: recibo de caja como módulo real

**SHA de la app en staging: `a1a8c50`** — deployment `dpl_AR71ni3hzxMsmNLFNz7dycm8q4S8`, READY,
aliaseado a `https://crm-integra-legal-git-develop-olivercalvos-projects.vercel.app` (log del
build: `Commit: a1a8c50`). Encima va sólo el commit de estos documentos.

🔴 **`main` sigue en `24b227a`. Producción NO se tocó.** La migración `047` está aplicada SOLO en
staging (igual que la `045` y la `046`).

**1007 tests, 1007 pass.** `tsc` limpio. Lint limpio en lo tocado (los 4 warnings de `alt` en los
PDF viejos son preexistentes).

### Qué entró (`changelog.md`, entrada del 21/09; reglas en `sop.md` SOP-031 y CLAUDE.md)

Un cobro es un recibo de caja `REC-000001`: migración `047` con backfill, `createPayment` numera
antes del INSERT (huecos aceptados a conciencia), formulario compartido entre el diálogo y
`/finanzas/cobros/nuevo`, listado `/finanzas/cobros` (admin y abogada) con Reversar reusando el
diálogo del 17/09, y PDF con cache por hash que se regenera al reversar. Más cuatro hallazgos
corregidos (FND-005 a 008), dos de ellos en `ConfirmationModal`, que usan 22 pantallas.

### Verificado en el deploy con clic real (abogada `abogada@staging.test`) y por API (contador, asistente)

Todo el C.7 del plan menos el ancho de teléfono: alta desde el diálogo (REC-000004 → asiento 22),
**reversar desde el listado con clic real** (asiento 23 — la verificación que quedó pendiente
del 17/09, ya cerrada), PDF vigente y reversado, alta desde `/finanzas/cobros/nuevo` con rechazo
por saldo y después REC-000005 → asiento 24 → FAC-HON-000008 *Pagada*, contador 307/200/sin
"Registrar", asistente 403/307. Lista completa en el changelog.

**Estado de staging al cerrar:** REC-000001 y REC-000002 registrados (del seed), REC-000003 y
REC-000004 reversados (asientos 21 y 23), REC-000005 registrado (asiento 24). `last_number` = 5.

### Lo que quedó sin verificar

1. **El wizard y el listado en ancho de teléfono.** `resize_window` de la extensión no aplicó (la
   captura siguió a 1425 px). La estructura es la misma que `invoices-list` (cards bajo `lg:`),
   pero no está mirada.
2. **El diálogo del detalle de factura como contador** solo se vio por API (HTML servido): botón
   Recibo presente, "Registrar pago" ausente. El modal de Reversar abierto como contador, no.

### Cómo se verificó (para repetirlo)

- Extensión de Chrome: conecta, pero se cae cada tantas acciones y las capturas a veces salen
  recortadas o "renderer frozen"; reintentar una vez alcanza. Los clics por `ref` de `find` son
  más confiables que por coordenadas. `form_input` no llena inputs controlados por React: hay
  que teclear.
- Login del deploy: la URL con `?x-vercel-protection-bypass=<secreto>&x-vercel-set-bypass-cookie=true`
  deja la cookie y después se entra normal. Usuarios del seed en `docs`/salida de `seed:staging`.
- `render-pantalla.mts` contra el deploy: **`MSYS_NO_PATHCONV=1`** adelante si es Git Bash
  (FND-008). Con `STAGING_UI_EMAIL`/`PASSWORD` por env se puede probar cualquier rol del seed.

### Pendiente, en orden

1. **Preguntarle a Josuarth si el contador quiere ver `/finanzas/cobros`** (material de
   conciliación). Si sí: `"contador"` en el ítem de `nav-config.ts` + `/finanzas/cobros` en
   `CONTADOR_FINANZAS_PREFIXES`, juntos.
2. El ancho de teléfono del punto anterior.
3. Lo que ya estaba: compra con dos líneas por pantalla; revisión de usabilidad; el módulo de
   PAGO a proveedores (el de cobro ya está); las 20 líneas de trámite sin cuenta; tres mejoras
   contables; `HON-FAM`/`HON-OTROS`; el bloque `022`; reversión de asientos manuales y de
   gastos de trámite.
4. Cuando la `047` vaya a producción: pre-flight del encabezado del archivo (ningún
   `payment_number` con formato distinto de `REC-######`), y la `045`/`046` van antes.

---


## Cierre del 18/09/2026 — el hotfix del tipo 09 salió a producción

**SHA de la app en staging: `4c01360`** — deployment `dpl_D82X93ttB8pRNGm3EKuVQzRjmezQ`, READY, 18/09
12:05, aliaseado a `https://crm-integra-legal-git-develop-olivercalvos-projects.vercel.app` (log del
build: `Commit: 4c01360`). Es el merge de `main` en `develop`; `develop` y `origin/develop` están ahí.

🔴 **`main` está en `24b227a` y ES producción.** Deploy `2yf7q4gyc` Ready, alias
`crm-integra-legal.vercel.app`. Deploy anterior (destino del Instant Rollback): `4jogydgyk`.
Detalle del hotfix en `changelog.md` (entrada `[HOTFIX] - 2026-09-18`).

**Lo que entró a producción** (rama `hotfix/tipo-09-y-gate-de-mezcla`, tres cherry-picks de
`develop`): el gate de mezcla al crear/editar (`5e695ff`), el tipo 09 para reembolsos (`780bda0`) y
el gate al emitir (`30deedf`). **No hay migración de base en el hotfix.** Las `045` y `046` siguen
SOLO en staging.

**La rama `hotfix/tipo-09-y-gate-de-mezcla` sigue en `origin` y en local** (`3ba9d4b`), contenida al
100% en `main` y en `develop`. Borrarla es seguro; es decisión de Oliver.

### Lo que quedó sin verificar (arrastra lo del 17/09)

- **Producción:** la primera factura de reembolso real la emite el bufete; se confirma que el CUFE
  empiece con `FE09` y el estado sea "Autorizada DGI". No se probó contra producción.
- **Bloque de mezcla, en pantalla con clic real:** nunca se vio el `data-error` de la fila ni el
  mensaje del selector al cambiar el tipo de documento con líneas cargadas. El gate al EMITIR
  (`30deedf`) tampoco tiene verificación en pantalla, solo tests.
- **Reversión de cobros:** el modal de Reversar abierto con un clic real (textarea, vista previa,
  botón a los 3 caracteres) y "Abrir el documento" del Mayor al expandir la fila. **Se cierra en el
  Bloque 2 (recibo de caja), punto 5 de su verificación.**
- Lo del tipo 09 del 17/09: emitir desde el deploy de staging, el botón "Enviar al PAC" desde la
  UI, una REI con varias líneas en sandbox.

### Siguiente: Bloque 2 — recibo de caja como módulo real

Plan aprobado el 21/09/2026 (Oliver). Decisiones cerradas: correlativo interno `REC-000001` (no es
documento fiscal, no pasa por la DGI), **backfill** de los cobros existentes por `payment_date,
created_at`, un recibo = una factura (el N:M queda abierto, sin UI), `client_payments` no se cruza
con `payments`, huecos de numeración aceptados con el criterio de `emitInvoice`. `/finanzas/cobros`
solo admin y abogada; el contador queda pendiente de preguntar a Josuarth. Plan completo en
`task_plan.md`, arriba de todo.

---


## Cierre del 17/09/2026 (noche) — eFactura descongelado: reembolsos como tipo 09

**SHA de la app en staging: `780bda0`** — deployment `dpl_8QZdU5tR59nrsmnhaNVhpPwBm84j`, READY,
aliaseado a `https://crm-integra-legal-git-develop-olivercalvos-projects.vercel.app` (log del
build: `Commit: 780bda0`). Encima va sólo el commit de estos documentos.

🔴 **`main` no se tocó. Producción no se tocó. No hay merge: Oliver decide cuándo va.**

**966 tests, 966 pass.** `tsc` limpio.

### Qué respondió el PAC en el sandbox (`EFACTURA_I_AMB=2`, `eic-api.ideati.net`)

FAC-REI-000002 de staging, emitida con la orquestación real desde localhost (base de staging):

- `request.datosGenerales.tipoDocumento = "09"` (guardado en `fe_emisiones.request_payload`).
- **0260 — Autorizado el uso de la FE.**
- Número: punto `001`, documento `1`.
- CUFE: `FE0920000025046169-3-2021-4000002026091700000000010010121650905584` (el `09` del tipo
  va codificado en el CUFE).
- Protocolo: `00001528364-1-65300620260000000000059872`. Autorizada 2026-09-17T18:05:39.994Z.
- Los dos intentos anteriores fallaron por el RUC del **receptor** (1601/1602: los clientes de
  staging son ficticios y la DGI de pruebas no los conoce), no por el tipo 09 — el PAC ya
  devolvía un CUFE `FE09…` en el intento 1. Se resolvió como en junio: emisor = receptor.

**En la pantalla desplegada** (`780bda0`, como contador): la card "Facturación Electrónica" de
FAC-REI-000002 dice *Autorizada DGI*, con ese CUFE, ese protocolo, `001 / 0000000001` y el
enlace al portal DGI.

### Lo que quedó sin verificar

1. **Emitir DESDE el deploy de staging.** Imposible hoy: Vercel Preview no tiene ninguna
   variable `EFACTURA_*` (las 19 están sólo en Production). El botón "Enviar al PAC" ahí
   falla en `loadEmisorConfig()` antes de llegar al PAC. Cargar las del sandbox en Preview es
   un cambio de env vars en la cuenta del cliente: decisión de Oliver.
2. **El botón "Enviar al PAC" desde la UI** — el usuario de staging es contador (403). La
   función detrás del botón es la misma que corrió hoy.
3. **Una REI con varias líneas** en el sandbox (hoy: una línea exenta).
4. `scripts/render-pantalla.mts` falló tres veces contra el deploy con *"No se pudo conectar"*
   mientras un fetch idéntico desde otro script funcionaba. No se investigó; se verificó con el
   otro script. Queda anotado.

### Tres cosas que NO se tocan (en `task_plan.md`, arriba de todo)

La validación de mezcla es de negocio (Josuarth), no del PAC. Las 34 REI ya emitidas como 01 no
se corrigen (Josuarth). El CPBS `8012` de reembolsos sigue como placeholder.

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
