-- ============================================================================
-- 045 — LA LÍNEA DE COMPRA DICE QUÉ CÓDIGO DE IMPUESTO ELIGIÓ
-- ============================================================================
--
-- Josuarth, 25/08/2026: en una factura de compra cada línea va gravada o exenta
-- por separado, "igual que el formulario de facturación". El ejemplo fue la
-- factura del internet: partidas con 7% y partidas sin.
--
-- Eso, en sí, YA FUNCIONA: `expense_lines` nació en la `036` con `tax_rate` y
-- `tax_amount` por línea, el editor tiene el desplegable por línea desde el
-- 10/09 y el asiento suma el impuesto de cada línea. Lo que faltaba es el
-- VÍNCULO AL CATÁLOGO: la línea guardaba un decimal y no sabía CUÁL código lo
-- produjo. Tres consecuencias concretas, todas resueltas por esta columna:
--
--   1. El desplegable de compras no salía de `tax_codes`, salía de una lista
--      fija en el código. Si Rose cambia la tasa en Configuración → Impuestos
--      (lo pidió el 25/08), facturación la seguía y compras no.
--   2. `EXENTO` e `ITBMS_0` tienen los dos tasa 0. Con solo el decimal, una
--      compra no puede distinguir "exento" de "gravado al 0%".
--   3. El servidor no tenía contra qué verificar la tasa que mandaba el body.
--      Con el id, la lee del catálogo y la del body deja de importar.
--
-- Es el mismo modelo que `invoice_lines.tax_code_id` (FK real a `tax_codes`)
-- más el snapshot de `tax_rate` que ya existía: la tasa vigente al cargar queda
-- en la línea aunque el catálogo cambie después.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 🔴 EL BACKFILL TOCA SOLO LÍNEAS DE COMPRA, Y NO ES OPCIONAL
-- ─────────────────────────────────────────────────────────────────────────────
-- Un UPDATE sobre las líneas de TRÁMITE fallaría por dos guards ya aplicados:
--
--   · `expense_lines_cuenta_obligatoria` (037) es NOT VALID, y NOT VALID **se
--     hace cumplir en todo UPDATE** aunque no toque la columna (medido en
--     `sql/tests/experimento-check-not-valid.sql`). Las 20 líneas históricas sin
--     cuenta rechazarían el UPDATE.
--   · `trg_expense_lines_no_edit_si_asentado` (038) rechaza UPDATE en líneas de
--     gastos ya asentados.
--
-- Así que las líneas de trámite quedan en NULL. Para ellas el impuesto es
-- pass-through al cliente (no toca `200003`, ver `asiento-gasto-tramite.ts`), y
-- las nuevas lo reciben del editor, que es compartido. Si algún día se quiere
-- obligatorio en trámite, es otra migración, después de la limpieza de las 20.
--
-- Las líneas de compra NO tienen ninguno de los dos guards: el trigger de la 038
-- las excluye explícitamente y la 040 garantizó que todas tienen cuenta.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- LA REGLA DEL BACKFILL, decidida por Oliver el 16/09/2026
-- ─────────────────────────────────────────────────────────────────────────────
--   · tasa 0            → `EXENTO`. No es inventar el dato: la única opción de
--                         cero que el formulario ofreció desde el 10/09 se llama
--                         "Exento (0%)", e `ITBMS_0` no tiene un solo uso en el
--                         sistema (ni en facturas ni en el catálogo de servicios).
--   · tasa > 0          → el ÚNICO código activo del tenant con esa tasa
--                         (0,07 → `ITBMS_7`). Si hay cero o más de uno, ABORTA
--                         nombrando las líneas: adivinar sería peor que parar.
--
-- Después del backfill ninguna línea de compra queda en NULL, así que el CHECK
-- del paso 4 se agrega VALIDADO — una garantía, no una promesa sobre filas
-- nuevas. Aplica solo a compras (`business_expense_id IS NULL OR …`), que es
-- exactamente donde importa, y no se mete con trámite.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 📋 PRE-FLIGHT OBLIGATORIO CONTRA PRODUCCIÓN, antes de aplicar
-- ─────────────────────────────────────────────────────────────────────────────
-- En prod corre después de la cadena 036 → 037 → 038 → 040 en un solo deploy.
-- Lo único que puede abortarla es una tasa de compra que no calce con el
-- catálogo. Correr el mismo día:
--
--     SELECT tax_rate, COUNT(*) FROM business_expenses GROUP BY 1 ORDER BY 1;
--     SELECT code, rate, active FROM tax_codes ORDER BY code;
--
-- Toda tasa > 0 de la primera consulta tiene que aparecer EXACTAMENTE UNA VEZ
-- activa en la segunda. Staging al 16/09/2026: 10 líneas de compra, tasas
-- {0.0000 ×7, 0.0700 ×3}, las tres resueltas.
--
-- IDEMPOTENCIA: ADD COLUMN IF NOT EXISTS, backfill con `WHERE tax_code_id IS
-- NULL`, CHECK dropeado antes de crearse. Re-ejecutable: la segunda corrida
-- actualiza 0 filas y las verificaciones siguen pasando.
--
-- DEPENDE DE: 036 (la tabla), 040 (las líneas de compra). Correr DESPUÉS.
--
-- APLICACIÓN:
--   Staging: `node scripts/run-sql.mjs sql/pending/045_expense_lines_tax_code_id.sql`
--   🔴 Producción: NO desde una máquina. Solo por merge a `main`, con el
--      pre-flight de arriba corrido el mismo día.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0) FOTO DE ANTES — lo que el paso 5 compara. Trámite NO debe cambiar.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _045_antes ON COMMIT DROP AS
SELECT
  COUNT(*) FILTER (WHERE expense_id IS NOT NULL)          AS lineas_tramite,
  COALESCE(ROUND(SUM(amount) FILTER (WHERE expense_id IS NOT NULL), 2), 0) AS suma_tramite,
  COUNT(*) FILTER (WHERE business_expense_id IS NOT NULL) AS lineas_compra,
  (SELECT COUNT(*) FROM public.journal_entries)           AS asientos
FROM public.expense_lines;

-- ---------------------------------------------------------------------------
-- 1) GUARDS
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.expense_lines') IS NULL THEN
    RAISE EXCEPTION
      'No existe `expense_lines`. Aplicar primero sql/pending/036_expense_lines.sql.';
  END IF;
  IF to_regclass('public.tax_codes') IS NULL THEN
    RAISE EXCEPTION
      'No existe `tax_codes`. Esta base no tiene el catálogo de impuestos (20260505000002).';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) LA COLUMNA — FK real, como `invoice_lines.tax_code_id`
-- ---------------------------------------------------------------------------
-- FK real y no lógica (a diferencia de `chart_account_code`): `tax_codes.id`
-- es estable, y `updateTaxCode()` no permite renombrar `code`, así que no hay
-- razón para copiar el texto como hace `invoice_lines.tax_code` — ese texto es
-- herencia del FK compuesto de `services_catalog`, no del patrón.
ALTER TABLE public.expense_lines
  ADD COLUMN IF NOT EXISTS tax_code_id uuid NULL REFERENCES public.tax_codes(id);

CREATE INDEX IF NOT EXISTS idx_expense_lines_tax_code
  ON public.expense_lines (tenant_id, tax_code_id) WHERE tax_code_id IS NOT NULL;

COMMENT ON COLUMN public.expense_lines.tax_code_id IS
  'Código de impuesto elegido (FK a tax_codes). `tax_rate` es el snapshot de su tasa al cargar la línea. Obligatorio en líneas de COMPRA (CHECK expense_lines_compra_con_impuesto); en líneas de trámite queda NULL para las históricas — ver 045.';

-- ---------------------------------------------------------------------------
-- 3) BACKFILL — solo compras, por tenant
-- ---------------------------------------------------------------------------
-- 3a) Tasa 0 → EXENTO.
UPDATE public.expense_lines l
   SET tax_code_id = tc.id
  FROM public.tax_codes tc
 WHERE l.business_expense_id IS NOT NULL
   AND l.tax_code_id IS NULL
   AND l.tax_rate = 0
   AND tc.tenant_id = l.tenant_id
   AND tc.code = 'EXENTO';

-- 3b) Tasa > 0 → el único código ACTIVO del tenant con esa tasa.
--     El subquery exige exactamente uno: con dos candidatos no actualiza, y el
--     guard de 3c lo reporta.
UPDATE public.expense_lines l
   SET tax_code_id = (
     SELECT (array_agg(tc.id))[1]
       FROM public.tax_codes tc
      WHERE tc.tenant_id = l.tenant_id
        AND tc.active
        AND tc.rate = l.tax_rate
      HAVING COUNT(*) = 1
   )
 WHERE l.business_expense_id IS NOT NULL
   AND l.tax_code_id IS NULL
   AND l.tax_rate > 0;

-- 3c) Nada de compra puede quedar sin resolver.
DO $$
DECLARE
  v_sin   int;
  v_lista text;
BEGIN
  SELECT COUNT(*),
         string_agg(
           format('compra %s línea %s (tasa %s)', l.business_expense_id, l.line_order, l.tax_rate),
           '; ' ORDER BY l.business_expense_id, l.line_order
         )
    INTO v_sin, v_lista
    FROM public.expense_lines l
   WHERE l.business_expense_id IS NOT NULL
     AND l.tax_code_id IS NULL;

  IF v_sin > 0 THEN
    RAISE EXCEPTION
      '% línea(s) de compra con una tasa que no calza con NINGÚN código activo del catálogo, o con MÁS DE UNO: %. Corregir el catálogo o las líneas antes de aplicar la 045.',
      v_sin, v_lista;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4) EL CHECK — validado, solo para compras
-- ---------------------------------------------------------------------------
ALTER TABLE public.expense_lines
  DROP CONSTRAINT IF EXISTS expense_lines_compra_con_impuesto;

ALTER TABLE public.expense_lines
  ADD CONSTRAINT expense_lines_compra_con_impuesto
  CHECK (business_expense_id IS NULL OR tax_code_id IS NOT NULL);

COMMENT ON CONSTRAINT expense_lines_compra_con_impuesto ON public.expense_lines IS
  'Una línea de COMPRA siempre dice qué código de impuesto eligió. Validado (no NOT VALID): el backfill de la 045 no dejó ninguna en NULL. Las líneas de trámite quedan fuera a propósito.';

-- ---------------------------------------------------------------------------
-- 5) VERIFICACIÓN — si algo falla, revierte TODO
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  a                 record;
  v_tramite_despues bigint;
  v_suma_tramite    numeric;
  v_compra_despues  bigint;
  v_tramite_con_id  bigint;
  v_tasa_distinta   bigint;
  v_asientos        bigint;
  v_por_codigo      text;
BEGIN
  SELECT * INTO a FROM _045_antes;

  SELECT COUNT(*) FILTER (WHERE expense_id IS NOT NULL),
         COALESCE(ROUND(SUM(amount) FILTER (WHERE expense_id IS NOT NULL), 2), 0),
         COUNT(*) FILTER (WHERE business_expense_id IS NOT NULL),
         COUNT(*) FILTER (WHERE expense_id IS NOT NULL AND tax_code_id IS NOT NULL)
    INTO v_tramite_despues, v_suma_tramite, v_compra_despues, v_tramite_con_id
    FROM public.expense_lines;

  -- (1) Trámite intacto: misma cantidad, misma suma.
  IF v_tramite_despues <> a.lineas_tramite OR v_suma_tramite <> a.suma_tramite THEN
    RAISE EXCEPTION
      'Las líneas de trámite cambiaron (% / % antes, % / % después). Esta migración no las toca.',
      a.lineas_tramite, a.suma_tramite, v_tramite_despues, v_suma_tramite;
  END IF;

  -- (2) Ninguna línea de compra se creó ni se perdió.
  IF v_compra_despues <> a.lineas_compra THEN
    RAISE EXCEPTION
      'La cantidad de líneas de compra cambió: % antes, % después.',
      a.lineas_compra, v_compra_despues;
  END IF;

  -- (3) El snapshot coincide con el catálogo, línea por línea.
  SELECT COUNT(*) INTO v_tasa_distinta
    FROM public.expense_lines l
    JOIN public.tax_codes tc ON tc.id = l.tax_code_id
   WHERE l.business_expense_id IS NOT NULL
     AND tc.rate <> l.tax_rate;
  IF v_tasa_distinta > 0 THEN
    RAISE EXCEPTION
      '% línea(s) de compra cuyo tax_rate no es la tasa del código asignado.',
      v_tasa_distinta;
  END IF;

  -- (4) El libro no se tocó.
  SELECT COUNT(*) INTO v_asientos FROM public.journal_entries;
  IF v_asientos <> a.asientos THEN
    RAISE EXCEPTION 'La cantidad de asientos cambió: % antes, % después.', a.asientos, v_asientos;
  END IF;

  SELECT string_agg(format('%s ×%s', tc.code, n), ', ' ORDER BY tc.code)
    INTO v_por_codigo
    FROM (SELECT tax_code_id, COUNT(*) n
            FROM public.expense_lines
           WHERE business_expense_id IS NOT NULL
           GROUP BY tax_code_id) x
    JOIN public.tax_codes tc ON tc.id = x.tax_code_id;

  RAISE NOTICE '════════════════════════════════════════════════════';
  RAISE NOTICE '045 OK';
  RAISE NOTICE '  líneas de compra ........ %  (todas con código: %)', v_compra_despues, COALESCE(v_por_codigo, '—');
  RAISE NOTICE '  líneas de trámite ....... %  (sin cambios; % con código)', v_tramite_despues, v_tramite_con_id;
  RAISE NOTICE '  asientos ................ %  (sin cambios)', v_asientos;
  RAISE NOTICE '════════════════════════════════════════════════════';
END $$;

COMMIT;


-- ============================================================================
-- ROLLBACK (correr a mano si hace falta volver atrás)
-- ============================================================================
-- ⚠️ Dropear la columna borra el código elegido en toda línea cargada DESPUÉS
--    de aplicar esto; el `tax_rate` queda, así que el importe no se pierde.
--
-- BEGIN;
-- ALTER TABLE public.expense_lines DROP CONSTRAINT IF EXISTS expense_lines_compra_con_impuesto;
-- DROP INDEX IF EXISTS public.idx_expense_lines_tax_code;
-- ALTER TABLE public.expense_lines DROP COLUMN IF EXISTS tax_code_id;
-- COMMIT;
-- ============================================================================
