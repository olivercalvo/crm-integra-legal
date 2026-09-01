-- =============================================================================
-- FEATURE: `invoices.amount_paid` se DERIVA de `payment_applications`
-- Fecha: 2026-09-01
-- Aplica a: staging (`node scripts/run-sql.mjs sql/pending/032_amount_paid_derivado.sql`)
--           producción → SOLO por merge a `main`, y con la verificación previa
--           que está al pie de este archivo.
--
-- POR QUÉ EXISTE
--   T7a (`finanzas_recalc_one_invoice_amount_paid`, migración
--   20260505000007_finanzas_b3e_triggers.sql) ya recalcula `amount_paid` y el
--   `status` de la factura a partir de sus `payment_applications`. O sea:
--   `amount_paid` es un número DERIVADO desde el día uno.
--
--   Pero derivado y garantizado no son lo mismo. T4 (`finanzas_invoice_immutability`)
--   autoriza EXPLÍCITAMENTE escribir `amount_paid` en una factura ya emitida, y
--   los grants no lo restringen por columna. La derivación estaba acostumbrada,
--   no garantizada.
--
--   Se cobró el 2026-08-28: `seed-staging.ts` escribía `amount_paid` a mano en el
--   INSERT de la factura, sin `payment` detrás. FAC-REI-000001 quedó con
--   `amount_paid = 150.00` y CERO aplicaciones, mostrando "PAGADO $150.00" al lado
--   de "Aún no hay pagos registrados". Y como `balance_due` es
--   `GENERATED ALWAYS AS (grand_total - amount_paid)`, el saldo falso en 0.00
--   además ESCONDÍA el botón "Registrar pago": un dato falso que encima
--   desactivaba la función que lo habría corregido.
--
-- QUÉ HACE ESTA MIGRACIÓN
--   1. T7a marca su paso con un flag local a la transacción antes de escribir.
--   2. Un guard nuevo (T4b) rechaza cualquier otra escritura de `amount_paid`,
--      en UPDATE y también en INSERT — por el INSERT entraba el seed.
--   3. Deja una válvula de escape documentada, con OTRO flag distinto del de T7a.
--      Ver `sop.md` SOP-017. Un candado sin llave documentada se abre con un
--      DROP TRIGGER a las once de la noche, y eso es peor que no tenerlo.
--
-- QUÉ *NO* HACE
--   · NO toca `status`. `status` NO es una columna derivada: T7a solo opina sobre
--     tres de sus seis estados (`emitida` / `parcialmente_pagada` / `pagada`).
--     `borrador`, `cancelada_pre_emision` y `anulada` son estados de máquina que
--     no salen de los pagos, y T7a los respeta a propósito. Cerrarle la escritura
--     a `status` rompería `emitInvoice()` y `cancelInvoice()`.
--   · NO corrige desfases que ya existan. Impide nuevos, no repara viejos. Correr
--     la consulta del pie ANTES de aplicar esto en cualquier base con datos reales.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. T7a marca su paso
-- -----------------------------------------------------------------------------
-- `set_config(..., true)` = local a la transacción: se limpia sola en el COMMIT
-- o el ROLLBACK, así que no puede quedar abierta por olvido.
--
-- Se apaga a mano apenas termina el UPDATE. Sin eso, el flag quedaría en 'on' el
-- RESTO de la transacción y cualquier escritura posterior a `invoices` pasaría
-- por la puerta que T7a dejó abierta detrás suyo.
--
-- El cuerpo de la función es el mismo de 20260505000007 salvo esas tres líneas.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.finanzas_recalc_one_invoice_amount_paid(p_invoice_id UUID)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_status      TEXT;
  v_grand       NUMERIC(12,2);
  v_paid        NUMERIC(12,2);
  v_new_status  TEXT;
BEGIN
  SELECT status, grand_total INTO v_status, v_grand
  FROM invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN RETURN; END IF;

  SELECT COALESCE(SUM(amount_applied), 0) INTO v_paid
  FROM payment_applications
  WHERE invoice_id = p_invoice_id;

  v_new_status := v_status;

  IF v_status = 'anulada' THEN
    -- terminal: T7a no toca status
    NULL;
  ELSIF v_status NOT IN ('emitida', 'parcialmente_pagada', 'pagada') THEN
    -- borrador, cancelada_pre_emision: T7a no opina sobre status
    NULL;
  ELSE
    IF v_paid = 0 THEN
      v_new_status := 'emitida';
    ELSIF v_paid >= v_grand THEN
      v_new_status := 'pagada';
    ELSE
      v_new_status := 'parcialmente_pagada';
    END IF;
  END IF;

  -- ---- La llave de T4b. Ver el encabezado. --------------------------------
  PERFORM set_config('finanzas.recalc', 'on', true);

  IF v_new_status IS DISTINCT FROM v_status THEN
    UPDATE invoices
    SET amount_paid = v_paid,
        status      = v_new_status
    WHERE id = p_invoice_id;
  ELSE
    UPDATE invoices
    SET amount_paid = v_paid
    WHERE id = p_invoice_id;
  END IF;

  PERFORM set_config('finanzas.recalc', 'off', true);
END;
$$;

COMMENT ON FUNCTION public.finanzas_recalc_one_invoice_amount_paid IS
  'T7a. ÚNICA vía normal para escribir invoices.amount_paid. Lo recalcula como SUM(payment_applications) y ajusta el status entre emitida/parcialmente_pagada/pagada. Se anuncia ante T4b con el flag de transacción finanzas.recalc y lo apaga apenas termina.';


-- =============================================================================
-- 2. T4b — GUARD DE `amount_paid`
-- -----------------------------------------------------------------------------
-- Rechaza toda escritura de `amount_paid` que no venga de T7a ni de la válvula
-- documentada.
--
-- El INSERT se controla igual que el UPDATE: por el INSERT entraba el seed, que
-- creaba la factura ya "cobrada" sin que existiera un solo pago. Una factura
-- nace con `amount_paid = 0` (el DEFAULT de la columna) y sube solo cuando se le
-- aplica un pago.
--
-- `current_setting(..., true)` con missing_ok = true devuelve NULL si el
-- parámetro no está seteado, en vez de reventar. Es lo normal: casi ninguna
-- transacción setea estos flags.
--
-- Nombre a propósito con 'a' inicial: los BEFORE triggers de una tabla corren en
-- orden alfabético, así que este rechaza antes de que T4/T2 hagan su trabajo y el
-- mensaje que ve quien escribió mal es el específico, no uno genérico.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.finanzas_guard_amount_paid()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_recalc   TEXT := current_setting('finanzas.recalc', true);
  v_override TEXT := current_setting('finanzas.amount_paid_override', true);
  v_ayuda    TEXT :=
    '`invoices.amount_paid` se DERIVA de `payment_applications` y lo mantiene el trigger T7a. '
    'Para dejar una factura cobrada NO se escribe esta columna: se crea el pago '
    '(INSERT en `payments` + INSERT en `payment_applications` con el `amount_applied`), '
    'y T7a actualiza `amount_paid` y el `status` solos. '
    'Si esto es una restauración de respaldo o una corrección de datos autorizada, '
    'hay una válvula documentada en `sop.md` SOP-017.';
BEGIN
  -- T7a escribiendo: es la vía normal.
  IF v_recalc = 'on' THEN
    RETURN NEW;
  END IF;

  -- Válvula de escape. Deliberadamente un flag DISTINTO del de T7a: en el log de
  -- Postgres una corrección humana tiene que poder distinguirse de la operación
  -- normal del sistema.
  IF v_override = 'on' THEN
    RAISE WARNING 'finanzas.amount_paid_override: escritura MANUAL de amount_paid en la factura % (%). Ver sop.md SOP-017.',
      COALESCE(NEW.invoice_number, '(sin número)'), TG_OP;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.amount_paid IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION
        'La factura % no puede nacer con amount_paid = % . %',
        COALESCE(NEW.invoice_number, '(sin número)'), NEW.amount_paid, v_ayuda
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.amount_paid IS DISTINCT FROM OLD.amount_paid THEN
    RAISE EXCEPTION
      'Escritura directa de amount_paid en la factura % (% → %). %',
      COALESCE(OLD.invoice_number, '(sin número)'), OLD.amount_paid, NEW.amount_paid, v_ayuda
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.finanzas_guard_amount_paid IS
  'T4b. Rechaza toda escritura de invoices.amount_paid que no venga de T7a (flag finanzas.recalc) ni de la válvula documentada (flag finanzas.amount_paid_override, SOP-017). Cubre INSERT y UPDATE.';

DROP TRIGGER IF EXISTS trg_amount_paid_guard ON public.invoices;
CREATE TRIGGER trg_amount_paid_guard
  BEFORE INSERT OR UPDATE ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.finanzas_guard_amount_paid();


-- =============================================================================
-- 3. T4 — el comentario que prometía lo contrario
-- -----------------------------------------------------------------------------
-- El cuerpo de `finanzas_invoice_immutability` NO cambia: sigue dejando pasar
-- `amount_paid`, y está bien que lo haga, porque el que tiene que dejarlo pasar
-- para T7a es él. Lo que cambia es lo que dice: "se permiten cambios a
-- amount_paid" era cierto para cualquiera hasta hoy, y desde hoy solo lo es para
-- T7a. Un comentario que miente es peor que ninguno.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.finanzas_invoice_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('borrador', 'cancelada_pre_emision') THEN
    RETURN NEW;
  END IF;

  IF OLD.invoice_number  IS DISTINCT FROM NEW.invoice_number
     OR OLD.invoice_kind   IS DISTINCT FROM NEW.invoice_kind
     OR OLD.quote_id       IS DISTINCT FROM NEW.quote_id
     OR OLD.client_id      IS DISTINCT FROM NEW.client_id
     OR OLD.case_id        IS DISTINCT FROM NEW.case_id
     OR OLD.issue_date     IS DISTINCT FROM NEW.issue_date
     OR OLD.due_date       IS DISTINCT FROM NEW.due_date
     OR OLD.currency       IS DISTINCT FROM NEW.currency
     OR OLD.subtotal_total IS DISTINCT FROM NEW.subtotal_total
     OR OLD.tax_total      IS DISTINCT FROM NEW.tax_total
     OR OLD.grand_total    IS DISTINCT FROM NEW.grand_total
     OR OLD.notes          IS DISTINCT FROM NEW.notes
     OR OLD.tenant_id      IS DISTINCT FROM NEW.tenant_id
     OR OLD.created_at     IS DISTINCT FROM NEW.created_at
     OR OLD.created_by     IS DISTINCT FROM NEW.created_by
  THEN
    RAISE EXCEPTION 'Factura % está en status "%": solo se permiten cambios a status, amount_paid o updated_at',
      OLD.invoice_number, OLD.status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.finanzas_invoice_immutability IS
  'T4. En una factura que ya no está en borrador, congela todo salvo status, amount_paid y updated_at. OJO: que T4 deje pasar amount_paid NO significa que se pueda escribir a mano — desde la migración 032 el guard T4b (finanzas_guard_amount_paid) solo se lo permite a T7a. T4 lo deja pasar justamente para que T7a pueda hacer su trabajo.';

COMMIT;


-- =============================================================================
-- VERIFICACIÓN — se corre sola al aplicar el archivo
-- =============================================================================
DO $$
DECLARE
  v_trigger  int;
  v_desfases int;
BEGIN
  SELECT COUNT(*) INTO v_trigger
    FROM pg_trigger
   WHERE tgrelid = 'public.invoices'::regclass
     AND tgname  = 'trg_amount_paid_guard'
     AND NOT tgisinternal;

  IF v_trigger <> 1 THEN
    RAISE EXCEPTION 'T4b no quedó instalado (encontrados: %)', v_trigger;
  END IF;
  RAISE NOTICE 'OK — T4b instalado sobre invoices (INSERT y UPDATE).';

  -- Desfases PREEXISTENTES. El trigger no los corrige: solo impide nuevos.
  SELECT COUNT(*) INTO v_desfases
    FROM invoices i
    LEFT JOIN (
      SELECT invoice_id, SUM(amount_applied) AS aplicado
        FROM payment_applications GROUP BY invoice_id
    ) pa ON pa.invoice_id = i.id
   WHERE i.amount_paid IS DISTINCT FROM COALESCE(pa.aplicado, 0);

  IF v_desfases > 0 THEN
    RAISE WARNING 'Hay % factura(s) con amount_paid desfasado de sus aplicaciones. El guard NO las corrige. Listarlas con la consulta del pie de este archivo y resolverlas aparte.', v_desfases;
  ELSE
    RAISE NOTICE 'OK — 0 facturas con amount_paid desfasado.';
  END IF;
END $$;


-- =============================================================================
-- CONSULTA DE DIAGNÓSTICO — correr ANTES de aplicar esto en una base con datos
-- reales. Lista toda factura cuyo `amount_paid` no coincide con la suma de sus
-- aplicaciones. Cero filas = la derivación está sana.
-- -----------------------------------------------------------------------------
-- SELECT i.invoice_number, i.status, i.grand_total, i.amount_paid,
--        COALESCE(pa.aplicado, 0) AS suma_aplicada,
--        i.amount_paid - COALESCE(pa.aplicado, 0) AS diferencia,
--        i.balance_due
--   FROM invoices i
--   LEFT JOIN (SELECT invoice_id, SUM(amount_applied) AS aplicado
--                FROM payment_applications GROUP BY invoice_id) pa
--     ON pa.invoice_id = i.id
--  WHERE i.amount_paid IS DISTINCT FROM COALESCE(pa.aplicado, 0)
--  ORDER BY i.invoice_number;
-- =============================================================================
