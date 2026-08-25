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
  "sql/pending/storage_rls_tenant_scoped.sql",
];
