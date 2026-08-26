-- =============================================================================
-- BACKFILL: DV embebido en texto → columna digito_verificador (+ limpieza + tipo)
-- Fecha: 2026-07-09
-- Tenant: a0000000-0000-0000-0000-000000000001
-- Protocolo: NO auto-ejecutar. Revisar y correr a mano en el SQL Editor de
--            Supabase, sentencia por sentencia. Sin BEGIN/COMMIT manual.
--
-- CONTEXTO / ALCANCE:
--   Algunas licenciadas cargaron el dígito verificador (DV) como texto libre al
--   final del número fiscal, con formato uniforme " DV NN". Este backfill:
--     1. Extrae el DV a la columna digito_verificador (SOBRESCRIBE lo previo).
--     2. Limpia el número dejando solo el identificador (sin " DV NN").
--     3. Puebla tipo_receptor_fe SOLO si está NULL (no sobrescribe).
--
--   IMPORTANTE — el DV embebido NO está solo en tax_id:
--     - CLI-026            → embebido en tax_id  ("25046169-3-2021  DV 40")
--     - CLI-081, CLI-096,
--       CLI-107 (HERMANI)  → embebido en ruc (legacy)  (tax_id vacío)
--   Por eso hay DOS updates: uno para tax_id y otro para ruc. Si solo se
--   filtrara tax_id ~ 'DV', HERMANI NO se corregiría.
--
--   Universo esperado (4 clientes con "DV NN" en tenant Integra, sin 0TEST):
--     CLI-026  25046169-3-2021  DV 40  → dv=40  · tipo 01
--     CLI-081  155701991-2-2021 DV 9   → dv=9   · tipo 01
--     CLI-096  42071-105-286474 DV 00  → dv=00  · tipo 01   (OJO: DV "00", raro; verificar)
--     CLI-107  155773283-2-2025 DV 21  → dv=21  · tipo 01   (HERMANI: corrige a 21)
--
--   Notas:
--   - digito_verificador se SOBRESCRIBE (por pedido: corregir HERMANI). Hoy los
--     4 tienen la columna en NULL, así que en la práctica solo pobla.
--   - Los clientes SIN "DV NN" NO se tocan (ni cédulas 02 ni RUC sin DV).
--   - Inferencia de tipo prioriza el FORMATO del número (RUC → 01) por sobre
--     client_type, porque client_type está mal cargado en la base (hay cédulas
--     marcadas como persona_juridica). Para estos 4 todos son RUC → 01.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0) ROLLBACK-CHECK (COMENTADO): guardar los valores ORIGINALES antes de correr.
--    Copiá el resultado a un lado; si hay que revertir, restaurás desde acá.
-- -----------------------------------------------------------------------------
-- SELECT client_number, name, tax_id, ruc, digito_verificador, tipo_receptor_fe
-- FROM clients
-- WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
--   AND client_number NOT ILIKE '%0TEST%'
--   AND COALESCE(name,'') NOT ILIKE '%prueba%'
--   AND (tax_id ~* 'DV\s*[0-9]+' OR ruc ~* 'DV\s*[0-9]+')
-- ORDER BY client_number;


-- -----------------------------------------------------------------------------
-- 1) VERIFICACIÓN ANTES: cuántas y cuáles filas se van a afectar + la
--    transformación exacta que hará cada update (sin aplicar nada todavía).
-- -----------------------------------------------------------------------------
SELECT
  client_number,
  name,
  CASE WHEN tax_id ~* 'DV\s*[0-9]+' THEN 'tax_id' ELSE 'ruc' END              AS campo_fuente,
  COALESCE(tax_id, ruc)                                                        AS valor_actual,
  regexp_replace(COALESCE(tax_id, ruc), '\s*DV\s*[0-9]+\s*$', '', 'i')         AS valor_limpio,
  (regexp_match(COALESCE(tax_id, ruc), 'DV\s*([0-9]+)', 'i'))[1]              AS dv_a_extraer,
  digito_verificador                                                           AS dv_actual,
  tipo_receptor_fe                                                             AS tipo_actual
FROM clients
WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
  AND client_number NOT ILIKE '%0TEST%'
  AND COALESCE(name,'') NOT ILIKE '%prueba%'
  AND (tax_id ~* 'DV\s*[0-9]+' OR ruc ~* 'DV\s*[0-9]+')
ORDER BY client_number;


-- -----------------------------------------------------------------------------
-- 2) UPDATE A — DV embebido en tax_id (CLI-026).
-- -----------------------------------------------------------------------------
UPDATE clients
SET
  digito_verificador = (regexp_match(tax_id, 'DV\s*([0-9]+)', 'i'))[1],
  tax_id             = regexp_replace(tax_id, '\s*DV\s*[0-9]+\s*$', '', 'i'),
  tipo_receptor_fe   = COALESCE(
    tipo_receptor_fe,
    CASE
      -- FORMATO RUC → 01 (más confiable que client_type):
      WHEN regexp_replace(tax_id, '\s*DV\s*[0-9]+\s*$', '', 'i')
           ~ '(-[0-9]-[0-9]{4}$|-NT-|^[0-9]{4,}-[0-9]{2,3}-[0-9]{4,}$)' THEN '01'
      WHEN client_type = 'persona_juridica' THEN '01'
      -- FORMATO cédula → 02:
      WHEN regexp_replace(tax_id, '\s*DV\s*[0-9]+\s*$', '', 'i')
           ~ '(^[0-9]{1,2}-[0-9]{1,4}-[0-9]{1,6}$|^(E|N|PE)-)' THEN '02'
      ELSE NULL  -- ambiguo: dejar NULL para revisión manual
    END
  )
WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
  AND client_number NOT ILIKE '%0TEST%'
  AND COALESCE(name,'') NOT ILIKE '%prueba%'
  AND tax_id ~* 'DV\s*[0-9]+';


-- -----------------------------------------------------------------------------
-- 3) UPDATE B — DV embebido en ruc legacy (CLI-081, CLI-096, CLI-107 HERMANI).
--    tax_id de estos está vacío; el número vive en ruc. Se limpia ruc en su
--    lugar (el gate y el mapper aceptan ruc como fallback de tax_id).
-- -----------------------------------------------------------------------------
UPDATE clients
SET
  digito_verificador = (regexp_match(ruc, 'DV\s*([0-9]+)', 'i'))[1],
  ruc                = regexp_replace(ruc, '\s*DV\s*[0-9]+\s*$', '', 'i'),
  tipo_receptor_fe   = COALESCE(
    tipo_receptor_fe,
    CASE
      WHEN regexp_replace(ruc, '\s*DV\s*[0-9]+\s*$', '', 'i')
           ~ '(-[0-9]-[0-9]{4}$|-NT-|^[0-9]{4,}-[0-9]{2,3}-[0-9]{4,}$)' THEN '01'
      WHEN client_type = 'persona_juridica' THEN '01'
      WHEN regexp_replace(ruc, '\s*DV\s*[0-9]+\s*$', '', 'i')
           ~ '(^[0-9]{1,2}-[0-9]{1,4}-[0-9]{1,6}$|^(E|N|PE)-)' THEN '02'
      ELSE NULL
    END
  )
WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
  AND client_number NOT ILIKE '%0TEST%'
  AND COALESCE(name,'') NOT ILIKE '%prueba%'
  AND ruc ~* 'DV\s*[0-9]+'
  -- Evitar doble proceso si (improbablemente) el DV estuviera también en tax_id:
  AND (tax_id IS NULL OR tax_id !~* 'DV\s*[0-9]+');


-- -----------------------------------------------------------------------------
-- 4) VERIFICACIÓN DESPUÉS: los 4 deben quedar con digito_verificador poblado,
--    número limpio (sin "DV"), y tipo_receptor_fe = '01'. Ninguno debería
--    seguir mostrando "DV" en tax_id ni ruc.
-- -----------------------------------------------------------------------------
SELECT
  client_number,
  name,
  tax_id,
  ruc,
  digito_verificador,
  tipo_receptor_fe,
  CASE
    WHEN COALESCE(tax_id,'') ~* 'DV' OR COALESCE(ruc,'') ~* 'DV'
      THEN 'ALERTA: quedó "DV" en el texto'
    WHEN digito_verificador IS NULL
      THEN 'ALERTA: DV no poblado'
    WHEN tipo_receptor_fe IS NULL
      THEN 'REVISAR: tipo_receptor_fe quedó NULL (formato ambiguo)'
    ELSE 'OK'
  END AS estado
FROM clients
WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
  AND client_number IN ('CLI-026','CLI-081','CLI-096','CLI-107')
ORDER BY client_number;
