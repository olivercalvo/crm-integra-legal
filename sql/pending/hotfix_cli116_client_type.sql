-- ============================================================================
-- HOTFIX: CLI-116 client_type NULL bloquea emisión eFactura (FAC-REI-000039)
-- ----------------------------------------------------------------------------
-- Causa raíz: validateClientFiscalGate NO valida client_type; el mapper puro
-- (buildRucReceptor, map-receptor.ts:91) lanza Error plano cuando client_type
-- es NULL para un receptor tipo 01/03 → catch-all "Error interno" 500.
--
-- CLI-116 = "INMOBILIARIA CAMAY, S.A." → persona_juridica (es Sociedad Anónima),
-- tipo_receptor_fe = '01', RUC 10354-127-105722 DV 87.
--
-- Ejecutar en Supabase (SQL Editor), sentencia por sentencia.
-- Tenant Integra: a0000000-0000-0000-0000-000000000001
-- ============================================================================

-- 1) PREVIEW — estado actual (debe mostrar client_type = NULL)
SELECT client_number, name, client_type, tipo_receptor_fe, ruc, digito_verificador, client_status
FROM clients
WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
  AND client_number = 'CLI-116';

-- 2) UPDATE — guardado por client_type IS NULL (idempotente, no pisa un valor existente)
UPDATE clients
SET client_type = 'persona_juridica'
WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
  AND client_number = 'CLI-116'
  AND client_type IS NULL;

-- 3) VERIFY — debe mostrar client_type = 'persona_juridica'
SELECT client_number, name, client_type, tipo_receptor_fe, ruc, digito_verificador, client_status
FROM clients
WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
  AND client_number = 'CLI-116';
