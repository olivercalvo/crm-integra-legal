-- ============================================================================
-- 058 — EL MOTIVO DE ANULACIÓN PASA A EXIGIR 15 CARACTERES
-- ============================================================================
--
-- Bloque 9B (23/09/2026), decisión D5. Una sola columna, un solo CHECK, sin
-- backfill y sin tocar ningún dato.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUÉ 15 Y NO 3
-- ─────────────────────────────────────────────────────────────────────────────
-- El número no lo elegimos nosotros: **lo pide la DGI**. ideati (Eduardo
-- Méndez, 22/09/2026) respondió que `cancellationReason` del endpoint
-- `POST /api/v1/InvoiceEvents/CreateCancellation` es texto libre con un
-- **mínimo de 15 caracteres**. Hoy el CRM exige 3
-- (`validateCancelInput` en `api/invoices.ts`), así que en cuanto 9B cablee el
-- envío, un motivo de 4 caracteres que el CRM acepta sin chistar se convierte
-- en un **rechazo del PAC sobre una factura real**, delante del cliente, con la
-- anulación a medio hacer.
--
-- Subirlo sólo en el validador dejaría el agujero de siempre: el RPC
-- `cancel_invoice_with_reversal` (052/053) escribe `cancellation_reason`
-- directamente, así que cualquier camino que no pase por la ruta de API —un
-- script, una corrección manual, un `psql`— podría dejar un motivo que la DGI
-- va a rechazar. El CHECK es la capa que no se puede saltear.
--
-- El tope de 1000 ya estaba escrito en `claude.md` ("motivo obligatorio
-- 3–1000") pero **no existía en la base**: la columna es `text` sin ninguna
-- restricción de largo. Se declara acá junto con el mínimo.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ESTADO REAL DE LA COLUMNA, MEDIDO — NO LEÍDO DE UN COMENTARIO
-- ─────────────────────────────────────────────────────────────────────────────
-- Pre-flight corrido contra STAGING el 23/09/2026 (sólo lectura):
--
--   · `invoices.cancellation_reason`  text, NULL permitido
--   · CHECKs de `invoices` que mencionan esa columna: **NINGUNO**
--   · filas con motivo cargado: **3**
--   · filas con motivo de menos de 15 caracteres: **0**
--
-- Por eso esta migración **no re-declara** ningún CHECK: no hay ninguno que
-- re-declarar. Agrega el primero.
--
-- 🔴 PRODUCCIÓN NO SE MIDIÓ, Y POR ESO LA MIGRACIÓN SE DETIENE SOLA.
--    Producción está 25 migraciones atrás y no se consulta desde una máquina.
--    No sabemos cuántas facturas anuladas tiene con un motivo corto. En vez de
--    suponer, el bloque de abajo **cuenta, lista las infractoras y aborta con
--    EXCEPTION** si hay aunque sea una. Abortar es el resultado correcto: un
--    motivo de anulación es un dato que alguien escribió y que aparece en el
--    PDF de la factura anulada. Reescribirlo desde una migración —rellenarlo,
--    truncarlo, inventar un texto— sería falsificar el registro de por qué se
--    anuló un documento fiscal. Si aparece alguna, la decisión es de Oliver y
--    del contador, no de este archivo.
--
-- ⚠️ EL MÍNIMO DE LA NOTA DE CRÉDITO NO SE TOCA. `NC_MOTIVO_MIN` sigue en 3
--    (`validators/credit-note.ts`). No es un olvido: los 15 caracteres son del
--    endpoint de ANULACIÓN de la DGI, y una nota de crédito hoy es un documento
--    interno que no se le manda a nadie (`fe_estado = 'no_emitida'`, Bloque 5).
--    Cuando 9C envíe notas de crédito al PAC habrá que revisar si su motivo
--    también viaja y con qué mínimo. Queda anotado en `task_plan.md`.
--    (La anulación crea una NC total automática con el MISMO motivo, así que
--    por ese camino la NC ya queda con 15 o más. No hay conflicto.)
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ORDEN
-- ─────────────────────────────────────────────────────────────────────────────
-- Va DESPUÉS de `20260507000001_finanzas_b4_anular_factura.sql`, que es la que
-- crea la columna. Si la columna no existe, aborta.
--
-- Reversible: `ALTER TABLE public.invoices DROP CONSTRAINT
-- invoices_cancellation_reason_largo;` — no borra ni modifica ningún dato.
-- ============================================================================

BEGIN;

-- ── 1. La columna tiene que existir ─────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='invoices'
       AND column_name='cancellation_reason'
  ) THEN
    RAISE EXCEPTION
      '058: invoices.cancellation_reason no existe. Aplicar primero 20260507000001_finanzas_b4_anular_factura.sql.';
  END IF;
END $$;

-- ── 2. 🔴 Las filas que no cumplirían. Se listan y se aborta ────────────────
DO $$
DECLARE
  v_malas int;
  r       record;
BEGIN
  SELECT count(*) INTO v_malas
    FROM public.invoices
   WHERE cancellation_reason IS NOT NULL
     AND (char_length(btrim(cancellation_reason)) < 15
          OR char_length(btrim(cancellation_reason)) > 1000);

  IF v_malas > 0 THEN
    RAISE NOTICE '─────────────────────────────────';
    RAISE NOTICE '058 — 🔴 HAY % FACTURA(S) CON UN MOTIVO QUE NO CUMPLE', v_malas;
    RAISE NOTICE '';
    FOR r IN
      SELECT invoice_number,
             char_length(btrim(cancellation_reason)) AS largo,
             btrim(cancellation_reason)              AS motivo
        FROM public.invoices
       WHERE cancellation_reason IS NOT NULL
         AND (char_length(btrim(cancellation_reason)) < 15
              OR char_length(btrim(cancellation_reason)) > 1000)
       ORDER BY invoice_number
       LIMIT 50
    LOOP
      RAISE NOTICE '  % — % caracteres: "%"', r.invoice_number, r.largo, r.motivo;
    END LOOP;
    RAISE NOTICE '';
    RAISE NOTICE '  Esta migración NO las corrige a propósito. El motivo de una';
    RAISE NOTICE '  anulación es un dato que alguien escribió y que sale impreso en';
    RAISE NOTICE '  el PDF de la factura anulada: rellenarlo o truncarlo desde acá';
    RAISE NOTICE '  sería falsificar el registro de por qué se anuló un documento';
    RAISE NOTICE '  fiscal. Qué hacer con ellas lo deciden Oliver y el contador.';
    RAISE NOTICE '─────────────────────────────────';
    RAISE EXCEPTION '058: % factura(s) con motivo fuera de 15..1000. No se aplicó nada.', v_malas;
  END IF;

  RAISE NOTICE '058: 0 facturas con motivo fuera de rango. Se puede agregar el CHECK.';
END $$;

-- ── 3. El CHECK ─────────────────────────────────────────────────────────────
-- Idempotente: si ya está, se saca y se vuelve a poner con la definición de
-- este archivo. Así una segunda pasada no falla y tampoco deja una versión
-- vieja en pie.
ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_cancellation_reason_largo;

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_cancellation_reason_largo
  CHECK (
    cancellation_reason IS NULL
    OR char_length(btrim(cancellation_reason)) BETWEEN 15 AND 1000
  );

COMMENT ON CONSTRAINT invoices_cancellation_reason_largo ON public.invoices IS
  'D5 (Bloque 9B, 23/09/2026). El mínimo de 15 lo pide la DGI: cancellationReason '
  'de POST /api/v1/InvoiceEvents/CreateCancellation exige 15 caracteres (ideati, '
  '22/09/2026). Con menos, el PAC rechaza la anulación de una factura real. NULL '
  'sigue permitido: una factura que no está anulada no tiene motivo.';

COMMIT;

-- ============================================================================
-- VERIFICACIÓN
-- ============================================================================
DO $$
DECLARE
  v_def    text;
  v_malas  int;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid
   WHERE r.relname = 'invoices' AND c.conname = 'invoices_cancellation_reason_largo';

  SELECT count(*) INTO v_malas
    FROM public.invoices
   WHERE cancellation_reason IS NOT NULL
     AND char_length(btrim(cancellation_reason)) NOT BETWEEN 15 AND 1000;

  RAISE NOTICE '─────────────────────────────────';
  RAISE NOTICE '058 — VERIFICACIÓN';
  RAISE NOTICE '  CHECK ................. %', COALESCE(v_def, '(NO EXISTE)');
  RAISE NOTICE '  filas fuera de rango .. % (esperado 0)', v_malas;
  RAISE NOTICE '─────────────────────────────────';

  IF v_def IS NULL THEN
    RAISE EXCEPTION '058: el CHECK no quedó creado.';
  END IF;
  IF v_malas <> 0 THEN
    RAISE EXCEPTION '058: quedaron % filas fuera de rango con el CHECK puesto (imposible).', v_malas;
  END IF;
END $$;
