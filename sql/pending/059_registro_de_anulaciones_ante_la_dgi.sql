-- ============================================================================
-- 059 — `fe_anulaciones`: QUÉ LE PEDIMOS AL PAC Y QUÉ CONTESTÓ
-- ============================================================================
--
-- Bloque 9B (23/09/2026). Una tabla nueva, aditiva. No toca ninguna existente.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUÉ HACE FALTA UNA TABLA Y NO ALCANZA UNA COLUMNA
-- ─────────────────────────────────────────────────────────────────────────────
-- Anular ante la DGI es **PAC primero, libro después** (D3). Entre esas dos
-- cosas hay una ventana real en la que el documento puede estar muerto ante la
-- DGI y vivo en nuestro libro, y el proceso puede morirse justo ahí.
--
-- Cuando alguien vuelve a abrir esa factura, la pregunta que hay que poder
-- contestar es: **"¿ya le pedimos la anulación al PAC, y qué nos dijo?"**.
-- Una columna `anulada_en_dgi boolean` no la contesta: no distingue "nunca
-- preguntamos" de "preguntamos y no entendimos la respuesta", que son los dos
-- casos que llevan a decisiones opuestas — uno hay que reintentarlo y el otro
-- hay que mirarlo antes de tocar nada.
--
-- Es el mismo razonamiento por el que existe `fe_emisiones`, y esta tabla es su
-- espejo: mismas columnas de infraestructura, mismo FK con `ON DELETE CASCADE`,
-- misma política de RLS, mismo `intento` correlativo por factura.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 🔴 `resultado` INCLUYE 'indeterminada', Y ES EL VALOR MÁS IMPORTANTE
-- ─────────────────────────────────────────────────────────────────────────────
-- No sabemos cómo se ve un éxito de `POST /InvoiceEvents/CreateCancellation`:
-- el swagger declara `{codigo, mensaje}`, los dos `nullable`, sin `enum`, sin
-- `required` y sin una sola descripción. Ninguna respuesta real pasó todavía
-- por el código (pruebas de sandbox 5 y (a)).
--
-- Así que el clasificador tiene una clase `indeterminada` que significa
-- "el PAC contestó algo que no reconozco", y esta tabla la guarda **como un
-- estado de primera clase**, no como un error. Es lo que permite que, más
-- tarde, alguien lea `response_payload` y decida con la evidencia en la mano en
-- vez de volver a preguntarle al PAC a ciegas.
--
-- `sin_respuesta` es el otro caso honesto: la llamada se cortó (timeout, red) y
-- **no sabemos si llegó**. Se guarda ANTES de saber el resultado, justamente
-- para que un proceso que muere a mitad de camino deje rastro.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- LO QUE ESTA TABLA NO HACE
-- ─────────────────────────────────────────────────────────────────────────────
-- No decide nada. No hay trigger que toque `invoices.fe_estado` ni que dispare
-- la reversión del asiento: eso lo hace el orquestador, en la ruta, con el
-- cliente de servicio, porque el posteo al libro va por `post_journal_entry` y
-- ese camino está cerrado a la sesión del usuario desde la `030`.
--
-- Orden: después de la `20260507000001` (que crea `invoices.cancellation_reason`)
-- y de la que crea `fe_emisiones`. No depende de la `058`.
--
-- Reversible: `DROP TABLE public.fe_anulaciones;` — no hay dato de otra tabla
-- que dependa de ella.
-- ============================================================================

BEGIN;

-- ── Guardas de orden ────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema='public' AND table_name='invoices'
  ) THEN
    RAISE EXCEPTION '059: no existe public.invoices.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema='public' AND table_name='fe_emisiones'
  ) THEN
    RAISE EXCEPTION '059: no existe public.fe_emisiones. Esta tabla es su espejo: aplicar primero la de emisión.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.fe_anulaciones (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL DEFAULT get_tenant_id()
                       REFERENCES public.tenants(id) ON DELETE CASCADE,
  invoice_id         uuid NOT NULL
                       REFERENCES public.invoices(id) ON DELETE CASCADE,

  -- Correlativo por factura, como `fe_emisiones.intento`. Un segundo intento
  -- no pisa al primero: los dos quedan, y esa es la historia.
  intento            integer NOT NULL,

  -- El CUFE que se mandó. Se guarda acá y no se resuelve por join a propósito:
  -- es lo que REALMENTE viajó, aunque después alguien corrija la factura.
  cufe               text NOT NULL,

  -- El motivo tal como se envió. Mismo largo que `invoices.cancellation_reason`
  -- desde la `058`: 15 es el mínimo que exige la DGI (ideati, 22/09/2026).
  motivo             text NOT NULL,

  request_payload    jsonb,
  response_payload   jsonb,

  -- 🔴 Ver el encabezado. 'indeterminada' y 'sin_respuesta' NO son errores:
  --    son los dos estados honestos de "no sé".
  resultado          text NOT NULL,

  -- El ambiente en que se hizo. Mismo CHECK que `fe_emisiones`: 1 = producción
  -- DGI, 2 = sandbox. Sin esto, una anulación de prueba y una real se ven igual.
  i_amb              smallint,

  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid REFERENCES public.users(id),

  CONSTRAINT fe_anulaciones_intento_positive_check CHECK (intento >= 1),
  CONSTRAINT fe_anulaciones_i_amb_check CHECK (i_amb IS NULL OR i_amb = ANY (ARRAY[1, 2])),
  CONSTRAINT fe_anulaciones_motivo_largo CHECK (char_length(btrim(motivo)) BETWEEN 15 AND 1000),
  CONSTRAINT fe_anulaciones_cufe_no_vacio CHECK (char_length(btrim(cufe)) > 0),
  CONSTRAINT fe_anulaciones_resultado_check CHECK (
    resultado = ANY (ARRAY[
      'sin_respuesta',   -- se mandó y la llamada se cortó. NO sabemos si llegó.
      'indeterminada',   -- contestó algo que el clasificador no reconoce.
      'anulada',         -- el PAC confirmó la anulación.
      'ya_anulada',      -- el PAC dice que ya estaba anulada.
      'rechazada'        -- el PAC la rechazó.
    ])
  ),
  CONSTRAINT fe_anulaciones_un_intento_por_factura UNIQUE (invoice_id, intento)
);

CREATE INDEX IF NOT EXISTS idx_fe_anulaciones_tenant
  ON public.fe_anulaciones (tenant_id);

CREATE INDEX IF NOT EXISTS idx_fe_anulaciones_invoice
  ON public.fe_anulaciones (invoice_id, intento);

-- Las que quedaron sin resolver son la cola de trabajo de una persona: se
-- buscan por acá, no recorriendo toda la tabla.
CREATE INDEX IF NOT EXISTS idx_fe_anulaciones_sin_resolver
  ON public.fe_anulaciones (tenant_id, created_at)
  WHERE resultado IN ('sin_respuesta', 'indeterminada');

ALTER TABLE public.fe_anulaciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fe_anulaciones_tenant_isolation ON public.fe_anulaciones;
CREATE POLICY fe_anulaciones_tenant_isolation ON public.fe_anulaciones
  FOR ALL USING (tenant_id = get_tenant_id());

COMMENT ON TABLE public.fe_anulaciones IS
  'Qué le pedimos al PAC al anular una factura ante la DGI y qué contestó. '
  'Espejo de fe_emisiones. Existe porque anular es PAC primero y libro después: '
  'si el proceso muere en el medio, esta tabla es lo único que distingue "nunca '
  'preguntamos" de "preguntamos y no entendimos la respuesta".';

COMMENT ON COLUMN public.fe_anulaciones.resultado IS
  'sin_respuesta = la llamada se cortó y NO sabemos si llegó. indeterminada = el '
  'PAC contestó algo que el clasificador no reconoce. Ninguno de los dos es un '
  'error: son los estados honestos de "no sé", y son los que impiden que el '
  'orquestador revierta un asiento sobre una factura que sigue viva ante la DGI.';

COMMENT ON COLUMN public.fe_anulaciones.cufe IS
  'El CUFE que REALMENTE viajó, guardado acá y no resuelto por join, para que '
  'siga siendo verdad aunque después se corrija la factura.';

COMMIT;

-- ============================================================================
-- VERIFICACIÓN
-- ============================================================================
DO $$
DECLARE
  v_cols  int;
  v_chk   int;
  v_idx   int;
  v_rls   boolean;
  v_pol   int;
BEGIN
  SELECT count(*) INTO v_cols
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='fe_anulaciones';

  SELECT count(*) INTO v_chk
    FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
   WHERE t.relname='fe_anulaciones' AND c.contype='c';

  SELECT count(*) INTO v_idx FROM pg_indexes
   WHERE tablename='fe_anulaciones' AND schemaname='public';

  SELECT relrowsecurity INTO v_rls FROM pg_class WHERE relname='fe_anulaciones';

  SELECT count(*) INTO v_pol
    FROM pg_policy p JOIN pg_class t ON t.oid=p.polrelid
   WHERE t.relname='fe_anulaciones';

  RAISE NOTICE '─────────────────────────────────';
  RAISE NOTICE '059 — VERIFICACIÓN';
  RAISE NOTICE '  columnas .............. % (esperado 12)', v_cols;
  RAISE NOTICE '  CHECK ................. % (esperado 5)', v_chk;
  RAISE NOTICE '  índices ............... % (esperado 5: pkey + unique + 3)', v_idx;
  RAISE NOTICE '  RLS activo ............ %', v_rls;
  RAISE NOTICE '  políticas ............. % (esperado 1)', v_pol;
  RAISE NOTICE '─────────────────────────────────';

  IF v_cols <> 12 THEN RAISE EXCEPTION '059: se esperaban 12 columnas, hay %.', v_cols; END IF;
  IF v_chk  <> 5  THEN RAISE EXCEPTION '059: se esperaban 5 CHECK, hay %.', v_chk; END IF;
  IF NOT v_rls    THEN RAISE EXCEPTION '059: RLS no quedó activo.'; END IF;
  IF v_pol  <> 1  THEN RAISE EXCEPTION '059: se esperaba 1 política, hay %.', v_pol; END IF;
END $$;
