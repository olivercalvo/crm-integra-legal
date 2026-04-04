-- ============================================================
-- DATOS FICTICIOS COMPLETOS — CRM Integra Legal
-- Fecha: 2026-04-03
-- Ejecutar en Supabase SQL Editor
-- Completa clientes existentes + agrega nuevos sin casos
-- ============================================================

DO $$
DECLARE
  v_tenant_id UUID := 'a0000000-0000-0000-0000-000000000001';
  v_abogada1_id UUID := 'd5cf61cb-2f1f-4e1b-8fd1-1db82dd16867'; -- Daveiva
  v_abogada2_id UUID := 'aefb05ce-871a-4f6a-a952-2e385dc45176'; -- Milena
  v_asistente1_id UUID := '01e10f7f-b937-47a3-a4d3-5f4ead894fa8'; -- Harry
  v_next_num INT;
BEGIN

-- ============================================================
-- 1. COMPLETAR CLIENTES EXISTENTES (datos faltantes)
-- ============================================================

UPDATE clients SET
  phone = COALESCE(phone, CASE client_number
    WHEN 'CLI-012' THEN '+507 6234-8901'
    WHEN 'CLI-013' THEN '+507 6345-6789'
    WHEN 'CLI-014' THEN '+507 6456-2345'
    WHEN 'CLI-015' THEN '+507 6567-3456'
    WHEN 'CLI-016' THEN '+507 6678-4567'
    WHEN 'CLI-017' THEN '+507 6789-5678'
    WHEN 'CLI-018' THEN '+507 6890-6789'
    WHEN 'CLI-019' THEN '+507 6901-7890'
    WHEN 'CLI-020' THEN '+507 6012-8901'
    WHEN 'CLI-021' THEN '+507 6123-9012'
    WHEN 'CLI-022' THEN '+507 6234-0123'
    ELSE phone
  END),
  email = COALESCE(email, CASE client_number
    WHEN 'CLI-012' THEN 'dalvarado@gmail.com'
    WHEN 'CLI-013' THEN 'mmercado@outlook.com'
    WHEN 'CLI-014' THEN 'amartinez@hotmail.com'
    WHEN 'CLI-015' THEN 'mchacon@gmail.com'
    WHEN 'CLI-016' THEN 'yjaafar@hotmail.com'
    WHEN 'CLI-017' THEN 'ytawachi@gmail.com'
    WHEN 'CLI-018' THEN 'ngaleano@gmail.com'
    WHEN 'CLI-019' THEN 'scunha@outlook.com'
    WHEN 'CLI-020' THEN 'fmorales@gmail.com'
    WHEN 'CLI-021' THEN 'farias@gmail.com'
    WHEN 'CLI-022' THEN 'rmizrachi@hotmail.com'
    ELSE email
  END),
  type = COALESCE(type, CASE client_number
    WHEN 'CLI-018' THEN 'Persona Natural'
    WHEN 'CLI-020' THEN 'Persona Natural'
    WHEN 'CLI-022' THEN 'Persona Natural'
    ELSE 'Corporativo'
  END),
  ruc = COALESCE(ruc, CASE client_number
    WHEN 'CLI-012' THEN '8-812-1456'
    WHEN 'CLI-013' THEN '8-845-2789'
    WHEN 'CLI-018' THEN 'PE-123456'
    WHEN 'CLI-020' THEN '8-901-3456'
    ELSE ruc
  END),
  observations = COALESCE(observations, CASE client_number
    WHEN 'CLI-012' THEN 'Cliente referido por bufete asociado. Trámites migratorios.'
    WHEN 'CLI-013' THEN 'Asuntos de propiedad intelectual y marcas registradas.'
    WHEN 'CLI-014' THEN 'Litigio civil por incumplimiento contractual.'
    WHEN 'CLI-015' THEN 'Trámite de residencia permanente. Documentación pendiente.'
    WHEN 'CLI-016' THEN 'Permiso de trabajo y visa de inversionista. Restaurante en El Cangrejo.'
    WHEN 'CLI-017' THEN 'Constitución de sociedad y apertura de cuenta corporativa.'
    WHEN 'CLI-018' THEN 'Regularización migratoria. Residente temporal vencido.'
    WHEN 'CLI-019' THEN 'Visa de inversionista calificado. Inversión en bienes raíces.'
    WHEN 'CLI-020' THEN 'Demanda laboral contra ex empleador. Salarios caídos.'
    WHEN 'CLI-021' THEN 'Renovación de permisos comerciales y licencias.'
    WHEN 'CLI-022' THEN 'Asesoría tributaria y planificación patrimonial.'
    WHEN 'CLI-023' THEN 'Trámites comerciales y constitución de empresa.'
    ELSE observations
  END),
  address = CASE
    WHEN address = 'Ciudad de Panamá' AND client_number = 'CLI-021' THEN 'Ave. Federico Boyd, Edificio Vértice, Of. 12, El Cangrejo'
    WHEN address = 'Ciudad de Panamá' AND client_number = 'CLI-022' THEN 'Calle 50, Torres de las Américas, Torre B, Piso 30'
    WHEN address = 'Ciudad de Panamá' AND client_number = 'CLI-023' THEN 'Vía Transistmica, Plaza Concordia, Local 8, Bethania'
    ELSE address
  END
WHERE tenant_id = v_tenant_id;

-- ============================================================
-- 2. AGREGAR CLIENTES NUEVOS SIN CASOS (solo registrados)
-- ============================================================

SELECT COALESCE(MAX(CAST(REPLACE(client_number, 'CLI-', '') AS INT)), 0) + 1
INTO v_next_num FROM clients WHERE tenant_id = v_tenant_id;

INSERT INTO clients (tenant_id, client_number, name, phone, ruc, email, type, address, client_since, observations, active) VALUES
  (v_tenant_id, 'CLI-' || LPAD(v_next_num::TEXT, 3, '0'), 'Panadería La Tradición, S.A.', '+507 6111-2233', '55670-22-334455', 'jtorres@latradicion.com.pa', 'Corporativo', 'Ave. Central, Calidonia, Local 45', '2026-03-01', 'Panadería con 5 sucursales. Consulta inicial sobre contratos laborales. Aún sin expediente.', true),
  (v_tenant_id, 'CLI-' || LPAD((v_next_num+1)::TEXT, 3, '0'), 'Roberto Enrique Sánchez Pitti', '+507 6222-3344', '8-955-2341', 'rsanchez@yahoo.com', 'Persona Natural', 'Calle 3ra, Casco Viejo, Casa 12', '2026-03-10', 'Consulta sobre herencia y sucesión. Pendiente evaluación del caso.', true),
  (v_tenant_id, 'CLI-' || LPAD((v_next_num+2)::TEXT, 3, '0'), 'Inversiones Atlántico, S.A.', '+507 6333-4455', '72100-55-667788', 'mrodriguez@invatlantic.com', 'Corporativo', 'Colón, Zona Libre, Edificio France Field, Of. 201', '2026-03-15', 'Empresa de Zona Libre. Interesada en asesoría aduanera. Sin caso abierto aún.', true),
  (v_tenant_id, 'CLI-' || LPAD((v_next_num+3)::TEXT, 3, '0'), 'Carmen Beatriz Valdés de León', '+507 6444-5566', '2-123-4567', 'cbvaldes@gmail.com', 'Persona Natural', 'David, Chiriquí, Urbanización Los Jardines, Casa 8', '2026-03-20', 'Divorcio por mutuo acuerdo. Consulta telefónica realizada, pendiente cita presencial.', true),
  (v_tenant_id, 'CLI-' || LPAD((v_next_num+4)::TEXT, 3, '0'), 'Hotel Boutique Casco Colonial, S.A.', '+507 6555-6677', '38900-10-112233', 'gerencia@cascohotel.com.pa', 'Corporativo', 'Casco Antiguo, Calle 8va, Casa 22', '2026-02-15', 'Hotel boutique en Casco Viejo. Consulta sobre permisos municipales y contrato de arrendamiento. Evaluando.', true),
  (v_tenant_id, 'CLI-' || LPAD((v_next_num+5)::TEXT, 3, '0'), 'José Miguel Araúz Córdoba', '+507 6666-7788', '9-234-5678', 'jmarauz@outlook.com', 'Persona Natural', 'Santiago, Veraguas, Barriada San Martín, Casa 15', '2026-03-25', 'Accidente de tránsito. Reclamo de seguro. Pendiente revisión de póliza.', true),
  (v_tenant_id, 'CLI-' || LPAD((v_next_num+6)::TEXT, 3, '0'), 'Asociación de Productores del Darién', '+507 6777-8899', '63200-88-445566', 'aprodarien@gmail.com', 'ONG', 'Metetí, Darién, Centro Comunitario', '2026-02-28', 'ONG agrícola. Pro bono. Consulta sobre titulación de tierras. Sin expediente abierto.', true)
ON CONFLICT DO NOTHING;

-- ============================================================
-- 3. COMPLETAR CASOS EXISTENTES — campos vacíos
-- ============================================================

UPDATE cases SET
  entity = COALESCE(entity, CASE case_number % 5
    WHEN 0 THEN 'Registro Público de Panamá'
    WHEN 1 THEN 'Servicio Nacional de Migración'
    WHEN 2 THEN 'Junta de Conciliación y Decisión'
    WHEN 3 THEN 'Tribunal Superior de Trabajo'
    WHEN 4 THEN 'ANATI'
  END),
  procedure_type = COALESCE(procedure_type, CASE case_number % 6
    WHEN 0 THEN 'Constitución de Sociedad'
    WHEN 1 THEN 'Permiso de Residencia'
    WHEN 2 THEN 'Demanda Laboral'
    WHEN 3 THEN 'Transferencia de Título'
    WHEN 4 THEN 'Registro de Marca'
    WHEN 5 THEN 'Proceso Contencioso'
  END),
  institution_procedure_number = COALESCE(institution_procedure_number, 'PROC-' || LPAD((case_number * 7 + 100)::TEXT, 5, '0')),
  institution_case_number = COALESCE(institution_case_number, 'EXP-' || LPAD((case_number * 3 + 200)::TEXT, 5, '0')),
  case_start_date = COALESCE(case_start_date, opened_at::DATE),
  procedure_start_date = COALESCE(procedure_start_date, (opened_at::DATE + INTERVAL '7 days')::DATE),
  deadline = COALESCE(deadline, (opened_at::DATE + INTERVAL '90 days')::DATE),
  physical_location = COALESCE(physical_location, CASE case_number % 4
    WHEN 0 THEN 'Archivo Principal — Gaveta A-' || (case_number % 10 + 1)
    WHEN 1 THEN 'Oficina Daveiva — Estante 2, Carpeta ' || case_number
    WHEN 2 THEN 'Oficina Milena — Estante 1, Carpeta ' || case_number
    WHEN 3 THEN 'Archivo Digital — Drive Integra/Casos/' || case_number
  END)
WHERE tenant_id = v_tenant_id;

END $$;
