-- ============================================================================
-- 037 — LA CUENTA DE UNA LÍNEA NUEVA ES OBLIGATORIA, Y LO GARANTIZA LA BASE
-- ============================================================================
-- Cierra un hueco que quedó abierto en la `036`: `chart_account_code` es
-- NULLABLE —a propósito, para que las 128 líneas del backfill histórico digan la
-- verdad (nadie las clasificó nunca)— y por eso la única defensa contra una
-- línea NUEVA sin cuenta era `validators/expense-line.ts`.
--
-- Un validador de aplicación no es un guard de base. Un `curl` a la ruta, un
-- script, el SQL Editor o una segunda ruta que alguien escriba en seis meses lo
-- saltean. Es exactamente la doctrina que este repo ya aplicó dos veces:
--
--   · `034`: "un chequeo previo en la ruta deja una ventana... el UNIQUE es la
--     única garantía que no depende del timing".
--   · CLAUDE.md: "ocultar el botón NO reemplaza al 403, y el 403 no reemplaza a
--     ocultar el botón. Los dos hacen falta."
--
-- Acá pasa lo mismo un nivel más abajo: **el validador y el CHECK hacen falta los
-- dos.** El validador da el mensaje en español al lado del campo; el CHECK es el
-- permiso.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 🔬 EL EXPERIMENTO QUE JUSTIFICA EL `NOT VALID` — corrido en staging, 03/09
-- ─────────────────────────────────────────────────────────────────────────────
-- `NOT VALID` se suele explicar como "no valida las filas existentes", y de ahí
-- es fácil concluir que las filas viejas quedan exentas. **NO ES ASÍ, y la
-- diferencia importa.** Medido, no supuesto
-- (`sql/tests/experimento-check-not-valid.sql`):
--
--   [1] ADD CONSTRAINT sobre una tabla con 20 filas en NULL ......... OK
--   [2] INSERT nuevo SIN cuenta .................................... RECHAZADO ✅
--   [3] INSERT nuevo CON cuenta .................................... ACEPTADO  ✅
--   [4] UPDATE de la DESCRIPCIÓN de una fila vieja en NULL .......... RECHAZADO ⚠️
--   [5] UPDATE que ASIGNA la cuenta a una fila vieja ................ ACEPTADO  ✅
--   [6] VALIDATE CONSTRAINT con NULLs presentes .................... RECHAZADO ✅
--
-- O sea: `NOT VALID` salta el scan inicial, pero **el CHECK se hace cumplir en
-- todo UPDATE**, incluso sobre una fila vieja y aunque el UPDATE no toque la
-- columna del CHECK. Postgres evalúa la fila NUEVA completa.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- EL COSTO, MEDIDO Y ACEPTADO
-- ─────────────────────────────────────────────────────────────────────────────
-- Lo ÚNICO que queda prohibido es: **modificar una línea histórica sin
-- clasificarla en el mismo UPDATE.** Todo lo demás sigue funcionando:
--
--   ✅ Clasificarla (paso 5) — es el camino de salida, y el que hace la limpieza.
--   ✅ La asignación masiva, que escribe la cuenta y por lo tanto satisface el CHECK.
--   ✅ Borrarla. Un DELETE no evalúa CHECKs.
--   ✅ El CASCADE al borrar el gasto.
--   ❌ Corregirle la descripción dejándola sin clasificar.
--
-- Se acepta por tres motivos:
--   1. Hoy **no existe ninguna pantalla que edite una línea de gasto**, así que
--      no rompe ningún flujo vivo.
--   2. Si alguien está editando una línea histórica, ya está adentro: pedirle la
--      cuenta en ese momento es razonable, no un obstáculo.
--   3. Empuja la limpieza en vez de dejarla para siempre, que es el destino
--      normal de este tipo de deuda.
--
-- ⚠️ Y hay que saberlo antes de escribir cualquier UPDATE masivo sobre
-- `expense_lines`: si toca filas históricas y no les asigna cuenta, falla.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 🔴 POR QUÉ VA ACÁ Y NO EN LA `036`
-- ─────────────────────────────────────────────────────────────────────────────
-- El backfill de la `036` INSERTA con `chart_account_code = NULL`. Con este CHECK
-- puesto, ese INSERT fallaría y la migración entera abortaría. **El orden es
-- obligatorio: 036 primero, 037 después.**
--
-- (Re-ejecutar la `036` con este CHECK ya aplicado es seguro: su
-- `WHERE NOT EXISTS` no inserta ninguna fila. Solo fallaría si apareciera un
-- gasto sin línea, y en ese caso fallar es lo correcto.)
--
-- ─────────────────────────────────────────────────────────────────────────────
-- CÓMO SE TERMINA: `VALIDATE CONSTRAINT`
-- ─────────────────────────────────────────────────────────────────────────────
-- Cuando las 128 estén clasificadas —desde `/legal/gastos`, vista "Gastos",
-- filtro "Sin clasificar"— el constraint se completa con:
--
--     ALTER TABLE public.expense_lines VALIDATE CONSTRAINT expense_lines_cuenta_obligatoria;
--
-- Mientras quede una sola en NULL eso falla (paso 6 del experimento), así que el
-- comando mismo es el semáforo: **el día que corre limpio, la limpieza terminó.**
-- No hace falta llevar la cuenta a mano.
--
-- Toma un ACCESS EXCLUSIVE breve para escanear la tabla. Con 128 filas es
-- instantáneo; no hay que planificar ventana.
--
-- IDEMPOTENCIA:
--   El constraint se dropea antes de crearse. Re-ejecutable.
--
-- APLICACIÓN:
--   Staging: `node scripts/run-sql.mjs sql/pending/037_expense_lines_cuenta_obligatoria.sql`
--   🔴 Producción: NO desde una máquina. Solo por merge a `main`, DESPUÉS de la 036.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) GUARD DE ORDEN — la 036 tiene que haber corrido
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'expense_lines'
  ) THEN
    RAISE EXCEPTION
      'No existe `expense_lines`. Corré primero sql/pending/036_expense_lines.sql: este CHECK haría fallar su backfill si se aplicara antes.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) EL CHECK
-- ---------------------------------------------------------------------------
ALTER TABLE public.expense_lines
  DROP CONSTRAINT IF EXISTS expense_lines_cuenta_obligatoria;

ALTER TABLE public.expense_lines
  ADD CONSTRAINT expense_lines_cuenta_obligatoria
  CHECK (chart_account_code IS NOT NULL) NOT VALID;

COMMENT ON CONSTRAINT expense_lines_cuenta_obligatoria ON public.expense_lines IS
  'NOT VALID a propósito: las líneas del backfill histórico quedan en NULL porque nadie las clasificó nunca. Se hace cumplir en todo INSERT y en todo UPDATE (incluso de filas viejas y aunque el UPDATE no toque esta columna). Completar con VALIDATE CONSTRAINT cuando no queden NULLs. Ver 037.';

-- ---------------------------------------------------------------------------
-- 3) ESTADO — cuánto falta para poder validar
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_null  bigint;
  v_total bigint;
BEGIN
  SELECT COUNT(*) FILTER (WHERE chart_account_code IS NULL), COUNT(*)
    INTO v_null, v_total
    FROM public.expense_lines;

  RAISE NOTICE 'CHECK `expense_lines_cuenta_obligatoria` agregado como NOT VALID.';
  RAISE NOTICE '  líneas totales ......... %', v_total;
  RAISE NOTICE '  sin clasificar ......... %', v_null;

  IF v_null = 0 THEN
    RAISE NOTICE '';
    RAISE NOTICE '  No queda ninguna sin clasificar. Se puede completar el constraint:';
    RAISE NOTICE '    ALTER TABLE public.expense_lines VALIDATE CONSTRAINT expense_lines_cuenta_obligatoria;';
  ELSE
    RAISE NOTICE '';
    RAISE NOTICE '  Faltan % por clasificar desde /legal/gastos → vista "Gastos"', v_null;
    RAISE NOTICE '  → filtro "Sin clasificar". Cuando lleguen a 0, correr:';
    RAISE NOTICE '    ALTER TABLE public.expense_lines VALIDATE CONSTRAINT expense_lines_cuenta_obligatoria;';
  END IF;
END $$;

COMMIT;


-- ============================================================================
-- ROLLBACK
-- ============================================================================
-- BEGIN;
-- ALTER TABLE public.expense_lines DROP CONSTRAINT IF EXISTS expense_lines_cuenta_obligatoria;
-- COMMIT;
-- ============================================================================
