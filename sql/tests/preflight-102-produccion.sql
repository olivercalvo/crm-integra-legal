SELECT
  to_regclass('public.aperturas') IS NOT NULL                                          AS tiene_100_tabla_aperturas,
  to_regprocedure('public.post_apertura(uuid, text, jsonb, text, text, uuid)') IS NOT NULL AS tiene_100_post_apertura,
  coalesce(position('aperturas' IN pg_get_functiondef(
    to_regprocedure('public.reverse_journal_entry(uuid, uuid, text, date, text, jsonb, uuid)'))) > 0, false) AS tiene_101_reversa_apertura,
  EXISTS (SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'aperturas' AND column_name = 'corrige_apertura_id') AS ya_tiene_102_columna,
  to_regprocedure('public.corregir_apertura(uuid, uuid, text, jsonb, jsonb, text, uuid)') IS NOT NULL AS ya_tiene_102_funcion;
