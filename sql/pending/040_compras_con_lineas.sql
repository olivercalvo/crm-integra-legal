-- ============================================================================
-- 040 — LA CUENTA DE UNA COMPRA SE MUDA A `expense_lines`
-- ============================================================================
--
-- `business_expenses.chart_account_code` es UNA sola cuenta. El asiento de una
-- compra admite N. La compra #3 sembrada en staging lo muestra crudo: su fila
-- dice `610002` y su asiento tiene TRES líneas de débito (610008 412,35 +
-- 610002 900,00 + 500003 185,50). El asiento no se puede derivar de la fila.
--
-- Esta migración mueve la cuenta a la línea y **apaga la columna del encabezado**.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUÉ SE APAGA Y NO SE DEJA COMO ESPEJO
-- ─────────────────────────────────────────────────────────────────────────────
-- La opción del espejo derivado existe en este repo y funciona bien:
-- `invoices.amount_paid` la mantiene el trigger T7a y T4b rechaza cualquier otra
-- escritura (ver CLAUDE.md). Acá NO sirve, y el motivo es que no es el mismo
-- problema:
--
--   · `amount_paid` es `SUM(payment_applications)` — **un escalar bien definido
--     para N filas**. Siempre hay una respuesta correcta.
--   · "la cuenta" de una compra de tres líneas **no tiene respuesta correcta**.
--     Cualquier valor que pusiéramos en la columna sería la elección arbitraria
--     de una de las tres, y la que quede afuera desaparece del encabezado sin
--     que nada lo diga.
--
-- Un espejo que no puede reflejar no es un espejo: es una segunda verdad que
-- contradice a la primera en silencio. Por eso la columna se vacía y se sella.
--
-- ⚠️ **NO se hace DROP.** La lección de Cotizaciones está en CLAUDE.md: agregar
-- → backfill → refactorizar el código → verificar en producción → recién ahí
-- dropear, en una migración separada. La columna queda, vacía y con un CHECK que
-- impide volver a escribirla. El DROP es un commit posterior.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 🛑 EL GUARD QUE PUEDE ABORTAR ESTA MIGRACIÓN, Y POR QUÉ ESTÁ BIEN QUE ABORTE
-- ─────────────────────────────────────────────────────────────────────────────
-- `expense_lines_cuenta_obligatoria` (migración `037`) es
-- `CHECK (chart_account_code IS NOT NULL) NOT VALID`: no revisó las filas viejas,
-- pero **SÍ se hace cumplir en cada INSERT**. O sea que una compra cuyo
-- encabezado tiene la cuenta en NULL **no puede generar su línea**.
--
-- El paso 1 las cuenta ANTES de tocar nada y aborta nombrando cuántas son. No se
-- las saltea: una compra sin línea quedaría invisible para el posteo y para los
-- reportes, que es peor que no migrar.
--
-- 📋 PRE-FLIGHT OBLIGATORIO CONTRA PRODUCCIÓN, antes de aplicar:
--
--     SELECT COUNT(*) AS total,
--            COUNT(*) FILTER (WHERE chart_account_code IS NULL) AS sin_cuenta,
--            COUNT(*) FILTER (WHERE tax_amount > 0)             AS con_itbms
--       FROM business_expenses;
--
-- Si `sin_cuenta > 0`, hay que clasificarlas antes. En STAGING al 04/09/2026:
-- 3 compras, 0 sin cuenta, 0 con ITBMS.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- IDEMPOTENCIA
-- ─────────────────────────────────────────────────────────────────────────────
-- El backfill inserta solo donde la compra todavía NO tiene líneas. El UPDATE
-- del encabezado filtra por `IS NOT NULL`. La segunda corrida toca 0 filas.
-- Re-ejecutable.
--
-- DEPENDE DE: `036` (crea `expense_lines` y el arco exclusivo) y `037` (el CHECK
-- de cuenta obligatoria). Correr DESPUÉS de las dos.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0) Fotografía previa, para verificar al final contra números y no contra fe
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _040_antes ON COMMIT DROP AS
SELECT id,
       tenant_id,
       chart_account_code,
       description,
       subtotal,
       tax_rate,
       tax_amount,
       total
  FROM business_expenses;

-- ---------------------------------------------------------------------------
-- 1) GUARDS
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_sin_cuenta INT;
  v_falta_tabla BOOL;
BEGIN
  SELECT NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'expense_lines'
  ) INTO v_falta_tabla;

  IF v_falta_tabla THEN
    RAISE EXCEPTION
      'Falta la tabla expense_lines. Aplicar primero sql/pending/036_expense_lines.sql.';
  END IF;

  SELECT COUNT(*) INTO v_sin_cuenta
    FROM business_expenses
   WHERE chart_account_code IS NULL;

  IF v_sin_cuenta > 0 THEN
    RAISE EXCEPTION
      'Hay % compra(s) sin chart_account_code. No se les puede crear la línea porque expense_lines_cuenta_obligatoria (037) rechaza el INSERT. Clasificarlas antes de aplicar esta migración.',
      v_sin_cuenta;
  END IF;

  RAISE NOTICE 'Guards OK. Compras a migrar: %', (SELECT COUNT(*) FROM business_expenses);
END $$;

-- ---------------------------------------------------------------------------
-- 2) BACKFILL — una línea por compra, con la cuenta del encabezado
-- ---------------------------------------------------------------------------
-- Los importes se copian tal cual: `amount` = subtotal (la base), `tax_rate` y
-- `tax_amount` como estaban. `line_total` queda para que la calcule quien
-- corresponda, igual que en `036`.
--
-- ⚠️ `description` de la línea sale de la del encabezado, RECORTADA a 300, que
-- es el tope de `expense_lines_description_largo`. El encabezado admite 500.
-- Recortar es correcto: la descripción completa sigue en la compra.
INSERT INTO expense_lines (
  tenant_id, business_expense_id, line_order,
  description, chart_account_code, amount, tax_rate, tax_amount
)
SELECT be.tenant_id,
       be.id,
       1,
       LEFT(be.description, 300),
       be.chart_account_code,
       -- `amount > 0` lo exige expense_lines_amount_positivo. Una compra de
       -- subtotal 0 con impuesto es imposible por el CHECK de consistencia de
       -- business_expenses, así que este COALESCE no debería activarse nunca;
       -- está para que, si se activa, falle el CHECK y no entre basura.
       be.subtotal,
       be.tax_rate,
       be.tax_amount
  FROM business_expenses be
 WHERE NOT EXISTS (
   SELECT 1 FROM expense_lines el WHERE el.business_expense_id = be.id
 );

-- ---------------------------------------------------------------------------
-- 3) APAGAR LA COLUMNA DEL ENCABEZADO
-- ---------------------------------------------------------------------------
UPDATE business_expenses
   SET chart_account_code = NULL,
       updated_at = NOW()
 WHERE chart_account_code IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4) SELLARLA
-- ---------------------------------------------------------------------------
-- VALIDADO, no NOT VALID: el paso 3 acaba de dejar todas las filas en NULL, así
-- que el escaneo inicial pasa. Un CHECK validado es una garantía; uno NOT VALID
-- es una promesa sobre las filas nuevas. Acá se puede tener la garantía.
ALTER TABLE business_expenses
  ADD CONSTRAINT business_expenses_cuenta_vive_en_la_linea
  CHECK (chart_account_code IS NULL);

COMMENT ON COLUMN business_expenses.chart_account_code IS
  'APAGADA por la migración 040. La cuenta vive en expense_lines.chart_account_code. '
  'El CHECK business_expenses_cuenta_vive_en_la_linea la fuerza a NULL. No se dropeó '
  'todavía: el DROP va en una migración separada, después de verificar producción '
  '(patrón de CLAUDE.md, lecciones de Cotizaciones).';

-- ---------------------------------------------------------------------------
-- 5) VERIFICACIONES — en CANTIDAD y en MONTO, no solo en cuadre
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_compras        INT;
  v_lineas         INT;
  v_sin_linea      INT;
  v_con_cuenta     INT;
  v_desc_monto     INT;
  v_desc_cuenta    INT;
BEGIN
  SELECT COUNT(*) INTO v_compras FROM _040_antes;

  SELECT COUNT(*) INTO v_lineas
    FROM expense_lines WHERE business_expense_id IS NOT NULL;

  -- 5.1 — Una línea por compra, ninguna huérfana
  IF v_lineas <> v_compras THEN
    RAISE EXCEPTION
      'Cantidad: % compras pero % líneas de compra. Debía ser uno a uno.',
      v_compras, v_lineas;
  END IF;

  -- 5.2 — Ninguna compra quedó sin línea
  SELECT COUNT(*) INTO v_sin_linea
    FROM _040_antes a
   WHERE NOT EXISTS (
     SELECT 1 FROM expense_lines el WHERE el.business_expense_id = a.id
   );
  IF v_sin_linea > 0 THEN
    RAISE EXCEPTION 'Quedaron % compra(s) sin línea.', v_sin_linea;
  END IF;

  -- 5.3 — El encabezado quedó completamente apagado
  SELECT COUNT(*) INTO v_con_cuenta
    FROM business_expenses WHERE chart_account_code IS NOT NULL;
  IF v_con_cuenta > 0 THEN
    RAISE EXCEPTION
      'Quedaron % encabezado(s) con cuenta. El CHECK debería haberlo impedido.',
      v_con_cuenta;
  END IF;

  -- 5.4 — RECONCILIACIÓN UNO A UNO, no por suma total.
  --       Dos errores que se compensan pasan un chequeo de suma.
  SELECT COUNT(*) INTO v_desc_monto
    FROM _040_antes a
    JOIN expense_lines el ON el.business_expense_id = a.id
   WHERE el.amount     IS DISTINCT FROM a.subtotal
      OR el.tax_amount IS DISTINCT FROM a.tax_amount
      OR el.tax_rate   IS DISTINCT FROM a.tax_rate;
  IF v_desc_monto > 0 THEN
    RAISE EXCEPTION
      '% compra(s) donde la línea no reproduce los importes del encabezado.',
      v_desc_monto;
  END IF;

  -- 5.5 — La cuenta viajó intacta
  SELECT COUNT(*) INTO v_desc_cuenta
    FROM _040_antes a
    JOIN expense_lines el ON el.business_expense_id = a.id
   WHERE el.chart_account_code IS DISTINCT FROM a.chart_account_code;
  IF v_desc_cuenta > 0 THEN
    RAISE EXCEPTION
      '% compra(s) donde la cuenta de la línea no es la del encabezado.',
      v_desc_cuenta;
  END IF;

  RAISE NOTICE '════════════════════════════════════════════════════';
  RAISE NOTICE '040 OK';
  RAISE NOTICE '  compras migradas : %', v_compras;
  RAISE NOTICE '  líneas creadas   : %', v_lineas;
  RAISE NOTICE '  encabezados con cuenta: 0 (sellado por CHECK)';
  RAISE NOTICE '════════════════════════════════════════════════════';
END $$;

COMMIT;
