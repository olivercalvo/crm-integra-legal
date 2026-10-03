# Propuesta: bitácoras automáticas de auditoría (contable y legal)

> 03/10/2026 · Pedido de Josuarth: quién, qué, cuándo, sobre qué documento, valor anterior y nuevo.
> **Decisión de Oliver (03/10): DOS bitácoras, una por módulo**, cada una con su tabla, su cadena de hash,
> su pantalla y sus permisos.
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
| 🔴 **¿Se puede alterar?** | **Sí** (confirmado también en producción el 03/10; la `084` lo corrige, ver b.8). Política RLS `audit_tenant_isolation` **FOR ALL** con `tenant_id = tenant_id()`. Grants de `INSERT, UPDATE, DELETE, TRUNCATE` a `anon` y `authenticated`. Sin triggers de protección. **Cualquier usuario logueado puede editar o borrar la bitácora de su propio bufete** con el cliente de Supabase del navegador. No sirve como prueba de auditoría |

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

## b. Propuesta: dos bitácoras, una por módulo

### b.1 Qué va en cada una

| | **Bitácora contable** | **Bitácora legal** |
|---|---|---|
| Tabla | `auditoria.bitacora_contable` | `auditoria.bitacora_legal` |
| Contenido | Todo el módulo Finanzas (lista abajo) | Todo el módulo Legal: clientes (ficha y estado), casos, documentos, tareas, comentarios, catálogos legales (`cat_*`), gastos del caso y cobros del caso (`client_payments`) |
| Tablas con trigger | `invoices`, `invoice_lines`, `credit_notes`, `credit_note_lines`, `credit_note_applications`, `fe_emisiones`, `fe_anulaciones`, `payments`, `payment_applications`, `payment_reversals`, `business_expenses`, `expense_lines`, `supplier_payments`, `supplier_credit_notes`, `supplier_credit_note_applications`, `journal_entries` (solo INSERT), `journal_imports`, `accounting_periods`, `chart_of_accounts`, `tax_codes`, `numbering_sequences`, `services_catalog`, `finanzas_parametros`, `quotes`, `quote_lines`, `quote_terms_template`, `suppliers` | `clients`, `cases`, `documents`, `tasks`, comentarios, `cat_*`, `expenses`, `client_payments`, `users` |
| Cadena de hash | Propia | Propia |
| Ancla | Al cerrar cada período contable (en `accounting_chain_anchors`) | Diaria, con el respaldo: Legal no tiene períodos |
| Quién la ve | **El contador** (decisión del 03/10) | **El admin del bufete** |
| Pantalla | `/finanzas/auditoria` | `/legal/admin/auditoria` (reemplaza la de hoy, que lee `audit_log`) |
| Nadie la edita ni la borra | Sí, ni el admin ni el contador (b.4) | Igual |

**Qué entra en la bitácora contable:**
- facturas, NC y ND: crear, editar borrador, emitir, anular, aplicar saldo a favor;
- DGI: envíos, anulaciones, CUFE cargado a mano y documentos «interna»;
- cobros: registrar, aplicar, reversar, eliminar;
- compras, pagos a proveedores y NC de proveedor;
- asientos manuales, reversiones e importaciones;
- períodos (cerrar y reabrir) y cierre anual;
- plan de cuentas (incluidas subcategoría y cuenta control), tasas de impuesto, series
  (`numbering_sequences`) y servicios del catálogo;
- parámetros contables (ISR, fecha de corte);
- cotizaciones y su plantilla;
- proveedores.

### b.2 Lo que toca a los dos módulos

Hay tres casos:
1. **Usuarios y roles.**
2. **Clientes**: son de Legal, pero su RUC, DV, nombre y tipo van en cada factura y en el 100004.
3. **Gastos de trámite** (`expenses`): se cargan en el caso y generan un asiento (130003 / 200001) y su pago.
   Los cobros del caso (`client_payments`) no generan asiento: son solo de Legal.

**Opción 1 (recomendada): cada tabla tiene UN módulo dueño, y lo que tiene efecto contable se escribe
también en la contable.** Una sola transacción, dos filas, con el mismo `evento_id` para unirlas.

| Tabla | Bitácora del dueño | Además en la contable |
|---|---|---|
| `clients` | Legal, todo el cambio | Solo si cambia un campo fiscal: `name`, `ruc`/`tax_id`, `digito_verificador`, `tax_id_type`, `client_type`, `tipo_receptor_fe`, ubicación fiscal, `client_status` (activo = facturable) |
| `expenses` | Legal, todo el cambio | Si cambia algo que entra al asiento (monto, cuenta, proveedor, `supplier_invoice_number`, fecha de registro) o el gasto se registra en el libro, se reversa o se paga |
| `client_payments` | Legal | Nunca (no postea) |
| `users` | Legal (el admin administra usuarios) | Si el cambio toca quién ve Finanzas: alta o baja de un usuario admin, abogada o contador, o un cambio de rol desde o hacia esos roles |

Así el contador ve en su bitácora todo lo que puede cambiar una cifra o un permiso contable, sin ver el resto
de Legal (la descripción de un caso, sus documentos). El admin ve el cambio completo en la legal.

**Opción 2: una sola bitácora por tabla, sin duplicar.**
- `clients` y `users` solo en Legal; `expenses` solo en la contable.
- Es más simple, pero el contador no se entera de que alguien cambió el RUC de un cliente (que cambia lo que
  se manda a la DGI) ni de que alguien se dio el rol de contador.
- Y el admin no ve en Legal la edición de un gasto de su caso.

**Recomiendo la opción 1.** La duplicación es chica (solo los campos con efecto contable) y deja cada
pantalla completa para quien la mira.

### b.3 Campos de cada fila (iguales en las dos)

| Campo | Contenido |
|---|---|
| `id` | bigint identity, por bitácora |
| `evento_id` | uuid. El mismo en las dos bitácoras cuando un cambio se escribe en ambas (b.2) |
| `tenant_id` | del registro, nunca del request |
| `ocurrido_en` | `timestamptz` (UTC en la base), **mostrado en hora de Panamá** en pantalla y Excel |
| `usuario_id`, `usuario_nombre`, `rol` | nombre y rol **copiados** en el momento |
| `accion` | `crear`, `editar`, `emitir`, `anular`, `reversar`, `enviar_dgi`, `cerrar`, `reabrir`, `eliminar`, `legado`… |
| `tabla`, `registro_id`, `documento` | la fila y su número legible (`FAC-HON-000022`, el código del caso, `2026-08`) |
| `cambios` | `jsonb` con **solo lo que cambió**: `{"campo": [antes, después]}` |
| `origen` | `usuario`, `sistema` (trigger derivado) o `legado` (filas de `audit_log`) |
| `hash`, `hash_anterior` | cadena propia de esa bitácora |

### b.4 Solo agregar: nadie edita ni borra, ni el admin

Lo mismo para las dos tablas:
1. Esquema `auditoria`, fuera de `public`: PostgREST no lo expone.
2. `REVOKE ALL` a `anon`, `authenticated` y `service_role`. Se escribe solo por la función del trigger
   (`SECURITY DEFINER`, cuyo dueño es un rol sin login).
3. Triggers `BEFORE UPDATE OR DELETE` y `BEFORE TRUNCATE` que rechazan salvo al superusuario: **el mismo
   mecanismo de la `084`**, ya simulado en staging (11/11).
4. Lectura por RPC `SECURITY DEFINER` que filtra por el `tenant_id` del perfil y por rol (contable:
   contador; legal: admin).
5. Cadena de hash por bitácora y ancla externa (b.1).

**El límite:** `supabase_admin` (el superusuario de la plataforma) puede quitar un trigger. No se puede
impedir dentro de la base; la cadena con ancla lo detecta, como en el ledger.

### b.5 Captura: triggers en la base (recomendado)

- **Una función genérica** `auditoria.registrar(modulo)`. El trigger de cada tabla dice a qué bitácora va, y
  en las tablas de b.2 la función decide si además escribe en la contable.
- **El usuario:** `auth.uid()` con la sesión, o el header `x-actor-id` que pone el servidor al crear el
  cliente de servicio (`current_setting('request.headers')`). Sin ninguno, `sistema`. Hoy **todo** se escribe
  con el cliente de servicio (revisado el 03/10), así que el header es el camino principal.
- **Por qué triggers y no código:** las 32 escrituras de `audit_log` son a mano, y emitir, cobrar y anular
  nunca escribieron. Un trigger no se olvida.

### b.6 Pantallas

| | Contable | Legal |
|---|---|---|
| Ruta | `/finanzas/auditoria` (nueva) | `/legal/admin/auditoria` (la de hoy, que pasa a leer la bitácora nueva) |
| Quién | Contador | Admin |
| Filtros | Fechas (Panamá), usuario, acción, módulo (ventas, cobros, compras, libro, catálogos, configuración), documento, origen | Fechas, usuario, acción, cliente, caso, tabla, origen |
| Exportar | Excel con `exportar-xlsx.ts`, mismos roles. Se agrega a `EXPORTS` de `nav-guard.test.ts` | Igual |
| Integridad | «Verificar integridad» contra el ancla del período | Contra el ancla diaria |

Las dos se agregan a `route-access.ts` y `nav-config.ts`; `nav-guard.test.ts` verifica que no se separen.

### b.7 Las filas viejas de `audit_log`, como «legado»

No se borran ni se editan (con la `084` ya no se puede). Se **copian** una vez a la bitácora que corresponde:
- con `origen = legado`, y el usuario y la fecha originales;
- con `cambios` armado desde `field`, `old_value` y `new_value`;
- entrando a la cadena de hash de la bitácora nueva al copiarse: la cadena garantiza desde ese momento, no
  antes.

| `entity` en `audit_log` | Bitácora |
|---|---|
| `cases`, `documents`, `client_payments`, `cat_classifications`, `cat_team` y los demás `cat_*` | Legal |
| `clients` | Legal; **también contable** si `field` es un campo fiscal (b.2) |
| `users` | Legal; **también contable** si el cambio es de rol o de un usuario de Finanzas |
| `expenses` | Legal; **también contable** si `field` tiene efecto contable o es el comprobante del gasto |
| `business_expenses`, `payment`, `accounting_period`, `chart_of_accounts`, `suppliers`, `tax_codes`, `quotes` | Contable |
| Cualquier otro valor | Legal, marcado `sin clasificar` para revisarlo a mano (no se adivina) |

`audit_log` queda **de solo lectura** como respaldo del original. Se retira del código cuando las dos
bitácoras nuevas estén escribiendo y la copia esté verificada (conteo por `entity` igual en el origen y en el
destino).

### b.8 Rendimiento y almacenamiento

Lo mismo que se estimó para una, repartido:
- unos 2 a 4 MB por mes en total, menos de 50 MB por año;
- índices `(tenant_id, ocurrido_en)`, `(tenant_id, tabla, registro_id)` y `(tenant_id, documento)` en cada una;
- el hash serializa las inserciones **por bitácora y por bufete**: separarlas reduce la contención.

Las líneas del ledger no se auditan: son inmutables y ya están en el libro.

### b.9 Migraciones necesarias (no escritas)

1. **`084` (ya escrita, SIN APLICAR):** `audit_log` solo de agregar. Hotfix independiente, aplica limpio en
   `main`. Va primero, sola.
2. **Esquema y tablas:** `auditoria.bitacora_contable` y `auditoria.bitacora_legal`, los `REVOKE`, los
   triggers de solo agregar, los índices y los RPC de lectura por rol.
3. **Función genérica y triggers** en las tablas de b.1, con el ruteo de b.2.
4. **Anclas:** la contable en `accounting_chain_anchors` al cerrar período; la legal en anclas diarias. Las dos
   salen en el respaldo.
5. **Copia del legado** (b.7), con verificación de conteos que aborta si no coinciden.
6. Código, sin migración:
   - `createAdminClient(userId)` con el header `x-actor-id`, y un test que lo exige en las rutas que mutan;
   - las dos pantallas y sus exports;
   - quitar las escrituras manuales a `audit_log` cuando todo lo anterior esté verificado.

## Dudas para Josuarth y Oliver

1. ¿El **admin** también ve la bitácora contable (en lectura)? La decisión dice «la ve el contador», y hoy el
   admin entra a todo Finanzas.
2. ¿Lecturas sensibles (quién descargó un Excel o un PDF)? No son cambios de fila: harían falta registros
   desde el código en esas rutas.
3. ¿Cuánto tiempo se guardan? La propuesta: para siempre (son chicas).
4. Tareas y comentarios de Legal: ¿todos los cambios, o solo estado y asignación? Es lo más voluminoso de
   Legal.
