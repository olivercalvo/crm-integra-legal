-- =============================================
-- Seed: Complete demo data with realistic Panamanian legal data
-- Date: 2026-04-03
-- Run AFTER all migrations (assistant_id, client fields, responsible_id)
-- =============================================

-- Get tenant ID (assumes single-tenant demo)
DO $$
DECLARE
  v_tenant_id UUID;
  v_admin_id UUID;
  v_abogada1_id UUID;
  v_abogada2_id UUID;
  v_asistente1_id UUID;
  v_client_ids UUID[];
  v_case_ids UUID[];
  v_i INT;
BEGIN

-- Get the first tenant
SELECT id INTO v_tenant_id FROM tenants LIMIT 1;
IF v_tenant_id IS NULL THEN
  RAISE EXCEPTION 'No tenant found. Create a tenant first.';
END IF;

-- Get user IDs (adjust these queries based on your actual users)
SELECT id INTO v_admin_id FROM users WHERE role = 'admin' AND tenant_id = v_tenant_id LIMIT 1;
SELECT id INTO v_abogada1_id FROM users WHERE role = 'abogada' AND tenant_id = v_tenant_id LIMIT 1;
SELECT id INTO v_abogada2_id FROM users WHERE role = 'abogada' AND tenant_id = v_tenant_id OFFSET 1 LIMIT 1;
SELECT id INTO v_asistente1_id FROM users WHERE role = 'asistente' AND tenant_id = v_tenant_id LIMIT 1;

-- Use admin as fallback
IF v_abogada1_id IS NULL THEN v_abogada1_id := v_admin_id; END IF;
IF v_abogada2_id IS NULL THEN v_abogada2_id := v_abogada1_id; END IF;
IF v_asistente1_id IS NULL THEN v_asistente1_id := v_admin_id; END IF;

-- Update clients with address and client_since for existing records
UPDATE clients SET
  address = CASE
    WHEN client_number = 'CLI-001' THEN 'Calle 50 Este, Torre Global Bank Piso 14, Ciudad de Panamá'
    WHEN client_number = 'CLI-002' THEN 'Ave. Balboa, PH Oceanía Business Plaza Torre 2000, Piso 5'
    WHEN client_number = 'CLI-003' THEN 'Vía España, Centro Comercial El Dorado, Local 203'
    WHEN client_number = 'CLI-004' THEN 'Costa del Este, PH Financial Park Torre A, Piso 8'
    WHEN client_number = 'CLI-005' THEN 'Ave. Ricardo J. Alfaro (Tumba Muerto), Plaza Edison, Local 12'
    WHEN client_number = 'CLI-006' THEN 'Calle Aquilino de la Guardia, Edificio IGRA, Planta Baja'
    WHEN client_number = 'CLI-007' THEN 'Vía Porras, San Francisco, Edificio Victoria Plaza, Of. 301'
    WHEN client_number = 'CLI-008' THEN 'Calle 74 San Francisco, Edificio Soho Mall, Piso 3'
    WHEN client_number = 'CLI-009' THEN 'Ave. Samuel Lewis, Obarrio, Edificio ADR Tower, Of. 801'
    WHEN client_number = 'CLI-010' THEN 'Calle Manuel María Icaza, Edificio Comosa, PB'
    ELSE 'Ciudad de Panamá'
  END,
  client_since = CASE
    WHEN client_number = 'CLI-001' THEN '2024-03-15'::DATE
    WHEN client_number = 'CLI-002' THEN '2024-06-01'::DATE
    WHEN client_number = 'CLI-003' THEN '2024-09-20'::DATE
    WHEN client_number = 'CLI-004' THEN '2025-01-10'::DATE
    WHEN client_number = 'CLI-005' THEN '2025-03-05'::DATE
    WHEN client_number = 'CLI-006' THEN '2023-11-28'::DATE
    WHEN client_number = 'CLI-007' THEN '2025-06-15'::DATE
    WHEN client_number = 'CLI-008' THEN '2024-12-01'::DATE
    WHEN client_number = 'CLI-009' THEN '2025-08-22'::DATE
    WHEN client_number = 'CLI-010' THEN '2026-01-08'::DATE
    ELSE '2025-01-01'::DATE
  END
WHERE tenant_id = v_tenant_id AND address IS NULL;

-- Update cases: set responsible_id and assistant_id to user IDs
UPDATE cases SET
  responsible_id = CASE
    WHEN case_number % 2 = 0 THEN v_abogada1_id
    ELSE v_abogada2_id
  END,
  assistant_id = v_asistente1_id
WHERE tenant_id = v_tenant_id AND responsible_id IS NULL;

-- Collect case IDs for inserting related data
v_case_ids := ARRAY(SELECT id FROM cases WHERE tenant_id = v_tenant_id ORDER BY case_number LIMIT 12);

-- Insert expenses for cases that don't have them yet
IF array_length(v_case_ids, 1) >= 1 THEN
  -- Case 1: Various expenses
  INSERT INTO expenses (tenant_id, case_id, amount, concept, date, registered_by) VALUES
    (v_tenant_id, v_case_ids[1], 350.00, 'Tasa de registro mercantil', '2026-01-15', v_asistente1_id),
    (v_tenant_id, v_case_ids[1], 125.00, 'Certificación de libre gravamen', '2026-01-20', v_asistente1_id),
    (v_tenant_id, v_case_ids[1], 75.00, 'Copias notariadas del acta', '2026-02-01', v_asistente1_id)
  ON CONFLICT DO NOTHING;

  INSERT INTO client_payments (tenant_id, case_id, amount, payment_date, registered_by) VALUES
    (v_tenant_id, v_case_ids[1], 1500.00, '2026-01-10', v_abogada1_id)
  ON CONFLICT DO NOTHING;
END IF;

IF array_length(v_case_ids, 1) >= 2 THEN
  INSERT INTO expenses (tenant_id, case_id, amount, concept, date, registered_by) VALUES
    (v_tenant_id, v_case_ids[2], 200.00, 'Timbres fiscales', '2026-02-05', v_asistente1_id),
    (v_tenant_id, v_case_ids[2], 450.00, 'Perito traductor jurado', '2026-02-15', v_asistente1_id),
    (v_tenant_id, v_case_ids[2], 180.00, 'Apostilla de documentos', '2026-02-20', v_asistente1_id),
    (v_tenant_id, v_case_ids[2], 95.00, 'Transporte a Servicio Nacional de Migración', '2026-03-01', v_asistente1_id)
  ON CONFLICT DO NOTHING;

  INSERT INTO client_payments (tenant_id, case_id, amount, payment_date, registered_by) VALUES
    (v_tenant_id, v_case_ids[2], 800.00, '2026-02-01', v_abogada1_id)
  ON CONFLICT DO NOTHING;
END IF;

IF array_length(v_case_ids, 1) >= 3 THEN
  INSERT INTO expenses (tenant_id, case_id, amount, concept, date, registered_by) VALUES
    (v_tenant_id, v_case_ids[3], 500.00, 'Depósito judicial por demanda laboral', '2026-01-25', v_asistente1_id),
    (v_tenant_id, v_case_ids[3], 150.00, 'Notificación por edicto', '2026-02-10', v_asistente1_id)
  ON CONFLICT DO NOTHING;

  INSERT INTO client_payments (tenant_id, case_id, amount, payment_date, registered_by) VALUES
    (v_tenant_id, v_case_ids[3], 2000.00, '2026-01-20', v_abogada2_id),
    (v_tenant_id, v_case_ids[3], 500.00, '2026-03-01', v_abogada2_id)
  ON CONFLICT DO NOTHING;
END IF;

IF array_length(v_case_ids, 1) >= 4 THEN
  -- Case 4: In the red (negative balance)
  INSERT INTO expenses (tenant_id, case_id, amount, concept, date, registered_by) VALUES
    (v_tenant_id, v_case_ids[4], 1200.00, 'Honorarios perito contable', '2026-02-01', v_asistente1_id),
    (v_tenant_id, v_case_ids[4], 800.00, 'Gastos de investigación patrimonial', '2026-02-15', v_asistente1_id),
    (v_tenant_id, v_case_ids[4], 350.00, 'Transporte y viáticos Chiriquí', '2026-03-01', v_asistente1_id)
  ON CONFLICT DO NOTHING;

  INSERT INTO client_payments (tenant_id, case_id, amount, payment_date, registered_by) VALUES
    (v_tenant_id, v_case_ids[4], 1000.00, '2026-01-25', v_abogada1_id)
  ON CONFLICT DO NOTHING;
END IF;

IF array_length(v_case_ids, 1) >= 5 THEN
  INSERT INTO expenses (tenant_id, case_id, amount, concept, date, registered_by) VALUES
    (v_tenant_id, v_case_ids[5], 275.00, 'Impuesto de transferencia ANATI', '2026-03-05', v_asistente1_id),
    (v_tenant_id, v_case_ids[5], 150.00, 'Certificado catastral', '2026-03-10', v_asistente1_id)
  ON CONFLICT DO NOTHING;

  INSERT INTO client_payments (tenant_id, case_id, amount, payment_date, registered_by) VALUES
    (v_tenant_id, v_case_ids[5], 3500.00, '2026-03-01', v_abogada2_id)
  ON CONFLICT DO NOTHING;
END IF;

IF array_length(v_case_ids, 1) >= 6 THEN
  -- Case 6: Zero balance
  INSERT INTO expenses (tenant_id, case_id, amount, concept, date, registered_by) VALUES
    (v_tenant_id, v_case_ids[6], 500.00, 'Registro de marca en DIGERPI', '2026-01-30', v_asistente1_id)
  ON CONFLICT DO NOTHING;

  INSERT INTO client_payments (tenant_id, case_id, amount, payment_date, registered_by) VALUES
    (v_tenant_id, v_case_ids[6], 500.00, '2026-01-28', v_abogada1_id)
  ON CONFLICT DO NOTHING;
END IF;

-- Insert tasks for various cases
IF array_length(v_case_ids, 1) >= 3 THEN
  INSERT INTO tasks (tenant_id, case_id, description, deadline, assigned_to, status, created_by) VALUES
    (v_tenant_id, v_case_ids[1], 'Recoger certificado de Registro Público', '2026-04-10', v_asistente1_id, 'pendiente', v_abogada1_id),
    (v_tenant_id, v_case_ids[1], 'Enviar copia del acta constitutiva al cliente', '2026-04-05', v_asistente1_id, 'cumplida', v_abogada1_id),
    (v_tenant_id, v_case_ids[2], 'Entregar documentos apostillados en Migración', '2026-04-08', v_asistente1_id, 'pendiente', v_abogada1_id),
    (v_tenant_id, v_case_ids[2], 'Solicitar cita en Servicio Nacional de Migración', '2026-03-28', v_asistente1_id, 'cumplida', v_abogada1_id),
    (v_tenant_id, v_case_ids[3], 'Preparar pruebas documentales para audiencia', '2026-04-15', v_asistente1_id, 'pendiente', v_abogada2_id),
    (v_tenant_id, v_case_ids[3], 'Notificar al demandado por edicto', '2026-03-20', v_asistente1_id, 'cumplida', v_abogada2_id)
  ON CONFLICT DO NOTHING;
END IF;

IF array_length(v_case_ids, 1) >= 6 THEN
  INSERT INTO tasks (tenant_id, case_id, description, deadline, assigned_to, status, created_by) VALUES
    (v_tenant_id, v_case_ids[4], 'Coordinar con perito contable para informe', '2026-04-12', v_asistente1_id, 'pendiente', v_abogada1_id),
    (v_tenant_id, v_case_ids[5], 'Verificar estatus de trámite en ANATI', '2026-04-07', v_asistente1_id, 'pendiente', v_abogada2_id),
    (v_tenant_id, v_case_ids[6], 'Confirmar publicación en Gaceta Oficial', '2026-04-03', v_asistente1_id, 'cumplida', v_abogada1_id)
  ON CONFLICT DO NOTHING;
END IF;

-- Insert comments for various cases
IF array_length(v_case_ids, 1) >= 4 THEN
  INSERT INTO comments (tenant_id, case_id, text, user_id, follow_up_date) VALUES
    (v_tenant_id, v_case_ids[1], 'Se presentó escritura ante Registro Público. Esperando calificación registral. Plazo estimado: 5 días hábiles.', v_abogada1_id, '2026-04-08'),
    (v_tenant_id, v_case_ids[1], 'Registro Público calificó favorablemente. Pendiente recoger certificado.', v_abogada1_id, '2026-04-15'),
    (v_tenant_id, v_case_ids[2], 'Cliente entregó pasaporte y documentos de respaldo. Se procedió a apostillar. Próximo paso: solicitar cita en SNM.', v_abogada1_id, '2026-03-15'),
    (v_tenant_id, v_case_ids[2], 'Cita obtenida para el 8 de abril en SNM Sede Albrook. Se prepararon todos los documentos.', v_asistente1_id, '2026-04-08'),
    (v_tenant_id, v_case_ids[3], 'Se interpuso demanda laboral ante Junta de Conciliación y Decisión No. 5. Expediente admitido.', v_abogada2_id, '2026-02-25'),
    (v_tenant_id, v_case_ids[3], 'Audiencia de conciliación fijada para el 15 de abril. Se notificó al demandado.', v_abogada2_id, '2026-04-15'),
    (v_tenant_id, v_case_ids[4], 'Recibidos estados financieros de la sociedad. Se remitieron al perito contable para análisis.', v_abogada1_id, '2026-03-01'),
    (v_tenant_id, v_case_ids[4], 'Perito solicita extensión de plazo para informe. Se concedieron 10 días adicionales.', v_asistente1_id, '2026-03-20')
  ON CONFLICT DO NOTHING;
END IF;

IF array_length(v_case_ids, 1) >= 6 THEN
  INSERT INTO comments (tenant_id, case_id, text, user_id, follow_up_date) VALUES
    (v_tenant_id, v_case_ids[5], 'Se presentó solicitud de transferencia ante ANATI. Número de expediente asignado. Pendiente inspección.', v_abogada2_id, '2026-03-20'),
    (v_tenant_id, v_case_ids[6], 'Marca registrada exitosamente en DIGERPI. Certificado en trámite de impresión.', v_abogada1_id, '2026-04-01')
  ON CONFLICT DO NOTHING;
END IF;

-- Mark completed tasks with completed_at timestamp
UPDATE tasks SET completed_at = CASE
  WHEN status = 'cumplida' THEN (created_at::TIMESTAMP + INTERVAL '3 days')::TIMESTAMPTZ
  ELSE NULL
END
WHERE tenant_id = v_tenant_id AND status = 'cumplida' AND completed_at IS NULL;

END $$;
