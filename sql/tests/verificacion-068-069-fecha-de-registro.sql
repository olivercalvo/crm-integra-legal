-- ============================================================================
-- VERIFICACIÓN de la 068 y la 069 — la fecha de registro (Bloque 1, E1).
-- 🛡️ TODO DENTRO DE UN ROLLBACK. No deja asientos, no cierra períodos, no
--    consume correlativo.
--
--   node scripts/run-sql.mjs sql/tests/verificacion-068-069-fecha-de-registro.sql
--
-- Seis comprobaciones:
--   [1] las cuatro tablas tienen accounting_date NOT NULL
--   [2] una factura emitida NO mueve su fecha de registro (T4)
--   [3] una reversión con fecha ELEGIDA (no hoy) se acepta
--   [4] una reversión anterior al original se rechaza
--   [5] una reversión en un período CERRADO se rechaza
--   [6] el INSERT sin fecha de registro toma la del documento (trigger 068)
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_tenant  uuid := 'a0000000-0000-0000-0000-000000000001';
  v_user    uuid;
  v_cli     uuid;
  v_ini     date := date_trunc('month', current_date)::date;  -- 1º del mes en curso
  v_orig    uuid;
  v_espejo  jsonb;
  v_res     jsonb;
  v_fac     uuid;
  v_n       int;
  v_err     text;
  v_fecha   date;
  v_ok      int := 0;
  v_fail    int := 0;
BEGIN
  SELECT id INTO v_user FROM users   WHERE tenant_id = v_tenant ORDER BY created_at LIMIT 1;
  SELECT id INTO v_cli  FROM clients WHERE tenant_id = v_tenant ORDER BY created_at LIMIT 1;

  -- [1] Las columnas.
  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema = 'public' AND column_name = 'accounting_date' AND is_nullable = 'NO'
     AND table_name IN ('invoices', 'business_expenses', 'expenses', 'credit_notes');
  IF v_n = 4 THEN
    RAISE NOTICE '[1] accounting_date NOT NULL en 4 tablas ........ ✅'; v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[1] accounting_date NOT NULL en 4 tablas ........ ❌ hay %', v_n; v_fail := v_fail + 1;
  END IF;

  -- [2] Una factura emitida no mueve su fecha de registro.
  SELECT id INTO v_fac FROM invoices
   WHERE tenant_id = v_tenant AND status IN ('emitida', 'parcialmente_pagada', 'pagada') LIMIT 1;
  IF v_fac IS NULL THEN
    RAISE NOTICE '[2] factura emitida congelada ................... (sin facturas emitidas: se salta)';
  ELSE
    BEGIN
      UPDATE invoices SET accounting_date = accounting_date + 1 WHERE id = v_fac;
      RAISE NOTICE '[2] factura emitida congelada ................... ❌ PASÓ (debía fallar)'; v_fail := v_fail + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE '[2] factura emitida congelada ................... ✅ RECHAZADO'; v_ok := v_ok + 1;
    END;
  END IF;

  -- Un asiento manual propio, con fecha del 1º del mes (período abierto).
  v_orig := post_journal_entry(v_tenant, v_ini, 'Verificación 068/069, original', 'manual',
    jsonb_build_array(
      jsonb_build_object('account_code','100004','debit',10,'credit',0,'description','CxC','client_id',v_cli),
      jsonb_build_object('account_code','200001','debit',0,'credit',10,'description','CxP')
    ), NULL, NULL, NULL, NULL, v_user, NULL, 'VER-068', NULL);
  SELECT jsonb_agg(jsonb_build_object('account_code', c.code, 'debit', l.credit, 'credit', l.debit, 'description', 'Reversión')
                   ORDER BY l.line_order)
    INTO v_espejo
    FROM journal_entry_lines l JOIN chart_of_accounts c ON c.id = l.account_id
   WHERE l.entry_id = v_orig;

  -- [4] Antes del original → rechazado (se prueba antes que [3]: un asiento se reversa una vez).
  BEGIN
    PERFORM reverse_journal_entry(v_tenant, v_orig, 'Verificación 068/069', v_ini - 1, 'Reversión', v_espejo, v_user);
    RAISE NOTICE '[4] anterior al original ........................ ❌ PASÓ (debía fallar)'; v_fail := v_fail + 1;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err LIKE '%no puede ser anterior al asiento que revierte%' THEN
      RAISE NOTICE '[4] anterior al original ........................ ✅ RECHAZADO'; v_ok := v_ok + 1;
    ELSE
      RAISE NOTICE '[4] anterior al original ........................ ❌ falló por otra cosa: %', v_err; v_fail := v_fail + 1;
    END IF;
  END;

  -- [5] Período cerrado → rechazado. Se cierra el mes DENTRO de la transacción
  --     (el ROLLBACK lo deja como estaba) y se intenta reversar con esa fecha.
  UPDATE accounting_periods SET status = 'cerrado'
   WHERE tenant_id = v_tenant
     AND year = EXTRACT(YEAR FROM v_ini)::int AND month = EXTRACT(MONTH FROM v_ini)::int;
  BEGIN
    PERFORM reverse_journal_entry(v_tenant, v_orig, 'Verificación 068/069', v_ini, 'Reversión', v_espejo, v_user);
    RAISE NOTICE '[5] período cerrado ............................. ❌ PASÓ (debía fallar)'; v_fail := v_fail + 1;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err ILIKE '%CERRADO%' THEN
      RAISE NOTICE '[5] período cerrado ............................. ✅ RECHAZADO'; v_ok := v_ok + 1;
    ELSE
      RAISE NOTICE '[5] período cerrado ............................. ❌ falló por otra cosa: %', v_err; v_fail := v_fail + 1;
    END IF;
  END;
  UPDATE accounting_periods SET status = 'abierto'
   WHERE tenant_id = v_tenant
     AND year = EXTRACT(YEAR FROM v_ini)::int AND month = EXTRACT(MONTH FROM v_ini)::int;

  -- [3] Fecha ELEGIDA, que no es hoy (el 1º del mes): hasta la 069 se rechazaba.
  BEGIN
    v_res := reverse_journal_entry(v_tenant, v_orig, 'Verificación 068/069', v_ini, 'Reversión', v_espejo, v_user);
    SELECT transaction_date INTO v_fecha FROM journal_entries WHERE reverses_entry_id = v_orig;
    IF v_fecha = v_ini THEN
      RAISE NOTICE '[3] fecha elegida (%) ................... ✅ ACEPTADA', v_ini; v_ok := v_ok + 1;
    ELSE
      RAISE NOTICE '[3] fecha elegida ............................... ❌ quedó con %', v_fecha; v_fail := v_fail + 1;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    RAISE NOTICE '[3] fecha elegida ............................... ❌ RECHAZADA: %', v_err; v_fail := v_fail + 1;
  END;

  -- [6] El valor por defecto: una NC sin accounting_date toma su issue_date.
  --     Se verifica la definición del trigger, sin insertar una NC real: una NC
  --     necesita factura, líneas y correlativo, y ninguna prueba vale eso.
  SELECT count(*) INTO v_n FROM pg_trigger
   WHERE NOT tgisinternal AND tgname = 'trg_credit_notes_fecha_de_registro'
     AND pg_get_triggerdef(oid) LIKE '%finanzas_fecha_de_registro_por_defecto(''issue_date'')%';
  IF v_n = 1 THEN
    RAISE NOTICE '[6] valor por defecto = fecha del documento ..... ✅'; v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[6] valor por defecto = fecha del documento ..... ❌'; v_fail := v_fail + 1;
  END IF;

  RAISE NOTICE '068/069: % ✅ · % ❌', v_ok, v_fail;
END $$;

ROLLBACK;
