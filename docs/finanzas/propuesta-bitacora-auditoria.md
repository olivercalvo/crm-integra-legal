# Propuesta: bitácora automática de auditoría del módulo contable

> 03/10/2026 · Pedido de Josuarth: quién, qué, cuándo, sobre qué documento, valor anterior y nuevo.
> **Solo diagnóstico y diseño: nada construido, ninguna migración escrita.**
> Diagnóstico hecho contra el esquema de staging (`xtyenhakplrkyifbcaow`) y el código de la rama
> `feat/bloque1-contable`.

## a. Diagnóstico: qué existe hoy

### a.1 La tabla `audit_log` (existe desde el MVP)

| | Hoy |
|---|---|
| Columnas | `id, tenant_id, user_id, entity, entity_id, action, field, old_value, new_value, created_at`: una fila por campo cambiado, valores como texto |
| Quién escribe | **El código de la app**, a mano, en ~32 archivos (`src/app/api/clients`, `cases`, `documents`, `admin/users`, `admin/catalogs`, y en Finanzas: `business-expenses`, `suppliers`, `tax-codes`, `chart-of-accounts`, `periodos`, `quotes`, `saldo-a-favor`) |
| Qué tiene en staging | 32 filas: compras (crear), períodos (cerrar o reabrir), tasas, proveedores, clientes, un cobro, un documento borrado, una cuenta |
| Qué **no** registra | Emitir una factura, NC o ND; cobros y su reversión; pagos a proveedores; gastos de trámite; asientos manuales; importaciones; cierre anual; envíos y anulaciones ante la DGI; series; parámetros (ISR). Si una ruta se olvida de llamarla, no hay registro y nada lo detecta |
| 🔴 **¿Se puede alterar?** | **Sí.** Política RLS `audit_tenant_isolation` **FOR ALL** con `tenant_id = tenant_id()`. Grants de `INSERT, UPDATE, DELETE, TRUNCATE` a `anon` y `authenticated`. Sin triggers de protección. **Cualquier usuario logueado puede editar o borrar la bitácora de su propio bufete** con el cliente de Supabase del navegador. No sirve como prueba de auditoría |

### a.2 Lo que ya es auditable sin bitácora

| Pieza | Qué cubre | Qué no cubre |
|---|---|---|
| **Ledger** (`journal_entries` + líneas, `023`…`072`) | Cada asiento: `created_by`, `record_date` (cuándo se grabó), `transaction_date`, `content_hash` + `prev_hash` (cadena, hash v5), inmutable por trigger (sin UPDATE ni DELETE), reversiones con `reverses_entry_id` y `reversal_reason` | Solo lo que llega al libro. No ve: borradores, ediciones de documentos antes de emitir, cambios de catálogo, configuración, usuarios, envíos a la DGI |
| `verify_accounting_chain` + **`accounting_chain_anchors`** (`075`) | Detecta un asiento alterado o la cadena reescrita, contra el ancla grabada al cerrar cada período | Nada fuera del libro |
| `accounting_legajos` (`sealed_by`, `content_hash`) | Sello anual del legajo | Lo mismo |
| `created_by` en ~23 tablas (facturas, cobros, pagos, NC, compras, importaciones…), `registered_by` en `expenses` y `client_payments` | Quién **creó** el documento | Quién lo **cambió** después, quién lo emitió, quién lo anuló. **No hay `updated_by`** salvo en `finanzas_parametros` y la plantilla de T&C |
| `accounting_periods.closed_by` | Quién cerró **por última vez** | El historial: un cierre, una reapertura y un nuevo cierre pisan el dato (la reapertura sí queda en `audit_log`, que se puede borrar) |
| `fe_emisiones` (`created_by`, payload, respuesta, `cod_res`) | Cada intento de envío al PAC, completo | Los cortes antes del envío (gate fiscal, sin fila: ver la propuesta de alertas) |
| `fe_anulaciones` | Cada intento de anulación ante la DGI | — |
| Status y campos de anulación en documentos (`cancelled_at`, `cancellation_reason`) | El estado final | Quién y el antes/después |
| Supabase Auth (`auth.audit_log_entries`) | Inicios de sesión, cambios de contraseña | No es del CRM: no se ve desde la app y Supabase lo rota |

**Conclusión:**
- El libro ya es auditable por diseño.
- Lo que falta es todo lo que pasa **alrededor** del libro: documentos antes de emitir, anulaciones, catálogos,
  configuración, usuarios, envíos.
- La bitácora que hay no es confiable: se puede borrar y depende de que cada ruta se acuerde de escribirla.

## b. Propuesta

### b.1 Eventos

| Grupo | Eventos | Tablas que los disparan |
|---|---|---|
| Documentos de venta | crear, editar borrador, emitir, anular, NC, ND, aplicar saldo a favor | `invoices`, `invoice_lines`, `credit_notes`, `credit_note_lines`, `credit_note_applications` |
| DGI | enviar, autorizada, rechazada, anular ante la DGI, cargar CUFE del portal, marcar interna | `fe_emisiones`, `fe_anulaciones`, columnas `fe_estado`, `dgi_cufe*` de `invoices` y `credit_notes` |
| Cobros | registrar, aplicar, reversar, eliminar (los sin asiento) | `payments`, `payment_applications`, `payment_reversals` |
| Compras y pagos | crear, editar, pagar, reversar pago, NC de proveedor | `business_expenses`, `expense_lines`, `supplier_payments`, `supplier_credit_notes`, `supplier_credit_note_applications` |
| Gastos de trámite | crear, editar, registrar en el libro, reversar, pagar | `expenses` |
| Libro | asiento manual, reversión, importación y su reversión, cierre anual | `journal_entries` (solo INSERT: es inmutable), `journal_imports` |
| Períodos | cerrar, reabrir | `accounting_periods` |
| Catálogos contables | plan de cuentas (incluida la subcategoría y la cuenta control), tasas, series | `chart_of_accounts`, `tax_codes`, `numbering_sequences`, `services_catalog` |
| Configuración | tasa de ISR y los parámetros que vengan (fecha de corte, etc.) | `finanzas_parametros`, `quote_terms_template` |
| Terceros | clientes (datos fiscales: RUC, DV, tipo), proveedores (RUC, DV, plazo, cuenta por defecto) | `clients`, `suppliers` |
| Usuarios y roles | alta, baja, cambio de rol, activar o desactivar | `users` |

### b.2 Campos de cada fila

| Campo | Contenido |
|---|---|
| `id` | bigint identity (ordena y numera) |
| `tenant_id` | del registro, nunca del request |
| `ocurrido_en` | `timestamptz` (UTC en la base). **Se muestra en hora de Panamá** (`America/Panama`) en la pantalla y el Excel |
| `usuario_id`, `usuario_nombre`, `rol` | el nombre y el rol **se copian** en el momento: si el usuario cambia de rol o se da de baja, la fila sigue diciendo lo que era |
| `accion` | `crear`, `editar`, `emitir`, `anular`, `reversar`, `enviar_dgi`, `cerrar`, `reabrir`, `eliminar`, … (derivada del cambio, ver b.4) |
| `tabla`, `registro_id` | la fila tocada |
| `documento` | número legible: `FAC-HON-000022`, `CO-000012`, `AD-000003`, `2026-08` (período) |
| `cambios` | `jsonb`, **solo lo que cambió**: `{"status": ["emitida", "anulada"], "cancellation_reason": [null, "…"]}`. En un alta, los campos clave. En una baja, la fila entera |
| `origen` | `usuario` o `sistema` (un trigger derivado, como `amount_paid` de T7a, con `pg_trigger_depth() > 1`) |
| `hash`, `hash_anterior` | cadena como la del ledger (b.3) |

Columnas que **no** se registran porque cambian solas y no dicen nada: `updated_at`. Las derivadas
(`amount_paid`, `credited_total`, `status` de T7a) sí, con `origen = sistema`. Explican por qué una factura pasó
a «pagada».

### b.3 Solo agregar: nadie edita ni borra, ni el admin

Cómo se garantiza en Supabase, en capas:

1. **Esquema propio `auditoria`**, fuera de `public`: PostgREST no lo expone, así que no hay endpoint REST
   que lo toque.
2. **`REVOKE ALL` a `anon`, `authenticated` y `service_role`.** Nadie tiene `INSERT`, `UPDATE`, `DELETE`
   ni `TRUNCATE` directo. La escritura es solo por la función del trigger, `SECURITY DEFINER`, cuyo dueño es
   un rol sin login.
3. **Triggers `BEFORE UPDATE OR DELETE` y `BEFORE TRUNCATE`** que lanzan excepción siempre, como los de
   inmutabilidad del ledger (`023`).
4. **Lectura** por una vista o RPC `SECURITY DEFINER` que filtra por el `tenant_id` del perfil y por rol
   (admin y contador). Es el mismo patrón de las rutas de export: el tenant sale del perfil, nunca del request.
5. **Cadena de hash** (`hash = sha256(hash_anterior ‖ contenido canónico)`, el `finanzas_contenido_v5` del
   ledger) **y ancla externa**: al cerrar cada período se graba el último `hash` en la misma
   `accounting_chain_anchors`, y sale en el respaldo diario.

**El límite honesto:** el dueño del proyecto (`postgres` en el SQL Editor) es superusuario y puede
desactivar un trigger. Eso no se puede impedir dentro de la base. La cadena con ancla lo **detecta** igual
que en el ledger: si alguien borra o edita una fila, el verificador lo encuentra contra el ancla del
respaldo. Es la misma garantía que ya tiene el libro.

### b.4 Captura: triggers en la base (recomendado), no desde el código

| | Triggers | Desde el código |
|---|---|---|
| Cobertura | Toda escritura, por cualquier camino: rutas, RPC, importaciones, scripts, el SQL Editor | Solo las rutas que se acuerdan. Hoy ya pasó: emitir, cobrar y anular no escriben `audit_log` |
| Antes y después | Exactos (`OLD` / `NEW`) | El código tiene que leer antes de escribir |
| Mantenimiento | Una función genérica; agregar una tabla es una línea | Una llamada por ruta, más su test |
| El usuario | 🔴 **El problema**: mucho se escribe con el cliente de servicio (todo el posteo, por SOP-014), y ahí `auth.uid()` es NULL | Lo tiene a mano |

**Recomendación: triggers, con el usuario por dos vías.**
1. **Sesión del usuario** (escrituras con RLS): `auth.uid()`.
2. **Cliente de servicio:** el servidor crea su cliente con un header `x-actor-id` (el `userId` del contexto
   autenticado). El trigger lo lee de `current_setting('request.headers', true)`, que PostgREST expone por
   request. El header solo lo puede poner quien tiene la clave de servicio, que vive en el servidor.
   `createAdminClient(userId)` pasa a exigir el usuario, y un test lo verifica en las rutas que mutan.
3. **Sin ninguno de los dos:** `usuario = sistema`. Es una migración o un script, y queda dicho.

La `accion` se deriva en el trigger:
- INSERT → `crear`; DELETE → `eliminar`;
- un cambio de `status` a `emitida` → `emitir`, a `anulada` → `anular`;
- un `fe_estado` → `enviar_dgi`;
- en `accounting_periods`, `status` → `cerrar` / `reabrir`;
- el resto → `editar`.

Lo que no es un cambio de fila (por ejemplo «descargó el PDF») queda fuera: no es una modificación.

### b.5 Pantalla para el contador

- **`/finanzas/auditoria`**: admin y contador. Se agrega a `route-access.ts` y `nav-config.ts`;
  `nav-guard.test.ts` lo verifica.
- **Filtros:**
  - rango de fechas (en hora de Panamá);
  - usuario;
  - acción;
  - módulo (ventas, cobros, compras, libro, catálogos, configuración, usuarios);
  - número de documento (búsqueda);
  - origen (usuario o sistema).
- **Tabla:** fecha y hora, usuario (rol), acción, documento con enlace, y un resumen «qué cambió».
  Al expandir: antes y después campo por campo.
- **Exportar a Excel** con el motor de `exportar-xlsx.ts`, el mismo filtro y la misma lista de roles.
  Se suma a `EXPORTS` en `nav-guard.test.ts`. Celdas vacías sin «—».
- **Botón «Verificar integridad»:** recorre la cadena contra el ancla, como hoy en Períodos Contables.

### b.6 Rendimiento y almacenamiento

- **Escritura:** un INSERT por fila modificada dentro de la misma transacción. Con el volumen del bufete
  (decenas o cientos de documentos al día) es imperceptible.
  - Lo más pesado es una importación de asientos: cada asiento inserta su cabecera y líneas, y las líneas del
    ledger **no** se auditan (son inmutables y ya están en el libro). Solo la cabecera y `journal_imports`.
  - El hash de la cadena obliga a serializar las inserciones por bufete, con un `FOR UPDATE` sobre el último,
    como el ledger. Con este volumen no compite.
- **Almacenamiento:** ~0.5 a 2 KB por fila (el JSONB solo lleva lo que cambió). Estimando 2,000 eventos al
  mes: **~2 a 4 MB por mes, menos de 50 MB por año.** Índices: `(tenant_id, ocurrido_en)`,
  `(tenant_id, tabla, registro_id)` y `(tenant_id, documento)`. No hace falta particionar antes de varios años.
- **Lectura:** paginada por fecha con el índice. El Excel con un tope (por ejemplo 50,000 filas) y aviso.

### b.7 Migraciones necesarias (no escritas)

1. **Esquema y tabla:** `auditoria.bitacora`, los `REVOKE`, los triggers que bloquean UPDATE, DELETE y
   TRUNCATE, los índices y la vista o RPC de lectura por tenant y rol.
2. **Función genérica** `auditoria.registrar()` (diff de `OLD`/`NEW`, actor por JWT o header, acción derivada,
   documento legible por tabla, hash encadenado) y los triggers `AFTER INSERT OR UPDATE OR DELETE` en la lista
   de b.1.
3. **Ancla:** `accounting_chain_anchors` guarda también el último hash de la bitácora al cerrar período.
   Va al respaldo diario.
4. **`audit_log` vieja:**
   - corregir YA su RLS a solo lectura (`FOR SELECT`) y `REVOKE UPDATE, DELETE, TRUNCATE` a `anon` y
     `authenticated`. Es una corrección de seguridad independiente de esta propuesta;
   - después, migrar sus filas a la bitácora nueva como `origen = legado` y retirarla del código.
5. En código, sin migración:
   - `createAdminClient(userId)` con el header;
   - el test que lo exige;
   - la pantalla y el export.

**Orden sugerido:**
1. La corrección de `audit_log` (punto 4, primera parte). Es chica y cierra un agujero hoy.
2. Después la bitácora nueva, en una ventana posterior al despliegue del Bloque 1. No toca el libro y
   puede ir sola.

## Dudas para Josuarth

1. ¿Quiere ver también **lecturas** sensibles (quién descargó el Excel de la antigüedad o el PDF de una
   factura)? No es un cambio de fila: necesitaría registro desde el código, solo en esas rutas.
2. ¿Cuánto tiempo se guarda? La propuesta es **para siempre** (es chica). Si la ley pide un mínimo, se
   respeta.
3. ¿El módulo Legal (casos, documentos, tareas) entra también, o solo el contable? Técnicamente es la misma
   función. Es una decisión de alcance y de quién puede verlo.
