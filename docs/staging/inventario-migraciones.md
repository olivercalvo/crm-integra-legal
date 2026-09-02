# Inventario de migraciones — estado real vs. producción

**Fecha del relevamiento:** 2026-08-25
**Para qué sirve:** saber exactamente qué correr, y en qué orden, al levantar la base de
staging (Fase 0, Tarea 3), y dejar de tratar a `sql/pending/` como si fuera una cola.

> **`sql/pending/` NO es una cola de pendientes.** Es un cajón donde conviven migraciones
> ya aplicadas en producción hace meses con otras que nunca se corrieron. El nombre
> engaña. Este documento es la fuente de verdad; el directorio no lo es.

---

## 1. `supabase/migrations/` — en orden

Ninguna de estas se aplicó con `supabase db push`: **todas se corrieron a mano en el SQL
Editor**, convención del proyecto desde el 2026-04-05. No hay tabla de historial de
migraciones en la base, y por eso el estado hay que reconstruirlo así.

| # | Archivo | ¿En prod? | Qué hace |
|---|---|---|---|
| 1 | `20260402000001_initial_schema.sql` | sí | Esquema base: 14 tablas, RLS por `tenant_id`, índices, trigger `updated_at` |
| 2 | `20260402000002_seed_data.sql` | sí | Catálogos iniciales del tenant (estados, clasificaciones, 5 instituciones) |
| 3 | `20260402000003_seed_clients_cases.sql` | sí | ⛔ **23 clientes + 46 casos REALES del bufete, sacados del Excel.** Ver §4 |
| 4 | `20260403000001_fix_rls_jwt_claims.sql` | sí | Las funciones de RLS pasan a leer el tenant de `app_metadata` del JWT |
| 5 | `20260403000002_add_case_fields.sql` | sí | 8 columnas de seguimiento en `cases` + `follow_up_date` en `comments` |
| 6 | `20260403000003_add_assistant_id.sql` | sí | `cases.assistant_id` → `users` |
| 7 | `20260403000004_add_client_fields.sql` | sí | `clients.address`, `clients.client_since` |
| 8 | `20260403000005_responsible_id_to_users.sql` | sí | `cases.responsible_id` deja de apuntar a `cat_team` y apunta a `users` |
| 9 | `20260403000006_seed_complete_demo.sql` | sí | Datos de demo ficticios (etapa temprana). Innecesario hoy |
| 10 | `20260403000010_complete_demo_data.sql` | sí | Más datos de demo ficticios. Innecesario hoy |
| 11 | `20260403000011_fill_clients_and_documents.sql` | sí | Rellena clientes y documentos de la demo. Innecesario hoy |
| 12 | `20260403000012_todos_and_prospects.sql` | sí | 6 tablas: `personal_todos`, `todo_comments`, `todo_documents`, `prospects`, `prospect_comments`, `prospect_documents` |
| 13 | `20260403000013_extend_document_entity_types.sql` | sí | Amplía el CHECK de `documents.entity_type` a tareas y comentarios |
| 14 | `20260404000001_v1_1_feedback_changes.sql` | **no** | ⚠️ Versión con error de sintaxis. **Reemplazada** por la `_fixed` de abajo. No correr |
| 15 | `20260404000001_v1_1_feedback_changes_fixed.sql` | sí | Unifica estados "Activo"→"En trámite", `expenses.expense_type`, colores de clasificación, `personal_todos.assigned_to` |
| 16 | `20260404000002_payment_type.sql` | sí | `client_payments.payment_type` ('tramite' \| 'administrativo') |
| 17 | `20260405000001_client_responsible_lawyer.sql` | sí | `clients.responsible_lawyer_id` → `users` |
| 18 | `20260504000001_add_contador_role.sql` | sí | Agrega `'contador'` al CHECK de `users.role` |
| 19 | `20260505000001_finanzas_extend_clients.sql` | sí | 7 columnas fiscales/cobranza en `clients` + 4 CHECK |
| 20 | `20260505000002_finanzas_catalogos.sql` | sí | `chart_of_accounts` (17 cuentas), `tax_codes` (3), `services_catalog` (9), `numbering_sequences` + `get_next_sequence_number()` |
| 21 | `20260505000003_finanzas_b3a_quotes.sql` | sí | `quotes` + `quote_lines` |
| 22 | `20260505000004_finanzas_b3b_invoices.sql` | sí | `invoices` + `invoice_lines` |
| 23 | `20260505000005_finanzas_b3c_credit_notes.sql` | sí | `credit_notes` + `credit_note_lines` |
| 24 | `20260505000006_finanzas_b3d_payments.sql` | sí | `payments` + `payment_applications` |
| 25 | `20260505000007_finanzas_b3e_triggers.sql` | sí | **Los triggers T1–T8**: transiciones de estado, inmutabilidad de documentos y líneas, recálculo de totales. Crítico |
| 26 | `20260506000001_finanzas_b4_schema_prep_dgi.sql` | sí | 4 columnas DGI en `invoices` (confirmado en changelog) |
| 27 | `20260507000001_finanzas_b4_anular_factura.sql` | sí | `cancellation_reason`, `cancelled_at` + transición a `anulada` (confirmado en changelog) |
| 28 | `20260508000001_clients_add_status_and_type.sql` | sí | `client_status`, `client_type`. El archivo dice "YA APLICADO 2026-05-08" |
| 29 | `20260508000002_quotes_extension_and_terms_template.sql` | sí | ~19 columnas en `quotes` (token público, envío, aprobación, conversión) + `quote_terms_template`. "YA APLICADO 2026-05-08" |
| 30 | `20260508000003_clients_drop_active_legacy.sql` | sí | Dropea `clients.active` (hoy es columna generada). "YA APLICADO 2026-05-13" |
| — | `migration_completa.sql` | n/a | Consolidado histórico de las 14 tablas iniciales. **No correr**: se pisa con las numeradas |
| — | `migration_final_consolidada.sql` | n/a | Otro consolidado histórico. **No correr** |

## 2. `sql/pending/` — en orden

| Archivo | ¿En prod? | Qué hace |
|---|---|---|
| `001_fix_case_code_civ_002_to_ext.sql` | **sí** | Re-numera un caso mal grabado CIV-002 → EXT-001. *Changelog: ejecutado a mano el 2026-04-21* |
| `002_enable_unaccent_and_search_rpcs.sql` | **sí** | Extensión `unaccent` + RPCs de búsqueda universal. *Changelog: ejecutado el 2026-04-21* |
| `004_verify_familia_classification.sql` | **n/a** | Solo `SELECT` de verificación. No modifica nada; no hay nada que aplicar |
| `005_add_familia_classification.sql` | **sí** | Clasificación FAMILIA (prefijo FAM). *Changelog: ejecutado el 2026-04-28* |
| `006_extend_documents_for_auto_pdfs.sql` | **sí** (inferido) | `documents.source/source_version/source_content_hash` + `entity_type='quote'`. La generación de PDF de cotizaciones está viva en `main` y escribe estas columnas |
| `007_quotes_add_title.sql` | **sí** | `quotes.title` NOT NULL + CHECK 3-100 + backfill. *Changelog: "ya ejecutada por Oliver"*. ⚠️ El changelog la nombra `007_quotes_title_required.sql`; el archivo real es `007_quotes_add_title.sql` |
| `008_extend_chart_of_accounts.sql` | **sí** (inferido) | `is_system`, `account_name_qb`, `description` + 17 cuentas más. El módulo de reportes vive en `main` y lee `is_system` |
| `009_create_tax_payments.sql` | **sí** (inferido) | Tabla `tax_payments` (línea 9 del VAT Summary). Referenciada por 4 archivos vivos en `main` |
| `010_create_business_expenses.sql` | **sí** (inferido) | Tabla `business_expenses` (compras del bufete). Referenciada por 10 archivos vivos en `main` |
| `011_business_expenses_rls_abogada.sql` | **sí** (inferido) | RLS: la abogada puede crear/editar/borrar gastos del bufete |
| `012_extend_services_quotes_observations.sql` | **sí** (inferido) | `services_catalog.sort_order` + `quotes.observations` + `credit_notes.observations`. `observations` aparece en 32 archivos vivos |
| `013_create_observation_templates.sql` | **sí** (inferido) | Catálogo `observation_templates` |
| `014_quotes_estado_emitida.sql` | **sí** (inferido) | Agrega `'emitida'` al CHECK de `quotes.status` y reescribe `finanzas_validate_status_transition()`. Sin esto el alta de cotizaciones desde la UI rompe |
| `015_quote_acceptances_rejections.sql` | **sí** (inferido) | `quote_acceptances` + `quote_rejections` para el portal público, que está vivo en `main` |
| `016_quotes_source_quote_id.sql` | **sí** (inferido) | `quotes.source_quote_id` (duplicar cotización) |
| `018_cleanup_test_quotes.sql` | **sí** | Borra 18 cotizaciones de prueba. *El propio archivo dice "EJECUTADO EN PRODUCCIÓN 2026-05-29"* |
| `019_efactura_fase_1a_modelo_datos.sql` | **sí** | 8 columnas en `clients`, 9 en `invoices`, tablas `fe_emisiones` y `fe_secuencias`. *El archivo dice "EJECUTADO 2026-05-30"* |
| `020_efactura_allocator.sql` | **sí** | RPC `allocate_fe_numero`. *El archivo dice "EJECUTADO 2026-06-02"* |
| `021_client_numbering_sequence.sql` | **sí** (inferido) | Agrega `'client'` a `numbering_sequences` + siembra la fila. El código que la exige está vivo en prod y crea clientes sin romperse — sin esta migración, `get_next_sequence_number(tenant,'client')` tiraría `no_data_found` en TODO alta de cliente |
| `022_backfill_dv_embebido.sql` | **NO** | Extrae el DV escrito como texto (" DV NN") a `digito_verificador`, limpia el número y puebla `tipo_receptor_fe`. **Confirmado sin aplicar por Oliver**, y así se queda hasta que se retome como bloque propio (ver `task_plan.md`). **Universo medido en producción el 02/09/2026: 2 clientes** — CLI-026 INTEGRA LEGAL y CLI-081 SERVICARE, los dos con el DV pegado al texto y `digito_verificador` vacío, o sea **bloqueados por el gate fiscal y sin riesgo de mandarle un RUC sucio a la DGI**. El encabezado del script habla de 4 clientes: CLI-096 y CLI-107 ya se corrigieron a mano. Estuvo sin commitear hasta el 2026-08-25; ahora está versionado |
| `023_contabilidad_fase1_ledger.sql` | **sí** | Motor del ledger: `accounting_periods`, `accounting_sequences`, `journal_entries`, `journal_entry_lines`, `accounting_legajos` + 6 triggers de inmutabilidad + RLS. **Confirmado por Oliver** |
| `024_chart_of_accounts_saldo_subcategoria.sql` | **sí** | `chart_of_accounts.saldo_inicial` y `.subcategoria`. **Confirmado por Oliver** |

### Archivos sin numerar en el mismo directorio

| Archivo | ¿En prod? | Qué hace |
|---|---|---|
| `add_extrajudicial_classification.sql` | **sí** (inferido) | Clasificación EXTRAJUDICIAL (EXT). El changelog dice "no ejecutado" el 2026-04-20, pero el 2026-04-21 la migración 001 movió un caso a **EXT-001**, así que para entonces ya existía |
| `add_payment_description_receipt.sql` | **sí** (inferido) | `client_payments.description/receipt_url/receipt_filename`. La edición de pagos con recibo está viva |
| `add-receipt-to-expenses.sql` | **sí** (inferido) | `expenses.receipt_url/receipt_filename` |
| `backfill_client_type_null.sql` | **incierto** | Backfill de `client_type` para 26 clientes legacy. Es puro dato: no hay forma de saberlo desde el repo. **Verificar contra la base** |
| `cleanup-test-users-2026-05-02.sql` | **incierto** | Borra 3 usuarios de prueba. **Verificar contra la base** |
| `fix-duplicate-classifications.sql` | **sí** (inferido) | Deduplica `cat_classifications` por prefijo. El dropdown de prod no muestra duplicados |
| `fix-duplicate-statuses-2026-08-23.sql` | **sí** | Deja `cat_statuses` en 2 filas activas. *El archivo dice "YA APLICADO 2026-08-23 por Oliver"* |
| `hotfix_cli116_client_type.sql` | **incierto** | UPDATE de una fila (CLI-116 → `persona_juridica`). **Verificar contra la base** |
| `storage_rls_policies.sql` | **sí, pero obsoleto** | Políticas de Storage ABIERTAS (solo chequean `bucket_id`). Fueron el hallazgo OWASP Crítico #1 y las reemplaza el archivo de abajo. **No correr en staging** |
| `storage_rls_tenant_scoped.sql` | **sí** | Aísla el bucket `documents` por tenant. *El archivo dice "APLICADO 2026-07-13, verificado"*. Ésta es la buena |
| `update-classification-colors.sql` | **sí** (inferido) | Colores oficiales de las clasificaciones. Los badges de prod los muestran |
| `ENVIRONMENT_VARIABLES.md` | n/a | No es SQL |

**Faltan los números 003 y 017.** No existen en el directorio y no aparecen en el
historial de git. O nunca se crearon, o se borraron sin dejar rastro.

---

## 3. Qué verificar contra la base antes de seguir

Tres archivos y nada más. Los tres son cambios de **dato**, no de esquema, y por eso el
repo no puede responderlos:

```sql
-- backfill_client_type_null.sql → ¿quedan clientes sin tipo?
SELECT COUNT(*) FROM clients
WHERE tenant_id='a0000000-0000-0000-0000-000000000001' AND client_type IS NULL;
-- Si el backfill corrió: 3 (los tres DUDOSOS que quedaron fuera a propósito).
-- Si no corrió: 29.

-- hotfix_cli116_client_type.sql
SELECT client_number, client_type FROM clients
WHERE tenant_id='a0000000-0000-0000-0000-000000000001' AND client_number='CLI-116';
-- Aplicado → 'persona_juridica'. Sin aplicar → NULL.

-- cleanup-test-users-2026-05-02.sql
SELECT email FROM users WHERE email IN (
  'test-abog-0502@integra-panama.com',
  'test-asis-0502@integra-panama.com',
  'asistente@integra-panama.com');
-- Aplicado → 0 filas.
```

---

## 4. Orden de aplicación para STAGING

No es "correr todo". Hay tres grupos que **se saltan a propósito**.

### 4.1 Se saltan — datos reales de clientes (Ley 81)

- `supabase/migrations/20260402000003_seed_clients_cases.sql` — **23 clientes y 46 casos
  REALES** del bufete, extraídos del Excel, con los nombres de las licenciadas. Meter esto
  en staging es exactamente lo que Fase 0 vino a evitar.
- `scripts/load_real_data.sql` y `scripts/run_all_pending.sql` (que lo incluye en su
  PARTE 3) — mismo problema.

### 4.2 Se saltan — datos de demo viejos que chocan con el seed nuevo

`20260403000006_seed_complete_demo.sql`, `20260403000010_complete_demo_data.sql`,
`20260403000011_fill_clients_and_documents.sql`. Son ficticios, así que no hay problema
legal, pero duplicarían catálogos y ensuciarían los conteos. Los reemplaza
`npm run seed:staging`.

### 4.3 Se saltan — reemplazados o rotos

`20260404000001_v1_1_feedback_changes.sql` (sintaxis rota, usar la `_fixed`),
`migration_completa.sql`, `migration_final_consolidada.sql`,
`sql/pending/storage_rls_policies.sql` (políticas abiertas; usar `storage_rls_tenant_scoped`),
y los limpiadores de datos que no tienen a qué apuntar en una base vacía:
`001`, `018`, `cleanup-test-users-2026-05-02`, `fix-duplicate-classifications`,
`fix-duplicate-statuses-2026-08-23`, `backfill_client_type_null`,
`hotfix_cli116_client_type`, `022_backfill_dv_embebido`.

### 4.4 Se corren — esquema, en este orden

```
supabase/migrations/
  20260402000001_initial_schema.sql
  20260402000002_seed_data.sql
  20260403000001_fix_rls_jwt_claims.sql
  20260403000002_add_case_fields.sql
  20260403000003_add_assistant_id.sql
  20260403000004_add_client_fields.sql
  20260403000005_responsible_id_to_users.sql
  20260403000012_todos_and_prospects.sql
  20260403000013_extend_document_entity_types.sql
  20260404000001_v1_1_feedback_changes_fixed.sql
  20260404000002_payment_type.sql
  20260405000001_client_responsible_lawyer.sql
  20260504000001_add_contador_role.sql
  20260505000001_finanzas_extend_clients.sql
  20260505000002_finanzas_catalogos.sql
  20260505000003_finanzas_b3a_quotes.sql
  20260505000004_finanzas_b3b_invoices.sql
  20260505000005_finanzas_b3c_credit_notes.sql
  20260505000006_finanzas_b3d_payments.sql
  20260505000007_finanzas_b3e_triggers.sql
  20260506000001_finanzas_b4_schema_prep_dgi.sql
  20260507000001_finanzas_b4_anular_factura.sql
  20260508000001_clients_add_status_and_type.sql
  20260508000002_quotes_extension_and_terms_template.sql
  20260508000003_clients_drop_active_legacy.sql

sql/pending/
  002_enable_unaccent_and_search_rpcs.sql
  005_add_familia_classification.sql
  add_extrajudicial_classification.sql
  update-classification-colors.sql
  add_payment_description_receipt.sql
  add-receipt-to-expenses.sql
  006_extend_documents_for_auto_pdfs.sql
  007_quotes_add_title.sql
  008_extend_chart_of_accounts.sql
  009_create_tax_payments.sql
  010_create_business_expenses.sql
  011_business_expenses_rls_abogada.sql
  012_extend_services_quotes_observations.sql
  013_create_observation_templates.sql
  014_quotes_estado_emitida.sql
  015_quote_acceptances_rejections.sql
  016_quotes_source_quote_id.sql
  019_efactura_fase_1a_modelo_datos.sql
  020_efactura_allocator.sql
  021_client_numbering_sequence.sql
  023_contabilidad_fase1_ledger.sql
  024_chart_of_accounts_saldo_subcategoria.sql
  storage_rls_tenant_scoped.sql
```

Sobre `20260508000003_clients_drop_active_legacy.sql`: trae un `DO $$` que espera encontrar
`clients.active` como columna generada, que no es como queda en una base recién creada
(`initial_schema` la crea como BOOLEAN común). **No aborta**: emite un `RAISE NOTICE` y la
dropea igual, que es el resultado que se busca.

### 4.5 Después del esquema

```bash
npm run seed:staging
```

---

## 5. Cómo se comparan los conteos contra producción (Tarea 3)

Las consultas de abajo se corren **una vez en cada base** y se comparan a mano. Las de
producción son de solo lectura.

```sql
-- Tablas
SELECT COUNT(*) FROM information_schema.tables
WHERE table_schema='public' AND table_type='BASE TABLE';

-- Políticas RLS
SELECT COUNT(*) FROM pg_policies WHERE schemaname='public';

-- Triggers (sin los internos de FK)
SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_schema='public';

-- Triggers de inmutabilidad del ledger — deben ser 6
SELECT tgname FROM pg_trigger
WHERE tgname IN ('trg_je_no_update','trg_je_no_delete','trg_jel_no_update',
                 'trg_jel_no_delete','trg_leg_no_update','trg_leg_no_delete')
ORDER BY tgname;

-- Secuencias de numeración
SELECT sequence_type, last_number FROM numbering_sequences
WHERE tenant_id='a0000000-0000-0000-0000-000000000001' ORDER BY sequence_type;

-- Plan de cuentas — prod: 62 activas, 34 inactivas (legacy QuickBooks)
SELECT active, COUNT(*) FROM chart_of_accounts
WHERE tenant_id='a0000000-0000-0000-0000-000000000001' GROUP BY active;
```

Los **datos** no se comparan: staging tiene 15 clientes y 30 casos ficticios contra los
207 casos de producción, y esa diferencia es el objetivo, no un problema.
