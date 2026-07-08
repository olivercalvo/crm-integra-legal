-- =============================================================================
-- FEATURE: eFactura PTY (PAC DGI Panamá) — Fase 3: Allocator de correlativos
-- Sprint:  eFactura Integration — Fase 3 (RPC allocate_fe_numero)
-- Fecha:   2026-06-02
-- EJECUTADO en Supabase 2026-06-02 (allocator creado + grants)
-- Depende de: sql/pending/019_efactura_fase_1a_modelo_datos.sql (tabla
--             fe_secuencias ya creada en Fase 1A — aplicada en prod 2026-05-30).
--
-- Contexto:
--   La Fase 1A creó la tabla fe_secuencias con UNIQUE(tenant_id,
--   punto_facturacion) y ultimo_numero BIGINT DEFAULT 0, pero NO implementó
--   la lógica de asignación atómica. Esta migración agrega un único RPC,
--   `public.allocate_fe_numero(p_tenant_id UUID, p_punto_facturacion
--   VARCHAR(3)) RETURNS BIGINT`, que reserva el siguiente correlativo de
--   forma atómica (UPSERT con ON CONFLICT) y devuelve el número asignado.
--
--   Régimen de seguridad calcado de public.get_next_sequence_number()
--   (sprint Finanzas Batch 2): LANGUAGE plpgsql, SECURITY DEFINER,
--   SET search_path = public, REVOKE ALL FROM PUBLIC + GRANT EXECUTE TO
--   authenticated. La función bypassa RLS, así que el caller (typically
--   admin client en route handlers) debe pasar el p_tenant_id correcto;
--   mismo patrón que get_next_sequence_number.
--
--   Auto-create: la primera invocación para un (tenant, punto) nuevo
--   inserta la fila con ultimo_numero=1. Llamadas subsiguientes incrementan.
--   No hay "consumir desde 0"; el primer número emitido es 1, por
--   consistencia con la semántica DGI.
--
--   Out of scope (queda para fases posteriores):
--     - Reverso de números ante rechazo del PAC (pendiente confirmar política
--       eFactura: si el PAC "quema" el número o se reutiliza).
--     - Wrapper SECURITY DEFINER que combine allocate_fe_numero + INSERT en
--       fe_emisiones en una sola transacción atómica.
--     - Endpoint de emisión / generación de CUFE.
--
-- DECISIONES DE MODELADO
-- -----------------------------------------------------------------------------
--   - Estrategia atómica: UPSERT con ON CONFLICT ... DO UPDATE ... RETURNING.
--     Equivale a SELECT FOR UPDATE + UPDATE pero en un solo statement, y
--     funciona también para el caso de fila inexistente (auto-create).
--   - Guardrail formato: p_punto_facturacion debe ser exactamente 3 dígitos
--     numéricos (^[0-9]{3}$) y distinto de '000'. La columna ya es VARCHAR(3),
--     pero el regex protege contra letras o longitudes raras vía RPC.
--   - Retorno BIGINT: la columna ultimo_numero es BIGINT; respetamos el
--     ancho. invoices.numero_documento también es BIGINT (Fase 1A).
--
-- NOTA OPERATIVA (2026-06-02)
-- -----------------------------------------------------------------------------
--   Versión previa de este archivo envolvía el CREATE en BEGIN; ... COMMIT;
--   y traía un PRE-CHECK con RAISE EXCEPTION + un smoke test no comentado.
--   En el SQL Editor de Supabase el wrapper PRE-CHECK/COMMIT/smoke impedía
--   que la función persistiera (auto-rollback del lote). Este archivo es
--   la versión PELADA que sí quedó aplicada en prod: CREATE OR REPLACE
--   plano + REVOKE/GRANT, re-ejecutable y fiel a lo que vive en la base.
-- =============================================================================

-- =============================================================================
-- FUNCTION: public.allocate_fe_numero
-- -----------------------------------------------------------------------------
-- Reserva el siguiente correlativo de fe_secuencias para (tenant_id,
-- punto_facturacion) y lo devuelve. Atómico vía UPSERT.
--
-- - Primera invocación para un (tenant, punto) nuevo: INSERTA fila con
--   ultimo_numero=1 y retorna 1.
-- - Invocaciones posteriores: UPDATE incrementa ultimo_numero en 1 y retorna
--   el nuevo valor.
--
-- IMPORTANTE para callers (igual que get_next_sequence_number):
--   La función incrementa el contador inmediatamente. Si el INSERT en
--   invoices / fe_emisiones falla después, el número queda "quemado" y se
--   genera un gap. Para evitar gaps en producción, envolver allocate_fe_numero
--   + INSERT del documento en UNA misma transacción / función SECURITY DEFINER
--   (pendiente sprint posterior).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.allocate_fe_numero(
  p_tenant_id uuid,
  p_punto_facturacion varchar(3)
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next bigint;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'p_tenant_id no puede ser NULL'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_punto_facturacion !~ '^[0-9]{3}$' OR p_punto_facturacion = '000' THEN
    RAISE EXCEPTION 'punto_facturacion invalido (3 digitos, distinto de 000): %', p_punto_facturacion
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  INSERT INTO public.fe_secuencias (tenant_id, punto_facturacion, ultimo_numero)
  VALUES (p_tenant_id, p_punto_facturacion, 1)
  ON CONFLICT (tenant_id, punto_facturacion)
  DO UPDATE SET ultimo_numero = public.fe_secuencias.ultimo_numero + 1,
                updated_at = now()
  RETURNING ultimo_numero INTO v_next;

  RETURN v_next;
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_fe_numero(uuid, varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.allocate_fe_numero(uuid, varchar) TO authenticated;

-- =============================================================================
-- SMOKE TEST — *** OPCIONAL, CORRER POR SEPARADO ***
-- -----------------------------------------------------------------------------
-- NO ejecutar este bloque junto con el CREATE FUNCTION de arriba. Está
-- envuelto en BEGIN ... ROLLBACK para no contaminar fe_secuencias.
--
-- Para correrlo:
--   1. Asegurarse de que el CREATE OR REPLACE de arriba ya está aplicado
--      (la función vive en pg_proc y authenticated tiene EXECUTE).
--   2. Copiar SOLO el bloque BEGIN ... ROLLBACK de abajo a una pestaña nueva
--      del SQL Editor y ejecutarlo. Descomentar las líneas previamente.
--
-- Tenant de Integra Legal: a0000000-0000-0000-0000-000000000001.
-- Punto de prueba '999' — improbable que entre en conflicto con el real.
-- =============================================================================
-- BEGIN;
--   -- (a) Tres llamadas seguidas sobre el mismo punto → 1, 2, 3.
--   SELECT 'a' AS step,
--          public.allocate_fe_numero('a0000000-0000-0000-0000-000000000001', '999') AS numero;
--   SELECT 'b' AS step,
--          public.allocate_fe_numero('a0000000-0000-0000-0000-000000000001', '999') AS numero;
--   SELECT 'c' AS step,
--          public.allocate_fe_numero('a0000000-0000-0000-0000-000000000001', '999') AS numero;
--   -- Esperado: 1, 2, 3 en columna numero.
--
--   -- (d) Llamada con un punto distinto → auto-create en 1 (independiente).
--   SELECT 'd' AS step,
--          public.allocate_fe_numero('a0000000-0000-0000-0000-000000000001', '998') AS numero;
--   -- Esperado: 1.
--
--   -- (e) Estado final en fe_secuencias para los puntos de prueba.
--   SELECT punto_facturacion, ultimo_numero
--   FROM   fe_secuencias
--   WHERE  tenant_id = 'a0000000-0000-0000-0000-000000000001'
--     AND  punto_facturacion IN ('999', '998')
--   ORDER  BY punto_facturacion;
--   -- Esperado: ('998', 1) y ('999', 3).
--
--   -- (f) Validación de guardrails — cada uno debe RAISE EXCEPTION.
--   --     Ejecutar individualmente para observar el error.
--   -- SELECT public.allocate_fe_numero('a0000000-0000-0000-0000-000000000001', '000');   -- inválido (DGI no asigna 000)
--   -- SELECT public.allocate_fe_numero('a0000000-0000-0000-0000-000000000001', '1');     -- inválido (no son 3 dígitos)
--   -- SELECT public.allocate_fe_numero('a0000000-0000-0000-0000-000000000001', 'abc');   -- inválido (no son dígitos)
--   -- SELECT public.allocate_fe_numero(NULL, '001');                                     -- p_tenant_id NULL
-- ROLLBACK;
--
-- Tras el ROLLBACK las filas '999' y '998' deben desaparecer:
-- SELECT * FROM fe_secuencias WHERE punto_facturacion IN ('999','998');
-- Esperado: 0 filas.

-- =============================================================================
-- ROLLBACK (descomentar si fuera necesario revertir)
-- -----------------------------------------------------------------------------
-- Solo dropea la función. La tabla fe_secuencias y sus filas no se tocan.
-- =============================================================================
-- DROP FUNCTION IF EXISTS public.allocate_fe_numero(uuid, varchar);
