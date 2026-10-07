-- ============================================================================
-- 099 · Un solo método: bloquean sólo los asientos IMPORTADOS; el banco de un
--       cobro contabilizado no cambia (después de la 098)
-- ============================================================================
-- Decisiones de Oliver (07/10/2026):
--
--   1. post_documentos_existentes se niega sólo si el período tiene asientos
--      IMPORTADOS vigentes (los que liga journal_import_entries, no reversados).
--      Los asientos manuales de ajuste (depreciación, provisiones,
--      reclasificaciones) ya no bloquean: la pantalla y el Excel en seco los
--      listan en «Asientos manuales del mes», con el aviso «Revisa que ninguno
--      registre un documento que también está en la hoja Asientos.». Los de
--      apertura tampoco bloquean (la apertura sigue en espera).
--      El otro sentido no cambia (098): la importación no entra en un mes ya
--      contabilizado desde los documentos; el ajuste a mano sí.
--
--   2. payments.payment_account_code no cambia en un cobro que ya tiene
--      asiento. El banco entra al asiento (DEBE banco); cambiarlo después
--      dejaría el documento diciendo una cosa y el libro otra. Desde el 07/10
--      la app asigna el banco en lote a cobros SIN asiento (para contabilizar
--      los documentos existentes): ésta es la garantía de la base, la ruta ya
--      lo verifica antes con un mensaje en español.
--
-- No toca datos. Redefine UNA función (misma firma, mismos permisos) y agrega
-- un trigger. Va junto con la 097 y la 098, después de la ventana.
-- 🛡️ Escrita, SIN APLICAR en staging hasta el «aplica» de Oliver.
-- ============================================================================
BEGIN;

-- ── 1. post_documentos_existentes: sólo los importados bloquean ─────────────
CREATE OR REPLACE FUNCTION public.post_documentos_existentes(
  p_tenant_id  uuid,
  p_desde      date,
  p_hasta      date,
  p_items      jsonb,
  p_created_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_inicio    date;
  v_manuales  text;
  v_posteo    uuid;
  v_i         jsonb;
  v_n         int := 0;
  v_total     numeric(14,2) := 0;
  v_orig      uuid;
  v_entry     uuid;
  v_nro       bigint;
  v_salida    jsonb := '[]'::jsonb;
BEGIN
  IF p_tenant_id IS NULL OR p_desde IS NULL OR p_hasta IS NULL OR p_hasta < p_desde THEN
    RAISE EXCEPTION 'post_documentos_existentes: faltan el tenant o un rango válido';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'No hay documentos para contabilizar en ese período.';
  END IF;

  v_inicio := public.finanzas_inicio_contable(p_tenant_id);
  IF p_desde < v_inicio THEN
    RAISE EXCEPTION 'El período empieza el %, antes del inicio contable (%): lo anterior está contabilizado fuera.',
      to_char(p_desde, 'DD/MM/YYYY'), to_char(v_inicio, 'DD/MM/YYYY');
  END IF;

  -- 098: el candado del correlativo del libro ANTES de mirar el mes (el mismo
  -- que toma post_journal_entry, el primero del orden J → A de la 090). Con él,
  -- una importación o un posteo del mismo bufete que esté en curso termina
  -- antes de que esta función mire qué hay en el mes, y lo que miramos ya
  -- está confirmado. Sin él, una importación sin confirmar no se ve y los dos
  -- métodos entrarían al mismo mes; y dos corridas del mismo mes, a la vez,
  -- se ordenan acá: la segunda choca con los UNIQUE del libro y no escribe nada.
  INSERT INTO public.accounting_sequences (tenant_id, sequence_type, last_number)
  VALUES (p_tenant_id, 'journal_entry', 0)
  ON CONFLICT (tenant_id, sequence_type) DO NOTHING;
  PERFORM 1 FROM public.accounting_sequences
   WHERE tenant_id = p_tenant_id AND sequence_type = 'journal_entry'
     FOR UPDATE;

  -- 🔴 Un mes se carga por un solo método (099, Oliver 07/10/2026): bloquean
  -- sólo los asientos IMPORTADOS vigentes (journal_import_entries, no
  -- reversados). Los asientos manuales de ajuste NO bloquean: la app los lista
  -- en «Asientos manuales del mes» para que el contador revise que ninguno
  -- registre un documento que también entra acá.
  SELECT string_agg(format('%s (%s, %s)', coalesce(j.reference, 'asiento ' || j.entry_number),
                           to_char(j.transaction_date, 'DD/MM/YYYY'), j.description), '; ' ORDER BY j.entry_number)
    INTO v_manuales
    FROM public.journal_entries j
    JOIN public.journal_import_entries ie ON ie.entry_id = j.id
   WHERE j.tenant_id = p_tenant_id
     AND j.transaction_date BETWEEN p_desde AND p_hasta
     AND NOT EXISTS (SELECT 1 FROM public.journal_entries r WHERE r.tenant_id = j.tenant_id AND r.reverses_entry_id = j.id);
  IF v_manuales IS NOT NULL THEN
    RAISE EXCEPTION 'Este período ya tiene asientos importados: %. Un mes se carga por un solo método: no se contabilizan los documentos.',
      v_manuales USING ERRCODE = 'check_violation';
  END IF;

  SELECT coalesce(sum((l->>'debit')::numeric), 0) INTO v_total
    FROM jsonb_array_elements(p_items) e, jsonb_array_elements(e->'lines') l;

  INSERT INTO public.posteos_retroactivos (tenant_id, desde, hasta, entries_count, total_debitos, created_by)
  VALUES (p_tenant_id, p_desde, p_hasta, jsonb_array_length(p_items), v_total, p_created_by)
  RETURNING id INTO v_posteo;

  FOR v_i IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_n := v_n + 1;
    IF (v_i->>'transaction_date')::date NOT BETWEEN p_desde AND p_hasta THEN
      RAISE EXCEPTION 'El asiento % (%) tiene fecha %, fuera del período.', v_n, v_i->>'reference', v_i->>'transaction_date';
    END IF;

    v_orig := NULL;
    IF v_i ? 'revierte_source_type' THEN
      SELECT j.id INTO v_orig FROM public.journal_entries j
       WHERE j.tenant_id = p_tenant_id AND j.source_type = v_i->>'revierte_source_type'
         AND j.source_id = (v_i->>'revierte_source_id')::uuid;
      IF v_orig IS NULL THEN
        RAISE EXCEPTION 'La reversión % no encuentra el asiento original del documento %.', v_n, v_i->>'reference';
      END IF;
    END IF;

    v_entry := public.post_journal_entry(
      p_tenant_id          => p_tenant_id,
      p_transaction_date   => (v_i->>'transaction_date')::date,
      p_description        => v_i->>'description',
      p_source_type        => v_i->>'source_type',
      p_lines              => v_i->'lines',
      p_source_id          => nullif(v_i->>'source_id', '')::uuid,
      p_source_cufe        => nullif(v_i->>'source_cufe', ''),
      p_reverses_entry_id  => v_orig,
      p_reversal_reason    => nullif(v_i->>'reversal_reason', ''),
      p_created_by         => p_created_by,
      p_record_date        => NULL,
      p_reference          => nullif(v_i->>'reference', ''),
      p_idempotency_key    => nullif(v_i->>'idempotency_key', ''),
      p_referencia_externa => nullif(v_i->>'referencia_externa', '')
    );

    IF v_i->>'source_type' = 'gasto_tramite' THEN
      -- 098: la referencia del asiento es el FAC-CO- que el gasto tiene guardado.
      IF NOT EXISTS (SELECT 1 FROM public.expenses
                      WHERE tenant_id = p_tenant_id AND id = (v_i->>'source_id')::uuid
                        AND purchase_number IS NOT DISTINCT FROM nullif(v_i->>'reference', '')) THEN
        RAISE EXCEPTION 'El asiento % lleva la referencia %, que no es el número del gasto de trámite.', v_n, v_i->>'reference';
      END IF;
      UPDATE public.expenses SET posted_entry_id = v_entry
       WHERE tenant_id = p_tenant_id AND id = (v_i->>'source_id')::uuid;
    END IF;

    INSERT INTO public.posteo_retroactivo_asientos (posteo_id, entry_id, tenant_id, orden)
    VALUES (v_posteo, v_entry, p_tenant_id, v_n);
    SELECT entry_number INTO v_nro FROM public.journal_entries WHERE id = v_entry;
    v_salida := v_salida || jsonb_build_object('orden', v_n, 'entry_number', v_nro, 'reference', v_i->>'reference');
  END LOOP;

  RETURN jsonb_build_object('posteo_id', v_posteo, 'asientos', v_salida, 'total_debitos', v_total);
END;
$fn$;

REVOKE ALL ON FUNCTION public.post_documentos_existentes(uuid, date, date, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_documentos_existentes(uuid, date, date, jsonb, uuid) TO service_role;

-- ── 2. El banco de un cobro contabilizado no cambia ─────────────────────────
CREATE OR REPLACE FUNCTION public.finanzas_banco_de_cobro_contabilizado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_numero bigint;
BEGIN
  IF NEW.payment_account_code IS DISTINCT FROM OLD.payment_account_code THEN
    SELECT entry_number INTO v_numero FROM public.journal_entries
     WHERE tenant_id = NEW.tenant_id AND source_type = 'pago' AND source_id = NEW.id;
    IF v_numero IS NOT NULL THEN
      RAISE EXCEPTION 'Este cobro ya está registrado en el libro contable (asiento %): no se le cambia el banco. Si está mal, se reversa el cobro y se registra de nuevo.',
        v_numero USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.finanzas_banco_de_cobro_contabilizado() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_banco_de_cobro_contabilizado ON public.payments;
CREATE TRIGGER trg_banco_de_cobro_contabilizado
  BEFORE UPDATE OF payment_account_code ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.finanzas_banco_de_cobro_contabilizado();

DO $$
BEGIN
  IF has_function_privilege('authenticated', 'public.post_documentos_existentes(uuid, date, date, jsonb, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '099: authenticated no debe poder ejecutar post_documentos_existentes';
  END IF;
  IF position('journal_import_entries' in pg_get_functiondef('public.post_documentos_existentes(uuid, date, date, jsonb, uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '099: post_documentos_existentes no mira los asientos importados';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_banco_de_cobro_contabilizado') THEN
    RAISE EXCEPTION '099: falta el trigger del banco del cobro';
  END IF;
  RAISE NOTICE '099 ✅ bloquean sólo los asientos importados; el banco de un cobro contabilizado no cambia';
END $$;

COMMIT;

-- Verificación (BEGIN … ROLLBACK): sql/tests/verificacion-097-posteo-de-documentos-existentes.sql (casos 4, 4b y 10)
