-- ============================================================================
-- DIAGNÓSTICO (solo lectura): ¿qué versión de la fórmula del content_hash
-- reproduce cada asiento?  Propuesta del 01/10/2026, plan Bloque 1 §8.
--
--   node scripts/run-sql.mjs sql/verificacion/recalculo-content-hash.sql
--
-- Recalcula el content_hash de cada asiento DESDE LAS COLUMNAS con las cuatro
-- fórmulas (SOP-014) y dice cuál coincide con el guardado. Es el insumo para
-- el verificador que recalcula: si algún asiento no coincide con NINGUNA, o la
-- versión que coincide no es monótona en el correlativo, el verificador nuevo
-- no se puede escribir sin entender por qué primero.
--
-- 🛡️ BEGIN READ ONLY … ROLLBACK. No escribe nada.
-- ============================================================================
BEGIN READ ONLY;

WITH lineas AS (
  SELECT l.entry_id,
         string_agg(concat_ws(':', c.code, l.debit::text, l.credit::text, coalesce(l.line_description, '')),
                    '|' ORDER BY l.line_order) AS sin_tercero,
         string_agg(concat_ws(':', c.code, l.debit::text, l.credit::text, coalesce(l.line_description, ''),
                              coalesce(l.client_id::text, ''), coalesce(l.supplier_id::text, '')),
                    '|' ORDER BY l.line_order) AS con_tercero
    FROM journal_entry_lines l
    JOIN chart_of_accounts c ON c.id = l.account_id
   GROUP BY l.entry_id
),
calculo AS (
  SELECT e.tenant_id, e.entry_number, e.content_hash,
    encode(sha256(convert_to(concat_ws('|', e.tenant_id::text, e.entry_number::text, e.transaction_date::text,
      e.record_date::text, e.description, e.source_type, coalesce(e.source_id::text, ''), coalesce(e.source_cufe, ''),
      coalesce(e.reverses_entry_id::text, ''), coalesce(e.reversal_reason, ''),
      li.sin_tercero), 'UTF8')), 'hex') AS v1,
    encode(sha256(convert_to(concat_ws('|', e.tenant_id::text, e.entry_number::text, e.transaction_date::text,
      e.record_date::text, e.description, e.source_type, coalesce(e.source_id::text, ''), coalesce(e.source_cufe, ''),
      coalesce(e.reverses_entry_id::text, ''), coalesce(e.reversal_reason, ''), coalesce(e.reference, ''),
      li.sin_tercero), 'UTF8')), 'hex') AS v2,
    encode(sha256(convert_to(concat_ws('|', e.tenant_id::text, e.entry_number::text, e.transaction_date::text,
      e.record_date::text, e.description, e.source_type, coalesce(e.source_id::text, ''), coalesce(e.source_cufe, ''),
      coalesce(e.reverses_entry_id::text, ''), coalesce(e.reversal_reason, ''), coalesce(e.reference, ''),
      li.con_tercero), 'UTF8')), 'hex') AS v3,
    encode(sha256(convert_to(concat_ws('|', e.tenant_id::text, e.entry_number::text, e.transaction_date::text,
      e.record_date::text, e.description, e.source_type, coalesce(e.source_id::text, ''), coalesce(e.source_cufe, ''),
      coalesce(e.reverses_entry_id::text, ''), coalesce(e.reversal_reason, ''), coalesce(e.reference, ''),
      coalesce(e.referencia_externa, ''), li.con_tercero), 'UTF8')), 'hex') AS v4
    FROM journal_entries e
    JOIN lineas li ON li.entry_id = e.id
),
version AS (
  SELECT tenant_id, entry_number,
         CASE WHEN content_hash = v4 THEN 'v4'
              WHEN content_hash = v3 THEN 'v3'
              WHEN content_hash = v2 THEN 'v2'
              WHEN content_hash = v1 THEN 'v1'
              ELSE 'NINGUNA' END AS version
    FROM calculo
)
SELECT version, count(*) AS asientos, min(entry_number) AS desde, max(entry_number) AS hasta
  FROM version GROUP BY version ORDER BY min(entry_number);

-- Resultado en staging el 01/10/2026 (98 asientos): v1 = 1..11, v2 = 12..49,
-- v3 = 50..98, NINGUNA = 0. Todos se reproducen y las versiones son monótonas.

ROLLBACK;
