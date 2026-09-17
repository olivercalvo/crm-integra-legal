/**
 * ORDEN DE APLICACIÓN DE MIGRACIONES PARA STAGING — fuente única.
 *
 * Lo consumen scripts/build-staging-bundle.mjs (arma el SQL pegable) y
 * scripts/apply-staging-sql.mjs (lo ejecuta por conexión directa). Vivía
 * duplicado en el primero; se movió acá para que no se puedan desincronizar.
 *
 * Qué NO entra, y por qué: docs/staging/inventario-migraciones.md §4.
 *   - 20260402000003_seed_clients_cases.sql → 23 clientes y 46 casos REALES
 *     del bufete. Ley 81.
 *   - Los seeds de demo viejos → los reemplaza `npm run seed:staging`.
 *   - Los limpiadores de datos (001, 018, backfills, dedupes) → no tienen a
 *     qué apuntar en una base vacía.
 *   - storage_rls_policies.sql → políticas abiertas, era el OWASP Crítico #1.
 */

/** Esquema base. Orden cronológico, saltando lo que no va (ver encabezado). */
export const BUNDLE_1 = [
  "supabase/migrations/20260402000001_initial_schema.sql",
  "supabase/migrations/20260402000002_seed_data.sql",
  "supabase/migrations/20260403000001_fix_rls_jwt_claims.sql",
  "supabase/migrations/20260403000002_add_case_fields.sql",
  "supabase/migrations/20260403000003_add_assistant_id.sql",
  "supabase/migrations/20260403000004_add_client_fields.sql",
  "supabase/migrations/20260403000005_responsible_id_to_users.sql",
  "supabase/migrations/20260403000012_todos_and_prospects.sql",
  "supabase/migrations/20260403000013_extend_document_entity_types.sql",
  "supabase/migrations/20260404000001_v1_1_feedback_changes_fixed.sql",
  "supabase/migrations/20260404000002_payment_type.sql",
  "supabase/migrations/20260405000001_client_responsible_lawyer.sql",
  "supabase/migrations/20260504000001_add_contador_role.sql",
  "supabase/migrations/20260505000001_finanzas_extend_clients.sql",
  "supabase/migrations/20260505000002_finanzas_catalogos.sql",
  "supabase/migrations/20260505000003_finanzas_b3a_quotes.sql",
  "supabase/migrations/20260505000004_finanzas_b3b_invoices.sql",
  "supabase/migrations/20260505000005_finanzas_b3c_credit_notes.sql",
  "supabase/migrations/20260505000006_finanzas_b3d_payments.sql",
  "supabase/migrations/20260505000007_finanzas_b3e_triggers.sql",
  "supabase/migrations/20260506000001_finanzas_b4_schema_prep_dgi.sql",
  "supabase/migrations/20260507000001_finanzas_b4_anular_factura.sql",
  "supabase/migrations/20260508000001_clients_add_status_and_type.sql",
  "supabase/migrations/20260508000002_quotes_extension_and_terms_template.sql",
  "supabase/migrations/20260508000003_clients_drop_active_legacy.sql",
];

/** Todo lo de sql/pending que ES esquema (no limpieza de datos). */
export const BUNDLE_2 = [
  "sql/pending/002_enable_unaccent_and_search_rpcs.sql",
  "sql/pending/005_add_familia_classification.sql",
  "sql/pending/add_extrajudicial_classification.sql",
  "sql/pending/update-classification-colors.sql",
  "sql/pending/add_payment_description_receipt.sql",
  "sql/pending/add-receipt-to-expenses.sql",
  "sql/pending/006_extend_documents_for_auto_pdfs.sql",
  "sql/pending/007_quotes_add_title.sql",
  "sql/pending/008_extend_chart_of_accounts.sql",
  "sql/pending/009_create_tax_payments.sql",
  "sql/pending/010_create_business_expenses.sql",
  "sql/pending/011_business_expenses_rls_abogada.sql",
  "sql/pending/012_extend_services_quotes_observations.sql",
  "sql/pending/013_create_observation_templates.sql",
  "sql/pending/014_quotes_estado_emitida.sql",
  "sql/pending/015_quote_acceptances_rejections.sql",
  "sql/pending/016_quotes_source_quote_id.sql",
  "sql/pending/019_efactura_fase_1a_modelo_datos.sql",
  "sql/pending/020_efactura_allocator.sql",
  "sql/pending/021_client_numbering_sequence.sql",
  "sql/pending/023_contabilidad_fase1_ledger.sql",
  "sql/pending/024_chart_of_accounts_saldo_subcategoria.sql",
  "sql/pending/025_niif18_tipo_costo_y_subcategorias.sql",
  "sql/pending/026_cuenta_distribucion_socias.sql",
  "sql/pending/027_saldo_inicial_fecha.sql",
  "sql/pending/028_fase2_motor_posteo.sql",
  "sql/pending/029_restaurar_check_reversion.sql",
  "sql/pending/030_ledger_permisos_y_periodos.sql",
  "sql/pending/storage_rls_tenant_scoped.sql",
  "sql/pending/031_bucket_documents_privado.sql",
  // Va DESPUÉS de 20260505000007 (define T7a) porque lo reemplaza para que
  // anuncie su paso, y después de nada más: solo toca invoices y su trigger.
  "sql/pending/032_amount_paid_derivado.sql",
  // 033 y 034 se aplicaron a mano en staging el 02/09/2026 y quedaron fuera de
  // esta lista. Se agregan el 03/09: sin ellas, un `--reset` reconstruye una
  // staging SIN proveedores y SIN el UNIQUE que impide postear dos veces el
  // mismo documento, que es peor que la base que reemplaza.
  //
  // 033 va después de 010 (crea business_expenses, a la que le agrega
  // supplier_id y due_date).
  "sql/pending/033_proveedores_entidad.sql",
  // 034 va después de 023 (crea journal_entries). Su paso 1 es un SELECT de
  // chequeo que devuelve 0 filas en una base recién armada.
  "sql/pending/034_asiento_unico_por_documento.sql",
  // 036 crea `expense_lines`. Va acá porque el resto del esquema la necesita
  // (los triggers de la 038 cuelgan de ella). Su BACKFILL no hace nada en este
  // momento —`expenses` está vacía— y por eso hay que VOLVER A CORRERLA después
  // del seed. Es idempotente: la segunda pasada es la que crea las líneas.
  "sql/pending/036_expense_lines.sql",
  // 038 va después de 036 (sus triggers son sobre `expense_lines`) y después de
  // 023 (amplía el CHECK de `journal_entries.source_type`).
  "sql/pending/038_gasto_tramite_al_ledger.sql",
  // 039 REDEFINE `post_journal_entry`: va después de la 030, que es la que lo
  // dejó SECURITY DEFINER y con EXECUTE solo para service_role. Los dropea y los
  // rehace ella misma; su paso 4 verifica que ni anon ni authenticated queden
  // pudiendo ejecutarlo.
  "sql/pending/039_asientos_manuales.sql",
  // 041 agrega `payments.payment_account_code`. No depende del seed.
  "sql/pending/041_banco_del_cobro.sql",
  // 042 agrega `pago_proveedor` al CHECK de source_type. Va DESPUÉS de la 038,
  // que fue la última en tocar ese CHECK.
  "sql/pending/042_pago_proveedor_source_type.sql",
];

// ---------------------------------------------------------------------------
// ⚠️ 035, 037 Y 040 NO ESTÁN EN ESTA LISTA, Y ES A PROPÓSITO
// ---------------------------------------------------------------------------
// Las dos necesitan datos que crea el SEED, no el esquema, así que corren
// DESPUÉS. La secuencia completa para levantar staging de cero:
//
//   1. node scripts/apply-staging-sql.mjs --reset      ← esta lista
//   2. npm run seed:staging                            ← cuentas, casos, gastos
//   3. node scripts/run-sql.mjs sql/pending/035_reembolso_a_fondos_legales.sql
//   4. node scripts/run-sql.mjs sql/pending/036_expense_lines.sql   ← 2ª pasada:
//      ahora sí hay gastos, y su backfill les crea UNA línea sin clasificar.
//   5. node scripts/run-sql.mjs sql/pending/037_expense_lines_cuenta_obligatoria.sql
//   6. npm run seed:asientos                           ← crea las 3 compras y sus líneas
//   7. node scripts/run-sql.mjs sql/pending/040_compras_con_lineas.sql
//   8. npx tsx scripts/seed-gasto-tramite-demo.mts
//   9. node scripts/run-sql.mjs sql/pending/045_expense_lines_tax_code_id.sql
//      ← después de la 040: su backfill es sobre las líneas de compra que la
//        040 crea, y aborta si alguna tasa no calza con `tax_codes`.
//
// ⚠️ La `041` (banco del cobro) y la `042` (source_type `pago_proveedor`) SÍ van
// en BUNDLE_2: solo agregan una columna y un valor al CHECK, no dependen de
// ningún dato del seed. Están listadas arriba.
//
// 🔴 EL ORDEN 4 → 5 ES OBLIGATORIO. El backfill de 036 inserta
// `chart_account_code = NULL` y el CHECK de 037 lo rechaza: al revés, la 036
// aborta. Está explicado en el encabezado de la 037.
//
// ⚠️ Y el paso 4 no es opcional: sin él los 20 gastos del seed quedan SIN LÍNEAS,
// que es un estado peor que el que reemplaza — no se pueden postear y la pantalla
// de limpieza no tiene nada que mostrar.
//
// 🔴 LA 040 VA DESPUÉS DEL `seed:asientos` (paso 6), no antes. Su backfill crea
// una línea por COMPRA leyendo `business_expenses.chart_account_code`, y las
// compras las crea ese seed. Corrida antes, no encontraría ninguna y dejaría el
// CHECK puesto sobre una tabla vacía — lo que después haría fallar al seed, que
// escribiría `chart_account_code` en el encabezado.
//
// ⚠️ Desde el 04/09 `seed-asientos.ts` escribe las líneas en `expense_lines` y
// manda `chart_account_code: null` en el encabezado, así que es compatible con la
// 040 corra antes o después. El orden de arriba es el que además deja el CHECK
// validado sobre datos reales.
// ---------------------------------------------------------------------------
// `035_reembolso_a_fondos_legales.sql` apunta los servicios REIM-* a la cuenta
// `130003`, y esa cuenta NO viene de ninguna migración: la crea
// `npm run seed:staging` desde el Excel de las 62 cuentas de Josuar.
//
// Este bundle corre ANTES del seed (este script termina diciendo "Siguiente:
// npm run seed:staging"). Si 035 estuviera acá, su guard abortaría en toda base
// recién reseteada, porque el FK compuesto de `services_catalog` no tendría a
// dónde apuntar.
//
// El reparto queda así, y son dos caminos para la misma regla:
//   · base que YA existe (staging hoy, producción algún día) → la migración 035.
//   · base recién armada (`--reset` + seed)                  → el seed lo deja
//     bien solo, en `scripts/seed-staging.ts` (buscá "REIM").
//
// Si alguien cambia la cuenta del reembolso, hay que mover LOS DOS.
// ---------------------------------------------------------------------------
