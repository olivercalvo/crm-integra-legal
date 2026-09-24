-- ============================================================================
-- 061 — DE DÓNDE SALIÓ EL CUFE DE UNA FACTURA
-- ============================================================================
-- Bloque 9C, caso B (24/09/2026).
--
-- Las facturas anteriores al 8 de julio de 2026 se emitieron a mano en el
-- portal de ideati por el punto `050`: **tienen CUFE ante la DGI** y el CRM
-- nunca lo guardó. Para poder acreditarlas electrónicamente hay que cargarlo.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 🔴 POR QUÉ NO ALCANZA CON `dgi_cufe`
-- ─────────────────────────────────────────────────────────────────────────────
-- La columna ya existe y acepta el valor. Lo que no se puede es DISTINGUIR:
--
--   · un CUFE que devolvió el PAC cuando el CRM emitió la factura, y
--   · un CUFE que alguien copió del portal y pegó en una pantalla.
--
-- Son idénticos en la base. Sin esta columna, dentro de seis meses nadie va a
-- saber por qué una factura tiene CUFE y `fe_estado = 'no_emitida'` — y ésa es
-- exactamente la combinación que va a tener toda factura del caso B. La
-- pregunta llega el día en que algo no cuadra ante la DGI, que es el peor
-- momento para no tenerla contestada.
--
-- No se guarda el `fe_estado = 'authorized'` a mano justamente por eso: esas
-- facturas NO las autorizó este sistema, y decir que sí sería mentirle al
-- registro. `dgi_cufe_origen` dice la verdad sin ensuciar el estado.
--
-- 📋 Verificado contra information_schema el 24/09/2026 en staging:
--    `invoices.dgi_cufe` es text NULL; no existe ninguna columna `*_origen`.
--
-- IDEMPOTENCIA: ADD COLUMN IF NOT EXISTS + DROP/ADD CONSTRAINT con nombre fijo.
-- 🛑 SOLO STAGING.
-- ============================================================================

BEGIN;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS dgi_cufe_origen text;

-- El CHECK se declara completo: los dos orígenes posibles, y NULL cuando no
-- hay CUFE. Un CUFE sin origen declarado es un dato que no se sabe leer.
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_dgi_cufe_origen_check;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_dgi_cufe_origen_check
  CHECK (
    (dgi_cufe IS NULL     AND dgi_cufe_origen IS NULL)
    OR
    (dgi_cufe IS NOT NULL AND dgi_cufe_origen IN ('crm', 'portal_050'))
  )
  NOT VALID;

-- ⚠️ NOT VALID a propósito: las facturas que YA tienen CUFE lo tienen porque lo
-- devolvió el PAC, así que hay que marcarlas antes de validar. Se hace acá
-- mismo y después se valida; el NOT VALID es sólo para que el ALTER no falle
-- contra las filas existentes mientras se llenan.
UPDATE public.invoices
   SET dgi_cufe_origen = 'crm'
 WHERE dgi_cufe IS NOT NULL AND dgi_cufe_origen IS NULL;

ALTER TABLE public.invoices VALIDATE CONSTRAINT invoices_dgi_cufe_origen_check;

COMMENT ON COLUMN public.invoices.dgi_cufe_origen IS
  'De dónde salió dgi_cufe: ''crm'' lo devolvió el PAC al emitir desde el sistema; ''portal_050'' lo cargó una persona copiándolo del portal de ideati (facturas anteriores al 8 de julio de 2026). NULL cuando no hay CUFE. Sin esto, los dos casos son indistinguibles en la base.';

-- ----------------------------------------------------------------------------
-- Verificación
-- ----------------------------------------------------------------------------
DO $$
DECLARE v_n int; v_huerfanas int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='invoices' AND column_name='dgi_cufe_origen'
  ) THEN
    RAISE EXCEPTION '061: falta invoices.dgi_cufe_origen';
  END IF;

  SELECT count(*) INTO v_huerfanas FROM public.invoices
   WHERE dgi_cufe IS NOT NULL AND dgi_cufe_origen IS NULL;
  IF v_huerfanas > 0 THEN
    RAISE EXCEPTION '061: quedaron % facturas con CUFE y sin origen', v_huerfanas;
  END IF;

  SELECT count(*) INTO v_n FROM pg_constraint
   WHERE conrelid='public.invoices'::regclass
     AND conname='invoices_dgi_cufe_origen_check' AND convalidated;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '061: el CHECK no quedó validado';
  END IF;

  SELECT count(*) INTO v_n FROM public.invoices WHERE dgi_cufe_origen = 'crm';
  RAISE NOTICE '061 ✅ dgi_cufe_origen · % factura(s) marcadas como ''crm''', v_n;
END $$;

COMMIT;
