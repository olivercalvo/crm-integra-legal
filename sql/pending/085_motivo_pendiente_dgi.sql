-- ============================================================================
-- 085 · El motivo por el que un documento no llegó a la DGI, GUARDADO
-- ============================================================================
-- Hallazgo del 03/10/2026: 4 facturas de producción (FAC-HON-000489, 000496,
-- 000503, 000508) quedaron emitidas sin llegar a la DGI y nadie se enteró. El
-- motivo más probable para las `no_emitida`: el envío se cortó en la validación
-- previa (datos fiscales del cliente) y ese error sólo se vio UNA vez en
-- pantalla; no quedaba escrito en ningún lado (`fe_emisiones` recién tiene fila
-- cuando hay número).
--
-- Dos columnas en `invoices` (facturas y ND) y en `credit_notes`:
--   · fe_motivo_pendiente     el último motivo, en palabras, de por qué no se
--                             emitió o no se autorizó: validación previa,
--                             rechazo del PAC o falla de conexión. NULL cuando
--                             no hay nada pendiente.
--   · fe_motivo_pendiente_en  cuándo se registró ese motivo.
-- Las escribe la app; se limpian cuando la DGI autoriza.
--
-- No es historia: la historia de los envíos sigue en `fe_emisiones`. Es el
-- «por qué está trabada» que se ve al reabrir el documento y en la lista de
-- pendientes.
--
-- Los triggers de inmutabilidad (T4 en facturas, el de la 060 en NC) no
-- listan estas columnas, así que se pueden escribir en un documento emitido,
-- igual que `fe_estado`. No toca filas.
--
-- 🩹 Sólo usa `invoices` y `credit_notes`, que existen en producción (024).
-- 🛡️ Sólo staging hasta el «aplica» de Oliver.
-- ============================================================================
BEGIN;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS fe_motivo_pendiente text,
  ADD COLUMN IF NOT EXISTS fe_motivo_pendiente_en timestamptz;

ALTER TABLE public.credit_notes
  ADD COLUMN IF NOT EXISTS fe_motivo_pendiente text,
  ADD COLUMN IF NOT EXISTS fe_motivo_pendiente_en timestamptz;

ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_fe_motivo_pendiente_largo;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_fe_motivo_pendiente_largo
  CHECK (fe_motivo_pendiente IS NULL OR char_length(fe_motivo_pendiente) BETWEEN 1 AND 4000);

ALTER TABLE public.credit_notes DROP CONSTRAINT IF EXISTS credit_notes_fe_motivo_pendiente_largo;
ALTER TABLE public.credit_notes ADD CONSTRAINT credit_notes_fe_motivo_pendiente_largo
  CHECK (fe_motivo_pendiente IS NULL OR char_length(fe_motivo_pendiente) BETWEEN 1 AND 4000);

COMMENT ON COLUMN public.invoices.fe_motivo_pendiente IS
  'Último motivo por el que el documento no se emitió o no se autorizó ante la DGI (validación previa, rechazo o conexión). NULL si no hay nada pendiente. 085.';
COMMENT ON COLUMN public.credit_notes.fe_motivo_pendiente IS
  'Último motivo por el que la NC no se emitió o no se autorizó ante la DGI. NULL si no hay nada pendiente. 085.';

DO $$
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name IN ('invoices', 'credit_notes')
         AND column_name IN ('fe_motivo_pendiente', 'fe_motivo_pendiente_en')) <> 4 THEN
    RAISE EXCEPTION '085: faltan columnas del motivo pendiente';
  END IF;
  RAISE NOTICE '085 ✅ fe_motivo_pendiente en facturas y notas de crédito';
END $$;

COMMIT;
