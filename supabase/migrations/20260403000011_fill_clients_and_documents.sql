-- ============================================================
-- COMPLETAR DATOS FICTICIOS — CRM Integra Legal
-- Fecha: 2026-04-03
-- Ejecutar en Supabase SQL Editor
--
-- 1. Completa TODOS los clientes con datos faltantes
--    (dirección, teléfono, RUC, correo, tipo, client_since, observaciones)
-- 2. Inserta documentos ficticios para todos los casos
-- ============================================================

DO $$
DECLARE
  v_tenant_id UUID := 'a0000000-0000-0000-0000-000000000001';
  v_abogada1_id UUID := 'd5cf61cb-2f1f-4e1b-8fd1-1db82dd16867'; -- Daveiva
  v_abogada2_id UUID := 'aefb05ce-871a-4f6a-a952-2e385dc45176'; -- Milena
  v_asistente1_id UUID := '01e10f7f-b937-47a3-a4d3-5f4ead894fa8'; -- Harry
  v_case RECORD;
BEGIN

-- ============================================================
-- 1. COMPLETAR CLIENTES — todos los campos
-- ============================================================

-- CLI-001 a CLI-010 ya tienen address y client_since del seed anterior.
-- Completamos phone, email, ruc, type, observations donde falten.

UPDATE clients SET
  phone = COALESCE(phone, CASE client_number
    WHEN 'CLI-001' THEN '+507 6100-1234'
    WHEN 'CLI-002' THEN '+507 6200-2345'
    WHEN 'CLI-003' THEN '+507 6300-3456'
    WHEN 'CLI-004' THEN '+507 6400-4567'
    WHEN 'CLI-005' THEN '+507 6500-5678'
    WHEN 'CLI-006' THEN '+507 6600-6789'
    WHEN 'CLI-007' THEN '+507 6700-7890'
    WHEN 'CLI-008' THEN '+507 6800-8901'
    WHEN 'CLI-009' THEN '+507 6900-9012'
    WHEN 'CLI-010' THEN '+507 6010-0123'
    WHEN 'CLI-011' THEN '+507 6011-1234'
    ELSE phone
  END),
  email = COALESCE(email, CASE client_number
    WHEN 'CLI-001' THEN 'info@grupopacifico.com.pa'
    WHEN 'CLI-002' THEN 'contacto@constructorasur.com.pa'
    WHEN 'CLI-003' THEN 'consultas@comercialglobal.com.pa'
    WHEN 'CLI-004' THEN 'legal@holdingcentral.com.pa'
    WHEN 'CLI-005' THEN 'rvelasquez@gmail.com'
    WHEN 'CLI-006' THEN 'fundacion@horizontes.org.pa'
    WHEN 'CLI-007' THEN 'mnakamura@outlook.com'
    WHEN 'CLI-008' THEN 'klopez@gmail.com'
    WHEN 'CLI-009' THEN 'agrotropical@gmail.com'
    WHEN 'CLI-010' THEN 'transportespanama@hotmail.com'
    WHEN 'CLI-011' THEN 'consultas@farmaciadelpueblo.com.pa'
    ELSE email
  END),
  ruc = COALESCE(ruc, CASE client_number
    WHEN 'CLI-001' THEN '15520-33-445566'
    WHEN 'CLI-002' THEN '25830-44-556677'
    WHEN 'CLI-003' THEN '35140-55-667788'
    WHEN 'CLI-004' THEN '45250-66-778899'
    WHEN 'CLI-005' THEN '8-765-4321'
    WHEN 'CLI-006' THEN 'ONG-2024-001'
    WHEN 'CLI-007' THEN 'PE-987654'
    WHEN 'CLI-008' THEN '8-543-2109'
    WHEN 'CLI-009' THEN '55360-77-889900'
    WHEN 'CLI-010' THEN '65470-88-990011'
    WHEN 'CLI-011' THEN '75580-99-001122'
    ELSE ruc
  END),
  type = COALESCE(type, CASE client_number
    WHEN 'CLI-001' THEN 'Corporativo'
    WHEN 'CLI-002' THEN 'Corporativo'
    WHEN 'CLI-003' THEN 'Corporativo'
    WHEN 'CLI-004' THEN 'Corporativo'
    WHEN 'CLI-005' THEN 'Persona Natural'
    WHEN 'CLI-006' THEN 'ONG'
    WHEN 'CLI-007' THEN 'Persona Natural'
    WHEN 'CLI-008' THEN 'Persona Natural'
    WHEN 'CLI-009' THEN 'Corporativo'
    WHEN 'CLI-010' THEN 'Corporativo'
    WHEN 'CLI-011' THEN 'Corporativo'
    ELSE type
  END),
  client_since = COALESCE(client_since, CASE client_number
    WHEN 'CLI-011' THEN '2025-05-10'::DATE
    WHEN 'CLI-012' THEN '2025-07-20'::DATE
    WHEN 'CLI-013' THEN '2025-08-15'::DATE
    WHEN 'CLI-014' THEN '2025-09-01'::DATE
    WHEN 'CLI-015' THEN '2025-10-12'::DATE
    WHEN 'CLI-016' THEN '2025-11-05'::DATE
    WHEN 'CLI-017' THEN '2025-12-01'::DATE
    WHEN 'CLI-018' THEN '2026-01-15'::DATE
    WHEN 'CLI-019' THEN '2026-01-28'::DATE
    WHEN 'CLI-020' THEN '2026-02-10'::DATE
    WHEN 'CLI-021' THEN '2026-02-20'::DATE
    WHEN 'CLI-022' THEN '2026-03-01'::DATE
    WHEN 'CLI-023' THEN '2026-03-10'::DATE
    ELSE client_since
  END),
  address = COALESCE(address, CASE client_number
    WHEN 'CLI-011' THEN 'Ave. Justo Arosemena, Edificio Farmacia del Pueblo, PB, Calidonia'
    WHEN 'CLI-012' THEN 'Vía Argentina, Edificio San Alberto, Apt. 3B, El Cangrejo'
    WHEN 'CLI-013' THEN 'Calle 73, San Francisco, Edificio Brisas del Mar, Of. 5A'
    WHEN 'CLI-014' THEN 'Ave. 12 de Octubre, Edificio Rosmary, Apt. 7C, Hato Pintado'
    WHEN 'CLI-015' THEN 'Vía Transistmica, Centro Comercial Los Pueblos, Local 22'
    WHEN 'CLI-016' THEN 'Calle Abel Bravo, El Cangrejo, Local 18'
    WHEN 'CLI-017' THEN 'Costa del Este, PH Punta Pacífica, Torre A, Apt. 22F'
    WHEN 'CLI-018' THEN 'Parque Lefevre, Calle 5ta, Casa 14'
    WHEN 'CLI-019' THEN 'Punta Pacífica, PH Ocean Two, Apt. 38B'
    WHEN 'CLI-020' THEN 'Juan Díaz, Residencial Villa del Lago, Casa 45'
    WHEN 'CLI-021' THEN 'Ave. Federico Boyd, Edificio Vértice, Of. 12, El Cangrejo'
    WHEN 'CLI-022' THEN 'Calle 50, Torres de las Américas, Torre B, Piso 30'
    WHEN 'CLI-023' THEN 'Vía Transistmica, Plaza Concordia, Local 8, Bethania'
    ELSE address
  END),
  observations = COALESCE(observations, CASE client_number
    WHEN 'CLI-001' THEN 'Grupo corporativo con múltiples subsidiarias. Cliente de alta prioridad. Reuniones mensuales programadas.'
    WHEN 'CLI-002' THEN 'Constructora con proyectos en Panamá Oeste. Litigios laborales recurrentes.'
    WHEN 'CLI-003' THEN 'Importadora de productos electrónicos. Consultas aduaneras frecuentes.'
    WHEN 'CLI-004' THEN 'Holding con inversiones en bienes raíces y turismo. Reestructuración societaria en curso.'
    WHEN 'CLI-005' THEN 'Persona natural con trámite migratorio. Pasaporte colombiano. Residencia permanente aprobada.'
    WHEN 'CLI-006' THEN 'Fundación sin fines de lucro. Pro bono parcial. Educación comunitaria.'
    WHEN 'CLI-007' THEN 'Nacional japonés con visa de inversionista. Restaurantes en Clayton y Casco Viejo.'
    WHEN 'CLI-008' THEN 'Demanda laboral por despido injustificado. Caso en etapa probatoria.'
    WHEN 'CLI-009' THEN 'Empresa agrícola en Chiriquí. Exportación de café y frutas tropicales.'
    WHEN 'CLI-010' THEN 'Empresa de transporte de carga. Renovación de permisos ATTT.'
    WHEN 'CLI-011' THEN 'Cadena de farmacias con 3 sucursales. Asesoría comercial y laboral.'
    ELSE observations
  END)
WHERE tenant_id = v_tenant_id;

-- ============================================================
-- 2. DOCUMENTOS FICTICIOS PARA TODOS LOS CASOS
-- ============================================================
-- Inserta documentos simulados (solo registros en DB, sin archivo real)
-- Cada caso tendrá 2-4 documentos con nombres realistas

FOR v_case IN
  SELECT id, case_code FROM cases WHERE tenant_id = v_tenant_id ORDER BY case_number
LOOP
  -- Documento 1: Contrato o poder según tipo de caso
  INSERT INTO documents (tenant_id, entity_type, entity_id, file_name, file_path, storage_key, uploaded_by, created_at)
  VALUES (
    v_tenant_id, 'case', v_case.id,
    CASE
      WHEN v_case.case_code LIKE 'CORP%' THEN 'Contrato_firmado.pdf'
      WHEN v_case.case_code LIKE 'MIG%' THEN 'Pasaporte_copia.pdf'
      WHEN v_case.case_code LIKE 'LAB%' THEN 'Contrato_laboral.pdf'
      WHEN v_case.case_code LIKE 'PEN%' THEN 'Denuncia_policial.pdf'
      WHEN v_case.case_code LIKE 'CIV%' THEN 'Demanda_civil.pdf'
      WHEN v_case.case_code LIKE 'ADM%' THEN 'Solicitud_administrativa.pdf'
      WHEN v_case.case_code LIKE 'REG%' THEN 'Formulario_registro.pdf'
      ELSE 'Documento_principal.pdf'
    END,
    'demo/' || v_case.id || '/doc1.pdf',
    'demo/' || v_case.id || '/doc1.pdf',
    v_abogada1_id,
    NOW() - INTERVAL '30 days'
  );

  -- Documento 2: Poder notarial
  INSERT INTO documents (tenant_id, entity_type, entity_id, file_name, file_path, storage_key, uploaded_by, created_at)
  VALUES (
    v_tenant_id, 'case', v_case.id,
    'Poder_notarial.pdf',
    'demo/' || v_case.id || '/poder.pdf',
    'demo/' || v_case.id || '/poder.pdf',
    v_abogada1_id,
    NOW() - INTERVAL '25 days'
  );

  -- Documento 3: Recibo de pago
  INSERT INTO documents (tenant_id, entity_type, entity_id, file_name, file_path, storage_key, uploaded_by, created_at)
  VALUES (
    v_tenant_id, 'case', v_case.id,
    'Recibo_pago_honorarios.jpg',
    'demo/' || v_case.id || '/recibo.jpg',
    'demo/' || v_case.id || '/recibo.jpg',
    v_asistente1_id,
    NOW() - INTERVAL '15 days'
  );

  -- Documento 4: Cédula o RUC del cliente
  INSERT INTO documents (tenant_id, entity_type, entity_id, file_name, file_path, storage_key, uploaded_by, created_at)
  VALUES (
    v_tenant_id, 'case', v_case.id,
    CASE
      WHEN v_case.case_code LIKE 'CORP%' THEN 'RUC_empresa.pdf'
      WHEN v_case.case_code LIKE 'MIG%' THEN 'Cedula_identidad.jpg'
      ELSE 'Identificacion_cliente.pdf'
    END,
    'demo/' || v_case.id || '/id.pdf',
    'demo/' || v_case.id || '/id.pdf',
    v_abogada2_id,
    NOW() - INTERVAL '20 days'
  );

  -- Documento 5 (solo algunos casos): resolución o acta
  IF v_case.case_code LIKE 'CORP%' OR v_case.case_code LIKE 'ADM%' OR v_case.case_code LIKE 'REG%' THEN
    INSERT INTO documents (tenant_id, entity_type, entity_id, file_name, file_path, storage_key, uploaded_by, created_at)
    VALUES (
      v_tenant_id, 'case', v_case.id,
      CASE
        WHEN v_case.case_code LIKE 'CORP%' THEN 'Acta_junta_directiva.pdf'
        WHEN v_case.case_code LIKE 'ADM%' THEN 'Resolucion_administrativa.pdf'
        WHEN v_case.case_code LIKE 'REG%' THEN 'Certificado_registro.pdf'
      END,
      'demo/' || v_case.id || '/extra.pdf',
      'demo/' || v_case.id || '/extra.pdf',
      v_abogada1_id,
      NOW() - INTERVAL '10 days'
    );
  END IF;

  -- Documento 6 (solo algunos): fotos o evidencia
  IF v_case.case_code LIKE 'LAB%' OR v_case.case_code LIKE 'PEN%' OR v_case.case_code LIKE 'CIV%' THEN
    INSERT INTO documents (tenant_id, entity_type, entity_id, file_name, file_path, storage_key, uploaded_by, created_at)
    VALUES (
      v_tenant_id, 'case', v_case.id,
      CASE
        WHEN v_case.case_code LIKE 'LAB%' THEN 'Liquidacion_laboral.xlsx'
        WHEN v_case.case_code LIKE 'PEN%' THEN 'Evidencia_fotografica.zip'
        WHEN v_case.case_code LIKE 'CIV%' THEN 'Peritaje_tecnico.pdf'
      END,
      'demo/' || v_case.id || '/evidence.pdf',
      'demo/' || v_case.id || '/evidence.pdf',
      v_asistente1_id,
      NOW() - INTERVAL '5 days'
    );
  END IF;

END LOOP;

-- ============================================================
-- 3. DOCUMENTOS FICTICIOS PARA ALGUNOS CLIENTES
-- ============================================================
INSERT INTO documents (tenant_id, entity_type, entity_id, file_name, file_path, storage_key, uploaded_by, created_at)
SELECT
  v_tenant_id, 'client', c.id,
  CASE (ROW_NUMBER() OVER (ORDER BY c.client_number)) % 4
    WHEN 0 THEN 'Cedula_representante_legal.jpg'
    WHEN 1 THEN 'RUC_certificado.pdf'
    WHEN 2 THEN 'Carta_autorizacion.pdf'
    WHEN 3 THEN 'Acta_constitutiva.pdf'
  END,
  'demo/clients/' || c.id || '/doc.pdf',
  'demo/clients/' || c.id || '/doc.pdf',
  v_abogada1_id,
  NOW() - INTERVAL '40 days'
FROM clients c
WHERE c.tenant_id = v_tenant_id
  AND NOT EXISTS (
    SELECT 1 FROM documents d WHERE d.entity_type = 'client' AND d.entity_id = c.id
  );

RAISE NOTICE 'Datos ficticios completados exitosamente.';

END $$;
