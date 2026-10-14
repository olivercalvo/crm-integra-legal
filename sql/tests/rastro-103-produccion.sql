SELECT
  (SELECT count(*) FROM public.journal_entries) AS asientos,
  (SELECT max(entry_number) FROM public.journal_entries) AS ultimo_asiento,
  (SELECT string_agg(last_number::text, ',' ORDER BY tenant_id) FROM public.accounting_sequences WHERE sequence_type = 'journal_entry') AS correlativo_del_libro,
  (SELECT count(*) FROM public.business_expenses) AS compras,
  (SELECT count(*) FROM public.expense_lines) AS lineas_de_compra,
  (SELECT count(*) FROM public.supplier_payments) AS pagos_a_proveedor,
  (SELECT count(*) FROM public.suppliers) AS proveedores,
  (SELECT count(*) FROM public.accounting_periods WHERE status = 'cerrado') AS periodos_cerrados,
  CASE WHEN to_regclass('public.accounting_chain_anchors') IS NULL THEN NULL
       ELSE (xpath('/row/c/text()', query_to_xml('SELECT count(*) AS c FROM public.accounting_chain_anchors', false, true, '')))[1]::text::int END AS anclas,
  CASE WHEN to_regclass('public.compra_correcciones') IS NULL THEN NULL
       ELSE (xpath('/row/c/text()', query_to_xml('SELECT count(*) AS c FROM public.compra_correcciones', false, true, '')))[1]::text::int END AS correcciones_de_compra,
  CASE WHEN to_regclass('auditoria.bitacora_contable') IS NULL THEN NULL
       ELSE (xpath('/row/c/text()', query_to_xml('SELECT count(*) AS c FROM auditoria.bitacora_contable', false, true, '')))[1]::text::int END AS bitacora_contable;
