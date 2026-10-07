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
  "057_proveedor_cuenta_por_defecto_y_contacto.sql": {
    que: "suppliers gana la cuenta contable por defecto (solo COMPRAS) + los tres campos de la persona de contacto",
    tipo: "columna", tabla: "suppliers", columna: "default_chart_account_code",
    nota: "Bloque 8. Va después de la 033 (crea `suppliers`); no depende de nada más. La 056 queda reservada para la corrección de la fecha de los saldos iniciales, pendiente de RM.",
  },
  "058_motivo_de_anulacion_minimo_15.sql": {
    que: "El motivo de anulación exige 15..1000 caracteres (lo pide la DGI)",
    tipo: "constraint", nombre: "invoices_cancellation_reason_largo",
    nota: "Bloque 9B, D5. Va después de la 20260507000001 (crea `invoices.cancellation_reason`). Si producción tiene alguna factura anulada con un motivo más corto, la migración ABORTA y las lista: no las corrige, porque el motivo sale impreso en el PDF de la factura anulada.",
  },
  "059_registro_de_anulaciones_ante_la_dgi.sql": {
    que: "Tabla fe_anulaciones — qué le pedimos al PAC al anular y qué contestó",
    tipo: "tabla", tabla: "fe_anulaciones",
    nota: "Bloque 9B. Espejo de `fe_emisiones`; va después de ella y de la 20260507000001. Existe porque anular es PAC primero y libro después: es lo único que distingue \"nunca preguntamos\" de \"preguntamos y no entendimos la respuesta\".",
  },

  "060_reversion_de_nota_de_credito.sql": {
    que: "RPC reverse_credit_note + credit_notes.cancelled_at",
    tipo: "columna", tabla: "credit_notes", columna: "cancelled_at",
    nota: "Bloque 9C. Era lo único que quedaba sin construir del Bloque 5. El marcador es la COLUMNA y no la función porque la migración también reemplaza `finanzas_credit_note_immutability`, que ya existía: un marcador de función daría positivo sin que la 060 se haya corrido. La reversión NO escribe credited_total — lo recalcula el trigger de la 051.",
  },

  "061_cufe_cargado_a_mano.sql": {
    que: "invoices.dgi_cufe_origen — CUFE del PAC vs. CUFE copiado del portal",
    tipo: "columna", tabla: "invoices", columna: "dgi_cufe_origen",
    nota: "Bloque 9C, caso B. Las facturas anteriores al 8 de julio de 2026 TIENEN CUFE ante la DGI pero el CRM no lo guardo; al cargarlo a mano quedan indistinguibles de una que el sistema emitio. La columna dice cual es cual. NO toca `fe_estado`: este sistema no las emitio.",
  },

  "062_fe_emisiones_de_nota_de_credito.sql": {
    que: "fe_emisiones.credit_note_id — el historial de envios tambien guarda NC",
    tipo: "columna", tabla: "fe_emisiones", columna: "credit_note_id",
    nota: "Bloque 9C. Arco exclusivo con invoice_id, como supplier_payments en la 049. Una tabla aparte obligaria a que la alerta de rechazo (SOP-041) consultara dos y las mezclara, o --mas probable-- a que quedara a medias sin que ningun test lo note.",
  },

  "063_anular_con_nc_reversada.sql": {
    que: "La anulacion bloquea solo por NC VIGENTES (no reversadas)",
    tipo: "dato", heuristico: true,
    // Sin cast a regprocedure: si la funcion no existiera, el cast lanzaria y
    // romperia la consulta UNICA del inventario entero, no solo esta fila.
    sql: `SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'cancel_invoice_with_reversal' AND position('reverses_entry_id = je.id' IN pg_get_functiondef(p.oid)) > 0)`,
    nota: "Bloque 9C. La 053 miraba la EXISTENCIA del asiento de la NC, y los asientos no se borran: una NC reversada bloqueaba la factura para siempre. El marcador es `dato` porque la 063 no crea ningun objeto nuevo -- reemplaza el cuerpo de una funcion que ya existia desde la 052.",
  },

  "064_cufe_origen_no_nulo.sql": {
    que: "El CHECK de dgi_cufe_origen exige el origen NO nulo",
    tipo: "check_contiene", nombre: "invoices_dgi_cufe_origen_check", contiene: "dgi_cufe_origen IS NOT NULL",
    nota: "Corrige la 061: `NULL IN (...)` da NULL y el CHECK aceptaba un CUFE sin origen. En staging dos facturas emitidas por el CRM quedaron asi. Va pegada a la 061 y, en produccion, en la VENTANA: el codigo de main no escribe el origen.",
  },

  "065_fe_anulaciones_de_nota_de_credito.sql": {
    que: "fe_anulaciones.credit_note_id — el registro de anulaciones tambien guarda NC",
    tipo: "columna", tabla: "fe_anulaciones", columna: "credit_note_id",
    nota: "25/09. Arco exclusivo con invoice_id, como la 062 en fe_emisiones. Existe porque una NC autorizada se anula ante la DGI (PAC primero, libro despues) y cada intento queda registrado.",
  },

  "066_nc_de_compra.sql": {
    que: "Nota de credito de compra: supplier_credit_notes, saldo derivado, RPC de alta y de reversion",
    tipo: "tabla", tabla: "supplier_credit_notes",
    nota: "3.5, 25/09. Una sola transaccion (numero + NC + lineas + asiento). credited_total derivada y balance_due generada en business_expenses; el status se deriva contra el total neto. Defaults de Josuarth (J-2, J-3, J-5, J-10, J-11) en el encabezado.",
  },

  "067_importacion_de_asientos.sql": {
    que: "Importar asientos desde Excel: lote, vinculo, alta en una transaccion y reversion del lote",
    tipo: "tabla", tabla: "journal_imports",
    nota: "7.5, 25/09. Todo o nada: post_journal_entries_batch postea cada asiento por post_journal_entry en una transaccion. reverse_journal_import reversa cada asiento con reverse_journal_entry (055), fecha de hoy, sin borrar nada. Los asientos importados son source_type manual.",
  },

  "078_parametros_del_bufete_isr.sql": {
    que: "Parametros contables por bufete: la tasa de ISR del Estado de Resultado (fraccion, 0 por defecto)",
    tipo: "tabla", tabla: "finanzas_parametros",
    nota: "Bloque 1, E10, 01/10. Decision (b) de Josuarth del 30/09: linea de ISR siempre visible con tasa configurable, 0 % para Integra. No toca el libro: es un calculo del reporte.",
  },
  "079_subcategorias_y_cuentas_nuevas.sql": {
    que: "Subcategoria obligatoria en los seis tipos (CHECK coa_subcategoria_por_tipo), patrimonio en tres, sin depreciacion_acumulada; 400009 Familia, 440001 Otros ingresos, HON-FAM y OTR-ING",
    tipo: "constraint", nombre: "coa_subcategoria_por_tipo",
    nota: "Bloque 1, E6, 01/10. El mapa cuenta por cuenta de Josuarth (P-8a) no llego: la migracion asigna un valor por defecto (el de subcategoriaPorDefecto) y lo informa con un NOTICE por cuenta; se corrige en el Plan de Cuentas. Reemplaza el CHECK de la 025 y el script sql/datos-staging de HON-FAM.",
  },
  "081_correcciones_076_y_079.sql": {
    que: "Correcciones: create_supplier_credit_note sin record de la compra (NC sin compra fallaba) y CHECK de subcategoria sin el hueco del NULL",
    tipo: "check_contiene", nombre: "coa_subcategoria_por_tipo", contiene: "IS NOT NULL",
    nota: "Bloque 1, 01/10. Encontradas por la verificacion de la 076 y la 079 al aplicarlas en staging. Va inmediatamente despues de la 080.",
  },
  "086_bitacoras_nucleo.sql": {
    que: "Esquema auditoria: bitacora_contable y bitacora_legal (solo agregar, cadena de hash por bufete), anclas diarias y al cerrar periodo, lectura y verificacion por RPC solo service_role",
    tipo: "funcion", nombre: "bitacora_leer",
    nota: "03/10. Propuesta aprobada de bitacoras. Contable: admin y contador; legal: admin. Lo exige la base, no solo la app. No toca filas ni el libro.",
  },
  "087_bitacoras_captura.sql": {
    que: "Trigger trg_auditoria en 41 tablas: cada cambio a su bitacora, y lo fiscal de clientes, gastos de tramite y usuarios tambien a la contable",
    tipo: "dato",
    sql: `SELECT count(*) = 41 FROM pg_trigger WHERE tgname = 'trg_auditoria' AND NOT tgisinternal`,
    nota: "03/10. Requiere la 086. Falla cerrado: si la bitacora no se puede escribir, la operacion se deshace. El usuario sale de auth.uid() o del header x-actor-id (createAdminClient(usuario)).",
  },
  "088_bitacoras_legado.sql": {
    que: "Copia una vez las filas de audit_log a las bitacoras como origen legado (usuario y fecha originales), con verificacion de conteos",
    tipo: "dato",
    // Solo catálogo: nombrar las tablas de auditoria rompería la consulta única
    // en una base sin la 086. La función nace en la MISMA transacción que la copia.
    sql: `SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'auditoria' AND p.proname = 'escribir_legado')`,
    nota: "03/10. ESCRITA Y SIN APLICAR a proposito: va cuando las bitacoras nuevas esten escribiendo y verificadas. Requiere 086 y 087.",
  },
  "089_bitacoras_documento_de_casos.sql": {
    que: "Correccion de auditoria.documento_de: tareas, comentarios y cobros del caso fallaban (COALESCE de texto y entero) y, por fallar cerrado, no se podian guardar",
    tipo: "dato",
    // Solo catálogo, por la misma razón que la 088.
    sql: `SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'auditoria' AND p.proname = 'documento_de' AND p.prosrc LIKE '%case_number::text%')`,
    nota: "03/10. Encontrada en el recorrido del punto 7 con la 087 recien aplicada en staging. Va inmediatamente despues de la 087.",
  },
  "090_bitacoras_orden_de_candados.sql": {
    que: "La bitacora toma el candado del correlativo del libro antes que el suyo: un solo orden con post_journal_entry (la importacion de asientos y la NC de compra se trababan con un posteo suelto)",
    tipo: "dato",
    // Solo catálogo, por la misma razón que la 088.
    sql: `SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'auditoria' AND p.proname = 'tomar_candados')`,
    nota: "03/10. Encontrada en la prueba 2 (deadlock 40P01 reproducido con dos sesiones). Va despues de la 089.",
  },
  "091_bitacoras_error_claro.sql": {
    que: "Si falla el registro de auditoria, error AU001 con un mensaje claro para la persona y el original en el detalle (la app lo deja en el log del servidor)",
    tipo: "dato",
    // Solo catálogo, por la misma razón que la 088.
    sql: `SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'auditoria' AND p.proname = 'registrar' AND p.prosrc LIKE '%AU001%')`,
    nota: "03/10. Prueba 3. Va despues de la 090, junto con el codigo de conManejoDeAuditoria y fetchConAuditoria (sin la 091 el codigo no cambia nada).",
  },
  "092_factura_emitida_fuera.sql": {
    que: "Registrar factura emitida fuera: origen 'externo', indice unico de CUFE por bufete, serie FAC-EXT- (invoice_ext), guard que congela el estado fiscal y RPC register_external_invoice (numero, factura, asiento y CUFE en una transaccion)",
    tipo: "funcion", nombre: "register_external_invoice",
    nota: "05/10. Pre-flight: aborta si hay un CUFE repetido entre facturas. Va junto con el codigo de facturas-externas (sin la 092 la pantalla nueva falla al guardar; lo demas no cambia).",
  },
  "093_compra_nace_pendiente.sql": {
    que: "DEFAULT de business_expenses.status pasa de 'pagado' (010) a 'pendiente_pago', el unico valor que el guard de la 048 acepta al crear",
    tipo: "dato",
    sql: `SELECT pg_get_expr(d.adbin, d.adrelid) = '''pendiente_pago''::text' FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum WHERE d.adrelid = 'public.business_expenses'::regclass AND a.attname = 'status'`,
    nota: "05/10. Hallazgo del ensayo de la ventana. Va justo despues de la 048. No toca filas.",
  },
  "094_documentos_de_prueba.sql": {
    que: "Marca de prueba por DOCUMENTO (de_prueba en invoices, credit_notes, payments, client_payments, expenses) y clients.es_de_prueba solo para lo nuevo; guards de marcar (sin asiento) y desmarcar (llave)",
    tipo: "columna", tabla: "invoices", columna: "de_prueba",
    nota: "05/10. Propuesta corte QuickBooks 9 ajustada: FAC-HON-000463 es real con cliente 0TEST-FE-002. Va al final del Bloque C; despues, el paso sql/ventana/marcar-datos-de-prueba.sql.",
  },
  "095_documentos_de_prueba_fuera_del_libro.sql": {
    que: "El libro rechaza asientos de documentos de prueba y asientos manuales con un cliente de prueba como tercero; la NC hereda la marca de su factura; cobro y factura no se mezclan (prueba/real)",
    tipo: "funcion", nombre: "finanzas_libro_sin_documentos_de_prueba",
    nota: "05/10. Va despues de la 094. La factura REAL de un cliente de prueba (FAC-HON-000463) sigue entrando al libro.",
  },
  "096_inicio_contable.sql": {
    que: "Inicio contable (finanzas_parametros.fecha_inicio_contable, 01/07/2026): el libro rechaza el asiento de un documento con fecha anterior (contabilizado fuera); el inicio no se mueve si cruza documentos",
    tipo: "columna", tabla: "finanzas_parametros", columna: "fecha_inicio_contable",
    nota: "06/10. Va al final del Bloque C, despues de la 095. Pre-flight: en produccion 0 asientos de documentos anteriores (libro vacio); staging se aplica con la llave finanzas.inicio_contable_existentes.",
  },
  "099_solo_importados_bloquean_y_banco_del_cobro.sql": {
    que: "post_documentos_existentes se niega solo con asientos IMPORTADOS vigentes (los manuales de ajuste se listan, no bloquean); el banco de un cobro con asiento no cambia (trigger)",
    tipo: "funcion", nombre: "finanzas_banco_de_cobro_contabilizado",
    nota: "07/10. Va junto con la 097 y la 098, despues de la ventana. No toca datos.",
  },
  "098_un_mes_un_metodo_en_los_dos_sentidos.sql": {
    que: "La importacion masiva no entra en un mes contabilizado desde los documentos (trigger en journal_import_entries); post_documentos_existentes toma el candado del correlativo antes de mirar el mes y verifica el FAC-CO- del gasto",
    tipo: "funcion", nombre: "finanzas_importacion_no_pisa_documentos",
    nota: "07/10. Va junto con la 097, despues de la ventana. Los ajustes a mano no se bloquean.",
  },
  "097_posteo_de_documentos_existentes.sql": {
    que: "Posteo de documentos existentes por mes: post_documentos_existentes (un lote, una transaccion; se niega si el rango tiene asientos manuales o empieza antes del inicio) y su registro (posteos_retroactivos)",
    tipo: "funcion", nombre: "post_documentos_existentes",
    nota: "07/10. NO va en la ventana: se aplica despues, antes de contabilizar julio. No toca datos.",
  },
  "085_motivo_pendiente_dgi.sql": {
    que: "fe_motivo_pendiente y fe_motivo_pendiente_en en invoices y credit_notes: por qué un documento no llegó a la DGI",
    tipo: "columna", tabla: "invoices", columna: "fe_motivo_pendiente",
    nota: "03/10. Validaciones previas a la DGI y lista de pendientes. Solo usa invoices y credit_notes (existen desde antes de la 025).",
  },
  "084_audit_log_solo_agregar.sql": {
    que: "audit_log: politica FOR SELECT (misma expresion de bufete), sin UPDATE/DELETE/TRUNCATE para anon/authenticated y trigger de solo agregar",
    tipo: "funcion", nombre: "audit_log_solo_agregar",
    nota: "Hotfix de seguridad. APLICADA EN PRODUCCION el 03/10/2026 por Oliver (sola: produccion = 024 + 084); en main desde 9b00b12. En la ventana 025 -> 083 entra igual y no cambia nada (idempotente, probado en staging). Todas las escrituras usan el cliente de servicio.",
  },
  "083_fe_estado_interna.sql": {
    que: "fe_estado 'interna' en invoices y credit_notes (NC/ND emitida sin enviarse a la DGI), terminal por trigger",
    tipo: "funcion", nombre: "finanzas_fe_estado_interna_guard",
    nota: "03/10. La NC/ND interna postea igual en el libro y nunca llama al PAC. Solo desde no_emitida; de interna no se sale.",
  },
  "082_otros_servicios_y_nc_sin_bancos.sql": {
    que: "400010 Otros servicios con HON-OTROS; create_supplier_credit_note rechaza bancos (finanzas_es_cuenta_de_banco)",
    tipo: "funcion", nombre: "finanzas_es_cuenta_de_banco",
    nota: "Respuestas de Josuarth del 02/10 y recorrido del 03/10. Parche verificado sobre la definicion vigente (081). Va despues de la 081.",
  },
  "080_cierre_anual.sql": {
    que: "Cierre anual: close_fiscal_year (asiento cierre al 31/12 contra 300002, verificado), finanzas_saldos_de_resultado y reverse_journal_entry acepta cierre",
    tipo: "funcion", nombre: "close_fiscal_year",
    nota: "Bloque 1, E11, 01/10. Uno vigente por ano y en orden; EXECUTE solo service_role. El Estado de Resultado excluye los cierres en la app. Parche verificado sobre la definicion vigente de reverse_journal_entry.",
  },
  "068_fechas_de_registro.sql": {
    que: "Fecha de registro (accounting_date) en facturas, compras, gastos de tramite y NC de venta; backfill desde el libro; congelada al emitir",
    tipo: "columna", tabla: "invoices", columna: "accounting_date",
    nota: "Bloque 1, E1, 30/09. La fecha del documento sigue siendo la que ya existia (issue_date, expense_date, date); la de registro es la del asiento y define el periodo. No toca el libro: solo lo LEE para el backfill.",
  },
  "069_reversion_con_fecha_elegida.sql": {
    que: "Reversiones, anulaciones y NC de compra sin el candado de 'hoy +/-1 dia': el contador elige la fecha de registro",
    tipo: "cuerpo_funcion", nombre: "reverse_payment", contiene: "La reversión necesita una fecha de registro",
    nota: "Bloque 1, E1, 30/09. Parche verificado sobre la definicion vigente de nueve funciones (no copias). Depende de la 068 (cancel_invoice_with_reversal mide el mes por accounting_date). Se mira el cuerpo: el nombre de la funcion no cambia.",
  },
  "070_gasto_tramite_factura_proveedor.sql": {
    que: "expenses.supplier_invoice_number: numero de factura del proveedor en el gasto de tramite",
    tipo: "columna", tabla: "expenses", columna: "supplier_invoice_number",
    nota: "Bloque 1, E2, 30/09. Mismas reglas que la 044 en compras: opcional, 1..50, sin UNIQUE. No se congela al postear: no entra al asiento hasta E3.",
  },
  "077_nota_de_debito.sql": {
    que: "Nota de debito: invoice_kind NOTA_DEBITO, serie debit_note (ND-), referenced_invoice_id opcional (mismo cliente, emitida) y T4 que la congela",
    tipo: "cuerpo_funcion", nombre: "finanzas_referencia_de_nota_de_debito", contiene: "nota de débito",
    nota: "Bloque 1, decision 14, 01/10. Mismo efecto que una factura de venta (asiento source_type factura). El envio al PAC (tipo 05) queda apagado en la app hasta probarlo en el sandbox (PERMITIR_ND_A_LA_DGI).",
  },
  "076_nc_modulo_propio.sql": {
    que: "Notas de credito como modulo propio: factura y compra opcionales, aplicaciones de NC (venta y compra), credited_total desde aplicaciones, create_supplier_credit_note con lineas libres, apply_credit_note y apply_supplier_credit_note",
    tipo: "tabla", tabla: "credit_note_applications",
    nota: "Bloque 1, E8, 01/10. La NC con factura sigue acreditandola entera por invoice_id (sin backfill); la verificacion final aborta si cambia un solo credited_total. La NC de venta sin factura queda apagada en la app (PERMITIR_NC_VENTA_SIN_FACTURA, P-4a).",
  },
  "075_ancla_de_la_cadena.sql": {
    que: "Ancla externa de la cadena: accounting_chain_anchors inmutable, ancla al cerrar cada periodo (trigger), ancla inicial y verify_chain_anchors",
    tipo: "tabla", tabla: "accounting_chain_anchors",
    nota: "Bloque 1, R-1b, 01/10. El ancla sale de la base en el respaldo diario (la tabla se baja sola) y en la constancia PDF del cierre. No toca el libro: solo lee el ultimo asiento.",
  },
  "074_cobro_con_excedente.sql": {
    que: "Cobro con excedente: referencia obligatoria al crear (trigger) y apply_payment_credit para aplicar el saldo a favor sin asiento",
    tipo: "cuerpo_funcion", nombre: "apply_payment_credit", contiene: "saldo a favor",
    nota: "Bloque 1, punto 5, 01/10. El excedente queda en amount_unapplied (T7b/T7c ya lo derivaban) y en 100004 con el cliente. La referencia es trigger BEFORE INSERT y no CHECK NOT VALID: el CHECK se evalua en cada UPDATE y reversar un cobro viejo sin referencia fallaria.",
  },
  "073_tasa_con_cuenta.sql": {
    que: "Cada tasa de impuesto con su cuenta (tax_codes.account_code, backfill 200003), reglas de la cuenta y NC de compra verificada por cuenta de tasa",
    tipo: "columna", tabla: "tax_codes", columna: "account_code",
    nota: "Bloque 1, punto 6, 01/10. Josuarth P-6a: una cuenta por tasa, la misma para ventas y compras. Una vez usada la tasa su cuenta no cambia (trigger). Va con el codigo: el alta de una tasa sin cuenta falla.",
  },
  "072_hash_v5_y_verificador.sql": {
    que: "Hash v5 (JSON canonico, sin separadores ambiguos), hash_version por asiento, tramos de versiones viejas y verify_accounting_chain que recalcula el contenido",
    tipo: "columna", tabla: "journal_entries", columna: "hash_version",
    nota: "Bloque 1, R-1, 01/10. No toca el libro: detecta la version de cada asiento viejo y la guarda por tramos en accounting_hash_versions. Aborta si un asiento no se reproduce con ninguna formula o si el verificador nuevo encuentra un solo problema. Parche verificado del motor de la 071.",
  },
  "071_motor_v4_referencias_y_terceros.sql": {
    que: "Motor v4: referencia_externa (en el hash), numero AD- en el motor, tercero obligatorio en 100004/200001, FAC-CO- (purchase_number), NC-CO-",
    tipo: "columna", tabla: "journal_entries", columna: "referencia_externa",
    nota: "Bloque 1, E3, 01/10. DROP + CREATE de post_journal_entry (13 -> 14 parametros, permisos de la 030 otra vez). Parches verificados al lote (067), a la NC de compra y al trigger de gastos de tramite. 🔴 Va JUNTO con el codigo de E3: con el candado de tercero y de p_reference, el codigo anterior falla al postear.",
  },

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
