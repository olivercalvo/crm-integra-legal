-- ============================================================================
-- 034 — UN DOCUMENTO, UN ASIENTO. UNIQUE parcial sobre el origen.
-- ============================================================================
-- Un asiento duplicado en un libro inmutable NO SE BORRA: los triggers de la
-- migración `023` rechazan DELETE y UPDATE sobre `journal_entries`. Si el
-- cableado de factura→asiento postea dos veces —un doble clic, un retry, dos
-- requests concurrentes— el libro queda con el movimiento repetido y la única
-- salida es un asiento de reversión, que un contador tiene que justificar ante
-- la DGI.
--
-- Hoy NADA lo impide: `idx_je_tenant_source` sobre (tenant_id, source_type,
-- source_id) es un índice COMÚN, no UNIQUE. Se creó para buscar, no para
-- restringir.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUÉ EN LA BASE Y NO EN EL CÓDIGO
-- ─────────────────────────────────────────────────────────────────────────────
-- Un chequeo previo en la ruta ("¿ya existe un asiento para esta factura?") deja
-- una ventana entre el SELECT y el INSERT. Dos requests que entran a la vez
-- pasan los dos. El UNIQUE es la única garantía que no depende del timing.
--
-- El chequeo en la ruta se agrega igual, pero para dar un mensaje entendible en
-- vez de un error de constraint — no como la garantía.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUÉ PARCIAL (`WHERE source_id IS NOT NULL`)
-- ─────────────────────────────────────────────────────────────────────────────
-- Los asientos manuales y el futuro asiento de apertura NO tienen documento de
-- origen: su `source_id` es NULL. Un UNIQUE total los dejaría convivir igual
-- —en Postgres los NULL no colisionan entre sí— pero el índice parcial lo dice
-- explícito y además es más chico.
--
-- En staging al 02/09/2026: 10 asientos, 9 con `source_id` y 9 combinaciones
-- únicas. El manual es el único sin documento.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 🔴 ANTES DE APLICAR EN PRODUCCIÓN
-- ─────────────────────────────────────────────────────────────────────────────
-- Correr el chequeo del paso 1. **Si devuelve una sola fila, NO APLICAR**: el
-- índice fallaría a mitad y habría que decidir a mano cuál de los asientos
-- duplicados sobrevive — y borrar uno no se puede, porque el trigger lo rechaza.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1) CHEQUEO PREVIO — correr SIEMPRE antes del paso 2.
--    Cero filas = se puede aplicar.
-- ---------------------------------------------------------------------------
SELECT tenant_id, source_type, source_id, COUNT(*) AS asientos,
       string_agg(entry_number::text, ', ' ORDER BY entry_number) AS numeros
  FROM public.journal_entries
 WHERE source_id IS NOT NULL
 GROUP BY tenant_id, source_type, source_id
HAVING COUNT(*) > 1;


-- ---------------------------------------------------------------------------
-- 2) EL ÍNDICE
-- ---------------------------------------------------------------------------
-- ⚠️ SIN `CONCURRENTLY`: toma un lock de escritura sobre `journal_entries`
-- mientras construye el índice. Con las decenas de filas de hoy es
-- instantáneo. Ver el paso 3 si la tabla creció.
CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_un_asiento_por_documento
  ON public.journal_entries (tenant_id, source_type, source_id)
  WHERE source_id IS NOT NULL;

COMMENT ON INDEX public.journal_entries_un_asiento_por_documento IS
  'Un documento tiene UN asiento. Impide postear dos veces la misma factura, pago, gasto o nota de crédito. Los asientos sin documento (manual, apertura) quedan fuera por el WHERE.';


-- ---------------------------------------------------------------------------
-- 3) SI LA TABLA YA ES GRANDE — versión que no bloquea
-- ---------------------------------------------------------------------------
-- `CREATE INDEX CONCURRENTLY` construye el índice sin bloquear escrituras, pero
-- **NO puede correr dentro de un bloque de transacción**. Si se usa esta
-- versión: correrla SOLA, sin BEGIN/COMMIT alrededor, y sin nada más en el mismo
-- lote del SQL Editor.
--
-- Y tiene una trampa propia: si falla a mitad deja un índice INVÁLIDO que sigue
-- ocupando lugar y no restringe nada. Por eso el chequeo de validez de abajo no
-- es opcional.
--
-- CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS journal_entries_un_asiento_por_documento
--   ON public.journal_entries (tenant_id, source_type, source_id)
--   WHERE source_id IS NOT NULL;


-- ---------------------------------------------------------------------------
-- 4) VERIFICACIÓN DESPUÉS — el índice existe, es UNIQUE y es VÁLIDO
-- ---------------------------------------------------------------------------
SELECT i.relname                AS indice,
       ix.indisunique           AS es_unique,
       ix.indisvalid            AS es_valido,
       pg_get_indexdef(ix.indexrelid) AS definicion
  FROM pg_index ix
  JOIN pg_class i ON i.oid = ix.indexrelid
 WHERE i.relname = 'journal_entries_un_asiento_por_documento';


-- ============================================================================
-- ROLLBACK — no destruye datos: el índice solo restringe.
-- ============================================================================
-- DROP INDEX IF EXISTS public.journal_entries_un_asiento_por_documento;
-- (si se creó con CONCURRENTLY, borrarlo también:
--  DROP INDEX CONCURRENTLY IF EXISTS public.journal_entries_un_asiento_por_documento;)
