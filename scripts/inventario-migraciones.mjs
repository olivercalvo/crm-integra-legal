#!/usr/bin/env node
// =============================================================================
// inventario-migraciones.mjs — el inventario se GENERA, no se escribe a mano
// =============================================================================
// Por qué existe: `docs/staging/inventario-migraciones.md` decía ser la fuente
// de verdad sobre qué migración está aplicada y cuál no, y el 22/09/2026 se
// descubrió que le faltaban CATORCE filas (025–033 y 040–044). Por ese hueco el
// análisis de despliegue arrancó la cola en la 034 cuando en realidad producción
// se había detenido en la 024. Un documento que se mantiene a mano se
// desactualiza en silencio; este script lo regenera desde el esquema real.
//
// 🔴 LA PROPIEDAD QUE IMPORTA NO ES GENERAR EL DOC, ES EL ABORTO.
//    Si aparece un archivo en `sql/pending/` sin entrada en MARCADORES, el
//    script falla con código 1 y lo nombra. Una migración nueva ya no puede
//    desaparecer del inventario: rompe. Eso es lo que no tenía el documento.
//
// ─────────────────────────────────────────────────────────────────────────────
// POR QUÉ HAY QUE DECLARAR UN MARCADOR A MANO
// ─────────────────────────────────────────────────────────────────────────────
// No hay tabla de historial de migraciones: la convención del proyecto desde el
// 2026-04-05 es correrlas a mano en el SQL Editor. Así que "¿está aplicada?" no
// se puede leer de ningún lado — hay que preguntarle al esquema por el objeto
// que esa migración deja. Y ese objeto no se deduce del archivo: la 030
// redefine funciones que ya creó la 028, la 053 es un CREATE OR REPLACE de la
// función de la 052, y la 026 es un INSERT que no deja rastro estructural.
// Por eso el marcador se declara, una vez, acá.
//
// ─────────────────────────────────────────────────────────────────────────────
// PRODUCCIÓN NO SE CONSULTA DESDE UNA MÁQUINA
// ─────────────────────────────────────────────────────────────────────────────
// `CLAUDE.md` §5: las credenciales de producción no van a una máquina. Por eso
// hay tres modos y no uno:
//
//   node scripts/inventario-migraciones.mjs --staging
//       Lee STAGING_DATABASE_URL de `.env.staging-db.local` (el MISMO archivo que
//       run-sql.mjs; no `.env`, que en este repo no existe) y regenera el
//       inventario de staging de punta a punta. Lleva el mismo candado que
//       run-sql.mjs: si la connection string apunta al project ref de
//       producción, aborta.
//
//   node scripts/inventario-migraciones.mjs --sql > /tmp/introspeccion.sql
//       NO se conecta a nada. Imprime UNA consulta de solo lectura para pegar
//       en el SQL Editor de producción. Devuelve un único JSON.
//
//   node scripts/inventario-migraciones.mjs --desde salida.json --base produccion
//       Toma ese JSON pegado de vuelta y produce el inventario de producción.
//
// Opciones: --salida <ruta>   (default: docs/staging/inventario-migraciones.md)
//           --base <nombre>   (etiqueta del relevamiento; default: staging)
//           --solo-verificar  (corre el aborto de cobertura y termina)
// =============================================================================

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(__dirname, "..");
const DIR_PENDING = join(RAIZ, "sql", "pending");
const DIR_SUPABASE = join(RAIZ, "supabase", "migrations");
const DOC_DEFECTO = join(RAIZ, "docs", "staging", "inventario-migraciones.md");
const ENV_STAGING = join(RAIZ, ".env.staging-db.local");
// Mismo candado que scripts/run-sql.mjs: el project ref de producción, literal.
const PROD_PROJECT_REFS = ["uqmmkklbhzxqybljiecs"];

const TENANT = "a0000000-0000-0000-0000-000000000001";

// =============================================================================
// MARCADORES
// =============================================================================
// Cada entrada dice QUÉ OBJETO prueba que esa migración corrió. Tipos:
//
//   tabla          { tabla }
//   columna        { tabla, columna }
//   funcion        { nombre }
//   indice         { nombre }
//   constraint     { nombre }
//   check_contiene { nombre, contiene }   — el CHECK existe Y menciona un valor
//   cuerpo_funcion { nombre, contiene }   — distingue dos versiones de la misma
//   privilegio     { funcion, rol, esperado: 'sin'|'con' }
//   bucket         { id, publico: true|false }
//   politica       { tabla, minimo }      — cantidad mínima de políticas
//   dato           { sql }                — SELECT escalar que devuelve boolean
//                  🔴 Solo puede nombrar tablas del ESQUEMA INICIAL. Se inlinea
//                     en la introspección, que es un único SELECT de solo
//                     lectura: una tabla inexistente rompe la consulta entera
//                     en el parse y no hay forma de atajarlo desde adentro.
//   ignorar        { motivo }             — no es una migración aplicable
//
// `heuristico: true` marca un marcador que prueba el EFECTO y no el objeto (un
// dato puede haber llegado por otro camino). Sale señalado en el informe.
// `aplica` limita el marcador: 'todas' (default) o 'produccion'.
// -----------------------------------------------------------------------------

const MARCADORES = {
  // ── sql/pending — históricas ────────────────────────────────────────────────
  "001_fix_case_code_civ_002_to_ext.sql": {
    que: "Re-numera CIV-002 → EXT-001",
    tipo: "dato", heuristico: true,
    sql: `SELECT EXISTS (SELECT 1 FROM public.cases WHERE case_code = 'EXT-001')`,
  },
  "002_enable_unaccent_and_search_rpcs.sql": {
    que: "Extensión unaccent + RPCs de búsqueda universal",
    tipo: "funcion", nombre: "f_unaccent",
  },
  "004_verify_familia_classification.sql": {
    que: "Solo SELECT de verificación", tipo: "ignorar",
    motivo: "No modifica nada: no hay nada que aplicar ni que detectar",
  },
  "005_add_familia_classification.sql": {
    que: "Clasificación FAMILIA (prefijo FAM)",
    tipo: "dato", heuristico: true,
    sql: `SELECT EXISTS (SELECT 1 FROM public.cat_classifications WHERE prefix = 'FAM')`,
  },
  "006_extend_documents_for_auto_pdfs.sql": {
    que: "documents.source / source_version / source_content_hash + entity_type 'quote'",
    tipo: "columna", tabla: "documents", columna: "source_content_hash",
  },
  "007_quotes_add_title.sql": {
    que: "quotes.title NOT NULL + CHECK 3-100 + backfill",
    tipo: "columna", tabla: "quotes", columna: "title",
  },
  "008_extend_chart_of_accounts.sql": {
    que: "is_system, account_name_qb, description + 17 cuentas",
    tipo: "columna", tabla: "chart_of_accounts", columna: "is_system",
  },
  "009_create_tax_payments.sql": { que: "Tabla tax_payments", tipo: "tabla", tabla: "tax_payments" },
  "010_create_business_expenses.sql": { que: "Tabla business_expenses (compras del bufete)", tipo: "tabla", tabla: "business_expenses" },
  "011_business_expenses_rls_abogada.sql": {
    que: "RLS: la abogada crea/edita/borra gastos del bufete",
    tipo: "politica", tabla: "business_expenses", minimo: 3, heuristico: true,
  },
  "012_extend_services_quotes_observations.sql": {
    que: "services_catalog.sort_order + quotes.observations + credit_notes.observations",
    tipo: "columna", tabla: "services_catalog", columna: "sort_order",
  },
  "013_create_observation_templates.sql": { que: "Catálogo observation_templates", tipo: "tabla", tabla: "observation_templates" },
  "014_quotes_estado_emitida.sql": {
    que: "'emitida' en el CHECK de quotes.status + reescribe finanzas_validate_status_transition",
    tipo: "check_contiene", nombre: "quotes_status_check", contiene: "emitida",
  },
  "015_quote_acceptances_rejections.sql": { que: "quote_acceptances + quote_rejections (portal público)", tipo: "tabla", tabla: "quote_acceptances" },
  "016_quotes_source_quote_id.sql": { que: "quotes.source_quote_id (duplicar cotización)", tipo: "columna", tabla: "quotes", columna: "source_quote_id" },
  "018_cleanup_test_quotes.sql": {
    que: "Borra 18 cotizaciones de prueba (EJECUTADO EN PRODUCCIÓN 2026-05-29)",
    tipo: "dato", heuristico: true,
    sql: `SELECT NOT EXISTS (SELECT 1 FROM public.quotes WHERE title ILIKE '%prueba%' OR title ILIKE '%test%')`,
  },
  "019_efactura_fase_1a_modelo_datos.sql": { que: "8 columnas en clients, 9 en invoices, fe_emisiones + fe_secuencias", tipo: "tabla", tabla: "fe_emisiones" },
  "020_efactura_allocator.sql": { que: "RPC allocate_fe_numero", tipo: "funcion", nombre: "allocate_fe_numero" },
  "021_client_numbering_sequence.sql": {
    que: "'client' en numbering_sequences + siembra la fila",
    tipo: "dato", heuristico: true,
    sql: `SELECT EXISTS (SELECT 1 FROM public.numbering_sequences WHERE sequence_type = 'client')`,
  },
  "022_backfill_dv_embebido.sql": {
    que: "Extrae el DV escrito como texto (' DV NN') a digito_verificador",
    tipo: "dato", heuristico: true,
    sql: `SELECT NOT EXISTS (SELECT 1 FROM public.clients WHERE tax_id ~ ' DV [0-9]')`,
    nota: "🔴 Decisión explícita: NO se aplica hasta que se retome como bloque propio. ⚠️ El marcador solo tiene sentido contra PRODUCCIÓN: en staging los clientes sembrados no traen el DV embebido en el texto, así que da 'sí' por vacuidad.",
  },

  // ── la cola contable ────────────────────────────────────────────────────────
  "023_contabilidad_fase1_ledger.sql": { que: "Motor del ledger: 5 tablas + 6 triggers de inmutabilidad + RLS", tipo: "tabla", tabla: "journal_entries" },
  "024_chart_of_accounts_saldo_subcategoria.sql": { que: "chart_of_accounts.saldo_inicial y .subcategoria", tipo: "columna", tabla: "chart_of_accounts", columna: "saldo_inicial" },
  "025_niif18_tipo_costo_y_subcategorias.sql": {
    que: "NIIF 18: account_type gana 'cost', cuenta_control, subcategorías nuevas, cuenta 200004",
    tipo: "columna", tabla: "chart_of_accounts", columna: "cuenta_control",
    nota: "Marcador decisivo del corte de producción al 22/09/2026: esta columna NO existe en prod.",
  },
  "026_cuenta_distribucion_socias.sql": {
    que: "Cuenta 300004 Distribución a Socias",
    tipo: "dato", heuristico: true,
    sql: `SELECT EXISTS (SELECT 1 FROM public.chart_of_accounts WHERE code = '300004')`,
    nota: "INSERT puro: no deja ningún objeto de esquema. Solo se puede detectar por el dato.",
  },
  "027_saldo_inicial_fecha.sql": { que: "chart_of_accounts.saldo_inicial_fecha + CHECK 'si hay saldo, hay fecha'", tipo: "columna", tabla: "chart_of_accounts", columna: "saldo_inicial_fecha" },
  "028_fase2_motor_posteo.sql": { que: "post_journal_entry, ensure_accounting_periods, verify_accounting_chain + períodos", tipo: "funcion", nombre: "post_journal_entry" },
  "029_restaurar_check_reversion.sql": { que: "Restaura je_reversion_requires_ref", tipo: "constraint", nombre: "je_reversion_requires_ref" },
  "030_ledger_permisos_y_periodos.sql": {
    que: "El RPC pasa a SECURITY DEFINER con EXECUTE solo para service_role",
    tipo: "privilegio", funcion: "post_journal_entry", rol: "authenticated", esperado: "sin",
    nota: "No se distingue de la 028 por el nombre de la función: se distingue por el privilegio.",
  },
  "031_bucket_documents_privado.sql": { que: "El bucket documents pasa a privado", tipo: "bucket", id: "documents", publico: false },
  "032_amount_paid_derivado.sql": { que: "invoices.amount_paid derivada + guard T4b", tipo: "funcion", nombre: "finanzas_guard_amount_paid" },
  "033_proveedores_entidad.sql": { que: "Tabla suppliers + supplier_id/due_date en business_expenses + backfill", tipo: "tabla", tabla: "suppliers" },
  "034_asiento_unico_por_documento.sql": { que: "UNIQUE parcial (tenant, source_type, source_id)", tipo: "indice", nombre: "journal_entries_un_asiento_por_documento" },
  "035_reembolso_a_fondos_legales.sql": {
    que: "Los 6 servicios REIM-* pasan de 2201 (pasivo) a 130003 (activo)",
    tipo: "dato", heuristico: true,
    sql: `SELECT NOT EXISTS (SELECT 1 FROM public.services_catalog WHERE code LIKE 'REIM%' AND revenue_account <> '130003')
            AND EXISTS (SELECT 1 FROM public.services_catalog WHERE code LIKE 'REIM%')`,
    nota: "UPDATE de catálogo: sin objeto de esquema. Depende de que exista la cuenta 130003.",
  },
  "036_expense_lines.sql": { que: "Tabla expense_lines + 4 columnas en expenses + backfill", tipo: "tabla", tabla: "expense_lines" },
  "037_expense_lines_cuenta_obligatoria.sql": { que: "CHECK chart_account_code NOT NULL (NOT VALID) sobre expense_lines", tipo: "constraint", nombre: "expense_lines_cuenta_obligatoria" },
  "038_gasto_tramite_al_ledger.sql": { que: "'gasto_tramite' en source_type + inmutabilidad de expenses y expense_lines", tipo: "funcion", nombre: "gasto_tramite_tiene_asiento" },
  "039_asientos_manuales.sql": { que: "journal_entries.reference e idempotency_key + redefine post_journal_entry", tipo: "columna", tabla: "journal_entries", columna: "reference" },
  "040_compras_con_lineas.sql": { que: "Una línea por compra y la cuenta del encabezado se apaga (CHECK a NULL)", tipo: "constraint", nombre: "business_expenses_cuenta_vive_en_la_linea" },
  "041_banco_del_cobro.sql": { que: "payments.payment_account_code", tipo: "columna", tabla: "payments", columna: "payment_account_code" },
  "042_pago_proveedor_source_type.sql": { que: "'pago_proveedor' en el CHECK de journal_entries.source_type", tipo: "check_contiene", nombre: "journal_entries_source_type_check", contiene: "pago_proveedor" },
  "043_relink_servicios_plan_vigente.sql": {
    que: "Los 5 servicios HON-* se relinkean a sus cuentas de ingreso vigentes",
    tipo: "dato", heuristico: true,
    sql: `SELECT EXISTS (SELECT 1 FROM public.services_catalog WHERE code = 'HON-COR' AND revenue_account = '400001')`,
    nota: "UPDATE de catálogo. Aborta entera si alguna de las 5 cuentas no existe, está inactiva o no es income.",
  },
  "044_gasto_numero_factura_proveedor.sql": { que: "business_expenses.supplier_invoice_number", tipo: "columna", tabla: "business_expenses", columna: "supplier_invoice_number" },
  "045_expense_lines_tax_code_id.sql": { que: "expense_lines.tax_code_id (FK real) + backfill de líneas de compra", tipo: "columna", tabla: "expense_lines", columna: "tax_code_id" },
  "046_reversion_de_cobro.sql": { que: "Tabla payment_reversals + RPC reverse_payment", tipo: "tabla", tabla: "payment_reversals" },
  "047_recibo_de_caja.sql": {
    que: "Recibo de caja REC-: secuencia 'payment', índice único, CHECK de documents, backfill",
    tipo: "indice", nombre: "payments_tenant_payment_number_key",
    nota: "payments.payment_number ya existía desde b3d_payments: NO sirve como marcador.",
  },
  "048_pagos_a_proveedores.sql": { que: "Tabla supplier_payments (CE-) + amount_paid derivado en compras + RPC de reversión", tipo: "tabla", tabla: "supplier_payments" },
  "049_pago_de_gasto_de_tramite.sql": { que: "Arco exclusivo en supplier_payments + expenses.amount_paid/status derivados", tipo: "columna", tabla: "supplier_payments", columna: "expense_id" },
  "050_reversion_de_gasto_de_tramite.sql": { que: "RPC reverse_expense_tramite", tipo: "funcion", nombre: "reverse_expense_tramite" },
  "051_nota_de_credito_contable.sql": { que: "13 columnas fiscales en credit_notes + invoices.credited_total + balance_due recreada", tipo: "columna", tabla: "invoices", columna: "credited_total" },
  "052_anulacion_con_reversion_y_nc.sql": { que: "RPC cancel_invoice_with_reversal + válvula finanzas.nc_compensar", tipo: "funcion", nombre: "cancel_invoice_with_reversal" },
  "053_anulacion_rechaza_nc_parcial.sql": {
    que: "La anulación rechaza una factura con NC parcial en el libro",
    tipo: "cuerpo_funcion", nombre: "cancel_invoice_with_reversal", contiene: "ya tiene la nota de crédito",
    nota: "Es un CREATE OR REPLACE de la función de la 052: por nombre son indistinguibles. Se mira el cuerpo.",
  },
  "054_tercero_por_linea.sql": { que: "journal_entry_lines.client_id / .supplier_id (dos FK reales)", tipo: "columna", tabla: "journal_entry_lines", columna: "client_id" },
  "055_reversion_de_asiento_manual.sql": { que: "RPC reverse_journal_entry + una sola reversión por asiento", tipo: "indice", nombre: "journal_entries_una_reversion_por_asiento" },

  // ── sql/pending — sin numerar ───────────────────────────────────────────────
  "add_extrajudicial_classification.sql": {
    que: "Clasificación EXTRAJUDICIAL (EXT)", tipo: "dato", heuristico: true,
    sql: `SELECT EXISTS (SELECT 1 FROM public.cat_classifications WHERE prefix = 'EXT')`,
  },
  "add_payment_description_receipt.sql": { que: "client_payments.description/receipt_url/receipt_filename", tipo: "columna", tabla: "client_payments", columna: "description" },
  "add-receipt-to-expenses.sql": { que: "expenses.receipt_url/receipt_filename", tipo: "columna", tabla: "expenses", columna: "receipt_url" },
  "backfill_client_type_null.sql": {
    que: "Backfill de client_type para clientes legacy", tipo: "dato", heuristico: true,
    sql: `SELECT NOT EXISTS (SELECT 1 FROM public.clients WHERE client_type IS NULL)`,
  },
  "cleanup-test-users-2026-05-02.sql": {
    que: "Borra 3 usuarios de prueba", tipo: "dato", heuristico: true,
    sql: `SELECT NOT EXISTS (SELECT 1 FROM public.users WHERE email ILIKE '%test%' OR email ILIKE '%prueba%')`,
    nota: "⚠️ Solo tiene sentido contra PRODUCCIÓN. En staging el seed crea usuarios de prueba a propósito, así que siempre da NO.",
  },
  "fix-duplicate-classifications.sql": {
    que: "Deduplica cat_classifications por prefijo", tipo: "dato", heuristico: true,
    sql: `SELECT NOT EXISTS (SELECT prefix FROM public.cat_classifications GROUP BY tenant_id, prefix HAVING count(*) > 1)`,
  },
  "fix-duplicate-statuses-2026-08-23.sql": {
    que: "Deja cat_statuses en 2 filas activas", tipo: "dato", heuristico: true,
    sql: `SELECT (SELECT count(*) FROM public.cat_statuses WHERE active) <= 2`,
  },
  "hotfix_cli116_client_type.sql": {
    que: "UPDATE de una fila (CLI-116 → persona_juridica)", tipo: "dato", heuristico: true,
    sql: `SELECT EXISTS (SELECT 1 FROM public.clients WHERE client_number = 'CLI-116' AND client_type = 'persona_juridica')`,
    nota: "⚠️ Solo tiene sentido contra PRODUCCIÓN. CLI-116 es un cliente real; en staging no existe.",
  },
  "storage_rls_policies.sql": {
    que: "Políticas de Storage ABIERTAS (solo chequean bucket_id)", tipo: "ignorar",
    motivo: "OBSOLETA — fue el hallazgo OWASP Crítico #1. La reemplaza storage_rls_tenant_scoped.sql. NO correr.",
  },
  "storage_rls_tenant_scoped.sql": {
    que: "Aísla el bucket documents por tenant (primera carpeta = tenant_id del JWT)",
    tipo: "politica", tabla: "objects", esquema: "storage", minimo: 1, heuristico: true,
  },
  "update-classification-colors.sql": {
    que: "Colores oficiales de las clasificaciones", tipo: "dato", heuristico: true,
    sql: `SELECT NOT EXISTS (SELECT 1 FROM public.cat_classifications WHERE color IS NULL)`,
  },

  // ── supabase/migrations ─────────────────────────────────────────────────────
  "20260402000001_initial_schema.sql": { que: "Esquema base: 14 tablas, RLS por tenant_id, índices", tipo: "tabla", tabla: "clients" },
  "20260402000002_seed_data.sql": { que: "Catálogos iniciales del tenant", tipo: "dato", heuristico: true, sql: `SELECT EXISTS (SELECT 1 FROM public.cat_institutions)` },
  "20260402000003_seed_clients_cases.sql": {
    que: "⛔ 23 clientes + 46 casos REALES del bufete", tipo: "dato", heuristico: true,
    sql: `SELECT (SELECT count(*) FROM public.clients) > 20`,
    nota: "⚠️ Solo tiene sentido contra PRODUCCIÓN. En staging los clientes son ficticios y el conteo no prueba nada.",
  },
  "20260403000001_fix_rls_jwt_claims.sql": { que: "Las funciones de RLS leen el tenant de app_metadata del JWT", tipo: "funcion", nombre: "get_tenant_id", heuristico: true },
  "20260403000002_add_case_fields.sql": { que: "8 columnas de seguimiento en cases + follow_up_date en comments", tipo: "columna", tabla: "cases", columna: "procedure_type" },
  "20260403000003_add_assistant_id.sql": { que: "cases.assistant_id → users", tipo: "columna", tabla: "cases", columna: "assistant_id" },
  "20260403000004_add_client_fields.sql": { que: "clients.address, clients.client_since", tipo: "columna", tabla: "clients", columna: "client_since" },
  "20260403000005_responsible_id_to_users.sql": { que: "cases.responsible_id apunta a users", tipo: "dato", heuristico: true, sql: `SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname LIKE 'cases_responsible_id%' AND confrelid = 'public.users'::regclass)` },
  "20260403000006_seed_complete_demo.sql": { que: "Datos de demo ficticios (etapa temprana)", tipo: "ignorar", motivo: "Innecesario hoy; no se corre en ninguna base nueva" },
  "20260403000010_complete_demo_data.sql": { que: "Más datos de demo", tipo: "ignorar", motivo: "Innecesario hoy" },
  "20260403000011_fill_clients_and_documents.sql": { que: "Relleno de clientes y documentos de demo", tipo: "ignorar", motivo: "Innecesario hoy" },
  "20260403000012_todos_and_prospects.sql": { que: "personal_todos, todo_comments, todo_documents, prospects", tipo: "tabla", tabla: "personal_todos" },
  "20260403000013_extend_document_entity_types.sql": { que: "documents.entity_type acepta 'task' y 'comment'", tipo: "check_contiene", nombre: "documents_entity_type_check", contiene: "comment" },
  "20260404000001_v1_1_feedback_changes.sql": { que: "Primera versión, reemplazada", tipo: "ignorar", motivo: "Reemplazada por _fixed. NO correr" },
  "20260404000001_v1_1_feedback_changes_fixed.sql": { que: "Cambios de feedback v1.1", tipo: "tabla", tabla: "client_payments", heuristico: true },
  "20260404000002_payment_type.sql": { que: "client_payments.payment_type", tipo: "columna", tabla: "client_payments", columna: "payment_type" },
  "20260405000001_client_responsible_lawyer.sql": { que: "clients.responsible_lawyer_id", tipo: "columna", tabla: "clients", columna: "responsible_lawyer_id" },
  "20260504000001_add_contador_role.sql": { que: "Rol 'contador' en el CHECK de users.role", tipo: "check_contiene", nombre: "users_role_check", contiene: "contador" },
  "20260505000001_finanzas_extend_clients.sql": { que: "Columnas fiscales en clients", tipo: "columna", tabla: "clients", columna: "tax_id_type" },
  "20260505000002_finanzas_catalogos.sql": { que: "chart_of_accounts, tax_codes, services_catalog, numbering_sequences", tipo: "tabla", tabla: "chart_of_accounts" },
  "20260505000003_finanzas_b3a_quotes.sql": { que: "quotes + quote_lines", tipo: "tabla", tabla: "quotes" },
  "20260505000004_finanzas_b3b_invoices.sql": { que: "invoices + invoice_lines", tipo: "tabla", tabla: "invoices" },
  "20260505000005_finanzas_b3c_credit_notes.sql": { que: "credit_notes + credit_note_lines", tipo: "tabla", tabla: "credit_notes" },
  "20260505000006_finanzas_b3d_payments.sql": { que: "payments + payment_applications", tipo: "tabla", tabla: "payment_applications" },
  "20260505000007_finanzas_b3e_triggers.sql": { que: "Los triggers T1–T8: transiciones, inmutabilidad, recálculo de totales", tipo: "funcion", nombre: "finanzas_validate_status_transition" },
  "20260506000001_finanzas_b4_schema_prep_dgi.sql": { que: "4 columnas DGI en invoices", tipo: "columna", tabla: "invoices", columna: "dgi_cufe" },
  "20260507000001_finanzas_b4_anular_factura.sql": { que: "cancellation_reason, cancelled_at + transición a 'anulada'", tipo: "columna", tabla: "invoices", columna: "cancellation_reason" },
  "20260508000001_clients_add_status_and_type.sql": { que: "client_status, client_type", tipo: "columna", tabla: "clients", columna: "client_status" },
  "20260508000002_quotes_extension_and_terms_template.sql": { que: "~19 columnas en quotes + quote_terms_template", tipo: "tabla", tabla: "quote_terms_template" },
  "20260508000003_clients_drop_active_legacy.sql": {
    que: "Dropea clients.active", tipo: "dato", heuristico: true,
    sql: `SELECT NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='clients' AND column_name='active' AND is_generated='NEVER')`,
  },
  "migration_completa.sql": { que: "Consolidado histórico de las 14 tablas iniciales", tipo: "ignorar", motivo: "NO correr: se pisa con las numeradas" },
  "migration_final_consolidada.sql": { que: "Otro consolidado histórico", tipo: "ignorar", motivo: "NO correr" },
};

// =============================================================================
// 1 · COBERTURA — el aborto
// =============================================================================
function listarSql(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".sql")).sort();
}

function verificarCobertura() {
  const pending = listarSql(DIR_PENDING);
  const supabase = listarSql(DIR_SUPABASE);

  const sinEntrada = pending.filter((f) => !MARCADORES[f]);
  const sinEntradaSupabase = supabase.filter((f) => !MARCADORES[f]);
  const huerfanas = Object.keys(MARCADORES).filter(
    (f) => !pending.includes(f) && !supabase.includes(f)
  );

  if (sinEntrada.length) {
    console.error("");
    console.error("🔴 ABORTADO — hay archivos en sql/pending/ sin entrada en MARCADORES:");
    console.error("");
    for (const f of sinEntrada) console.error("     · " + f);
    console.error("");
    console.error("   Una migración sin marcador desaparece del inventario en silencio.");
    console.error("   Eso fue exactamente lo que pasó el 22/09/2026 con catorce archivos.");
    console.error("");
    console.error("   Agregá su entrada en MARCADORES (scripts/inventario-migraciones.mjs)");
    console.error("   diciendo QUÉ OBJETO deja esa migración: una tabla, una columna, una");
    console.error("   función, un índice, un constraint — o, si no deja ninguno, un marcador");
    console.error("   `dato` con el SELECT que lo resuelve.");
    console.error("");
    process.exit(1);
  }

  if (sinEntradaSupabase.length) {
    console.error("⚠️  supabase/migrations/ sin entrada (no aborta, pero quedan fuera del doc):");
    for (const f of sinEntradaSupabase) console.error("     · " + f);
    console.error("");
  }
  if (huerfanas.length) {
    console.error("⚠️  Entradas en MARCADORES cuyo archivo ya no existe:");
    for (const f of huerfanas) console.error("     · " + f);
    console.error("");
  }

  return { pending, supabase };
}

// =============================================================================
// 2 · LA CONSULTA DE INTROSPECCIÓN
// =============================================================================
function lit(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }

function construirSql() {
  const entradas = Object.entries(MARCADORES);

  const cuerpos = entradas
    .filter(([, m]) => m.tipo === "cuerpo_funcion")
    .map(([, m]) => m.nombre);
  const privs = entradas
    .filter(([, m]) => m.tipo === "privilegio")
    .map(([, m]) => ({ f: m.funcion, r: m.rol }));
  const datos = entradas.filter(([, m]) => m.tipo === "dato");

  const parteCuerpos = cuerpos.length
    ? cuerpos.map((n) => `${lit(n)}, (SELECT string_agg(pg_get_functiondef(p.oid), E'\\n')
        FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
       WHERE ns.nspname='public' AND p.proname = ${lit(n)})`).join(",\n      ")
    : "";

  const partePrivs = privs.length
    ? privs.map(({ f, r }) => `${lit(f + "|" + r)}, (SELECT bool_or(has_function_privilege(${lit(r)}, p.oid, 'EXECUTE'))
        FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
       WHERE ns.nspname='public' AND p.proname = ${lit(f)})`).join(",\n      ")
    : "";

  // 🔴 Los marcadores `dato` se inlinean como subconsultas escalares, sin ninguna
  // función auxiliar. Es deliberado: la introspección tiene que ser ESTRICTAMENTE
  // de solo lectura para poder pegarse en el SQL Editor de producción, y un
  // `CREATE FUNCTION` aunque se dropee después sigue siendo una escritura.
  // Consecuencia: el SELECT de un marcador `dato` solo puede nombrar tablas del
  // esquema inicial. Si nombra una que quizá no exista, revienta la consulta
  // entera en el parse y no hay forma de atajarlo. Ver el comentario de MARCADORES.
  const parteDatos = datos.length
    ? datos.map(([archivo, m]) => `${lit(archivo)}, (${m.sql.trim()})`).join(",\n      ")
    : "";

  return `-- =============================================================================
-- INTROSPECCIÓN PARA EL INVENTARIO DE MIGRACIONES  ·  SOLO LECTURA
-- =============================================================================
-- Generada por scripts/inventario-migraciones.mjs --sql
--
-- Pegá esto completo en el SQL Editor de producción, copiá el único valor que
-- devuelve (un JSON) a un archivo, y después:
--
--     node scripts/inventario-migraciones.mjs --desde ese-archivo.json --base produccion
--
-- 🔴 NO ESCRIBE NADA. Es un único SELECT: ni CREATE, ni DROP, ni temporales.
-- =============================================================================

SELECT jsonb_pretty(jsonb_build_object(
  'relevado_en', now(),
  'base',        current_database(),
  'tablas', (SELECT coalesce(jsonb_agg(table_name ORDER BY table_name), '[]'::jsonb)
               FROM information_schema.tables
              WHERE table_schema = 'public' AND table_type = 'BASE TABLE'),
  'columnas', (SELECT coalesce(jsonb_agg(table_name || '.' || column_name ORDER BY table_name, column_name), '[]'::jsonb)
                 FROM information_schema.columns WHERE table_schema = 'public'),
  'funciones', (SELECT coalesce(jsonb_agg(DISTINCT p.proname), '[]'::jsonb)
                  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public'),
  'indices', (SELECT coalesce(jsonb_agg(indexname ORDER BY indexname), '[]'::jsonb)
                FROM pg_indexes WHERE schemaname = 'public'),
  'constraints', (SELECT coalesce(jsonb_agg(c.conname ORDER BY c.conname), '[]'::jsonb)
                    FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
                   WHERE n.nspname = 'public'),
  'checks', (SELECT coalesce(jsonb_object_agg(c.conname, pg_get_constraintdef(c.oid)), '{}'::jsonb)
               FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
              WHERE n.nspname = 'public' AND c.contype = 'c'),
  'politicas', (SELECT coalesce(jsonb_agg(schemaname || '.' || tablename || '.' || policyname), '[]'::jsonb)
                  FROM pg_policies),
  'buckets', coalesce((SELECT jsonb_object_agg(id, public) FROM storage.buckets), '{}'::jsonb),
  'cuerpos', jsonb_build_object(
      ${parteCuerpos || "'_', NULL"}
  ),
  'privilegios', jsonb_build_object(
      ${partePrivs || "'_', NULL"}
  ),
  'datos', jsonb_build_object(
      ${parteDatos || "'_', NULL"}
  )
)) AS inventario;
`;
}

// =============================================================================
// 3 · EVALUACIÓN
// =============================================================================
function evaluar(archivo, m, snap) {
  const T = (x) => (snap[x] || []);
  const O = (x) => (snap[x] || {});

  switch (m.tipo) {
    case "ignorar":
      return { estado: "n/a", detalle: m.motivo };
    case "tabla":
      return { estado: T("tablas").includes(m.tabla) ? "sí" : "NO", detalle: `tabla ${m.tabla}` };
    case "columna":
      return { estado: T("columnas").includes(`${m.tabla}.${m.columna}`) ? "sí" : "NO", detalle: `${m.tabla}.${m.columna}` };
    case "funcion":
      return { estado: T("funciones").includes(m.nombre) ? "sí" : "NO", detalle: `función ${m.nombre}()` };
    case "indice":
      return { estado: T("indices").includes(m.nombre) ? "sí" : "NO", detalle: `índice ${m.nombre}` };
    case "constraint":
      return { estado: T("constraints").includes(m.nombre) ? "sí" : "NO", detalle: `constraint ${m.nombre}` };
    case "check_contiene": {
      const def = O("checks")[m.nombre];
      if (!def) return { estado: "NO", detalle: `no existe el CHECK ${m.nombre}` };
      return { estado: def.includes(m.contiene) ? "sí" : "NO", detalle: `${m.nombre} ${def.includes(m.contiene) ? "menciona" : "NO menciona"} '${m.contiene}'` };
    }
    case "cuerpo_funcion": {
      const cuerpo = O("cuerpos")[m.nombre];
      if (cuerpo == null) return { estado: "NO", detalle: `no existe ${m.nombre}()` };
      return { estado: cuerpo.includes(m.contiene) ? "sí" : "NO", detalle: `el cuerpo de ${m.nombre}() ${cuerpo.includes(m.contiene) ? "incluye" : "NO incluye"} «${m.contiene}»` };
    }
    case "privilegio": {
      const v = O("privilegios")[`${m.funcion}|${m.rol}`];
      if (v == null) return { estado: "?", detalle: `no se pudo leer el privilegio de ${m.funcion}()` };
      const ok = m.esperado === "sin" ? v === false : v === true;
      return { estado: ok ? "sí" : "NO", detalle: `${m.rol} ${v ? "PUEDE" : "no puede"} ejecutar ${m.funcion}()` };
    }
    case "bucket": {
      const b = O("buckets");
      if (!(m.id in b)) return { estado: "?", detalle: `no se pudo leer el bucket ${m.id}` };
      return { estado: b[m.id] === m.publico ? "sí" : "NO", detalle: `bucket ${m.id}: public = ${b[m.id]}` };
    }
    case "politica": {
      const pref = `${m.esquema || "public"}.${m.tabla}.`;
      const n = T("politicas").filter((p) => p.startsWith(pref)).length;
      return { estado: n >= (m.minimo || 1) ? "sí" : "NO", detalle: `${n} política(s) sobre ${pref.slice(0, -1)}` };
    }
    case "dato": {
      const v = O("datos")[archivo];
      if (v == null) return { estado: "?", detalle: "el SELECT no se pudo resolver (falta la tabla o la columna)" };
      return { estado: v ? "sí" : "NO", detalle: "resuelto por el dato, no por el esquema" };
    }
    default:
      return { estado: "?", detalle: `tipo de marcador desconocido: ${m.tipo}` };
  }
}

// =============================================================================
// 4 · EL DOCUMENTO
// =============================================================================
const ICONO = { "sí": "**sí**", "NO": "**NO**", "n/a": "n/a", "?": "**?**" };

function fila(archivo, m, r) {
  const notas = [];
  if (m.heuristico && r.estado !== "n/a") notas.push("_(heurístico)_");
  if (m.nota) notas.push(m.nota);
  const detalle = r.estado === "n/a" ? r.detalle : `${m.que} · <sub>marcador: ${r.detalle}</sub>`;
  return `| \`${archivo}\` | ${ICONO[r.estado]} | ${detalle}${notas.length ? " " + notas.join(" ") : ""} |`;
}

function generarDoc(snap, base, archivos) {
  const L = [];
  const fecha = (snap.relevado_en || new Date().toISOString()).slice(0, 10);

  L.push("# Inventario de migraciones — estado real vs. la base");
  L.push("");
  L.push("> 🤖 **ARCHIVO GENERADO. NO EDITAR A MANO.**");
  L.push("> Lo produce `scripts/inventario-migraciones.mjs` leyendo el esquema de la base.");
  L.push("> Editarlo a mano vuelve a traer el problema que este script existe para cerrar:");
  L.push("> el 22/09/2026 a este documento le faltaban **catorce filas** (025–033 y 040–044),");
  L.push("> y por ese hueco el plan de despliegue arrancó la cola en la 034 cuando producción");
  L.push("> se había detenido en la 024.");
  L.push(">");
  L.push("> Para regenerarlo: `node scripts/inventario-migraciones.mjs --staging`, o");
  L.push("> `--sql` + `--desde` si la base es producción (sus credenciales no van a una máquina).");
  L.push("");
  L.push(`**Base relevada:** \`${base}\`  `);
  L.push(`**Fecha del relevamiento:** ${fecha}  `);
  L.push(`**Nombre de la base:** \`${snap.base || "—"}\``);
  L.push("");
  L.push("> **`sql/pending/` NO es una cola de pendientes.** Es un cajón donde conviven");
  L.push("> migraciones aplicadas hace meses con otras que nunca se corrieron. El nombre");
  L.push("> engaña; esta tabla no.");
  L.push("");
  L.push("## Cómo leer la columna «¿aplicada?»");
  L.push("");
  L.push("| | |");
  L.push("|---|---|");
  L.push("| **sí** | El objeto que deja esa migración está en la base |");
  L.push("| **NO** | No está |");
  L.push("| **?** | El marcador no se pudo resolver — casi siempre porque falta una migración anterior |");
  L.push("| n/a | No es una migración aplicable (verificación, consolidado, obsoleta) |");
  L.push("| _(heurístico)_ | Se resolvió por el **dato** y no por el esquema: el dato pudo llegar por otro camino |");
  L.push("");

  for (const [titulo, lista] of [
    ["1. `supabase/migrations/`", archivos.supabase],
    ["2. `sql/pending/`", archivos.pending],
  ]) {
    L.push(`## ${titulo}`);
    L.push("");
    L.push("| Archivo | ¿aplicada? | Qué hace |");
    L.push("|---|---|---|");
    for (const f of lista) {
      const m = MARCADORES[f];
      if (!m) continue;
      L.push(fila(f, m, evaluar(f, m, snap)));
    }
    L.push("");
  }

  // Resumen de lo que falta, en orden — es lo que se usa para armar una cola.
  const faltan = archivos.pending.filter((f) => {
    const m = MARCADORES[f];
    return m && m.tipo !== "ignorar" && evaluar(f, m, snap).estado === "NO";
  });
  L.push("## 3. La cola, en orden");
  L.push("");
  if (!faltan.length) {
    L.push("No falta ninguna. La base está al día con `sql/pending/`.");
  } else {
    L.push(`Faltan **${faltan.length}** migraciones de \`sql/pending/\`, en este orden:`);
    L.push("");
    L.push("```");
    L.push(faltan.map((f) => f.replace(/\.sql$/, "")).join("\n"));
    L.push("```");
    L.push("");
    L.push("⚠️ Este listado es el **orden del directorio**, no el orden de aplicación.");
    L.push("Las dependencias reales (036 antes de 037, 048 antes de 049, 030 antes de 039,");
    L.push("051 antes de 052 antes de 053) están en el runbook del despliegue,");
    L.push("`docs/runbooks/despliegue-025-055.md`.");
  }
  L.push("");
  L.push("---");
  L.push("");
  L.push(`_Generado por \`scripts/inventario-migraciones.mjs\` el ${new Date().toISOString().slice(0, 16).replace("T", " ")}._`);
  L.push("");
  return L.join("\n");
}

// =============================================================================
// 5 · MAIN
// =============================================================================
function arg(nombre, def = null) {
  const i = process.argv.indexOf(nombre);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const tiene = (n) => process.argv.includes(n);

async function leerStaging() {
  if (!existsSync(ENV_STAGING)) {
    console.error(`❌ Falta ${ENV_STAGING}`);
    console.error("   Es el mismo archivo que usa scripts/run-sql.mjs.");
    process.exit(1);
  }
  const conn = (readFileSync(ENV_STAGING, "utf8").match(/^STAGING_DATABASE_URL=(.*)$/m) || [])[1]
    ?.trim()
    .replace(/^["']|["']$/g, "");
  if (!conn) {
    console.error("❌ No se pudo leer STAGING_DATABASE_URL");
    console.error("   (producción NO se consulta desde acá: usá --sql y --desde)");
    process.exit(1);
  }

  // ---- CANDADO: nunca contra producción ----
  for (const ref of PROD_PROJECT_REFS) {
    if (conn.includes(ref)) {
      console.error(`\n🛑 ABORTADO: la connection string apunta a PRODUCCIÓN (${ref}).`);
      console.error("   Para producción el camino es --sql + --desde, nunca una conexión.\n");
      process.exit(1);
    }
  }

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: conn });
  await client.connect();
  try {
    const sql = construirSql();
    // La consulta trae CREATE/DROP de la función auxiliar: se manda entera.
    const res = await client.query(sql);
    const filas = (Array.isArray(res) ? res : [res]).flatMap((r) => r.rows || []);
    const json = filas.map((r) => r.inventario).find(Boolean);
    if (!json) throw new Error("la introspección no devolvió el JSON esperado");
    return typeof json === "string" ? JSON.parse(json) : json;
  } finally {
    await client.end();
  }
}

async function main() {
  const archivos = verificarCobertura();

  if (tiene("--solo-verificar")) {
    console.log(`✅ Cobertura OK — ${archivos.pending.length} archivos en sql/pending/, todos con marcador.`);
    return;
  }

  if (tiene("--sql")) {
    process.stdout.write(construirSql());
    return;
  }

  let snap, base;
  if (tiene("--desde")) {
    const ruta = arg("--desde");
    if (!ruta || !existsSync(ruta)) {
      console.error("❌ --desde necesita la ruta de un archivo con el JSON de la introspección.");
      process.exit(1);
    }
    const crudo = readFileSync(ruta, "utf8").trim();
    try {
      snap = JSON.parse(crudo);
    } catch {
      console.error("❌ El archivo no es JSON válido. Pegá SOLO el valor de la columna `inventario`.");
      process.exit(1);
    }
    base = arg("--base", "produccion");
  } else if (tiene("--staging")) {
    snap = await leerStaging();
    base = arg("--base", "staging");
  } else {
    console.error("Uso:");
    console.error("  node scripts/inventario-migraciones.mjs --staging");
    console.error("  node scripts/inventario-migraciones.mjs --sql > introspeccion.sql");
    console.error("  node scripts/inventario-migraciones.mjs --desde salida.json --base produccion");
    console.error("  node scripts/inventario-migraciones.mjs --solo-verificar");
    process.exit(2);
  }

  const doc = generarDoc(snap, base, archivos);
  const salida = arg("--salida", DOC_DEFECTO);
  writeFileSync(salida, doc, "utf8");

  const cuenta = { "sí": 0, "NO": 0, "n/a": 0, "?": 0 };
  for (const f of archivos.pending) {
    const m = MARCADORES[f];
    if (m) cuenta[evaluar(f, m, snap).estado]++;
  }
  console.log("");
  console.log(`✅ ${salida}`);
  console.log(`   base: ${base} · sql/pending: ${cuenta["sí"]} aplicadas · ${cuenta["NO"]} pendientes · ${cuenta["?"]} indeterminadas · ${cuenta["n/a"]} n/a`);
  if (cuenta["?"] > 0) {
    console.log("   ⚠️  Las indeterminadas casi siempre significan que falta una migración anterior.");
  }
  console.log("");
}

main().catch((e) => {
  console.error("❌ " + (e && e.message ? e.message : e));
  process.exit(1);
});
