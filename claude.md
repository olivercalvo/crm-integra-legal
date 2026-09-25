# CLAUDE.MD — CRM INTEGRA LEGAL

## 1. PROYECTO
**Nombre:** CRM Integra Legal
**Descripción:** CRM web multi-tenant, mobile-first, para bufetes de abogados. MVP para Integra Legal (Panamá). Gestión de clientes, expedientes, gastos, tareas y documentos con acceso por roles y soporte offline-first.
**Repositorio:** https://github.com/olivercalvo/crm-integra-legal
**Hosting:** Vercel (producción)
**Fecha inicio:** 2026-04-02

## 2. STACK TECNOLÓGICO
- **Frontend:** Next.js 14 (App Router), TypeScript, Tailwind CSS, shadcn/ui
- **Backend/DB:** Supabase (PostgreSQL + Auth + Storage + RLS + Realtime)
- **Deploy:** Vercel
- **Offline:** IndexedDB (cola persistente) + sync automática con resolución de conflictos
- **Testing visual:** Playwright MCP

## 3. ARQUITECTURA
- **Multi-tenant:** Row Level Security (RLS) con `tenant_id` en todas las tablas desde día 1
- **Offline-first:** Toda operación de escritura pasa por cola local (IndexedDB) → sync al reconectar → resolución de conflictos por timestamp → CERO pérdida de datos garantizada
- **Auth:** Supabase Auth (email + password), sesión de 8 horas, "Recordarme" guarda solo usuario
- **Storage:** Supabase Storage para documentos adjuntos (PDF, Word, imágenes, escaneos)
- **Audit log:** Tabla `audit_log` registra TODA operación CRUD en todas las entidades (usuario, timestamp, entidad, campo, valor anterior, valor nuevo)

## 4. ROLES Y PERMISOS
| Rol | Permisos |
|-----|----------|
| **Administrador** | Todo + gestión de usuarios y catálogos + importación masiva |
| **Abogada** | CRUD clientes, expedientes, tareas, gastos, documentos, comentarios, importación masiva. 🔒 **NO puede:** asientos manuales de diario (`/finanzas/asientos`) ni cerrar o reabrir períodos contables (`/finanzas/periodos`) — las dos son admin y contador, las dos únicas rutas de `/finanzas` cerradas para ella, y salen por `ADMIN_CONTADOR_ONLY_PREFIXES` ni reclasificar la clasificación contable de una cuenta. El criterio es el mismo en los dos: la guía de RM dice que eso es del contador, y un asiento manual escribe directo en el libro **sin documento que lo respalde** — si no puede lo menos, no puede lo más |
| **Contador** | Rol especializado en cierre contable. Entra SOLO a `/finanzas`, y dentro de él a seis subárboles: **Reportes** (`/finanzas/reportes/*`), **Gastos del Bufete** (`/finanzas/gastos-bufete/*`, con CRUD completo, y desde el 21/09/2026 eso incluye **registrar, eliminar y reversar pagos a proveedores** y bajar el comprobante de egreso `CE-` — `MUTATING_ROLES` de `…/business-expenses/[id]/payments` y `…/supplier-payments/[id]/*`), **Proveedores** (`/finanzas/proveedores/*`, con CRUD completo — de ahí salen el RUC y el DV de los anexos de renta, y el plazo con el que la antigüedad calcula vencimientos; ampliado el 02/09/2026) y **Configuración** (`/finanzas/configuracion/*` — Plan de Cuentas e Impuestos) y **Asientos de Diario** (`/finanzas/asientos`, agregado el 03/09/2026 — carga manual de ajustes, depreciaciones, provisiones y aportes) y **Períodos Contables** (`/finanzas/periodos`, agregado el 03/09/2026 — cerrar un mes hace que el motor rechace todo asiento con esa fecha; reabrir lleva su propia confirmación). Más **dos DETALLES de documento sueltos**, los dos de SOLO LECTURA, porque auditar el mayor es llegar al documento: **factura** (`/finanzas/facturas/{id}`) y **gasto de trámite** (`/finanzas/gastos-tramite/{id}`, agregado el 03/09/2026). En los dos, el listado, crear y editar siguen cerrados. **Desde el 21/09/2026 entra también al LISTADO de cobros** (`/finanzas/cobros`, patrón exacto en `CONTADOR_FINANZAS_ALLOWED_PATTERNS`; Josuarth: "el contador SÍ debe ver la pantalla de Cobros" — es material de conciliación), **en solo lectura**: baja el PDF del recibo (`GET /api/finanzas/payments/[id]/pdf`, mismos roles que el PDF de la factura) y reversa, pero NO registra (`/finanzas/cobros/nuevo` le rebota y `POST /api/finanzas/invoices/[id]/payments` le responde 403). **Con UNA excepción en el detalle de factura, desde el 17/09/2026: el botón "Reversar" de un cobro contabilizado** (`POST /api/finanzas/payments/[id]/reverse`, bandera `canReverse` separada de `canMutate`). Es el único botón de mutación que ve ahí, y lo tiene por el mismo criterio de RM que le da los asientos manuales: corregir el libro es su trabajo. NO registra ni elimina cobros (eso sigue siendo `canMutate`, admin y abogada). 🔒 **El de gasto de trámite es una puerta al módulo Legal, al que el contador NO entra**, así que su alcance está recortado: muestra el gasto (monto, líneas, cuentas, fecha, proveedor con RUC y DV, vencimiento, comprobante) y **del caso solo el NÚMERO** — nada de descripción, partes, documentos, notas ni historial. El recorte vive en el `select` de `queries/expense-tramite.ts`, NO en el JSX, para que el dato confidencial no salga de la base; lo fija `gastos-tramite-privacidad.test.ts`. Ampliarlo es una decisión de política del bufete, no un cambio de pantalla. **Edita** la clasificación contable de una cuenta (`account_type`, `subcategoria`) y las tasas de impuesto: es el criterio de la guía de RM, "quien modifica la clasificación contable de una cuenta debe ser el contador", y por eso la abogada NO puede. **NO puede:** facturas, cotizaciones, ni nada del módulo Legal. Su home es `/finanzas/reportes`. Acceso a `/finanzas/configuracion` ampliado el 01/09/2026 — antes el menú se lo ofrecía y el middleware lo rebotaba |
| **Asistente** | **Alcance reducido el 24/08/2026 por decisión del cliente.** Ve SOLO tres pantallas: Dashboard (`/legal`), Casos (`/legal/casos` — todos los del bufete, SOLO LECTURA) y Mis Pendientes (`/legal/pendientes`). Dentro de un caso puede hacer exactamente dos cosas: **subir documentos y comentar**. **Sigue cumpliendo tareas** desde Mis Pendientes — pero solo las asignadas a él, y no las crea: crear/asignar tareas es admin/abogada (`POST /api/tasks` le responde 403). Si necesita dejarse un recordatorio en un caso, usa un comentario. Ve la ficha de un cliente puntual (`/legal/clientes/{id}`, solo lectura) pero NO el directorio de Clientes. **NO puede:** ver ni registrar gastos (`/legal/gastos` le rebota, el tab Gastos del caso no se le renderiza y `/api/expenses` le responde 403), cambiar el estado de un caso (el `CaseStatusChanger` no se le renderiza y `PATCH /api/cases/[id]` le responde 403 incluso con `action="change-status"`), editar/crear/borrar casos ni clientes, **crear ni asignar tareas** (ni de caso ni pendientes personales de otra persona), acceder a Finanzas |

> **Los permisos se hacen cumplir en el servidor, no en el menú.** Cada restricción de
> arriba tiene su gate real: las reglas de ruta viven en **`src/lib/auth/route-access.ts`**
> (fuente única que consume `middleware.ts`), y los permisos por operación en `requireRole()`
> dentro de los handlers de `/api`. Si alguna vez se amplía o recorta un rol, hay que mover
> **esta tabla, `route-access.ts` y los guards de la API juntos** — tocar solo `nav-config.ts`
> esconde el botón pero deja el permiso abierto.
>
> 🔒 **Hay un test que lo verifica:** `src/lib/auth/__tests__/nav-guard.test.ts` cruza el
> sidebar contra las reglas de ruta y falla si se separan, en los dos sentidos — un ítem de
> menú que rebota, o una pantalla accesible que el menú no muestra. Existe porque el
> 01/09/2026 se encontraron cuatro desajustes a la vez, incluido `/legal/importar`
> (importación masiva) abierto al asistente sin ningún gate. Antes, detectarlos dependía de
> que una persona recorriera el menú con cada rol.
>
> 🔗 **Y también los enlaces DENTRO de las pantallas**, que es donde se coló el siguiente: el
> ícono del Libro Mayor abría `/finanzas/facturas/{id}`, que el contador no podía ver. El test
> cubre los enlaces a documentos (`destino-documento.ts`) y los `href` literales del JSX. Si un
> enlace ya está gateado y el test no puede verlo —está en un condicional, o el archivo hace un
> early return por rol— se declara en el lugar con un comentario `nav-guard-ok: <motivo>`.
>
> ⚠️ **Ocultar el botón NO reemplaza al 403 de la API, y el 403 no reemplaza a ocultar el
> botón.** Los dos hacen falta: el guard del servidor es el permiso, y esconder la acción que
> el rol no puede ejecutar es lo que evita que apriete algo que le va a fallar.

## 5. REGLAS DE DESARROLLO (NON-NEGOTIABLE)

### Git
- Siempre trabajar en branch `develop`; `main` es producción con auto-deploy
- **NUNCA** push/merge a `main` sin aprobación explícita de Oliver
- Auto-commit a GitHub después de cada cambio de código
- Linting antes de commits; diff review antes de merge a main
- `.env` NUNCA se commitea; lock files SIEMPRE se commitean

### Archivos .md
- Actualizar después de cada cambio de código:
  - `changelog.md` → SIEMPRE
  - `sop.md` → si cambió lógica
  - `productdesign.md` → si cambió feature
  - `task_plan.md` → progreso

### Pausa obligatoria antes de:
- Merge a main
- Cambios de schema en DB producción
- Cambios de env vars en producción
- Eliminación de datos

### Self-Annealing (ciclo de reparación)
Analyze → Document en `findings.md` → Patch → Test → Update SOP → Commit

### Playwright MCP
- ANTES y DESPUÉS de cada cambio: abrir navegador, navegar a localhost:3000, verificar que la app funciona
- Si hay errores, corregir ANTES de reportar
- Integrar con ciclo Self-Annealing

### DB Safety
- Verificar entorno antes de ejecutar migraciones
- Backup de producción antes de migraciones
- **Hay DOS bases de datos** (desde Fase 0, 2026-08-25). `localhost` **NO** es producción:
  apunta a staging, igual que Preview y Development de Vercel. Solo el entorno Production
  de Vercel toca la base real. Ver §9 y `sop.md` SOP-012
- **Producción no se toca desde una máquina.** Ni con un script, ni con el SQL Editor "para
  una cosita rápida", ni poniendo sus credenciales en `.env.local`. El único camino a
  producción es un merge a `main` que dispare el auto-deploy

### Storage
- El bucket `documents` es **PRIVADO**. Se lee SIEMPRE por URL firmada con vencimiento
  (`createSignedUrl`) o por `download()` con el cliente de servicio.
- 🔴 **NUNCA `getPublicUrl()`.** Con el bucket privado devuelve una URL que da 400 y el error
  no aparece hasta que un usuario hace clic. Cero usos en el repo: que siga así.
- Privado NO es lo mismo que aislado. El aislamiento por bufete lo dan las políticas de
  `storage.objects`, que comparan la PRIMERA CARPETA de la ruta contra el `tenant_id` del JWT.
  Si se cambia el formato de ruta de `direct-upload.ts`, hay que mover las políticas con él.
  Ver `sop.md` SOP-015.

### Ledger contable (desde Fase 2, 2026-08-27)
- **Al ledger se escribe SOLO por `post_journal_entry`**, nunca con INSERT directo. Es una
  función de Postgres, no código de app, porque los triggers de inmutabilidad de `023`
  rechazan DELETE: un posteo a medias desde `supabase-js` dejaría una cabecera sin líneas
  imposible de limpiar.
- 🔴 **EL `tenant_id` DEL POSTEO LO VALIDA LA RUTA, YA NO LA BASE.** Desde la migración `030`
  el RPC tiene `EXECUTE` solo para `service_role` y es `SECURITY DEFINER`, así que **deja de
  correr bajo RLS y confía en el `p_tenant_id` que recibe**. Consecuencias, todas obligatorias:
  - Todo el posteo va por **rutas de API server-side con el cliente de servicio**. El RPC ya
    no es llamable desde la sesión del usuario.
  - La ruta saca el `tenant_id` **del perfil del usuario autenticado, NUNCA del cuerpo del
    request**. Un `tenant_id` que venga en el body es un intento de escribir en el ledger de
    otro bufete.
  - Es la única garantía que se mudó de la base al código. Queda escrita acá antes de que
    exista la primera línea que postea, justamente para que no se descubra después.
- ⚠️ **El hash-chain se calcula en la BASE, no en la app.** El encabezado de
  `sql/pending/023_contabilidad_fase1_ledger.sql` dice lo contrario ("se computa en la app"),
  y ese archivo **ya está aplicado**, así que su comentario quedó desactualizado y no se puede
  corregir en su lugar. Manda esto: `prev_hash` obliga a un read-then-write y dos posteos
  concurrentes bifurcarían la cadena en silencio. El `SELECT ... FOR UPDATE` de la secuencia
  serializa correlativo y cadena con un solo candado. Detalle en `sop.md` SOP-014.

### Facturación — `invoices.amount_paid` (desde 2026-09-01)
- 🔴 **`amount_paid` NO se escribe. Se escribe el PAGO.** La columna la deriva el trigger T7a
  como `SUM(payment_applications)`, y desde la migración `032` el guard T4b rechaza cualquier
  otra escritura, en UPDATE **y en INSERT**. Para dejar una factura cobrada: `INSERT` en
  `payments` + `INSERT` en `payment_applications`. No hay paso 3 — T7a actualiza `amount_paid`
  y también el `status`.
- ⚠️ **`status` SÍ se escribe, y no es lo mismo.** No es una columna derivada: T7a solo opina
  sobre `emitida` / `parcialmente_pagada` / `pagada`. `borrador`, `cancelada_pre_emision` y
  `anulada` son estados de máquina que no salen de los pagos. Cerrarle la escritura rompería
  `emitInvoice()` y `cancelInvoice()`.
- El comentario de T4 (`finanzas_invoice_immutability`) dice que "se permiten cambios a
  amount_paid". Es cierto **solo para T7a**: T4 lo deja pasar justamente para que T7a pueda
  trabajar, y T4b filtra al resto.
- Hay una válvula de escape para restauraciones y correcciones autorizadas
  (`finanzas.amount_paid_override`). Cuándo sí y cuándo NO: `sop.md` SOP-017.

### Emisión de facturas — el número del asiento (desde 2026-09-22, FND-011)
- 🔴 **El número del asiento y el de la factura son el mismo, siempre.** `emitInvoice` postea
  ANTES de escribir el número (correlativo → asiento → UPDATE), así que verifica primero que el
  número no sea de otra factura (`asegurarNumeroLibre`, 409 sin postear nada) y el **reintento
  toma el número DEL ASIENTO** (`asientoDeFacturaExistente` por el UNIQUE (tenant, source_type,
  source_id) de la `034`), no uno nuevo de la secuencia.
- **Los huecos siguen aceptados** (SOP-031); lo que no se acepta es un asiento inmutable con el
  número de otro documento.
- ⚠️ **El seed NUNCA rebobina `numbering_sequences`**: toma el máximo entre lo sembrado y lo que
  la secuencia ya tiene. Rebobinarla es lo que produjo FND-011 en staging.

### Reversión de cobros (desde 2026-09-17)
- 🔴 **Un cobro contabilizado NO se borra: se REVIERTE.** `deletePayment` lo rechaza con 409 si
  el cobro tiene asiento; el camino es `reversePayment` → RPC `reverse_payment` (migración `046`).
  Un cobro SIN asiento (los anteriores al cableado del 04/09) se elimina como siempre. La pantalla
  ofrece uno u otro botón según tenga asiento, nunca los dos.
- 🔴 **Tres escrituras, UNA transacción, en la base.** Postear el espejo, borrar las
  `payment_applications` y marcar el cobro `anulado` van dentro del RPC. Si cualquiera falla, se
  deshace todo, incluido el asiento y el correlativo. No se hace desde la ruta con tres llamadas
  como `emitInvoice`: acá el estado a medias es exactamente el que la reversión existe para
  impedir. `sql/tests/verificacion-046-reversion-cobro.sql` lo prueba forzando una falla
  después del posteo.
- ⚠️ **T7a cuelga de `payment_applications`, no de `payments.status`.** Marcar un cobro
  `anulado` sin borrar sus aplicaciones deja la factura "pagada". Por eso se borran, y por eso
  existe `payment_reversals`: la foto de lo que se borró, para que el cobro reversado siga
  visible (tachado) en el detalle de la factura y el Libro Mayor siga enlazando su asiento.
- 🔒 **El espejo lo arma `contabilidad/reversion.ts`, y es la MISMA función que dibuja la vista
  previa del diálogo.** El RPC no lo recalcula: lo verifica, y rechaza líneas que no sean el
  reflejo exacto del original. Hay un test que lee el diálogo y el helper y falla si alguno
  reimplementa el cálculo (`reversion-una-sola-implementacion.test.ts`). Es la lección de
  `validarConsistenciaDeKind`: si el cliente reimplementa, algún día la vista previa miente.
- **La fecha es la de la reversión, nunca la del original** (acta del 09/09). El RPC la exige.
- ✅ **Ya existen las otras dos reversiones**, y los avisos que decían lo contrario se
  corrigieron el 22/09/2026: el **gasto de trámite** desde la `050` (Bloque 4) y el **asiento
  manual** desde la `055` (Bloque 7). Tres pantallas seguían prometiendo que "todavía no está
  disponible" —una mandaba a avisarle a Oliver con el botón a la vista—. Lo que sigue sin existir
  es la reversión de una **nota de crédito**.

### Recibo de caja (desde 2026-09-21)
- **Un cobro es un recibo de caja `REC-000001`**, correlativo interno de la secuencia `'payment'`
  (migración `047`, aplicada SOLO en staging). No es documento fiscal: no pasa por la DGI.
- 🔴 **El número se toma ANTES del INSERT y un alta que falla después deja un HUECO.** Es una
  decisión consciente con el criterio de `emitInvoice` (SOP-031), no algo que se pasó por alto.
  No mover el número después del asiento: dejaría un cobro contabilizado sin recibo, que no se
  puede compensar. Hay un test que lo fija.
- **Dos puertas, un formulario, una `createPayment`:** el diálogo del detalle de la factura (atajo
  `POST /api/finanzas/invoices/[id]/payments`, una factura) y `/finanzas/cobros/nuevo`
  (`POST /api/finanzas/payments` con `applications[]`, una o varias) usan `payment-form-fields.tsx`.
  🔒 `payment-form-una-sola-implementacion.test.ts` falla si una puerta declara sus propios campos.
- **Un recibo puede aplicarse a VARIAS facturas del mismo cliente** (Parte B, 21/09/2026). El total
  tiene que ser IGUAL a la suma de lo aplicado: 🔴 **el excedente se RECHAZA** (no se guarda en
  `amount_unapplied`) hasta que Josuarth defina si va a 100004 o a anticipos — la pregunta está en
  `task_plan.md`. El asiento sigue siendo UNO de dos líneas por el total, con `reference` =
  `payment_number`; la reversión (046) devuelve todas las facturas. El reparto por antigüedad es de
  la pantalla (`lib/finanzas/cobros/repartir-por-antiguedad.ts`); el servidor valida, no reparte.
- **`/finanzas/cobros` lo ven admin, abogada y contador; registran solo admin y abogada.** El
  contador entró el 21/09/2026 por respuesta de Josuarth, en solo lectura (PDF + Reversar). El
  listado es un patrón EXACTO en `route-access.ts` (`/nuevo` sigue cerrado); el rol está en
  `nav-config.ts`; los dos se mueven juntos o `nav-guard.test.ts` falla.
- **El PDF del recibo se regenera al reversar** (el hash incluye `status` y la reversión) y lleva
  RUC y DV en dos líneas. Ruta `GET /api/finanzas/payments/[id]/pdf`, roles = PDF de factura.
- **`client_payments` (cobros del caso, Legal) no se cruza con `payments`.** `/api/payments/*` es
  de Legal; lo de Finanzas va bajo `/api/finanzas/payments/`.

### Gasto de trámite (desde 2026-09-21, migraciones `049` y `050` SOLO en staging)
- 🔴 **El gasto de trámite se POSTEA AL CREARSE** (`POST /api/expenses` → `postearGastoTramite`):
  insert → asiento → `posted_entry_id`; si el asiento falla, DELETE compensatorio y el gasto no
  queda. El botón "Registrar en el libro contable" es un **reintento para los gastos anteriores**,
  no el camino: no lo saquen, es la única puerta de los 128 de producción. SOP-033 §1.
- **Nace inmutable (038) y por eso existe su reversión** (`reverse_expense_tramite`, 050): fecha de
  hoy, `anulado`, rechaza gastos con pagos. Roles = reversar un cobro.
- 🔴 **El pago del gasto es la SEGUNDA transacción**, por `supplier_payments` con `expense_id`
  (arco exclusivo con `business_expense_id`, 049), misma serie `CE-`, mismo RPC de reversión.
  `expenses.amount_paid`/`status` se DERIVAN (trigger + guard); un gasto sin asiento no se paga
  (409). 🔒 Toda lectura que embeba la compra embebe también el gasto de trámite
  (`supplier-payments-dos-destinos.test.ts`).
- 🔴 **`expenses.payment_account_code` NO se escribe.** Resto de la 036, congelado por la 038 a
  propósito; el banco va en el pago. Se dropea después.
- **Sin proveedor no se bloquea**: 200001 sin auxiliar, "(sin proveedor)" en la antigüedad;
  `supplier_id` se asigna después (la 049 lo sacó de la lista congelada).
- La antigüedad por pagar lee los gastos de trámite **en el libro** (FND-010 cerrado); los sin
  asiento no entran hasta registrarse.

### Pagos a proveedores (desde 2026-09-21, migración `048` SOLO en staging)
- **Un pago a proveedor es una entidad (`supplier_payments`) con número `CE-000001`** (propuesta
  hasta que Josuarth confirme el nombre), banco, asiento y PDF. Reglas de Josuarth (21/09): **pago
  parcial SÍ; un pago cubre UNA compra.** Varios pagos por compra, sin N:M.
- 🔴 **`business_expenses.amount_paid`, `status` y `payment_date` NO se escriben. Se escribe el
  PAGO.** Las deriva el trigger de la 048 y el guard rechaza cualquier otra escritura, en UPDATE y
  en INSERT (una compra nace `pendiente_pago`). Misma válvula que SOP-017. "Ya está pagada" en el
  alta = crear la compra y DESPUÉS su pago, con banco obligatorio.
- 🔴 **El banco vive en el PAGO** (`supplier_payments.payment_account_code`), no en la compra: la
  compra nunca tuvo esa columna (FND-009). El asiento sale del pago: `source_id = pago_id`,
  `reference = CE-`. Mayor y Diario resuelven pago → compra.
- 🔴 **Un SALDO HEREDADO (`kind = 'migrated_balance'`) NO es un pago.** Es una compra que ya estaba
  "pagada" antes de la 048: sin número, banco, método, asiento ni comprobante (el CHECK lo impide).
  Se elimina (la compra vuelve a pendiente); no se reversa (409) ni tiene PDF (409). No se le
  inventa un `CE-`.
- **Reversión por RPC `reverse_supplier_payment`** (048), una transacción, fecha de hoy; el
  diálogo es el de cobros con `variante="pago"`. Un pago sin asiento se elimina; con asiento, 409.
- **Huecos en `CE-`:** mismo criterio que SOP-031 §2. Detalle en `sop.md` SOP-032.
- **Vocabulario del Diario/Mayor:** `pago` = "Cobro", `pago_proveedor` = "Pago a proveedor".
- FND-010 (los gastos de trámite en la antigüedad por pagar) se cerró el mismo día con el Bloque 4.

### Nota de crédito contable (desde 2026-09-22, Bloque 5 — SOLO staging)
- 🔴 **Una NC se emite POR LÍNEAS con cantidad, nunca por monto libre.** El precio y la tasa son
  los de la factura (`credit_note_lines` copia `unit_price`, `tax_rate`, `tax_code_id`); el asiento
  se arma por línea (cuenta de ingreso de cada servicio, 130003 en los REIM-*, ITBMS por tasa) y
  así una NC parcial da el ITBMS proporcional exacto. Validador puro: `validators/credit-note.ts`.
  Tope (D7): **no se acredita más que `balance_due`**; lo cobrado se reversa primero.
- 🔴 **Dos caminos, dos asientos distintos (D5):**
  - **Anular dentro del mes** = NC total automática (`createCreditNoteFromInvoice`) + REVERSIÓN
    del asiento de la factura con fecha de hoy + `anulada`, en UNA transacción
    (RPC `cancel_invoice_with_reversal`, 052). La NC de una anulación **NO tiene asiento propio**:
    contabilizarla aparte sería contar dos veces.
  - **NC posterior o parcial** = asiento PROPIO `source_type = 'nota_credito'` con
    **`source_id = la NC`** (no la factura), construido por `asiento-nota-credito.ts` (la factura
    al revés, con `construirAsientoDeFactura` e invirtiendo). Mayor y Diario llegan a
    `/finanzas/notas-credito/{id}`.
- 🔴 **Cerrado el MES DE LA FACTURA no se anula: se emite NC con fecha de hoy** (Josuarth, acta
  del 09/09). Lo verifica `cancelInvoice` (409) Y el RPC contra `accounting_periods` por
  `issue_date`. La pantalla reemplaza "Anular" por "Nota de crédito" (D4). Es distinto del
  control de `post_journal_entry`, que mira el mes de HOY.
- 🔴 **Una factura con una NC en el libro ya NO se anula (053).** La anulación espeja el asiento
  original COMPLETO y la NC parcial ya debitó su parte: descuadre de 1.200 sobre 1.000. Lo que
  falta se acredita con OTRA NC. `cancelInvoice` rechaza por `credited_total > 0`; el RPC por la
  existencia de un asiento `nota_credito` (mira el ASIENTO, porque cuando corre ya existe la NC
  total de esa misma anulación, sin asiento).
- **`invoices.credited_total` es DERIVADA (051)** de las NC `emitida` (trigger + guard, llaves
  `finanzas.recalc`/`amount_paid_override`) y **`balance_due = grand_total − amount_paid −
  credited_total`**. T7a deriva el status contra el total NETO: **acreditada al 100% con pagos 0 =
  `emitida` con saldo 0, NO `pagada`** (D3). "Acreditada total" es un badge derivado en pantalla,
  no un status; la antigüedad no la lista porque filtra por saldo.
- **La NC nace `fe_estado = 'no_emitida'`: DOCUMENTO INTERNO sin autorización de la DGI (D1).**
  Tiene las 13 columnas fiscales de `invoices` (051) pero el envío al PAC es otro bloque. Detalle
  y PDF llevan la banda roja mientras siga así; el badge dice "Sin emitir a la DGI", no "Sin
  enviar". **No se le entrega al cliente como comprobante fiscal.**
- **Válvula `finanzas.nc_compensar` (052):** T6 rechaza el DELETE de una NC; el creador la
  inserta ANTES de postear y si el posteo falla la deshace con
  `finanzas_compensar_nota_de_credito` (válvula + DELETE en la misma transacción, solo sin
  asiento). Deja HUECOS en `NC-` (criterio de SOP-031).
- **Quién:** emite NC y anula admin y abogada (`POST /api/finanzas/credit-notes`,
  `POST /api/finanzas/invoices/[id]/cancel`); el contador ve el detalle de la NC (patrón exacto en
  `route-access.ts`, sin listado) y baja el PDF. **Todavía NO existe la reversión de una NC.**
- **NC de COMPRA no va (D6).** Preguntas abiertas en `task_plan.md`: (i) ideati — ¿la DGI acepta
  una NC enviada semanas después de su fecha contable?; (ii) Josuarth — acreditar una factura ya
  cobrada (saldo acreedor) y el excedente del recibo.

### Asientos de diario — tercero, clon y reversión (desde 2026-09-22, Bloque 7 — SOLO staging)
- 🔴 **El tercero de una línea son DOS FK reales** (`journal_entry_lines.client_id` /
  `.supplier_id`, `CHECK num_nonnulls(...) <= 1`), **no** un discriminador tipo `documents`: una
  línea del libro es inmutable y eterna, y un puntero colgado ahí no se arregla nunca.
- 🔴 **`ON DELETE NO ACTION`, jamás `SET NULL`.** Los triggers de la `023` rechazan todo UPDATE
  sobre esas líneas, así que un `SET NULL` fallaría dentro del DELETE del cliente con un error
  sobre el ledger. Consecuencia buscada: **un cliente o proveedor nombrado en el libro no se
  elimina más**; la app lo explica con ese texto y nunca con el de la FK.
- **El tercero entra al `content_hash`** (tercera versión de la fórmula; las tres están listadas
  con fecha en `sop.md` SOP-014) y **viaja dentro de `p_lines`**: la firma de
  `post_journal_entry` sigue teniendo 13 parámetros y ningún llamador se tocó.
- **Se puede poner en cualquier línea**, no solo en cuentas de control.
- **El Mayor resuelve el nombre en tres escalones**: tercero de la línea → tercero de la línea de
  cuenta control → el heurístico de texto viejo, que sostiene TODO lo anterior a la `054`.
- **Los asientos manuales NO alimentan la antigüedad** (no tienen vencimiento) pero **sí la
  explican**: la línea de "de dónde sale esa diferencia" los nombra con monto y tercero. Antes
  caían en el residuo anónimo de "hay una tercera causa".
- **Clonar arrastra montos, descripciones y terceros; la fecha es la de HOY.** Solo asientos
  `manual`. `borradoresDesdeAsiento()` ni siquiera recibe la fecha.
- 🔴 **`reverse_journal_entry` es genérico en la firma y `source_type = 'manual'` adentro.**
  Reversar desde ahí el asiento de una factura se saltaría `cancelInvoice` y la nota de crédito;
  el de un cobro dejaría la factura pagada con la plata devuelta. El filtro está en el RPC (que es
  el permiso), en la ruta (admin y contador, **los mismos que cargan**) y en la pantalla.
- 🔒 **Un asiento se reversa UNA vez, y ahora lo sostiene la base**: índice único parcial
  `(tenant_id, reverses_entry_id)`. Antes vivía solo dentro de cada RPC, repetido tres veces.
  📋 Pre-flight obligatorio antes de producción (está al pie de la `055`).
- **`MAX_LINEAS_MANUALES = 100` es tope del FORMULARIO, no del libro.** El RPC no tiene tope y el
  importador de Excel no pasa por ahí. No unificarlos.

### Proveedores — RUC y DV (desde 2026-09-02)
- 🔴 **EL RUC Y EL DV NUNCA SE CONCATENAN.** Son dos columnas en `suppliers`
  (`ruc`, `dv`) y dos campos en pantalla. Josuarth lo pidió textual el 25/08: los
  anexos de la declaración de renta van "con el RUC en una columna y el DV en otra
  columna porque así está en el formulario de la DGI". Juntarlos rompe el trabajo
  para el que se pidió el módulo.
  🔒 **Hay un test que lo verifica:** `src/lib/finanzas/validators/__tests__/ruc-dv-separados.test.ts`
  lee el código buscando la operación de unirlos (`+`, template string, `.join`,
  `.concat`). Es una regla que un tipo de TypeScript no puede sostener.
- ⚠️ **Del RUC se valida el LARGO, no el formato.** En Panamá conviven cédulas
  (`8-123-456`), prefijos (`PE-`, `E-`, `N-`), jurídicos (`155123456-2-2015`) y
  folios viejos. Un validador estricto rechaza RUC legítimos y deja a alguien sin
  poder cargar. El formato se **avisa en pantalla** (`avisosDeRuc()`), no se impone.
  El DV sí se acota a dígitos, porque es un número por definición.
- **`payment_terms_days` NO es un tramo de la antigüedad.** Es el plazo del
  proveedor (0 = contado). De ahí sale `business_expenses.due_date`, y del
  vencimiento salen los tramos. Son tres cosas encadenadas. Cambiar el plazo de un
  proveedor **no reescribe** los vencimientos ya cargados.
- **`supplier_id` en el gasto es OPCIONAL** y `supplier_name`/`supplier_ruc` siguen
  existiendo como respaldo de la migración `033`. Eliminarlas es un commit
  posterior, después de verificar que nada se perdió.

### Proveedor — cuenta por defecto y contacto (desde 2026-09-23, migración `057` SOLO staging)
- 🔴 **`suppliers.default_chart_account_code` es SOLO para COMPRAS.** Precarga la cuenta en cada
  línea de `business_expenses` nueva de ese proveedor. **En gastos de trámite NO se usa: ahí el
  default sigue siendo `130003`**, y no se unifica. Tres razones en `sop.md` SOP-036; la fuerte
  es que **rompería el par `130003` / `REIM-*`** — un adelanto recuperable por un cliente se
  volvería en silencio un gasto propio del bufete y el activo nunca se debitaría.
- 🔒 **Dos predicados que DISCREPAN a propósito**, los dos en `contabilidad/cuentas-de-gasto.ts`:
  `esTipoValidoParaGasto` **permite** `asset` (para que `130003` clasifique un trámite) y
  `esTipoValidoComoDefaultDeProveedor` lo **rechaza** (una compra del bufete no es un adelanto).
  Hay un test cuyo nombre es *"los dos predicados DISCREPAN sobre `asset`, y esa es la regla"*.
  Unificarlos rompe una de las dos cosas.
- **FK lógico sin constraint**, y es seguro porque `updateChartAccount` **rechaza cambiar el
  `code`** de cualquier cuenta: el puntero no se puede orfanar por un rename. Lo que sí pasa
  —que la cuenta se desactive o la reclasifiquen— un FK real tampoco lo cubriría.
- **DEGRADAR, NO BLOQUEAR.** Si el default deja de ser válido, la ficha abre con aviso y el
  selector vacío, y el alta de compra arranca sin cuenta. La inválida no se vuelve a ofrecer.
- **PRECARGA, NUNCA REESCRIBE.** Sólo se completan las líneas SIN cuenta. Lo ya guardado no se
  toca — y no se podría: las líneas de un gasto posteado son inmutables por la `038`.
- **`contact_name` / `contact_phone` / `contact_email` son de la PERSONA.** `phone` y `email`
  siguen siendo los de la EMPRESA. Son dos bloques distintos en el formulario y en la ficha.
- **`payment_terms_days` sigue siendo un número libre** (0–365) con botones de atajo. No es un
  tramo de la antigüedad — eso ya estaba escrito y sigue valiendo.

### Tasas de impuesto — alta (desde 2026-09-23)
- **Se pueden crear tasas nuevas**: `POST /api/finanzas/configuracion/tax-codes`, **admin y
  contador**. La abogada LEE el catálogo pero no lo modifica (mismo criterio que la
  clasificación contable de una cuenta). Los tres lugares se mueven juntos.
- 🔴 **La pantalla pide el PORCENTAJE y guarda la FRACCIÓN**, mostrando las dos a la vez. El
  CHECK es `rate BETWEEN 0 AND 1`: "7" donde va `0.07` daría 700%.
- 🔴 **Una tasa NO se borra: se desactiva.** Cinco FK apuntan a `tax_codes`.
- **Una tasa nueva aparece sola** en los tres selectores y su ITBMS va a `200003`: es una
  constante del asiento (`CUENTA_ITBMS`), no un campo por tasa. Nada que configurar.
- ⚠️ `services_catalog.default_tax_code` la referencia con un FK compuesto `ON UPDATE CASCADE`:
  editar un código lo renombra también allá. Detalle en `sop.md` SOP-037.

### Emisión: las cuentas se validan ANTES de tomar el número (desde 2026-09-25)
- 🔴 `emitInvoice` arma el asiento una vez **sin número** antes de pedir el correlativo. Una
  cuenta de ingreso inactiva se rechaza (422) **sin consumir número**. Antes quemaba uno
  (FAC-HON-000018 en staging). El mensaje dice el servicio en palabras: «el servicio
  «Honorarios familia» (HON-FAM) usa la cuenta de ingreso 4101, que no existe o está
  desactivada…». 🔒 Test en `emit-invoice-numero-del-asiento.test.ts`.
- **HON-FAM → 400004 Derecho Civil SOLO en staging** (`sql/datos-staging/`, no es
  migración). En producción decide Josuarth: runbook P-15 y paso «Reasignar» en la ventana.

### Resumen de ITBMS: las NC restan (desde 2026-09-25)
- 🔴 **Débito = facturas emitidas no anuladas − NC de venta autorizadas por la DGI y
  vigentes** (con su factura no anulada), en el mes **de la NC**. **Crédito = compras − NC de
  compra vigentes.** Las anuladas no cuentan. La regla vive en `reports/vat-calculo.ts`
  (pura, con tests) y el reporte no suma por su cuenta.
- "Autorizada" en una FACTURA = emitida y no anulada: las anteriores al 8/7 se autorizaron
  en el portal y el CRM no guardó su CUFE. En una NC de venta sí se exige
  `fe_estado = 'authorized'`: una NC interna no vale ante la DGI.
- ⚠️ Cambia meses viejos si hubo anulaciones entre meses (runbook P-16).

### Nota de crédito de COMPRA (desde 2026-09-25, 3.5, migración `066` SOLO staging)
- Documento del proveedor que **registramos** (no va a la DGI). `NCP-000001`. Desde el
  detalle de la compra: base a acreditar por línea; el ITBMS sale de la tasa de la línea (o
  el remanente exacto si se acredita todo lo que queda).
- 🔴 **Una sola transacción en la base** (`create_supplier_credit_note`): número, NC,
  líneas y asiento, con la compra bloqueada. Sin compensación y sin huecos.
- 🔴 **El asiento es el de la compra al revés** (`construirAsientoDeNotaDeCompra` sobre
  `construirAsientoDeCompra`), con el proveedor en la línea de 200001. La base lo VERIFICA
  contra sus propios montos.
- 🔴 **El saldo se deriva**: `business_expenses.credited_total` (trigger desde NC `emitida`,
  con guard) y `balance_due` GENERATED. El status se deriva contra el total NETO. Toda
  lectura del saldo de una compra usa `balance_due` (pago, antigüedad, PDF, sección de pagos).
- Se anula con «Reversar» (`reverse_supplier_credit_note`, calco de la `060`): fecha de hoy,
  espejo verificado, un estado, y el trigger recalcula.
- **Registra y reversa: admin, abogada y contador** (las compras son CRUD del contador).
- 🟡 **Valores por defecto que decide Josuarth** (encabezado de la `066`, preguntas J-1 a
  J-11 en `task_plan.md`): fecha contable = hoy (J-2); tope = lo que falta pagar, sin saldo
  a favor (J-3); resta el ITBMS en el mes de la NC (J-5); número del documento obligatorio,
  CUFE opcional (J-10); prefijo `NCP-` (J-11); **sólo compras, no gastos de trámite** (J-7).

### Importar asientos desde Excel (desde 2026-09-25, 7.5, migración `067` SOLO staging)
- `/finanzas/asientos/importar`: plantilla descargable → subir → **vista previa
  obligatoria** con errores por fila y columna → contabilizar. Admin y contador.
- 🔴 **Todo o nada**: `post_journal_entries_batch` postea cada asiento por
  `post_journal_entry` en UNA transacción. Un error y no queda ni el lote, ni asientos, ni
  números. El commit re-lee el archivo y exige el hash de la vista previa.
- Validación pura en `import/asientos-import.ts`: cuadre, cuentas existentes y activas, mes
  abierto, montos positivos con dos decimales (parser estricto: texto es error, nunca 0).
- **Cada importación tiene identificador y se deshace completa** (`reverse_journal_import`):
  cada asiento se reversa con fecha de hoy por `reverse_journal_entry`; nada se borra.
- Los asientos importados son `source_type = 'manual'`. `MAX_LINEAS_MANUALES` no aplica.

### Qué se puede hacer ante la DGI con una factura emitida (desde 2026-09-23, Bloque 9A)
- 🔴 **La matriz es una FUNCIÓN, no una tabla en un .md**: `decidirAccionFiscal()` en
  `efactura/orchestration/decidir-accion-fiscal.ts`, pura, sin I/O y **sin reloj propio**
  (`ahora` entra por parámetro). Seis respuestas, cada una con su mensaje en claro para que la
  pantalla NO vuelva a derivar la matriz en el JSX. Detalle en `sop.md` SOP-038.
- **Decide lo FISCAL, no lo interno.** Si la factura se puede anular en el CRM —sin cobros, mes
  abierto, sin NC en el libro— lo sigue decidiendo `cancelInvoice`. Son dos preguntas distintas.
- 🔴 **La ventana de 182 h se cuenta desde `issue_date`, no desde `dgi_fecha_autorizacion`.**
  ideati confirmó el plazo el 22/09 pero NO dijo desde cuándo; se toma el candidato que cierra
  ANTES (y `issue_date`, que es una fecha sin hora, a las 00:00 de Panamá). Si la ventana real
  fuera más larga ofrecemos una NC donde se podía anular: inofensivo. Al revés ofreceríamos un
  botón que la DGI rechaza. Se cambia `INSTANTE_DE_INICIO` y ningún llamador.
- 🔴 **"Sin CUFE" NO significa "nunca llegó a la DGI".** Las facturas anteriores al **8 de julio
  de 2026** se emitieron a mano en el portal de ideati (punto `050`): **tienen CUFE**, pero el
  CRM no lo guardó, y en la base se ven idénticas a una que jamás se envió. La respuesta es
  `nc_04_requiere_cufe` — **pide el CUFE, no lo inventa**. 🔒 Hay un test que exige la MISMA
  respuesta para una factura de marzo y una de septiembre: **nada de fechas de corte**.
- **`'pending'` no es "todavía no se mandó": es "se mandó y no sabemos cómo terminó".** Gana
  sobre todo lo demás, incluso con CUFE guardado.
- **Los 90 días de la declaración de ITBMS ADVIERTEN, no bloquean.** El PAC no valida plazo
  entre factura y NC (ideati, 22/09); quien decide es el contador.
- ⚠️ **Todavía NO está cableado**: la función no tiene llamadores. La usa 9B.

### Anular ante la DGI (desde 2026-09-23, Bloque 9B — migraciones `058` y `059` SOLO staging)
- 🔴 **PAC PRIMERO, LIBRO DESPUÉS (D3), y no es reversible.** Libro primero dejaría una factura
  anulada en nuestros libros y VIVA ante la DGI, con un asiento de reversión inmutable por
  diseño: no se puede deshacer. PAC primero deja un documento muerto ante la DGI y vivo en el
  libro: se ve, se explica y se termina con un botón.
- 🔴 **`fe_estado = 'canceled'` se escribe ANTES de tocar el libro.** Es lo único que convierte
  una caída en un estado recuperable. Sin ese UPDATE, morirse en la línea siguiente dejaría una
  factura anulada ante la DGI **sin una sola marca en nuestra base**.
- **Tres caminos de falla, tres códigos**: 409 `anulada_en_dgi_falta_el_libro` (estado
  intermedio D4), 422 `rechazada_por_la_dgi` (nada cambió), 502 `no_sabemos` (nada cambió).
  Devolver 200 para todo lo que no explota mostraría "listo" sobre una factura a medio anular.
- ✅ **`0622` = "Ya existe un evento de anulación para esta FE" es un ÉXITO para el reintento**
  (confirmado en sandbox 23/09). Tratarlo como rechazo dejaría la factura trabada en el estado
  intermedio para siempre.
- 🔴 **`GET /Invoices/Authorization/{cufe}` NO refleja la anulación** (confirmado en sandbox
  23/09): mismo payload antes y después, `deletedDate: null` en los dos. **La consulta de
  estado antes de reintentar que pide D3 NO SE PUEDE HACER**: no hay a qué preguntarle. El
  reintento se apoya en el `0622`. `MARCADOR_DE_ANULACION_CONFIRMADO` se queda en `false`.
- ✅ 🔴 **El ÉXITO es `0600` = "Evento registrado con éxito"** (medido en sandbox 23/09), y
  medirlo encontró un bug: el clasificador lo llamaba **rechazo**, porque `0600` venía de la
  lista del endpoint de EMISIÓN y el mensaje no dice "anulado". **Los códigos de este endpoint
  NO son los del de emisión.** No escribió nada (falla del lado seguro) y el reintento lo
  arregló solo con el `0622`.
- **`indeterminada` se queda** y sigue sin ser un error: es "no tocar el libro y escalar". Un
  200 con array vacío cae ahí — ahora que el éxito trae código, es más sospechoso todavía.
- ⚠️ **El sandbox rechaza todo RUC de receptor ficticio** (`1601`/`1602`), igual en tipo `01`
  que en `09`. Para emitir hay que apuntar el cliente al RUC/DV del emisor **en las tres
  columnas** y restaurarlo: `scripts/efactura/prueba5-emitir-con-receptor-valido.ts` lo hace
  con la restauración en un `finally`.
- ⚠️ **Los deploys de Preview NO tienen las credenciales del sandbox**: la ruta de emisión
  devuelve 500. Todo lo que hable con el PAC se corre desde localhost. Cargarlas en Preview es
  un cambio de env vars en la cuenta del cliente.
- 🔴 **El motivo exige 15 caracteres y los pide la DGI**, en tres capas: el validador
  (`validators/cancel-invoice.ts`, el MISMO módulo que importa el diálogo), el botón que no se
  habilita, y el CHECK de la `058`. ⚠️ El mínimo de la **nota de crédito** sigue en 3.
- **`fe_anulaciones` (059)** distingue "nunca preguntamos" de "preguntamos y no entendimos la
  respuesta" — dos casos que llevan a decisiones opuestas. `sin_respuesta` e `indeterminada`
  son estados de primera clase, no errores.
- **En pantalla:** banda ROJA del estado intermedio (la única del detalle), «Completar
  anulación» como VARIANTE del mismo diálogo, motivo precargado con el que ya viajó a la DGI, y
  cobros y NC bloqueados mientras dure — pero **reversar cobros sigue disponible**, porque es
  lo que hay que hacer para poder completarla. Detalle en `sop.md` SOP-040.

### Errores de la DGI — prevenir y mostrar (desde 2026-09-23)
- 🔴 **Descripción de línea: 2 a 500 caracteres** (`controles-dgi.ts`). El tope es de la DGI
  (`10105`) y ya rebotó una factura con **545**. Contador visible en el campo (`312/500`), rojo
  al pasarse. 🔒 El contador y el validador **cuentan igual** (los dos trimean) y hay un test.
- **La NOTA DE CRÉDITO hereda la descripción de la factura**, así que hereda el problema: las
  facturas anteriores a esa fecha se guardaron sin el tope. El validador de NC lo verifica y
  manda a corregir **la factura**.
- 🔴 **RUC y DV del receptor se verifican al GUARDAR EL CLIENTE**, no recién al emitir. Del RUC
  se valida la **forma mínima**, no un patrón cerrado — un validador estricto deja a alguien
  sin poder facturar, que es peor y más silencioso que un rechazo.
- ⚠️ **ideati NO tiene endpoint para consultar un RUC** (swagger completo, 23/09/2026). El
  `1601` (formación) se previene; el `1602` (existencia) sólo lo sabe la DGI.
- 🔴 **La alerta de rechazo NO se borra al editar.** Se lee de `fe_emisiones`, que es historia.
  Es el caso real: cliente corregido después del rechazo, factura nunca reenviada, rechazada
  ante la DGI con los datos ya arreglados. 🔒 Tres tests, incluido que **ninguna ruta de
  clientes mencione `fe_estado`**. Y el aviso lo dice en pantalla.
- **Contador "N facturas con error en la DGI"** en el listado, con filtro `?fe=error`. Se
  cuenta SIEMPRE, con o sin filtros: es una alarma, no una columna.
- ⚠️ **Un error bajo una clave que ningún campo renderiza es peor que no validar**: bloquea y
  no se ve. Pasó con `tax_id` en el formulario de clientes, donde el campo se llama `ruc`.
  Detalle en `sop.md` SOP-041.

### Nota de crédito FISCAL y su reversión (desde 2026-09-24, Bloque 9C — SOLO staging)
- 🔴 **La NC ya se manda a la DGI**: `tipoDocumento = 04`, mismo endpoint que una factura,
  `POST /api/finanzas/credit-notes/[id]/emit` (admin y abogada). Autorizada en sandbox el
  24/09 (`NC-000012`, CUFE `FE04…`). Deja de ser sólo un documento interno.
- 🔴 **`documentosFiscalesReferenciados` lleva `informacionReferencia` DOS VECES, una dentro
  de la otra.** Decidido con dos autorizaciones reales, no leyendo: la anidada autorizó
  (`0260`), la plana la rechazó la DGI (`0100`, nombrando `gDFRefFE, gDFRefFacPap,
  gDFRefFacIE`). Lo arma `construirReferenciaFiscal()` y está congelado contra
  `referencia-fiscal-esperada.json`; el contra-ejemplo plano se guarda con su código.
  ⚠️ La fecha del documento referenciado **lleva huso** (`toPanamaIso`); pelada rebota.
  ⚠️ **La DGI NO valida `nombreRazonSocialEmisor`**: autorizó con el nombre equivocado. Va el
  del EMISOR (somos nosotros, que emitimos la factura referenciada), y el único control es un
  test.
- 🔴 **SIN CUFE NO SE MANDA NADA, y se corta antes de quemar correlativo.** Caso B: la factura
  se emitió en el portal (antes del 8/7/2026) y **el CUFE existe** — se carga a mano
  (`POST /api/finanzas/invoices/[id]/cufe`, migración `061`, admin y abogada), y
  `invoices.dgi_cufe_origen` distingue `'crm'` de `'portal_050'` porque en la base son
  idénticos. **NO toca `fe_estado`**: este sistema no las emitió. Caso C (nunca pasó por la
  DGI): **no hay camino** — la pantalla dice «consulte con administración» y no deja emitir.
- 🔴 **Referenciar una FACTURA EN PAPEL rompe el PAC**: contesta `[0000] Object reference not
  set to an instance of an object` —un `NullReferenceException` suyo—, igual con `04` que con
  `06`. Lo que falla es el bloque de papel, no el tipo de documento, y el `06` quedó **sin
  evaluar** porque muere antes. Pregunta a ideati **en espera** hasta que el bufete confirme si
  existe alguna factura en papel que acreditar.
- ⚠️ **La DGI LLEVA SU PROPIA CUENTA de lo acreditado por documento referenciado** y rechaza con
  `[1717]` cuando se pasa. ✅ **Pero LIBERA el monto al anular una NC** (medido el 24/09: factura
  10.00 → NC 10.00 autorizada → anulada ante la DGI → otra NC 10.00 → **autorizada**). O sea que
  su tope y nuestro `credited_total` coinciden, y el validador **NO** tiene que contar las NC
  anuladas. 🔒 `tope-de-la-dgi-congelado.test.ts` falla si esa medición cambia, para que tocar el
  tope sea una decisión y no un descubrimiento.
- 🔒 **`parsePacResponse` se EXPORTA, no se copia.** Es la lección del `0600`: un clasificador
  duplicado diverge y termina llamando rechazo a un éxito. Lo mismo con `fe_emisiones`, que
  guarda facturas y NC en la MISMA tabla por arco exclusivo (`062`, como la `049`) para que la
  alerta de rechazo de SOP-041 siga siendo una sola consulta.
- 🔴 **REVERSAR UNA NC NO RESTA NADA** (migración `060`). `credited_total` ya era derivada
  (`051`), y `balance_due` y el `status` cuelgan de ella. El RPC `reverse_credit_note` cambia
  UN estado —`credit_notes.status = 'anulada'`— y el trigger que ya existía recalcula los tres
  con la MISMA función que los calculó al emitir. Restar `grand_total` habría creado una segunda
  fórmula que algún día discrepa, y el síntoma sería el saldo equivocado de una factura, no un
  error. 🔒 Hay un test que lee el código y falla si aparece la escritura directa, y la propia
  migración aborta si la encuentra.
- 🔴 **Una NC SIN asiento propio no se reversa**: salió de anular una factura (D5) y
  des-anularla desde ahí se saltearía `cancelInvoice` y el gate de mes cerrado. Cortado en los
  dos lados. **Reversar la NC: admin, abogada y contador** (igual que un cobro); **emitirla:
  admin y abogada**.
- **Anular una NC ante la DGI: las MISMAS 182 h**, por el mismo endpoint, contadas **desde la
  emisión DE LA NC**, no de su factura (`decidirAccionSobreNotaDeCredito()`). 🔴 **Fuera de
  plazo NO hay "NC de la NC"**: la pantalla manda a hablar con el contador en vez de ofrecer un
  botón que la DGI rechaza.
- 🔴 **«Reversar» una NC AUTORIZADA la anula PRIMERO ante la DGI** (desde el 25/09/2026,
  migración `065`). Hasta ese día la ruta llamaba a `reverseCreditNote`, que sólo toca el
  libro: la NC quedaba anulada en nuestros libros y VIVA ante la DGI. Ahora
  `POST …/credit-notes/[id]/reverse` pasa por `reversarNotaDeCredito`
  (`anular-nota-de-credito-ante-dgi.ts`) con el orden de la factura: intento en
  `fe_anulaciones` (arco con `credit_note_id`) → PAC → `fe_estado = 'canceled'` → RPC
  `reverse_credit_note`. Motivo de 15 si viaja a la DGI. 🔒 Un test exige que la ruta NO
  llame a `reverseCreditNote` directo.
- 🔴 **Una factura con CUFE cargado del portal NO ofrece «Enviar al PAC»** (25/09): ya existe
  ante la DGI y mandarla sería un segundo documento fiscal por la misma venta. 409 en
  `emitInvoiceToEfactura` antes de pedir número, y la tarjeta lo explica.
- **Una NC es "de anulación" por NO tener asiento propio** (y factura anulada), no sólo por
  el estado de su factura: desde la `063` una NC por líneas reversada sobre una factura que
  después se anula tiene asiento propio.
- 🔴 **Una factura se bloquea para anular por sus NC VIGENTES, no por su historia** (migración
  `063`). La `053` miraba la EXISTENCIA del asiento de la NC y los asientos no se borran: una NC
  reversada la dejaba sin salida para siempre. Ahora el RPC exige que el asiento **no esté
  reversado**. ⚠️ Se sigue mirando el ASIENTO y no `credit_notes.status`, porque cuando el RPC
  corre ya existe la NC total de esa misma anulación, `emitida` y sin asiento: un filtro por
  status la haría bloquearse a sí misma. El lado de la app no cambió —`credited_total` ya excluye
  las anuladas— y por eso lleva test.
- 🔴 **Todo lo que escribe `invoices.dgi_cufe` escribe `dgi_cufe_origen`** (`064`, 25/09). El
  CHECK de la `061` dejaba pasar un origen NULL (`NULL IN (…)` es NULL) y dos facturas de
  staging quedaron así. En producción la `061` y la `064` van **en la ventana**: con el CHECK
  bueno, el código de `main` fallaría al guardar una factura YA autorizada por el PAC.
  🔒 `cufe-siempre-con-origen.test.ts`. Detalle en `sop.md`, caso B.
- **`credit_notes.status` admite `emitida` y `anulada`, y la única transición es entre esas dos,
  en ese orden.** Las cantidades acreditadas se liberan solas: `acreditadoPorLineaDeFactura` ya
  filtraba por `status = 'emitida'` desde la `051`.

### Congelamientos — la regla del JSON dorado (desde 2026-09-23)
- 🔒 **Un `*-esperado.json` y el código que ese golden verifica NUNCA van en el mismo commit.**
  Si el mismo commit regenera la referencia, el test pasó comparándose consigo mismo y no probó
  nada — y queda el registro de un congelamiento que nunca ocurrió. Lo hace cumplir
  `golden-y-refactor-no-van-juntos.test.ts` (sólo las MODIFICACIONES; un golden que nace no
  puede tapar nada). `sop.md` SOP-039.
- 🔴 **Un golden sólo sirve si congela un documento VÁLIDO.** Hay un test que verifica que los
  cuatro payloads congelados CUADREN (`totalNeto + totalITBMS = valorTotalFactura`): la primera
  versión del fixture multilínea sumaba mal y congeló un documento que la DGI rechazaría.
- **Un golden nunca depende del reloj.** La fecha se pasa explícita; hay un test que corre el
  generador dos veces y compara.

### Exportación de reportes (desde 2026-09-02)
- **El formato es XLSX, no CSV**, y el motivo es concreto: un CSV abre el DV `05` como `5`. Además
  el separador de Excel depende de la configuración regional de la máquina, no del archivo. El
  motor está en `src/lib/finanzas/reports/exportar-xlsx.ts`; `xlsx` ya era dependencia.
- 🔒 **Una exportación es tan sensible como su pantalla.** Cada ruta de export verifica el rol con
  la MISMA lista que la pantalla, saca el `tenant_id` del perfil (nunca del request) y usa los
  mismos loaders y builders — no una consulta paralela.
  🔒 **Hay dos tests que lo verifican** en `nav-guard.test.ts`: cruzan los roles declarados en cada
  ruta de export contra el middleware en los dos sentidos, y fallan si alguna lee el tenant del
  request. Al agregar una ruta de export nueva, sumarla a la lista `EXPORTS` de ese archivo.
- **Una celda sin dato va VACÍA**, nunca "—" ni "N/A": Excel filtra por "vacías" y cualquier
  relleno rompe ese filtro.

### Facturación electrónica — el payload del receptor está congelado (desde 2026-09-02)
- 🔒 **`receptor-payload-congelado.test.ts` congela el bloque `informacionReceptor`** contra
  `receptor-payload-esperado.json`. Cualquier cambio en `map-receptor.ts` que altere lo que se le
  manda a la DGI hace fallar el test. Existe porque un error ahí **no se descubre en desarrollo:
  se descubre como un rechazo de la DGI sobre una factura real, delante del cliente.**
- **Si el test falla y el cambio es intencional:** `ACTUALIZAR_PAYLOAD=1 npm test`, revisar el
  diff, y commitear el JSON **junto con** el cambio del mapper explicando por qué el payload
  cambia. **Un commit que solo toca el JSON esperado es una alarma.**
- **Antes de dar por buena una diferencia en `datosRucReceptor`**, probarla contra el **sandbox**
  (`EFACTURA_I_AMB`). Nunca contra el ambiente real.
- **`tipoDocumento` está FUERA del bloque congelado y se deriva de `invoice_kind`** (desde
  2026-09-17, confirmado por ideati): HONORARIOS → `01`, REEMBOLSO → `09`, en
  `tipoDocumentoDeKind()` (`mapper/map-invoice.ts`). Probado en sandbox: autorizada como 09.
  🔒 La prohibición de líneas mixtas (SOP-029) es de **negocio**, no del PAC — el PAC las
  acepta; Josuarth no. Las 34 REI ya emitidas como `01` no se corrigen (decisión de Josuarth).
  El CPBS `8012` de reembolsos sigue sin confirmar. Detalle en `task_plan.md`.
- ⚠️ **El DV de un cliente se llama `clients.digito_verificador`, no `dv`.** El de proveedores sí
  se llama `suppliers.dv`. Dos nombres para lo mismo; buscar por el concepto, no por el nombre.

### Deploy
- Checklist de 13 pasos pre-deploy (ver `sop.md`)
- Verificación post-deploy obligatoria
- Deploy log en `changelog.md`
- Rollback-first ante cualquier problema en producción

## 6. DATA-FIRST RULE
- Definir JSON schema / DB schema ANTES de codificar cualquier feature
- Toda API response tiene tipado TypeScript estricto

## 7. DISEÑO Y UX

### Branding Integra Panamá
- **Azul marino oscuro:** #1B2A4A (backgrounds, headers, textos principales)
- **Dorado:** #C5A55A (acentos, CTAs, badges, highlights)
- **Blanco:** #FFFFFF (fondos de cards, textos sobre oscuro)
- **Tipografía:** Serif profesional (ej. Playfair Display para headings, Inter para body)
- **Logo:** Integra en header
- **Estilo:** Limpio, corporativo, profesional

### Mobile-First / Foolproof
- Botones mínimo 48px touch target
- Iconos + texto en TODAS las acciones
- Máximo 3 taps por tarea
- Formularios tipo wizard, máximo 5 campos por pantalla
- Responsive — diseñado primero para móvil, funciona en desktop
- Dark mode NO — paleta corporativa clara
- 🔴 **Sin guion largo («—») en los textos que ve el usuario** (pedido de Oliver, 25/09/2026):
  se usa punto, coma o dos puntos. Aplica a pantallas, mensajes de error de la API, PDFs y
  correos. Quedan fuera los comentarios, los logs y el «—» que marca una celda sin dato
  (decisión pendiente). Las descripciones de asientos ya escritas en el libro no se tocan.

## 8. CUENTAS Y PROPIEDAD
- **GitHub:** cuenta de Oliver (el desarrollador). El repo es propiedad de Oliver.
- **Supabase:** cuenta del CLIENTE (Integra Legal). El proyecto Supabase se crea en la cuenta del cliente. Oliver NO debe usar su propia cuenta de Supabase para este proyecto.
- **Vercel:** cuenta del CLIENTE (Integra Legal). El deploy se hace desde la cuenta del cliente. Oliver NO debe usar su propia cuenta de Vercel para este proyecto.
- **Implicación:** las env vars de Supabase (URL, ANON_KEY, SERVICE_ROLE_KEY) y el proyecto de Vercel serán proporcionadas por el cliente. No asumir valores propios. Solicitar credenciales antes de configurar.

### 🔴 El archivo de credenciales de producción — existe, y ningún agente lo toca

`.env.produccion.local` guarda el `SUPABASE_SERVICE_ROLE_KEY` de **producción**
(la clave que salta RLS). Existe por una sola razón: `scripts/backup-supabase.mjs`
necesita leer producción para respaldarla, y **a propósito no usa `.env.local`** —
desde Fase 0 `.env.local` apunta a staging, y un respaldo que guarda datos de
prueba rotulándolos como producción es peor que no tener respaldo.

**Lo corre la tarea programada de Windows «Respaldo Base Integra»**
(`OneDrive\Backups\Respaldar-Base-Integra.bat`), fuera de Claude Code. El script
es de **solo lectura** contra producción: descarga las tablas a JSON y los
archivos del bucket, y aborta si el project ref no es el de producción.

🔒 **Ningún agente lo lee, lo carga ni lo nombra.** Lo hacen cumplir
`.claude/settings.json` (reglas `deny`) y el hook
`.claude/hooks/bloquear-env-produccion.mjs`, que rechaza cualquier comando que
mencione el archivo — `cat`, `type`, `Get-Content`, `source`, `python -c open(…)`
y las demás formas que una regla de permisos por ruta no alcanza. El bloqueo es
**grueso a propósito**: también rechaza mirar si el archivo existe, y también
rechaza invocar `backup-supabase.mjs`. Si hace falta un chequeo así, lo corre una
persona con `! <comando>`.

Nunca estuvo en git: lo cubre `.gitignore` (`.env*.local`) y se verificó contra
todo el historial de todas las ramas el 22/09/2026.

## 9. ENTORNO

Desde **Fase 0 (2026-08-25)** hay dos bases de datos separadas. Antes de esa fecha
`localhost` escribía en la base real del bufete; la frase "localhost = dev, Vercel = prod"
que vivía acá era falsa y por eso se corrigió.

| Entorno | Corre en | Supabase | Datos |
|---|---|---|---|
| **Local** | `localhost:3000` | staging (`xtyenhakplrkyifbcaow`) | Ficticios |
| **Preview / Development** | deploys de Vercel por rama | staging (`xtyenhakplrkyifbcaow`) | Ficticios |
| **Production** | URL de Vercel del cliente (auto-deploy desde `main`) | producción (`uqmmkklbhzxqybljiecs`) | **Reales** |

- **Por qué importa:** los asientos del ledger son inmutables por diseño (los triggers de
  `023_contabilidad_fase1_ledger.sql` rechazan UPDATE y DELETE). Un error de prueba contra
  producción no se borra: queda en los libros que el contador certifica ante la DGI.
- **Señal visual:** la app muestra una banda arriba de todo cuando NO corre contra
  producción (ámbar = staging, violeta = local, roja = entorno sin definir). En producción
  no hay banda. Vive en `src/components/env-banner.tsx` + `src/lib/env/app-env.ts`.
- **Variable de control:** `NEXT_PUBLIC_APP_ENV` (`local` | `staging` | `production`).
- **Supabase:** ambos proyectos son de la cuenta del cliente, RLS por `tenant_id`.
- **Levantar staging, regenerar datos, y qué migración va y cuál no:** `sop.md` SOP-012 y
  `docs/staging/inventario-migraciones.md`.

## 10. CONVENCIONES DE CÓDIGO
- TypeScript strict mode
- Nombres de componentes en PascalCase
- Nombres de archivos en kebab-case
- Server Components por defecto, Client Components solo cuando necesario
- Imports absolutos con `@/`
- Supabase client: server-side con `createServerComponentClient`, client-side con `createClientComponentClient`

## Módulo Finanzas — Anulación de facturas

### Regla del 09/09/2026 — IMPLEMENTADA el 22/09/2026 (Bloque 5, SOLO staging)

Acta de la reunión con RM:

> **Una factura de venta sólo se anula dentro del MISMO MES.** Cerrado el mes, la
> corrección es **nota de crédito con fecha del día** — nunca con la fecha del
> documento original.

Y su par, que aplica a todo el módulo contable:

> **La reversión lleva SIEMPRE la fecha en que se hace**, nunca la del asiento
> que revierte.

### Estado actual (desde `794e686` / `dcbdd23`, staging)

Las abogadas y admins anulan y emiten notas de crédito desde el detalle de la factura:
- **"Anular factura"** visible cuando status ∈ {emitida, parcialmente_pagada, pagada}, **el mes de
  `issue_date` está abierto y la factura no tiene NC** (053). Modal con motivo obligatorio (3–1000).
  Con pagos aplicados el modal bloquea ("reverse los pagos primero").
- La anulación es **NC total automática + reversión del asiento con fecha de hoy + `anulada`**, en
  UNA transacción (RPC `cancel_invoice_with_reversal`, 052; `cancelInvoice()` en
  `api/invoices.ts` con DELETE compensatorio de la NC si el RPC falla). Sin asiento propio para la NC.
- **"Nota de crédito"** (por líneas con cantidad) convive con Anular cuando el mes está abierto y
  **lo reemplaza cuando está cerrado**, con el aviso de D4. Es `POST /api/finanzas/credit-notes` →
  `emitCreditNote` → asiento propio `nota_credito`. Con una NC parcial, Anular desaparece y queda
  solo NC para el resto.
- Permisos: admin + abogada (NO contador, NO asistente). El contador VE la NC (`/finanzas/notas-credito/{id}`) y su PDF.
- El "GATE CONTABLE (02/09/2026)" que bloqueaba anular cualquier factura con asiento se eliminó:
  la reversión real lo reemplaza.
- T2 permite emitida→anulada y parcialmente_pagada→anulada; NO pagada→anulada (se reversan los cobros primero).

Schema relevante:
- invoices.cancellation_reason TEXT NULL, invoices.cancelled_at TIMESTAMPTZ NULL (B4)
- invoices.credited_total NUMERIC derivada (051); balance_due la resta
- credit_notes: 13 columnas fiscales + fe_estado 'no_emitida' (051); credit_note_lines.invoice_line_id
- Migrations: 20260507000001 (B4), 051, 052, 053 (Bloque 5, SOLO staging)

### Estado futuro (Camino 2, post-integración eFactura)

Cuando se complete la integración con la API de eFactura, `cancelInvoice()` y `emitCreditNote()`
deben extenderse con la siguiente lógica de bifurcación:

| Escenario | Acción | Endpoint DGI |
|---|---|---|
| Factura sin dgi_cufe (pre-integración o falla) | Anular solo en BD interna (hoy) | — |
| dgi_cufe registrado, < 182h desde dgi_fecha_autorizacion | Anular en DGI + BD | POST /api/v1/InvoiceEvents/CreateCancellation con cancellationReason |
| dgi_cufe registrado, ≥ 182h | NC obligatoria (no anular) | POST /api/v1/Invoices con tipoDocumento=04 — la NC contable ya existe; falta el envío |
| Anulada manualmente en portal eFactura | Detectar via polling, sync BD | GET /Invoices/{id} |

Activos ya preparados para Camino 2:
- cancellation_reason → mapea 1:1 a cancellationReason del payload DGI
- cancelled_at → auditoría interna
- dgi_fecha_autorizacion → cálculo de ventana 182h
- dgi_cufe → identificador único para el endpoint de cancelación
- credit_notes.fe_estado / punto_facturacion / numero_documento / ef_invoice_uuid (051) → la NC ya tiene dónde guardar la respuesta del PAC
- cancelInvoice() y emitCreditNote() → puntos únicos donde se intercepta para agregar la llamada DGI

Items pendientes Camino 2:
- Cliente API eFactura server-side para NC (tipo 04)
- Helper canCancel() que retorna 'anular' | 'nc-obligatoria' según horas transcurridas
- UI condicional en CancelInvoiceDialog (≥182h bloquea botón y sugiere NC)
- Polling sync portal eFactura (no hay webhook documentado)
- Manejo idempotencia: cola de retry o flag pending_sync si DGI cae después del UPDATE local
- Pregunta a ideati (task_plan.md): ¿la DGI acepta una NC enviada semanas después de su fecha contable?

## Sprint 2E.1 Cotizaciones — Backend (Cerrado 2026-05-13)

### Implementado en producción
- Módulo Cotizaciones backend completo (8 endpoints REST)
- Endpoints: /api/finanzas/quotes/{POST,GET}, /api/finanzas/quotes/[id]/{GET,PATCH,DELETE},
  /cancel, /send, /mark-accepted, /mark-rejected, /convert, /api/finanzas/configuracion/terms-template/{GET,PUT}
- Schema: tabla quotes 35 columnas, quote_lines 18 columnas, quote_terms_template con seed T&C panameña
- Sequence quote: last_number=1268, próxima COT-001269
- Refactor clients: columna active eliminada, reemplazada por client_status (prospect|active|inactive) + client_type (persona_natural|persona_juridica)
- Backfill client_type desde type legacy: 31 persona_natural, 28 persona_juridica, 5 NULL
- Gate facturas: createInvoice rechaza si client_status != 'active'
- Validación promoción prospect→active: requiere tax_id, tax_id_type, email
- Creación inline de prospect desde createQuote
- convertToInvoices: cotización aceptada → 1 o 2 facturas (HON/REI) según líneas mixtas

### NO implementado (queda para sprints futuros)
- UI de Cotizaciones (Fase 2E.2 — listado, crear, editar, detalle)
- PDF generation + envío email Resend (Fase 2E.3)
- Portal público con token único (Fase 2E.4)
- Cron de expiración automática (Fase 2E.4)

### Lecciones aprendidas
- **Schema y código DEBEN moverse en lock-step**. NUNCA dropear columnas antes de refactorizar y verificar código en producción.
- **Patrón seguro de migración destructiva**: agregar columna nueva → backfill → refactor código → deploy + verificar prod → drop columna vieja en migración separada.
- **El hotfix GENERATED ALWAYS AS** sirve como puente temporal seguro cuando se dropea una columna que aún tiene referencias en código.
- **Voseo argentino** es un anti-patrón en el proyecto (tuteo neutro panameño obligatorio en UI).

## Sprint 2E.2 UI Cotizaciones — Cerrado 2026-05-13

### Implementado en producción
- 5 pantallas nuevas en /finanzas/cotizaciones/* (listado, nueva, detalle, editar, configuracion)
- 18 componentes UI nuevos en src/app/finanzas/cotizaciones/_components y src/components/finanzas/cotizaciones/
- Sidebar actualizado con entradas Cotizaciones (admin/abogada/contador) y Plantilla T&C (solo admin)
- Toast cross-módulo: invoice-success-toast lee ?converted=N para mostrar mensaje violeta cuando se llega desde conversión de cotización
- Loading + Error boundaries en /finanzas/cotizaciones/*

### Decisiones de UX implementadas (D1-D7)
- D1: Toggle visible siempre con 2 secciones radio (cliente existente vs prospecto nuevo)
- D2: Una tabla con dropdown HON/REI por línea + indicador visual + totales agrupados por kind
- D3: Conversión con modal preview "1-2 facturas" → redirect al detalle de la 1ra con toast
- D4: Botón Enviar cambia status + muestra link público copiable (NO email, NO mailto)
- D5: Botones de acción en header del detalle según status (Marcar Aceptada/Rechazada/Cancelar)
- D6: Editor T&C en /finanzas/cotizaciones/configuracion, admin-only, 403 redirect para otros roles
- D7: Badges de status con paleta completa (gris/azul/verde/rojo/ámbar/violeta)

### NO implementado (queda para sprints futuros)
- Envío real de email vía Resend (Fase 2E.3)
- Portal público /cotizacion/[token] para que el cliente apruebe/rechace (Fase 2E.4)
- Generación de PDF descargable (Fase 2E.3)
- Cron de expiración automática (Fase 2E.4)

### Lecciones aprendidas
- Reordenamiento por dependencia de compilación: ConvertToInvoicesDialog se entregó en Fase C
  (no D) porque el detalle ya lo importa para el estado aceptada. Mantenido en su fase nominal
  conceptualmente pero implementado donde la compilación lo requería.

## Sprint 2E.3 + 2E.3.2 — Cerrado 2026-05-14

### Implementado
- PDF generation on-demand con cache por hash SHA-256 (regenera solo si el contenido cambia)
- Email Resend con PDF adjunto (DNS verified para `integra-panama.com`)
- Tabla `documents` extendida polimórfica: `source`, `source_version`, `source_generated_at`, `source_content_hash`, `entity_type='quote'`
- CHECK `documents_source_check` future-proof preparado para `'invoice'` y `'auto_invoice_pdf'` (Fase 2F)
- Botón "Descargar PDF" disponible en todos los estados del detalle de cotización
- Botón "Reenviar" para estados `enviada`/`aceptada`/`rechazada`: status NO cambia, refresca `sent_at` + `sent_to_email` + `sent_by` y reutiliza el `public_token` original
- Visibilidad doble: PDF auto-generado aparece en la sección Documentos del cliente con badge violeta "PDF Cotización COT-XXXXXX"
- Bloqueo de delete manual para documentos con `source != 'manual'` (gestionados automáticamente)
- Portal público placeholder `/cotizacion/[token]` (paleta navy/gold, mobile-first, sin sidebar CRM)
- Middleware actualizado para permitir acceso público sin auth a `/cotizacion/[token]`
- **Campo `title` OBLIGATORIO (3-100 chars)** en `quotes`, con CHECK `quotes_title_length`
- Backfill aplicado: 4 cotizaciones legacy con título auto-generado `'Cotización {cliente} {DD/MM/YYYY}'`
- Hash del PDF incluye `title` (regenera el PDF si el título cambia)
- Listado de cotizaciones: 3 líneas en columna Cliente (nombre + título + client_number)
- Detalle con título prominente debajo del `COT-XXXXXX` (`text-lg font-semibold text-gray-700`)
- PDF con banda de título `Helvetica-Oblique 11pt navy` debajo del header navy/gold
- Email subject: `Cotización COT-XXXXXX: {título} · Integra Legal`
- Email cuerpo HTML/texto plano con título descriptivo (italic semibold en HTML, "Referencia: …" en texto plano)

### Bugs corregidos en este sprint
- **PDF download redirigía la pestaña actual** (causa: `window.open` con noopener fallback). Fix: anchor programático con `document.createElement('a')`.
- **Banner verde mentiroso en envío de email**: la validación de Resend solo chequeaba `!error`, no validaba `data.id` presente. Resultado: cotizaciones que NO llegaban al inbox aparecían como "enviadas" en la UI. Fix: requiere `data.id` Y `error null`, con log estructurado en todos los casos.

### SHAs Sprint 2E.3.2
- `a5ef205` chore - remove endpoint debug test-resend post-hotfix
- `ff80542` feat - migración SQL agregar columna title obligatoria
- `25cf13d` feat - backend campo title obligatorio + input en form
- `31b5995` feat - UI título en listado/detalle/PDF/email/portal

### Pendiente Sprint 2E.4
- Portal público FUNCIONAL (cliente acepta/rechaza desde link con log de IP/UA)
- Cron de expiración automática (`enviada` → `expirada` cuando pasa `valid_until`)
- Notificación a abogada cuando el cliente responde

### Pendiente operativo (no técnico)
- Confirmar con las licenciadas qué email de contacto mostrar en el portal público. Hoy está hardcoded `contacto@integra-panama.com` en `src/app/cotizacion/[token]/page.tsx`, dirección que probablemente no existe. Es un cambio de una sola línea cuando lo confirmen.
