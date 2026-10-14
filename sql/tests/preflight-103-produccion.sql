SELECT
  to_regprocedure('public.corregir_apertura(uuid, uuid, text, jsonb, jsonb, text, uuid)') IS NOT NULL AS tiene_102,
  to_regprocedure('public.post_journal_entry(uuid, date, text, text, jsonb, uuid, text, uuid, text, uuid, date, text, text, text)') IS NOT NULL AS tiene_motor_14_parametros,
  (to_regprocedure('public.get_tenant_id()') IS NOT NULL AND to_regprocedure('public.get_user_role()') IS NOT NULL) AS tiene_helpers_rls,
  (to_regprocedure('public.finanzas_inicio_contable(uuid)') IS NOT NULL AND to_regprocedure('public.ensure_accounting_periods(uuid, integer)') IS NOT NULL) AS tiene_inicio_y_periodos,
  (SELECT count(*) = 3 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'business_expenses'
      AND column_name IN ('accounting_date', 'credited_total', 'purchase_number')) AS compras_con_columnas,
  (SELECT count(*) = 2 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'expense_lines'
      AND column_name IN ('tax_code_id', 'tax_rate')) AS lineas_con_tasa,
  to_regclass('public.supplier_credit_note_applications') IS NOT NULL AS tiene_aplicaciones_nc,
  (SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'journal_entries_un_asiento_por_documento') AS indice_actual,
  to_regclass('public.compra_correcciones') IS NOT NULL AS ya_tiene_103_tabla,
  to_regprocedure('public.corregir_compra(uuid, uuid, uuid, text, jsonb, jsonb, jsonb, jsonb, uuid)') IS NOT NULL AS ya_tiene_103_funcion,
  (SELECT count(*) FROM public.journal_entries) AS asientos_en_el_libro,
  pg_size_pretty(pg_total_relation_size('public.journal_entries')) AS tamano_del_libro,
  (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()
      AND state <> 'idle' AND backend_type = 'client backend') AS otras_sesiones_activas;
