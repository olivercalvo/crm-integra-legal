-- ============================================================
-- MIGRACIÓN FINAL CONSOLIDADA — CRM Integra Legal
-- Fecha: 2026-04-03
-- Ejecutar en Supabase SQL Editor
--
-- 1. assistant_id en cases
-- 2. address + client_since en clients
-- 3. responsible_id FK: cat_team → users (mapping exacto)
-- 4. Datos demo (direcciones, gastos, tareas, comentarios)
-- ============================================================

-- 1. assistant_id
ALTER TABLE cases ADD COLUMN IF NOT EXISTS assistant_id UUID REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_cases_assistant_id ON cases(assistant_id);

-- 2. Campos de cliente
ALTER TABLE clients ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS client_since DATE;

-- 3. PRIMERO quitar el FK viejo (apunta a cat_team)
ALTER TABLE cases DROP CONSTRAINT IF EXISTS cases_responsible_id_fkey;

-- 4. Mapear responsible_id de cat_team a users (IDs exactos)
-- Daveiva: cat_team cac353a5 → users d5cf61cb
-- Milena:  cat_team 7942b5e8 → users aefb05ce
UPDATE cases SET responsible_id = 'd5cf61cb-2f1f-4e1b-8fd1-1db82dd16867'
WHERE responsible_id = 'cac353a5-da8f-4bbf-8033-e1162024320c';

UPDATE cases SET responsible_id = 'aefb05ce-871a-4f6a-a952-2e385dc45176'
WHERE responsible_id = '7942b5e8-41e7-4fd1-af20-8f04c2de9be4';

-- 5. Agregar el FK nuevo (apunta a users)
ALTER TABLE cases ADD CONSTRAINT cases_responsible_id_fkey
  FOREIGN KEY (responsible_id) REFERENCES users(id);

-- 4. Datos demo
DO $$
DECLARE
  v_tenant_id UUID := 'a0000000-0000-0000-0000-000000000001';
  v_abogada1_id UUID := 'd5cf61cb-2f1f-4e1b-8fd1-1db82dd16867';
  v_abogada2_id UUID := 'aefb05ce-871a-4f6a-a952-2e385dc45176';
  v_asistente1_id UUID := '01e10f7f-b937-47a3-a4d3-5f4ead894fa8';
  v_case_ids UUID[];
BEGIN

-- Set assistant_id
UPDATE cases SET assistant_id = v_asistente1_id
WHERE tenant_id = v_tenant_id AND assistant_id IS NULL;

-- Client addresses + client_since
UPDATE clients SET
  address = CASE
    WHEN client_number = 'CLI-001' THEN 'Calle 50 Este, Torre Global Bank Piso 14, Ciudad de Panamá'
    WHEN client_number = 'CLI-002' THEN 'Ave. Balboa, PH Oceanía Business Plaza Torre 2000, Piso 5'
    WHEN client_number = 'CLI-003' THEN 'Vía España, Centro Comercial El Dorado, Local 203'
    WHEN client_number = 'CLI-004' THEN 'Costa del Este, PH Financial Park Torre A, Piso 8'
    WHEN client_number = 'CLI-005' THEN 'Ave. Ricardo J. Alfaro, Plaza Edison, Local 12'
    WHEN client_number = 'CLI-006' THEN 'Calle Aquilino de la Guardia, Edificio IGRA, PB'
    WHEN client_number = 'CLI-007' THEN 'Vía Porras, San Francisco, Edif. Victoria Plaza, Of. 301'
    WHEN client_number = 'CLI-008' THEN 'Calle 74 San Francisco, Edificio Soho Mall, Piso 3'
    WHEN client_number = 'CLI-009' THEN 'Ave. Samuel Lewis, Obarrio, Edificio ADR Tower, Of. 801'
    WHEN client_number = 'CLI-010' THEN 'Calle Manuel María Icaza, Edificio Comosa, PB'
    WHEN client_number = 'CLI-011' THEN 'Cinta Costera 3, PH Vitri Tower, Piso 22'
    WHEN client_number = 'CLI-012' THEN 'Ave. Centenario, Edificio Sun Tower, Of. 503'
    WHEN client_number = 'CLI-013' THEN 'Costa del Este, Town Center, Of. 210'
    WHEN client_number = 'CLI-014' THEN 'Calle 50, Edificio Credicorp Bank, Piso 10'
    WHEN client_number = 'CLI-015' THEN 'Vía Israel, San Francisco, Edif. PH Midtown, Apt. 8B'
    WHEN client_number = 'CLI-016' THEN 'Ave. Justo Arosemena, Edif. Los Profesionales, Of. 7'
    WHEN client_number = 'CLI-017' THEN 'Calle 73, San Francisco, Residencial Serenity'
    WHEN client_number = 'CLI-018' THEN 'Vía Argentina, El Cangrejo, Edif. Miramar, PB'
    WHEN client_number = 'CLI-019' THEN 'Ave. Domingo Díaz, Juan Díaz, Plaza Tocumen'
    WHEN client_number = 'CLI-020' THEN 'Calle Eusebio A. Morales, Bella Vista, Of. 301'
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
    WHEN client_number = 'CLI-011' THEN '2023-05-12'::DATE
    WHEN client_number = 'CLI-012' THEN '2024-02-28'::DATE
    WHEN client_number = 'CLI-013' THEN '2024-07-14'::DATE
    WHEN client_number = 'CLI-014' THEN '2024-11-03'::DATE
    WHEN client_number = 'CLI-015' THEN '2025-02-18'::DATE
    WHEN client_number = 'CLI-016' THEN '2025-04-22'::DATE
    WHEN client_number = 'CLI-017' THEN '2025-07-10'::DATE
    WHEN client_number = 'CLI-018' THEN '2025-09-01'::DATE
    WHEN client_number = 'CLI-019' THEN '2025-11-15'::DATE
    WHEN client_number = 'CLI-020' THEN '2026-02-01'::DATE
    ELSE '2025-01-01'::DATE
  END
WHERE tenant_id = v_tenant_id AND address IS NULL;

-- Expenses + payments
v_case_ids := ARRAY(SELECT id FROM cases WHERE tenant_id = v_tenant_id ORDER BY case_number LIMIT 12);

IF array_length(v_case_ids, 1) >= 6 THEN
  INSERT INTO expenses (tenant_id, case_id, amount, concept, date, registered_by) VALUES
    (v_tenant_id, v_case_ids[1], 350.00, 'Tasa de registro mercantil', '2026-01-15', v_asistente1_id),
    (v_tenant_id, v_case_ids[1], 125.00, 'Certificación de libre gravamen', '2026-01-20', v_asistente1_id),
    (v_tenant_id, v_case_ids[1], 75.00, 'Copias notariadas del acta', '2026-02-01', v_asistente1_id),
    (v_tenant_id, v_case_ids[2], 200.00, 'Timbres fiscales', '2026-02-05', v_asistente1_id),
    (v_tenant_id, v_case_ids[2], 450.00, 'Perito traductor jurado', '2026-02-15', v_asistente1_id),
    (v_tenant_id, v_case_ids[2], 180.00, 'Apostilla de documentos', '2026-02-20', v_asistente1_id),
    (v_tenant_id, v_case_ids[2], 95.00, 'Transporte a SNM', '2026-03-01', v_asistente1_id),
    (v_tenant_id, v_case_ids[3], 500.00, 'Depósito judicial demanda laboral', '2026-01-25', v_asistente1_id),
    (v_tenant_id, v_case_ids[3], 150.00, 'Notificación por edicto', '2026-02-10', v_asistente1_id),
    (v_tenant_id, v_case_ids[4], 1200.00, 'Honorarios perito contable', '2026-02-01', v_asistente1_id),
    (v_tenant_id, v_case_ids[4], 800.00, 'Investigación patrimonial', '2026-02-15', v_asistente1_id),
    (v_tenant_id, v_case_ids[4], 350.00, 'Viáticos Chiriquí', '2026-03-01', v_asistente1_id),
    (v_tenant_id, v_case_ids[5], 275.00, 'Impuesto transferencia ANATI', '2026-03-05', v_asistente1_id),
    (v_tenant_id, v_case_ids[5], 150.00, 'Certificado catastral', '2026-03-10', v_asistente1_id),
    (v_tenant_id, v_case_ids[6], 500.00, 'Registro marca DIGERPI', '2026-01-30', v_asistente1_id)
  ON CONFLICT DO NOTHING;

  INSERT INTO client_payments (tenant_id, case_id, amount, payment_date, registered_by) VALUES
    (v_tenant_id, v_case_ids[1], 1500.00, '2026-01-10', v_abogada1_id),
    (v_tenant_id, v_case_ids[2], 800.00, '2026-02-01', v_abogada1_id),
    (v_tenant_id, v_case_ids[3], 2000.00, '2026-01-20', v_abogada2_id),
    (v_tenant_id, v_case_ids[3], 500.00, '2026-03-01', v_abogada2_id),
    (v_tenant_id, v_case_ids[4], 1000.00, '2026-01-25', v_abogada1_id),
    (v_tenant_id, v_case_ids[5], 3500.00, '2026-03-01', v_abogada2_id),
    (v_tenant_id, v_case_ids[6], 500.00, '2026-01-28', v_abogada1_id)
  ON CONFLICT DO NOTHING;

  -- Tasks
  INSERT INTO tasks (tenant_id, case_id, description, deadline, assigned_to, status, created_by) VALUES
    (v_tenant_id, v_case_ids[1], 'Recoger certificado de Registro Público', '2026-04-10', v_asistente1_id, 'pendiente', v_abogada1_id),
    (v_tenant_id, v_case_ids[1], 'Enviar copia del acta constitutiva al cliente', '2026-04-05', v_asistente1_id, 'cumplida', v_abogada1_id),
    (v_tenant_id, v_case_ids[2], 'Entregar documentos apostillados en Migración', '2026-04-08', v_asistente1_id, 'pendiente', v_abogada1_id),
    (v_tenant_id, v_case_ids[2], 'Solicitar cita en SNM', '2026-03-28', v_asistente1_id, 'cumplida', v_abogada1_id),
    (v_tenant_id, v_case_ids[3], 'Preparar pruebas documentales para audiencia', '2026-04-15', v_asistente1_id, 'pendiente', v_abogada2_id),
    (v_tenant_id, v_case_ids[3], 'Notificar al demandado por edicto', '2026-03-20', v_asistente1_id, 'cumplida', v_abogada2_id),
    (v_tenant_id, v_case_ids[4], 'Coordinar con perito contable', '2026-04-12', v_asistente1_id, 'pendiente', v_abogada1_id),
    (v_tenant_id, v_case_ids[5], 'Verificar trámite en ANATI', '2026-04-07', v_asistente1_id, 'pendiente', v_abogada2_id),
    (v_tenant_id, v_case_ids[6], 'Confirmar publicación en Gaceta Oficial', '2026-04-03', v_asistente1_id, 'cumplida', v_abogada1_id)
  ON CONFLICT DO NOTHING;

  -- Comments
  INSERT INTO comments (tenant_id, case_id, text, user_id, follow_up_date) VALUES
    (v_tenant_id, v_case_ids[1], 'Escritura presentada ante Registro Público. Esperando calificación.', v_abogada1_id, '2026-04-08'),
    (v_tenant_id, v_case_ids[1], 'Registro calificó favorablemente. Pendiente recoger certificado.', v_abogada1_id, '2026-04-15'),
    (v_tenant_id, v_case_ids[2], 'Cliente entregó pasaporte y documentos. Se apostillaron.', v_abogada1_id, '2026-03-15'),
    (v_tenant_id, v_case_ids[2], 'Cita obtenida para 8 de abril en SNM Albrook.', v_asistente1_id, '2026-04-08'),
    (v_tenant_id, v_case_ids[3], 'Demanda laboral interpuesta ante Junta No. 5. Admitida.', v_abogada2_id, '2026-02-25'),
    (v_tenant_id, v_case_ids[3], 'Audiencia de conciliación fijada para 15 de abril.', v_abogada2_id, '2026-04-15'),
    (v_tenant_id, v_case_ids[4], 'Estados financieros recibidos. Remitidos al perito.', v_abogada1_id, '2026-03-01'),
    (v_tenant_id, v_case_ids[4], 'Perito solicita extensión. Se concedieron 10 días.', v_asistente1_id, '2026-03-20'),
    (v_tenant_id, v_case_ids[5], 'Solicitud ante ANATI presentada. Pendiente inspección.', v_abogada2_id, '2026-03-20'),
    (v_tenant_id, v_case_ids[6], 'Marca registrada en DIGERPI. Certificado en trámite.', v_abogada1_id, '2026-04-01')
  ON CONFLICT DO NOTHING;

  -- Set completed_at for cumplidas
  UPDATE tasks SET completed_at = (created_at::TIMESTAMP + INTERVAL '3 days')::TIMESTAMPTZ
  WHERE tenant_id = v_tenant_id AND status = 'cumplida' AND completed_at IS NULL;
END IF;

END $$;
