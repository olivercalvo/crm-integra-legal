-- ============================================================================
-- 101 · Reversar la APERTURA (después de la 100)
-- ============================================================================
-- reverse_journal_entry (055, 069, 080) acepta también source_type 'apertura',
-- con dos reglas propias (Oliver, 07/10/2026):
--   · la reversión lleva SIEMPRE la misma fecha que la apertura (no la elige el
--     contador). Así no queda un tramo con dos aperturas sumadas ni uno sin
--     ninguna entre la reversión y la apertura nueva;
--   · sólo con el mes de la apertura ABIERTO (lo exige post_journal_entry). Con
--     el mes cerrado la pantalla no ofrece «Reversar»: la corrección va con un
--     asiento de ajuste a mano.
-- En la misma transacción marca la apertura `reversada` (aperturas, 100), con
-- el motivo y el asiento de la reversión, y deja libre el lugar para otra.
-- Todo lo demás de la función queda igual (mismo cuerpo de la 080 en staging):
-- el espejo se VERIFICA, una reversión por asiento, motivo obligatorio. La
-- bitácora contable registra el asiento de la reversión con su motivo.
--
-- Misma firma y mismos permisos (EXECUTE sólo service_role). No toca datos.
-- Va en la ventana del Bloque 1, después de la 100, aplicada y sin usar.
-- 🛡️ Escrita, SIN APLICAR en staging hasta el «aplica» de Oliver.
-- ============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.reverse_journal_entry(p_tenant_id uuid, p_entry_id uuid, p_reason text, p_transaction_date date, p_description text, p_lines jsonb, p_created_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_source_type text;
  v_orig_nro    bigint;
  v_orig_ref    text;
  v_orig_date   date;
  v_ya_nro      bigint;
  v_dif         int;
  v_entry_id    uuid;
  v_entry_nro   bigint;
  v_apertura    uuid;
BEGIN
  IF p_tenant_id IS NULL OR p_entry_id IS NULL THEN
    RAISE EXCEPTION 'reverse_journal_entry: faltan el tenant o el asiento';
  END IF;
  IF coalesce(length(btrim(p_reason)), 0) < 3 THEN
    RAISE EXCEPTION 'La reversión necesita un motivo de al menos 3 caracteres (DE 34/1998 Art. 5.7)';
  END IF;
  -- Fecha de registro ELEGIDA (069: revisión del 28/09 y reunión del 30/09).
  -- El período lo exige post_journal_entry; "no antes del original", abajo.
  IF p_transaction_date IS NULL THEN
    RAISE EXCEPTION 'La reversión necesita una fecha de registro (la elige el contador, en un período abierto).';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) < 2 THEN
    RAISE EXCEPTION 'reverse_journal_entry: las líneas del espejo deben venir como un array JSON de al menos 2';
  END IF;

  SELECT source_type, entry_number, reference, transaction_date
    INTO v_source_type, v_orig_nro, v_orig_ref, v_orig_date
    FROM public.journal_entries
   WHERE tenant_id = p_tenant_id AND id = p_entry_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Asiento no encontrado';
  END IF;

  -- 🔴 EL FILTRO (D8). Desde acá solo se reversa lo que se cargó a mano.
  -- 101: también la APERTURA (100), con su propia regla de fecha (abajo).
  IF v_source_type NOT IN ('manual', 'cierre', 'apertura') /* 080: cierre anual; 101: apertura */ THEN
    RAISE EXCEPTION
      'El asiento % salió de un documento (%), no de una carga manual: desde acá no se reversa. Se corrige por su documento —anulando la factura, reversando el cobro o el gasto—, que además actualiza el estado de ese documento.',
      v_orig_nro, v_source_type;
  END IF;

  -- 101 (Oliver, 07/10/2026): la reversión de la apertura lleva SIEMPRE la
  -- MISMA fecha que la apertura. Así no hay un tramo entre la reversión y la
  -- apertura nueva con las dos sumadas, ni uno sin ninguna. El mes tiene que
  -- seguir abierto: lo exige post_journal_entry; si está cerrado, la corrección
  -- va con un asiento de ajuste a mano.
  IF v_source_type = 'apertura' THEN
    IF p_transaction_date <> v_orig_date THEN
      RAISE EXCEPTION 'La reversión de la apertura lleva la misma fecha que la apertura (%), no otra.',
        to_char(v_orig_date, 'DD/MM/YYYY') USING ERRCODE = 'check_violation';
    END IF;
    SELECT a.id INTO v_apertura FROM public.aperturas a
     WHERE a.tenant_id = p_tenant_id AND a.entry_id = p_entry_id AND a.estado = 'vigente'
       FOR UPDATE;
    IF v_apertura IS NULL THEN
      RAISE EXCEPTION 'El asiento % no es una apertura vigente.', v_orig_nro USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF p_transaction_date < v_orig_date THEN
    RAISE EXCEPTION 'La reversión (%) no puede ser anterior al asiento que revierte (asiento %, %)',
      p_transaction_date, v_orig_nro, v_orig_date;
  END IF;

  -- Doble candado: el mensaje entendible acá, el índice único abajo. El índice
  -- es el que sostiene la regla si alguien llama sin pasar por este camino.
  SELECT entry_number INTO v_ya_nro
    FROM public.journal_entries
   WHERE tenant_id = p_tenant_id AND reverses_entry_id = p_entry_id
   LIMIT 1;
  IF v_ya_nro IS NOT NULL THEN
    RAISE EXCEPTION 'El asiento % ya fue reversado por el asiento %.', v_orig_nro, v_ya_nro;
  END IF;

  -- El espejo se VERIFICA, no se recalcula: lo arma `construirAsientoDeReversion`
  -- —la misma función que dibuja la vista previa— y acá se comprueba que sea el
  -- reflejo exacto, con EXCEPT ALL en los dos sentidos (mismo cerrojo que 046).
  WITH esperado AS (
    SELECT c.code AS code, l.credit AS debit, l.debit AS credit
      FROM public.journal_entry_lines l
      JOIN public.chart_of_accounts c ON c.id = l.account_id
     WHERE l.entry_id = p_entry_id
  ), recibido AS (
    SELECT btrim(x->>'account_code')                      AS code,
           round(coalesce((x->>'debit')::numeric, 0), 2)  AS debit,
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
    RAISE EXCEPTION
      'Las líneas recibidas no son el espejo exacto del asiento %: se rechaza la reversión para no descuadrar el libro.',
      v_orig_nro;
  END IF;

  -- El espejo NO lleva el tercero de vuelta: `p_lines` son cuenta, débito,
  -- crédito y glosa. Es una decisión, no un olvido — el tercero de la reversión
  -- se hereda mirando el asiento original, que queda enlazado por
  -- `reverses_entry_id`, y duplicarlo abriría la puerta a que difieran.
  v_entry_id := public.post_journal_entry(
    p_tenant_id, p_transaction_date, p_description, 'reversion', p_lines,
    -- `source_id` NULL: un asiento manual no tiene documento, y ponerle el id
    -- del asiento original haría que el Mayor intentara abrirlo como si lo
    -- fuera. El vínculo es `reverses_entry_id`.
    NULL, NULL, p_entry_id, btrim(p_reason), p_created_by, NULL, v_orig_ref, NULL
  );
  SELECT entry_number INTO v_entry_nro FROM public.journal_entries WHERE id = v_entry_id;

  -- 101: la apertura queda reversada en la MISMA transacción.
  IF v_apertura IS NOT NULL THEN
    UPDATE public.aperturas
       SET estado = 'reversada', reversal_entry_id = v_entry_id, motivo_reversion = btrim(p_reason),
           reversed_by = p_created_by, reversed_at = now()
     WHERE id = v_apertura;
  END IF;

  RETURN jsonb_build_object(
    'entry_id',              v_entry_id,
    'entry_number',          v_entry_nro,
    'reversed_entry_id',     p_entry_id,
    'reversed_entry_number', v_orig_nro,
    'transaction_date',      p_transaction_date
  );
END $function$;

REVOKE ALL ON FUNCTION public.reverse_journal_entry(uuid, uuid, text, date, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_journal_entry(uuid, uuid, text, date, text, jsonb, uuid) TO service_role;

DO $$
BEGIN
  IF has_function_privilege('authenticated', 'public.reverse_journal_entry(uuid, uuid, text, date, text, jsonb, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '101: authenticated no debe poder ejecutar reverse_journal_entry';
  END IF;
  IF position('aperturas' in pg_get_functiondef('public.reverse_journal_entry(uuid, uuid, text, date, text, jsonb, uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '101: reverse_journal_entry no marca la apertura reversada';
  END IF;
  RAISE NOTICE '101 ✅ la apertura se reversa con su misma fecha, con el mes abierto, y queda reversada en la misma transacción';
END $$;

COMMIT;

-- Verificación (BEGIN … ROLLBACK): sql/tests/verificacion-100-101-apertura.sql
