-- ============================================================================
-- 102 · CORREGIR la APERTURA desde la pantalla (después de la 100 y la 101)
-- ============================================================================
-- Criterio decidido por Oliver con Josuarth el 14/10/2026: un documento
-- contabilizado se CORRIGE desde la pantalla, sin límite de veces, mientras el
-- período esté abierto. «Corregir» NUNCA edita el libro: en UNA transacción
-- reversa el asiento original y registra el corregido. Motivo obligatorio, y
-- cada corrección queda en un historial (versión 1, 2, 3…).
--
-- Para la apertura, hasta hoy cambiar una cifra era reversar y volver a subir
-- todo el Excel. El camino del Excel se queda como está; esto lo complementa.
--
-- Qué deja:
--   1. aperturas.corrige_apertura_id + motivo_correccion: la apertura nueva
--      queda LIGADA a la que corrige (una corrección por apertura, índice único).
--      Inmutables como el resto de la fila: sólo los graba corregir_apertura,
--      con la válvula de transacción `finanzas.corregir_apertura` (el mismo
--      patrón de `finanzas.amount_paid_override` y `finanzas.nc_compensar`).
--   2. corregir_apertura(tenant, apertura, motivo, espejo, líneas, hash, usuario):
--      SECURITY DEFINER, EXECUTE sólo service_role. En UNA transacción:
--        · el candado del correlativo primero (orden J → A de la 090);
--        · la apertura que se corrige tiene que ser la VIGENTE (si otra persona
--          la corrigió o la reversó mientras tanto, se rechaza);
--        · el mes de la apertura y el de la fecha nueva, ABIERTOS (son el mismo
--          día: la fecha no cambia con una vigente, 100). Si no, el ajuste va en
--          un mes abierto, o el contador reabre el mes;
--        · reversa con reverse_journal_entry (la lógica de la 101: misma fecha,
--          espejo VERIFICADO, la apertura queda reversada con el motivo);
--        · postea la nueva con post_apertura (la lógica de la 100: cuadre, sólo
--          balance al 31/12, cuentas control con documento y fecha, tercero);
--        · liga la nueva a la que corrige.
--      Si cualquier paso falla, no queda nada: ni la reversión, ni la nueva, ni
--      números del correlativo.
--
-- post_apertura y reverse_journal_entry NO cambian (misma firma, mismo cuerpo).
-- Bitácora: la reversión y la apertura nueva son asientos (journal_entries ya se
-- captura, con el motivo en la reversión). No toca datos.
-- 🛡️ Escrita para staging. En producción va en la ventana, después de la 101.
-- ============================================================================
BEGIN;

-- ── 1. La liga «corrige a» ─────────────────────────────────────────────────
ALTER TABLE public.aperturas
  ADD COLUMN IF NOT EXISTS corrige_apertura_id uuid NULL REFERENCES public.aperturas(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS motivo_correccion   text NULL;
ALTER TABLE public.aperturas DROP CONSTRAINT IF EXISTS aperturas_correccion_completa;
ALTER TABLE public.aperturas
  ADD CONSTRAINT aperturas_correccion_completa
  CHECK ((corrige_apertura_id IS NULL) = (motivo_correccion IS NULL));
CREATE UNIQUE INDEX IF NOT EXISTS aperturas_una_correccion
  ON public.aperturas (corrige_apertura_id) WHERE corrige_apertura_id IS NOT NULL;
COMMENT ON COLUMN public.aperturas.corrige_apertura_id IS
  'La apertura que esta corrige (102). La graba sólo corregir_apertura, en la misma transacción que la reversión.';

-- La fila sigue siendo inmutable. Dos transiciones, nada más:
--   · vigente → reversada (101), sin tocar la liga;
--   · la liga, UNA vez, dentro de corregir_apertura (válvula de transacción).
CREATE OR REPLACE FUNCTION public.finanzas_apertura_inmutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'La apertura no se borra: se reversa.' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_TABLE_NAME = 'apertura_partidas' THEN
    RAISE EXCEPTION 'Las partidas de la apertura no se editan: se reversa la apertura y se carga otra.'
      USING ERRCODE = 'check_violation';
  END IF;
  -- Lo que nunca cambia.
  IF NEW.entry_id IS DISTINCT FROM OLD.entry_id OR NEW.fecha IS DISTINCT FROM OLD.fecha
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.file_hash IS DISTINCT FROM OLD.file_hash
     OR NEW.file_name IS DISTINCT FROM OLD.file_name OR NEW.lineas IS DISTINCT FROM OLD.lineas
     OR NEW.total_debitos IS DISTINCT FROM OLD.total_debitos OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Una apertura sólo pasa de vigente a reversada.' USING ERRCODE = 'check_violation';
  END IF;
  -- 102: la liga, una vez, sólo desde corregir_apertura.
  IF OLD.estado = 'vigente' AND NEW.estado = 'vigente' THEN
    IF OLD.corrige_apertura_id IS NULL AND NEW.corrige_apertura_id IS NOT NULL
       AND coalesce(current_setting('finanzas.corregir_apertura', true), '') = OLD.id::text
       AND OLD.reversal_entry_id IS NULL AND NEW.reversal_entry_id IS NULL THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'La liga de una corrección la graba sólo «Corregir la apertura».' USING ERRCODE = 'check_violation';
  END IF;
  -- 101: vigente → reversada, sin tocar la liga.
  IF OLD.estado <> 'vigente' OR NEW.estado <> 'reversada'
     OR NEW.corrige_apertura_id IS DISTINCT FROM OLD.corrige_apertura_id
     OR NEW.motivo_correccion IS DISTINCT FROM OLD.motivo_correccion THEN
    RAISE EXCEPTION 'Una apertura sólo pasa de vigente a reversada.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- ── 2. corregir_apertura ───────────────────────────────────────────────────
-- p_espejo: el espejo de la apertura vigente, como lo arma
--   construirAsientoDeReversion (la misma función de «Reversar la apertura»);
--   reverse_journal_entry lo VERIFICA contra el libro.
-- p_lines: las líneas corregidas, con la forma de post_apertura (100). Las
--   valida antes la app con validarApertura, la MISMA regla del Excel.
CREATE OR REPLACE FUNCTION public.corregir_apertura(
  p_tenant_id   uuid,
  p_apertura_id uuid,
  p_motivo      text,
  p_espejo      jsonb,
  p_lines       jsonb,
  p_file_hash   text,
  p_created_by  uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_motivo   text := btrim(coalesce(p_motivo, ''));
  v_ap       public.aperturas%ROWTYPE;
  v_nueva    date;
  v_status   text;
  v_version  int;
  v_rev      jsonb;
  v_new      jsonb;
BEGIN
  IF p_tenant_id IS NULL OR p_apertura_id IS NULL THEN
    RAISE EXCEPTION 'corregir_apertura: faltan el tenant o la apertura';
  END IF;
  IF length(v_motivo) < 3 OR length(v_motivo) > 1000 THEN
    RAISE EXCEPTION 'La corrección necesita un motivo de 3 a 1000 caracteres.' USING ERRCODE = 'check_violation';
  END IF;

  -- El candado del correlativo, antes de mirar nada (orden J → A de la 090).
  INSERT INTO public.accounting_sequences (tenant_id, sequence_type, last_number)
  VALUES (p_tenant_id, 'journal_entry', 0)
  ON CONFLICT (tenant_id, sequence_type) DO NOTHING;
  PERFORM 1 FROM public.accounting_sequences
   WHERE tenant_id = p_tenant_id AND sequence_type = 'journal_entry'
     FOR UPDATE;

  SELECT * INTO v_ap FROM public.aperturas
   WHERE tenant_id = p_tenant_id AND id = p_apertura_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró la apertura que se quiere corregir.' USING ERRCODE = 'check_violation';
  END IF;
  IF v_ap.estado <> 'vigente' THEN
    RAISE EXCEPTION 'La apertura cambió mientras la corregías (ya no es la vigente). Vuelve a abrir «Corregir la apertura».'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Los dos meses: el del asiento original y el de la fecha nueva. Con una
  -- vigente la fecha no cambia (100), así que son el mismo; se miran igual.
  v_nueva := public.finanzas_fecha_apertura(p_tenant_id);
  SELECT status INTO v_status FROM public.accounting_periods
   WHERE tenant_id = p_tenant_id AND year = extract(year FROM v_ap.fecha)::int AND month = extract(month FROM v_ap.fecha)::int;
  IF v_status IS DISTINCT FROM 'abierto' THEN
    RAISE EXCEPTION 'El mes de la apertura (%) está cerrado: la apertura no se corrige. El ajuste va con un asiento de diario en un mes abierto, o el contador reabre el mes en Períodos contables.',
      to_char(v_ap.fecha, 'MM/YYYY') USING ERRCODE = 'check_violation';
  END IF;
  IF v_nueva IS DISTINCT FROM v_ap.fecha THEN
    RAISE EXCEPTION 'La fecha de la apertura (%) no coincide con la de los parámetros (%): no se corrige.',
      to_char(v_ap.fecha, 'DD/MM/YYYY'), to_char(v_nueva, 'DD/MM/YYYY') USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) + 1 INTO v_version FROM public.aperturas WHERE tenant_id = p_tenant_id;

  -- La reversión: la lógica de la 101, sin copiarla.
  v_rev := public.reverse_journal_entry(
    p_tenant_id, v_ap.entry_id, 'Corrección de la apertura: ' || v_motivo, v_ap.fecha,
    'Reversión de la apertura al ' || to_char(v_ap.fecha, 'DD/MM/YYYY') || ' (corrección)',
    p_espejo, p_created_by);

  -- La nueva: la lógica de la 100, sin copiarla.
  v_new := public.post_apertura(
    p_tenant_id,
    'Asiento de apertura al ' || to_char(v_ap.fecha, 'DD/MM/YYYY') || ' (corrección)',
    p_lines, 'Corrección en pantalla', p_file_hash, p_created_by);

  -- La liga, con la válvula de esta transacción.
  PERFORM set_config('finanzas.corregir_apertura', (v_new->>'apertura_id'), true);
  UPDATE public.aperturas
     SET corrige_apertura_id = p_apertura_id, motivo_correccion = v_motivo
   WHERE id = (v_new->>'apertura_id')::uuid;
  PERFORM set_config('finanzas.corregir_apertura', '', true);

  RETURN v_new || jsonb_build_object(
    'corrige_apertura_id',   p_apertura_id,
    'reversion_entry_id',    v_rev->>'entry_id',
    'reversion_entry_number', (v_rev->>'entry_number')::bigint,
    'version',               v_version);
END;
$fn$;

REVOKE ALL ON FUNCTION public.corregir_apertura(uuid, uuid, text, jsonb, jsonb, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.corregir_apertura(uuid, uuid, text, jsonb, jsonb, text, uuid) TO service_role;

DO $$
BEGIN
  IF has_function_privilege('authenticated', 'public.corregir_apertura(uuid, uuid, text, jsonb, jsonb, text, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '102: authenticated no debe poder ejecutar corregir_apertura';
  END IF;
  IF position('finanzas.corregir_apertura' in pg_get_functiondef('public.finanzas_apertura_inmutable()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '102: el trigger de inmutabilidad no conoce la válvula de la corrección';
  END IF;
  RAISE NOTICE '102 ✅ corregir_apertura: reversa (101) y postea (100) en una transacción, y liga la nueva a la que corrige';
END $$;

COMMIT;

-- Verificación (BEGIN … ROLLBACK): sql/tests/verificacion-102-corregir-apertura.sql
