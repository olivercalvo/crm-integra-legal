-- ============================================================================
-- 038 — EL GASTO DE TRÁMITE LLEGA AL LIBRO. `source_type` + inmutabilidad.
-- ============================================================================
-- Con esto queda cerrado el camino documento → asiento para el primer tipo de
-- documento del sistema. Hasta hoy **ninguna ruta de `/api` posteaba al ledger**:
-- `postJournalEntry()` solo se llamaba desde su propia definición y desde
-- `scripts/backfill-asientos-faltantes.mts`, y los asientos de staging los puso
-- `scripts/seed-asientos.ts`.
--
-- Trae dos cosas:
--   A. `'gasto_tramite'` en el CHECK de `journal_entries.source_type`.
--   B. Los triggers de inmutabilidad sobre `expenses` y `expense_lines`.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- A) ⚠️ EL CHECK ES ANÓNIMO Y HAY DOS QUE MENCIONAN `source_type`
-- ─────────────────────────────────────────────────────────────────────────────
-- Es la lección de la `029`, y cuesta repetirla porque ya salió mal una vez. La
-- primera versión de la `028` buscaba el CHECK así:
--
--     AND pg_get_constraintdef(con.oid) ILIKE '%source_type%'
--
-- y dropeó DOS: el enum de valores y `je_reversion_requires_ref`, que es la regla
-- que hace cumplir el Art. 5.7 del DE 34/1998 (una reversión tiene que apuntar al
-- asiento que corrige y traer un motivo). Sin ese CHECK se podía escribir una
-- reversión huérfana y sin explicación, y como los asientos son inmutables,
-- quedaba así para siempre. Se detectó leyendo los NOTICE: la migración avisó que
-- había eliminado dos constraints donde debía eliminar una.
--
-- 🔴 **Se filtra por CONTENIDO, no solo por columna.** Solo el CHECK del enum
-- lista los valores, así que `'%factura%'` lo distingue sin ambigüedad. Y el paso
-- de verificación cuenta que `je_reversion_requires_ref` siga en pie.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- B) POR QUÉ UN TRIGGER Y NO SOLO EL GATE DE LA RUTA
-- ─────────────────────────────────────────────────────────────────────────────
-- La ruta `PATCH /api/expenses/[id]` va a rechazar con 409 un gasto ya asentado,
-- con un mensaje que nombra el asiento. Eso es lo que hace que la persona entienda
-- qué pasó — pero **no es la garantía.**
--
-- Toda la escritura de este módulo va con el cliente de servicio, que **saltea
-- RLS**. Un script, el SQL Editor, o una segunda ruta que alguien escriba en seis
-- meses sin conocer la regla, editan igual. Y editar un gasto ya asentado deja el
-- asiento diciendo una cosa y el documento otra, **en silencio y para siempre**:
-- los asientos son inmutables por diseño, así que el libro no se puede corregir
-- para que vuelva a coincidir.
--
-- Es la misma doctrina que ya aplicó este repo dos veces:
--   · `034`: "el UNIQUE es la única garantía que no depende del timing".
--   · CLAUDE.md: "ocultar el botón NO reemplaza al 403, y el 403 no reemplaza a
--     ocultar el botón. Los dos hacen falta."
--
-- ⚠️ **Qué SÍ se puede seguir haciendo con un gasto asentado**, y es deliberado:
--   ✅ Adjuntar o reemplazar el COMPROBANTE (`receipt_url`, `receipt_filename`).
--      Escanear el recibo tarde es normal y no toca los libros. Aprobado
--      explícitamente por Oliver el 03/09.
--   ✅ Escribir `posted_entry_id`, que es justamente lo que hace el posteo.
--   ❌ Todo lo demás: monto, fecha, concepto, proveedor, vencimiento, cuenta de
--      pago, y cualquier cambio a sus líneas.
--
-- Corregir un gasto asentado va por REVERSIÓN, que es su propio bloque.
--
-- IDEMPOTENCIA:
--   CREATE OR REPLACE en la función, DROP TRIGGER IF EXISTS antes de crear, y el
--   CHECK se dropea antes de agregarse. Re-ejecutable.
--
-- APLICACIÓN:
--   Staging: `node scripts/run-sql.mjs sql/pending/038_gasto_tramite_al_ledger.sql`
--   🔴 Producción: NO desde una máquina. Solo por merge a `main`, después de 036 y 037.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0) GUARD DE ORDEN
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'expenses'
       AND column_name = 'posted_entry_id'
  ) THEN
    RAISE EXCEPTION 'Falta `expenses.posted_entry_id`. Corré primero la 036.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- A) `gasto_tramite` en el CHECK de source_type
-- ---------------------------------------------------------------------------
-- Es un valor NUEVO y no se reusa `'gasto'`, que ya está tomado por
-- `business_expenses`: lo usa el fixture sembrado y, sobre todo, lo usa
-- `destino-documento.ts` para decidir a qué pantalla lleva el ícono del Libro
-- Mayor (`gasto → /finanzas/gastos-bufete/{id}`). Compartirlo mandaría un gasto
-- de trámite a la pantalla de compras con un id que ahí no existe.
--
-- Ventaja extra: CERO BACKFILL. `'gasto'` sigue significando lo mismo que hoy.
DO $$
DECLARE
  v_nombre text;
  v_dropeados int := 0;
BEGIN
  FOR v_nombre IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class     rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
     WHERE nsp.nspname = 'public'
       AND rel.relname = 'journal_entries'
       AND con.contype = 'c'
       -- 🔴 LAS DOS CONDICIONES. La segunda es la que evita repetir el bug de
       --    la 028: solo el CHECK del enum lista los valores.
       AND pg_get_constraintdef(con.oid) ILIKE '%source_type%'
       AND pg_get_constraintdef(con.oid) ILIKE '%factura%'
  LOOP
    EXECUTE format('ALTER TABLE public.journal_entries DROP CONSTRAINT %I', v_nombre);
    v_dropeados := v_dropeados + 1;
    RAISE NOTICE 'CHECK viejo de source_type eliminado: %', v_nombre;
  END LOOP;

  IF v_dropeados > 1 THEN
    RAISE EXCEPTION
      'Se dropearon % constraints y se esperaba 1. Es el bug de la 028: revisá el filtro antes de seguir.',
      v_dropeados;
  END IF;
END $$;

ALTER TABLE public.journal_entries
  ADD CONSTRAINT journal_entries_source_type_check
  CHECK (source_type IN (
    'factura', 'gasto', 'gasto_tramite', 'pago', 'nota_credito',
    'manual', 'reversion', 'apertura'
  ));

-- ---------------------------------------------------------------------------
-- B) INMUTABILIDAD DE UN GASTO YA ASENTADO
-- ---------------------------------------------------------------------------

/**
 * ¿Este gasto de trámite ya tiene asiento?
 *
 * Se consulta `journal_entries` y NO `expenses.posted_entry_id`: esa columna es
 * un cache para no pegarle a la tabla del ledger en cada render, y un cache puede
 * quedar desactualizado. La verdad está en el libro.
 */
CREATE OR REPLACE FUNCTION public.gasto_tramite_tiene_asiento(p_expense_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
AS $$
  SELECT entry_number
    FROM public.journal_entries
   WHERE source_type = 'gasto_tramite'
     AND source_id   = p_expense_id
   LIMIT 1;
$$;

/**
 * Rechaza cambios sobre un gasto ya asentado.
 *
 * Deja pasar SOLO lo que no toca los libros: el comprobante y el propio
 * `posted_entry_id`. La lista es blanca y explícita — con una lista negra, cada
 * columna nueva de `expenses` nacería editable sin que nadie lo decida.
 */
CREATE OR REPLACE FUNCTION public.reject_expense_mutation_si_asentado()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_asiento bigint;
BEGIN
  v_asiento := public.gasto_tramite_tiene_asiento(OLD.id);
  IF v_asiento IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'El gasto % ya está registrado en el libro contable (asiento %) y no se puede borrar. Para corregirlo hace falta un asiento de reversión.',
      OLD.id, v_asiento
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- Lista BLANCA de lo editable con el gasto ya asentado.
  IF ROW(
       NEW.case_id, NEW.amount, NEW.concept, NEW.date, NEW.expense_type,
       NEW.supplier_id, NEW.due_date, NEW.payment_account_code, NEW.tenant_id
     ) IS DISTINCT FROM ROW(
       OLD.case_id, OLD.amount, OLD.concept, OLD.date, OLD.expense_type,
       OLD.supplier_id, OLD.due_date, OLD.payment_account_code, OLD.tenant_id
     )
  THEN
    RAISE EXCEPTION
      'El gasto % ya está registrado en el libro contable (asiento %) y no se puede modificar. Solo se admite adjuntar o reemplazar el comprobante. Para corregirlo hace falta un asiento de reversión.',
      OLD.id, v_asiento
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_expenses_no_edit_si_asentado ON public.expenses;
CREATE TRIGGER trg_expenses_no_edit_si_asentado
  BEFORE UPDATE OR DELETE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.reject_expense_mutation_si_asentado();

/**
 * Lo mismo para las líneas: si el gasto ya está asentado, sus líneas no se tocan.
 *
 * Cubre INSERT también, y no es un detalle: agregar una línea a un gasto asentado
 * es tan grave como cambiarle el monto — el documento pasaría a decir una cosa y
 * el asiento otra, y el asiento no se puede corregir.
 */
CREATE OR REPLACE FUNCTION public.reject_expense_line_mutation_si_asentado()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_expense uuid;
  v_asiento bigint;
BEGIN
  v_expense := COALESCE(
    CASE WHEN TG_OP = 'DELETE' THEN OLD.expense_id ELSE NEW.expense_id END,
    CASE WHEN TG_OP = 'DELETE' THEN OLD.expense_id ELSE NEW.expense_id END
  );

  -- Las líneas de una COMPRA (`business_expense_id`) no las cubre este trigger:
  -- ese módulo tendrá el suyo cuando llegue su posteo.
  IF v_expense IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  v_asiento := public.gasto_tramite_tiene_asiento(v_expense);
  IF v_asiento IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  RAISE EXCEPTION
    'El gasto % ya está registrado en el libro contable (asiento %): sus líneas no se pueden agregar, modificar ni borrar. Para corregirlo hace falta un asiento de reversión.',
    v_expense, v_asiento
    USING ERRCODE = 'restrict_violation';
END $$;

DROP TRIGGER IF EXISTS trg_expense_lines_no_edit_si_asentado ON public.expense_lines;
CREATE TRIGGER trg_expense_lines_no_edit_si_asentado
  BEFORE INSERT OR UPDATE OR DELETE ON public.expense_lines
  FOR EACH ROW EXECUTE FUNCTION public.reject_expense_line_mutation_si_asentado();

-- ⚠️ El CASCADE de `expenses` → `expense_lines` dispara este trigger. Está bien:
-- borrar un gasto asentado ya lo rechaza el trigger de `expenses` antes, así que
-- el CASCADE nunca llega a correr sobre uno asentado.

-- ---------------------------------------------------------------------------
-- C) VERIFICACIÓN
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_enum      int;
  v_reversion int;
  v_triggers  int;
BEGIN
  SELECT COUNT(*) INTO v_enum
    FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
   WHERE rel.relname = 'journal_entries' AND con.contype = 'c'
     AND pg_get_constraintdef(con.oid) ILIKE '%gasto_tramite%';

  -- 🔑 La comprobación que la 028 no tenía y le habría ahorrado la 029.
  SELECT COUNT(*) INTO v_reversion
    FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
   WHERE rel.relname = 'journal_entries' AND con.conname = 'je_reversion_requires_ref';

  SELECT COUNT(*) INTO v_triggers
    FROM pg_trigger
   WHERE tgname IN ('trg_expenses_no_edit_si_asentado', 'trg_expense_lines_no_edit_si_asentado');

  RAISE NOTICE 'CHECK acepta gasto_tramite ..... % (esperado 1)', v_enum;
  RAISE NOTICE 'je_reversion_requires_ref ...... % (esperado 1)', v_reversion;
  RAISE NOTICE 'triggers de inmutabilidad ...... % (esperado 2)', v_triggers;

  IF v_enum <> 1 THEN
    RAISE EXCEPTION 'ABORT: el CHECK de source_type no acepta gasto_tramite';
  END IF;
  IF v_reversion <> 1 THEN
    RAISE EXCEPTION
      'ABORT: je_reversion_requires_ref desapareció. Es EXACTAMENTE el bug de la 028 (ver 029): el filtro dropeó de más.';
  END IF;
  IF v_triggers <> 2 THEN
    RAISE EXCEPTION 'ABORT: faltan triggers de inmutabilidad (% de 2)', v_triggers;
  END IF;

  RAISE NOTICE 'OK — 038 aplicada.';
END $$;

COMMIT;


-- ============================================================================
-- ROLLBACK
-- ============================================================================
-- BEGIN;
-- DROP TRIGGER IF EXISTS trg_expense_lines_no_edit_si_asentado ON public.expense_lines;
-- DROP TRIGGER IF EXISTS trg_expenses_no_edit_si_asentado ON public.expenses;
-- DROP FUNCTION IF EXISTS public.reject_expense_line_mutation_si_asentado();
-- DROP FUNCTION IF EXISTS public.reject_expense_mutation_si_asentado();
-- DROP FUNCTION IF EXISTS public.gasto_tramite_tiene_asiento(uuid);
-- -- El CHECK se deja: quitar 'gasto_tramite' rompería los asientos ya posteados.
-- COMMIT;
-- ============================================================================
