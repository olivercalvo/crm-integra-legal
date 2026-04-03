-- =============================================================
-- CRM Integra Legal — Datos ficticios completos para demo/testing
-- Ejecutar contra Supabase con service_role key
-- =============================================================

-- Primero, obtenemos el tenant_id y user_ids existentes
-- Asumimos que ya existe un tenant y al menos un usuario admin/abogada

-- ==================== VARIABLES =============================
-- Estas queries usan subconsultas para obtener los IDs dinámicamente

-- ==================== CLIENTES ==============================

-- Verificar que existen clientes; si no, insertarlos
-- Actualizar los clientes existentes con datos completos

DO $$
DECLARE
  v_tenant_id UUID;
  v_admin_id UUID;
  v_client_ids UUID[];
  v_case_ids UUID[];
  v_status_activo UUID;
  v_status_tramite UUID;
  v_status_cerrado UUID;
  v_class_corp UUID;
  v_class_mig UUID;
  v_class_lab UUID;
  v_class_pen UUID;
  v_class_civ UUID;
  v_class_adm UUID;
  v_class_reg UUID;
  v_inst_rp UUID;
  v_inst_mici UUID;
  v_inst_minsa UUID;
  v_inst_mig UUID;
  v_inst_mun UUID;
  v_team_dave UUID;
  v_team_mile UUID;
  v_team_carlos UUID;
  v_team_ana UUID;
  v_i INT;
  v_cid UUID;
  v_caseid UUID;
BEGIN
  -- Get tenant
  SELECT id INTO v_tenant_id FROM tenants LIMIT 1;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'No tenant found. Create a tenant first.';
  END IF;

  -- Get first admin/abogada user
  SELECT id INTO v_admin_id FROM users WHERE tenant_id = v_tenant_id LIMIT 1;
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'No user found. Create a user first.';
  END IF;

  -- ==================== CATALOGOS ==============================
  -- Statuses
  SELECT id INTO v_status_activo FROM cat_statuses WHERE tenant_id = v_tenant_id AND name ILIKE '%activ%' LIMIT 1;
  SELECT id INTO v_status_tramite FROM cat_statuses WHERE tenant_id = v_tenant_id AND name ILIKE '%trámite%' LIMIT 1;
  IF v_status_tramite IS NULL THEN
    SELECT id INTO v_status_tramite FROM cat_statuses WHERE tenant_id = v_tenant_id AND name ILIKE '%tramite%' LIMIT 1;
  END IF;
  SELECT id INTO v_status_cerrado FROM cat_statuses WHERE tenant_id = v_tenant_id AND name ILIKE '%cerrad%' LIMIT 1;

  -- If no statuses, create them
  IF v_status_activo IS NULL THEN
    INSERT INTO cat_statuses (tenant_id, name, active) VALUES (v_tenant_id, 'Activo', true) RETURNING id INTO v_status_activo;
  END IF;
  IF v_status_tramite IS NULL THEN
    INSERT INTO cat_statuses (tenant_id, name, active) VALUES (v_tenant_id, 'En trámite', true) RETURNING id INTO v_status_tramite;
  END IF;
  IF v_status_cerrado IS NULL THEN
    INSERT INTO cat_statuses (tenant_id, name, active) VALUES (v_tenant_id, 'Cerrado', true) RETURNING id INTO v_status_cerrado;
  END IF;

  -- Classifications
  SELECT id INTO v_class_corp FROM cat_classifications WHERE tenant_id = v_tenant_id AND prefix = 'CORP' LIMIT 1;
  IF v_class_corp IS NULL THEN
    INSERT INTO cat_classifications (tenant_id, name, prefix, active) VALUES (v_tenant_id, 'Corporativo', 'CORP', true) RETURNING id INTO v_class_corp;
  END IF;
  SELECT id INTO v_class_mig FROM cat_classifications WHERE tenant_id = v_tenant_id AND prefix = 'MIG' LIMIT 1;
  IF v_class_mig IS NULL THEN
    INSERT INTO cat_classifications (tenant_id, name, prefix, active) VALUES (v_tenant_id, 'Migración', 'MIG', true) RETURNING id INTO v_class_mig;
  END IF;
  SELECT id INTO v_class_lab FROM cat_classifications WHERE tenant_id = v_tenant_id AND prefix = 'LAB' LIMIT 1;
  IF v_class_lab IS NULL THEN
    INSERT INTO cat_classifications (tenant_id, name, prefix, active) VALUES (v_tenant_id, 'Laboral', 'LAB', true) RETURNING id INTO v_class_lab;
  END IF;
  SELECT id INTO v_class_pen FROM cat_classifications WHERE tenant_id = v_tenant_id AND prefix = 'PEN' LIMIT 1;
  IF v_class_pen IS NULL THEN
    INSERT INTO cat_classifications (tenant_id, name, prefix, active) VALUES (v_tenant_id, 'Penal', 'PEN', true) RETURNING id INTO v_class_pen;
  END IF;
  SELECT id INTO v_class_civ FROM cat_classifications WHERE tenant_id = v_tenant_id AND prefix = 'CIV' LIMIT 1;
  IF v_class_civ IS NULL THEN
    INSERT INTO cat_classifications (tenant_id, name, prefix, active) VALUES (v_tenant_id, 'Civil', 'CIV', true) RETURNING id INTO v_class_civ;
  END IF;
  SELECT id INTO v_class_adm FROM cat_classifications WHERE tenant_id = v_tenant_id AND prefix = 'ADM' LIMIT 1;
  IF v_class_adm IS NULL THEN
    INSERT INTO cat_classifications (tenant_id, name, prefix, active) VALUES (v_tenant_id, 'Administrativo', 'ADM', true) RETURNING id INTO v_class_adm;
  END IF;
  SELECT id INTO v_class_reg FROM cat_classifications WHERE tenant_id = v_tenant_id AND prefix = 'REG' LIMIT 1;
  IF v_class_reg IS NULL THEN
    INSERT INTO cat_classifications (tenant_id, name, prefix, active) VALUES (v_tenant_id, 'Regulatorio', 'REG', true) RETURNING id INTO v_class_reg;
  END IF;

  -- Institutions
  SELECT id INTO v_inst_rp FROM cat_institutions WHERE tenant_id = v_tenant_id AND name ILIKE '%Registro Público%' LIMIT 1;
  IF v_inst_rp IS NULL THEN
    INSERT INTO cat_institutions (tenant_id, name, active) VALUES (v_tenant_id, 'Registro Público', true) RETURNING id INTO v_inst_rp;
  END IF;
  SELECT id INTO v_inst_mici FROM cat_institutions WHERE tenant_id = v_tenant_id AND name ILIKE '%MICI%' LIMIT 1;
  IF v_inst_mici IS NULL THEN
    INSERT INTO cat_institutions (tenant_id, name, active) VALUES (v_tenant_id, 'MICI', true) RETURNING id INTO v_inst_mici;
  END IF;
  SELECT id INTO v_inst_minsa FROM cat_institutions WHERE tenant_id = v_tenant_id AND name ILIKE '%MINSA%' LIMIT 1;
  IF v_inst_minsa IS NULL THEN
    INSERT INTO cat_institutions (tenant_id, name, active) VALUES (v_tenant_id, 'MINSA', true) RETURNING id INTO v_inst_minsa;
  END IF;
  SELECT id INTO v_inst_mig FROM cat_institutions WHERE tenant_id = v_tenant_id AND name ILIKE '%Migración%' LIMIT 1;
  IF v_inst_mig IS NULL THEN
    INSERT INTO cat_institutions (tenant_id, name, active) VALUES (v_tenant_id, 'Servicio Nacional de Migración', true) RETURNING id INTO v_inst_mig;
  END IF;
  SELECT id INTO v_inst_mun FROM cat_institutions WHERE tenant_id = v_tenant_id AND name ILIKE '%Municipio%' LIMIT 1;
  IF v_inst_mun IS NULL THEN
    INSERT INTO cat_institutions (tenant_id, name, active) VALUES (v_tenant_id, 'Municipio de Panamá', true) RETURNING id INTO v_inst_mun;
  END IF;

  -- Team members
  SELECT id INTO v_team_dave FROM cat_team WHERE tenant_id = v_tenant_id AND name ILIKE '%Daveiva%' LIMIT 1;
  IF v_team_dave IS NULL THEN
    INSERT INTO cat_team (tenant_id, name, role, active) VALUES (v_tenant_id, 'Daveiva Morales', 'abogada', true) RETURNING id INTO v_team_dave;
  END IF;
  SELECT id INTO v_team_mile FROM cat_team WHERE tenant_id = v_tenant_id AND name ILIKE '%Milena%' LIMIT 1;
  IF v_team_mile IS NULL THEN
    INSERT INTO cat_team (tenant_id, name, role, active) VALUES (v_tenant_id, 'Milena Rodríguez', 'abogada', true) RETURNING id INTO v_team_mile;
  END IF;
  SELECT id INTO v_team_carlos FROM cat_team WHERE tenant_id = v_tenant_id AND name ILIKE '%Carlos%' LIMIT 1;
  IF v_team_carlos IS NULL THEN
    INSERT INTO cat_team (tenant_id, name, role, active) VALUES (v_tenant_id, 'Carlos Pérez', 'asistente', true) RETURNING id INTO v_team_carlos;
  END IF;
  SELECT id INTO v_team_ana FROM cat_team WHERE tenant_id = v_tenant_id AND name ILIKE '%Ana%' LIMIT 1;
  IF v_team_ana IS NULL THEN
    INSERT INTO cat_team (tenant_id, name, role, active) VALUES (v_tenant_id, 'Ana Vega', 'asistente', true) RETURNING id INTO v_team_ana;
  END IF;

  -- ==================== CLIENTES ==============================
  -- Delete existing demo clients to avoid duplicates, then re-insert
  -- We'll use client_number to identify demo data

  -- Client 1: Empresa grande corporativa
  INSERT INTO clients (tenant_id, client_number, name, ruc, type, contact, phone, email, observations, active)
  VALUES (v_tenant_id, 'CLI-001', 'Grupo Empresarial del Pacífico, S.A.', '155608-1-830421', 'Corporativo', 'Roberto Méndez (Gerente General)', '+507 6645-1234', 'rmendez@gepsa.com.pa', 'Cliente desde 2024. Grupo diversificado: construcción, importación, retail. Facturación anual >$5M. Contacto principal prefiere WhatsApp.', true)
  ON CONFLICT (tenant_id, client_number) DO UPDATE SET
    name = EXCLUDED.name, ruc = EXCLUDED.ruc, type = EXCLUDED.type, contact = EXCLUDED.contact,
    phone = EXCLUDED.phone, email = EXCLUDED.email, observations = EXCLUDED.observations;

  -- Client 2
  INSERT INTO clients (tenant_id, client_number, name, ruc, type, contact, phone, email, observations, active)
  VALUES (v_tenant_id, 'CLI-002', 'María Fernanda Castro Herrera', '8-842-1567', 'Persona Natural', 'María Fernanda Castro', '+507 6789-4321', 'mfcastro@gmail.com', 'Abogada independiente que requiere apoyo en temas migratorios para sus clientes. Referida por Daveiva.', true)
  ON CONFLICT (tenant_id, client_number) DO UPDATE SET
    name = EXCLUDED.name, ruc = EXCLUDED.ruc, type = EXCLUDED.type, contact = EXCLUDED.contact,
    phone = EXCLUDED.phone, email = EXCLUDED.email, observations = EXCLUDED.observations;

  -- Client 3
  INSERT INTO clients (tenant_id, client_number, name, ruc, type, contact, phone, email, observations, active)
  VALUES (v_tenant_id, 'CLI-003', 'Constructora Istmeña, S.A.', '10230-12-567890', 'Corporativo', 'Ing. Tomás Ríos', '+507 6234-5678', 'trios@constristmena.com', 'Empresa constructora mediana. Proyectos residenciales en Panamá Oeste. Requiere permisos municipales frecuentes.', true)
  ON CONFLICT (tenant_id, client_number) DO UPDATE SET
    name = EXCLUDED.name, ruc = EXCLUDED.ruc, type = EXCLUDED.type, contact = EXCLUDED.contact,
    phone = EXCLUDED.phone, email = EXCLUDED.email, observations = EXCLUDED.observations;

  -- Client 4
  INSERT INTO clients (tenant_id, client_number, name, ruc, type, contact, phone, email, observations, active)
  VALUES (v_tenant_id, 'CLI-004', 'Importadora Chen & Asociados, S.A.', '50307-42-123456', 'Corporativo', 'Wei Chen', '+507 6345-8899', 'wchen@chenimport.com', 'Importadora de productos electrónicos. Zona Libre de Colón. Temas migratorios y corporativos frecuentes.', true)
  ON CONFLICT (tenant_id, client_number) DO UPDATE SET
    name = EXCLUDED.name, ruc = EXCLUDED.ruc, type = EXCLUDED.type, contact = EXCLUDED.contact,
    phone = EXCLUDED.phone, email = EXCLUDED.email, observations = EXCLUDED.observations;

  -- Client 5
  INSERT INTO clients (tenant_id, client_number, name, ruc, type, contact, phone, email, observations, active)
  VALUES (v_tenant_id, 'CLI-005', 'Luis Alberto Quintero Batista', '6-710-2234', 'Persona Natural', 'Luis Quintero', '+507 6901-2345', 'lquintero@hotmail.com', 'Trabajador despedido. Caso laboral por despido injustificado. Recursos limitados, se le ofreció tarifa reducida.', true)
  ON CONFLICT (tenant_id, client_number) DO UPDATE SET
    name = EXCLUDED.name, ruc = EXCLUDED.ruc, type = EXCLUDED.type, contact = EXCLUDED.contact,
    phone = EXCLUDED.phone, email = EXCLUDED.email, observations = EXCLUDED.observations;

  -- Client 6
  INSERT INTO clients (tenant_id, client_number, name, ruc, type, contact, phone, email, observations, active)
  VALUES (v_tenant_id, 'CLI-006', 'Farmacia San Judas, S.A.', '25640-80-654321', 'Corporativo', 'Dra. Carmen Delgado', '+507 6456-7890', 'cdelgado@farmaciasanjudas.com', 'Cadena de 3 farmacias en Ciudad de Panamá. Requiere permisos MINSA y temas regulatorios.', true)
  ON CONFLICT (tenant_id, client_number) DO UPDATE SET
    name = EXCLUDED.name, ruc = EXCLUDED.ruc, type = EXCLUDED.type, contact = EXCLUDED.contact,
    phone = EXCLUDED.phone, email = EXCLUDED.email, observations = EXCLUDED.observations;

  -- Client 7
  INSERT INTO clients (tenant_id, client_number, name, ruc, type, contact, phone, email, observations, active)
  VALUES (v_tenant_id, 'CLI-007', 'Restaurante El Trapiche Colonial, S.A.', '30550-15-987654', 'Corporativo', 'José Manuel Barría', '+507 6567-1122', 'jbarria@eltrapiche.com.pa', 'Restaurante tradicional panameño, 2 sucursales. Temas laborales y permisos municipales.', true)
  ON CONFLICT (tenant_id, client_number) DO UPDATE SET
    name = EXCLUDED.name, ruc = EXCLUDED.ruc, type = EXCLUDED.type, contact = EXCLUDED.contact,
    phone = EXCLUDED.phone, email = EXCLUDED.email, observations = EXCLUDED.observations;

  -- Client 8
  INSERT INTO clients (tenant_id, client_number, name, ruc, type, contact, phone, email, observations, active)
  VALUES (v_tenant_id, 'CLI-008', 'Ana Lucía Espinoza de Gracia', '4-789-3456', 'Persona Natural', 'Ana Lucía Espinoza', '+507 6678-3344', 'aespinoza@icloud.com', 'Víctima de estafa inmobiliaria. Caso penal y civil simultáneo. Sensible emocionalmente, requiere trato cuidadoso.', true)
  ON CONFLICT (tenant_id, client_number) DO UPDATE SET
    name = EXCLUDED.name, ruc = EXCLUDED.ruc, type = EXCLUDED.type, contact = EXCLUDED.contact,
    phone = EXCLUDED.phone, email = EXCLUDED.email, observations = EXCLUDED.observations;

  -- Client 9
  INSERT INTO clients (tenant_id, client_number, name, ruc, type, contact, phone, email, observations, active)
  VALUES (v_tenant_id, 'CLI-009', 'Tech Solutions Panamá, S.A.', '48920-33-111222', 'Corporativo', 'Ing. Sofía Araúz', '+507 6789-5566', 'sarauz@techsolpa.com', 'Startup tecnológica. Necesita constitución de sociedad, visas para empleados extranjeros, y contratos laborales.', true)
  ON CONFLICT (tenant_id, client_number) DO UPDATE SET
    name = EXCLUDED.name, ruc = EXCLUDED.ruc, type = EXCLUDED.type, contact = EXCLUDED.contact,
    phone = EXCLUDED.phone, email = EXCLUDED.email, observations = EXCLUDED.observations;

  -- Client 10
  INSERT INTO clients (tenant_id, client_number, name, ruc, type, contact, phone, email, observations, active)
  VALUES (v_tenant_id, 'CLI-010', 'Fundación Esperanza Viva', '60123-99-555666', 'ONG', 'Lic. Patricia Moreno', '+507 6890-7788', 'pmoreno@esperanzaviva.org', 'ONG dedicada a educación rural. Pro bono parcial. Requiere registro en MICI y temas regulatorios.', true)
  ON CONFLICT (tenant_id, client_number) DO UPDATE SET
    name = EXCLUDED.name, ruc = EXCLUDED.ruc, type = EXCLUDED.type, contact = EXCLUDED.contact,
    phone = EXCLUDED.phone, email = EXCLUDED.email, observations = EXCLUDED.observations;

  -- Get client IDs
  SELECT ARRAY(SELECT id FROM clients WHERE tenant_id = v_tenant_id AND active = true ORDER BY client_number LIMIT 10) INTO v_client_ids;

  -- ==================== CASOS ================================
  -- Delete existing cases to avoid duplicates, re-insert with full data
  -- Using ON CONFLICT on case_code

  -- Case 1: CORP-001 — saldo positivo
  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file, entity, procedure_type, institution_procedure_number, institution_case_number, case_start_date, procedure_start_date, deadline)
  VALUES (v_tenant_id, v_client_ids[1], 1, 'CORP-001', 'Constitución de sociedad anónima y registro en el Registro Público', v_class_corp, v_inst_rp, v_team_dave, '2025-11-15', v_status_activo, 'Archivo A, Gaveta 1', 'Cliente solicita sociedad con capital social de $10,000. Agente residente ya designado.', true, 'Registro Público de Panamá', 'Inscripción de Sociedad Anónima', 'RP-2025-44521', 'FICHA-332145', '2025-11-15', '2025-12-01', '2026-06-30')
  ON CONFLICT (tenant_id, case_code) DO UPDATE SET
    description = EXCLUDED.description, classification_id = EXCLUDED.classification_id, institution_id = EXCLUDED.institution_id,
    responsible_id = EXCLUDED.responsible_id, status_id = EXCLUDED.status_id, physical_location = EXCLUDED.physical_location,
    observations = EXCLUDED.observations, has_digital_file = EXCLUDED.has_digital_file, entity = EXCLUDED.entity,
    procedure_type = EXCLUDED.procedure_type, institution_procedure_number = EXCLUDED.institution_procedure_number,
    institution_case_number = EXCLUDED.institution_case_number, case_start_date = EXCLUDED.case_start_date,
    procedure_start_date = EXCLUDED.procedure_start_date, deadline = EXCLUDED.deadline;

  -- Case 2: MIG-001 — saldo negativo
  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file, entity, procedure_type, institution_procedure_number, case_start_date, procedure_start_date, deadline)
  VALUES (v_tenant_id, v_client_ids[4], 2, 'MIG-001', 'Visa de inversionista calificado para ciudadano chino — Wei Chen', v_class_mig, v_inst_mig, v_team_dave, '2025-10-01', v_status_tramite, 'Archivo B, Gaveta 2', 'Aplicante principal + 2 dependientes. Se requiere traducción oficial de documentos del mandarín.', true, 'Servicio Nacional de Migración', 'Permiso de Residencia — Inversionista Calificado', 'SNM-INV-2025-1089', '2025-10-01', '2025-11-15', '2026-04-30')
  ON CONFLICT (tenant_id, case_code) DO UPDATE SET
    description = EXCLUDED.description, classification_id = EXCLUDED.classification_id, institution_id = EXCLUDED.institution_id,
    responsible_id = EXCLUDED.responsible_id, status_id = EXCLUDED.status_id, physical_location = EXCLUDED.physical_location,
    observations = EXCLUDED.observations, has_digital_file = EXCLUDED.has_digital_file, entity = EXCLUDED.entity,
    procedure_type = EXCLUDED.procedure_type, institution_procedure_number = EXCLUDED.institution_procedure_number,
    case_start_date = EXCLUDED.case_start_date, procedure_start_date = EXCLUDED.procedure_start_date, deadline = EXCLUDED.deadline;

  -- Case 3: LAB-001 — saldo en cero
  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file, entity, procedure_type, case_start_date, deadline)
  VALUES (v_tenant_id, v_client_ids[5], 3, 'LAB-001', 'Demanda laboral por despido injustificado — Luis Quintero vs. Constructora XYZ', v_class_lab, v_inst_mun, v_team_mile, '2026-01-10', v_status_activo, 'Archivo C, Gaveta 5', 'Despido sin preaviso ni indemnización. 5 años de servicio. Se reclama prestaciones completas + daños morales.', false, 'Juzgado Segundo de Trabajo', 'Demanda Laboral Ordinaria', '2026-01-10', '2026-08-15')
  ON CONFLICT (tenant_id, case_code) DO UPDATE SET
    description = EXCLUDED.description, classification_id = EXCLUDED.classification_id, institution_id = EXCLUDED.institution_id,
    responsible_id = EXCLUDED.responsible_id, status_id = EXCLUDED.status_id, physical_location = EXCLUDED.physical_location,
    observations = EXCLUDED.observations, has_digital_file = EXCLUDED.has_digital_file, entity = EXCLUDED.entity,
    procedure_type = EXCLUDED.procedure_type, case_start_date = EXCLUDED.case_start_date, deadline = EXCLUDED.deadline;

  -- Case 4: REG-001
  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file, entity, procedure_type, institution_procedure_number, case_start_date, procedure_start_date)
  VALUES (v_tenant_id, v_client_ids[6], 4, 'REG-001', 'Renovación de licencia sanitaria para 3 sucursales de Farmacia San Judas', v_class_reg, v_inst_minsa, v_team_mile, '2026-02-01', v_status_tramite, 'Archivo A, Gaveta 3', 'Renovación anual. Inspección MINSA programada para abril. Sucursal de Bella Vista tiene observaciones del año anterior.', true, 'MINSA — Dirección de Farmacia y Drogas', 'Renovación de Licencia Sanitaria', 'MINSA-LS-2026-0334', '2026-02-01', '2026-02-15')
  ON CONFLICT (tenant_id, case_code) DO UPDATE SET
    description = EXCLUDED.description, classification_id = EXCLUDED.classification_id, institution_id = EXCLUDED.institution_id,
    responsible_id = EXCLUDED.responsible_id, status_id = EXCLUDED.status_id, physical_location = EXCLUDED.physical_location,
    observations = EXCLUDED.observations, has_digital_file = EXCLUDED.has_digital_file, entity = EXCLUDED.entity,
    procedure_type = EXCLUDED.procedure_type, institution_procedure_number = EXCLUDED.institution_procedure_number,
    case_start_date = EXCLUDED.case_start_date, procedure_start_date = EXCLUDED.procedure_start_date;

  -- Case 5: PEN-001
  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file, entity, procedure_type, case_start_date)
  VALUES (v_tenant_id, v_client_ids[8], 5, 'PEN-001', 'Denuncia penal por estafa inmobiliaria — Ana Espinoza vs. Promotora Horizontes', v_class_pen, v_inst_mun, v_team_dave, '2026-01-20', v_status_activo, 'Archivo D, Gaveta 1 (confidencial)', 'Estafa por $85,000 en compra de apartamento. Promotora no entregó inmueble y se declaró en quiebra. Se coordina con fiscalía.', false, 'Ministerio Público — Fiscalía de Circuito de lo Penal', 'Denuncia por Estafa Calificada', '2026-01-20')
  ON CONFLICT (tenant_id, case_code) DO UPDATE SET
    description = EXCLUDED.description, classification_id = EXCLUDED.classification_id, institution_id = EXCLUDED.institution_id,
    responsible_id = EXCLUDED.responsible_id, status_id = EXCLUDED.status_id, physical_location = EXCLUDED.physical_location,
    observations = EXCLUDED.observations, has_digital_file = EXCLUDED.has_digital_file, entity = EXCLUDED.entity,
    procedure_type = EXCLUDED.procedure_type, case_start_date = EXCLUDED.case_start_date;

  -- Case 6: CIV-001
  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file, entity, procedure_type, case_start_date, deadline)
  VALUES (v_tenant_id, v_client_ids[8], 6, 'CIV-001', 'Demanda civil por daños y perjuicios — recuperación de $85,000 de Promotora Horizontes', v_class_civ, v_inst_mun, v_team_mile, '2026-02-05', v_status_tramite, 'Archivo D, Gaveta 2', 'Proceso civil paralelo al penal. Objetivo: recuperar inversión + intereses + daños morales. Embargo preventivo solicitado.', true, 'Juzgado Decimotercero Civil del Primer Circuito', 'Demanda Ordinaria de Mayor Cuantía', '2026-02-05', '2026-12-31')
  ON CONFLICT (tenant_id, case_code) DO UPDATE SET
    description = EXCLUDED.description, classification_id = EXCLUDED.classification_id, institution_id = EXCLUDED.institution_id,
    responsible_id = EXCLUDED.responsible_id, status_id = EXCLUDED.status_id, physical_location = EXCLUDED.physical_location,
    observations = EXCLUDED.observations, has_digital_file = EXCLUDED.has_digital_file, entity = EXCLUDED.entity,
    procedure_type = EXCLUDED.procedure_type, case_start_date = EXCLUDED.case_start_date, deadline = EXCLUDED.deadline;

  -- Case 7: CORP-002
  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file, entity, procedure_type, institution_procedure_number, case_start_date, procedure_start_date)
  VALUES (v_tenant_id, v_client_ids[9], 7, 'CORP-002', 'Constitución de Tech Solutions Panamá, S.A. y registro de marca', v_class_corp, v_inst_rp, v_team_dave, '2026-03-01', v_status_activo, 'Archivo A, Gaveta 4', 'Startup tech. Constitución + aviso de operación + registro de marca "TechSolPA" ante DIGERPI.', true, 'Registro Público / DIGERPI', 'Constitución + Registro de Marca', 'RP-2026-11234', '2026-03-01', '2026-03-15')
  ON CONFLICT (tenant_id, case_code) DO UPDATE SET
    description = EXCLUDED.description, classification_id = EXCLUDED.classification_id, institution_id = EXCLUDED.institution_id,
    responsible_id = EXCLUDED.responsible_id, status_id = EXCLUDED.status_id, physical_location = EXCLUDED.physical_location,
    observations = EXCLUDED.observations, has_digital_file = EXCLUDED.has_digital_file, entity = EXCLUDED.entity,
    procedure_type = EXCLUDED.procedure_type, institution_procedure_number = EXCLUDED.institution_procedure_number,
    case_start_date = EXCLUDED.case_start_date, procedure_start_date = EXCLUDED.procedure_start_date;

  -- Case 8: MIG-002
  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, observations, has_digital_file, entity, procedure_type, case_start_date, deadline)
  VALUES (v_tenant_id, v_client_ids[9], 8, 'MIG-002', 'Visa de personal calificado para 3 ingenieros de software extranjeros', v_class_mig, v_inst_mig, v_team_mile, '2026-03-10', v_status_tramite, 'Tres aplicantes: 2 colombianos, 1 argentino. Contrato laboral ya firmado. Se espera aprobación de permisos.', true, 'Servicio Nacional de Migración / MITRADEL', 'Permiso de Trabajo + Residencia Temporal', '2026-03-10', '2026-07-15')
  ON CONFLICT (tenant_id, case_code) DO UPDATE SET
    description = EXCLUDED.description, classification_id = EXCLUDED.classification_id, institution_id = EXCLUDED.institution_id,
    responsible_id = EXCLUDED.responsible_id, status_id = EXCLUDED.status_id, observations = EXCLUDED.observations,
    has_digital_file = EXCLUDED.has_digital_file, entity = EXCLUDED.entity, procedure_type = EXCLUDED.procedure_type,
    case_start_date = EXCLUDED.case_start_date, deadline = EXCLUDED.deadline;

  -- Case 9: ADM-001
  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, observations, has_digital_file, entity, procedure_type, case_start_date)
  VALUES (v_tenant_id, v_client_ids[10], 9, 'ADM-001', 'Registro de ONG en MICI y obtención de personería jurídica', v_class_adm, v_inst_mici, v_team_mile, '2026-02-20', v_status_activo, 'Fundación sin fines de lucro. Junta directiva de 5 miembros. Requiere publicación en Gaceta Oficial.', false, 'MICI — Dirección de Personas Jurídicas', 'Registro de Fundación de Interés Privado', '2026-02-20')
  ON CONFLICT (tenant_id, case_code) DO UPDATE SET
    description = EXCLUDED.description, classification_id = EXCLUDED.classification_id, institution_id = EXCLUDED.institution_id,
    responsible_id = EXCLUDED.responsible_id, status_id = EXCLUDED.status_id, observations = EXCLUDED.observations,
    has_digital_file = EXCLUDED.has_digital_file, entity = EXCLUDED.entity, procedure_type = EXCLUDED.procedure_type,
    case_start_date = EXCLUDED.case_start_date;

  -- Case 10: CORP-003 (cerrado)
  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, observations, has_digital_file, entity, procedure_type, case_start_date)
  VALUES (v_tenant_id, v_client_ids[3], 10, 'CORP-003', 'Renovación de aviso de operación y permiso de construcción — Constructora Istmeña', v_class_corp, v_inst_mun, v_team_dave, '2025-08-01', v_status_cerrado, 'Caso completado exitosamente. Permisos renovados hasta dic 2026.', true, 'Municipio de Panamá / MIVIOT', 'Renovación de Aviso de Operación', '2025-08-01')
  ON CONFLICT (tenant_id, case_code) DO UPDATE SET
    description = EXCLUDED.description, classification_id = EXCLUDED.classification_id, institution_id = EXCLUDED.institution_id,
    responsible_id = EXCLUDED.responsible_id, status_id = EXCLUDED.status_id, observations = EXCLUDED.observations,
    has_digital_file = EXCLUDED.has_digital_file, entity = EXCLUDED.entity, procedure_type = EXCLUDED.procedure_type,
    case_start_date = EXCLUDED.case_start_date;

  -- Case 11: LAB-002
  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, observations, has_digital_file, entity, procedure_type, case_start_date, deadline)
  VALUES (v_tenant_id, v_client_ids[7], 11, 'LAB-002', 'Elaboración de reglamento interno de trabajo y contratos laborales — El Trapiche', v_class_lab, v_inst_mun, v_team_mile, '2026-03-15', v_status_activo, 'Restaurante con 45 empleados en 2 sucursales. Requiere actualización de reglamento según nueva ley.', true, 'MITRADEL', 'Aprobación de Reglamento Interno de Trabajo', '2026-03-15', '2026-05-30')
  ON CONFLICT (tenant_id, case_code) DO UPDATE SET
    description = EXCLUDED.description, classification_id = EXCLUDED.classification_id, institution_id = EXCLUDED.institution_id,
    responsible_id = EXCLUDED.responsible_id, status_id = EXCLUDED.status_id, observations = EXCLUDED.observations,
    has_digital_file = EXCLUDED.has_digital_file, entity = EXCLUDED.entity, procedure_type = EXCLUDED.procedure_type,
    case_start_date = EXCLUDED.case_start_date, deadline = EXCLUDED.deadline;

  -- Case 12: MIG-003
  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, observations, has_digital_file, entity, procedure_type, case_start_date)
  VALUES (v_tenant_id, v_client_ids[2], 12, 'MIG-003', 'Residencia permanente por matrimonio con panameño — cliente de María Fernanda Castro', v_class_mig, v_inst_mig, v_team_dave, '2026-03-20', v_status_tramite, 'Aplicante venezolana, casada con panameño desde 2024. Documentos apostillados. Entrevista pendiente en Migración.', false, 'Servicio Nacional de Migración', 'Residencia Permanente por Matrimonio', '2026-03-20')
  ON CONFLICT (tenant_id, case_code) DO UPDATE SET
    description = EXCLUDED.description, classification_id = EXCLUDED.classification_id, institution_id = EXCLUDED.institution_id,
    responsible_id = EXCLUDED.responsible_id, status_id = EXCLUDED.status_id, observations = EXCLUDED.observations,
    has_digital_file = EXCLUDED.has_digital_file, entity = EXCLUDED.entity, procedure_type = EXCLUDED.procedure_type,
    case_start_date = EXCLUDED.case_start_date;

  -- Get case IDs
  SELECT ARRAY(SELECT id FROM cases WHERE tenant_id = v_tenant_id ORDER BY case_number LIMIT 12) INTO v_case_ids;

  -- ==================== GASTOS Y PAGOS ========================

  -- Case 1 (CORP-001): saldo positivo ($3000 pagado, $1800 gastado)
  INSERT INTO client_payments (tenant_id, case_id, amount, payment_date, registered_by) VALUES
    (v_tenant_id, v_case_ids[1], 2000.00, '2025-11-20', v_admin_id),
    (v_tenant_id, v_case_ids[1], 1000.00, '2026-01-15', v_admin_id)
  ON CONFLICT DO NOTHING;
  INSERT INTO expenses (tenant_id, case_id, amount, concept, date, registered_by) VALUES
    (v_tenant_id, v_case_ids[1], 350.00, 'Honorarios notariales — escritura de constitución', '2025-12-01', v_admin_id),
    (v_tenant_id, v_case_ids[1], 250.00, 'Tasa de inscripción en Registro Público', '2025-12-05', v_admin_id),
    (v_tenant_id, v_case_ids[1], 150.00, 'Certificado de Registro Público (urgente)', '2026-01-10', v_admin_id),
    (v_tenant_id, v_case_ids[1], 500.00, 'Honorarios del agente residente (anual)', '2026-01-20', v_admin_id),
    (v_tenant_id, v_case_ids[1], 550.00, 'Publicación en Gaceta Oficial', '2026-02-01', v_admin_id)
  ON CONFLICT DO NOTHING;

  -- Case 2 (MIG-001): saldo negativo ($2500 pagado, $4200 gastado)
  INSERT INTO client_payments (tenant_id, case_id, amount, payment_date, registered_by) VALUES
    (v_tenant_id, v_case_ids[2], 1500.00, '2025-10-15', v_admin_id),
    (v_tenant_id, v_case_ids[2], 1000.00, '2025-12-20', v_admin_id)
  ON CONFLICT DO NOTHING;
  INSERT INTO expenses (tenant_id, case_id, amount, concept, date, registered_by) VALUES
    (v_tenant_id, v_case_ids[2], 800.00, 'Traducción oficial de documentos (mandarín → español)', '2025-10-20', v_admin_id),
    (v_tenant_id, v_case_ids[2], 600.00, 'Apostilla de documentos en China (courier DHL)', '2025-11-05', v_admin_id),
    (v_tenant_id, v_case_ids[2], 1200.00, 'Tasa migratoria — inversionista calificado (3 personas)', '2025-11-20', v_admin_id),
    (v_tenant_id, v_case_ids[2], 500.00, 'Exámenes médicos y certificados (3 personas)', '2025-12-01', v_admin_id),
    (v_tenant_id, v_case_ids[2], 350.00, 'Seguro médico requisito migratorio (3 meses)', '2025-12-15', v_admin_id),
    (v_tenant_id, v_case_ids[2], 750.00, 'Depósito bancario requerido — comprobante de fondos', '2026-01-10', v_admin_id)
  ON CONFLICT DO NOTHING;

  -- Case 3 (LAB-001): saldo en cero ($500 pagado, $500 gastado)
  INSERT INTO client_payments (tenant_id, case_id, amount, payment_date, registered_by) VALUES
    (v_tenant_id, v_case_ids[3], 500.00, '2026-01-15', v_admin_id)
  ON CONFLICT DO NOTHING;
  INSERT INTO expenses (tenant_id, case_id, amount, concept, date, registered_by) VALUES
    (v_tenant_id, v_case_ids[3], 200.00, 'Timbres fiscales y papel sellado', '2026-01-20', v_admin_id),
    (v_tenant_id, v_case_ids[3], 150.00, 'Copias certificadas del expediente laboral', '2026-02-01', v_admin_id),
    (v_tenant_id, v_case_ids[3], 150.00, 'Transporte a MITRADEL para audiencia de conciliación', '2026-02-15', v_admin_id)
  ON CONFLICT DO NOTHING;

  -- Case 4 (REG-001): saldo positivo
  INSERT INTO client_payments (tenant_id, case_id, amount, payment_date, registered_by) VALUES
    (v_tenant_id, v_case_ids[4], 1800.00, '2026-02-05', v_admin_id)
  ON CONFLICT DO NOTHING;
  INSERT INTO expenses (tenant_id, case_id, amount, concept, date, registered_by) VALUES
    (v_tenant_id, v_case_ids[4], 300.00, 'Tasa MINSA — renovación licencia sanitaria (x3 sucursales)', '2026-02-20', v_admin_id),
    (v_tenant_id, v_case_ids[4], 200.00, 'Análisis de laboratorio (control de calidad)', '2026-03-01', v_admin_id),
    (v_tenant_id, v_case_ids[4], 150.00, 'Fumigación certificada — sucursal Bella Vista', '2026-03-10', v_admin_id)
  ON CONFLICT DO NOTHING;

  -- Case 5 (PEN-001): gastos altos, pago moderado
  INSERT INTO client_payments (tenant_id, case_id, amount, payment_date, registered_by) VALUES
    (v_tenant_id, v_case_ids[5], 3000.00, '2026-01-25', v_admin_id),
    (v_tenant_id, v_case_ids[5], 1500.00, '2026-03-01', v_admin_id)
  ON CONFLICT DO NOTHING;
  INSERT INTO expenses (tenant_id, case_id, amount, concept, date, registered_by) VALUES
    (v_tenant_id, v_case_ids[5], 500.00, 'Investigación privada — rastreo de activos del imputado', '2026-02-01', v_admin_id),
    (v_tenant_id, v_case_ids[5], 800.00, 'Peritaje de documentos notariales fraudulentos', '2026-02-15', v_admin_id),
    (v_tenant_id, v_case_ids[5], 250.00, 'Certificaciones del Registro Público', '2026-03-01', v_admin_id),
    (v_tenant_id, v_case_ids[5], 1200.00, 'Honorarios de co-abogado penalista (consulta)', '2026-03-15', v_admin_id)
  ON CONFLICT DO NOTHING;

  -- Case 6 (CIV-001): gastos moderados, saldo negativo
  INSERT INTO client_payments (tenant_id, case_id, amount, payment_date, registered_by) VALUES
    (v_tenant_id, v_case_ids[6], 2000.00, '2026-02-10', v_admin_id)
  ON CONFLICT DO NOTHING;
  INSERT INTO expenses (tenant_id, case_id, amount, concept, date, registered_by) VALUES
    (v_tenant_id, v_case_ids[6], 400.00, 'Timbres fiscales para demanda civil de mayor cuantía', '2026-02-12', v_admin_id),
    (v_tenant_id, v_case_ids[6], 800.00, 'Honorarios perito valuador del inmueble', '2026-02-28', v_admin_id),
    (v_tenant_id, v_case_ids[6], 350.00, 'Certificaciones registrales (3 fincas)', '2026-03-10', v_admin_id),
    (v_tenant_id, v_case_ids[6], 600.00, 'Solicitud de embargo preventivo — costas judiciales', '2026-03-20', v_admin_id)
  ON CONFLICT DO NOTHING;

  -- Case 7 (CORP-002): startup, pagos al día
  INSERT INTO client_payments (tenant_id, case_id, amount, payment_date, registered_by) VALUES
    (v_tenant_id, v_case_ids[7], 2500.00, '2026-03-05', v_admin_id)
  ON CONFLICT DO NOTHING;
  INSERT INTO expenses (tenant_id, case_id, amount, concept, date, registered_by) VALUES
    (v_tenant_id, v_case_ids[7], 400.00, 'Notaría — escritura de constitución', '2026-03-10', v_admin_id),
    (v_tenant_id, v_case_ids[7], 250.00, 'Registro Público — inscripción', '2026-03-15', v_admin_id),
    (v_tenant_id, v_case_ids[7], 350.00, 'DIGERPI — solicitud registro de marca', '2026-03-20', v_admin_id),
    (v_tenant_id, v_case_ids[7], 100.00, 'Aviso de Operación — tasa municipal', '2026-03-25', v_admin_id)
  ON CONFLICT DO NOTHING;

  -- Case 8 (MIG-002): en trámite, saldo positivo
  INSERT INTO client_payments (tenant_id, case_id, amount, payment_date, registered_by) VALUES
    (v_tenant_id, v_case_ids[8], 4500.00, '2026-03-12', v_admin_id),
    (v_tenant_id, v_case_ids[8], 2000.00, '2026-03-28', v_admin_id)
  ON CONFLICT DO NOTHING;
  INSERT INTO expenses (tenant_id, case_id, amount, concept, date, registered_by) VALUES
    (v_tenant_id, v_case_ids[8], 900.00, 'Tasas MITRADEL — permisos de trabajo (x3)', '2026-03-20', v_admin_id),
    (v_tenant_id, v_case_ids[8], 1200.00, 'Tasas migratorias — residencia temporal (x3)', '2026-03-25', v_admin_id),
    (v_tenant_id, v_case_ids[8], 450.00, 'Certificados de salud y antecedentes penales (x3)', '2026-03-28', v_admin_id)
  ON CONFLICT DO NOTHING;

  -- Case 9 (ADM-001): ONG, pro bono parcial
  INSERT INTO client_payments (tenant_id, case_id, amount, payment_date, registered_by) VALUES
    (v_tenant_id, v_case_ids[9], 500.00, '2026-02-25', v_admin_id)
  ON CONFLICT DO NOTHING;
  INSERT INTO expenses (tenant_id, case_id, amount, concept, date, registered_by) VALUES
    (v_tenant_id, v_case_ids[9], 200.00, 'Publicación en Gaceta Oficial', '2026-03-05', v_admin_id),
    (v_tenant_id, v_case_ids[9], 150.00, 'Tasa MICI — registro de fundación', '2026-03-15', v_admin_id),
    (v_tenant_id, v_case_ids[9], 100.00, 'Copias certificadas de acta constitutiva', '2026-03-20', v_admin_id)
  ON CONFLICT DO NOTHING;

  -- Case 10 (CORP-003): cerrado, saldo positivo
  INSERT INTO client_payments (tenant_id, case_id, amount, payment_date, registered_by) VALUES
    (v_tenant_id, v_case_ids[10], 1200.00, '2025-08-10', v_admin_id)
  ON CONFLICT DO NOTHING;
  INSERT INTO expenses (tenant_id, case_id, amount, concept, date, registered_by) VALUES
    (v_tenant_id, v_case_ids[10], 300.00, 'Renovación de aviso de operación — tasa municipal', '2025-08-15', v_admin_id),
    (v_tenant_id, v_case_ids[10], 250.00, 'Permiso de construcción — inspección', '2025-09-01', v_admin_id),
    (v_tenant_id, v_case_ids[10], 180.00, 'Certificado de uso de suelo', '2025-09-15', v_admin_id)
  ON CONFLICT DO NOTHING;

  -- Case 11 (LAB-002): en curso, saldo negativo
  INSERT INTO client_payments (tenant_id, case_id, amount, payment_date, registered_by) VALUES
    (v_tenant_id, v_case_ids[11], 800.00, '2026-03-18', v_admin_id)
  ON CONFLICT DO NOTHING;
  INSERT INTO expenses (tenant_id, case_id, amount, concept, date, registered_by) VALUES
    (v_tenant_id, v_case_ids[11], 500.00, 'Asesoría laboral especializada — reglamento interno', '2026-03-20', v_admin_id),
    (v_tenant_id, v_case_ids[11], 200.00, 'Revisión de contratos existentes (45 empleados)', '2026-03-25', v_admin_id),
    (v_tenant_id, v_case_ids[11], 350.00, 'Tasa MITRADEL — aprobación de reglamento', '2026-03-30', v_admin_id)
  ON CONFLICT DO NOTHING;

  -- Case 12 (MIG-003): en trámite, saldo en cero
  INSERT INTO client_payments (tenant_id, case_id, amount, payment_date, registered_by) VALUES
    (v_tenant_id, v_case_ids[12], 750.00, '2026-03-22', v_admin_id)
  ON CONFLICT DO NOTHING;
  INSERT INTO expenses (tenant_id, case_id, amount, concept, date, registered_by) VALUES
    (v_tenant_id, v_case_ids[12], 400.00, 'Tasa migratoria — residencia permanente por matrimonio', '2026-03-25', v_admin_id),
    (v_tenant_id, v_case_ids[12], 200.00, 'Apostilla de acta de matrimonio', '2026-03-28', v_admin_id),
    (v_tenant_id, v_case_ids[12], 150.00, 'Certificado de antecedentes penales apostillado', '2026-03-30', v_admin_id)
  ON CONFLICT DO NOTHING;

  -- ==================== TAREAS ================================

  -- Case 1 tasks
  INSERT INTO tasks (tenant_id, case_id, description, deadline, assigned_to, status, created_by) VALUES
    (v_tenant_id, v_case_ids[1], 'Recoger escritura protocolizada en notaría', '2026-04-10', v_admin_id, 'pendiente', v_admin_id),
    (v_tenant_id, v_case_ids[1], 'Entregar documentos al Registro Público', '2026-04-15', v_admin_id, 'pendiente', v_admin_id),
    (v_tenant_id, v_case_ids[1], 'Verificar publicación en Gaceta Oficial', '2026-03-01', v_admin_id, 'cumplida', v_admin_id)
  ON CONFLICT DO NOTHING;
  -- Mark completed task
  UPDATE tasks SET completed_at = '2026-03-02' WHERE case_id = v_case_ids[1] AND status = 'cumplida' AND completed_at IS NULL;

  -- Case 2 tasks
  INSERT INTO tasks (tenant_id, case_id, description, deadline, assigned_to, status, created_by) VALUES
    (v_tenant_id, v_case_ids[2], 'Llamar al SNM para confirmar fecha de entrevista', '2026-04-05', v_admin_id, 'pendiente', v_admin_id),
    (v_tenant_id, v_case_ids[2], 'Recoger carnés de migración temporales', '2026-04-20', v_admin_id, 'pendiente', v_admin_id),
    (v_tenant_id, v_case_ids[2], 'Entregar traducción oficial de pasaportes', '2026-01-15', v_admin_id, 'cumplida', v_admin_id),
    (v_tenant_id, v_case_ids[2], 'Coordinar exámenes médicos para los 3 aplicantes', '2026-02-01', v_admin_id, 'cumplida', v_admin_id)
  ON CONFLICT DO NOTHING;
  UPDATE tasks SET completed_at = '2026-01-14' WHERE case_id = v_case_ids[2] AND description ILIKE '%traducción%' AND completed_at IS NULL;
  UPDATE tasks SET completed_at = '2026-01-30' WHERE case_id = v_case_ids[2] AND description ILIKE '%exámenes%' AND completed_at IS NULL;

  -- Case 3 tasks
  INSERT INTO tasks (tenant_id, case_id, description, deadline, assigned_to, status, created_by) VALUES
    (v_tenant_id, v_case_ids[3], 'Preparar memorial de demanda', '2026-02-01', v_admin_id, 'cumplida', v_admin_id),
    (v_tenant_id, v_case_ids[3], 'Asistir a audiencia de conciliación en MITRADEL', '2026-04-08', v_admin_id, 'pendiente', v_admin_id),
    (v_tenant_id, v_case_ids[3], 'Recopilar estados de cuenta del cliente como prueba', '2026-03-15', v_admin_id, 'cumplida', v_admin_id)
  ON CONFLICT DO NOTHING;
  UPDATE tasks SET completed_at = '2026-01-28' WHERE case_id = v_case_ids[3] AND description ILIKE '%memorial%' AND completed_at IS NULL;
  UPDATE tasks SET completed_at = '2026-03-12' WHERE case_id = v_case_ids[3] AND description ILIKE '%estados de cuenta%' AND completed_at IS NULL;

  -- Case 5 tasks
  INSERT INTO tasks (tenant_id, case_id, description, deadline, assigned_to, status, created_by) VALUES
    (v_tenant_id, v_case_ids[5], 'Presentar querella ante fiscalía', '2026-02-10', v_admin_id, 'cumplida', v_admin_id),
    (v_tenant_id, v_case_ids[5], 'Solicitar medida cautelar de embargo', '2026-04-15', v_admin_id, 'pendiente', v_admin_id),
    (v_tenant_id, v_case_ids[5], 'Obtener certificación de propiedad del inmueble prometido', '2026-03-20', v_admin_id, 'cumplida', v_admin_id)
  ON CONFLICT DO NOTHING;
  UPDATE tasks SET completed_at = '2026-02-08' WHERE case_id = v_case_ids[5] AND description ILIKE '%querella%' AND completed_at IS NULL;
  UPDATE tasks SET completed_at = '2026-03-18' WHERE case_id = v_case_ids[5] AND description ILIKE '%certificación%' AND completed_at IS NULL;

  -- Case 7 tasks
  INSERT INTO tasks (tenant_id, case_id, description, deadline, assigned_to, status, created_by) VALUES
    (v_tenant_id, v_case_ids[7], 'Completar formularios de DIGERPI para registro de marca', '2026-04-10', v_admin_id, 'pendiente', v_admin_id),
    (v_tenant_id, v_case_ids[7], 'Redactar pacto social y estatutos', '2026-03-08', v_admin_id, 'cumplida', v_admin_id),
    (v_tenant_id, v_case_ids[7], 'Obtener aviso de operación municipal', '2026-04-20', v_admin_id, 'pendiente', v_admin_id)
  ON CONFLICT DO NOTHING;
  UPDATE tasks SET completed_at = '2026-03-07' WHERE case_id = v_case_ids[7] AND description ILIKE '%pacto social%' AND completed_at IS NULL;

  -- Case 4 tasks
  INSERT INTO tasks (tenant_id, case_id, description, deadline, assigned_to, status, created_by) VALUES
    (v_tenant_id, v_case_ids[4], 'Coordinar inspección MINSA para sucursal Bella Vista', '2026-04-15', v_admin_id, 'pendiente', v_admin_id),
    (v_tenant_id, v_case_ids[4], 'Entregar certificados de análisis de laboratorio', '2026-03-10', v_admin_id, 'cumplida', v_admin_id),
    (v_tenant_id, v_case_ids[4], 'Renovar certificados de fumigación (3 locales)', '2026-03-20', v_admin_id, 'cumplida', v_admin_id)
  ON CONFLICT DO NOTHING;
  UPDATE tasks SET completed_at = '2026-03-08' WHERE case_id = v_case_ids[4] AND description ILIKE '%laboratorio%' AND completed_at IS NULL;
  UPDATE tasks SET completed_at = '2026-03-18' WHERE case_id = v_case_ids[4] AND description ILIKE '%fumigación%' AND completed_at IS NULL;

  -- Case 6 tasks
  INSERT INTO tasks (tenant_id, case_id, description, deadline, assigned_to, status, created_by) VALUES
    (v_tenant_id, v_case_ids[6], 'Preparar y presentar demanda civil', '2026-02-15', v_admin_id, 'cumplida', v_admin_id),
    (v_tenant_id, v_case_ids[6], 'Solicitar embargo preventivo sobre bienes', '2026-04-10', v_admin_id, 'pendiente', v_admin_id),
    (v_tenant_id, v_case_ids[6], 'Obtener avalúo pericial del inmueble prometido', '2026-04-20', v_admin_id, 'pendiente', v_admin_id)
  ON CONFLICT DO NOTHING;
  UPDATE tasks SET completed_at = '2026-02-12' WHERE case_id = v_case_ids[6] AND description ILIKE '%demanda civil%' AND completed_at IS NULL;

  -- Case 8 tasks
  INSERT INTO tasks (tenant_id, case_id, description, deadline, assigned_to, status, created_by) VALUES
    (v_tenant_id, v_case_ids[8], 'Recopilar contratos laborales de los 3 ingenieros', '2026-03-25', v_admin_id, 'cumplida', v_admin_id),
    (v_tenant_id, v_case_ids[8], 'Presentar solicitudes ante MITRADEL', '2026-04-05', v_admin_id, 'pendiente', v_admin_id),
    (v_tenant_id, v_case_ids[8], 'Agendar citas en SNM para cada aplicante', '2026-04-15', v_admin_id, 'pendiente', v_admin_id)
  ON CONFLICT DO NOTHING;
  UPDATE tasks SET completed_at = '2026-03-24' WHERE case_id = v_case_ids[8] AND description ILIKE '%contratos%' AND completed_at IS NULL;

  -- Case 9 tasks
  INSERT INTO tasks (tenant_id, case_id, description, deadline, assigned_to, status, created_by) VALUES
    (v_tenant_id, v_case_ids[9], 'Redactar acta constitutiva de la fundación', '2026-03-05', v_admin_id, 'cumplida', v_admin_id),
    (v_tenant_id, v_case_ids[9], 'Publicar resolución en Gaceta Oficial', '2026-04-01', v_admin_id, 'pendiente', v_admin_id),
    (v_tenant_id, v_case_ids[9], 'Presentar solicitud de registro ante MICI', '2026-04-15', v_admin_id, 'pendiente', v_admin_id)
  ON CONFLICT DO NOTHING;
  UPDATE tasks SET completed_at = '2026-03-03' WHERE case_id = v_case_ids[9] AND description ILIKE '%acta constitutiva%' AND completed_at IS NULL;

  -- Case 10 tasks (cerrado — todas cumplidas)
  INSERT INTO tasks (tenant_id, case_id, description, deadline, assigned_to, status, created_by) VALUES
    (v_tenant_id, v_case_ids[10], 'Renovar aviso de operación en Municipio', '2025-08-20', v_admin_id, 'cumplida', v_admin_id),
    (v_tenant_id, v_case_ids[10], 'Obtener permiso de construcción actualizado', '2025-09-10', v_admin_id, 'cumplida', v_admin_id),
    (v_tenant_id, v_case_ids[10], 'Entregar documentación completa al cliente', '2025-09-20', v_admin_id, 'cumplida', v_admin_id)
  ON CONFLICT DO NOTHING;
  UPDATE tasks SET completed_at = '2025-08-18' WHERE case_id = v_case_ids[10] AND description ILIKE '%aviso de operación%' AND completed_at IS NULL;
  UPDATE tasks SET completed_at = '2025-09-08' WHERE case_id = v_case_ids[10] AND description ILIKE '%permiso de construcción%' AND completed_at IS NULL;
  UPDATE tasks SET completed_at = '2025-09-18' WHERE case_id = v_case_ids[10] AND description ILIKE '%documentación%' AND completed_at IS NULL;

  -- Case 11 tasks
  INSERT INTO tasks (tenant_id, case_id, description, deadline, assigned_to, status, created_by) VALUES
    (v_tenant_id, v_case_ids[11], 'Revisar contratos laborales actuales de 45 empleados', '2026-04-01', v_admin_id, 'cumplida', v_admin_id),
    (v_tenant_id, v_case_ids[11], 'Redactar nuevo reglamento interno de trabajo', '2026-04-15', v_admin_id, 'pendiente', v_admin_id),
    (v_tenant_id, v_case_ids[11], 'Presentar reglamento ante MITRADEL para aprobación', '2026-05-01', v_admin_id, 'pendiente', v_admin_id)
  ON CONFLICT DO NOTHING;
  UPDATE tasks SET completed_at = '2026-03-30' WHERE case_id = v_case_ids[11] AND description ILIKE '%revisar contratos%' AND completed_at IS NULL;

  -- Case 12 tasks
  INSERT INTO tasks (tenant_id, case_id, description, deadline, assigned_to, status, created_by) VALUES
    (v_tenant_id, v_case_ids[12], 'Verificar apostilla de acta de matrimonio', '2026-03-28', v_admin_id, 'cumplida', v_admin_id),
    (v_tenant_id, v_case_ids[12], 'Acompañar a entrevista en Servicio Nacional de Migración', '2026-04-20', v_admin_id, 'pendiente', v_admin_id),
    (v_tenant_id, v_case_ids[12], 'Entregar carné de residente al cliente', '2026-05-15', v_admin_id, 'pendiente', v_admin_id)
  ON CONFLICT DO NOTHING;
  UPDATE tasks SET completed_at = '2026-03-27' WHERE case_id = v_case_ids[12] AND description ILIKE '%apostilla%' AND completed_at IS NULL;

  -- ==================== COMENTARIOS ===========================

  -- Case 1 comments
  INSERT INTO comments (tenant_id, case_id, user_id, text, follow_up_date, created_at) VALUES
    (v_tenant_id, v_case_ids[1], v_admin_id, 'Se recibió poder notarial del cliente. Documentos en orden para proceder con la inscripción.', '2025-12-15', '2025-11-20 09:30:00'),
    (v_tenant_id, v_case_ids[1], v_admin_id, 'Escritura de constitución protocolizada. Se envía al Registro Público para inscripción.', '2026-01-10', '2025-12-05 14:15:00'),
    (v_tenant_id, v_case_ids[1], v_admin_id, 'Registro Público confirmó recepción. Número de entrada asignado: RP-2025-44521. Tiempo estimado de inscripción: 15 días hábiles.', '2026-02-01', '2026-01-12 10:00:00'),
    (v_tenant_id, v_case_ids[1], v_admin_id, 'Publicación en Gaceta Oficial completada. Esperando resolución final del RP.', NULL, '2026-02-03 16:45:00')
  ON CONFLICT DO NOTHING;

  -- Case 2 comments
  INSERT INTO comments (tenant_id, case_id, user_id, text, follow_up_date, created_at) VALUES
    (v_tenant_id, v_case_ids[2], v_admin_id, 'Primera reunión con el Sr. Chen. Se explicaron requisitos de inversión mínima ($160,000). Cliente confirma que tiene los fondos.', '2025-11-01', '2025-10-05 11:00:00'),
    (v_tenant_id, v_case_ids[2], v_admin_id, 'Documentos enviados a traducción oficial. Plazo estimado: 3 semanas para los 3 pasaportes + certificados.', '2025-11-30', '2025-10-25 09:00:00'),
    (v_tenant_id, v_case_ids[2], v_admin_id, 'Traducciones recibidas. Calidad verificada. Se procede a apostillar y preparar expediente para SNM.', '2026-01-15', '2025-12-10 15:30:00'),
    (v_tenant_id, v_case_ids[2], v_admin_id, 'ALERTA: Los gastos superan los pagos recibidos. Se debe cobrar saldo pendiente al cliente antes de continuar con el trámite.', '2026-02-01', '2026-01-20 10:30:00'),
    (v_tenant_id, v_case_ids[2], v_admin_id, 'Solicitud presentada ante el SNM. Se programó entrevista para mayo 2026.', NULL, '2026-03-15 14:00:00')
  ON CONFLICT DO NOTHING;

  -- Case 3 comments
  INSERT INTO comments (tenant_id, case_id, user_id, text, follow_up_date, created_at) VALUES
    (v_tenant_id, v_case_ids[3], v_admin_id, 'Cliente relata los hechos del despido. Fue notificado verbalmente sin carta de despido formal. Tiene testigos (2 compañeros).', '2026-02-01', '2026-01-12 10:00:00'),
    (v_tenant_id, v_case_ids[3], v_admin_id, 'Memorial de demanda preparado. Se incluye reclamo de: preaviso, indemnización, vacaciones proporcionales, y XIII mes proporcional.', '2026-02-20', '2026-02-01 16:00:00'),
    (v_tenant_id, v_case_ids[3], v_admin_id, 'Audiencia de conciliación programada para el 8 de abril. Preparar al cliente para posible oferta de la parte demandada.', NULL, '2026-03-25 11:00:00')
  ON CONFLICT DO NOTHING;

  -- Case 5 comments
  INSERT INTO comments (tenant_id, case_id, user_id, text, follow_up_date, created_at) VALUES
    (v_tenant_id, v_case_ids[5], v_admin_id, 'Cliente presenta contrato de compraventa, recibos de pago ($85,000 total), y evidencia de que el inmueble nunca fue construido.', '2026-02-15', '2026-01-22 09:30:00'),
    (v_tenant_id, v_case_ids[5], v_admin_id, 'Querella presentada ante la Fiscalía. Caso asignado al Fiscal Segundo de lo Penal. Próxima audiencia: 5 de marzo.', '2026-03-05', '2026-02-10 14:00:00'),
    (v_tenant_id, v_case_ids[5], v_admin_id, 'Fiscalía ordenó investigación. Se descubrió que la promotora vendió el mismo lote a 3 compradores diferentes. Caso de estafa agravada.', '2026-04-01', '2026-03-08 16:30:00'),
    (v_tenant_id, v_case_ids[5], v_admin_id, 'Se solicitó embargo preventivo sobre los bienes del representante legal de la promotora. Esperando resolución judicial.', NULL, '2026-03-28 10:00:00')
  ON CONFLICT DO NOTHING;

  -- Case 7 comments
  INSERT INTO comments (tenant_id, case_id, user_id, text, follow_up_date, created_at) VALUES
    (v_tenant_id, v_case_ids[7], v_admin_id, 'Reunión inicial con la Ing. Araúz. Definido: SA con capital de $10,000, 3 directores, nombre comercial "TechSolPA".', '2026-03-10', '2026-03-02 10:00:00'),
    (v_tenant_id, v_case_ids[7], v_admin_id, 'Pacto social redactado y aprobado por la cliente. Se envía a notaría para protocolizar.', '2026-03-20', '2026-03-08 15:00:00'),
    (v_tenant_id, v_case_ids[7], v_admin_id, 'Escritura protocolizada. Solicitud de marca "TechSolPA" presentada ante DIGERPI. Búsqueda previa no arrojó conflictos.', NULL, '2026-03-22 11:30:00')
  ON CONFLICT DO NOTHING;

  -- Case 9 comments
  INSERT INTO comments (tenant_id, case_id, user_id, text, follow_up_date, created_at) VALUES
    (v_tenant_id, v_case_ids[9], v_admin_id, 'Reunión con directiva de Fundación Esperanza Viva. Se definió estructura organizativa y objetivos para el registro.', '2026-03-15', '2026-02-22 09:00:00'),
    (v_tenant_id, v_case_ids[9], v_admin_id, 'Documentos de constitución preparados. Se requiere publicación en Gaceta Oficial antes de presentar ante MICI.', NULL, '2026-03-18 14:00:00')
  ON CONFLICT DO NOTHING;

  -- Case 4 comments
  INSERT INTO comments (tenant_id, case_id, user_id, text, follow_up_date, created_at) VALUES
    (v_tenant_id, v_case_ids[4], v_admin_id, 'Dra. Delgado confirma que las 3 sucursales necesitan renovación simultánea. Se coordinará con MINSA.', '2026-03-01', '2026-02-05 10:00:00'),
    (v_tenant_id, v_case_ids[4], v_admin_id, 'Sucursal Bella Vista tiene observaciones del año pasado: aire acondicionado y limpieza de ductos. Ya se corrigió.', '2026-03-20', '2026-03-05 14:30:00'),
    (v_tenant_id, v_case_ids[4], v_admin_id, 'Certificados de fumigación entregados. Inspección MINSA programada para la semana del 14 de abril.', NULL, '2026-03-22 11:00:00')
  ON CONFLICT DO NOTHING;

  -- Case 6 comments
  INSERT INTO comments (tenant_id, case_id, user_id, text, follow_up_date, created_at) VALUES
    (v_tenant_id, v_case_ids[6], v_admin_id, 'Proceso civil iniciado en paralelo al penal. Objetivo principal: recuperación de los $85,000 invertidos por la cliente.', '2026-03-01', '2026-02-08 09:00:00'),
    (v_tenant_id, v_case_ids[6], v_admin_id, 'Se descubrió que la promotora tiene un terreno en Coronado a su nombre. Se solicitará embargo preventivo.', '2026-04-01', '2026-03-12 15:00:00'),
    (v_tenant_id, v_case_ids[6], v_admin_id, 'Peritaje del valor del terreno en Coronado estimado en $120,000. Favorable para la recuperación de la inversión.', NULL, '2026-03-28 10:30:00')
  ON CONFLICT DO NOTHING;

  -- Case 8 comments
  INSERT INTO comments (tenant_id, case_id, user_id, text, follow_up_date, created_at) VALUES
    (v_tenant_id, v_case_ids[8], v_admin_id, 'Reunión con la Ing. Araúz y los 3 ingenieros por videoconferencia. Contratos laborales revisados y firmados.', '2026-03-25', '2026-03-12 11:00:00'),
    (v_tenant_id, v_case_ids[8], v_admin_id, 'Permisos de trabajo presentados ante MITRADEL. Tiempo estimado de aprobación: 3-4 semanas.', '2026-04-15', '2026-03-22 16:00:00')
  ON CONFLICT DO NOTHING;

  -- Case 10 comments (cerrado)
  INSERT INTO comments (tenant_id, case_id, user_id, text, follow_up_date, created_at) VALUES
    (v_tenant_id, v_case_ids[10], v_admin_id, 'Aviso de operación renovado exitosamente. Vigencia hasta diciembre 2026.', NULL, '2025-08-20 09:00:00'),
    (v_tenant_id, v_case_ids[10], v_admin_id, 'Permiso de construcción aprobado por MIVIOT. Documentos entregados al Ing. Ríos.', NULL, '2025-09-10 14:00:00'),
    (v_tenant_id, v_case_ids[10], v_admin_id, 'CASO CERRADO. Todos los permisos en regla. Cliente satisfecho con el resultado.', NULL, '2025-09-20 10:00:00')
  ON CONFLICT DO NOTHING;

  -- Case 11 comments
  INSERT INTO comments (tenant_id, case_id, user_id, text, follow_up_date, created_at) VALUES
    (v_tenant_id, v_case_ids[11], v_admin_id, 'Reunión con José Manuel Barría. El restaurante tiene 45 empleados y necesita actualizar contratos por nueva ley laboral.', '2026-04-01', '2026-03-16 10:00:00'),
    (v_tenant_id, v_case_ids[11], v_admin_id, 'Revisión de contratos actuales completada. Se identificaron 12 contratos sin cláusula de confidencialidad requerida.', NULL, '2026-04-01 11:00:00')
  ON CONFLICT DO NOTHING;

  -- Case 12 comments
  INSERT INTO comments (tenant_id, case_id, user_id, text, follow_up_date, created_at) VALUES
    (v_tenant_id, v_case_ids[12], v_admin_id, 'Aplicante venezolana, casada con panameño desde 2024. Todos los documentos apostillados correctamente.', '2026-04-10', '2026-03-21 09:30:00'),
    (v_tenant_id, v_case_ids[12], v_admin_id, 'Expediente presentado ante SNM. Entrevista de pareja programada para abril.', NULL, '2026-03-30 14:00:00')
  ON CONFLICT DO NOTHING;

  -- ==================== DOCUMENTOS (registros ficticios) =======

  INSERT INTO documents (tenant_id, entity_type, entity_id, file_name, file_path, storage_key, uploaded_by) VALUES
    (v_tenant_id, 'case', v_case_ids[1], 'Pacto_Social_GEPSA.pdf', '/docs/CORP-001/', 'corp-001/pacto-social.pdf', v_admin_id),
    (v_tenant_id, 'case', v_case_ids[1], 'Poder_Notarial_Roberto_Mendez.pdf', '/docs/CORP-001/', 'corp-001/poder-notarial.pdf', v_admin_id),
    (v_tenant_id, 'case', v_case_ids[1], 'Recibo_Registro_Publico.jpg', '/docs/CORP-001/', 'corp-001/recibo-rp.jpg', v_admin_id),
    (v_tenant_id, 'case', v_case_ids[2], 'Pasaporte_Wei_Chen.pdf', '/docs/MIG-001/', 'mig-001/pasaporte-chen.pdf', v_admin_id),
    (v_tenant_id, 'case', v_case_ids[2], 'Traduccion_Oficial_Pasaportes.pdf', '/docs/MIG-001/', 'mig-001/traducciones.pdf', v_admin_id),
    (v_tenant_id, 'case', v_case_ids[2], 'Comprobante_Deposito_Bancario.pdf', '/docs/MIG-001/', 'mig-001/deposito-bancario.pdf', v_admin_id),
    (v_tenant_id, 'case', v_case_ids[2], 'Certificados_Medicos_3_Aplicantes.pdf', '/docs/MIG-001/', 'mig-001/certificados-medicos.pdf', v_admin_id),
    (v_tenant_id, 'case', v_case_ids[3], 'Carta_Despido_Verbal_Testimonio.pdf', '/docs/LAB-001/', 'lab-001/testimonio-despido.pdf', v_admin_id),
    (v_tenant_id, 'case', v_case_ids[3], 'Comprobantes_Pago_5_Anios.pdf', '/docs/LAB-001/', 'lab-001/comprobantes-pago.pdf', v_admin_id),
    (v_tenant_id, 'case', v_case_ids[5], 'Contrato_Compraventa_Apartamento.pdf', '/docs/PEN-001/', 'pen-001/contrato-cv.pdf', v_admin_id),
    (v_tenant_id, 'case', v_case_ids[5], 'Recibos_Pago_85000.pdf', '/docs/PEN-001/', 'pen-001/recibos-pago.pdf', v_admin_id),
    (v_tenant_id, 'case', v_case_ids[5], 'Peritaje_Documentos_Fraudulentos.pdf', '/docs/PEN-001/', 'pen-001/peritaje.pdf', v_admin_id),
    (v_tenant_id, 'case', v_case_ids[7], 'Estatutos_TechSolPA.pdf', '/docs/CORP-002/', 'corp-002/estatutos.pdf', v_admin_id),
    (v_tenant_id, 'case', v_case_ids[7], 'Busqueda_Marca_DIGERPI.pdf', '/docs/CORP-002/', 'corp-002/busqueda-marca.pdf', v_admin_id),
    (v_tenant_id, 'client', v_client_ids[1], 'Cedula_Juridica_GEPSA.pdf', '/docs/clients/CLI-001/', 'cli-001/cedula-juridica.pdf', v_admin_id),
    (v_tenant_id, 'client', v_client_ids[4], 'Pasaporte_Wei_Chen_Copia.pdf', '/docs/clients/CLI-004/', 'cli-004/pasaporte.pdf', v_admin_id),
    (v_tenant_id, 'client', v_client_ids[8], 'Cedula_Ana_Espinoza.jpg', '/docs/clients/CLI-008/', 'cli-008/cedula.jpg', v_admin_id),
    -- Additional documents for completeness
    (v_tenant_id, 'case', v_case_ids[4], 'Licencia_Sanitaria_Anterior.pdf', '/docs/REG-001/', 'reg-001/licencia-anterior.pdf', v_admin_id),
    (v_tenant_id, 'case', v_case_ids[4], 'Certificado_Fumigacion_Bella_Vista.pdf', '/docs/REG-001/', 'reg-001/fumigacion-bv.pdf', v_admin_id),
    (v_tenant_id, 'case', v_case_ids[6], 'Demanda_Civil_Danos_Perjuicios.pdf', '/docs/CIV-001/', 'civ-001/demanda-civil.pdf', v_admin_id),
    (v_tenant_id, 'case', v_case_ids[6], 'Avaluo_Terreno_Coronado.pdf', '/docs/CIV-001/', 'civ-001/avaluo-terreno.pdf', v_admin_id),
    (v_tenant_id, 'case', v_case_ids[8], 'Contratos_Laborales_Ingenieros.pdf', '/docs/MIG-002/', 'mig-002/contratos-laborales.pdf', v_admin_id),
    (v_tenant_id, 'case', v_case_ids[8], 'Solicitud_MITRADEL_Permisos_Trabajo.pdf', '/docs/MIG-002/', 'mig-002/solicitud-mitradel.pdf', v_admin_id),
    (v_tenant_id, 'case', v_case_ids[9], 'Acta_Constitutiva_Fundacion.pdf', '/docs/ADM-001/', 'adm-001/acta-constitutiva.pdf', v_admin_id),
    (v_tenant_id, 'case', v_case_ids[10], 'Aviso_Operacion_Renovado.pdf', '/docs/CORP-003/', 'corp-003/aviso-operacion.pdf', v_admin_id),
    (v_tenant_id, 'case', v_case_ids[10], 'Permiso_Construccion_2026.pdf', '/docs/CORP-003/', 'corp-003/permiso-construccion.pdf', v_admin_id),
    (v_tenant_id, 'case', v_case_ids[11], 'Reglamento_Interno_Borrador.docx', '/docs/LAB-002/', 'lab-002/reglamento-borrador.docx', v_admin_id),
    (v_tenant_id, 'case', v_case_ids[12], 'Acta_Matrimonio_Apostillada.pdf', '/docs/MIG-003/', 'mig-003/acta-matrimonio.pdf', v_admin_id),
    (v_tenant_id, 'case', v_case_ids[12], 'Antecedentes_Penales_Apostillados.pdf', '/docs/MIG-003/', 'mig-003/antecedentes.pdf', v_admin_id),
    (v_tenant_id, 'client', v_client_ids[3], 'RUC_Constructora_Istmena.pdf', '/docs/clients/CLI-003/', 'cli-003/ruc.pdf', v_admin_id),
    (v_tenant_id, 'client', v_client_ids[5], 'Cedula_Luis_Quintero.jpg', '/docs/clients/CLI-005/', 'cli-005/cedula.jpg', v_admin_id),
    (v_tenant_id, 'client', v_client_ids[6], 'RUC_Farmacia_San_Judas.pdf', '/docs/clients/CLI-006/', 'cli-006/ruc.pdf', v_admin_id),
    (v_tenant_id, 'client', v_client_ids[7], 'RUC_El_Trapiche.pdf', '/docs/clients/CLI-007/', 'cli-007/ruc.pdf', v_admin_id),
    (v_tenant_id, 'client', v_client_ids[9], 'Acta_Constitutiva_TechSol.pdf', '/docs/clients/CLI-009/', 'cli-009/acta.pdf', v_admin_id),
    (v_tenant_id, 'client', v_client_ids[10], 'Carta_Fundacion_Esperanza_Viva.pdf', '/docs/clients/CLI-010/', 'cli-010/carta-fundacion.pdf', v_admin_id)
  ON CONFLICT DO NOTHING;

  -- Update last_followup_at for ALL cases with comments
  UPDATE cases SET last_followup_at = '2026-02-03' WHERE id = v_case_ids[1];
  UPDATE cases SET last_followup_at = '2026-03-15' WHERE id = v_case_ids[2];
  UPDATE cases SET last_followup_at = '2026-03-25' WHERE id = v_case_ids[3];
  UPDATE cases SET last_followup_at = '2026-03-22' WHERE id = v_case_ids[4];
  UPDATE cases SET last_followup_at = '2026-03-28' WHERE id = v_case_ids[5];
  UPDATE cases SET last_followup_at = '2026-03-28' WHERE id = v_case_ids[6];
  UPDATE cases SET last_followup_at = '2026-03-22' WHERE id = v_case_ids[7];
  UPDATE cases SET last_followup_at = '2026-03-22' WHERE id = v_case_ids[8];
  UPDATE cases SET last_followup_at = '2026-03-18' WHERE id = v_case_ids[9];
  UPDATE cases SET last_followup_at = '2025-09-20' WHERE id = v_case_ids[10];
  UPDATE cases SET last_followup_at = '2026-04-01' WHERE id = v_case_ids[11];
  UPDATE cases SET last_followup_at = '2026-03-30' WHERE id = v_case_ids[12];

  -- Assign responsible and assistant to cases
  UPDATE cases SET assistant_id = v_team_carlos WHERE id IN (v_case_ids[1], v_case_ids[2], v_case_ids[5], v_case_ids[7], v_case_ids[8]);
  UPDATE cases SET assistant_id = v_team_ana WHERE id IN (v_case_ids[3], v_case_ids[4], v_case_ids[6], v_case_ids[9], v_case_ids[11], v_case_ids[12]);

  RAISE NOTICE 'Demo data seeded successfully! Tenant: %, Clients: 10, Cases: 12, with full expenses, tasks, comments, and documents', v_tenant_id;
END $$;
