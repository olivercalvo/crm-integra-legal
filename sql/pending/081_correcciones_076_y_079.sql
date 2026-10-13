-- ============================================================================
-- 081 · CORRECCIONES DE LA 076 Y LA 079 (encontradas por su verificación)
-- ============================================================================
-- La 076 y la 079 ya están aplicadas en staging, así que no se corrigen en su
-- lugar: esta migración las arregla. En producción va inmediatamente después
-- de la 080, en la misma ventana.
--
--   1. `create_supplier_credit_note` (076) fallaba en una NC SIN compra con
--      «record "v_compra" is not assigned yet»: leía campos del record de la
--      compra detrás de un AND y de un CASE, y plpgsql los evalúa igual. La
--      compra pasa a variables escalares. Es la misma trampa que la 075 y que
--      la línea de la compra en la propia 076; esas dos ya estaban resueltas.
--      La NC CON compra nunca falló.
--
--   2. El CHECK `coa_subcategoria_por_tipo` (079) dejaba pasar una cuenta
--      ACTIVA con subcategoría NULL: `NULL IN (…)` es NULL, y un CHECK con NULL
--      pasa (la misma lección que la 061 → 064). Se agrega
--      `subcategoria IS NOT NULL`. Ninguna cuenta real de staging estaba así;
--      la verificación de la 079 lo encontró insertando una de prueba.
--
-- 🛡️ Sólo staging hasta el «aplica» de Oliver.
-- ============================================================================
BEGIN;

-- ── 1. create_supplier_credit_note sin record de la compra ────────────────
CREATE OR REPLACE FUNCTION public.create_supplier_credit_note(
  p_tenant_id           uuid,
  p_business_expense_id uuid,      -- opcional
  p_supplier_id         uuid,      -- obligatorio sin compra; con compra, el de la compra
  p_doc_numero          text,
  p_doc_fecha           date,
  p_doc_cufe            text,
  p_reason              text,
  p_issue_date          date,      -- fecha de REGISTRO, elegida
  p_lineas              jsonb,     -- [{expense_line_id?, chart_account_code, description, amount, tax_code_id?, tax_amount}]
  p_asiento             jsonb,
  p_created_by          uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- 081: la compra en ESCALARES. Con un record, una NC sin compra fallaba al
  -- leer el saldo y la descripción de un record sin asignar,
  -- aunque esas lecturas estaban detrás de un AND y de un CASE.
  v_c_desc      text;
  v_c_prov      uuid;
  v_c_saldo     numeric(12,2);
  v_cuenta      record;
  v_tasa        record;
  v_x           jsonb;
  v_proveedor   uuid;
  v_prov_nombre text;
  v_sub         numeric(12,2) := 0;
  v_tax         numeric(12,2) := 0;
  v_monto       numeric(12,2);
  v_tax_linea   numeric(12,2);
  v_tax_sugerido numeric(12,2);
  v_tasa_rate   numeric(5,4);
  v_tasa_cuenta text;
  v_tax_code    uuid;
  v_el_id       uuid;
  v_desc_linea  text;
  v_cod_cuenta  text;
  v_acreditado  numeric(12,2);
  v_tax_acred   numeric(12,2);
  -- La línea de la compra, en ESCALARES: leer un campo de un record sin asignar
  -- falla en plpgsql aunque esté detrás de un AND.
  v_l_orden     int;
  v_l_desc      text;
  v_l_cuenta    text;
  v_l_amount    numeric(12,2);
  v_l_tax       numeric(12,2);
  v_l_tax_code  uuid;
  v_l_rate      numeric(5,4);
  v_orden       int := 0;
  v_dif         int;
  v_seq         int;
  v_numero      text;
  v_nc_id       uuid;
  v_entry_id    uuid;
  v_entry_nro   bigint;
  v_desc        text;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'create_supplier_credit_note: falta el bufete';
  END IF;
  IF coalesce(char_length(btrim(p_reason)), 0) < 3 THEN
    RAISE EXCEPTION 'El motivo de la nota de crédito necesita al menos 3 caracteres.';
  END IF;
  IF coalesce(char_length(btrim(p_doc_numero)), 0) = 0 THEN
    RAISE EXCEPTION 'Falta el número del documento del proveedor.';
  END IF;
  IF p_issue_date IS NULL THEN
    RAISE EXCEPTION 'La nota de crédito de proveedor necesita una fecha de registro (la elige el contador, en un período abierto).';
  END IF;
  IF p_lineas IS NULL OR jsonb_typeof(p_lineas) <> 'array' OR jsonb_array_length(p_lineas) = 0 THEN
    RAISE EXCEPTION 'La nota de crédito necesita al menos una línea con monto.';
  END IF;

  -- El documento de origen (opcional), BLOQUEADO: dos NC a la vez no pueden
  -- pasarse del saldo.
  IF p_business_expense_id IS NOT NULL THEN
    SELECT description, supplier_id, balance_due
      INTO v_c_desc, v_c_prov, v_c_saldo
      FROM public.business_expenses
     WHERE tenant_id = p_tenant_id AND id = p_business_expense_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Compra no encontrada.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.journal_entries
                    WHERE tenant_id = p_tenant_id AND source_type = 'gasto' AND source_id = p_business_expense_id) THEN
      RAISE EXCEPTION 'La compra no está registrada en el libro contable: no se le puede aplicar una nota de crédito.';
    END IF;
    IF p_supplier_id IS NOT NULL AND p_supplier_id IS DISTINCT FROM v_c_prov THEN
      RAISE EXCEPTION 'La compra es de otro proveedor.';
    END IF;
    v_proveedor := v_c_prov;
  ELSE
    v_proveedor := p_supplier_id;
  END IF;
  IF v_proveedor IS NULL THEN
    RAISE EXCEPTION 'La nota de crédito acredita Cuentas por pagar (200001), y cada movimiento ahí dice de qué proveedor es: elige el proveedor.';
  END IF;
  SELECT coalesce(nullif(btrim(trade_name), ''), legal_name) INTO v_prov_nombre
    FROM public.suppliers WHERE tenant_id = p_tenant_id AND id = v_proveedor;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proveedor no encontrado.';
  END IF;

  -- PASADA 1: validar cada línea y fijar sus montos, SIN escribir nada.
  CREATE TEMP TABLE IF NOT EXISTS _ncp_lineas (
    orden int, expense_line_id uuid, description text, cuenta text,
    amount numeric(12,2), tax_code_id uuid, tax_rate numeric(5,4),
    tax_amount numeric(12,2), tax_cuenta text
  ) ON COMMIT DROP;
  TRUNCATE _ncp_lineas;

  FOR v_x IN SELECT * FROM jsonb_array_elements(p_lineas) LOOP
    v_monto := round(coalesce((v_x->>'amount')::numeric, 0), 2);
    IF v_monto <= 0 THEN
      RAISE EXCEPTION 'Cada línea de la nota de crédito lleva un monto mayor que cero.';
    END IF;
    v_el_id := nullif(v_x->>'expense_line_id', '')::uuid;
    v_desc_linea := btrim(coalesce(v_x->>'description', ''));
    v_cod_cuenta := btrim(coalesce(v_x->>'chart_account_code', ''));
    v_tax_code := nullif(v_x->>'tax_code_id', '')::uuid;

    v_acreditado := 0;
    v_tax_acred := 0;
    v_l_orden := NULL; v_l_desc := NULL; v_l_cuenta := NULL;
    v_l_amount := NULL; v_l_tax := NULL; v_l_tax_code := NULL; v_l_rate := NULL;
    IF v_el_id IS NOT NULL THEN
      IF p_business_expense_id IS NULL THEN
        RAISE EXCEPTION 'Una línea viene de una compra, pero la nota de crédito no está asociada a ninguna.';
      END IF;
      SELECT line_order, description, chart_account_code, amount, tax_amount, tax_code_id, tax_rate
        INTO v_l_orden, v_l_desc, v_l_cuenta, v_l_amount, v_l_tax, v_l_tax_code, v_l_rate
        FROM public.expense_lines
       WHERE tenant_id = p_tenant_id AND business_expense_id = p_business_expense_id AND id = v_el_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Una línea de la nota de crédito no pertenece a esta compra.';
      END IF;
      SELECT COALESCE(SUM(l.amount), 0), COALESCE(SUM(l.tax_amount), 0) INTO v_acreditado, v_tax_acred
        FROM public.supplier_credit_note_lines l
        JOIN public.supplier_credit_notes n ON n.id = l.credit_note_id
       WHERE l.expense_line_id = v_el_id AND n.status = 'emitida';
      IF v_monto > v_l_amount - v_acreditado THEN
        RAISE EXCEPTION 'Línea % ("%"): se puede acreditar hasta B/. % de base; ya se acreditaron B/. % con otras notas de crédito.',
          v_l_orden, v_l_desc, (v_l_amount - v_acreditado), v_acreditado;
      END IF;
      IF v_desc_linea = '' THEN v_desc_linea := v_l_desc; END IF;
      IF v_cod_cuenta = '' THEN v_cod_cuenta := coalesce(v_l_cuenta, ''); END IF;
    END IF;

    IF char_length(v_desc_linea) < 3 OR char_length(v_desc_linea) > 300 THEN
      RAISE EXCEPTION 'La descripción de cada línea debe tener entre 3 y 300 caracteres.';
    END IF;

    -- La cuenta: activa, que sirva para un gasto (no ingreso, pasivo ni
    -- patrimonio: el mismo predicado que `esTipoValidoParaGasto`) y que no sea
    -- una cuenta control.
    SELECT code, account_type, active, cuenta_control INTO v_cuenta
      FROM public.chart_of_accounts WHERE tenant_id = p_tenant_id AND code = v_cod_cuenta;
    IF NOT FOUND OR NOT v_cuenta.active THEN
      RAISE EXCEPTION 'La cuenta % no existe o está desactivada.', v_cod_cuenta;
    END IF;
    IF v_cuenta.account_type IN ('income', 'equity', 'liability') OR v_cuenta.cuenta_control IS NOT NULL THEN
      RAISE EXCEPTION 'La cuenta % no sirve para una línea de compra.', v_cod_cuenta;
    END IF;

    -- El impuesto. Si la línea viene de la compra con su MISMA tasa, la de la
    -- línea (las anteriores a la 045 no tienen tax_code_id pero sí tax_rate).
    -- Si no, la tasa del catálogo (nunca la del body) y su cuenta (073).
    v_tasa_rate := 0;
    v_tasa_cuenta := NULL;
    IF v_el_id IS NOT NULL AND v_tax_code IS NOT DISTINCT FROM v_l_tax_code THEN
      v_tasa_rate := coalesce(v_l_rate, 0);
      IF v_tax_code IS NOT NULL THEN
        SELECT account_code INTO v_tasa_cuenta FROM public.tax_codes WHERE tenant_id = p_tenant_id AND id = v_tax_code;
      END IF;
    ELSIF v_tax_code IS NOT NULL THEN
      SELECT rate, account_code, active INTO v_tasa
        FROM public.tax_codes WHERE tenant_id = p_tenant_id AND id = v_tax_code;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Una línea tiene un impuesto que no existe en el catálogo.';
      END IF;
      IF NOT v_tasa.active AND v_tax_code IS DISTINCT FROM v_l_tax_code THEN
        RAISE EXCEPTION 'Una línea tiene un impuesto desactivado.';
      END IF;
      v_tasa_rate := v_tasa.rate;
      v_tasa_cuenta := v_tasa.account_code;
    END IF;

    -- Si acredita TODO lo que queda de una línea de la compra con su misma
    -- tasa, el ITBMS es el remanente exacto (el de la compra se cargó con
    -- ±0,02). Si no, el que escribió la persona, con la tolerancia de la compra.
    v_tax_sugerido := round(v_monto * v_tasa_rate, 2);
    IF v_el_id IS NOT NULL AND v_monto = v_l_amount - v_acreditado
       AND v_tax_code IS NOT DISTINCT FROM v_l_tax_code THEN
      v_tax_linea := coalesce(v_l_tax, 0) - v_tax_acred;
    ELSE
      v_tax_linea := round(coalesce((v_x->>'tax_amount')::numeric, v_tax_sugerido), 2);
      IF v_tax_linea < 0 OR abs(v_tax_linea - v_tax_sugerido) > 0.02 THEN
        RAISE EXCEPTION 'El impuesto de la línea "%" (B/. %) no corresponde a su tasa (B/. %).',
          v_desc_linea, v_tax_linea, v_tax_sugerido;
      END IF;
    END IF;
    IF v_tax_linea > 0 AND v_tasa_cuenta IS NULL THEN
      v_tasa_cuenta := '200003';
    END IF;

    v_orden := v_orden + 1;
    INSERT INTO _ncp_lineas VALUES (v_orden, v_el_id, v_desc_linea, v_cod_cuenta,
      v_monto, v_tax_code, v_tasa_rate, v_tax_linea, v_tasa_cuenta);
    v_sub := v_sub + v_monto;
    v_tax := v_tax + v_tax_linea;
  END LOOP;

  -- Tope del documento: lo que falta pagar de la compra (J-3). Sin compra no hay
  -- tope: la NC entera es saldo a favor con el proveedor.
  IF p_business_expense_id IS NOT NULL AND v_sub + v_tax > v_c_saldo THEN
    RAISE EXCEPTION 'La nota de crédito (B/. %) supera lo que falta pagar de esta compra (B/. %). Regístrala sin asociarla a la compra: queda como saldo a favor con el proveedor.',
      (v_sub + v_tax), v_c_saldo;
  END IF;

  -- El asiento que armó la app tiene que ser EXACTAMENTE el que salen de estas
  -- líneas, cuenta por cuenta y lado por lado (generaliza la verificación de
  -- 200001/200003 de la 066 y la 073).
  WITH esperado AS (
    SELECT '200001'::text AS code, round(v_sub + v_tax, 2) AS debit, 0::numeric AS credit
    UNION ALL
    SELECT cuenta, 0, round(SUM(amount), 2) FROM _ncp_lineas GROUP BY cuenta
    UNION ALL
    SELECT tax_cuenta, 0, round(SUM(tax_amount), 2) FROM _ncp_lineas
     WHERE tax_amount > 0 GROUP BY tax_cuenta
  ), esperado_neto AS (
    SELECT code, round(SUM(debit), 2) AS debit, round(SUM(credit), 2) AS credit FROM esperado GROUP BY code
  ), recibido AS (
    SELECT btrim(x->>'account_code') AS code,
           round(SUM(coalesce((x->>'debit')::numeric, 0)), 2) AS debit,
           round(SUM(coalesce((x->>'credit')::numeric, 0)), 2) AS credit
      FROM jsonb_array_elements(p_asiento) x
     GROUP BY btrim(x->>'account_code')
  )
  SELECT count(*) INTO v_dif FROM (
    (SELECT code, debit, credit FROM esperado_neto EXCEPT SELECT code, debit, credit FROM recibido)
    UNION ALL
    (SELECT code, debit, credit FROM recibido EXCEPT SELECT code, debit, credit FROM esperado_neto)
  ) d;
  IF v_dif > 0 THEN
    RAISE EXCEPTION 'El asiento no coincide con la nota de crédito (cuentas o montos distintos). No se registró nada.';
  END IF;

  -- PASADA 2: escribir. El número dentro de la transacción: si algo falla
  -- después, también se deshace y no queda hueco.
  v_seq := public.get_next_sequence_number(p_tenant_id, 'supplier_credit_note');
  v_numero := 'NC-CO-' || lpad(v_seq::text, 6, '0');

  INSERT INTO public.supplier_credit_notes (
    tenant_id, credit_note_number, business_expense_id, supplier_id,
    supplier_document_number, supplier_document_date, supplier_cufe,
    issue_date, reason, status, subtotal_total, tax_total, grand_total, created_by)
  VALUES (p_tenant_id, v_numero, p_business_expense_id, v_proveedor,
    btrim(p_doc_numero), p_doc_fecha, nullif(btrim(coalesce(p_doc_cufe, '')), ''),
    p_issue_date, btrim(p_reason), 'emitida', v_sub, v_tax, v_sub + v_tax, p_created_by)
  RETURNING id INTO v_nc_id;

  INSERT INTO public.supplier_credit_note_lines (
    tenant_id, credit_note_id, expense_line_id, line_order, description,
    chart_account_code, amount, tax_rate, tax_amount, tax_code_id)
  SELECT p_tenant_id, v_nc_id, expense_line_id, orden, description, cuenta, amount,
         tax_rate, tax_amount, tax_code_id
    FROM _ncp_lineas ORDER BY orden;

  v_desc := format('Nota de crédito de proveedor %s: %s, %s (documento del proveedor %s)',
    v_numero,
    CASE WHEN p_business_expense_id IS NOT NULL THEN 'compra ' || v_c_desc ELSE 'sin compra asociada' END,
    v_prov_nombre, btrim(p_doc_numero));

  v_entry_id := public.post_journal_entry(
    p_tenant_id, p_issue_date, v_desc, 'nota_credito_proveedor', p_asiento,
    v_nc_id, NULL, NULL, NULL, p_created_by, NULL, v_numero, 'nota-credito-proveedor:' || v_nc_id::text,
    btrim(p_doc_numero)
  );
  SELECT entry_number INTO v_entry_nro FROM public.journal_entries WHERE id = v_entry_id;

  RETURN jsonb_build_object(
    'id', v_nc_id, 'credit_note_number', v_numero,
    'subtotal', v_sub, 'tax', v_tax, 'total', v_sub + v_tax,
    'entry_id', v_entry_id, 'entry_number', v_entry_nro
  );
END $$;

REVOKE ALL ON FUNCTION public.create_supplier_credit_note(uuid, uuid, uuid, text, date, text, text, date, jsonb, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_supplier_credit_note(uuid, uuid, uuid, text, date, text, text, date, jsonb, jsonb, uuid) TO service_role;

-- ── 2. El CHECK de subcategoría sin el hueco del NULL ─────────────────────
ALTER TABLE public.chart_of_accounts DROP CONSTRAINT IF EXISTS coa_subcategoria_por_tipo;
ALTER TABLE public.chart_of_accounts
  ADD CONSTRAINT coa_subcategoria_por_tipo CHECK (
    active = false
    OR (subcategoria IS NOT NULL AND (
         (account_type = 'asset'     AND subcategoria IN ('activo_corriente', 'activo_no_corriente', 'propiedad_planta_equipo', 'otro'))
      OR (account_type = 'liability' AND subcategoria IN ('pasivo_corriente', 'pasivo_no_corriente', 'otro'))
      OR (account_type = 'equity'    AND subcategoria IN ('capital_social', 'resultados_acumulados', 'otras_reservas'))
      OR (account_type = 'income'    AND subcategoria IN ('ingresos_operativos', 'ingresos_inversion', 'ingresos_financiamiento'))
      OR (account_type = 'cost'      AND subcategoria IN ('costos_operativos', 'costos_inversion', 'costos_financiamiento'))
      OR (account_type = 'expense'   AND subcategoria IN ('gastos_operativos', 'gastos_inversion', 'gastos_financiamiento'))
    ))
  );

-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE
  v_def text;
BEGIN
  v_def := pg_get_functiondef('public.create_supplier_credit_note(uuid,uuid,uuid,text,date,text,text,date,jsonb,jsonb,uuid)'::regprocedure);
  IF position('v_compra' IN v_def) > 0 THEN
    RAISE EXCEPTION '081: create_supplier_credit_note sigue usando el record de la compra';
  END IF;
  IF has_function_privilege('authenticated', 'public.create_supplier_credit_note(uuid,uuid,uuid,text,date,text,text,date,jsonb,jsonb,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '081: create_supplier_credit_note quedó ejecutable por la sesión del usuario';
  END IF;
  IF position('subcategoria IS NOT NULL' IN (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'coa_subcategoria_por_tipo')) = 0 THEN
    RAISE EXCEPTION '081: el CHECK de subcategoría sigue dejando pasar NULL';
  END IF;
  RAISE NOTICE '081 ✅ NC de proveedor sin compra y CHECK de subcategoría sin el hueco del NULL';
END $$;

COMMIT;
