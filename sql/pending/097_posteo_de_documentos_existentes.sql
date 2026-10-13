-- ============================================================================
-- 097 · Posteo de documentos existentes, por mes (después de la ventana)
-- ============================================================================
-- Pedido de Oliver (06/10/2026, runbook §4 punto 9): los documentos reales
-- desde el inicio contable (01/07/2026) hasta el deploy no tienen asiento.
-- NO se postean en la ventana: se postean DESPUÉS, un mes por vez, cuando
-- Josuarth revisa ese mes con el Excel «en seco».
--
-- La app arma cada asiento con el MISMO constructor que usa al emitir/cobrar/
-- registrar (factura, NC, cobro, compra, gasto de trámite, pago a proveedor),
-- y esta función los postea TODOS en una transacción: si uno falla, no queda
-- ninguno (el mes nunca queda a medias, y el libro es inmutable).
--
-- Qué deja:
--   1. posteos_retroactivos: un renglón por mes contabilizado (el lote), con
--      quién, cuándo, el rango y cuántos asientos. Como journal_imports.
--   2. posteo_retroactivo_asientos: qué asientos salieron de cada lote.
--   3. post_documentos_existentes(tenant, desde, hasta, items, usuario):
--        · el rango no empieza antes del inicio contable (096);
--        · 🔴 UN MES SE CARGA POR UN SOLO MÉTODO: si en el rango hay asientos
--          manuales o de apertura vigentes (los importados por
--          /finanzas/asientos/importar son manuales), se niega y los nombra;
--        · cada item pasa por post_journal_entry (cuadre, cuentas, período
--          abierto, tercero obligatorio, inicio contable, documentos de prueba);
--        · una REVERSIÓN (factura anulada antes de tener asiento) busca su
--          original por (source_type, source_id), que puede haberse posteado
--          en este mismo lote;
--        · el gasto de trámite guarda su posted_entry_id (el cache de la 038).
--      SECURITY DEFINER, EXECUTE sólo service_role: el tenant lo pone la ruta
--      desde el perfil, nunca el request (SOP-014).
--
-- Idempotencia: la app sólo manda documentos SIN asiento, y el UNIQUE de la
-- 034 (tenant, source_type, source_id) frena un segundo intento igual.
--
-- No va en la ventana del Bloque 1. Se aplica cuando se decida empezar el
-- posteo retroactivo (puede ser en la misma ventana, sin usarse hasta revisar
-- julio: no toca datos).
-- 🛡️ Escrita, SIN APLICAR en staging hasta el «aplica» de Oliver.
-- ============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.posteos_retroactivos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  desde          date NOT NULL,
  hasta          date NOT NULL,
  entries_count  integer NOT NULL,
  total_debitos  numeric(14,2) NOT NULL,
  created_by     uuid NULL REFERENCES public.users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT posteos_retroactivos_rango CHECK (hasta >= desde)
);
COMMENT ON TABLE public.posteos_retroactivos IS
  'Posteo de documentos existentes (097): un renglón por rango (normalmente un mes) contabilizado de una vez. Sólo lo escribe post_documentos_existentes.';

CREATE TABLE IF NOT EXISTS public.posteo_retroactivo_asientos (
  posteo_id  uuid NOT NULL REFERENCES public.posteos_retroactivos(id) ON DELETE RESTRICT,
  entry_id   uuid NOT NULL REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  orden      integer NOT NULL,
  PRIMARY KEY (posteo_id, entry_id)
);

ALTER TABLE public.posteos_retroactivos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posteo_retroactivo_asientos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS posteos_retroactivos_select ON public.posteos_retroactivos;
CREATE POLICY posteos_retroactivos_select ON public.posteos_retroactivos
  FOR SELECT USING (tenant_id = public.get_tenant_id() AND public.get_user_role() IN ('admin', 'contador'));
DROP POLICY IF EXISTS posteo_retroactivo_asientos_select ON public.posteo_retroactivo_asientos;
CREATE POLICY posteo_retroactivo_asientos_select ON public.posteo_retroactivo_asientos
  FOR SELECT USING (tenant_id = public.get_tenant_id() AND public.get_user_role() IN ('admin', 'contador'));
-- Sin políticas de escritura: sólo la función (service_role) escribe.

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

  -- 🔴 Un mes se carga por un solo método.
  SELECT string_agg(format('%s (%s, %s)', coalesce(j.reference, 'asiento ' || j.entry_number),
                           to_char(j.transaction_date, 'DD/MM/YYYY'), j.description), '; ' ORDER BY j.entry_number)
    INTO v_manuales
    FROM public.journal_entries j
   WHERE j.tenant_id = p_tenant_id
     AND j.source_type IN ('manual', 'apertura')
     AND j.transaction_date BETWEEN p_desde AND p_hasta
     AND NOT EXISTS (SELECT 1 FROM public.journal_entries r WHERE r.tenant_id = j.tenant_id AND r.reverses_entry_id = j.id);
  IF v_manuales IS NOT NULL THEN
    RAISE EXCEPTION 'Este período ya tiene asientos manuales o importados: %. Un mes se carga por un solo método: no se contabilizan los documentos.',
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

DO $$
BEGIN
  IF has_function_privilege('authenticated', 'public.post_documentos_existentes(uuid, date, date, jsonb, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '097: authenticated no debe poder ejecutar post_documentos_existentes';
  END IF;
  RAISE NOTICE '097 ✅ post_documentos_existentes (un lote, una transacción; un mes por un solo método) y su registro';
END $$;

COMMIT;

-- Verificación (BEGIN … ROLLBACK): sql/tests/verificacion-097-posteo-de-documentos-existentes.sql
