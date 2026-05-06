# Batch 3 — Runbook de ejecución en Supabase

Aplicación del schema completo de documentos transaccionales de Finanzas: **8 tablas nuevas + 19 funciones + 19 triggers de lógica + 8 triggers de `updated_at`** (27 triggers en total).

- **Commit de referencia:** `6c85f4e`
- **Branch:** `develop`
- **Tiempo estimado total:** 15–25 minutos (5 archivos, ~3–5 min cada uno incluyendo verificación)

> **Importante:** cada uno de los 5 archivos tiene `BEGIN; … COMMIT;` explícito. Si algo falla en cualquier punto del archivo, **toda la transacción se revierte**. No quedan tablas/triggers a medias. Esto es seguro para re-intentar el mismo archivo después de corregir.

---

## Índice

1. [Pre-requisitos](#pre-requisitos)
2. [Archivo 1 de 5 — quotes](#archivo-1-de-5--quotes)
3. [Archivo 2 de 5 — invoices](#archivo-2-de-5--invoices)
4. [Archivo 3 de 5 — credit_notes](#archivo-3-de-5--credit_notes)
5. [Archivo 4 de 5 — payments](#archivo-4-de-5--payments)
6. [Archivo 5 de 5 — triggers](#archivo-5-de-5--triggers)
7. [Verificación global post-ejecución](#verificación-global-post-ejecución)
8. [Troubleshooting](#troubleshooting)

---

## Pre-requisitos

- [ ] Logueado en Supabase con la cuenta del cliente Integra Legal
- [ ] URL del SQL Editor: `https://supabase.com/dashboard/project/uqmmkklbhzxqybljiecs/sql/new`
- [ ] Una pestaña nueva del SQL Editor por cada archivo (no reusar)
- [ ] El commit `6c85f4e` está en local: `git log --oneline -1 develop` debe mostrarlo
- [ ] Anti-Gravity con los 5 archivos accesibles para copiar
- [ ] Batches 1 y 2 ya aplicados (extender clients + catálogos). Verificar:
  ```sql
  SELECT count(*) FROM chart_of_accounts;     -- esperado: 17
  SELECT count(*) FROM tax_codes;             -- esperado: 3
  SELECT count(*) FROM services_catalog;      -- esperado: 9
  SELECT count(*) FROM numbering_sequences;   -- esperado: 4
  ```

---

## Archivo 1 de 5 — quotes

**Path:** `supabase/migrations/20260505000003_finanzas_b3a_quotes.sql`
**Líneas aprox:** 201
**Crea:** tablas `quotes` + `quote_lines` con RLS y generated columns (subtotal, tax_amount, line_total)

### Pasos

1. En Anti-Gravity: `Ctrl+P` → pegá `20260505000003_finanzas_b3a_quotes.sql`
2. `Ctrl+A` → `Ctrl+C`
3. SQL Editor de Supabase: **pestaña nueva** → `Ctrl+V`
4. Click en **Run** (o `Ctrl+Enter`)
5. Esperá el resultado

### Cómo confirmar éxito

- Mensaje verde "Success. No rows returned" o un grid pequeño con los SELECT de verificación que vienen al final del archivo.
- Output esperado de las verificaciones embebidas:
  - **Tabla 1 (RLS check):** 2 filas — `quotes` y `quote_lines`, ambas con `rls_enabled = true`
  - **Tabla 2 (counts):** 2 filas — `quotes: 0`, `quote_lines: 0`
  - **Tabla 3 (CHECKs):** 8 filas con los nombres `quotes_*_check` y `quote_lines_*_check`

### Verificaciones extra (copy-paste)

```sql
-- 1. Tablas existen + RLS activo
SELECT relname, relrowsecurity AS rls
FROM   pg_class
WHERE  relnamespace = 'public'::regnamespace
  AND  relname IN ('quotes', 'quote_lines')
ORDER  BY relname;
-- Esperado: 2 filas, rls=true en ambas
```

```sql
-- 2. Policy de tenant_isolation aplicada
SELECT tablename, policyname
FROM   pg_policies
WHERE  tablename IN ('quotes', 'quote_lines')
ORDER  BY tablename;
-- Esperado: quote_lines | quote_lines_tenant_isolation
--           quotes      | quotes_tenant_isolation
```

```sql
-- 3. Generated columns en quote_lines
SELECT column_name, is_generated
FROM   information_schema.columns
WHERE  table_name = 'quote_lines'
  AND  column_name IN ('subtotal', 'tax_amount', 'line_total')
ORDER  BY column_name;
-- Esperado: 3 filas, is_generated='ALWAYS' en todas
```

### Si falla

- `relation "quotes" already exists` → ya ejecutaste este archivo. Confirmar con verificaciones extra. Si todo OK, pasá al siguiente.
- `permission denied for schema public` → cuenta Supabase incorrecta.
- `function public.get_tenant_id() does not exist` → Batch 1 no aplicado correctamente. **Frená.**
- Cualquier `syntax error` → copiá el texto literal y reportámelo antes de tocar nada.
- Cualquier otro error → como hay `BEGIN/COMMIT`, todo se revirtió. Reportá el mensaje completo.

### Checklist

- [ ] Ejecutado sin error
- [ ] Verificaciones embebidas del archivo dieron OK
- [ ] Verificaciones extra dieron OK
- [ ] Listo para siguiente archivo

---

## Archivo 2 de 5 — invoices

**Path:** `supabase/migrations/20260505000004_finanzas_b3b_invoices.sql`
**Líneas aprox:** 213
**Crea:** tablas `invoices` (con `balance_due` GENERATED) + `invoice_lines`

### Pasos

1. Pestaña **nueva** del SQL Editor (no reusar la del archivo anterior).
2. Anti-Gravity: abrí `20260505000004_finanzas_b3b_invoices.sql` → `Ctrl+A` → `Ctrl+C`.
3. Pegá en Supabase → Run.

### Cómo confirmar éxito

- Output esperado de las verificaciones embebidas:
  - **Tabla 1 (RLS check):** 2 filas — `invoices` y `invoice_lines`, `rls_enabled=true`
  - **Tabla 2 (counts):** `invoices: 0`, `invoice_lines: 0`
  - **Tabla 3 (balance_due):** 1 fila — `is_generated=ALWAYS`, expression contiene `grand_total - amount_paid`
  - **Tabla 4 (CHECKs):** 11 filas (`invoices_*_check` × 7 + `invoice_lines_*_check` × 4)

### Verificaciones extra (copy-paste)

```sql
-- 1. invoice_kind CHECK constraint con HONORARIOS y REEMBOLSO
SELECT pg_get_constraintdef(oid) AS def
FROM   pg_constraint
WHERE  conrelid = 'invoices'::regclass
  AND  conname = 'invoices_invoice_kind_check';
-- Esperado: CHECK ((invoice_kind = ANY (ARRAY['HONORARIOS'::text, 'REEMBOLSO'::text])))
```

```sql
-- 2. balance_due es generated y depende de grand_total y amount_paid
SELECT column_name, generation_expression
FROM   information_schema.columns
WHERE  table_name = 'invoices'
  AND  column_name = 'balance_due';
-- Esperado: 1 fila, generation_expression incluye "grand_total - amount_paid"
```

```sql
-- 3. FK invoices.quote_id → quotes con ON DELETE SET NULL
SELECT pg_get_constraintdef(oid) AS def
FROM   pg_constraint
WHERE  conrelid = 'invoices'::regclass
  AND  contype = 'f'
  AND  pg_get_constraintdef(oid) LIKE '%quotes%';
-- Esperado: FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE SET NULL
```

### Si falla

- `relation "quotes" does not exist` → archivo 1 no aplicado. Volvé al paso anterior.
- Resto: idem archivo 1.

### Checklist

- [ ] Ejecutado sin error
- [ ] Verificaciones embebidas OK
- [ ] Verificaciones extra OK
- [ ] Listo para siguiente archivo

---

## Archivo 3 de 5 — credit_notes

**Path:** `supabase/migrations/20260505000005_finanzas_b3c_credit_notes.sql`
**Líneas aprox:** 188
**Crea:** tablas `credit_notes` + `credit_note_lines` (con `invoice_line_id` opcional para trazabilidad)

### Pasos

1. Pestaña **nueva**. Pegá el archivo. Run.

### Cómo confirmar éxito

- Verificaciones embebidas:
  - **Tabla 1 (RLS):** 2 filas, `rls_enabled=true`
  - **Tabla 2 (counts):** ambas en 0
  - **Tabla 3 (CHECKs):** 8 filas (`credit_notes_*_check` × 4 + `credit_note_lines_*_check` × 4)

### Verificaciones extra (copy-paste)

```sql
-- 1. status check fija valor único 'emitida'
SELECT pg_get_constraintdef(oid) AS def
FROM   pg_constraint
WHERE  conrelid = 'credit_notes'::regclass
  AND  conname = 'credit_notes_status_check';
-- Esperado: CHECK ((status = 'emitida'::text))
```

```sql
-- 2. credit_note_lines.invoice_line_id es FK NULLABLE con ON DELETE SET NULL
SELECT pg_get_constraintdef(oid) AS def
FROM   pg_constraint
WHERE  conrelid = 'credit_note_lines'::regclass
  AND  contype = 'f'
  AND  pg_get_constraintdef(oid) LIKE '%invoice_lines%';
-- Esperado: FOREIGN KEY (invoice_line_id) REFERENCES invoice_lines(id) ON DELETE SET NULL
```

```sql
-- 3. credit_notes.invoice_id es NOT NULL (siempre referida a una factura)
SELECT column_name, is_nullable
FROM   information_schema.columns
WHERE  table_name = 'credit_notes'
  AND  column_name = 'invoice_id';
-- Esperado: 1 fila, is_nullable='NO'
```

### Si falla

- `relation "invoices" does not exist` o `relation "invoice_lines" does not exist` → archivo 2 no aplicado.
- Resto: idem archivos previos.

### Checklist

- [ ] Ejecutado sin error
- [ ] Verificaciones embebidas OK
- [ ] Verificaciones extra OK
- [ ] Listo para siguiente archivo

---

## Archivo 4 de 5 — payments

**Path:** `supabase/migrations/20260505000006_finanzas_b3d_payments.sql`
**Líneas aprox:** 195
**Crea:** tablas `payments` + `payment_applications` (N:M aplicación pago↔factura)

### Pasos

1. Pestaña **nueva**. Pegá. Run.

### Cómo confirmar éxito

- Verificaciones embebidas:
  - **Tabla 1 (RLS):** 2 filas, `rls_enabled=true`
  - **Tabla 2 (counts):** ambas en 0
  - **Tabla 3 (UNIQUE):** 1 fila — `payment_applications_payment_invoice_unique UNIQUE (payment_id, invoice_id)`

### Verificaciones extra (copy-paste)

```sql
-- 1. method CHECK con los 6 valores admitidos
SELECT pg_get_constraintdef(oid) AS def
FROM   pg_constraint
WHERE  conrelid = 'payments'::regclass
  AND  conname = 'payments_method_check';
-- Esperado: CHECK con efectivo, transferencia, cheque, tarjeta, ach, otro
```

```sql
-- 2. amount_unapplied tiene CHECK de rango
SELECT pg_get_constraintdef(oid) AS def
FROM   pg_constraint
WHERE  conrelid = 'payments'::regclass
  AND  conname = 'payments_amount_unapplied_range_check';
-- Esperado: CHECK ((amount_unapplied >= 0 AND amount_unapplied <= amount))
```

```sql
-- 3. FK payment_applications.payment_id → payments con ON DELETE CASCADE
SELECT pg_get_constraintdef(oid) AS def
FROM   pg_constraint
WHERE  conrelid = 'payment_applications'::regclass
  AND  contype = 'f'
  AND  pg_get_constraintdef(oid) LIKE '%REFERENCES payments%';
-- Esperado: FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE
```

### Si falla

- `relation "invoices" does not exist` → archivo 2 no aplicado.
- Resto: idem.

### Checklist

- [ ] Ejecutado sin error
- [ ] Verificaciones embebidas OK
- [ ] Verificaciones extra OK
- [ ] Listo para el archivo final

---

## Archivo 5 de 5 — triggers

**Path:** `supabase/migrations/20260505000007_finanzas_b3e_triggers.sql`
**Líneas aprox:** 929
**Crea:** 19 funciones + 19 triggers (status transitions, immutability, no_delete, recálculo de totales y de amount_paid/amount_unapplied)

> Este archivo es el más grande. Después de Run, esperá unos segundos extra; las definiciones de funciones tardan más en compilar.

### Pasos

1. Pestaña **nueva**. Pegá. Run.

### Cómo confirmar éxito

- Verificaciones embebidas:
  - **Tabla 1 (funciones):** 19 filas con prefijo `finanzas_*`
  - **Tabla 2 (triggers):** ~27 filas (19 nuevos + 8 `*_updated_at` previos)

### Verificaciones extra (copy-paste)

```sql
-- 1. Conteo exacto de funciones finanzas
SELECT count(*) AS funciones_finanzas
FROM   pg_proc
WHERE  proname LIKE 'finanzas_%';
-- Esperado: 19
```

```sql
-- 2. Listado de triggers en las 8 tablas de Batch 3 (incluye updated_at)
SELECT event_object_table AS tabla, trigger_name, action_timing AS timing, event_manipulation AS evento
FROM   information_schema.triggers
WHERE  trigger_schema = 'public'
  AND  event_object_table IN
       ('quotes','quote_lines','invoices','invoice_lines',
        'credit_notes','credit_note_lines','payments','payment_applications')
ORDER  BY tabla, trigger_name, evento;
-- Esperado: 35 filas aprox (algunos triggers fire en 3 eventos: INSERT, UPDATE, DELETE)
```

```sql
-- 3. Whitelist de transiciones invoice incluye reversiones
-- (smoke test: la función debe ejecutar sin error con valores válidos)
SELECT proname, prosrc IS NOT NULL AS body_ok
FROM   pg_proc
WHERE  proname = 'finanzas_validate_status_transition';
-- Esperado: 1 fila, body_ok=true
```

### Si falla

- `relation "X" does not exist` → algún archivo previo no aplicado. Volvé y verificá.
- Cualquier error referente a `payment_applications`, `invoices`, etc. → revisar que los archivos 1–4 hayan sido aplicados completamente.
- Como siempre, `BEGIN/COMMIT` revierte el archivo entero ante cualquier error.

### Checklist

- [ ] Ejecutado sin error
- [ ] 19 funciones detectadas
- [ ] Verificaciones extra OK
- [ ] Listo para verificación global

---

## Verificación global post-ejecución

Ejecutar estas queries en una **pestaña nueva** después de aplicar los 5 archivos. Sirven como check de integridad final.

```sql
-- A. Las 8 tablas existen, RLS activo, todas vacías
SELECT c.relname AS tabla,
       c.relrowsecurity AS rls,
       (SELECT count(*) FROM information_schema.tables t
        WHERE t.table_schema='public' AND t.table_name=c.relname) AS exists_check
FROM   pg_class c
WHERE  c.relnamespace = 'public'::regnamespace
  AND  c.relname IN
       ('quotes','quote_lines','invoices','invoice_lines',
        'credit_notes','credit_note_lines','payments','payment_applications')
ORDER  BY c.relname;
-- Esperado: 8 filas, rls=true, exists_check=1 en todas
```

```sql
-- B. Row counts (todas en 0 porque no hay seeds en Batch 3)
SELECT 'quotes'               AS tabla, count(*) FROM quotes
UNION ALL SELECT 'quote_lines',         count(*) FROM quote_lines
UNION ALL SELECT 'invoices',            count(*) FROM invoices
UNION ALL SELECT 'invoice_lines',       count(*) FROM invoice_lines
UNION ALL SELECT 'credit_notes',        count(*) FROM credit_notes
UNION ALL SELECT 'credit_note_lines',   count(*) FROM credit_note_lines
UNION ALL SELECT 'payments',            count(*) FROM payments
UNION ALL SELECT 'payment_applications',count(*) FROM payment_applications;
-- Esperado: 8 filas, count=0 en todas
```

```sql
-- C. Conteo de funciones finanzas
SELECT count(*) AS funciones FROM pg_proc WHERE proname LIKE 'finanzas_%';
-- Esperado: 19
```

```sql
-- D. Conteo de triggers en las 8 tablas (incluye 8 updated_at + 19 lógicos)
SELECT count(DISTINCT trigger_name || '|' || event_object_table) AS triggers
FROM   information_schema.triggers
WHERE  trigger_schema = 'public'
  AND  event_object_table IN
       ('quotes','quote_lines','invoices','invoice_lines',
        'credit_notes','credit_note_lines','payments','payment_applications');
-- Esperado: 27 (19 lógicos de b3e + 8 updated_at de b3a-d)
```

```sql
-- E. Conteo de CHECK constraints en las 8 tablas
SELECT conrelid::regclass AS tabla, count(*) AS checks
FROM   pg_constraint
WHERE  contype = 'c'
  AND  conrelid IN
       ('quotes'::regclass,'quote_lines'::regclass,
        'invoices'::regclass,'invoice_lines'::regclass,
        'credit_notes'::regclass,'credit_note_lines'::regclass,
        'payments'::regclass,'payment_applications'::regclass)
GROUP  BY conrelid
ORDER  BY tabla;
-- Esperado: 8 filas. Distribución aprox:
--   quotes:               4   credit_notes:         4
--   quote_lines:          4   credit_note_lines:    4
--   invoices:             7   payments:             5
--   invoice_lines:        4   payment_applications: 1
-- Total ~33
```

> Si las 5 verificaciones (A-E) dan los resultados esperados, **el schema de Batch 3 está sano**.

**Cuando todo OK, avisame con `Batch 3 ejecutado OK` y vamos al merge a main + push.**

---

## Troubleshooting

| Síntoma | Causa probable | Acción |
|---------|----------------|--------|
| `relation "X" already exists` | Ya ejecutaste ese archivo | Saltá al siguiente, verificá con queries extra |
| `function public.get_tenant_id() does not exist` | Batch 1 no aplicado | **Frená.** Aplicar Batch 1 primero |
| `relation "tenants" does not exist` | Schema base no presente | Cuenta Supabase equivocada |
| `relation "clients" does not exist` | Migrations iniciales no aplicadas | Cuenta Supabase equivocada |
| `relation "tax_codes" does not exist` | Batch 2 no aplicado | Aplicar Batch 2 primero |
| `permission denied` | Cuenta Supabase incorrecta | Cambiar de cuenta y reintentar |
| `syntax error at or near …` | Posible problema de copia/pegado | Reportame el texto literal, no toques nada |
| Timeout del SQL Editor (>30s) | Archivo grande compilando funciones | El `BEGIN/COMMIT` revierte todo. Reintentá la pestaña nueva |
| Error en mitad del archivo | Cualquier causa | El `BEGIN/COMMIT` revierte la transacción. Estado limpio para reintentar |
| Verificación A (tablas) muestra <8 filas | Algún archivo no aplicado | Revisar checklist y reaplicar |
| Verificación C muestra <19 funciones | Archivo 5 no aplicado completo | Reaplicar archivo 5 |
| Verificación D muestra <27 triggers | Algún archivo previo o el 5 falló | Comparar contra resultados de cada archivo individual |

> **Regla general:** ante cualquier mensaje de error que no esté en esta tabla, copiame el texto literal y el archivo donde apareció antes de tocar nada. Como cada archivo es transaccional, no hay urgencia: el estado es siempre o "antes" o "después" del archivo, nunca "a medias".
