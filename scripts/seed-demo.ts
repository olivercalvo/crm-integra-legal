/**
 * Seed demo data for CRM Integra Legal
 * Run: npx tsx scripts/seed-demo.ts
 */
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(__dirname, "../.env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing SUPABASE_URL or SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function seed() {
  console.log("🔗 Connecting to Supabase...");

  // Get tenant
  const { data: tenants } = await db.from("tenants").select("id").limit(1);
  if (!tenants?.length) {
    console.error("❌ No tenant found. Create a tenant first.");
    process.exit(1);
  }
  const tenantId = tenants[0].id;
  console.log(`✅ Tenant: ${tenantId}`);

  // Get first user
  const { data: users } = await db
    .from("users")
    .select("id, full_name, role")
    .eq("tenant_id", tenantId)
    .limit(5);
  if (!users?.length) {
    console.error("❌ No users found.");
    process.exit(1);
  }
  const adminUser = users[0];
  console.log(`✅ User: ${adminUser.full_name} (${adminUser.role})`);

  // ==================== CATALOGS ==============================
  console.log("\n📋 Seeding catalogs...");

  // Statuses
  const statusData = [
    { name: "Activo", tenant_id: tenantId, active: true },
    { name: "En trámite", tenant_id: tenantId, active: true },
    { name: "Cerrado", tenant_id: tenantId, active: true },
  ];
  for (const s of statusData) {
    const { data: existing } = await db
      .from("cat_statuses")
      .select("id")
      .eq("tenant_id", tenantId)
      .ilike("name", `%${s.name.replace("á", "%")}%`)
      .limit(1);
    if (!existing?.length) {
      await db.from("cat_statuses").insert(s);
    }
  }
  const { data: statuses } = await db
    .from("cat_statuses")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .eq("active", true);

  const getStatus = (partial: string) =>
    statuses?.find((s) => s.name.toLowerCase().includes(partial.toLowerCase()))?.id ?? null;
  const statusActivo = getStatus("activ");
  const statusTramite = getStatus("trámite") ?? getStatus("tramite");
  const statusCerrado = getStatus("cerrad");
  console.log(`  Statuses: ${statuses?.length} (activo=${!!statusActivo}, trámite=${!!statusTramite}, cerrado=${!!statusCerrado})`);

  // Classifications
  const classData = [
    { name: "Corporativo", prefix: "CORP" },
    { name: "Migración", prefix: "MIG" },
    { name: "Laboral", prefix: "LAB" },
    { name: "Penal", prefix: "PEN" },
    { name: "Civil", prefix: "CIV" },
    { name: "Administrativo", prefix: "ADM" },
    { name: "Regulatorio", prefix: "REG" },
  ];
  for (const c of classData) {
    const { data: existing } = await db
      .from("cat_classifications")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("prefix", c.prefix)
      .limit(1);
    if (!existing?.length) {
      await db.from("cat_classifications").insert({ ...c, tenant_id: tenantId, active: true });
    }
  }
  const { data: classifications } = await db
    .from("cat_classifications")
    .select("id, name, prefix")
    .eq("tenant_id", tenantId)
    .eq("active", true);
  const getClass = (prefix: string) =>
    classifications?.find((c) => c.prefix === prefix)?.id ?? null;
  console.log(`  Classifications: ${classifications?.length}`);

  // Institutions
  const instData = [
    "Registro Público",
    "MICI",
    "MINSA",
    "Servicio Nacional de Migración",
    "Municipio de Panamá",
  ];
  for (const name of instData) {
    const { data: existing } = await db
      .from("cat_institutions")
      .select("id")
      .eq("tenant_id", tenantId)
      .ilike("name", `%${name}%`)
      .limit(1);
    if (!existing?.length) {
      await db.from("cat_institutions").insert({ name, tenant_id: tenantId, active: true });
    }
  }
  const { data: institutions } = await db
    .from("cat_institutions")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .eq("active", true);
  const getInst = (partial: string) =>
    institutions?.find((i) => i.name.toLowerCase().includes(partial.toLowerCase()))?.id ?? null;
  console.log(`  Institutions: ${institutions?.length}`);

  // Team
  const teamData = [
    { name: "Daveiva Morales", role: "abogada" },
    { name: "Milena Rodríguez", role: "abogada" },
    { name: "Carlos Pérez", role: "asistente" },
    { name: "Ana Vega", role: "asistente" },
  ];
  for (const t of teamData) {
    const { data: existing } = await db
      .from("cat_team")
      .select("id")
      .eq("tenant_id", tenantId)
      .ilike("name", `%${t.name.split(" ")[0]}%`)
      .limit(1);
    if (!existing?.length) {
      await db.from("cat_team").insert({ ...t, tenant_id: tenantId, active: true });
    }
  }
  const { data: team } = await db
    .from("cat_team")
    .select("id, name, role")
    .eq("tenant_id", tenantId)
    .eq("active", true);
  const getTeam = (partial: string) =>
    team?.find((t) => t.name.toLowerCase().includes(partial.toLowerCase()))?.id ?? null;
  console.log(`  Team: ${team?.length}`);

  const dave = getTeam("daveiva");
  const mile = getTeam("milena");

  // ==================== CLIENTS ==============================
  console.log("\n👥 Seeding clients...");

  const clientsData = [
    {
      client_number: "CLI-001",
      name: "Grupo Empresarial del Pacífico, S.A.",
      ruc: "155608-1-830421",
      type: "Corporativo",
      contact: "Roberto Méndez (Gerente General)",
      phone: "+507 6645-1234",
      email: "rmendez@gepsa.com.pa",
      observations: "Cliente desde 2024. Grupo diversificado: construcción, importación, retail. Facturación anual >$5M.",
    },
    {
      client_number: "CLI-002",
      name: "María Fernanda Castro Herrera",
      ruc: "8-842-1567",
      type: "Persona Natural",
      contact: "María Fernanda Castro",
      phone: "+507 6789-4321",
      email: "mfcastro@gmail.com",
      observations: "Abogada independiente que requiere apoyo en temas migratorios. Referida por Daveiva.",
    },
    {
      client_number: "CLI-003",
      name: "Constructora Istmeña, S.A.",
      ruc: "10230-12-567890",
      type: "Corporativo",
      contact: "Ing. Tomás Ríos",
      phone: "+507 6234-5678",
      email: "trios@constristmena.com",
      observations: "Empresa constructora mediana. Proyectos residenciales en Panamá Oeste.",
    },
    {
      client_number: "CLI-004",
      name: "Importadora Chen & Asociados, S.A.",
      ruc: "50307-42-123456",
      type: "Corporativo",
      contact: "Wei Chen",
      phone: "+507 6345-8899",
      email: "wchen@chenimport.com",
      observations: "Importadora de electrónicos, Zona Libre de Colón. Temas migratorios y corporativos.",
    },
    {
      client_number: "CLI-005",
      name: "Luis Alberto Quintero Batista",
      ruc: "6-710-2234",
      type: "Persona Natural",
      contact: "Luis Quintero",
      phone: "+507 6901-2345",
      email: "lquintero@hotmail.com",
      observations: "Trabajador despedido injustificadamente. Tarifa reducida por recursos limitados.",
    },
    {
      client_number: "CLI-006",
      name: "Farmacia San Judas, S.A.",
      ruc: "25640-80-654321",
      type: "Corporativo",
      contact: "Dra. Carmen Delgado",
      phone: "+507 6456-7890",
      email: "cdelgado@farmaciasanjudas.com",
      observations: "Cadena de 3 farmacias en Ciudad de Panamá. Requiere permisos MINSA y temas regulatorios.",
    },
    {
      client_number: "CLI-007",
      name: "Restaurante El Trapiche Colonial, S.A.",
      ruc: "30550-15-987654",
      type: "Corporativo",
      contact: "José Manuel Barría",
      phone: "+507 6567-1122",
      email: "jbarria@eltrapiche.com.pa",
      observations: "Restaurante tradicional panameño, 2 sucursales. Temas laborales y permisos municipales.",
    },
    {
      client_number: "CLI-008",
      name: "Ana Lucía Espinoza de Gracia",
      ruc: "4-789-3456",
      type: "Persona Natural",
      contact: "Ana Lucía Espinoza",
      phone: "+507 6678-3344",
      email: "aespinoza@icloud.com",
      observations: "Víctima de estafa inmobiliaria. Caso penal y civil simultáneo. Trato cuidadoso.",
    },
    {
      client_number: "CLI-009",
      name: "Tech Solutions Panamá, S.A.",
      ruc: "48920-33-111222",
      type: "Corporativo",
      contact: "Ing. Sofía Araúz",
      phone: "+507 6789-5566",
      email: "sarauz@techsolpa.com",
      observations: "Startup tech. Constitución de sociedad, visas para empleados extranjeros, contratos laborales.",
    },
    {
      client_number: "CLI-010",
      name: "Fundación Esperanza Viva",
      ruc: "60123-99-555666",
      type: "ONG",
      contact: "Lic. Patricia Moreno",
      phone: "+507 6890-7788",
      email: "pmoreno@esperanzaviva.org",
      observations: "ONG de educación rural. Pro bono parcial. Registro MICI y temas regulatorios.",
    },
  ];

  const clientIds: string[] = [];

  for (const c of clientsData) {
    // Check if exists
    const { data: existing } = await db
      .from("clients")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("client_number", c.client_number)
      .limit(1);

    if (existing?.length) {
      // Update
      await db
        .from("clients")
        .update({ ...c, active: true })
        .eq("id", existing[0].id);
      clientIds.push(existing[0].id);
    } else {
      // Insert
      const { data: inserted } = await db
        .from("clients")
        .insert({ ...c, tenant_id: tenantId, active: true })
        .select("id")
        .single();
      clientIds.push(inserted!.id);
    }
  }
  console.log(`  ✅ ${clientIds.length} clients seeded`);

  // ==================== CASES ================================
  console.log("\n📁 Seeding cases...");

  const casesData = [
    {
      case_number: 1, case_code: "CORP-001", client_idx: 0,
      description: "Constitución de sociedad anónima y registro en el Registro Público",
      classification_id: getClass("CORP"), institution_id: getInst("registro"),
      responsible_id: dave, opened_at: "2025-11-15", status_id: statusActivo,
      physical_location: "Archivo A, Gaveta 1",
      observations: "Cliente solicita sociedad con capital social de $10,000. Agente residente ya designado.",
      has_digital_file: true, entity: "Registro Público de Panamá",
      procedure_type: "Inscripción de Sociedad Anónima",
      institution_procedure_number: "RP-2025-44521", institution_case_number: "FICHA-332145",
      case_start_date: "2025-11-15", procedure_start_date: "2025-12-01", deadline: "2026-06-30",
    },
    {
      case_number: 2, case_code: "MIG-001", client_idx: 3,
      description: "Visa de inversionista calificado para ciudadano chino — Wei Chen",
      classification_id: getClass("MIG"), institution_id: getInst("migración"),
      responsible_id: dave, opened_at: "2025-10-01", status_id: statusTramite,
      physical_location: "Archivo B, Gaveta 2",
      observations: "Aplicante principal + 2 dependientes. Traducción oficial de documentos del mandarín requerida.",
      has_digital_file: true, entity: "Servicio Nacional de Migración",
      procedure_type: "Permiso de Residencia — Inversionista Calificado",
      institution_procedure_number: "SNM-INV-2025-1089",
      case_start_date: "2025-10-01", procedure_start_date: "2025-11-15", deadline: "2026-04-30",
    },
    {
      case_number: 3, case_code: "LAB-001", client_idx: 4,
      description: "Demanda laboral por despido injustificado — Luis Quintero vs. Constructora XYZ",
      classification_id: getClass("LAB"), institution_id: getInst("municipio"),
      responsible_id: mile, opened_at: "2026-01-10", status_id: statusActivo,
      physical_location: "Archivo C, Gaveta 5",
      observations: "Despido sin preaviso ni indemnización. 5 años de servicio. Se reclama prestaciones completas + daños morales.",
      has_digital_file: false, entity: "Juzgado Segundo de Trabajo",
      procedure_type: "Demanda Laboral Ordinaria",
      case_start_date: "2026-01-10", deadline: "2026-08-15",
    },
    {
      case_number: 4, case_code: "REG-001", client_idx: 5,
      description: "Renovación de licencia sanitaria para 3 sucursales de Farmacia San Judas",
      classification_id: getClass("REG"), institution_id: getInst("minsa"),
      responsible_id: mile, opened_at: "2026-02-01", status_id: statusTramite,
      physical_location: "Archivo A, Gaveta 3",
      observations: "Renovación anual. Inspección MINSA programada para abril. Sucursal de Bella Vista tiene observaciones del año anterior.",
      has_digital_file: true, entity: "MINSA — Dirección de Farmacia y Drogas",
      procedure_type: "Renovación de Licencia Sanitaria",
      institution_procedure_number: "MINSA-LS-2026-0334",
      case_start_date: "2026-02-01", procedure_start_date: "2026-02-15",
    },
    {
      case_number: 5, case_code: "PEN-001", client_idx: 7,
      description: "Denuncia penal por estafa inmobiliaria — Ana Espinoza vs. Promotora Horizontes",
      classification_id: getClass("PEN"), institution_id: getInst("municipio"),
      responsible_id: dave, opened_at: "2026-01-20", status_id: statusActivo,
      physical_location: "Archivo D, Gaveta 1 (confidencial)",
      observations: "Estafa por $85,000 en compra de apartamento. Promotora no entregó inmueble y se declaró en quiebra.",
      has_digital_file: false, entity: "Ministerio Público — Fiscalía de Circuito de lo Penal",
      procedure_type: "Denuncia por Estafa Calificada",
      case_start_date: "2026-01-20",
    },
    {
      case_number: 6, case_code: "CIV-001", client_idx: 7,
      description: "Demanda civil por daños y perjuicios — recuperación de $85,000 de Promotora Horizontes",
      classification_id: getClass("CIV"), institution_id: getInst("municipio"),
      responsible_id: mile, opened_at: "2026-02-05", status_id: statusTramite,
      physical_location: "Archivo D, Gaveta 2",
      observations: "Proceso civil paralelo al penal. Objetivo: recuperar inversión + intereses + daños morales.",
      has_digital_file: true, entity: "Juzgado Decimotercero Civil del Primer Circuito",
      procedure_type: "Demanda Ordinaria de Mayor Cuantía",
      case_start_date: "2026-02-05", deadline: "2026-12-31",
    },
    {
      case_number: 7, case_code: "CORP-002", client_idx: 8,
      description: "Constitución de Tech Solutions Panamá, S.A. y registro de marca",
      classification_id: getClass("CORP"), institution_id: getInst("registro"),
      responsible_id: dave, opened_at: "2026-03-01", status_id: statusActivo,
      physical_location: "Archivo A, Gaveta 4",
      observations: "Startup tech. Constitución + aviso de operación + registro de marca 'TechSolPA' ante DIGERPI.",
      has_digital_file: true, entity: "Registro Público / DIGERPI",
      procedure_type: "Constitución + Registro de Marca",
      institution_procedure_number: "RP-2026-11234",
      case_start_date: "2026-03-01", procedure_start_date: "2026-03-15",
    },
    {
      case_number: 8, case_code: "MIG-002", client_idx: 8,
      description: "Visa de personal calificado para 3 ingenieros de software extranjeros",
      classification_id: getClass("MIG"), institution_id: getInst("migración"),
      responsible_id: mile, opened_at: "2026-03-10", status_id: statusTramite,
      observations: "Tres aplicantes: 2 colombianos, 1 argentino. Contrato laboral ya firmado.",
      has_digital_file: true, entity: "Servicio Nacional de Migración / MITRADEL",
      procedure_type: "Permiso de Trabajo + Residencia Temporal",
      case_start_date: "2026-03-10", deadline: "2026-07-15",
    },
    {
      case_number: 9, case_code: "ADM-001", client_idx: 9,
      description: "Registro de ONG en MICI y obtención de personería jurídica",
      classification_id: getClass("ADM"), institution_id: getInst("mici"),
      responsible_id: mile, opened_at: "2026-02-20", status_id: statusActivo,
      observations: "Fundación sin fines de lucro. Junta directiva de 5 miembros. Requiere publicación en Gaceta Oficial.",
      has_digital_file: false, entity: "MICI — Dirección de Personas Jurídicas",
      procedure_type: "Registro de Fundación de Interés Privado",
      case_start_date: "2026-02-20",
    },
    {
      case_number: 10, case_code: "CORP-003", client_idx: 2,
      description: "Renovación de aviso de operación y permiso de construcción — Constructora Istmeña",
      classification_id: getClass("CORP"), institution_id: getInst("municipio"),
      responsible_id: dave, opened_at: "2025-08-01", status_id: statusCerrado,
      observations: "Caso completado exitosamente. Permisos renovados hasta dic 2026.",
      has_digital_file: true, entity: "Municipio de Panamá / MIVIOT",
      procedure_type: "Renovación de Aviso de Operación",
      case_start_date: "2025-08-01",
    },
    {
      case_number: 11, case_code: "LAB-002", client_idx: 6,
      description: "Elaboración de reglamento interno de trabajo y contratos laborales — El Trapiche",
      classification_id: getClass("LAB"), institution_id: getInst("municipio"),
      responsible_id: mile, opened_at: "2026-03-15", status_id: statusActivo,
      observations: "Restaurante con 45 empleados en 2 sucursales. Actualización de reglamento según nueva ley.",
      has_digital_file: true, entity: "MITRADEL",
      procedure_type: "Aprobación de Reglamento Interno de Trabajo",
      case_start_date: "2026-03-15", deadline: "2026-05-30",
    },
    {
      case_number: 12, case_code: "MIG-003", client_idx: 1,
      description: "Residencia permanente por matrimonio con panameño — cliente de María Fernanda Castro",
      classification_id: getClass("MIG"), institution_id: getInst("migración"),
      responsible_id: dave, opened_at: "2026-03-20", status_id: statusTramite,
      observations: "Aplicante venezolana, casada con panameño desde 2024. Documentos apostillados.",
      has_digital_file: false, entity: "Servicio Nacional de Migración",
      procedure_type: "Residencia Permanente por Matrimonio",
      case_start_date: "2026-03-20",
    },
  ];

  const caseIds: string[] = [];

  for (const c of casesData) {
    const { client_idx, ...casePayload } = c;
    const payload = {
      ...casePayload,
      tenant_id: tenantId,
      client_id: clientIds[client_idx],
    };

    const { data: existing } = await db
      .from("cases")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("case_code", c.case_code)
      .limit(1);

    if (existing?.length) {
      await db.from("cases").update(payload).eq("id", existing[0].id);
      caseIds.push(existing[0].id);
    } else {
      const { data: inserted, error } = await db
        .from("cases")
        .insert(payload)
        .select("id")
        .single();
      if (error) {
        console.error(`  ❌ Error inserting ${c.case_code}:`, error.message);
        continue;
      }
      caseIds.push(inserted!.id);
    }
  }
  console.log(`  ✅ ${caseIds.length} cases seeded`);

  // ==================== EXPENSES & PAYMENTS ==================
  console.log("\n💰 Seeding expenses & payments...");

  const paymentsData = [
    // CORP-001: saldo positivo
    { case_idx: 0, amount: 2000, payment_date: "2025-11-20" },
    { case_idx: 0, amount: 1000, payment_date: "2026-01-15" },
    // MIG-001: saldo negativo
    { case_idx: 1, amount: 1500, payment_date: "2025-10-15" },
    { case_idx: 1, amount: 1000, payment_date: "2025-12-20" },
    // LAB-001: saldo cero
    { case_idx: 2, amount: 500, payment_date: "2026-01-15" },
    // REG-001
    { case_idx: 3, amount: 1800, payment_date: "2026-02-05" },
    // PEN-001
    { case_idx: 4, amount: 3000, payment_date: "2026-01-25" },
    { case_idx: 4, amount: 1500, payment_date: "2026-03-01" },
    // CORP-002
    { case_idx: 6, amount: 2500, payment_date: "2026-03-05" },
  ];

  for (const p of paymentsData) {
    if (!caseIds[p.case_idx]) continue;
    const { data: existing } = await db
      .from("client_payments")
      .select("id")
      .eq("case_id", caseIds[p.case_idx])
      .eq("amount", p.amount)
      .eq("payment_date", p.payment_date)
      .limit(1);
    if (!existing?.length) {
      await db.from("client_payments").insert({
        tenant_id: tenantId,
        case_id: caseIds[p.case_idx],
        amount: p.amount,
        payment_date: p.payment_date,
        registered_by: adminUser.id,
      });
    }
  }

  const expensesData = [
    // CORP-001
    { case_idx: 0, amount: 350, concept: "Honorarios notariales — escritura de constitución", date: "2025-12-01" },
    { case_idx: 0, amount: 250, concept: "Tasa de inscripción en Registro Público", date: "2025-12-05" },
    { case_idx: 0, amount: 150, concept: "Certificado de Registro Público (urgente)", date: "2026-01-10" },
    { case_idx: 0, amount: 500, concept: "Honorarios del agente residente (anual)", date: "2026-01-20" },
    { case_idx: 0, amount: 550, concept: "Publicación en Gaceta Oficial", date: "2026-02-01" },
    // MIG-001
    { case_idx: 1, amount: 800, concept: "Traducción oficial de documentos (mandarín → español)", date: "2025-10-20" },
    { case_idx: 1, amount: 600, concept: "Apostilla de documentos en China (courier DHL)", date: "2025-11-05" },
    { case_idx: 1, amount: 1200, concept: "Tasa migratoria — inversionista calificado (3 personas)", date: "2025-11-20" },
    { case_idx: 1, amount: 500, concept: "Exámenes médicos y certificados (3 personas)", date: "2025-12-01" },
    { case_idx: 1, amount: 350, concept: "Seguro médico requisito migratorio (3 meses)", date: "2025-12-15" },
    { case_idx: 1, amount: 750, concept: "Depósito bancario requerido — comprobante de fondos", date: "2026-01-10" },
    // LAB-001
    { case_idx: 2, amount: 200, concept: "Timbres fiscales y papel sellado", date: "2026-01-20" },
    { case_idx: 2, amount: 150, concept: "Copias certificadas del expediente laboral", date: "2026-02-01" },
    { case_idx: 2, amount: 150, concept: "Transporte a MITRADEL para audiencia de conciliación", date: "2026-02-15" },
    // REG-001
    { case_idx: 3, amount: 300, concept: "Tasa MINSA — renovación licencia sanitaria (x3 sucursales)", date: "2026-02-20" },
    { case_idx: 3, amount: 200, concept: "Análisis de laboratorio (control de calidad)", date: "2026-03-01" },
    { case_idx: 3, amount: 150, concept: "Fumigación certificada — sucursal Bella Vista", date: "2026-03-10" },
    // PEN-001
    { case_idx: 4, amount: 500, concept: "Investigación privada — rastreo de activos del imputado", date: "2026-02-01" },
    { case_idx: 4, amount: 800, concept: "Peritaje de documentos notariales fraudulentos", date: "2026-02-15" },
    { case_idx: 4, amount: 250, concept: "Certificaciones del Registro Público", date: "2026-03-01" },
    { case_idx: 4, amount: 1200, concept: "Honorarios de co-abogado penalista (consulta)", date: "2026-03-15" },
    // CORP-002
    { case_idx: 6, amount: 400, concept: "Notaría — escritura de constitución", date: "2026-03-10" },
    { case_idx: 6, amount: 250, concept: "Registro Público — inscripción", date: "2026-03-15" },
    { case_idx: 6, amount: 350, concept: "DIGERPI — solicitud registro de marca", date: "2026-03-20" },
    { case_idx: 6, amount: 100, concept: "Aviso de Operación — tasa municipal", date: "2026-03-25" },
  ];

  let expCount = 0;
  for (const e of expensesData) {
    if (!caseIds[e.case_idx]) continue;
    const { data: existing } = await db
      .from("expenses")
      .select("id")
      .eq("case_id", caseIds[e.case_idx])
      .eq("concept", e.concept)
      .limit(1);
    if (!existing?.length) {
      await db.from("expenses").insert({
        tenant_id: tenantId,
        case_id: caseIds[e.case_idx],
        amount: e.amount,
        concept: e.concept,
        date: e.date,
        registered_by: adminUser.id,
      });
      expCount++;
    }
  }
  console.log(`  ✅ ${paymentsData.length} payments, ${expCount} expenses seeded`);

  // ==================== TASKS ================================
  console.log("\n✅ Seeding tasks...");

  const tasksData = [
    { case_idx: 0, description: "Recoger escritura protocolizada en notaría", deadline: "2026-04-10", status: "pendiente" },
    { case_idx: 0, description: "Entregar documentos al Registro Público", deadline: "2026-04-15", status: "pendiente" },
    { case_idx: 0, description: "Verificar publicación en Gaceta Oficial", deadline: "2026-03-01", status: "cumplida", completed_at: "2026-03-02" },
    { case_idx: 1, description: "Llamar al SNM para confirmar fecha de entrevista", deadline: "2026-04-05", status: "pendiente" },
    { case_idx: 1, description: "Recoger carnés de migración temporales", deadline: "2026-04-20", status: "pendiente" },
    { case_idx: 1, description: "Entregar traducción oficial de pasaportes", deadline: "2026-01-15", status: "cumplida", completed_at: "2026-01-14" },
    { case_idx: 1, description: "Coordinar exámenes médicos para los 3 aplicantes", deadline: "2026-02-01", status: "cumplida", completed_at: "2026-01-30" },
    { case_idx: 2, description: "Preparar memorial de demanda", deadline: "2026-02-01", status: "cumplida", completed_at: "2026-01-28" },
    { case_idx: 2, description: "Asistir a audiencia de conciliación en MITRADEL", deadline: "2026-04-08", status: "pendiente" },
    { case_idx: 2, description: "Recopilar estados de cuenta del cliente como prueba", deadline: "2026-03-15", status: "cumplida", completed_at: "2026-03-12" },
    { case_idx: 4, description: "Presentar querella ante fiscalía", deadline: "2026-02-10", status: "cumplida", completed_at: "2026-02-08" },
    { case_idx: 4, description: "Solicitar medida cautelar de embargo", deadline: "2026-04-15", status: "pendiente" },
    { case_idx: 4, description: "Obtener certificación de propiedad del inmueble prometido", deadline: "2026-03-20", status: "cumplida", completed_at: "2026-03-18" },
    { case_idx: 6, description: "Completar formularios de DIGERPI para registro de marca", deadline: "2026-04-10", status: "pendiente" },
    { case_idx: 6, description: "Redactar pacto social y estatutos", deadline: "2026-03-08", status: "cumplida", completed_at: "2026-03-07" },
    { case_idx: 6, description: "Obtener aviso de operación municipal", deadline: "2026-04-20", status: "pendiente" },
    { case_idx: 7, description: "Recopilar contratos laborales de los 3 ingenieros", deadline: "2026-03-25", status: "cumplida", completed_at: "2026-03-24" },
    { case_idx: 7, description: "Presentar solicitudes ante MITRADEL", deadline: "2026-04-05", status: "pendiente" },
    { case_idx: 7, description: "Agendar citas en SNM para cada aplicante", deadline: "2026-04-15", status: "pendiente" },
  ];

  let taskCount = 0;
  for (const t of tasksData) {
    if (!caseIds[t.case_idx]) continue;
    const { data: existing } = await db
      .from("tasks")
      .select("id")
      .eq("case_id", caseIds[t.case_idx])
      .eq("description", t.description)
      .limit(1);
    if (!existing?.length) {
      await db.from("tasks").insert({
        tenant_id: tenantId,
        case_id: caseIds[t.case_idx],
        description: t.description,
        deadline: t.deadline,
        assigned_to: adminUser.id,
        status: t.status,
        created_by: adminUser.id,
        completed_at: (t as Record<string, unknown>).completed_at ?? null,
      });
      taskCount++;
    }
  }
  console.log(`  ✅ ${taskCount} tasks seeded`);

  // ==================== COMMENTS ============================
  console.log("\n💬 Seeding comments...");

  const commentsData = [
    { case_idx: 0, text: "Se recibió poder notarial del cliente. Documentos en orden para proceder con la inscripción.", follow_up_date: "2025-12-15", created_at: "2025-11-20T09:30:00Z" },
    { case_idx: 0, text: "Escritura de constitución protocolizada. Se envía al Registro Público para inscripción.", follow_up_date: "2026-01-10", created_at: "2025-12-05T14:15:00Z" },
    { case_idx: 0, text: "Registro Público confirmó recepción. Número de entrada: RP-2025-44521. Tiempo estimado: 15 días hábiles.", follow_up_date: "2026-02-01", created_at: "2026-01-12T10:00:00Z" },
    { case_idx: 0, text: "Publicación en Gaceta Oficial completada. Esperando resolución final del RP.", follow_up_date: null, created_at: "2026-02-03T16:45:00Z" },
    { case_idx: 1, text: "Primera reunión con el Sr. Chen. Se explicaron requisitos de inversión mínima ($160,000). Cliente confirma fondos.", follow_up_date: "2025-11-01", created_at: "2025-10-05T11:00:00Z" },
    { case_idx: 1, text: "Documentos enviados a traducción oficial. Plazo estimado: 3 semanas.", follow_up_date: "2025-11-30", created_at: "2025-10-25T09:00:00Z" },
    { case_idx: 1, text: "Traducciones recibidas. Calidad verificada. Se procede a apostillar y preparar expediente para SNM.", follow_up_date: "2026-01-15", created_at: "2025-12-10T15:30:00Z" },
    { case_idx: 1, text: "ALERTA: Los gastos superan los pagos recibidos. Se debe cobrar saldo pendiente antes de continuar.", follow_up_date: "2026-02-01", created_at: "2026-01-20T10:30:00Z" },
    { case_idx: 1, text: "Solicitud presentada ante el SNM. Se programó entrevista para mayo 2026.", follow_up_date: null, created_at: "2026-03-15T14:00:00Z" },
    { case_idx: 2, text: "Cliente relata los hechos del despido. Fue notificado verbalmente sin carta formal. Tiene 2 testigos.", follow_up_date: "2026-02-01", created_at: "2026-01-12T10:00:00Z" },
    { case_idx: 2, text: "Memorial de demanda preparado. Reclamo: preaviso, indemnización, vacaciones y XIII mes proporcional.", follow_up_date: "2026-02-20", created_at: "2026-02-01T16:00:00Z" },
    { case_idx: 2, text: "Audiencia de conciliación programada para el 8 de abril. Preparar al cliente para posible oferta.", follow_up_date: null, created_at: "2026-03-25T11:00:00Z" },
    { case_idx: 4, text: "Cliente presenta contrato de compraventa, recibos de pago ($85,000), y evidencia de que el inmueble nunca fue construido.", follow_up_date: "2026-02-15", created_at: "2026-01-22T09:30:00Z" },
    { case_idx: 4, text: "Querella presentada ante la Fiscalía. Caso asignado al Fiscal Segundo de lo Penal.", follow_up_date: "2026-03-05", created_at: "2026-02-10T14:00:00Z" },
    { case_idx: 4, text: "Fiscalía ordenó investigación. La promotora vendió el mismo lote a 3 compradores. Estafa agravada.", follow_up_date: "2026-04-01", created_at: "2026-03-08T16:30:00Z" },
    { case_idx: 4, text: "Se solicitó embargo preventivo sobre bienes del representante legal. Esperando resolución judicial.", follow_up_date: null, created_at: "2026-03-28T10:00:00Z" },
    { case_idx: 6, text: "Reunión inicial con Ing. Araúz. SA con capital $10,000, 3 directores, nombre comercial 'TechSolPA'.", follow_up_date: "2026-03-10", created_at: "2026-03-02T10:00:00Z" },
    { case_idx: 6, text: "Pacto social redactado y aprobado por la cliente. Se envía a notaría para protocolizar.", follow_up_date: "2026-03-20", created_at: "2026-03-08T15:00:00Z" },
    { case_idx: 6, text: "Escritura protocolizada. Solicitud de marca 'TechSolPA' presentada ante DIGERPI. Sin conflictos.", follow_up_date: null, created_at: "2026-03-22T11:30:00Z" },
    { case_idx: 8, text: "Reunión con directiva de Fundación Esperanza Viva. Estructura organizativa definida.", follow_up_date: "2026-03-15", created_at: "2026-02-22T09:00:00Z" },
    { case_idx: 8, text: "Documentos de constitución preparados. Se requiere publicación en Gaceta antes de MICI.", follow_up_date: null, created_at: "2026-03-18T14:00:00Z" },
  ];

  let commentCount = 0;
  for (const c of commentsData) {
    if (!caseIds[c.case_idx]) continue;
    const { data: existing } = await db
      .from("comments")
      .select("id")
      .eq("case_id", caseIds[c.case_idx])
      .eq("text", c.text)
      .limit(1);
    if (!existing?.length) {
      await db.from("comments").insert({
        tenant_id: tenantId,
        case_id: caseIds[c.case_idx],
        user_id: adminUser.id,
        text: c.text,
        follow_up_date: c.follow_up_date,
        created_at: c.created_at,
      });
      commentCount++;
    }
  }
  console.log(`  ✅ ${commentCount} comments seeded`);

  // ==================== DOCUMENTS ============================
  console.log("\n📎 Seeding documents...");

  const docsData = [
    { entity_type: "case", entity_idx: 0, file_name: "Pacto_Social_GEPSA.pdf", storage_key: "corp-001/pacto-social.pdf" },
    { entity_type: "case", entity_idx: 0, file_name: "Poder_Notarial_Roberto_Mendez.pdf", storage_key: "corp-001/poder-notarial.pdf" },
    { entity_type: "case", entity_idx: 0, file_name: "Recibo_Registro_Publico.jpg", storage_key: "corp-001/recibo-rp.jpg" },
    { entity_type: "case", entity_idx: 1, file_name: "Pasaporte_Wei_Chen.pdf", storage_key: "mig-001/pasaporte-chen.pdf" },
    { entity_type: "case", entity_idx: 1, file_name: "Traduccion_Oficial_Pasaportes.pdf", storage_key: "mig-001/traducciones.pdf" },
    { entity_type: "case", entity_idx: 1, file_name: "Comprobante_Deposito_Bancario.pdf", storage_key: "mig-001/deposito-bancario.pdf" },
    { entity_type: "case", entity_idx: 1, file_name: "Certificados_Medicos_3_Aplicantes.pdf", storage_key: "mig-001/certificados-medicos.pdf" },
    { entity_type: "case", entity_idx: 2, file_name: "Carta_Despido_Verbal_Testimonio.pdf", storage_key: "lab-001/testimonio-despido.pdf" },
    { entity_type: "case", entity_idx: 2, file_name: "Comprobantes_Pago_5_Anios.pdf", storage_key: "lab-001/comprobantes-pago.pdf" },
    { entity_type: "case", entity_idx: 4, file_name: "Contrato_Compraventa_Apartamento.pdf", storage_key: "pen-001/contrato-cv.pdf" },
    { entity_type: "case", entity_idx: 4, file_name: "Recibos_Pago_85000.pdf", storage_key: "pen-001/recibos-pago.pdf" },
    { entity_type: "case", entity_idx: 4, file_name: "Peritaje_Documentos_Fraudulentos.pdf", storage_key: "pen-001/peritaje.pdf" },
    { entity_type: "case", entity_idx: 6, file_name: "Estatutos_TechSolPA.pdf", storage_key: "corp-002/estatutos.pdf" },
    { entity_type: "case", entity_idx: 6, file_name: "Busqueda_Marca_DIGERPI.pdf", storage_key: "corp-002/busqueda-marca.pdf" },
  ];

  let docCount = 0;
  for (const d of docsData) {
    const entityId = caseIds[d.entity_idx];
    if (!entityId) continue;
    const { data: existing } = await db
      .from("documents")
      .select("id")
      .eq("entity_id", entityId)
      .eq("file_name", d.file_name)
      .limit(1);
    if (!existing?.length) {
      await db.from("documents").insert({
        tenant_id: tenantId,
        entity_type: d.entity_type,
        entity_id: entityId,
        file_name: d.file_name,
        file_path: `/docs/${d.storage_key.split("/")[0]}/`,
        storage_key: d.storage_key,
        uploaded_by: adminUser.id,
      });
      docCount++;
    }
  }
  console.log(`  ✅ ${docCount} documents seeded`);

  // ==================== UPDATE LAST FOLLOWUP =================
  console.log("\n🔄 Updating last_followup_at...");
  const followupUpdates: Record<number, string> = {
    0: "2026-02-03", 1: "2026-03-15", 2: "2026-03-25",
    4: "2026-03-28", 6: "2026-03-22", 8: "2026-03-18",
  };
  for (const [idx, date] of Object.entries(followupUpdates)) {
    if (caseIds[Number(idx)]) {
      await db.from("cases").update({ last_followup_at: date }).eq("id", caseIds[Number(idx)]);
    }
  }

  console.log("\n🎉 Demo data seeded successfully!");
  console.log(`   Clients: ${clientIds.length}`);
  console.log(`   Cases: ${caseIds.length}`);
  console.log(`   Payments: ${paymentsData.length}`);
  console.log(`   Expenses: ${expensesData.length}`);
  console.log(`   Tasks: ${tasksData.length}`);
  console.log(`   Comments: ${commentsData.length}`);
  console.log(`   Documents: ${docsData.length}`);
}

seed().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
