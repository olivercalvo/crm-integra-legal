-- ============================================================================
-- BACKFILL: client_type para clientes legacy con NULL (Integra)
-- ----------------------------------------------------------------------------
-- Corta la recurrencia del bug "Error interno" al emitir eFactura: un receptor
-- tipo 01/03 con client_type NULL crashea en el mapper (buildRucReceptor).
--
-- Esta corrida cubre los 26 casos INEQUÍVOCOS. Los 3 DUDOSOS quedan fuera, a la
-- espera de confirmación de las licenciadas (se cargan luego con un UPDATE de
-- una línea cada uno):
--    CLI-094 (ROLANDO MCLEAN Y FAMILIA)
--    CLI-068 (ASAMBLEA DE PROPIETARIOS PH LA HACIENDA)
--    CLI-093 (FOCUS GLOBAL ONTARIO CANADA)
--
-- Guardado por client_type IS NULL (idempotente). Ejecutar sentencia por sentencia.
-- Tenant Integra: a0000000-0000-0000-0000-000000000001
-- ============================================================================

-- 1) PREVIEW — todos los NULL actuales (deben ser 29: 26 a tocar + 3 dudosos)
SELECT client_number, name, client_type, tipo_receptor_fe, ruc
FROM clients
WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
  AND client_type IS NULL
ORDER BY client_number;

-- 2a) UPDATE — persona_juridica (7 casos: formas societarias / entidades)
UPDATE clients
SET client_type = 'persona_juridica'
WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
  AND client_type IS NULL
  AND client_number IN (
    'CLI-072','CLI-081','CLI-096','CLI-104',
    'CLI-106','CLI-108','CLI-109'
  );

-- 2b) UPDATE — persona_natural (19 casos: personas con cédula/pasaporte)
UPDATE clients
SET client_type = 'persona_natural'
WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
  AND client_type IS NULL
  AND client_number IN (
    'CLI-006','CLI-018','CLI-020','CLI-022','CLI-065','CLI-071',
    'CLI-074','CLI-075','CLI-076','CLI-077','CLI-078','CLI-091',
    'CLI-095','CLI-098','CLI-099','CLI-105','CLI-110','CLI-111',
    'CLI-117'
  );

-- 3) VERIFY — deben quedar EXACTAMENTE los 3 dudosos en NULL (CLI-068, 093, 094)
SELECT client_number, name, client_type, tipo_receptor_fe, ruc
FROM clients
WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
  AND client_type IS NULL
ORDER BY client_number;
