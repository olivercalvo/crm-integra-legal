-- ============================================================================
-- 064 — EL CHECK DE LA 061 DEJABA PASAR UN ORIGEN NULO
-- ============================================================================
-- 25/09/2026. Corrige la `061` sin tocarla (ya está aplicada en staging).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- EL AGUJERO
-- ─────────────────────────────────────────────────────────────────────────────
-- La `061` declaró:
--
--     (dgi_cufe IS NULL AND dgi_cufe_origen IS NULL)
--     OR
--     (dgi_cufe IS NOT NULL AND dgi_cufe_origen IN ('crm', 'portal_050'))
--
-- Con CUFE y origen NULL, la primera rama es FALSE y la segunda es
-- `TRUE AND NULL` = NULL. `FALSE OR NULL` = NULL, y **un CHECK que da NULL se
-- acepta**. O sea que la regla central de la `061` —"un CUFE sin origen es un
-- dato que no se sabe leer"— no la hacía cumplir nadie.
--
-- Y el código no escribía el origen al autorizar (`persistAuthorized`), así
-- que el agujero se usó: medido en staging el 25/09/2026,
--
--     FAC-HON-000003 · authorized · CUFE sí · origen NULL · 1 emisión autorizada con ese CUFE
--     FAC-HON-000017 · authorized · CUFE sí · origen NULL · 1 emisión autorizada con ese CUFE
--
-- La verificación de la `061` no lo vio porque corrió un segundo después de
-- su propio backfill, cuando todavía no había ninguna fila así.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ HACE
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Marca `'crm'` SÓLO las facturas con CUFE y sin origen cuyo CUFE aparece
--    en una fila de `fe_emisiones` autorizada. Eso es evidencia de que lo
--    devolvió el PAC a este sistema, no una suposición.
-- 2. Corrige el backfill ciego de la 061. La 061 marcó `'crm'` TODO CUFE que
--    ya existía, suponiendo que lo había devuelto el PAC. En staging es cierto
--    (medido: las 3 tienen su emisión). En PRODUCCIÓN no tiene por qué serlo:
--    antes de julio la tarjeta legacy (`DgiDataCard`) dejaba CARGAR A MANO el
--    CUFE de una factura emitida en el portal de ideati. Esas facturas no
--    tienen NINGUNA fila en `fe_emisiones` —el flujo del CRM la inserta antes
--    de salir a la red, siempre—, así que pasan a `'portal_050'`, que es lo que
--    son. En staging esto toca 0 filas.
-- 3. Si queda alguna con CUFE, sin origen y SIN evidencia, ABORTA y las
--    lista. No se les inventa un origen: decidir si se copió del portal es de
--    una persona.
-- 4. Re-declara el CHECK con `dgi_cufe_origen IS NOT NULL` explícito.
--
-- 🔴 ORDEN EN PRODUCCIÓN: va pegada a la `061` y las dos van en la VENTANA
--    (Bloque B), con la emisión congelada. El código de `main` no escribe el
--    origen: con este CHECK puesto, su UPDATE de "autorizada" fallaría DESPUÉS
--    de que el PAC autorizó — factura viva ante la DGI y sin CUFE en la base.
--    Ver `docs/runbooks/despliegue-025-055.md`.
--
-- 🔴 ORDEN EN STAGING: se aplica DESPUÉS de que el código que escribe
--    `dgi_cufe_origen = 'crm'` esté en develop y desplegado en Preview. Por la
--    misma razón.
--
-- IDEMPOTENCIA: el UPDATE filtra por `IS NULL`; DROP/ADD CONSTRAINT con nombre fijo.
-- Reversible: volver a declarar el CHECK de la 061 (no borra datos).
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='invoices' AND column_name='dgi_cufe_origen'
  ) THEN
    RAISE EXCEPTION '064: falta invoices.dgi_cufe_origen. Aplicar primero la 061.';
  END IF;
END $$;

-- ── 1. Las que tienen evidencia de haber salido del PAC ────────────────────
DO $$
DECLARE v_n int;
BEGIN
  UPDATE public.invoices i
     SET dgi_cufe_origen = 'crm'
   WHERE i.dgi_cufe IS NOT NULL
     AND i.dgi_cufe_origen IS NULL
     AND EXISTS (
       SELECT 1 FROM public.fe_emisiones e
        WHERE e.invoice_id = i.id AND e.autorizada AND e.cufe = i.dgi_cufe
     );
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE '064: % factura(s) con CUFE del PAC marcadas como ''crm''', v_n;
END $$;

-- ── 2. 'crm' sin una sola emisión del CRM: eran copias del portal ─────────
DO $$
DECLARE v_n int; r record;
BEGIN
  FOR r IN
    SELECT i.invoice_number FROM public.invoices i
     WHERE i.dgi_cufe_origen = 'crm'
       AND NOT EXISTS (SELECT 1 FROM public.fe_emisiones e WHERE e.invoice_id = i.id)
     ORDER BY i.invoice_number LIMIT 200
  LOOP
    RAISE NOTICE '  % — CUFE sin ninguna emisión del CRM: pasa a portal_050', r.invoice_number;
  END LOOP;

  UPDATE public.invoices i
     SET dgi_cufe_origen = 'portal_050'
   WHERE i.dgi_cufe_origen = 'crm'
     AND NOT EXISTS (SELECT 1 FROM public.fe_emisiones e WHERE e.invoice_id = i.id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE '064: % factura(s) con CUFE cargado a mano re-marcadas como ''portal_050''', v_n;
END $$;

-- ── 3. Las que quedan sin evidencia: se listan y se aborta ─────────────────
DO $$
DECLARE v_malas int; r record;
BEGIN
  SELECT count(*) INTO v_malas FROM public.invoices
   WHERE dgi_cufe IS NOT NULL AND dgi_cufe_origen IS NULL;

  IF v_malas > 0 THEN
    FOR r IN
      SELECT invoice_number, fe_estado FROM public.invoices
       WHERE dgi_cufe IS NOT NULL AND dgi_cufe_origen IS NULL
       ORDER BY invoice_number LIMIT 50
    LOOP
      RAISE NOTICE '  % (fe_estado = %) — CUFE sin origen y sin emisión autorizada que lo respalde', r.invoice_number, r.fe_estado;
    END LOOP;
    RAISE EXCEPTION '064: % factura(s) con CUFE sin origen demostrable. No se aplicó nada: decidir a mano si son ''portal_050''.', v_malas;
  END IF;
END $$;

-- ── 4. El CHECK, sin el agujero ────────────────────────────────────────────
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_dgi_cufe_origen_check;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_dgi_cufe_origen_check
  CHECK (
    (dgi_cufe IS NULL AND dgi_cufe_origen IS NULL)
    OR
    (dgi_cufe IS NOT NULL
      AND dgi_cufe_origen IS NOT NULL
      AND dgi_cufe_origen IN ('crm', 'portal_050'))
  );

COMMENT ON CONSTRAINT invoices_dgi_cufe_origen_check ON public.invoices IS
  'CUFE ⇔ origen. El IS NOT NULL explícito es la corrección de la 064: sin él, '
  'NULL IN (...) da NULL y el CHECK aceptaba un CUFE sin origen.';

COMMIT;

-- ============================================================================
-- VERIFICACIÓN — incluye probar que el agujero está cerrado
-- ============================================================================
DO $$
DECLARE v_sin int; v_id uuid; v_cerrado boolean := false;
BEGIN
  SELECT count(*) INTO v_sin FROM public.invoices
   WHERE dgi_cufe IS NOT NULL AND dgi_cufe_origen IS NULL;
  IF v_sin <> 0 THEN
    RAISE EXCEPTION '064: quedaron % facturas con CUFE y sin origen', v_sin;
  END IF;

  -- El intento que antes pasaba tiene que fallar ahora. Se prueba sobre una
  -- factura con CUFE y se deshace con el bloque de excepción.
  SELECT id INTO v_id FROM public.invoices WHERE dgi_cufe IS NOT NULL LIMIT 1;
  IF v_id IS NOT NULL THEN
    BEGIN
      UPDATE public.invoices SET dgi_cufe_origen = NULL WHERE id = v_id;
      RAISE EXCEPTION 'agujero_abierto';
    EXCEPTION
      WHEN check_violation THEN v_cerrado := true;
      WHEN raise_exception THEN v_cerrado := false;
    END;
    IF NOT v_cerrado THEN
      RAISE EXCEPTION '064: el CHECK sigue aceptando un CUFE sin origen';
    END IF;
  END IF;

  RAISE NOTICE '064 ✅ un CUFE sin origen ya no entra (probado: %)',
    CASE WHEN v_id IS NULL THEN 'sin facturas con CUFE para probar' ELSE 'rechazado' END;
END $$;
