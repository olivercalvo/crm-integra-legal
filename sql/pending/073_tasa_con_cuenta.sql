-- ============================================================================
-- 073 — CADA TASA DE IMPUESTO CON SU CUENTA
-- ============================================================================
-- 01/10/2026. Plan: `docs/finanzas/plan-bloque1.md`, punto 6. Josuarth, P-6a:
-- "una cuenta por tasa, la misma para ventas y compras".
--
-- Hasta acá el ITBMS iba SIEMPRE a 200003: una constante del asiento, repetida
-- en el constructor de factura y en el de compra, y escrita en duro en la
-- verificación de la NC de compra (066). Una tasa nueva (ITBMS_10, ISC_5) no
-- podía tener su propia cuenta.
--
-- Qué hace:
--   1. `tax_codes.account_code` (FK lógico al código de cuenta, como
--      `suppliers.default_chart_account_code` de la 057). Backfill: 200003 en
--      todas las tasas existentes (es lo que el libro ya hizo con ellas).
--      NOT NULL después del backfill.
--   2. Trigger `finanzas_tax_code_cuenta`:
--        · la cuenta existe en el plan del bufete, está ACTIVA, es de pasivo o
--          de activo, y NO es cuenta control (100004 / 200001: ahí cada línea
--          lleva tercero, y la línea de impuesto no tiene);
--        · 🔴 una vez USADA la tasa (en una línea de factura, compra, NC o
--          cotización) su cuenta NO cambia: se desactiva y se crea otra. Una NC
--          invierte la factura con la cuenta de la tasa al día de la NC: si la
--          cuenta cambió en el medio, acreditaría una cuenta distinta de la que
--          se debitó.
--   3. La verificación de `create_supplier_credit_note` (066) deja de mirar
--      '200003' en duro: suma los créditos a las cuentas de impuesto de las
--      tasas de las líneas de ESA compra (parche verificado, técnica de la 069).
--
-- 🔴 NO SE TOCA EL LIBRO. Los asientos viejos fueron a 200003 y ahí quedan; el
--    backfill pone 200003 justamente para que nada de lo existente cambie.
-- 🔴 VA JUNTO CON EL CÓDIGO: el alta de una tasa sin cuenta falla (NOT NULL).
--    El código de esta entrega la manda; el de antes no.
--
-- IDEMPOTENCIA: ADD COLUMN IF NOT EXISTS, backfill sólo de NULL, funciones
--               CREATE OR REPLACE, el parche detecta la segunda corrida.
-- 🛑 SOLO STAGING hasta la ventana del despliegue. Depende de la 066 y la 072.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. La columna, el backfill y el NOT NULL
-- ----------------------------------------------------------------------------
ALTER TABLE public.tax_codes ADD COLUMN IF NOT EXISTS account_code text;

DO $$
DECLARE
  v_sin_200003 text;
  v_n int;
BEGIN
  -- Un bufete con tasas y SIN 200003 en su plan no se puede rellenar a ciegas.
  SELECT string_agg(DISTINCT t.tenant_id::text, ', ') INTO v_sin_200003
    FROM public.tax_codes t
   WHERE t.account_code IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.chart_of_accounts c
                      WHERE c.tenant_id = t.tenant_id AND c.code = '200003');
  IF v_sin_200003 IS NOT NULL THEN
    RAISE EXCEPTION '073: bufete(s) con tasas y sin la cuenta 200003 en su plan: %. Definir la cuenta de cada tasa a mano antes de seguir.', v_sin_200003;
  END IF;

  UPDATE public.tax_codes SET account_code = '200003' WHERE account_code IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE '073 · % tasa(s) con la cuenta 200003 (la que ya usaban)', v_n;
END $$;

ALTER TABLE public.tax_codes ALTER COLUMN account_code SET NOT NULL;

COMMENT ON COLUMN public.tax_codes.account_code IS
  'Cuenta del impuesto de esta tasa (073, Josuarth P-6a): la misma para ventas (haber) y compras (debe). Activa, de pasivo o activo y no cuenta control. Una vez usada la tasa no cambia: se desactiva y se crea otra.';

-- ----------------------------------------------------------------------------
-- 2. Las reglas de la cuenta
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finanzas_tax_code_cuenta()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cta record;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.account_code IS NOT DISTINCT FROM OLD.account_code THEN
    RETURN NEW;
  END IF;

  SELECT code, account_type, active, cuenta_control INTO v_cta
    FROM public.chart_of_accounts
   WHERE tenant_id = NEW.tenant_id AND code = btrim(NEW.account_code);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La cuenta % no existe en el plan de cuentas.', NEW.account_code
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT v_cta.active THEN
    RAISE EXCEPTION 'La cuenta % está desactivada en el plan de cuentas.', NEW.account_code
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_cta.account_type NOT IN ('liability', 'asset') THEN
    RAISE EXCEPTION 'La cuenta de un impuesto tiene que ser de pasivo o de activo; la % no lo es.', NEW.account_code
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_cta.cuenta_control IS NOT NULL THEN
    RAISE EXCEPTION 'La cuenta % es de clientes o de proveedores: no puede recibir el impuesto.', NEW.account_code
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.account_code := btrim(NEW.account_code);

  IF TG_OP = 'UPDATE' AND (
       EXISTS (SELECT 1 FROM public.invoice_lines      WHERE tax_code_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.expense_lines      WHERE tax_code_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.credit_note_lines  WHERE tax_code_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.quote_lines        WHERE tax_code_id = OLD.id)
  ) THEN
    RAISE EXCEPTION 'La tasa % ya se usó en documentos: su cuenta no se cambia. Desactívala y crea una tasa nueva con la otra cuenta.', OLD.code
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_tax_code_cuenta ON public.tax_codes;
CREATE TRIGGER trg_tax_code_cuenta
  BEFORE INSERT OR UPDATE OF account_code ON public.tax_codes
  FOR EACH ROW EXECUTE FUNCTION public.finanzas_tax_code_cuenta();

-- ----------------------------------------------------------------------------
-- 3. La NC de compra verifica contra la cuenta de cada tasa (parche)
-- ----------------------------------------------------------------------------
DO $parche$
DECLARE
  c_fn CONSTANT text := 'public.create_supplier_credit_note(uuid,uuid,text,date,text,text,date,jsonb,jsonb,uuid)';
  c_viejo CONSTANT text := 'x->>''account_code'' = ''200003''';
  c_nuevo CONSTANT text :=
    'x->>''account_code'' IN (SELECT tc.account_code FROM public.expense_lines el '
    'JOIN public.tax_codes tc ON tc.id = el.tax_code_id '
    'WHERE el.business_expense_id = p_business_expense_id '
    'UNION SELECT ''200003'' /* 073: líneas sin tasa, como hasta acá */)';
  v_def text;
  v_n int;
BEGIN
  v_def := pg_get_functiondef(c_fn::regprocedure);
  IF position('073: líneas sin tasa' IN v_def) > 0 THEN
    RAISE NOTICE '073 · la NC de compra ya verificaba por cuenta de tasa';
    RETURN;
  END IF;
  v_n := (length(v_def) - length(replace(v_def, c_viejo, ''))) / length(c_viejo);
  IF v_n <> 1 THEN
    RAISE EXCEPTION '073: en create_supplier_credit_note el texto «%» aparece % vez/veces (se esperaba 1). No se toca nada.', c_viejo, v_n;
  END IF;
  EXECUTE replace(v_def, c_viejo, c_nuevo);
  RAISE NOTICE '073 · NC de compra: el ITBMS se verifica contra la cuenta de cada tasa';
END $parche$;

-- ----------------------------------------------------------------------------
-- 4. Verificación
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM public.tax_codes WHERE account_code IS NULL;
  IF v_n > 0 THEN
    RAISE EXCEPTION '073: % tasa(s) sin cuenta', v_n;
  END IF;

  SELECT count(*) INTO v_n FROM public.tax_codes t
   WHERE NOT EXISTS (SELECT 1 FROM public.chart_of_accounts c
                      WHERE c.tenant_id = t.tenant_id AND c.code = t.account_code);
  IF v_n > 0 THEN
    RAISE EXCEPTION '073: % tasa(s) apuntan a una cuenta que no existe', v_n;
  END IF;

  IF position('073: líneas sin tasa' IN pg_get_functiondef(
       'public.create_supplier_credit_note(uuid,uuid,text,date,text,text,date,jsonb,jsonb,uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '073: la NC de compra no quedó verificando por cuenta de tasa';
  END IF;

  SELECT count(*) INTO v_n FROM pg_trigger WHERE tgname = 'trg_tax_code_cuenta' AND NOT tgisinternal;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '073: falta el trigger trg_tax_code_cuenta';
  END IF;

  RAISE NOTICE '073 ✅ cada tasa con su cuenta (backfill 200003), reglas de la cuenta y NC de compra por cuenta de tasa';
END $$;

COMMIT;
