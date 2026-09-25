# Inventario de migraciones — estado real vs. la base

> 🤖 **ARCHIVO GENERADO. NO EDITAR A MANO.**
> Lo produce `scripts/inventario-migraciones.mjs` leyendo el esquema de la base.
> Editarlo a mano vuelve a traer el problema que este script existe para cerrar:
> el 22/09/2026 a este documento le faltaban **catorce filas** (025–033 y 040–044),
> y por ese hueco el plan de despliegue arrancó la cola en la 034 cuando producción
> se había detenido en la 024.
>
> Para regenerarlo: `node scripts/inventario-migraciones.mjs --staging`, o
> `--sql` + `--desde` si la base es producción (sus credenciales no van a una máquina).

**Base relevada:** `staging`  
**Fecha del relevamiento:** 2026-09-25  
**Nombre de la base:** `postgres`

> **`sql/pending/` NO es una cola de pendientes.** Es un cajón donde conviven
> migraciones aplicadas hace meses con otras que nunca se corrieron. El nombre
> engaña; esta tabla no.

## Cómo leer la columna «¿aplicada?»

| | |
|---|---|
| **sí** | El objeto que deja esa migración está en la base |
| **NO** | No está |
| **?** | El marcador no se pudo resolver — casi siempre porque falta una migración anterior |
| n/a | No es una migración aplicable (verificación, consolidado, obsoleta) |
| _(heurístico)_ | Se resolvió por el **dato** y no por el esquema: el dato pudo llegar por otro camino |

## 1. `supabase/migrations/`

| Archivo | ¿aplicada? | Qué hace |
|---|---|---|
| `20260402000001_initial_schema.sql` | **sí** | Esquema base: 14 tablas, RLS por tenant_id, índices · <sub>marcador: tabla clients</sub> |
| `20260402000002_seed_data.sql` | **sí** | Catálogos iniciales del tenant · <sub>marcador: resuelto por el dato, no por el esquema</sub> _(heurístico)_ |
| `20260402000003_seed_clients_cases.sql` | **NO** | ⛔ 23 clientes + 46 casos REALES del bufete · <sub>marcador: resuelto por el dato, no por el esquema</sub> _(heurístico)_ ⚠️ Solo tiene sentido contra PRODUCCIÓN. En staging los clientes son ficticios y el conteo no prueba nada. |
| `20260403000001_fix_rls_jwt_claims.sql` | **sí** | Las funciones de RLS leen el tenant de app_metadata del JWT · <sub>marcador: función get_tenant_id()</sub> _(heurístico)_ |
| `20260403000002_add_case_fields.sql` | **sí** | 8 columnas de seguimiento en cases + follow_up_date en comments · <sub>marcador: cases.procedure_type</sub> |
| `20260403000003_add_assistant_id.sql` | **sí** | cases.assistant_id → users · <sub>marcador: cases.assistant_id</sub> |
| `20260403000004_add_client_fields.sql` | **sí** | clients.address, clients.client_since · <sub>marcador: clients.client_since</sub> |
| `20260403000005_responsible_id_to_users.sql` | **sí** | cases.responsible_id apunta a users · <sub>marcador: resuelto por el dato, no por el esquema</sub> _(heurístico)_ |
| `20260403000006_seed_complete_demo.sql` | n/a | Innecesario hoy; no se corre en ninguna base nueva |
| `20260403000010_complete_demo_data.sql` | n/a | Innecesario hoy |
| `20260403000011_fill_clients_and_documents.sql` | n/a | Innecesario hoy |
| `20260403000012_todos_and_prospects.sql` | **sí** | personal_todos, todo_comments, todo_documents, prospects · <sub>marcador: tabla personal_todos</sub> |
| `20260403000013_extend_document_entity_types.sql` | **sí** | documents.entity_type acepta 'task' y 'comment' · <sub>marcador: documents_entity_type_check menciona 'comment'</sub> |
| `20260404000001_v1_1_feedback_changes.sql` | n/a | Reemplazada por _fixed. NO correr |
| `20260404000001_v1_1_feedback_changes_fixed.sql` | **sí** | Cambios de feedback v1.1 · <sub>marcador: tabla client_payments</sub> _(heurístico)_ |
| `20260404000002_payment_type.sql` | **sí** | client_payments.payment_type · <sub>marcador: client_payments.payment_type</sub> |
| `20260405000001_client_responsible_lawyer.sql` | **sí** | clients.responsible_lawyer_id · <sub>marcador: clients.responsible_lawyer_id</sub> |
| `20260504000001_add_contador_role.sql` | **sí** | Rol 'contador' en el CHECK de users.role · <sub>marcador: users_role_check menciona 'contador'</sub> |
| `20260505000001_finanzas_extend_clients.sql` | **sí** | Columnas fiscales en clients · <sub>marcador: clients.tax_id_type</sub> |
| `20260505000002_finanzas_catalogos.sql` | **sí** | chart_of_accounts, tax_codes, services_catalog, numbering_sequences · <sub>marcador: tabla chart_of_accounts</sub> |
| `20260505000003_finanzas_b3a_quotes.sql` | **sí** | quotes + quote_lines · <sub>marcador: tabla quotes</sub> |
| `20260505000004_finanzas_b3b_invoices.sql` | **sí** | invoices + invoice_lines · <sub>marcador: tabla invoices</sub> |
| `20260505000005_finanzas_b3c_credit_notes.sql` | **sí** | credit_notes + credit_note_lines · <sub>marcador: tabla credit_notes</sub> |
| `20260505000006_finanzas_b3d_payments.sql` | **sí** | payments + payment_applications · <sub>marcador: tabla payment_applications</sub> |
| `20260505000007_finanzas_b3e_triggers.sql` | **sí** | Los triggers T1–T8: transiciones, inmutabilidad, recálculo de totales · <sub>marcador: función finanzas_validate_status_transition()</sub> |
| `20260506000001_finanzas_b4_schema_prep_dgi.sql` | **sí** | 4 columnas DGI en invoices · <sub>marcador: invoices.dgi_cufe</sub> |
| `20260507000001_finanzas_b4_anular_factura.sql` | **sí** | cancellation_reason, cancelled_at + transición a 'anulada' · <sub>marcador: invoices.cancellation_reason</sub> |
| `20260508000001_clients_add_status_and_type.sql` | **sí** | client_status, client_type · <sub>marcador: clients.client_status</sub> |
| `20260508000002_quotes_extension_and_terms_template.sql` | **sí** | ~19 columnas en quotes + quote_terms_template · <sub>marcador: tabla quote_terms_template</sub> |
| `20260508000003_clients_drop_active_legacy.sql` | **sí** | Dropea clients.active · <sub>marcador: resuelto por el dato, no por el esquema</sub> _(heurístico)_ |
| `migration_completa.sql` | n/a | NO correr: se pisa con las numeradas |
| `migration_final_consolidada.sql` | n/a | NO correr |

## 2. `sql/pending/`

| Archivo | ¿aplicada? | Qué hace |
|---|---|---|
| `001_fix_case_code_civ_002_to_ext.sql` | **sí** | Re-numera CIV-002 → EXT-001 · <sub>marcador: resuelto por el dato, no por el esquema</sub> _(heurístico)_ |
| `002_enable_unaccent_and_search_rpcs.sql` | **sí** | Extensión unaccent + RPCs de búsqueda universal · <sub>marcador: función f_unaccent()</sub> |
| `004_verify_familia_classification.sql` | n/a | No modifica nada: no hay nada que aplicar ni que detectar |
| `005_add_familia_classification.sql` | **sí** | Clasificación FAMILIA (prefijo FAM) · <sub>marcador: resuelto por el dato, no por el esquema</sub> _(heurístico)_ |
| `006_extend_documents_for_auto_pdfs.sql` | **sí** | documents.source / source_version / source_content_hash + entity_type 'quote' · <sub>marcador: documents.source_content_hash</sub> |
| `007_quotes_add_title.sql` | **sí** | quotes.title NOT NULL + CHECK 3-100 + backfill · <sub>marcador: quotes.title</sub> |
| `008_extend_chart_of_accounts.sql` | **sí** | is_system, account_name_qb, description + 17 cuentas · <sub>marcador: chart_of_accounts.is_system</sub> |
| `009_create_tax_payments.sql` | **sí** | Tabla tax_payments · <sub>marcador: tabla tax_payments</sub> |
| `010_create_business_expenses.sql` | **sí** | Tabla business_expenses (compras del bufete) · <sub>marcador: tabla business_expenses</sub> |
| `011_business_expenses_rls_abogada.sql` | **sí** | RLS: la abogada crea/edita/borra gastos del bufete · <sub>marcador: 4 política(s) sobre public.business_expenses</sub> _(heurístico)_ |
| `012_extend_services_quotes_observations.sql` | **sí** | services_catalog.sort_order + quotes.observations + credit_notes.observations · <sub>marcador: services_catalog.sort_order</sub> |
| `013_create_observation_templates.sql` | **sí** | Catálogo observation_templates · <sub>marcador: tabla observation_templates</sub> |
| `014_quotes_estado_emitida.sql` | **sí** | 'emitida' en el CHECK de quotes.status + reescribe finanzas_validate_status_transition · <sub>marcador: quotes_status_check menciona 'emitida'</sub> |
| `015_quote_acceptances_rejections.sql` | **sí** | quote_acceptances + quote_rejections (portal público) · <sub>marcador: tabla quote_acceptances</sub> |
| `016_quotes_source_quote_id.sql` | **sí** | quotes.source_quote_id (duplicar cotización) · <sub>marcador: quotes.source_quote_id</sub> |
| `018_cleanup_test_quotes.sql` | **sí** | Borra 18 cotizaciones de prueba (EJECUTADO EN PRODUCCIÓN 2026-05-29) · <sub>marcador: resuelto por el dato, no por el esquema</sub> _(heurístico)_ |
| `019_efactura_fase_1a_modelo_datos.sql` | **sí** | 8 columnas en clients, 9 en invoices, fe_emisiones + fe_secuencias · <sub>marcador: tabla fe_emisiones</sub> |
| `020_efactura_allocator.sql` | **sí** | RPC allocate_fe_numero · <sub>marcador: función allocate_fe_numero()</sub> |
| `021_client_numbering_sequence.sql` | **sí** | 'client' en numbering_sequences + siembra la fila · <sub>marcador: resuelto por el dato, no por el esquema</sub> _(heurístico)_ |
| `022_backfill_dv_embebido.sql` | **sí** | Extrae el DV escrito como texto (' DV NN') a digito_verificador · <sub>marcador: resuelto por el dato, no por el esquema</sub> _(heurístico)_ 🔴 Decisión explícita: NO se aplica hasta que se retome como bloque propio. ⚠️ El marcador solo tiene sentido contra PRODUCCIÓN: en staging los clientes sembrados no traen el DV embebido en el texto, así que da 'sí' por vacuidad. |
| `023_contabilidad_fase1_ledger.sql` | **sí** | Motor del ledger: 5 tablas + 6 triggers de inmutabilidad + RLS · <sub>marcador: tabla journal_entries</sub> |
| `024_chart_of_accounts_saldo_subcategoria.sql` | **sí** | chart_of_accounts.saldo_inicial y .subcategoria · <sub>marcador: chart_of_accounts.saldo_inicial</sub> |
| `025_niif18_tipo_costo_y_subcategorias.sql` | **sí** | NIIF 18: account_type gana 'cost', cuenta_control, subcategorías nuevas, cuenta 200004 · <sub>marcador: chart_of_accounts.cuenta_control</sub> Marcador decisivo del corte de producción al 22/09/2026: esta columna NO existe en prod. |
| `026_cuenta_distribucion_socias.sql` | **sí** | Cuenta 300004 Distribución a Socias · <sub>marcador: resuelto por el dato, no por el esquema</sub> _(heurístico)_ INSERT puro: no deja ningún objeto de esquema. Solo se puede detectar por el dato. |
| `027_saldo_inicial_fecha.sql` | **sí** | chart_of_accounts.saldo_inicial_fecha + CHECK 'si hay saldo, hay fecha' · <sub>marcador: chart_of_accounts.saldo_inicial_fecha</sub> |
| `028_fase2_motor_posteo.sql` | **sí** | post_journal_entry, ensure_accounting_periods, verify_accounting_chain + períodos · <sub>marcador: función post_journal_entry()</sub> |
| `029_restaurar_check_reversion.sql` | **sí** | Restaura je_reversion_requires_ref · <sub>marcador: constraint je_reversion_requires_ref</sub> |
| `030_ledger_permisos_y_periodos.sql` | **sí** | El RPC pasa a SECURITY DEFINER con EXECUTE solo para service_role · <sub>marcador: authenticated no puede ejecutar post_journal_entry()</sub> No se distingue de la 028 por el nombre de la función: se distingue por el privilegio. |
| `031_bucket_documents_privado.sql` | **sí** | El bucket documents pasa a privado · <sub>marcador: bucket documents: public = false</sub> |
| `032_amount_paid_derivado.sql` | **sí** | invoices.amount_paid derivada + guard T4b · <sub>marcador: función finanzas_guard_amount_paid()</sub> |
| `033_proveedores_entidad.sql` | **sí** | Tabla suppliers + supplier_id/due_date en business_expenses + backfill · <sub>marcador: tabla suppliers</sub> |
| `034_asiento_unico_por_documento.sql` | **sí** | UNIQUE parcial (tenant, source_type, source_id) · <sub>marcador: índice journal_entries_un_asiento_por_documento</sub> |
| `035_reembolso_a_fondos_legales.sql` | **sí** | Los 6 servicios REIM-* pasan de 2201 (pasivo) a 130003 (activo) · <sub>marcador: resuelto por el dato, no por el esquema</sub> _(heurístico)_ UPDATE de catálogo: sin objeto de esquema. Depende de que exista la cuenta 130003. |
| `036_expense_lines.sql` | **sí** | Tabla expense_lines + 4 columnas en expenses + backfill · <sub>marcador: tabla expense_lines</sub> |
| `037_expense_lines_cuenta_obligatoria.sql` | **sí** | CHECK chart_account_code NOT NULL (NOT VALID) sobre expense_lines · <sub>marcador: constraint expense_lines_cuenta_obligatoria</sub> |
| `038_gasto_tramite_al_ledger.sql` | **sí** | 'gasto_tramite' en source_type + inmutabilidad de expenses y expense_lines · <sub>marcador: función gasto_tramite_tiene_asiento()</sub> |
| `039_asientos_manuales.sql` | **sí** | journal_entries.reference e idempotency_key + redefine post_journal_entry · <sub>marcador: journal_entries.reference</sub> |
| `040_compras_con_lineas.sql` | **sí** | Una línea por compra y la cuenta del encabezado se apaga (CHECK a NULL) · <sub>marcador: constraint business_expenses_cuenta_vive_en_la_linea</sub> |
| `041_banco_del_cobro.sql` | **sí** | payments.payment_account_code · <sub>marcador: payments.payment_account_code</sub> |
| `042_pago_proveedor_source_type.sql` | **sí** | 'pago_proveedor' en el CHECK de journal_entries.source_type · <sub>marcador: journal_entries_source_type_check menciona 'pago_proveedor'</sub> |
| `043_relink_servicios_plan_vigente.sql` | **sí** | Los 5 servicios HON-* se relinkean a sus cuentas de ingreso vigentes · <sub>marcador: resuelto por el dato, no por el esquema</sub> _(heurístico)_ UPDATE de catálogo. Aborta entera si alguna de las 5 cuentas no existe, está inactiva o no es income. |
| `044_gasto_numero_factura_proveedor.sql` | **sí** | business_expenses.supplier_invoice_number · <sub>marcador: business_expenses.supplier_invoice_number</sub> |
| `045_expense_lines_tax_code_id.sql` | **sí** | expense_lines.tax_code_id (FK real) + backfill de líneas de compra · <sub>marcador: expense_lines.tax_code_id</sub> |
| `046_reversion_de_cobro.sql` | **sí** | Tabla payment_reversals + RPC reverse_payment · <sub>marcador: tabla payment_reversals</sub> |
| `047_recibo_de_caja.sql` | **sí** | Recibo de caja REC-: secuencia 'payment', índice único, CHECK de documents, backfill · <sub>marcador: índice payments_tenant_payment_number_key</sub> payments.payment_number ya existía desde b3d_payments: NO sirve como marcador. |
| `048_pagos_a_proveedores.sql` | **sí** | Tabla supplier_payments (CE-) + amount_paid derivado en compras + RPC de reversión · <sub>marcador: tabla supplier_payments</sub> |
| `049_pago_de_gasto_de_tramite.sql` | **sí** | Arco exclusivo en supplier_payments + expenses.amount_paid/status derivados · <sub>marcador: supplier_payments.expense_id</sub> |
| `050_reversion_de_gasto_de_tramite.sql` | **sí** | RPC reverse_expense_tramite · <sub>marcador: función reverse_expense_tramite()</sub> |
| `051_nota_de_credito_contable.sql` | **sí** | 13 columnas fiscales en credit_notes + invoices.credited_total + balance_due recreada · <sub>marcador: invoices.credited_total</sub> |
| `052_anulacion_con_reversion_y_nc.sql` | **sí** | RPC cancel_invoice_with_reversal + válvula finanzas.nc_compensar · <sub>marcador: función cancel_invoice_with_reversal()</sub> |
| `053_anulacion_rechaza_nc_parcial.sql` | **sí** | La anulación rechaza una factura con NC parcial en el libro · <sub>marcador: el cuerpo de cancel_invoice_with_reversal() incluye «ya tiene la nota de crédito»</sub> Es un CREATE OR REPLACE de la función de la 052: por nombre son indistinguibles. Se mira el cuerpo. |
| `054_tercero_por_linea.sql` | **sí** | journal_entry_lines.client_id / .supplier_id (dos FK reales) · <sub>marcador: journal_entry_lines.client_id</sub> |
| `055_reversion_de_asiento_manual.sql` | **sí** | RPC reverse_journal_entry + una sola reversión por asiento · <sub>marcador: índice journal_entries_una_reversion_por_asiento</sub> |
| `057_proveedor_cuenta_por_defecto_y_contacto.sql` | **sí** | suppliers gana la cuenta contable por defecto (solo COMPRAS) + los tres campos de la persona de contacto · <sub>marcador: suppliers.default_chart_account_code</sub> Bloque 8. Va después de la 033 (crea `suppliers`); no depende de nada más. La 056 queda reservada para la corrección de la fecha de los saldos iniciales, pendiente de RM. |
| `058_motivo_de_anulacion_minimo_15.sql` | **sí** | El motivo de anulación exige 15..1000 caracteres (lo pide la DGI) · <sub>marcador: constraint invoices_cancellation_reason_largo</sub> Bloque 9B, D5. Va después de la 20260507000001 (crea `invoices.cancellation_reason`). Si producción tiene alguna factura anulada con un motivo más corto, la migración ABORTA y las lista: no las corrige, porque el motivo sale impreso en el PDF de la factura anulada. |
| `059_registro_de_anulaciones_ante_la_dgi.sql` | **sí** | Tabla fe_anulaciones — qué le pedimos al PAC al anular y qué contestó · <sub>marcador: tabla fe_anulaciones</sub> Bloque 9B. Espejo de `fe_emisiones`; va después de ella y de la 20260507000001. Existe porque anular es PAC primero y libro después: es lo único que distingue "nunca preguntamos" de "preguntamos y no entendimos la respuesta". |
| `060_reversion_de_nota_de_credito.sql` | **sí** | RPC reverse_credit_note + credit_notes.cancelled_at · <sub>marcador: credit_notes.cancelled_at</sub> Bloque 9C. Era lo único que quedaba sin construir del Bloque 5. El marcador es la COLUMNA y no la función porque la migración también reemplaza `finanzas_credit_note_immutability`, que ya existía: un marcador de función daría positivo sin que la 060 se haya corrido. La reversión NO escribe credited_total — lo recalcula el trigger de la 051. |
| `061_cufe_cargado_a_mano.sql` | **sí** | invoices.dgi_cufe_origen — CUFE del PAC vs. CUFE copiado del portal · <sub>marcador: invoices.dgi_cufe_origen</sub> Bloque 9C, caso B. Las facturas anteriores al 8 de julio de 2026 TIENEN CUFE ante la DGI pero el CRM no lo guardo; al cargarlo a mano quedan indistinguibles de una que el sistema emitio. La columna dice cual es cual. NO toca `fe_estado`: este sistema no las emitio. |
| `062_fe_emisiones_de_nota_de_credito.sql` | **sí** | fe_emisiones.credit_note_id — el historial de envios tambien guarda NC · <sub>marcador: fe_emisiones.credit_note_id</sub> Bloque 9C. Arco exclusivo con invoice_id, como supplier_payments en la 049. Una tabla aparte obligaria a que la alerta de rechazo (SOP-041) consultara dos y las mezclara, o --mas probable-- a que quedara a medias sin que ningun test lo note. |
| `063_anular_con_nc_reversada.sql` | **sí** | La anulacion bloquea solo por NC VIGENTES (no reversadas) · <sub>marcador: resuelto por el dato, no por el esquema</sub> _(heurístico)_ Bloque 9C. La 053 miraba la EXISTENCIA del asiento de la NC, y los asientos no se borran: una NC reversada bloqueaba la factura para siempre. El marcador es `dato` porque la 063 no crea ningun objeto nuevo -- reemplaza el cuerpo de una funcion que ya existia desde la 052. |
| `064_cufe_origen_no_nulo.sql` | **sí** | El CHECK de dgi_cufe_origen exige el origen NO nulo · <sub>marcador: invoices_dgi_cufe_origen_check menciona 'dgi_cufe_origen IS NOT NULL'</sub> Corrige la 061: `NULL IN (...)` da NULL y el CHECK aceptaba un CUFE sin origen. En staging dos facturas emitidas por el CRM quedaron asi. Va pegada a la 061 y, en produccion, en la VENTANA: el codigo de main no escribe el origen. |
| `065_fe_anulaciones_de_nota_de_credito.sql` | **sí** | fe_anulaciones.credit_note_id — el registro de anulaciones tambien guarda NC · <sub>marcador: fe_anulaciones.credit_note_id</sub> 25/09. Arco exclusivo con invoice_id, como la 062 en fe_emisiones. Existe porque una NC autorizada se anula ante la DGI (PAC primero, libro despues) y cada intento queda registrado. |
| `066_nc_de_compra.sql` | **sí** | Nota de credito de compra: supplier_credit_notes, saldo derivado, RPC de alta y de reversion · <sub>marcador: tabla supplier_credit_notes</sub> 3.5, 25/09. Una sola transaccion (numero + NC + lineas + asiento). credited_total derivada y balance_due generada en business_expenses; el status se deriva contra el total neto. Defaults de Josuarth (J-2, J-3, J-5, J-10, J-11) en el encabezado. |
| `067_importacion_de_asientos.sql` | **sí** | Importar asientos desde Excel: lote, vinculo, alta en una transaccion y reversion del lote · <sub>marcador: tabla journal_imports</sub> 7.5, 25/09. Todo o nada: post_journal_entries_batch postea cada asiento por post_journal_entry en una transaccion. reverse_journal_import reversa cada asiento con reverse_journal_entry (055), fecha de hoy, sin borrar nada. Los asientos importados son source_type manual. |
| `add-receipt-to-expenses.sql` | **sí** | expenses.receipt_url/receipt_filename · <sub>marcador: expenses.receipt_url</sub> |
| `add_extrajudicial_classification.sql` | **sí** | Clasificación EXTRAJUDICIAL (EXT) · <sub>marcador: resuelto por el dato, no por el esquema</sub> _(heurístico)_ |
| `add_payment_description_receipt.sql` | **sí** | client_payments.description/receipt_url/receipt_filename · <sub>marcador: client_payments.description</sub> |
| `backfill_client_type_null.sql` | **sí** | Backfill de client_type para clientes legacy · <sub>marcador: resuelto por el dato, no por el esquema</sub> _(heurístico)_ |
| `cleanup-test-users-2026-05-02.sql` | **NO** | Borra 3 usuarios de prueba · <sub>marcador: resuelto por el dato, no por el esquema</sub> _(heurístico)_ ⚠️ Solo tiene sentido contra PRODUCCIÓN. En staging el seed crea usuarios de prueba a propósito, así que siempre da NO. |
| `fix-duplicate-classifications.sql` | **sí** | Deduplica cat_classifications por prefijo · <sub>marcador: resuelto por el dato, no por el esquema</sub> _(heurístico)_ |
| `fix-duplicate-statuses-2026-08-23.sql` | **sí** | Deja cat_statuses en 2 filas activas · <sub>marcador: resuelto por el dato, no por el esquema</sub> _(heurístico)_ |
| `hotfix_cli116_client_type.sql` | **NO** | UPDATE de una fila (CLI-116 → persona_juridica) · <sub>marcador: resuelto por el dato, no por el esquema</sub> _(heurístico)_ ⚠️ Solo tiene sentido contra PRODUCCIÓN. CLI-116 es un cliente real; en staging no existe. |
| `storage_rls_policies.sql` | n/a | OBSOLETA — fue el hallazgo OWASP Crítico #1. La reemplaza storage_rls_tenant_scoped.sql. NO correr. |
| `storage_rls_tenant_scoped.sql` | **sí** | Aísla el bucket documents por tenant (primera carpeta = tenant_id del JWT) · <sub>marcador: 4 política(s) sobre storage.objects</sub> _(heurístico)_ |
| `update-classification-colors.sql` | **sí** | Colores oficiales de las clasificaciones · <sub>marcador: resuelto por el dato, no por el esquema</sub> _(heurístico)_ |

## 3. La cola, en orden

Faltan **2** migraciones de `sql/pending/`, en este orden:

```
cleanup-test-users-2026-05-02
hotfix_cli116_client_type
```

⚠️ Este listado es el **orden del directorio**, no el orden de aplicación.
Las dependencias reales (036 antes de 037, 048 antes de 049, 030 antes de 039,
051 antes de 052 antes de 053) están en el runbook del despliegue,
`docs/runbooks/despliegue-025-055.md`.

---

_Generado por `scripts/inventario-migraciones.mjs` el 2026-09-25 19:28._
