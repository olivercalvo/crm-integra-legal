-- ============================================================================
-- VERIFICACIÓN de la 080 — cierre anual del ejercicio (E11).
-- 🛡️ TODO DENTRO DE UN ROLLBACK: el cierre de prueba, su reversión y el período
--    cerrado se deshacen al final. Corre como el dueño de la base (run-sql.mjs).
--
--   node scripts/run-sql.mjs sql/tests/verificacion-080-cierre-anual.sql
--
--   [1] líneas que NO son las del libro → rechazo, sin asiento
--   [2] cierre de 2026: asiento 'cierre' al 31/12, número AD-, contra 300002
--   [3] después del cierre, las cuentas de resultado quedan en 0 en el año
--       (saldo del año + el asiento de cierre)
--   [4] un segundo cierre del mismo año se rechaza
--   [5] el cierre se reversa con reverse_journal_entry y el año se puede volver
--       a cerrar
--   [6] no se cierra 2027 si 2026 tiene resultado sin cerrar
--   [7] con diciembre cerrado, el motor rechaza el cierre
-- ============================================================================
BEGIN;

CREATE TEMP TABLE _lineas_cierre ON COMMIT DROP AS
SELECT s.account_code, s.saldo FROM public.finanzas_saldos_de_resultado('a0000000-0000-0000-0000-000000000001', 2026) s
 WHERE abs(s.saldo) >= 0.005;

DO $$
DECLARE
  v_tenant uuid := 'a0000000-0000-0000-0000-000000000001';
  v_user   uuid;
  v_lines  jsonb;
  v_malas  jsonb;
  v_neto   numeric;
  v_r      jsonb;
  v_r2     jsonb;
  v_espejo jsonb;
  v_n      int;
  v_ref    text;
  v_ok     int := 0;
  v_fail   int := 0;
BEGIN
  SELECT id INTO v_user FROM public.users WHERE tenant_id = v_tenant ORDER BY created_at LIMIT 1;
  SELECT coalesce(sum(saldo), 0) INTO v_neto FROM _lineas_cierre;

  -- Las líneas que armaría la app (cierre-anual.ts), escritas en SQL para el test.
  SELECT jsonb_agg(jsonb_build_object(
           'account_code', lc.account_code,
           'debit',  CASE WHEN lc.saldo < 0 THEN -lc.saldo ELSE 0 END,
           'credit', CASE WHEN lc.saldo > 0 THEN lc.saldo ELSE 0 END,
           'description', 'Cierre del ejercicio 2026'))
    INTO v_lines FROM _lineas_cierre lc;
  IF abs(v_neto) >= 0.005 THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_code', '300002',
      'debit',  CASE WHEN v_neto > 0 THEN v_neto ELSE 0 END,
      'credit', CASE WHEN v_neto < 0 THEN -v_neto ELSE 0 END,
      'description', 'Cierre del ejercicio 2026'));
  END IF;

  -- [1]
  v_malas := jsonb_build_array(
    jsonb_build_object('account_code', '300002', 'debit', 1, 'credit', 0),
    jsonb_build_object('account_code', '400001', 'debit', 0, 'credit', 1));
  v_n := 0;
  BEGIN
    PERFORM public.close_fiscal_year(v_tenant, 2026, v_malas, v_user);
  EXCEPTION WHEN OTHERS THEN v_n := 1;
  END;
  IF v_n = 1 AND NOT EXISTS (SELECT 1 FROM public.journal_entries WHERE tenant_id = v_tenant AND source_type = 'cierre') THEN
    RAISE NOTICE '[1] líneas que no son las del libro: rechazo .... ✅'; v_ok := v_ok + 1;
  ELSE RAISE NOTICE '[1] líneas ajenas ............................... ❌'; v_fail := v_fail + 1; END IF;

  -- [2]
  v_r := public.close_fiscal_year(v_tenant, 2026, v_lines, v_user);
  SELECT reference INTO v_ref FROM public.journal_entries WHERE id = (v_r->>'entry_id')::uuid;
  IF (v_r->>'transaction_date')::date = '2026-12-31' AND v_ref LIKE 'AD-%'
     AND EXISTS (SELECT 1 FROM public.journal_entries WHERE id = (v_r->>'entry_id')::uuid AND source_type = 'cierre') THEN
    RAISE NOTICE '[2] cierre 2026: asiento % (%) al 31/12 ......... ✅', v_r->>'entry_number', v_ref; v_ok := v_ok + 1;
  ELSE RAISE NOTICE '[2] cierre 2026 ................................. ❌ %', v_r; v_fail := v_fail + 1; END IF;

  -- [3] saldo del año + líneas del cierre = 0 en cada cuenta de resultado
  SELECT count(*) INTO v_n
    FROM _lineas_cierre lc
    JOIN public.chart_of_accounts c ON c.tenant_id = v_tenant AND c.code = lc.account_code
   WHERE abs(lc.saldo + coalesce((
           SELECT sum(jl.debit - jl.credit) FROM public.journal_entry_lines jl
            WHERE jl.entry_id = (v_r->>'entry_id')::uuid AND jl.account_id = c.id), 0)) >= 0.005;
  IF v_n = 0 THEN RAISE NOTICE '[3] cuentas de resultado en 0 después del cierre ✅'; v_ok := v_ok + 1;
  ELSE RAISE NOTICE '[3] % cuenta(s) no quedaron en 0 ................ ❌', v_n; v_fail := v_fail + 1; END IF;

  -- [4]
  v_n := 0;
  BEGIN
    PERFORM public.close_fiscal_year(v_tenant, 2026, v_lines, v_user);
  EXCEPTION WHEN OTHERS THEN v_n := 1;
  END;
  IF v_n = 1 THEN RAISE NOTICE '[4] segundo cierre del mismo año: rechazo ...... ✅'; v_ok := v_ok + 1;
  ELSE RAISE NOTICE '[4] segundo cierre ............................. ❌'; v_fail := v_fail + 1; END IF;

  -- [6] (antes de reversar: 2026 cerrado, 2027 sin nada → 2027 no tiene saldo)
  -- Se prueba al revés: con el cierre 2026 reversado, cerrar 2027 tiene que fallar.

  -- [5] reversar el cierre y volver a cerrar
  SELECT jsonb_agg(jsonb_build_object('account_code', c.code, 'debit', jl.credit, 'credit', jl.debit, 'description', 'Reversión del cierre'))
    INTO v_espejo
    FROM public.journal_entry_lines jl JOIN public.chart_of_accounts c ON c.id = jl.account_id
   WHERE jl.entry_id = (v_r->>'entry_id')::uuid;
  PERFORM public.reverse_journal_entry(v_tenant, (v_r->>'entry_id')::uuid, 'Prueba de la verificación 080',
                                       '2026-12-31', 'Reversión del cierre 2026', v_espejo, v_user);

  v_n := 0;
  BEGIN
    PERFORM public.close_fiscal_year(v_tenant, 2027,
      jsonb_build_array(jsonb_build_object('account_code', '300002', 'debit', 0, 'credit', 0),
                        jsonb_build_object('account_code', '300002', 'debit', 0, 'credit', 0)), v_user);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'Primero hay que cerrar el ejercicio 2026%' THEN v_n := 1; END IF;
  END;
  IF v_n = 1 THEN RAISE NOTICE '[6] 2027 no se cierra con 2026 abierto ......... ✅'; v_ok := v_ok + 1;
  ELSE RAISE NOTICE '[6] cierre en orden ............................ ❌'; v_fail := v_fail + 1; END IF;

  v_r2 := public.close_fiscal_year(v_tenant, 2026, v_lines, v_user);
  IF v_r2->>'entry_id' IS NOT NULL THEN
    RAISE NOTICE '[5] reversado, se vuelve a cerrar (asiento %) ... ✅', v_r2->>'entry_number'; v_ok := v_ok + 1;
  ELSE RAISE NOTICE '[5] reversar y volver a cerrar .................. ❌'; v_fail := v_fail + 1; END IF;

  -- [7] diciembre cerrado: se reversa el último y se cierra el período
  SELECT jsonb_agg(jsonb_build_object('account_code', c.code, 'debit', jl.credit, 'credit', jl.debit, 'description', 'Reversión del cierre'))
    INTO v_espejo
    FROM public.journal_entry_lines jl JOIN public.chart_of_accounts c ON c.id = jl.account_id
   WHERE jl.entry_id = (v_r2->>'entry_id')::uuid;
  PERFORM public.reverse_journal_entry(v_tenant, (v_r2->>'entry_id')::uuid, 'Prueba de la verificación 080',
                                       '2026-12-31', 'Reversión del cierre 2026', v_espejo, v_user);
  UPDATE public.accounting_periods SET status = 'cerrado', closed_at = now(), closed_by = v_user
   WHERE tenant_id = v_tenant AND year = 2026 AND month = 12;
  v_n := 0;
  BEGIN
    PERFORM public.close_fiscal_year(v_tenant, 2026, v_lines, v_user);
  EXCEPTION WHEN OTHERS THEN v_n := 1;
  END;
  IF v_n = 1 THEN RAISE NOTICE '[7] diciembre cerrado: el motor rechaza ........ ✅'; v_ok := v_ok + 1;
  ELSE RAISE NOTICE '[7] diciembre cerrado .......................... ❌'; v_fail := v_fail + 1; END IF;

  RAISE NOTICE '';
  RAISE NOTICE '======== 080: % ok, % fallas (todo se deshace) ========', v_ok, v_fail;
END $$;

ROLLBACK;
