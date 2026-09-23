# ESTADO Y HANDOFF — CRM INTEGRA LEGAL

> Para retomar sin arqueología. Lo último primero.

---

## ✅ CERRADO — desactivar una tasa desde la pantalla (23/09/2026)

Resuelto en `3c9cb47` y **verificado con clics** en la URL fija de la rama:
`PRUEBA_10` se reactivó con el botón, volvió al selector de compra, se desactivó con
el botón y desapareció del de factura. Los dos movimientos quedaron en `audit_log`
con `field = 'active'`. Queda desactivada.

El texto de abajo se conserva porque explica por qué una tasa no se borra.

### (histórico) El hueco

Salió de la verificación del Bloque 8. El pie del formulario de alta de tasas dice *"Una tasa no
se borra: se desactiva"*, y **desactivarla no se puede desde la UI**: el modo edición sólo tiene
nombre y tasa, y `guardar()` manda `{ rate, name }` sin `active`
(`tax-codes-manager.tsx:137`).

**El backend ya está**: `active` está en `UpdateTaxCodeInput`, en `validateUpdateTaxCode` y en
`updateTaxCode`. Falta sólo el control en pantalla — un botón por fila que mande
`{ active: !t.active }` al `PATCH` que ya existe, con el mismo `canEdit`.

Mientras tanto, `PRUEBA_10` quedó desactivada por SQL contra staging.

⚠️ Aparte: los botones **Editar** y **Desactivar** de una fila del Plan de Cuentas no
respondieron al clic durante la verificación. **No confirmado como bug** — en esa sesión varios
clics por referencia fallaron de forma intermitente en pantallas que sí funcionaban. Confirmar
a mano antes de abrir un hallazgo.

---

## ✅ CERRADO — los clics en staging del Bloque 8 (23/09/2026)

**El Bloque 8 está construido, desplegado y VERIFICADO con clics. SHA: `61c1e52`.**
Los diez pasos de abajo se ejecutaron el 23/09/2026 como admin; el detalle de qué se vio en
cada uno está en `changelog.md`. Se deja la lista como referencia para la próxima.

- Deploy: `61c1e52` → `https://crm-integra-legal-4xid3lwu7-olivercalvos-projects.vercel.app`
  (estado `success`, la pantalla carga, banda ámbar de staging confirmada).
- **Por qué quedó pendiente:** entrar exige escribir la contraseña de `STAGING_UI_PASSWORD` en
  el formulario de login, y eso es algo que el agente no hace en ningún caso. No es un problema
  del deploy ni del código.
- Queda una pestaña de Chrome abierta en el login de ese deploy.

### Qué hay que clickear (y con qué rol)

El usuario de staging tiene rol **contador**, que alcanza para todo lo de abajo: entra a
Proveedores y a Gastos del Bufete con CRUD, y a Configuración → Impuestos con edición.

**4.4 — cuenta por defecto (`/finanzas/proveedores`)**
1. Abrir un proveedor → Editar. El bloque "Cuenta contable por defecto" ofrece sólo cuentas de
   **gasto y costo activas**. ✅ `130003 Fondo Legales de Clientes` **NO** tiene que estar.
2. Elegir una (ej. `610001 Alquiler`), guardar, y verla en la ficha.
3. Ir a `/finanzas/gastos-bufete/nuevo`, elegir ese proveedor: cada línea nueva tiene que
   arrancar con esa cuenta. Cambiarla en una línea y agregar otra → la nueva vuelve al default,
   la cambiada **no** se toca.
4. **Degradación:** desactivar esa cuenta en Configuración → Plan de Cuentas, volver a la ficha
   del proveedor → aviso ámbar y selector vacío; volver al alta de compra → líneas sin cuenta y
   el aviso que manda a la ficha. Reactivar la cuenta al terminar.

**4.1 — contacto (`/finanzas/proveedores/[id]/editar`)**
5. Cargar nombre, teléfono y correo del contacto **distintos** de los de la empresa. Guardar y
   ver en la ficha las dos tarjetas separadas ("Datos de la empresa" y "Persona de contacto").

**4.5 — plazo**
6. Los botones Contado · 15 · 30 · 45 · 60 · 90 escriben el número y el campo sigue editable
   (probar un 22 a mano). Elegir el proveedor en un alta de compra → el vencimiento se precarga.

**2.4 — tasas (`/finanzas/configuracion/impuestos`)**
7. "Nueva tasa" → código `PRUEBA_10`, nombre `Prueba 10%`, tasa `10`. Debajo del campo tiene que
   decir **`Se guarda como 0.1000 = 10%`** mientras se escribe. Probar `700` → aviso rojo.
8. Crear. Verificar que aparece en los selectores de **factura**, **compra** y **gasto de
   trámite** (los tres, es lo que pidió Oliver explícitamente).
9. **Desactivarla** y confirmar que desaparece de los tres selectores.
10. Intentar crear otra con el mismo código → mensaje en español, no un `duplicate key`.

Cuando esté, anotar el SHA verificado en `changelog.md` y cerrar el bloque en `task_plan.md`.

---

## Nota del 21/09/2026 — FND-009 y producción

**Producción NO está afectada por FND-009.** El "Marcar como pagada" roto es el de `develop`
(cableado el 04/09 con el asiento del pago). `main` (`24b227a`) tiene la versión anterior: un
UPDATE de `status`/`payment_date`/`payment_method`, sin `postJournalEntry` y sin la columna
inexistente. Allá el botón funciona, sin libro. Verificado con `git show origin/main`. El Bloque 3
lo reemplaza en `develop`; plan en `task_plan.md`.

---


## Cierre del 22/09/2026 — Bloque 7: módulo de asientos de diario

**SHA de la app en staging: `4bcc5c2`** — deployment `dpl_C41FXL9EQHpbopxn3SyMa3nQ8WcZ`, READY.
Encima va solo este commit de docs. **`main` sigue en `24b227a`. Producción no se tocó, ni
lectura ni escritura.** Migraciones `054` y `055` aplicadas SOLO en staging.

**1167/1167.** `tsc` limpio. Lint: los 20 preexistentes de Legal.

### Qué entró (detalle en `changelog.md`, reglas en SOP-035 y CLAUDE.md)

Tercero por línea con dos FK reales y `ON DELETE NO ACTION` (054), en el formulario, en el Mayor,
en el Diario y en el Excel; el borrado de un cliente o proveedor del libro se explica en vez de
filtrar la FK; los asientos manuales explican la diferencia de la antigüedad (D5); detalle del
asiento con los dos lados de la reversión; clonar; y la reversión de asientos manuales (055) con
el índice que impone una sola reversión por asiento.

### 🔴 Cuatro cosas que nadie debe "arreglar"

1. **`ON DELETE NO ACTION` en el tercero.** Un `SET NULL` fallaría contra el trigger de
   inmutabilidad, desde la pantalla de Clientes y con un error sobre el ledger.
2. **`reverse_journal_entry` filtra `manual`.** Reversar una factura desde ahí se saltaría
   `cancelInvoice` y la nota de crédito.
3. **El tercero entra al hash.** Es la tercera versión de la fórmula; las tres están listadas en
   SOP-014 con fecha, y un verificador que recalcule el contenido las necesita.
4. **`MAX_LINEAS_MANUALES` es del formulario.** El importador (7.5) no lo aplica.

### Verificado en el deploy

Con clic real como contador: asiento 50 con tercero por línea; Mayor con el nombre; Diario con la
columna Tercero; antigüedad nombrando el asiento manual y sin "tercera causa"; detalle del 50 y
del 48; Clonar con todo precargado y fecha de hoy; Reversar → asiento 51, banda "fue reversado",
neto cero en las dos cuentas y cadena de hash intacta. Por API como abogada: borrar un cliente
del libro → 400 con el mensaje del libro y sin borrar nada.

### Estado de staging al cerrar

Asiento 50 (manual, con tercero) reversado por el 51; `journal_entry` = 51. CLI-015 (Aníbal
Serracín) y el proveedor CABLE ONDA quedaron **no eliminables** por aparecer en el libro — es el
comportamiento nuevo, no un problema.

### Lo que sigue

- **7.5, importar asientos desde Excel**: su propio bloque. La plantilla ya puede llevar la
  columna Tercero, y hace falta `post_journal_entries_batch` para que un archivo entre entero o
  no entre (el correlativo y la cadena no se deshacen entre llamadas).
- Reversión de una **nota de crédito**: sigue sin existir.

---

## Cierre del 22/09/2026 (mañana) — FND-011

**SHA de la app en staging: `c74cb7f`** — deployment `dpl_85XLSPWn15VLmcJRVfuUMb6sTPst`, READY.
Encima va solo este commit de docs. **`main` sigue en `24b227a`. Producción no se tocó.** Sin
migraciones nuevas (las del Bloque 5 son `051`–`053`, solo staging).

**1134/1134.** `tsc` limpio. Lint: los 20 preexistentes de Legal.

`emitInvoice` ya no puede dejar un asiento con el número de otra factura: verifica el número
antes de postear (409 sin postear nada) y el reintento toma el número **del asiento**, no uno
nuevo. El asiento 43 de staging **se reversó** (asiento 48) con la reversión de verdad, no con un
DELETE, y con eso la antigüedad por cobrar cierra sin residuo.

### 🔴 Para el próximo

- **El seed NUNCA rebobina `numbering_sequences`** (se arregló el 21/09 de noche). Si alguien lo
  "simplifica" de vuelta al máximo sembrado, FND-011 vuelve a aparecer por la puerta de atrás.
- **Un asiento mal posteado se REVERSA** (`scripts/reversar-asiento-huerfano.ts`), nunca se borra.
- ⚠️ **En el navegador de pruebas quedó una cookie vieja llamada
  `sb-uqmmkklbhzxqybljiecs-auth-token`** (el ref de PRODUCCIÓN) sobre el dominio del preview.
  La app de staging no la usa —su cliente es el de staging, y el banner ámbar lo confirma— pero es
  un resto de antes de Fase 0 y conviene borrarla del perfil de Chrome.

### Estado de staging al cerrar

FAC-HON-000014 emitida (asiento 49); asiento 43 reversado por el 48; `invoice_hon` = 14;
borrador `DRAFT-ad8142bceaa8` sigue ahí y **ya no se puede emitir** (su asiento está en el libro y
reversado): si molesta, se elimina como borrador — es una decisión de Oliver, no la tomé yo.

---

## Cierre del 22/09/2026 — Bloque 5: nota de crédito contable

**SHA de la app en staging: `1de1c3a`** — deployment `dpl_AwaoF2Fpyc3hYnhuccJHqyNNFBnS`, READY.
Encima va solo este commit de docs. **`main` sigue en `24b227a`. Producción no se tocó, ni
lectura ni escritura.** Migraciones `051`, `052` y `053` aplicadas SOLO en staging.

**1129/1129.** `tsc` limpio. Lint: los 20 errores preexistentes de Legal, ninguno en los archivos
del bloque.

### Qué entró (detalle en `changelog.md`, reglas en SOP-034 y CLAUDE.md)

NC por líneas con cantidad (validador puro, tope por saldo); asiento propio de la NC con
`source_id = la NC`; anulación = NC total + reversión con fecha de hoy + `anulada` en un RPC;
bloqueo por mes de la factura cerrado; 053: con NC en el libro no se anula; `credited_total`
derivada y `balance_due` con el crédito; badge "Acreditada total"; detalle de NC con banda de
documento interno; PDF con la banda; Mayor y Diario llegan a la NC.

### 🔴 Tres cosas que nadie debe "arreglar"

1. **La NC de una anulación NO tiene asiento propio.** Lo que corrige el libro es la reversión.
   Postearla aparte contaría dos veces (SOP-034 §2).
2. **"Acreditada total" no es un status.** No se agrega al CHECK; es `credited_total >=
   grand_total` en pantalla. T7a la deja `emitida` con saldo 0 (D3).
3. **La banda "DOCUMENTO INTERNO" del PDF no es decorativa.** Se va sola cuando `fe_estado` deje
   de ser `no_emitida`, y eso lo hace el envío al PAC, que no existe.

### Verificado en el deploy

Por API como abogada (`verificar-nota-de-credito.mts`, 5/5): 403 del contador, anulación con
reversión, NC parcial con asiento, tope, 409 de la 053. Con clic como contador: detalle de
factura con la sección de NC, detalle de la NC (banda, RUC y DV, asiento), PDF (bajado y leído:
banda y cabeceras), "Acreditada total", Mayor → NC, Diario con NC-…, antigüedad sin la acreditada.

### Estado de staging al cerrar

FAC-HON-000012 `emitida` con NC-000006 (107, asiento 47), saldo 214; FAC-HON-000013 `anulada`
(NC-000005, reversión 46 del 45); FAC-HON-000002 acreditada total (NC-000004, asiento 42);
FAC-HON-000011 anulada (NC-000001, reversión 41). Huecos NC-000002/000003. `credit_note` = 6,
`invoice_hon` = 13. Borrador `DRAFT-ad8142bceaa8` con el asiento 43 huérfano (FND-011): residuo
de 321.00 en la antigüedad por cobrar hasta el próximo reset de staging.

### Pendiente de Oliver

- FND-011 (chico): guard de número duplicado antes de postear + el reintento toma el número del
  asiento existente.
- Las dos preguntas de `task_plan.md` (ideati: fecha de la NC ante la DGI; Josuarth: saldo
  acreedor y excedente del recibo).

---

## Cierre del 21/09/2026 (noche, tarde) — Bloque 4: gasto de trámite completo

**SHA de la app en staging: `1fc59ec`** — deployment `dpl_HwP1tbWzjaE7ndoLGBzH1MeaQfxT`, READY.
Encima va solo este commit de docs. **`main` sigue en `24b227a`. Producción no se tocó, ni
lectura ni escritura.** Migraciones `049` y `050` aplicadas SOLO en staging.

**1104/1104.** `tsc` limpio. Lint: errores preexistentes en Legal e `import-parser.ts`, ninguno en
los archivos del bloque.

### Qué entró (detalle en `changelog.md`, reglas en SOP-033 y CLAUDE.md)

Arco exclusivo en `supplier_payments` + `expenses.amount_paid/status` derivados (049); reversión
del gasto de trámite (050, antes del posteo automático por D6); posteo automático en el alta con
DELETE compensatorio y el botón manual como reintento; el pago del gasto por el mismo motor que
las compras, con dos entradas; Mayor/Diario abren el gasto; la antigüedad por pagar lo lee
(FND-010 cerrado).

### 🔴 Dos cosas que nadie debe "arreglar"

1. **El botón "Registrar en el libro contable" NO hacía falta para los gastos nuevos y SÍ hace falta
   para los viejos.** Es un reintento; no lo saquen ni lo vuelvan a hacer el camino (SOP-033 §1).
2. **`expenses.payment_account_code` sigue ahí sin usarse.** Nadie le escribe el banco: la 038 lo
   congela y el banco va en el pago. Se dropea en otra migración.

### Verificado en el deploy

Con clic como contador (reversión del gasto, alta que nace con asiento, Registrar pago → CE-000004,
comprobante, reversión del pago, Mayor con "Abrir el documento", Diario, antigüedad). Por API como
abogada (`verificar-alta-gasto-tramite.mts`, 7/7): 403 del contador, alta 201 con asiento y líneas,
fecha sin período → 422 y el gasto no queda, "Ya se pagó" → gasto pagado con CE-000005. La
antigüedad por pagar cierra al centavo: −33.65 = +73.50 heredados − 107.15 del seed.

### Estado de staging al cerrar

Gasto #11 anulado (asiento 33); 3 gastos "Verificación B4" pendientes (asientos 34, 37, 38+) y uno
pagado (CE-000005); CE-000004 reversado (asiento 36); 2 saldos heredados; `last_number`
supplier_payment = 5.

### Lo que la extensión enseñó hoy

- Un clic por `ref` muchas veces solo enfoca; repetir o disparar por JS (`button.click()`).
- `type` en un textarea perdió los caracteres acentuados: setter nativo + `dispatchEvent('input')`.
- Un `.mts` no ve los exports con nombre de un `.ts` (CJS bajo tsx): `createRequire`.

### Pendiente

1. **Josuarth** (paquete en `task_plan.md`): nombre `CE-`, excedente de cobros, columna Documento.
2. Estado de Cuenta del proveedor con gastos de trámite.
3. Dropear `expenses.payment_account_code` (migración propia, después).
4. Producción: la cola de migraciones 034…050 con sus pre-flights; los 128 gastos viejos.
5. Lo anterior (celular real, compra con dos líneas por pantalla, `HON-FAM`/`HON-OTROS`, bloque
   `022`, reversión de manuales, listado de egresos).

---


## Cierre del 21/09/2026 (noche) — Bloque 3: pagos a proveedores, construido y verificado

**SHA de la app en staging: `358f934`** — deployment `dpl_5p2eAQybXh96N35cHjgodjEwWbAf`, READY.
Encima va solo este commit de docs. **`main` sigue en `24b227a`. Producción no se tocó.
Migración `048` aplicada SOLO en staging** (en producción, cuando llegue, la mayoría de las compras
van a nacer como saldos heredados: pre-flight en la 048).

**1072/1072.** `tsc` limpio. Lint: errores preexistentes en Legal e `import-parser.ts`, ninguno
en los archivos del bloque.

### Qué entró (detalle en `changelog.md`, reglas en SOP-032 y CLAUDE.md)

`supplier_payments` con `kind` (pago | saldo heredado), `amount_paid`/`status`/`payment_date`
derivados por trigger + guard, secuencia `CE-`, RPC `reverse_supplier_payment`;
`createSupplierPayment` / delete / reverse con el asiento desde el PAGO; alta "ya pagada" = compra
+ pago; `mark-paid` eliminado (FND-009 cerrado por reemplazo); antigüedad/Mayor/Diario/Estado de
Cuenta; sección "Pagos" en el detalle de la compra; PDF del comprobante de egreso (409 al heredado).
Diario: `pago` = "Cobro", `pago_proveedor` = "Pago a proveedor" (decisión de Oliver).

### Verificado con clic real en el deploy (contador `contador@staging.test`)

Toda la lista del §7 del plan: parcial, rechazo por encima del saldo, saldo precargado, reversar
(vista previa + espejo + compra devuelta), eliminar heredado, Mayor → compra, Diario con `CE-`,
antigüedad, alta "ya pagada" (enviada con `requestSubmit()`), edición como nota, PDF vigente y
reversado, heredado sin botón y 409 por API. Estado de staging al cerrar: CE-000001 reversado
(asiento 30), CE-000002 y CE-000003 vigentes, 2 saldos heredados (el tercero se eliminó),
`documents` con dos `auto_supplier_payment_pdf`.

### Lo que la extensión enseñó hoy

- Los inputs controlados de React no toman `type` por coordenadas cuando la ventana cambió de
  tamaño; el setter nativo + `dispatchEvent('input')` por `javascript_tool` sí. `requestSubmit()`
  dispara el `onSubmit` de React igual que el clic.
- Un clic por `ref` a veces solo enfoca el botón (pasó tres veces): repetirlo, o clic por JS.
- `read_network_requests` empieza a grabar en la primera llamada: llamarlo ANTES del clic.

### Pendiente

1. **Josuarth** (paquete en `task_plan.md`): nombre del documento (`CE-`), excedente de cobros,
   columna Documento del Diario.
2. **FND-010 — bloque propio:** pago del gasto de trámite como entidad (banco + asiento HABER
   banco / DEBE 200001), `amount_paid`/estado en `expenses` con trigger y guard como la 048, y la
   antigüedad por pagar leyendo las dos tablas. Hasta entonces la antigüedad por pagar no cuadra
   contra el mayor en cuanto haya un gasto de trámite contabilizado.
3. Un celular real para el wizard.
4. Lo anterior (compra con dos líneas por pantalla, usabilidad, trámite sin cuenta, mejoras
   contables, `HON-FAM`/`HON-OTROS`, bloque `022`, reversión de manuales y trámite, listado de
   egresos si el bufete lo pide).

---


## Cierre del 21/09/2026 (noche) — Parte B construida: un recibo aplicado a varias facturas

**SHA de la app en staging: `57a6592`** — deployment `dpl_2aDTa19h9rephTQZq6UbVsmn8tRW`, READY.
Encima van solo commits de docs. **`main` sigue en `24b227a`. Producción no se tocó. Sin migración.**

**1036/1036.** `tsc` y lint limpios.

### Qué entró (detalle en `changelog.md`, reglas en SOP-031 §3 y CLAUDE.md)

`createPayment` con `applications[]` (mismo cliente, cap por factura, un asiento de dos líneas,
`reference = REC-`), validador con suma == total y el mensaje del excedente acordado, ruta vieja
como atajo + `POST /api/finanzas/payments`, `repartirPorAntiguedad` puro, Libro Mayor →
`/finanzas/cobros?q=REC-…` para el multi-factura, alta con casillas y reparto editable — y el caso
de una factura sin cambios (una casilla marcada = paso 2 de siempre).

### Verificado con clic real en el deploy (extensión conectada con el perfil de Oliver)

Los cinco puntos que pidió Oliver, más la reversión del multi-factura y el PDF de dos filas. Lista
en el changelog. Estado de staging al cerrar: REC-000001/2/5/7 registrados, REC-000003/4/6
reversados, `last_number` = 7.

### Lo que la extensión enseñó hoy (para la próxima)

- Con la ventana por debajo de `lg`, el listado tiene DOS botones Reversar por fila (tabla oculta
  + card): `find` los devuelve los dos y el de la tabla no hace nada. Clic al segundo.
- Los clics por coordenadas fallan cuando la ventana cambia de tamaño entre capturas (pasó dos
  veces); los clics por `ref` sobre el TEXTO del label (no sobre la casilla) marcan bien.
- `Start-Process chrome.exe` abre un perfil sin la extensión: Chrome lo abre Oliver.

### Pendiente

1. **Josuarth:** ¿dónde va el excedente cuando un cliente transfiere más que sus facturas? (saldo
   acreedor en 100004 o cuenta de anticipos). Desbloquea `amount_unapplied`.
2. Bloque 3 — pagos a proveedores, con las reglas 3 y 4 de Josuarth ya anotadas (parcial SÍ; un
   pago por factura).
3. Un celular real para el wizard (hoy se vio el breakpoint de cards, no un teléfono).
4. Lo anterior (compra con dos líneas por pantalla, usabilidad, trámite sin cuenta, mejoras
   contables, `HON-FAM`/`HON-OTROS`, bloque `022`, reversión de manuales y trámite).

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
