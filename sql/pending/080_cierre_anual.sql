-- ============================================================================
-- 080 — Cierre anual del ejercicio (Bloque 1, E11, decisión 15, punto 11)
-- ============================================================================
-- Un asiento automático `source_type = 'cierre'` (módulo CA, ya permitido por
-- el CHECK desde la 071; el motor le pone el número AD-) con fecha 31/12 del
-- año, que lleva a CERO las cuentas de resultado (ingreso, costo y gasto)
-- contra 300002 (resultados acumulados; P-11a: Josuarth confirma la cuenta y
-- quizá su nombre, hoy «Perdida Retenidas»).
--
-- Tres piezas:
--
--   1. finanzas_saldos_de_resultado(tenant, año): el saldo del AÑO de cada
--      cuenta de resultado. Es LA regla, y la usan la vista previa y el RPC:
--        · Σ (débito − crédito) de las líneas con fecha de registro en el año,
--          SIN los asientos de cierre ni las reversiones de un cierre;
--        · + el saldo de apertura de la cuenta (`chart_of_accounts.saldo_inicial`)
--          si su fecha cae en el año, o antes y todavía no la cerró ningún
--          cierre anterior, y no hay un asiento de apertura vigente (E7: con
--          apertura en el libro, los loaders dejan de leer `saldo_inicial`).
--
--   2. close_fiscal_year(tenant, año, líneas, usuario): VERIFICA las líneas que
--      armó la app (`contabilidad/cierre-anual.ts`, la misma función que dibuja
--      la vista previa) contra las suyas y postea por post_journal_entry. Reglas:
--        · uno VIGENTE por año (candado de advisory lock + verificación: el
--          índice no ve la reversión, así que un índice único impediría volver
--          a cerrar después de reversar);
--        · los años se cierran EN ORDEN: no se cierra 2027 si 2026 tiene
--          movimientos de resultado sin cierre (si no, quedarían en las cuentas
--          de resultado para siempre);
--        · el período de diciembre tiene que estar abierto (lo exige el motor);
--        · 300002 tiene que existir y estar activa.
--      EXECUTE sólo para service_role (SOP-014): la ruta saca el tenant del perfil.
--
--   3. reverse_journal_entry acepta también 'cierre' (parche sobre su
--      definición vigente). Se reversa como un asiento manual: espejo verificado,
--      fecha de registro elegida, nunca antes del original. Reversado, el año se
--      puede volver a cerrar.
--
-- No toca asientos existentes. El Estado de Resultado excluye los asientos de
-- cierre en la app (`excluirCierre` del loader), no en la base.
-- ============================================================================
BEGIN;

-- ── 1. El saldo del año de cada cuenta de resultado ────────────────────────
CREATE OR REPLACE FUNCTION public.finanzas_saldos_de_resultado(p_tenant_id uuid, p_anio int)
RETURNS TABLE (account_code text, account_name text, account_type text, saldo numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH limites AS (
    SELECT make_date(p_anio, 1, 1) AS desde, make_date(p_anio, 12, 31) AS hasta
  ),
  cierres AS (
    -- Asientos de cierre del bufete y las reversiones que los anulan.
    SELECT je.id FROM public.journal_entries je
     WHERE je.tenant_id = p_tenant_id AND je.source_type = 'cierre'
    UNION
    SELECT rv.id FROM public.journal_entries rv
      JOIN public.journal_entries orig ON orig.id = rv.reverses_entry_id
     WHERE rv.tenant_id = p_tenant_id AND orig.source_type = 'cierre'
  ),
  ultimo_cierre_previo AS (
    -- El último cierre VIGENTE de un año anterior: lo que va hasta su fecha ya
    -- quedó cerrado.
    SELECT max(je.transaction_date) AS fecha
      FROM public.journal_entries je, limites l
     WHERE je.tenant_id = p_tenant_id AND je.source_type = 'cierre'
       AND je.transaction_date < l.desde
       AND NOT EXISTS (SELECT 1 FROM public.journal_entries rv
                        WHERE rv.tenant_id = p_tenant_id AND rv.reverses_entry_id = je.id)
  ),
  hay_apertura AS (
    SELECT EXISTS (
      SELECT 1 FROM public.journal_entries ap
       WHERE ap.tenant_id = p_tenant_id AND ap.source_type = 'apertura'
         AND NOT EXISTS (SELECT 1 FROM public.journal_entries rv
                          WHERE rv.tenant_id = p_tenant_id AND rv.reverses_entry_id = ap.id)
    ) AS si
  ),
  movimientos AS (
    SELECT jl.account_id, sum(jl.debit - jl.credit) AS neto
      FROM public.journal_entry_lines jl
      JOIN public.journal_entries je ON je.id = jl.entry_id
      CROSS JOIN limites l
     WHERE je.tenant_id = p_tenant_id
       AND je.transaction_date BETWEEN l.desde AND l.hasta
       AND je.id NOT IN (SELECT c.id FROM cierres c)
     GROUP BY jl.account_id
  )
  SELECT coa.code, coa.name, coa.account_type,
         round(
           coalesce(m.neto, 0)
           + CASE
               WHEN NOT (SELECT si FROM hay_apertura)
                AND coa.saldo_inicial_fecha IS NOT NULL
                AND coa.saldo_inicial_fecha <= (SELECT hasta FROM limites)
                AND coa.saldo_inicial_fecha > coalesce((SELECT fecha FROM ultimo_cierre_previo), '-infinity'::date)
               THEN coalesce(coa.saldo_inicial, 0)
               ELSE 0
             END,
           2) AS saldo
    FROM public.chart_of_accounts coa
    LEFT JOIN movimientos m ON m.account_id = coa.id
   WHERE coa.tenant_id = p_tenant_id
     AND coa.account_type IN ('income', 'cost', 'expense');
$$;

COMMENT ON FUNCTION public.finanzas_saldos_de_resultado(uuid, int) IS
  '080: saldo del AÑO de cada cuenta de resultado (balanza), sin cierres ni sus reversiones, más la apertura de la cuenta que todavía no cerró ningún cierre. La usan la vista previa y close_fiscal_year.';

REVOKE ALL ON FUNCTION public.finanzas_saldos_de_resultado(uuid, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finanzas_saldos_de_resultado(uuid, int) TO service_role;

-- ── 2. El RPC del cierre ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.close_fiscal_year(
  p_tenant_id  uuid,
  p_anio       int,
  p_lines      jsonb,
  p_created_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_cuenta   CONSTANT text := '300002';
  v_desde    date;
  v_hasta    date;
  v_ya_nro   bigint;
  v_pend     int;
  v_neto     numeric(14,2);
  v_dif      int;
  v_entry_id uuid;
  v_entry_nro bigint;
  v_ref      text;
BEGIN
  IF p_tenant_id IS NULL OR p_anio IS NULL OR p_anio < 2000 OR p_anio > 2100 THEN
    RAISE EXCEPTION 'close_fiscal_year: faltan el bufete o un año válido';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) < 2 THEN
    RAISE EXCEPTION 'El cierre necesita al menos dos líneas.';
  END IF;
  v_desde := make_date(p_anio, 1, 1);
  v_hasta := make_date(p_anio, 12, 31);

  -- Dos cierres del mismo año a la vez: el segundo espera y después ve el primero.
  PERFORM pg_advisory_xact_lock(hashtextextended('cierre:' || p_tenant_id::text || ':' || p_anio::text, 0));

  -- Uno VIGENTE por año.
  SELECT je.entry_number INTO v_ya_nro
    FROM public.journal_entries je
   WHERE je.tenant_id = p_tenant_id AND je.source_type = 'cierre' AND je.transaction_date = v_hasta
     AND NOT EXISTS (SELECT 1 FROM public.journal_entries rv
                      WHERE rv.tenant_id = p_tenant_id AND rv.reverses_entry_id = je.id)
   LIMIT 1;
  IF v_ya_nro IS NOT NULL THEN
    RAISE EXCEPTION 'El ejercicio % ya está cerrado (asiento %). Para volver a cerrarlo, reversa ese asiento primero.', p_anio, v_ya_nro;
  END IF;

  -- En orden: nada de resultado del año anterior sin cerrar.
  SELECT count(*) INTO v_pend
    FROM public.finanzas_saldos_de_resultado(p_tenant_id, p_anio - 1) s
   WHERE abs(s.saldo) >= 0.005;
  IF v_pend > 0 AND NOT EXISTS (
       SELECT 1 FROM public.journal_entries je
        WHERE je.tenant_id = p_tenant_id AND je.source_type = 'cierre'
          AND je.transaction_date = make_date(p_anio - 1, 12, 31)
          AND NOT EXISTS (SELECT 1 FROM public.journal_entries rv
                           WHERE rv.tenant_id = p_tenant_id AND rv.reverses_entry_id = je.id)) THEN
    RAISE EXCEPTION 'Primero hay que cerrar el ejercicio %: tiene % cuenta(s) de resultado con saldo sin cerrar.', p_anio - 1, v_pend;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.chart_of_accounts
                  WHERE tenant_id = p_tenant_id AND code = c_cuenta AND active AND account_type = 'equity') THEN
    RAISE EXCEPTION 'Falta la cuenta % (resultados acumulados) activa en el plan de cuentas.', c_cuenta;
  END IF;

  -- Las líneas se VERIFICAN, no se recalculan (patrón de la reversión).
  SELECT coalesce(sum(s.saldo), 0) INTO v_neto
    FROM public.finanzas_saldos_de_resultado(p_tenant_id, p_anio) s;
  WITH esperado AS (
    SELECT s.account_code AS code,
           CASE WHEN s.saldo < 0 THEN -s.saldo ELSE 0 END AS debit,
           CASE WHEN s.saldo > 0 THEN s.saldo ELSE 0 END AS credit
      FROM public.finanzas_saldos_de_resultado(p_tenant_id, p_anio) s
     WHERE abs(s.saldo) >= 0.005
    UNION ALL
    SELECT c_cuenta,
           CASE WHEN v_neto > 0 THEN v_neto ELSE 0 END,
           CASE WHEN v_neto < 0 THEN -v_neto ELSE 0 END
     WHERE abs(v_neto) >= 0.005
  ), recibido AS (
    SELECT btrim(x->>'account_code') AS code,
           round(coalesce((x->>'debit')::numeric, 0), 2) AS debit,
           round(coalesce((x->>'credit')::numeric, 0), 2) AS credit
      FROM jsonb_array_elements(p_lines) x
  )
  SELECT count(*) INTO v_dif
    FROM (
      (SELECT code, debit, credit FROM esperado EXCEPT ALL SELECT code, debit, credit FROM recibido)
      UNION ALL
      (SELECT code, debit, credit FROM recibido EXCEPT ALL SELECT code, debit, credit FROM esperado)
    ) d;
  IF v_dif > 0 THEN
    RAISE EXCEPTION 'Las líneas del cierre de % no coinciden con los saldos del año en el libro (% diferencia(s)). Vuelve a abrir la vista previa: algo se registró mientras tanto.', p_anio, v_dif;
  END IF;

  v_entry_id := public.post_journal_entry(
    p_tenant_id, v_hasta, 'Cierre del ejercicio ' || p_anio::text, 'cierre', p_lines,
    NULL, NULL, NULL, NULL, p_created_by, NULL, NULL, NULL, NULL
  );
  SELECT entry_number, reference INTO v_entry_nro, v_ref FROM public.journal_entries WHERE id = v_entry_id;

  RETURN jsonb_build_object(
    'entry_id', v_entry_id, 'entry_number', v_entry_nro, 'reference', v_ref,
    'transaction_date', v_hasta, 'anio', p_anio
  );
END $$;

COMMENT ON FUNCTION public.close_fiscal_year(uuid, int, jsonb, uuid) IS
  '080: cierre anual. Verifica las líneas contra finanzas_saldos_de_resultado y postea un asiento cierre al 31/12 contra 300002. Uno vigente por año, en orden.';

REVOKE ALL ON FUNCTION public.close_fiscal_year(uuid, int, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_fiscal_year(uuid, int, jsonb, uuid) TO service_role;

-- ── 3. reverse_journal_entry acepta también 'cierre' (parche) ──────────────
DO $parche$
DECLARE
  c_fn    CONSTANT text := 'public.reverse_journal_entry(uuid,uuid,text,date,text,jsonb,uuid)';
  c_viejo CONSTANT text := 'IF v_source_type <> ''manual'' THEN';
  c_nuevo CONSTANT text := 'IF v_source_type NOT IN (''manual'', ''cierre'') /* 080: cierre anual */ THEN';
  v_def text;
  v_n   int;
BEGIN
  v_def := pg_get_functiondef(c_fn::regprocedure);
  IF position('080: cierre anual' IN v_def) > 0 THEN
    RAISE NOTICE '080 · reverse_journal_entry ya aceptaba el cierre';
    RETURN;
  END IF;
  v_n := (length(v_def) - length(replace(v_def, c_viejo, ''))) / length(c_viejo);
  IF v_n <> 1 THEN
    RAISE EXCEPTION '080: en reverse_journal_entry el texto «%» aparece % vez/veces (se esperaba 1). No se toca nada.', c_viejo, v_n;
  END IF;
  EXECUTE replace(v_def, c_viejo, c_nuevo);
  RAISE NOTICE '080 · reverse_journal_entry acepta manual y cierre';
END $parche$;

-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE
  v_def text;
BEGIN
  IF to_regprocedure('public.close_fiscal_year(uuid,integer,jsonb,uuid)') IS NULL THEN
    RAISE EXCEPTION '080: falta close_fiscal_year';
  END IF;
  IF has_function_privilege('authenticated', 'public.close_fiscal_year(uuid,integer,jsonb,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '080: close_fiscal_year no puede ser ejecutable por la sesión del usuario';
  END IF;
  IF has_function_privilege('authenticated', 'public.finanzas_saldos_de_resultado(uuid,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION '080: finanzas_saldos_de_resultado no puede ser ejecutable por la sesión del usuario';
  END IF;
  v_def := pg_get_functiondef('public.reverse_journal_entry(uuid,uuid,text,date,text,jsonb,uuid)'::regprocedure);
  IF position('080: cierre anual' IN v_def) = 0 THEN
    RAISE EXCEPTION '080: reverse_journal_entry no quedó parcheado';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'journal_entries_source_type_check'
                    AND pg_get_constraintdef(oid) LIKE '%cierre%') THEN
    RAISE EXCEPTION '080: el CHECK de source_type no admite cierre (falta la 071)';
  END IF;
  RAISE NOTICE '080 ✅ cierre anual listo (close_fiscal_year, finanzas_saldos_de_resultado, reversión)';
END $$;

COMMIT;
