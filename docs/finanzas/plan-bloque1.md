# Plan del Bloque 1: ajustes contables de la revisión de Josuarth

**Estado:** PLAN. No hay código, migraciones ni cambios en ninguna base.
**Fecha:** 2026-09-30 · **Rama:** `feat/bloque1-contable` (local, sin commit), creada desde `develop` (`750319c`).
**Producción:** `main` en `24b227a`. No se tocó.
**Staging:** se leyó en modo solo lectura (`BEGIN READ ONLY … ROLLBACK`), ref `xtyenhakplrkyifbcaow` verificado antes de conectar.

---

## 0. Tres hechos que ordenan todo el plan

**1. En producción el libro está vacío.** Se relevó el 22/09 (`docs/runbooks/despliegue-025-055.md`). Producción se detuvo entre la `024` y la `025`: `journal_entries = 0`, `business_expenses = 0`, no existen `supplier_payments` ni `supplier_credit_notes`, y hay 8 `payments` sin número REC. Por eso:
- **En producción no hay historia contable que reescribir.** Ningún número `CE-` ni `NCP-` se emitió nunca allá.
- Los números emitidos que sí existen en producción son **102 facturas `FAC-HON-`/`FAC-REI-`** (muchas ya autorizadas por la DGI) y **6 notas `NC-`**. Esos no se renumeran.
- Las migraciones del Bloque 1 (`068` en adelante) **se suman a la misma ventana del despliegue 025→067**. Van después de la `067` y antes del merge. El runbook tiene que crecer con ellas.

**2. El libro ya tiene las dos fechas.** `journal_entries.transaction_date` es la fecha contable: define el período, y `post_journal_entry` rechaza un período cerrado (`054:243-288`). `record_date` es la fecha en que se grabó el asiento (`current_date`), y ningún llamador la cambia.
- ⚠️ **Choque de nombres.** La "fecha de registro" de Josuarth es nuestra `transaction_date`, **no** `record_date`. En los documentos la columna nueva se va a llamar `accounting_date`, y en pantalla "Fecha de registro". `record_date` queda como está: es el sello de grabación, y en pantalla nunca se le dice "registro".
- El número de transacción global **ya existe**: `entry_number`. Es un correlativo por bufete, sin huecos, que se asigna con `FOR UPDATE` dentro del RPC (`054:290-305`).

**3. Staging tiene historia y no se reescribe.** Hay 92 asientos, 20 de ellos reversiones. Hay números `REC-000001…9`, `CE-000001…7`, `NCP-000001…3`, `NC-000001…19` y `FAC-HON-000001…24`. Todo lo del Bloque 1 aplica **hacia adelante**: las filas del libro no se actualizan nunca, los triggers de `023` lo impiden y está bien que lo impidan. Lo viejo se muestra resolviendo datos desde el documento de origen, no reescribiendo el asiento.

### Cómo se respeta la inmutabilidad en todo el plan

| Qué se hace | ¿Choca con `023` o con la cadena hash? |
|---|---|
| `ALTER TABLE journal_entries ADD COLUMN …` | No. El DDL no dispara triggers de fila. Las filas viejas quedan en NULL. |
| Nueva versión de la fórmula de `content_hash` (v4) | No. `verify_accounting_chain` verifica `prev_hash` y `hash = sha256(prev_hash‖content_hash)`, pero **no recalcula** `content_hash` (`030:407-437`). Las filas viejas conservan el hash con el que nacieron. La v4 se documenta con fecha en SOP-014, junto a las tres anteriores. |
| `UPDATE` de filas de `journal_entries` o de sus líneas | **No se hace nunca.** Ningún paso del plan lo necesita. |
| Backfill de columnas nuevas en documentos (`invoices`, `expenses`, `credit_notes`) | No choca: T4, T5 y la `038`/`049` congelan **listas explícitas de columnas**, y una columna nueva no está en esas listas. La misma migración la agrega a la lista congelada **después** del backfill. |
| Redefinir los RPC de reversión | Es `CREATE OR REPLACE` de funciones, así que no toca datos. |

---

## 1. Punto por punto: cómo está hoy, qué cambia y en qué archivos

### Punto 1. Fecha de documento y fecha de registro · **L** · riesgo **alto**

> ✅ **E1 construida el 30/09/2026** en la rama (commits locales). Migraciones `068` y `069`
> escritas y **sin aplicar**. Dos ajustes respecto de este plan: (1) `expenses.supplier_invoice_number`
> NO va en la `068`: es del punto 3 y queda para E2; (2) las funciones de la `069` no se copian:
> se parchan sobre su definición vigente con verificación (ver el encabezado de la migración).

**Hoy**

| Documento | Columnas de fecha | Fecha que va al asiento (`transaction_date`) | ¿Quién la elige? |
|---|---|---|---|
| Factura (HON/REI) | `issue_date`, `due_date` | `issue_date` (`asiento-factura.ts:274`) | El usuario en el borrador. Al convertir una cotización se fuerza hoy (UTC, `quotes.ts:1384`) |
| Compra (`business_expenses`) | `expense_date`, `due_date`, `payment_date` (derivada) | `expense_date` (`asiento-compra.ts:250`) | El usuario |
| Gasto de trámite (`expenses`) | `date`, `due_date` | `date` (`asiento-gasto-tramite.ts:194`) | El usuario (hoy UTC por defecto) |
| NC de venta | `issue_date` | `issue_date` (`asiento-nota-credito.ts:62`) | **Forzada a hoy UTC** (`credit-notes.ts:164`) |
| NC de compra | `supplier_document_date`, `issue_date` | `issue_date` | Documento: el usuario. Registro: **hoy, forzado en el RPC ±1 día** (`066:355`) |
| Reversiones (8 RPC) | — | hoy | **Forzada en la base**: `abs(p_transaction_date - current_date) > 1` rechaza (`046:152`, `049:303`, `050:73`, `055:125`, `060:215`, `063:155`, `066:514`; la `067:178` hereda la de la `055`) |

Congelados después de postear: `invoices.issue_date/due_date` (T4, `032`), `credit_notes.issue_date` (T5, `060`), `expenses.date/due_date` (`049:438-442`) y `supplier_credit_notes.*` (`066:118-139`). `business_expenses` no tiene trigger: el único freno es `gateContable` en la app (`business-expenses.ts:129-149`).

🐞 **Bug encontrado de paso:** "hoy" se calcula en **UTC** (`new Date().toISOString().slice(0,10)`) en once lugares: `credit-notes.ts:164,563`, `invoices.ts:1038`, `payments.ts:448`, `supplier-payments.ts:312`, `expense-tramite.ts:255`, `supplier-credit-notes.ts:189,266`, `asientos.ts:64`, `importacion-asientos.ts:191` y dos diálogos. Después de las 7 p. m. de Panamá ya es "mañana": una NC hecha el 30/09 a las 20:00 queda fechada el 01/10. Como el contador ahora va a elegir la fecha, este bug deja de mandar sobre el asiento, pero igual hay que crear **un** `hoyEnPanama()` y usarlo como valor por defecto en todos esos lugares.

**Qué cambia**
- **Columna nueva `accounting_date date NOT NULL`** en `invoices`, `business_expenses`, `expenses` y `credit_notes`. En `supplier_credit_notes`, `issue_date` **ya es** la fecha de registro y `supplier_document_date` la de documento: no se duplica, solo se le quita el candado de "hoy".
- La columna existente pasa a ser la **fecha de documento**, informativa: `issue_date` en facturas y NC de venta, `expense_date` en compras, `date` en gastos de trámite. Sigue siendo la fecha fiscal (la que va a la DGI), la base de la ventana de 182 h y la base del vencimiento.
- **Cada constructor de asiento pasa a usar `accounting_date`** como `transaction_date`: `asiento-factura.ts`, `asiento-compra.ts`, `asiento-gasto-tramite.ts`, `asiento-nota-credito.ts` y `asiento-nota-credito-compra.ts`.
- **Período abierto ANTES de tomar número.** Es la lección de FND-011 y de la cuenta inactiva: `emitInvoice`, `createCreditNote`, `createBusinessExpense` y `postearGastoTramite` verifican el período de `accounting_date` y devuelven 422 sin consumir correlativo. El RPC lo vuelve a verificar igual que hoy.
- **Reversiones con fecha elegida.** La migración redefine los 8 RPC: se va el `±1 día contra current_date` y queda (a) `fecha >= transaction_date del original` (ya existe) y (b) período abierto (ya lo hace `post_journal_entry`). ¿Se permiten fechas futuras? Es la pregunta P-1c. `reversion.ts` recibe la fecha en vez de `hoy`. Los diálogos de reversar suman un campo "Fecha de registro" con `hoyEnPanama()` por defecto: `reverse-payment-dialog.tsx` (que sirve a cobros y pagos), reversar NC, gasto de trámite, asiento manual, importación y anulación de factura.
- **Anular una factura** (`cancel_invoice_with_reversal`, `063:136-155`): el candado "mes de la factura cerrado" hoy mira el mes de `issue_date`. Pasa a mirar el de `accounting_date`, que es el período contable. Hay que confirmarlo (P-1d).
- Formularios: dos fechas en `invoice-form.tsx`, `business-expense-form.tsx`, `section-expense-form.tsx` (Legal), `credit-note-dialog.tsx` y `supplier-credit-notes-section.tsx`. La fecha de registro arranca igual a la de documento y se puede cambiar.
- **Reportes:**
  - El Mayor, el Diario, el Balance y el Estado de Resultado ya leen `transaction_date`, así que no cambian.
  - La **antigüedad** sigue con `due_date`.
  - El **resumen de ITBMS** (`vat-summary.ts`) hoy agrupa por la fecha del documento. Si agrupa por fecha de documento o de registro lo decide Josuarth (P-1a). Es la pregunta más delicada del bloque: si la fecha de registro de una factura cae en otro mes que su emisión ante la DGI, la declaración y el libro dejan de coincidir.
- 🔴 **Regla escrita que se revierte:** el acta del 09/09 ("la reversión lleva SIEMPRE la fecha en que se hace") está en `CLAUDE.md` §5, en `sop.md` y en los tests de reversión. Josuarth la cambia ahora. **Antes de construir hace falta su confirmación por escrito**, y en el mismo commit se cambian `CLAUDE.md`, `sop.md` y los tests.

**Archivos:** `src/lib/finanzas/contabilidad/{asiento-*.ts, reversion.ts, posting.ts}`, `src/lib/finanzas/api/{invoices,credit-notes,business-expenses,expense-tramite,payments,supplier-payments,supplier-credit-notes,asientos,importacion-asientos}.ts`, `src/lib/finanzas/validators/*`, formularios y diálogos citados, `src/lib/finanzas/reports/vat-summary.ts` (según P-1a) y un helper nuevo `src/lib/utils/hoy-en-panama.ts`.

---

### Punto 2. Referencia por módulo, número de documento y número de transacción · **M** · riesgo **medio**

> ✅ **E3 construida el 01/10/2026** en la rama, con la migración **`071`** escrita y **sin
> aplicar** (espera el «aplica»). Ajustes respecto de este punto: `moduloDelAsiento()` y las
> columnas Módulo, N.º documento, N.º transacción y Ref. externa ya están en el Mayor (pantalla
> y Excel) y en el Diario; el **filtro** por módulo queda para E9, como dice la tabla de §4.
> La NC de compra numera `NC-CO-` (P-2e se toma por el valor por defecto). El formato de fecha
> de la importación (decisión (c)) también entró en E3, con MM/DD por defecto.

**Hoy**
- `journal_entries.reference` (`039`, entra en el hash) guarda el número del documento en `factura` (`FAC-HON-…`), `pago` (`REC-`), `pago_proveedor` (`CE-`), `nota_credito` (`NC-`) y `nota_credito_proveedor` (`NCP-`). **Queda vacía en `gasto`, `gasto_tramite` y a veces en `manual`**, donde es texto libre del usuario. Las reversiones copian la referencia del original.
- Los prefijos se arman en TS: `types/invoice.ts:46-55`, `credit-notes.ts:154`, `numbering/receipt-numbering.ts`, `numbering/supplier-payment-numbering.ts`. `NCP-` se arma solo en SQL (`066:446`).
- Las compras y los gastos de trámite **no tienen número interno**, y los asientos manuales tampoco.
- El Mayor filtra solo por cuenta y por fecha, y ni siquiera lee `reference`. El Diario tampoco la lee y arma "Documento" por `source_type` (`diario-general-source.ts:24-34`, congelado por `diario-general.test.ts:121-126`).
- El Excel del Mayor rotula "Número de documento" una columna que en realidad trae `entry_number` (`mayor-export.ts:51,109`).

**Propuesta: separar tres conceptos que hoy están mezclados.** Es el esquema del Libro Mayor de QuickBooks que Josuarth ya usa (Transaction Type · Num · Trans #).

| Concepto | Qué es | Formato | Dónde vive |
|---|---|---|---|
| **Módulo** (tipo de transacción) | Igual en todas las líneas del asiento; es lo que se filtra | `FAC-ING` · `FAC-CO` · `NC-ING` · `NC-CO` · `CO` · `PA` · `AD` · `AP` (apertura) · `CA` (cierre anual) | **No se guarda: se deriva de `source_type`** con una función pura, `moduloDelAsiento()`. Una reversión lleva el módulo de su original y la marca "Reversión". Como se deriva, los 92 asientos de staging lo tienen desde el día uno **sin tocar el libro**. |
| **N.º de documento** | El número propio del documento | `{PREFIJO}-{6 dígitos}` | `journal_entries.reference` (como hoy), obligatorio en todo asiento nuevo |
| **N.º de transacción** | Correlativo global, ordenable | número entero | `entry_number`, que ya existe. Se muestra y se ordena en el Mayor, el Diario y el Excel |

Mapeo `source_type` → módulo: `factura`→FAC-ING, `gasto`→FAC-CO, `gasto_tramite`→FAC-CO (P-2b), `nota_credito`→NC-ING, `nota_credito_proveedor`→NC-CO, `pago`→CO, `pago_proveedor`→PA, `manual`→AD, `apertura`→AP, `cierre`→CA, `reversion`→módulo del asiento que revierte.

**Números de documento nuevos y qué pasa con los ya emitidos**

| Serie | Hoy | Desde el Bloque 1 | Staging (ya emitidos) | Producción |
|---|---|---|---|---|
| Facturas de venta | `FAC-HON-`, `FAC-REI-` | **Se quedan** (recomendado, P-2a). Van impresas y el cliente las cita. HON/REI dice si es tipo 01 o 09. El módulo `FAC-ING` las agrupa para filtrar | Sin cambio | Sin cambio (102 emitidas) |
| NC de venta | `NC-` | **Se queda**, porque es un documento fiscal | Sin cambio | Sin cambio (6) |
| Cobros | `REC-` | **`CO-`**, misma secuencia `payment` | `REC-000001…9` se quedan. El próximo es `CO-000010` | La `047` numera los 8 cobros como REC en la ventana. Opción: renombrarlos a `CO-000001…8` en la misma ventana, porque no tienen asiento ni PDF (P-2c) |
| Pagos a proveedor | `CE-` | **`PA-`**, misma secuencia `supplier_payment` | `CE-000001…7` se quedan. El próximo es `PA-000008` | Nunca hubo CE: arranca en `PA-000001` |
| NC de compra | `NCP-` | **`NC-CO-`**, misma secuencia `supplier_credit_note` | `NCP-000001…3` se quedan. El próximo es `NC-CO-000004` | Nunca hubo NCP: arranca en `NC-CO-000001` |
| Compras | (sin número) | **`FAC-CO-`**, secuencia nueva `purchase` | Las compras viejas quedan sin número interno. En pantalla se muestra el N.º de factura del proveedor | Hay 0 compras: arranca limpio |
| Gasto de trámite | (sin número) | `FAC-CO-` en la misma secuencia, o serie propia `GT-` (P-2b) | Igual que compras | 137 gastos sin asiento: cuando se registren en el libro toman número |
| Asiento de diario | (sin número) | **`AD-`**, secuencia nueva `manual_entry`. **La asigna `post_journal_entry` dentro de la transacción** cuando `source_type IN ('manual','apertura','cierre')`: así una importación de 200 asientos no deja huecos | Los 9 manuales viejos quedan sin AD (en pantalla se ve "Asiento N") | Arranca limpio |

- **Por qué no se reinicia ninguna secuencia:** continuar el contador evita que `CE-000007` y `PA-000007` convivan como dos documentos distintos. El prefijo cambia; el número no se repite nunca.
- **El texto libre del asiento manual** (y el número de cheque o de transferencia de un cobro o un pago, y el N.º de factura del proveedor de una compra) pasa a una columna nueva **`journal_entries.referencia_externa`**. Entra en el hash desde la **v4**. Si Josuarth no quiere referencia libre en los asientos (P-2d), la columna igual sirve para cheques y facturas de proveedor.
- **Filtro:** el Mayor y el Diario ganan un filtro "Módulo" (multi-selección) y una columna "N.º transacción". El loader filtra por `source_type IN (…)`: lo viejo entra en el filtro solo, sin migrar nada.
- ⚠️ Con fechas de registro elegidas (punto 1), el orden por `entry_number` **ya no es** el orden por fecha. Es el comportamiento correcto (el número es el orden de grabación), pero hay que decírselo a Josuarth.

**Archivos:**
- `types/invoice.ts` (sin cambio de prefijo) y `numbering/{receipt,supplier-payment}-numbering.ts`, con sus tests (`receipt-numbering.test.ts`, `supplier-payment-numbering.test.ts`, que congelan `^REC-`/`^CE-` y se actualizan).
- `numbering/purchase-numbering.ts` (nuevo), `api/business-expenses.ts`, `api/expense-tramite.ts`.
- `contabilidad/asiento-{compra,gasto-tramite}.ts`, que ahora llevan `reference`.
- `contabilidad/modulo-del-asiento.ts` (nuevo).
- `reports/{libro-mayor-source,libro-mayor,mayor-export,diario-general-source,diario-general}.ts` y sus tests.
- Los PDF que imprimen el prefijo: `SupplierPaymentDocument.tsx` y el recibo.

---

### Punto 3. Libro Mayor: Nombre, Descripción y N.º de factura del proveedor · **M** · riesgo **bajo**

> ✅ **E2 construida el 30/09/2026** en la rama. La migración del número de factura del proveedor
> en el gasto de trámite tomó el número **070**; las del plan se corren uno: el motor v4 pasa a
> **071**, tasa con cuenta a 072, excedente a 073, NC módulo a 074, plan de cuentas a 075,
> apertura a 076 y cierre anual a 077. La tabla de §2 conserva los números originales como
> referencia del diseño.

**Hoy**
- **Nombre** (`libro-mayor.ts:379-392`) sale en tres escalones: el tercero de la línea, después el de **cualquier** línea hermana (el comentario dice "de la cuenta control", pero el código no filtra por cuenta: bug menor), y por último la descripción de la línea de control, que es un heurístico de texto.
  - El Mayor no muestra al usuario que registró (`created_by` no se lee). Si Josuarth vio un usuario, lo vio en otra pantalla, o el heurístico cayó en la descripción del encabezado. Hay que confirmar la captura (P-3a).
  - 🔴 **La causa de fondo:** los constructores de factura, cobro, NC de venta, compra, gasto de trámite y pago a proveedor **no ponen `client_id`/`supplier_id` en la línea de 100004/200001**. Solo la NC de compra lo hace (`asiento-nota-credito-compra.ts:177`).
- **Descripción:** la del encabezado cuando la línea no tiene descripción propia (`libro-mayor.ts:468-477`). Los constructores escriben descripciones de encabezado en las líneas, no las de las líneas del documento.
- **N.º de factura del proveedor:** en compras existe `business_expenses.supplier_invoice_number` (`044`, opcional), y en el libro solo aparece como texto dentro de la descripción del pago (`asiento-tesoreria.ts:314`). En gastos de trámite **no existe la columna**.

**Qué cambia**
- **Escritura, hacia adelante.** Todos los constructores ponen el tercero en la línea de la cuenta control (y el RPC lo va a exigir: punto 10). En las líneas de ingreso, gasto y costo, `line_description` pasa a ser la descripción de la línea del documento (`invoice_lines.description`, `expense_lines.description`, `credit_note_lines.description`). Las líneas de banco y de ITBMS llevan la descripción del documento.
- **Lectura, para lo viejo.** Nombre = tercero de la línea → **tercero del documento de origen** (`invoices.client_id`, `payments.client_id`, `credit_notes.client_id`, `business_expenses.supplier_id`, `expenses.supplier_id`, `supplier_payments` → compra o gasto) → tercero único del asiento. El heurístico de texto se usa solo si nada de eso resuelve. El Nombre se muestra **en todas las líneas del asiento**, también en la de banco. Las descripciones de los asientos viejos no se reconstruyen: quedan como se grabaron.
- **Factura del proveedor:** columna nueva `expenses.supplier_invoice_number` (y la fecha de documento del punto 1). Congelada al postear. Se guarda también en `referencia_externa` del asiento de la compra o del gasto (punto 2), y el Mayor la muestra en una columna "Ref. externa". Si se vuelve obligatoria es la pregunta P-3b.
- En el Excel del Mayor: el rótulo correcto, más las columnas Módulo, N.º documento, N.º transacción y Ref. externa, con Nombre/RUC/DV como hoy.

**Archivos:** `contabilidad/asiento-{factura,tesoreria,nota-credito,compra,gasto-tramite}.ts` y sus tests, `reports/libro-mayor-source.ts` (`loadDestinosDeOrigen` ya resuelve el documento: se extiende para traer el tercero), `reports/libro-mayor.ts`, `reports/mayor-export.ts`, `reports/diario-general*.ts`, `app/finanzas/reportes/{mayor,diario}/_components/*`, `section-expense-form.tsx`, `api/expenses/route.ts`, `validators` de gasto.

---

### Punto 4. Notas de crédito como módulo propio (venta y compra) · **L** · riesgo **alto**

**Hoy**
- **Venta:**
  - `credit_notes.invoice_id NOT NULL` (`b3c:58`). La NC va por líneas de la factura, con **precio y tasa copiados**: sin monto libre (`validators/credit-note.ts:189-200`).
  - Tope D7: `total ≤ balance_due`, leído **sin candado** (`credit-notes.ts:95`). La base solo exige `credited_total >= 0`.
  - `credited_total` = Σ `grand_total` de las NC `emitida` por `invoice_id` (`051:177-216`), y `balance_due` es GENERATED.
  - Solo existe el detalle `/finanzas/notas-credito/[id]`: no hay listado ni pantalla de alta. Se crea desde el diálogo de la factura (`credit-note-dialog.tsx`).
- **Compra:**
  - `supplier_credit_notes.business_expense_id NOT NULL`, y las líneas apuntan a `expense_line_id NOT NULL` (`066:58,93`).
  - Tope por línea y por documento contra `balance_due`, y CHECK `credited_total <= subtotal + tax_amount` (`066:162`).
  - El RPC `create_supplier_credit_note` numera, postea y **verifica** el asiento contra 200001/200003 (`066:434-442`).
- **DGI:** la NC fiscal (tipo 04) **exige un documento referenciado con CUFE** (`construirReferenciaFiscal`). La DGI lleva su propia cuenta de lo acreditado y rechaza con `[1717]` si se pasa del total de la factura.

**Qué cambia**
- **Pantallas nuevas:**
  - Venta: `/finanzas/notas-credito` (listado) y `/finanzas/notas-credito/nueva`.
  - Compra: `/finanzas/notas-credito-proveedor` (listado) y `/nueva`.
  - Flujo: se elige cliente o proveedor → factura **opcional** de una lista de sus facturas abiertas → si se elige, se cargan sus líneas y todo queda editable (cantidad, precio, gravada o exenta, fecha de registro) → si no se elige, aviso "No estás asociando esta nota a una factura. ¿Deseas continuar?".
  - El botón "Nota de crédito" de la factura se queda y abre la misma pantalla con la factura precargada: **un solo formulario**, con la regla de `payment-form-una-sola-implementacion.test.ts`.
  - Permisos: `route-access.ts`, `nav-config.ts` y `nav-guard.test.ts` se mueven juntos. Venta: admin y abogada. Compra: admin, abogada y contador (igual que hoy).
- **Esquema:**
  - `credit_notes.invoice_id` y `supplier_credit_notes.business_expense_id` pasan a **NULL-able**.
  - Las líneas ganan `service_id` o `chart_account_code`, `description`, `unit_price` y `tax_code_id` propios. Hoy se copian de la factura; ahora se copian **como valor inicial**.
  - `credit_note_lines.invoice_line_id` ya es NULL-able. `supplier_credit_note_lines.expense_line_id` pasa a NULL-able.
- **Aplicaciones, en lugar de "la NC pertenece a una factura".** Tablas nuevas `credit_note_applications (nc, invoice, amount)` y `supplier_credit_note_applications (ncp, business_expense, amount)`, calcadas de `payment_applications`.
  - `invoices.credited_total` pasa a derivarse de **Σ aplicaciones de NC `emitida`**, no de `grand_total` por `invoice_id`. Se reescribe el trigger de la `051` con la misma llave `finanzas.recalc`, y lo mismo en compras (`066`).
  - **Saldo a favor de una NC** = `grand_total − Σ aplicaciones`.
  - **Tope:**
    - Con factura, el tope es lo que la DGI admite: `grand_total − lo acreditado por NC vigentes`. Lo que pase del `balance_due` queda **sin aplicar** (saldo a favor).
    - Sin factura no hay tope.
    - Se mantiene el CHECK `credited_total <= grand_total` y se agrega el que falta en ventas. El tope se valida **con candado** dentro de un RPC, no en la app.
  - **Aplicar el saldo a la siguiente factura** = insertar una aplicación. **No genera asiento:** el crédito ya está en 100004/200001 a nombre de ese tercero. Mismo mecanismo que el punto 5.
- **Asiento:**
  - Con factura: el inverso de la factura por las líneas y montos que quedaron en la NC (`asiento-nota-credito.ts` ya usa `construirAsientoDeFactura` invertido).
  - Sin factura: el mismo constructor sobre las líneas de la NC: ingreso de cada servicio, 200003 o la cuenta de la tasa (punto 6), y 100004 con el cliente.
  - Del lado compra, `create_supplier_credit_note` se redefine: fecha elegida, factura opcional, líneas libres. La verificación del asiento se generaliza, porque hoy compara contra 200003 fijo.
- 🔴 **NC de venta sin factura y la DGI.** Una NC tipo 04 sin documento referenciado **no se puede mandar al PAC**. Una NC que no está autorizada **no resta ITBMS** (regla de `vat-calculo.ts`). Entonces una NC de venta sin factura queda como documento interno: resta en el libro y en la antigüedad, pero no en la declaración. Josuarth tiene que decir si eso le sirve o si del lado de ventas la factura tiene que ser obligatoria (P-4a).
- 🔴 **Reglas escritas que caen:** "una NC se emite por líneas con cantidad, nunca por monto libre" y el tope D7 / A-D6 (`CLAUDE.md` §5, "Nota de crédito contable"). Se reescriben en el mismo commit. Se mantienen: "no NC propia en la anulación" (D5) y la reversión de NC.
- **Anular una factura con NC parcial** (`053`/`063`): no cambia, sigue mirando asientos `nota_credito` vigentes.

**Archivos:**
- `validators/credit-note.ts` (reescrito) y uno nuevo `validators/supplier-credit-note.ts`.
- `api/credit-notes.ts`, `api/supplier-credit-notes.ts`.
- `contabilidad/asiento-nota-credito{,-compra}.ts`.
- `app/finanzas/notas-credito/*`, `app/finanzas/notas-credito-proveedor/*`, el `credit-note-dialog.tsx` (pasa a enlazar a la pantalla) y `supplier-credit-notes-section.tsx`.
- `efactura/orchestration/emit-credit-note-to-efactura.ts`, que corta si la NC no tiene factura.
- `reports/vat-summary.ts`, `reports/antiguedad*.ts`, `route-access.ts`, `nav-config.ts`.

---

### Punto 5. Cobro con excedente y referencia obligatoria · **M** · riesgo **medio**

**Hoy**
- `validators/payment.ts:97-122` exige `amount = Σ aplicaciones` y rechaza el excedente. La misma regla está en `repartir-por-antiguedad.ts:86-121`.
- `payments.amount_unapplied` **ya existe**, con CHECK `0..amount`, y los triggers T7b/T7c lo mantienen (`b3e:571-650`). Hoy siempre queda en 0, salvo 3 cobros viejos de staging que ya lo tienen distinto de 0.
- `reference` es opcional (`payment-form-fields.tsx:267-282`). En staging hay 2 cobros sin referencia.
- El asiento es: debe banco, haber 100004 por el total, **sin cliente en la línea**.

**Qué cambia**
- El validador acepta `amount > Σ aplicaciones`. La diferencia queda en `amount_unapplied`, que ya calculan los triggers.
- En la misma pantalla aparece una advertencia visible antes de guardar: "El cobro supera lo aplicado en B/. X. Queda como saldo a favor de {cliente} en 100004." No es un diálogo aparte.
- El asiento sigue siendo **uno de dos líneas** por el total. El excedente no va a otra cuenta: queda en 100004, ahora con `client_id` (punto 3).
- **Aplicar el saldo a favor:** acción "Aplicar saldo a favor" en el cobro y en la factura nueva. Inserta `payment_applications` de un cobro viejo contra una factura nueva, **sin asiento**. T7a deriva `amount_paid` y el `status` de la factura como siempre. Hay que verificar que T7c acepte aplicaciones insertadas después del alta: es la primera prueba de la entrega.
- La reversión de un cobro (`046`) ya borra **todas** sus aplicaciones y guarda la foto en `payment_reversals`, así que un cobro con parte aplicada a otra factura se reversa entero. Queda como está.
- **Referencia obligatoria:** validador, UI y `CHECK (reference IS NOT NULL AND btrim(reference) <> '') NOT VALID`. `NOT VALID` deja pasar las filas viejas (2 en staging; en producción no se sabe) y obliga a las nuevas. Si Josuarth quiere lo mismo para los pagos a proveedor, se agrega en la misma migración (P-5b).
- Se cierra la pregunta del excedente en `task_plan.md` (decisión 10 de la agenda) y se actualiza `CLAUDE.md` §5 "Recibo de caja" ("🔴 el excedente se RECHAZA").

**Archivos:** `validators/payment.ts`, `cobros/repartir-por-antiguedad.ts`, `components/finanzas/cobros/payment-form-fields.tsx`, `nuevo-cobro-form.tsx`, `register-payment-dialog.tsx`, `api/payments.ts` (con la acción nueva de aplicar), `contabilidad/asiento-tesoreria.ts`, `reports/antiguedad*.ts` y sus tests.

---

### Punto 6. Cada tasa de impuesto con su cuenta · **M** · riesgo **medio**

**Hoy**
- `tax_codes` no tiene cuenta. `CUENTA_ITBMS = "200003"` está **definida dos veces**: en `asiento-factura.ts:76` (haber) y en `asiento-compra.ts:74` (debe, crédito fiscal).
- Las NC la heredan porque invierten esos asientos. El gasto de trámite no usa 200003.
- El formulario de tasas dice "va a 200003" en duro (`tax-codes-manager.tsx:297-299`).
- La NC de compra la verifica en SQL (`066:434-442`).
- El resumen de ITBMS lee documentos, no cuentas, así que no cambia.
- En staging hay 5 tasas, entre ellas `ISC_5` y `PRUEBA_10`.

**Qué cambia**
- **Columna nueva `tax_codes.account_code`**, como FK lógico igual que `suppliers.default_chart_account_code` (`057`). Backfill: `200003` en todas las tasas existentes. `NOT NULL` después del backfill.
- Si hace falta **una cuenta para ventas y otra para compras** (ITBMS por pagar contra ITBMS crédito fiscal), serían dos columnas. Es la pregunta P-6a. Hoy 200003 hace de las dos cosas por decisión del 25/08.
- **Validación:** cuenta activa de tipo `liability` (o `asset` si se usa para el crédito fiscal).
- **La cuenta de una tasa no se cambia después de usarla:** se desactiva la tasa y se crea otra. Motivo: una NC invierte la factura con la cuenta **de hoy** de la tasa. Si la cuenta cambió en el medio, la NC acreditaría una cuenta distinta de la que se debitó. Mismo criterio que "no se cambia el `code` de una cuenta".
- **Constructores:** una línea de impuesto **por cuenta** (hoy es una sola línea a 200003) en `asiento-factura.ts` y `asiento-compra.ts`. Sale `CUENTA_ITBMS` como constante y entra un mapa `tax_code_id → cuenta` que carga el loader. Las NC lo heredan. La verificación de la `066` se generaliza en la migración de la NC de compra (punto 4).
- Alta y edición de tasa: selector de cuenta en `tax-codes-manager.tsx`, `validators/tax-code.ts`, `api/tax-codes.ts` y la ruta POST/PATCH (admin y contador, sin cambio).
- `CLAUDE.md` §5 "Tasas de impuesto — alta" dice "su ITBMS va a 200003: es una constante del asiento". Se reescribe.

---

### Punto 7. Estado de resultado y Balance General · **S** · riesgo **bajo** (solo lectura)

**Hoy**
- `/finanzas/reportes/pyl` usa `estado-resultado-niif18.ts`. Muestra la Utilidad Bruta operativa, la Utilidad Operativa, y las líneas de antes de ISR, ISR y Utilidad Neta solo cuando difieren. Después agrega el bloque **DISTRIBUCIÓN A SOCIAS**, un cálculo que deja el resultado en 0 (`:446-471`).
- Hay un segundo builder, `accounting-reports.ts:348-396`, que alimenta el Balance con `utilidadOperativa` (`:546-554`).
- El Balance acumula desde el inicio, sin corte por año (`balance/page.tsx:40-45`).

**Qué cambia**
- En `estado-resultado-niif18.ts` y `pyl/page.tsx`:
  - Se quita el bloque de Distribución a Socias.
  - La estructura queda: Ingresos − Costos = **Utilidad bruta** → − Gastos (operativos, de inversión y de financiamiento, cada bloque con su subtotal como hoy) = **Utilidad antes de impuesto sobre la renta** → − **Impuesto sobre la renta** → **Utilidad neta**. Las cuatro líneas se muestran siempre.
- **ISR con tasa configurable, en 0 % para Integra** (decisión del 30/09, §7). Hoy existe `DEFAULT_ISR_RATE = 0` en código (`accounting-reports.ts:217`). La tasa pasa a ser un **parámetro del bufete**, que edita admin o contador, y el reporte calcula la línea = utilidad antes de impuesto × tasa. La línea **se muestra siempre**, también en 0.00. Es un cálculo del reporte, no un asiento: si algún día se registra el ISR en el libro, la cuenta y la subcategoría `impuesto_sobre_la_renta` quedan para otro bloque (P-7a sigue abierta, no bloquea).
- En el Balance: "Utilidad Operativa" → "**Utilidad neta**", y `buildAccountingReports` le pasa `utilidadNeta`.
  - ⚠️ Mientras no exista el cierre anual (punto 11), esa utilidad es **acumulada desde el inicio**. Se deja escrito en la pantalla, como hoy.
- Tests: `estado-resultado-niif18.test.ts`, `convergencia.test.ts` y los de `accounting-reports`.
- `CLAUDE.md` y `task_plan.md` §8.6 ("Distribución a Socias pegada a la Utilidad Operativa") se actualizan.
- **No escribe nada:** puede entrar después de que se empiece a cargar, sin riesgo.

---

### Punto 8. Plan de cuentas: subcategorías, Familia y otros ingresos · **M** · riesgo **medio**

**Hoy**
- `SUBCATEGORIAS_POR_TIPO` (`types/chart-of-account.ts:244-260`):
  - asset: corriente, no corriente, PPE, **depreciacion_acumulada**, otro.
  - liability: corriente, no corriente, otro.
  - equity: `patrimonio`, otro.
- Solo es obligatoria en las cuentas de resultado (`requiereSubcategoria`, `:275`, y CHECK `025:259-269` para cuentas activas).
- Patrimonio en staging: 300001 Capital Social, 300002 "Perdida Retenidas", 300003 Utilidad del Ejercicio y 300004 Distribución a Socias, todas con `patrimonio`.
- No hay cuenta de Familia: HON-FAM → 400004 **solo en staging** (`sql/datos-staging/`), y en producción sigue en la 4101 inactiva.
- Tampoco hay servicio ni cuenta de "otros ingresos". HON-OTROS apunta a la 4101 inactiva (decisión 3).
- En producción las cuentas vienen del Excel, no de una migración (97 cuentas). La `025` todavía no corrió allá.

**Qué cambia**
- **Listas nuevas:**
  - asset: activo_corriente, activo_no_corriente, propiedad_planta_equipo, otro. Sale `depreciacion_acumulada`.
  - liability: pasivo_corriente, pasivo_no_corriente, otro.
  - equity: **capital_social, resultados_acumulados, otras_reservas**. Sale `patrimonio`.
- **Obligatoria en los seis tipos:** `requiereSubcategoria` pasa a `true` para todos, y un CHECK nuevo `coa_subcategoria_por_tipo` rige para las cuentas **activas** (las inactivas se dejan como están, igual que en la `025`).
- **Backfill en la migración** con un mapa explícito que da Josuarth (P-8a):
  - Depreciación acumulada → PPE (en el Balance, dentro de PPE como línea restando).
  - Patrimonio → 300001 capital_social, 300002 y 300003 resultados_acumulados, 300004 lo decide Josuarth.
  - Cualquier cuenta activa de balance sin subcategoría: la migración **aborta y la lista**, no inventa.
- `buildBalanceGeneral` (`accounting-reports.ts:408-455`): agrupa el patrimonio por las tres subcategorías, y PPE incluye la depreciación.
- **Cuenta de Familia:** `INSERT … ON CONFLICT DO NOTHING` con el código que confirme Josuarth (propuesta `400009 Derecho de Familia`, ingresos_operativos), y HON-FAM → esa cuenta.
  - ⚠️ En producción eso reemplaza el paso "Reasignar" de P-15 del runbook, y el `sql/datos-staging/2026-09-25_hon_fam_a_derecho_civil.sql` queda obsoleto.
  - L1 (las licenciadas) ya estaría contestada con "separado": hay que confirmarlo (P-8b).
- **Otros ingresos:** cuenta (código y subcategoría de Josuarth, P-8c) + servicio `OTR-ING` (`service_type 'otro'`, ITBMS_7, factura de honorarios tipo 01). También se define HON-OTROS (decisión 3).
- UI: `chart-of-accounts-manager.tsx:486-540`, `validators/chart-of-account.ts:137-153`, el importador de cuentas (`chart-of-accounts/bulk/route.ts`) y `josuar-accounts.fixture.ts`.

---

### Punto 9. Saldos iniciales en pantalla aparte, como asiento de apertura · **M** · riesgo **alto**

**Hoy**
- El saldo inicial vive en `chart_of_accounts.saldo_inicial` + `saldo_inicial_fecha` (`024`, `027`). Se carga dentro de **Importar cuentas**, sin fecha (`bulk/route.ts:162`).
- Los reportes **lo suman encima del libro** (`accounting-source.ts:243-307`), y el Mayor muestra una fila calculada.
- `source_type 'apertura'` ya está permitido desde la `028`, pero nadie lo usa.
- La `056` está **reservada** para corregir la fecha del saldo inicial.
- En staging el saldo cargado no es una apertura: cuentas de balance 244,476.91 y de resultado −244,476.91 (`sop.md:654-665`).

**Qué cambia**
- **Pantalla nueva `/finanzas/saldos-iniciales`** (admin y contador):
  - Fecha de corte y descripción elegidas ("Carga de saldos iniciales al 01/01/2026").
  - Grilla de cuentas con debe/haber. Las líneas contra 100004/200001 exigen tercero (punto 10). Carga por Excel reusando el motor de `import/asientos-import.ts` (K-8).
  - Vista previa que tiene que cuadrar.
  - Contabiliza **un** asiento `source_type = 'apertura'`, módulo AP, número `AD-` asignado en el RPC.
- **Una sola apertura vigente por bufete:** índice único parcial sobre `source_type = 'apertura'`. La unicidad descuenta la apertura reversada, con el mismo criterio que la `063` ("vigente = sin reversión"), porque los índices no ven otras filas: se valida en el RPC con candado.
- `reverse_journal_entry` (`055:143`, hoy solo `manual`) acepta también `apertura`, para corregirla completa.
- **Transición sin doble conteo:** desde que existe una apertura vigente, los loaders **ignoran** `chart_of_accounts.saldo_inicial` (`accounting-source.ts`, `libro-mayor-source.ts`, `antiguedad-source.ts:62-104`). No se ponen en cero: el plan de cuentas no es el libro y los valores sirven de referencia. Importar cuentas deja de aceptar la columna "Saldo inicial". La `056` reservada se **retira** (queda anotado en el runbook).
- **Si el corte es a mitad de año** (el acta dice 30/06/2026), la apertura trae también saldos de ingresos y gastos acumulados al corte. El Estado de Resultado de 2026 los incluye si el rango empieza antes del corte. Hay que sacar la regla `aperturaDeResultado: "excluir"` (`pyl/page.tsx:54`), que existía para el saldo del plan de cuentas.
- `ensure_accounting_periods` solo crea períodos del año corriente y del siguiente (`054:266`). Un corte al 31/12/2025 exige crear antes los períodos de 2025: la pantalla lo hace por la ruta de servicio.
- **Diseño listo para cualquier fecha** (el pedido): la fecha es un campo, no una constante. Lo único que depende de la fecha es qué períodos hay que crear.

---

### Punto 10. Asientos de diario con tercero en 100004 y 200001 · **S** en la validación, **L** en la antigüedad · riesgo **medio**

**Hoy**
- El tercero es opcional en cualquier línea (`054:32-33`, a propósito).
- `armarAsientoManual` (`asiento-manual.ts:340`) no lo exige. La importación (`067`) no tiene columna de tercero.
- `chart_of_accounts.cuenta_control` (`clientes`/`proveedores`) existe pero no la usan ni el motor ni la antigüedad, que tiene los códigos en duro (`antiguedad-source.ts:37-40`).
- La antigüedad se arma desde documentos. Los asientos manuales "explican la diferencia" pero no entran en la tabla (`antiguedad.ts:125-140`).

**Qué cambia**
- **Validación en tres capas:**
  - `armarAsientoManual` y `asientos-import.ts` (columnas nuevas de tercero, identificado por código CLI-/PRV- o por RUC según K-2).
  - El formulario, con el aviso: "Esta línea afecta la antigüedad de {tercero}".
  - **`post_journal_entry` v4**: toda línea contra una cuenta con `cuenta_control` exige el tercero del tipo que corresponde (cliente en `clientes`, proveedor en `proveedores`). Vale **para todos los `source_type`**, y por eso depende de que el punto 3 ya haya arreglado los constructores. Lo viejo no se toca: la regla es del RPC, no un CHECK sobre la tabla.
  - El test `sql/tests/verificacion-054-tercero-por-linea.sql:57-70`, que postea 100004 sin tercero a propósito, se reescribe.
- **La antigüedad pasa a tener cuatro tipos de partida por tercero** (lo comparten los puntos 4, 5, 9 y 10):
  1. Documentos con saldo (facturas, compras, gastos de trámite), por `due_date`, como hoy.
  2. **Partidas de diario y de apertura** con tercero en la cuenta control, por `transaction_date` (no tienen vencimiento). Si la apertura trae detalle por documento (decisión 12), una línea por documento.
  3. **Cobros con excedente sin aplicar**, en negativo.
  4. **NC con saldo sin aplicar**, en negativo.
- El total por tercero puede ser negativo (saldo a favor). Hoy se filtra `balance > 0.005` y se usa `Math.max(0, …)`: eso se cambia.
- **Con esto la antigüedad cuadra contra el mayor por construcción** para todo lo nuevo. La explicación de la diferencia queda solo para lo viejo sin tercero (staging).
- **Archivos:** `reports/antiguedad-source.ts`, `reports/antiguedad.ts`, `app/finanzas/reportes/aging/*`, `api/finanzas/reportes/aging/export/route.ts` (sigue en la lista `EXPORTS` de `nav-guard.test.ts`) y `sql/verificacion/antiguedad_estado_cuenta.sql`.

---

### Punto 11. Cierre anual · **M** · riesgo **medio** · **recomendación: noviembre**

**Hoy** no existe. Los períodos son mensuales y el año fiscal es el calendario (`periodo-fiscal.ts:34`).

**Diseño (para cuando se construya)**
- Asiento `source_type = 'cierre'`, módulo CA, fecha 31/12, número `AD-`. Por cada cuenta de ingreso, costo y gasto: su saldo del año en contra, y la diferencia a **300002**.
- Uno por año: índice único parcial, reversable con `reverse_journal_entry`.
- El Estado de Resultado **excluye los asientos `cierre`** (si no, el año cerrado da 0). El Balance pasa a mostrar la utilidad **del año** y no la acumulada.

**¿Conviene noviembre?** Sí, por cuatro razones:
1. No cambia cómo se guarda nada de lo que se carga en octubre: el primer cierre es el 31/12/2026, y ese asiento se arma sobre lo que haya.
2. Depende de los puntos 7 y 8 (estructura del resultado y subcategoría de patrimonio).
3. Lo único que conviene adelantar es agregar `'cierre'` al CHECK de `source_type` en la misma migración del Bloque 1 que ya toca el motor. Así no se vuelve a tocar el constraint en la ventana de diciembre.
4. Josuarth tiene preguntas abiertas (decisión 15: la distribución a socias, anual o mensual).

---

## 2. Cambios en la base: migraciones en orden

Numeración desde la `068`. La `056` sigue reservada y el punto 9 la retira. Todas van a `sql/pending/`, se prueban en staging con `run-sql.mjs` **solo cuando cierre la ventana de revisión de SOP-019**, y en producción entran en la ventana del despliegue, después de la `067`.

| # | Migración | Qué hace | Inmutabilidad / hash |
|---|---|---|---|
| **068** | `fechas_de_registro` | `accounting_date` en `invoices`, `business_expenses`, `expenses` y `credit_notes`. Backfill = `transaction_date` del asiento de ese documento si existe, si no la fecha del documento (la migración **informa** las que no coincidan). `NOT NULL`. Valor por defecto por trigger. Suma `accounting_date` a las listas congeladas de T4, T5 y `049`. (`expenses.supplier_invoice_number` pasó a E2; el candado de `create_supplier_credit_note` lo quita la `069`) | Backfill sobre documentos, **no sobre el libro**. Se hace antes de agregar la columna a la lista congelada |
| **069** | `reversion_con_fecha_elegida` | `CREATE OR REPLACE` de los 8 RPC: `reverse_payment`, `reverse_supplier_payment`, `reverse_expense_tramite`, `cancel_invoice_with_reversal` (gate de mes → `accounting_date`), `reverse_journal_entry` (+ `apertura`), `reverse_credit_note`, `reverse_supplier_credit_note` y `reverse_journal_import` (recibe la fecha). Sale el `±1 día` | Sin datos. El espejo lo sigue verificando cada RPC |
| **070** | `motor_v4_referencias_y_terceros` | `journal_entries.referencia_externa` (CHECK de largo). `post_journal_entry` v4: hash con `referencia_externa`; número `AD-` para `manual`/`apertura`/`cierre`; tercero obligatorio en cuentas control. CHECK de `source_type` + `'cierre'`. CHECK de `sequence_type` + `purchase`, `manual_entry`. Prefijo `NC-CO-` en `create_supplier_credit_note`. `post_journal_entries_batch` (`067`) no cambia de firma | **Cuarta versión de la fórmula**, con fecha en SOP-014. No toca filas viejas. `verify_accounting_chain` sigue verde porque no recalcula `content_hash` (si algún día se escribe un verificador que sí, tiene que conocer las cuatro versiones por `entry_number` de corte) |
| **071** | `tasa_con_cuenta` | `tax_codes.account_code` + backfill a `200003` + `NOT NULL` | Catálogo, sin libro |
| **072** | `cobro_con_excedente` | `payments_reference_obligatoria` `NOT VALID`. Si T7c no admite aplicaciones posteriores, se ajusta acá | Documentos, sin libro |
| **073** | `nc_modulo_propio` | `invoice_id` / `business_expense_id` NULL-ables. Columnas propias en las líneas. `credit_note_applications` y `supplier_credit_note_applications` con backfill de **una aplicación por NC existente** (15 en staging, 6 en producción, 3 NCP en staging). Reescribe los triggers de `credited_total` (`051`, `066`) para sumar aplicaciones. CHECK `credited_total <= grand_total` en ventas. RPC nuevo de alta de NC de venta con candado. Redefine `create_supplier_credit_note` (líneas libres, tope nuevo, verificación por cuenta de tasa) | Documentos. El backfill tiene que dejar `credited_total` **idéntico** antes y después: la migración lo compara y aborta si una sola factura cambia |
| **074** | `subcategorias_y_cuentas_nuevas` | Listas nuevas, backfill por mapa de Josuarth, CHECK `coa_subcategoria_por_tipo` (activas), subcategoría `impuesto_sobre_la_renta`, cuenta Familia + HON-FAM, cuenta de otros ingresos + servicio. Aborta si queda una cuenta activa de balance sin subcategoría | Catálogo |
| **075** | `asiento_de_apertura` | Candado de una apertura vigente (RPC) + índice | Sin datos |
| 076 (nov.) | `cierre_anual` | RPC `close_fiscal_year` | Asiento nuevo, nada viejo |

**Orden obligatorio entre ellas:** `068` → `069` (usa `accounting_date`) → `070` (el candado de tercero exige que el código de los constructores ya esté desplegado) → `071` → `073` (verifica contra la cuenta de la tasa). `072`, `074` y `075` son independientes y van después de la `070`.

⚠️ **La `070` no se puede aplicar antes que el código que la acompaña.** Con el candado de tercero puesto, el código actual de `develop` (constructores sin `client_id`) **falla al emitir una factura o registrar un cobro**. Es el mismo patrón de la `061`/`064`: base y código en el mismo despliegue, sin nadie operando en el medio.

---

## 3. Datos existentes: qué se migra y qué no

**No se reescribe historia en ningún caso:** ninguna migración hace `UPDATE` ni `DELETE` sobre `journal_entries` o `journal_entry_lines`.

| Dato | Staging | Producción |
|---|---|---|
| Asientos | 92. Se quedan como están: sin tercero en la línea de control, descripción de encabezado, sin `AD-`. El Mayor les resuelve Nombre desde el documento y Módulo desde `source_type` | **0.** Todo lo que se postee va a nacer con el Bloque 1 completo, siempre que las migraciones y el código entren en la misma ventana |
| `FAC-HON`/`FAC-REI` | Sin cambio | Sin cambio (102). `accounting_date = issue_date` |
| `NC-` de venta | Sin cambio. Backfill de 15 aplicaciones | Sin cambio (6). Backfill de 6 aplicaciones |
| `REC-` | Se quedan. Sigue `CO-000010` | La `047` los numera REC en la ventana. Opción de renombrar a `CO-` (P-2c) |
| `CE-` | Se quedan (1…7). Sigue `PA-000008` | Nunca existieron: `PA-000001` |
| `NCP-` | Se quedan (1…3). Sigue `NC-CO-000004` | Nunca existieron: `NC-CO-000001` |
| Saldos iniciales en el plan de cuentas | Se ignoran desde que se postea una apertura. En staging se puede probar sin borrarlos | Igual. La `056` se retira |
| Cobros sin referencia | 2 (quedan, `NOT VALID`) | Desconocido (quedan) |
| Gastos de trámite sin asiento | — | 137. Al registrarse en el libro usan `accounting_date` (backfill = `date`) |

**Recalcular:** solo `credited_total` (073), y el resultado tiene que ser igual al de antes. Nada más se recalcula.

---

## 4. Dependencias y orden de implementación

Cada entrega es una rama propia desde `feat/bloque1-contable`, se prueba en staging y **no se integra a `develop` mientras dure la ventana de SOP-019**.

| Entrega | Contenido | Depende de | Tamaño |
|---|---|---|---|
| **E0** | Preguntas a Josuarth (§7) respondidas por escrito + `hoyEnPanama()` | — | S |
| **E1** | Punto 1: fechas (068 + 069), constructores, formularios, diálogos de reversión | E0 (P-1) | L |
| **E2** | Punto 3 (escritura): tercero y descripción de línea en todos los constructores + `expenses.supplier_invoice_number` | — (puede ir en paralelo a E1) | M |
| **E3** | Punto 2 + punto 10 (validación): 070, `AD-`/`FAC-CO-`/`PA-`/`CO-`/`NC-CO-`, `referencia_externa`, tercero obligatorio | E1, E2 | M |
| **E4** | Punto 6: tasa con cuenta (071) | E3 | M |
| **E5** | Punto 5: excedente, aplicar saldo, referencia obligatoria (072) | E2 | M |
| **E6** | Punto 8: plan de cuentas (074) | E0 (mapa de subcategorías) | M |
| **E7** | Punto 9: apertura (075) | E3, E6 | M |
| **E8** | Punto 4: NC módulo propio (073) | E1, E4, E5 | L |
| **E9** | Punto 3 (lectura) + punto 10 (antigüedad nueva) + filtros del Mayor y del Diario | E3, E5, E8 | L |
| **E10** | Punto 7: reportes | E6 | S |
| **E11** | Punto 11: cierre anual (noviembre) | E6, E10 | M |

**Lo que tiene que estar antes de cargar el primer dato real** (cambia cómo se guarda): E1, E2, E3, E4, E5, E6 y E7. **Lo que puede llegar unos días después sin reescribir nada:** E9 y E10 (son lectura), y E8 si en las primeras semanas no se emiten NC. E11 en noviembre.

⚠️ **Sobre octubre:** E1 a E8 son dos L y seis M. No entran en una semana. Lo realista es una ventana de despliegue (025→075) a mediados o fines de octubre, con Josuarth cargando **después** de esa ventana. Adelantarlo cargando con el código actual obligaría a vivir con asientos sin tercero y con la fecha de hoy en las NC, que es justo lo que el Bloque 1 existe para evitar.

---

## 5. Tamaño y riesgo

| Punto | Tamaño | Riesgo | Por qué |
|---|---|---|---|
| 1 Fechas | L | Alto | Toca todos los constructores y 8 RPC. Revierte una regla del acta. Pregunta abierta sobre el ITBMS |
| 2 Referencias | M | Medio | Motor v4 (hash). Tests que congelan prefijos |
| 3 Mayor | M | Bajo | La escritura es mecánica. La lectura resuelve lo viejo sin tocarlo |
| 4 NC módulo | L | Alto | Cambia la derivación de `credited_total`, el tope de la DGI y el alcance fiscal de la NC sin factura |
| 5 Excedente | M | Medio | Primer uso real de `amount_unapplied`. T7c por verificar |
| 6 Tasa con cuenta | M | Medio | Consistencia NC ↔ factura si cambia la cuenta (se bloquea) |
| 7 Reportes | S | Bajo | Solo lectura |
| 8 Plan de cuentas | M | Medio | CHECK nuevo sobre datos reales de producción. Depende del mapa de Josuarth |
| 9 Apertura | M | Alto | Doble conteo si la transición sale mal. Es irreversible salvo por reversión completa |
| 10 Tercero | S + L | Medio | La validación es chica. La antigüedad nueva es la pieza más grande de lectura |
| 11 Cierre anual | M | Medio | Noviembre |

---

## 6. Plan de prueba en staging por punto

Todas las pruebas corren con clics en el deploy de la rama o en localhost (staging), y con `sql/tests/verificacion-06x-*.sql` para las migraciones (forzando fallas dentro de una transacción, como la `046`). Después de cada una: `verify_accounting_chain` verde y la antigüedad sin partidas nuevas "sin explicar".

1. **Fechas.**
   - Compra con documento 15/09 y registro 01/10 (octubre abierto): el asiento sale con 01/10, en el Mayor en octubre, y en la antigüedad el vencimiento se cuenta desde el 15/09.
   - Con septiembre cerrado, registro 20/09: 422 **sin consumir** `FAC-CO-`. El siguiente número es el mismo.
   - Reversar un cobro con fecha 05/10 (posterior al original): la reversión sale el 05/10.
   - Con fecha anterior al original: rechazo.
   - A las 20:00 de Panamá el valor por defecto es el día de Panamá, no el siguiente.
2. **Referencias.**
   - Un documento de cada módulo. En el Mayor de 100004, filtro Módulo = CO: solo cobros, viejos (`REC-`) y nuevos (`CO-000010`).
   - Un asiento manual toma `AD-000001`.
   - Importar 2 asientos: `AD-000002` y `AD-000003`, sin huecos. Con una fila errónea no se registra nada y el siguiente sigue siendo `AD-000002`.
   - Un pago: `PA-000008`. `N.º transacción` ordenable.
3. **Mayor.**
   - Factura de 2 líneas con descripciones distintas: en el Mayor de ingresos, cada línea con su descripción. En 100004, la del documento. Nombre = cliente en todas las líneas, **también en el banco del cobro**.
   - Un asiento viejo (por ejemplo, un cobro de septiembre) muestra el cliente resuelto desde el documento.
   - Compra con factura del proveedor `F-123`: "Ref. externa F-123" en 200001 y en la línea de gasto.
4. **NC.**
   - Factura 100 cobrada en 60 (saldo 40), NC por 70 desde la pantalla nueva: se aplican 40 a la factura (saldo 0) y quedan 30 de saldo a favor. Antigüedad del cliente: −30. Mayor: 100004 haber 70 con cliente.
   - NC por 110: rechazo (tope de la DGI).
   - NC sin factura: aviso, se registra, no ofrece "Enviar a la DGI" (según P-4a).
   - Aplicar los 30 a una factura nueva de 50: saldo 20, **sin asiento nuevo**.
   - Mismo recorrido del lado compra.
5. **Excedente.**
   - Cobro de 1,500 sobre facturas por 1,400: advertencia en la pantalla. REC/CO con `amount_unapplied = 100`. Asiento: banco 1,500 / 100004 1,500 con cliente. Antigüedad: −100.
   - Aplicar a la siguiente factura: saldo baja 100, sin asiento.
   - Sin referencia: rechazo.
   - Reversar el cobro: las dos facturas vuelven a su saldo.
6. **Tasa con cuenta.**
   - Crear `ITBMS_10` con cuenta 200005 y facturar con ella: 200005 haber, 200003 intacta.
   - Factura mixta 7 % y 10 %: dos líneas de impuesto.
   - NC de esa factura: debita las mismas dos cuentas.
   - Cambiar la cuenta de una tasa usada: rechazo.
7. **Reportes.**
   - Estado de Resultado sin el bloque de socias, con las cuatro utilidades. Con una cuenta ISR con movimiento: la utilidad neta la resta.
   - Balance dice "Utilidad neta" y cuadra.
8. **Plan de cuentas.**
   - Crear un activo sin subcategoría: rechazo.
   - "Depreciación acumulada" ya no se ofrece, y la 112001 aparece dentro de PPE en el Balance.
   - Patrimonio agrupado en tres.
   - Facturar HON-FAM: ingreso en la cuenta de Familia.
   - Facturar OTR-ING: su cuenta.
9. **Apertura.**
   - Cargar apertura al 01/01/2026 que cuadre: asiento AP con `AD-`. El Mayor deja de mostrar la fila calculada y arranca con el asiento. El Balance **no duplica** (se compara contra la foto de antes).
   - Una segunda apertura: rechazo.
   - Reversar la apertura: los saldos vuelven a cero.
   - Las líneas de 100004 por cliente aparecen en la antigüedad por `transaction_date`.
10. **Tercero.**
    - Asiento manual contra 100004 sin tercero: rechazo en el formulario **y** por RPC (llamada directa en `sql/tests`).
    - Con tercero: aviso, y la partida aparece en la antigüedad de ese cliente.
    - Diferencia antigüedad ↔ mayor para lo nuevo: 0.
11. **Cierre** (noviembre): cerrar 2026 en un staging con datos. Resultado en 0 por cuenta, 300002 con la utilidad. Estado de Resultado 2026 igual al de antes del cierre. Balance 2027 arranca con la utilidad en patrimonio.

---

## 7. Preguntas para Josuarth antes de construir

### Respuestas de Josuarth (por escrito en la revisión del 28/09 y en la reunión del 30/09/2026)

| # | Respuesta | Qué cambia en el plan |
|---|---|---|
| **P-1a** ✅ | **El resumen de ITBMS va por fecha de registro** (`transaction_date`). | `vat-summary.ts` / `vat-calculo.ts` agrupan facturas, compras, gastos de trámite y NC por `accounting_date`, no por la fecha del documento. Cambia meses viejos solo si fecha de documento y de registro difieren, y en lo existente no difieren (backfill de la `068`). `CLAUDE.md` «Resumen de ITBMS» se corrige en E1. |
| **P-1d** ✅ | **Confirmado.** Reversiones, anulaciones y notas dejan de llevar siempre la fecha de hoy: el contador elige la fecha de registro, siempre en un período abierto. Por defecto, la pantalla propone **hoy en Panamá**. | Regla ya anotada en `CLAUDE.md` («Regla de la fecha de registro») como decisión **pendiente de implementar** (E1). Se sigue exigiendo que la reversión no sea anterior al original. `hoyEnPanama()` es el valor por defecto de todos los campos de fecha de registro. |
| **P-2a** ✅ | **Se quedan las series `FAC-HON` y `FAC-REI`.** `FAC-ING` es solo el tipo de transacción calculado para filtrar. | Confirma la opción recomendada del punto 2. Ninguna secuencia de venta cambia. |
| **P-6a** ✅ | **Una cuenta por tasa, la misma para ventas y compras.** | Una sola columna `tax_codes.account_code` (`071`), no dos. |
| **P-2b** ✅ (01/10) | **El gasto de trámite usa `FAC-CO`, igual que las compras.** Lo distingue la cuenta 130003 y el caso. | Una sola secuencia `purchase` para `business_expenses` y `expenses`; módulo `FAC-CO` para `gasto` y `gasto_tramite`. Hecho en E3 (`071`). |
| **P-2c** ✅ (01/10) | **Los 8 cobros de producción se quedan como `REC-`.** No se renumeran documentos entregados. Desde E3 los nuevos salen `CO-`. | La `047` sigue numerando `REC-` en la ventana; la secuencia `payment` no se reinicia y el siguiente es `CO-000009`. |
| **P-2d** ✅ (01/10) | **Sí: el asiento de diario lleva una referencia libre opcional**, además de su `AD-`. | `journal_entries.referencia_externa` (`071`). El `AD-` lo pone el motor; el texto libre va a la referencia externa (formulario e importación). |
| **Nombre** ✅ (01/10) | **Sin tercero en la línea de control, la celda Nombre queda vacía.** | Se retira el cuarto escalón de `nombreDelTercero` (el texto de la línea). Hecho en E3. |
| **200001 sin proveedor** ✅ (01/10, Oliver) | **No se aceptan líneas en la 200001 sin proveedor.** Una compra sin ficha sólo se permitiría de contado (banco directo, sin tocar 200001); si toca 200001, el proveedor es obligatorio. | Hoy TODA compra y todo gasto de trámite acreditan 200001 (el pago es la segunda transacción), así que en E3 el proveedor pasa a ser **obligatorio** en compras y gastos de trámite, en los formularios, las rutas, los constructores y el motor (la `071` ya no exime `gasto`, `gasto_tramite` ni `pago_proveedor`). Reemplaza el «sin proveedor no se bloquea» de SOP-033. **El camino de contado sin proveedor no existe todavía**: queda propuesto abajo (P-2f). |
| **Caso cerrado** ✅ (01/10) | **Se permite cargar el gasto de trámite en un caso cerrado, con un aviso visible antes de guardar:** «Este caso está cerrado. ¿Deseas registrar el gasto igual?». | Entró en E3: pregunta en pantalla en `section-expense-form.tsx` (las dos secciones del caso). No bloquea en el servidor. |

**Tres decisiones más (30/09):**
- **(a) Número de documento en el encabezado de toda factura, automático o manual.** Venta: automático (`FAC-HON`/`FAC-REI`, como hoy). Compra y gasto de trámite: **el N.º de la factura del proveedor, manual, en el encabezado** (`business_expenses.supplier_invoice_number` ya existe; `expenses.supplier_invoice_number` es nuevo en la `068`), además del interno `FAC-CO-` automático. Queda por definir si el manual es obligatorio y único por proveedor (P-3b, no bloquea).
- **(b) Línea de ISR en el Estado de Resultado con tasa configurable, en 0 % para Integra.** Ver punto 7: parámetro del bufete, línea siempre visible.
- **(c) La importación de asientos acepta MM/DD/AAAA y celdas con formato de fecha de Excel.** Las celdas con formato de fecha ya se leen como fecha. ⚠️ **MM/DD/AAAA choca con DD/MM/AAAA, que hoy también se acepta:** `03/04/2026` es 3 de abril en uno y 4 de marzo en el otro, y adivinar mal fecha un asiento en otro mes sin error. Propuesta para E3: un selector **«Formato de fecha del archivo»** (DD/MM o MM/DD) en la pantalla de importación, con MM/DD por defecto si Josuarth lo usa así. Las fechas ISO (`AAAA-MM-DD`) y las celdas de fecha no dependen del selector. Una fecha imposible en el formato elegido (`13/25/2026`) sigue siendo error por fila. Archivos: `import/asientos-import.ts` y la plantilla descargable.

**Quedan abiertas y bloquean solo P-4a y P-8a** (van a Josuarth hoy, 30/09; el Excel de P-8a es `03_Documentos/Adjuntos para Josuarth/subcategorias-cuentas-balance.xlsx`). El resto de §7 no bloquea: se construye con el valor por defecto que dice cada punto y se ajusta con la respuesta.

### Preguntas

**Fechas**
- **P-1a.** ✅ Respondida (arriba).
- **P-1b.** ¿La fecha de registro puede ser **anterior** a la del documento? (Una compra que llega en octubre con factura de septiembre y septiembre ya cerrado es el caso normal al revés.)
- **P-1c.** ¿Se permiten fechas de registro futuras (dentro de un mes abierto)?
- **P-1d.** ✅ Respondida (arriba). Sigue abierto, sin bloquear: la regla "anular solo dentro del mes", ¿se mide con la fecha de registro?
- **P-1e.** ¿El vencimiento se cuenta desde la fecha del documento?

**Referencias**
- **P-2a.** ✅ Respondida (arriba): se quedan `FAC-HON` y `FAC-REI`.
- **P-2b.** Gasto de trámite: ¿`FAC-CO` como las compras, o módulo propio (`GT`)?
- **P-2c.** Los 8 cobros de producción: ¿`REC-000001…8` o `CO-000001…8`?
- **P-2d.** Además de `AD-`, ¿el asiento de diario lleva una referencia libre? ¿Las reversiones se filtran con el módulo del original o con uno propio?
- **P-2e.** ¿Le sirven los códigos `NC-ING` / `NC-CO` y el prefijo `NC-CO-` para las NC de compra?

- **P-2f.** (propuesta, 01/10) **Compra de contado sin ficha de proveedor.** Diseño sugerido: el
  asiento de la compra acredita el BANCO en vez de 200001 (un solo asiento, `FAC-CO-`), y el
  documento queda pagado con un pago de `kind = 'contado'` en `supplier_payments` (número `PA-`,
  banco, sin asiento propio), para que `amount_paid`, `status` y `balance_due` sigan saliendo del
  mismo trigger de la `048`. Implica: CHECK de `kind`, que un pago `contado` no se pueda eliminar
  ni reversar por separado (se reversa la compra entera), y decidir si la NC de compra aplica.
  Tamaño M. ¿Hace falta, o alcanza con crear la ficha del proveedor?

**Mayor**
- **P-3a.** ¿En qué pantalla vio el nombre del usuario en lugar del tercero? (El Mayor no lo muestra.)
- **P-3b.** ¿N.º de factura del proveedor obligatorio en compras y gastos de trámite? ¿Único por proveedor?

**Notas de crédito**
- **P-4a.** 🔴 **Abierta, bloquea E8.** Una NC de venta sin factura no se puede mandar a la DGI (tipo 04 exige la factura referenciada), así que no resta ITBMS. ¿Se permite igual, como documento interno, o del lado de ventas la factura es obligatoria?
- **P-4b.** Con factura, ¿el precio de una línea puede subir sobre el de la factura? ¿Cambiar de gravada a exenta es para corregir un error de la factura?
- **P-4c.** El saldo a favor, ¿se aplica siempre a mano ("Aplicar saldo a favor") o automático a la siguiente factura? ¿Hay devoluciones de dinero (salida de banco contra 100004)?

**Cobros**
- **P-5a.** En la antigüedad, ¿el saldo a favor va como columna aparte o en el tramo corriente?
- **P-5b.** ¿Referencia obligatoria también en los pagos a proveedores?

**Tasas**
- **P-6a.** ✅ Respondida (arriba): una cuenta por tasa. Sigue abierto, sin bloquear: ¿qué cuenta lleva `ISC_5`? (Por defecto, 200003 como hoy.)

**Reportes y plan de cuentas**
- **P-7a.** La línea de ISR ya está decidida (tasa configurable, 0 %). Abierto, sin bloquear: si algún día se registra el ISR en el libro, ¿en qué cuenta? ¿La 300004 se desactiva?
- **P-8a.** 🔴 **Abierta, bloquea E6.** Mapa de subcategorías para **todas** las cuentas activas de activo, pasivo y patrimonio: va en `subcategorias-cuentas-balance.xlsx` (30/09). ¿Dónde va la 300004?
- **P-8b.** Código y nombre de la cuenta de Familia. ¿Las licenciadas ya confirmaron que va separada (L1)?
- **P-8c.** Código, nombre y subcategoría de la cuenta de otros ingresos. ¿Lleva ITBMS? ¿HON-OTROS va ahí?

**Saldos iniciales y tercero**
- **P-9a.** Fecha de corte (decisión 4). Si es a mitad de año, ¿la apertura trae ingresos y gastos acumulados?
- **P-9b.** Detalle de 100004/200001: ¿por documento (decisión 12) o un saldo por cliente o proveedor?
- **P-10a.** En la importación, ¿el tercero se identifica por código (CLI-/PRV-) o por RUC (K-2)?

**Cierre anual**
- **P-11a.** Confirmar 300002 (hoy se llama "Perdida Retenidas": ¿se renombra a Resultados acumulados?), la fecha 31/12 y si la distribución a socias es un asiento aparte.

---

## 8. Requisitos antes de producción (agregados el 01/10/2026)

### R-1. 🔴 Un verificador que RECALCULE el `content_hash` de cada asiento

**Pedido de Oliver (01/10/2026):** que el verificador detecte si alguien modificó el contenido
de una fila, no solo si se rompió el encadenamiento. **Requisito antes de producción. No está
construido: esto es la propuesta.**

**Cómo está hoy.** `verify_accounting_chain(tenant)` (`030`) recorre los asientos por
`entry_number` y comprueba dos cosas: que `prev_hash` sea el `hash` del anterior y que
`hash = sha256(prev_hash || content_hash)`. **Nunca recalcula `content_hash` desde las
columnas.** Consecuencia: si alguien con acceso directo a la base (con los triggers de la `023`
desactivados, o como dueño de la tabla) cambia un monto, una cuenta, una fecha o un tercero y
deja `content_hash` como estaba, la cadena sigue verde. Hoy lo único que protege el contenido
son los triggers de inmutabilidad.

**Lo que ya se midió (solo lectura, staging, 01/10):** `sql/verificacion/recalculo-content-hash.sql`
recalcula los 98 asientos con las cuatro fórmulas de SOP-014. **Todos se reproducen**, y la
versión que coincide es monótona en el correlativo: v1 = 1 a 11, v2 = 12 a 49, v3 = 50 a 98,
ninguno sin versión. O sea que el recálculo es viable sin falsos positivos sobre lo que existe.
(Los asientos 99 a 101 del recorrido de E3 ya son v4.)

**Propuesta**

1. **Columna `journal_entries.hash_version smallint`** (migración nueva). El motor la escribe en
   cada asiento nuevo (4 desde la `071`; 5 si algún día cambia la fórmula). Para los viejos NO se
   hace UPDATE (los triggers de la `023` lo impiden y está bien): se crea una tabla de cortes
   **`accounting_hash_versions(tenant_id, version, desde_entry_number, hasta_entry_number)`**,
   sembrada UNA vez con el diagnóstico de arriba, que la migración verifica antes de grabar (si un
   asiento no coincide con la versión de su tramo, aborta).
2. **`verify_accounting_chain` v2** (misma firma, más filas de salida): además de lo de hoy,
   recalcula el `content_hash` con la fórmula de la versión del asiento (columna, o tramo si es
   viejo) y devuelve `contenido_alterado` cuando no coincide. Una función por versión
   (`contenido_v1(...)` … `contenido_v4(...)`), puras, y el motor pasa a usar **la misma**
   `contenido_v4` para calcular al postear: una sola implementación, como `reversion.ts`.
3. **Costo:** O(asientos + líneas), una pasada. Con miles de asientos es una consulta de
   segundos; se corre bajo demanda (botón del contador o antes de cerrar un período), no en cada
   posteo.

**Lo que implica y hay que decidir**

- ⚠️ **Lo que NO detecta igual:** la fórmula concatena con `|` y `:` **sin escapar**. Un cambio
  que mueva texto entre dos campos libres contiguos (por ejemplo, pasar un `|` de la descripción
  a la referencia) puede producir la misma cadena y pasar. Es una debilidad de la fórmula desde
  la `028`, no del verificador. Se corrige sólo para adelante con una **v5** que codifique los
  campos sin ambigüedad (JSON canónico o prefijo de largo). Recomiendo hacer la v5 en la misma
  migración, porque producción todavía tiene el libro vacío: todo lo real nacería con v5.
- ⚠️ **Lo que el hash nunca cubre:** `idempotency_key` y `created_by` no entran (decisión de la
  `039`); una alteración ahí no se detecta. El nombre de la cuenta tampoco: se hashea el CÓDIGO
  (inmutable por regla de la app).
- 🔴 **Detectar no es impedir.** Un recálculo que encuentra una fila alterada no dice cuál era el
  valor original. Para eso hace falta un respaldo externo (el de la tarea «Respaldo Base
  Integra») con el que comparar. El verificador es la alarma, no la reparación.
- **Tamaño:** S en SQL (cuatro funciones de contenido + la v2 del verificador + la tabla de
  cortes), M si se suma la v5. Sin cambios de pantalla, salvo el botón si se quiere.

### R-2. Develop queda incompatible con staging desde la `071`

Ver `task_plan.md` y el runbook: desde el 01/10 los deploys de Preview de `develop` (que apuntan
a staging) no pueden emitir facturas, cobros, compras, gastos de trámite, NC de venta, pagos a
proveedor ni asientos manuales. Se resuelve cuando la rama se mezcle.

## Cierre

**Qué se revisó**
- `CLAUDE.md`, la agenda y las notas de la revisión de Josuarth, el inventario de migraciones y el runbook del despliegue (estado real de producción al 22/09).
- Las migraciones `023`–`067` que tocan el motor, las reversiones, las NC, los cobros y los pagos, y los constructores de asiento, loaders y reportes de `src/lib/finanzas`.
- Staging en solo lectura: secuencias, asientos por `source_type`, referencias, plan de cuentas, tasas, períodos, cobros y NC.

**Orden propuesto:** E0 (respuestas) → E1 fechas ∥ E2 escritura del Mayor → E3 motor v4 + referencias + tercero → E4 tasas ∥ E5 excedente ∥ E6 plan de cuentas → E7 apertura → E8 NC → E9 antigüedad y Mayor → E10 reportes. Una sola ventana de despliegue en producción (025→075). E11 (cierre anual) en noviembre.

**Preguntas abiertas:** al 30/09 Josuarth ya respondió P-1a, P-1d, P-2a y P-6a, y tomó tres decisiones más (número de documento en el encabezado, ISR con tasa configurable, fechas MM/DD/AAAA en la importación). **Bloquean solo P-4a (E8) y P-8a (E6)**, que van hoy. E1 puede empezar.
