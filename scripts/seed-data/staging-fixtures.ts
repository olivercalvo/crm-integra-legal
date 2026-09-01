/**
 * FIXTURES DEL AMBIENTE DE STAGING — datos 100% ficticios.
 *
 * REGLA DURA: acá NO entra ni un dato de producción. Ni cédulas, ni RUC
 * reales, ni nombres de clientes del bufete, ni descripciones de expedientes.
 * Los datos personales de los clientes de Integra Legal están protegidos por
 * la Ley 81 de 2019 (Panamá) y no se copian a un ambiente de pruebas.
 *
 * La ÚNICA excepción deliberada es el PLAN DE CUENTAS (las 62 cuentas de
 * Josuar): no es dato personal, es la estructura contable del bufete, y se
 * necesita idéntica para que los reportes se comporten igual que en prod.
 * Se importa del fixture que ya vive en el repo — no se transcribe a mano.
 *
 * Criterio de diseño de los montos: TODO redondo (500 / 1.000 / 1.500 /
 * 2.500). Con ITBMS 7% eso da impuestos exactos (35 / 70 / 105 / 175) y
 * permite validar un Estado de Resultado o un VAT Summary a mano.
 */

// ---------------------------------------------------------------------------
// TENANT
// ---------------------------------------------------------------------------
// Mismo UUID que en producción A PROPÓSITO: las migraciones base siembran
// tax_codes, services_catalog y numbering_sequences con este tenant_id
// hardcodeado. Cambiarlo en staging dejaría esos catálogos huérfanos.
export const TENANT_ID = "a0000000-0000-0000-0000-000000000001";
export const TENANT_NAME = "Integra Legal (STAGING)";
export const TENANT_SLUG = "integra-legal";

// ---------------------------------------------------------------------------
// USUARIOS DE PRUEBA — nombres inventados, NO los de las licenciadas
// ---------------------------------------------------------------------------
// Dominio `.test`: reservado por RFC 2606, no resuelve y no existe en ningún
// proveedor. Si algún flujo manda un email por error, no llega a nadie.
export interface SeedUser {
  key: string;
  email: string;
  password: string;
  full_name: string;
  role: "admin" | "abogada" | "asistente" | "contador";
}

export const SEED_USERS: SeedUser[] = [
  {
    key: "admin",
    email: "admin@staging.test",
    password: "Staging2026$Admin",
    full_name: "Rodrigo Sanjur (STAGING)",
    role: "admin",
  },
  {
    key: "abogada",
    email: "abogada@staging.test",
    password: "Staging2026$Abogada",
    full_name: "Ileana Barrios (STAGING)",
    role: "abogada",
  },
  {
    key: "abogada2",
    email: "abogada2@staging.test",
    password: "Staging2026$Abogada2",
    full_name: "Xiomara Delgado (STAGING)",
    role: "abogada",
  },
  {
    key: "asistente",
    email: "asistente@staging.test",
    password: "Staging2026$Asistente",
    full_name: "Kevin Atencio (STAGING)",
    role: "asistente",
  },
  {
    key: "contador",
    email: "contador@staging.test",
    password: "Staging2026$Contador",
    full_name: "Elías Pimentel (STAGING)",
    role: "contador",
  },
];

// ---------------------------------------------------------------------------
// CATÁLOGOS
// ---------------------------------------------------------------------------
// Estados: exactamente DOS. Es el estado al que quedó producción después de
// `sql/pending/fix-duplicate-statuses-2026-08-23.sql`, que limpió 7 filas
// duplicadas creadas por correr un script de carga tres veces. El seed usa
// UUID determinístico por nombre justamente para que ese bug no pueda volver.
export const SEED_STATUSES = ["En trámite", "Cerrado"] as const;

export const SEED_CLASSIFICATIONS = [
  { name: "CORPORATIVO", prefix: "CORP", color: "#1F4E79" },
  { name: "MIGRACIÓN", prefix: "MIG", color: "#2E7D32" },
  { name: "LABORAL", prefix: "LAB", color: "#E65100" },
  { name: "PENAL", prefix: "PEN", color: "#B71C1C" },
  { name: "CIVIL", prefix: "CIV", color: "#6A1B9A" },
  { name: "ADMINISTRATIVO", prefix: "ADM", color: "#455A64" },
  { name: "REGULATORIO", prefix: "REG", color: "#F57F17" },
  { name: "EXTRAJUDICIAL", prefix: "EXT", color: "#00695C" },
  { name: "FAMILIA", prefix: "FAM", color: "#00838F" },
] as const;

export const SEED_INSTITUTIONS = [
  "Registro Público",
  "MICI",
  "MINSA",
  "Migración",
  "Municipio",
] as const;

export type InstitutionName = (typeof SEED_INSTITUTIONS)[number];

// ---------------------------------------------------------------------------
// CLIENTES — 15 ficticios (7 persona natural, 8 persona jurídica)
// ---------------------------------------------------------------------------
export interface SeedClient {
  n: number; // → CLI-0NN
  name: string;
  client_type: "persona_natural" | "persona_juridica";
  client_status: "active" | "prospect" | "inactive";
  /** Base del RUC SIN dígito verificador. El DV se calcula en el seed. */
  ruc_base: string;
  tipo_receptor_fe: "01" | "02" | "03" | "04";
  contact: string;
  phone: string;
  email: string;
  address: string;
  client_since: string;
  /** key del SeedUser abogada responsable */
  lawyer: "abogada" | "abogada2";
}

export const SEED_CLIENTS: SeedClient[] = [
  { n: 1, name: "FERRETERÍA VALLARINO, S.A.", client_type: "persona_juridica", client_status: "active", ruc_base: "1554821-1-741203", tipo_receptor_fe: "01", contact: "Aurelio Vallarino", phone: "+507 6412-0011", email: "compras@ferreteria-vallarino.test", address: "Vía España, Edif. Los Robles, Piso 4, Panamá", client_since: "2024-02-12", lawyer: "abogada" },
  { n: 2, name: "PANAMÁ COSTA VERDE, S.A.", client_type: "persona_juridica", client_status: "active", ruc_base: "1602933-1-802514", tipo_receptor_fe: "01", contact: "Marisol Achurra", phone: "+507 6301-7788", email: "admin@costaverde.test", address: "Costa del Este, Torre Financial, Of. 1201, Panamá", client_since: "2024-04-03", lawyer: "abogada" },
  { n: 3, name: "GRUPO BOCAS MARINE SERVICES, S.A.", client_type: "persona_juridica", client_status: "active", ruc_base: "1711044-1-655190", tipo_receptor_fe: "01", contact: "Ricaurte Him", phone: "+507 6720-4432", email: "operaciones@bocasmarine.test", address: "Isla Colón, Calle 3ra, Bocas del Toro", client_since: "2024-06-18", lawyer: "abogada2" },
  { n: 4, name: "INVERSIONES TOCUMEN REAL, S.A.", client_type: "persona_juridica", client_status: "active", ruc_base: "1588210-1-713366", tipo_receptor_fe: "01", contact: "Nidia Espinosa", phone: "+507 6155-9021", email: "gerencia@tocumenreal.test", address: "Corredor Sur, Parque Industrial Tocumen, Panamá", client_since: "2023-11-27", lawyer: "abogada" },
  { n: 5, name: "CONSTRUCTORA CHIRIQUÍ ANTIGUO, S.A.", client_type: "persona_juridica", client_status: "active", ruc_base: "1499876-1-690042", tipo_receptor_fe: "01", contact: "Eliécer Tuñón", phone: "+507 6844-3310", email: "proyectos@chiriquiantiguo.test", address: "David, Barrio Bolívar, Chiriquí", client_since: "2025-01-15", lawyer: "abogada2" },
  { n: 6, name: "TRANSPORTES COCOLÍ, S.A.", client_type: "persona_juridica", client_status: "active", ruc_base: "1633502-1-778821", tipo_receptor_fe: "01", contact: "Aníbal Serracín", phone: "+507 6299-1145", email: "logistica@transcocoli.test", address: "Arraiján, Vía Interamericana Km 12, Panamá Oeste", client_since: "2025-03-02", lawyer: "abogada" },
  { n: 7, name: "DISTRIBUIDORA PORTOBELO, S.A.", client_type: "persona_juridica", client_status: "active", ruc_base: "1570119-1-733408", tipo_receptor_fe: "01", contact: "Yaritza Moreno", phone: "+507 6533-8890", email: "ventas@distportobelo.test", address: "Colón, Zona Libre, Calle 14, Colón", client_since: "2024-08-09", lawyer: "abogada2" },
  { n: 8, name: "CONSORCIO RÍO CHAGRES, S.A.", client_type: "persona_juridica", client_status: "prospect", ruc_base: "1690455-1-810277", tipo_receptor_fe: "01", contact: "Bolívar Quintero", phone: "+507 6077-2200", email: "contacto@riochagres.test", address: "Clayton, Ciudad del Saber, Edif. 219, Panamá", client_since: "2026-05-20", lawyer: "abogada" },

  { n: 9, name: "Aurelio Barría Quintero", client_type: "persona_natural", client_status: "active", ruc_base: "8-742-1183", tipo_receptor_fe: "01", contact: "Aurelio Barría", phone: "+507 6001-2233", email: "abarria@correo.test", address: "Betania, Calle 66 Oeste, Casa 12, Panamá", client_since: "2024-03-11", lawyer: "abogada" },
  { n: 10, name: "Marisol Achurra Pinilla", client_type: "persona_natural", client_status: "active", ruc_base: "9-311-4407", tipo_receptor_fe: "02", contact: "Marisol Achurra", phone: "+507 6210-4590", email: "machurra@correo.test", address: "Chitré, Barrio San Juan Bautista, Herrera", client_since: "2024-09-30", lawyer: "abogada2" },
  { n: 11, name: "Ricaurte Him Villalaz", client_type: "persona_natural", client_status: "active", ruc_base: "3-118-9925", tipo_receptor_fe: "01", contact: "Ricaurte Him", phone: "+507 6455-1207", email: "rhim@correo.test", address: "La Chorrera, Barrio Balboa, Panamá Oeste", client_since: "2025-02-04", lawyer: "abogada" },
  { n: 12, name: "Nidia Espinosa Caballero", client_type: "persona_natural", client_status: "active", ruc_base: "4-209-6631", tipo_receptor_fe: "02", contact: "Nidia Espinosa", phone: "+507 6688-3341", email: "nespinosa@correo.test", address: "Boquete, Alto Boquete, Chiriquí", client_since: "2025-05-19", lawyer: "abogada2" },
  { n: 13, name: "Eliécer Tuñón Grajales", client_type: "persona_natural", client_status: "active", ruc_base: "2-706-2214", tipo_receptor_fe: "01", contact: "Eliécer Tuñón", phone: "+507 6912-7754", email: "etunon@correo.test", address: "Penonomé, Calle Damián Carles, Coclé", client_since: "2025-07-22", lawyer: "abogada" },
  { n: 14, name: "Yaritza Moreno Sáenz", client_type: "persona_natural", client_status: "inactive", ruc_base: "8-903-5518", tipo_receptor_fe: "02", contact: "Yaritza Moreno", phone: "+507 6340-0092", email: "ymoreno@correo.test", address: "San Miguelito, Villa Lucre, Panamá", client_since: "2023-08-14", lawyer: "abogada2" },
  { n: 15, name: "Aníbal Serracín Concepción", client_type: "persona_natural", client_status: "prospect", ruc_base: "6-427-7803", tipo_receptor_fe: "02", contact: "Aníbal Serracín", phone: "+507 6788-6612", email: "aserracin@correo.test", address: "Santiago, Barrio San Martín, Veraguas", client_since: "2026-06-08", lawyer: "abogada" },
];

// ---------------------------------------------------------------------------
// CASOS — 30, repartidos entre las 9 clasificaciones
// ---------------------------------------------------------------------------
export interface SeedCase {
  prefix: string; // clasificación
  seq: number; // correlativo dentro del prefijo → CORP-001
  client: number; // n del SeedClient
  description: string;
  status: "En trámite" | "Cerrado";
  institution: InstitutionName | null;
  lawyer: "abogada" | "abogada2";
  /** true → el asistente de prueba queda asignado */
  withAssistant?: boolean;
}

export const SEED_CASES: SeedCase[] = [
  // CORPORATIVO (6)
  { prefix: "CORP", seq: 1, client: 1, description: "Constitución de sociedad anónima y apertura de cuenta bancaria", status: "Cerrado", institution: "Registro Público", lawyer: "abogada", withAssistant: true },
  { prefix: "CORP", seq: 2, client: 2, description: "Cambio de junta directiva y protocolización de acta", status: "En trámite", institution: "Registro Público", lawyer: "abogada", withAssistant: true },
  { prefix: "CORP", seq: 3, client: 4, description: "Aumento de capital autorizado", status: "En trámite", institution: "Registro Público", lawyer: "abogada2" },
  { prefix: "CORP", seq: 4, client: 6, description: "Disolución voluntaria de sociedad", status: "En trámite", institution: "Registro Público", lawyer: "abogada" },
  { prefix: "CORP", seq: 5, client: 7, description: "Registro de marca comercial y renovación", status: "Cerrado", institution: "MICI", lawyer: "abogada2" },
  { prefix: "CORP", seq: 6, client: 3, description: "Contrato de compraventa de acciones entre socios", status: "En trámite", institution: null, lawyer: "abogada", withAssistant: true },

  // MIGRACIÓN (5)
  { prefix: "MIG", seq: 1, client: 9, description: "Permiso de residencia permanente por país amigo", status: "En trámite", institution: "Migración", lawyer: "abogada", withAssistant: true },
  { prefix: "MIG", seq: 2, client: 11, description: "Renovación de carné de residente permanente", status: "Cerrado", institution: "Migración", lawyer: "abogada" },
  { prefix: "MIG", seq: 3, client: 13, description: "Visa de trabajador dentro del 10% del personal ordinario", status: "En trámite", institution: "Migración", lawyer: "abogada2", withAssistant: true },
  { prefix: "MIG", seq: 4, client: 5, description: "Permisos migratorios para personal extranjero de obra", status: "En trámite", institution: "Migración", lawyer: "abogada2" },
  { prefix: "MIG", seq: 5, client: 12, description: "Naturalización por matrimonio con nacional panameño", status: "En trámite", institution: "Migración", lawyer: "abogada" },

  // LABORAL (4)
  { prefix: "LAB", seq: 1, client: 1, description: "Terminación de relación laboral por mutuo acuerdo", status: "Cerrado", institution: null, lawyer: "abogada" },
  { prefix: "LAB", seq: 2, client: 6, description: "Demanda por despido injustificado ante junta de conciliación", status: "En trámite", institution: null, lawyer: "abogada2", withAssistant: true },
  { prefix: "LAB", seq: 3, client: 4, description: "Elaboración de reglamento interno de trabajo", status: "En trámite", institution: null, lawyer: "abogada" },
  { prefix: "LAB", seq: 4, client: 7, description: "Cálculo y pago de prestaciones de personal de bodega", status: "Cerrado", institution: null, lawyer: "abogada2" },

  // CIVIL (4)
  { prefix: "CIV", seq: 1, client: 10, description: "Proceso sumario de cobro de suma líquida y exigible", status: "En trámite", institution: null, lawyer: "abogada2" },
  { prefix: "CIV", seq: 2, client: 2, description: "Contrato de arrendamiento comercial y garantía", status: "Cerrado", institution: null, lawyer: "abogada" },
  { prefix: "CIV", seq: 3, client: 13, description: "Prescripción adquisitiva de dominio sobre finca", status: "En trámite", institution: "Registro Público", lawyer: "abogada", withAssistant: true },
  { prefix: "CIV", seq: 4, client: 3, description: "Reclamo por incumplimiento de contrato de servicios", status: "En trámite", institution: null, lawyer: "abogada2" },

  // ADMINISTRATIVO (3)
  { prefix: "ADM", seq: 1, client: 5, description: "Solicitud de permiso de construcción municipal", status: "En trámite", institution: "Municipio", lawyer: "abogada2", withAssistant: true },
  { prefix: "ADM", seq: 2, client: 2, description: "Recurso de reconsideración contra resolución municipal", status: "En trámite", institution: "Municipio", lawyer: "abogada" },
  { prefix: "ADM", seq: 3, client: 6, description: "Renovación de aviso de operación comercial", status: "Cerrado", institution: "MICI", lawyer: "abogada" },

  // PENAL (2)
  { prefix: "PEN", seq: 1, client: 11, description: "Querella por delito contra el patrimonio económico", status: "En trámite", institution: null, lawyer: "abogada" },
  { prefix: "PEN", seq: 2, client: 14, description: "Defensa técnica en investigación por estafa", status: "En trámite", institution: null, lawyer: "abogada2" },

  // REGULATORIO (2)
  { prefix: "REG", seq: 1, client: 3, description: "Registro sanitario de producto importado", status: "En trámite", institution: "MINSA", lawyer: "abogada2", withAssistant: true },
  { prefix: "REG", seq: 2, client: 7, description: "Licencia de operación en Zona Libre de Colón", status: "Cerrado", institution: "MICI", lawyer: "abogada" },

  // EXTRAJUDICIAL (2)
  { prefix: "EXT", seq: 1, client: 4, description: "Recuperación de cartera morosa — gestión extrajudicial", status: "En trámite", institution: null, lawyer: "abogada" },
  { prefix: "EXT", seq: 2, client: 1, description: "Negociación de acuerdo de pago con proveedor", status: "Cerrado", institution: null, lawyer: "abogada2" },

  // FAMILIA (2)
  { prefix: "FAM", seq: 1, client: 12, description: "Divorcio por mutuo consentimiento", status: "En trámite", institution: null, lawyer: "abogada2", withAssistant: true },
  { prefix: "FAM", seq: 2, client: 9, description: "Fijación de pensión alimenticia y régimen de visitas", status: "En trámite", institution: null, lawyer: "abogada" },
];

// ---------------------------------------------------------------------------
// GASTOS DE TRÁMITE — montos redondos, reembolsables vía factura REI
// ---------------------------------------------------------------------------
export interface SeedExpense {
  case: string; // case_code
  concept: string;
  amount: number;
  date: string;
  expense_type: "tramite" | "administrativo";
}

export const SEED_EXPENSES: SeedExpense[] = [
  { case: "CORP-001", concept: "Tasa de Registro Público — inscripción de pacto social", amount: 300, date: "2026-03-04", expense_type: "tramite" },
  { case: "CORP-001", concept: "Honorarios de notaría — protocolización", amount: 200, date: "2026-03-05", expense_type: "tramite" },
  { case: "CORP-002", concept: "Tasa de Registro Público — cambio de directiva", amount: 150, date: "2026-04-10", expense_type: "tramite" },
  { case: "CORP-003", concept: "Tasa de Registro Público — aumento de capital", amount: 500, date: "2026-05-08", expense_type: "tramite" },
  { case: "CORP-005", concept: "Tasa MICI — registro de marca", amount: 250, date: "2026-02-19", expense_type: "tramite" },
  { case: "MIG-001", concept: "Tasa de Migración — solicitud de residencia", amount: 800, date: "2026-04-22", expense_type: "tramite" },
  { case: "MIG-001", concept: "Repuesto de carné y certificación", amount: 100, date: "2026-05-06", expense_type: "tramite" },
  { case: "MIG-002", concept: "Tasa de Migración — renovación de carné", amount: 200, date: "2026-01-30", expense_type: "tramite" },
  { case: "MIG-003", concept: "Tasa de Migración — visa de trabajador", amount: 700, date: "2026-06-11", expense_type: "tramite" },
  { case: "MIG-004", concept: "Tasas migratorias de personal de obra (4 permisos)", amount: 1200, date: "2026-06-25", expense_type: "tramite" },
  { case: "CIV-001", concept: "Tasa judicial y timbres", amount: 150, date: "2026-05-14", expense_type: "tramite" },
  { case: "CIV-003", concept: "Certificación de finca en Registro Público", amount: 50, date: "2026-07-02", expense_type: "tramite" },
  { case: "ADM-001", concept: "Tasa municipal — permiso de construcción", amount: 400, date: "2026-06-03", expense_type: "tramite" },
  { case: "ADM-003", concept: "Tasa MICI — renovación de aviso de operación", amount: 100, date: "2026-02-27", expense_type: "tramite" },
  { case: "REG-001", concept: "Tasa MINSA — registro sanitario", amount: 600, date: "2026-07-15", expense_type: "tramite" },
  { case: "REG-002", concept: "Tasa de licencia Zona Libre", amount: 500, date: "2026-03-18", expense_type: "tramite" },
  { case: "LAB-002", concept: "Copias autenticadas y notificaciones", amount: 50, date: "2026-07-08", expense_type: "tramite" },
  { case: "PEN-001", concept: "Peritaje contable de parte", amount: 1000, date: "2026-06-17", expense_type: "tramite" },
  { case: "FAM-001", concept: "Tasa judicial — divorcio de mutuo consentimiento", amount: 250, date: "2026-07-21", expense_type: "tramite" },
  { case: "EXT-001", concept: "Mensajería especializada y notificaciones", amount: 100, date: "2026-05-29", expense_type: "tramite" },
];

// ---------------------------------------------------------------------------
// LÍNEAS DE DOCUMENTOS FINANCIEROS
// ---------------------------------------------------------------------------
// tax_code / tax_rate se guardan como SNAPSHOT en la línea (así lo hace la
// app): ITBMS_7 = 0.07, EXENTO = 0.
export interface SeedLine {
  service: string; // code de services_catalog
  description: string;
  quantity: number;
  unit_price: number;
  tax_code: "ITBMS_7" | "EXENTO";
  invoice_kind: "HONORARIOS" | "REEMBOLSO";
}

export const TAX_RATE: Record<SeedLine["tax_code"], number> = {
  ITBMS_7: 0.07,
  EXENTO: 0,
};

// ---------------------------------------------------------------------------
// COTIZACIONES — una por estado alcanzable
// ---------------------------------------------------------------------------
export interface SeedQuote {
  n: number; // → COT-0000NN
  client: number;
  case: string | null;
  title: string;
  issue_date: string;
  valid_until: string;
  /** Estado FINAL. El seed crea en 'borrador' y avanza por transiciones legales. */
  status:
    | "borrador"
    | "emitida"
    | "enviada"
    | "aceptada"
    | "rechazada"
    | "expirada"
    | "cancelada_pre_envio";
  lines: SeedLine[];
}

export const SEED_QUOTES: SeedQuote[] = [
  {
    n: 1, client: 1, case: "CORP-002", title: "Cambio de junta directiva",
    issue_date: "2026-04-01", valid_until: "2026-05-01", status: "aceptada",
    lines: [
      { service: "HON-COR", description: "Honorarios — cambio de junta directiva", quantity: 1, unit_price: 1000, tax_code: "ITBMS_7", invoice_kind: "HONORARIOS" },
      { service: "REIM-GOB", description: "Reembolso — tasa de Registro Público", quantity: 1, unit_price: 150, tax_code: "EXENTO", invoice_kind: "REEMBOLSO" },
    ],
  },
  {
    n: 2, client: 9, case: "MIG-001", title: "Residencia permanente país amigo",
    issue_date: "2026-04-15", valid_until: "2026-05-15", status: "enviada",
    lines: [
      { service: "HON-MIG", description: "Honorarios — trámite de residencia", quantity: 1, unit_price: 2500, tax_code: "ITBMS_7", invoice_kind: "HONORARIOS" },
      { service: "REIM-GOB", description: "Reembolso — tasas de Migración", quantity: 1, unit_price: 800, tax_code: "EXENTO", invoice_kind: "REEMBOLSO" },
    ],
  },
  {
    n: 3, client: 4, case: "CORP-003", title: "Aumento de capital autorizado",
    issue_date: "2026-05-04", valid_until: "2026-06-04", status: "emitida",
    lines: [
      { service: "HON-COR", description: "Honorarios — aumento de capital", quantity: 1, unit_price: 1500, tax_code: "ITBMS_7", invoice_kind: "HONORARIOS" },
    ],
  },
  {
    n: 4, client: 10, case: "CIV-001", title: "Cobro de suma líquida y exigible",
    issue_date: "2026-05-11", valid_until: "2026-06-11", status: "rechazada",
    lines: [
      { service: "HON-CIV", description: "Honorarios — proceso sumario de cobro", quantity: 1, unit_price: 2000, tax_code: "ITBMS_7", invoice_kind: "HONORARIOS" },
    ],
  },
  {
    n: 5, client: 5, case: "MIG-004", title: "Permisos migratorios de personal de obra",
    issue_date: "2026-02-02", valid_until: "2026-03-02", status: "expirada",
    lines: [
      { service: "HON-MIG", description: "Honorarios — 4 permisos de trabajo", quantity: 4, unit_price: 500, tax_code: "ITBMS_7", invoice_kind: "HONORARIOS" },
      { service: "REIM-GOB", description: "Reembolso — tasas migratorias", quantity: 1, unit_price: 1200, tax_code: "EXENTO", invoice_kind: "REEMBOLSO" },
    ],
  },
  {
    n: 6, client: 8, case: null, title: "Asesoría corporativa — propuesta inicial",
    issue_date: "2026-08-03", valid_until: "2026-09-03", status: "borrador",
    lines: [
      { service: "HON-COR", description: "Honorarios — asesoría corporativa mensual", quantity: 3, unit_price: 500, tax_code: "ITBMS_7", invoice_kind: "HONORARIOS" },
    ],
  },
  {
    n: 7, client: 3, case: "REG-001", title: "Registro sanitario de producto importado",
    issue_date: "2026-07-01", valid_until: "2026-08-01", status: "cancelada_pre_envio",
    lines: [
      { service: "HON-OTROS", description: "Honorarios — registro sanitario", quantity: 1, unit_price: 1500, tax_code: "ITBMS_7", invoice_kind: "HONORARIOS" },
    ],
  },
];

// ---------------------------------------------------------------------------
// FACTURAS — una por estado alcanzable, HON y REI
// ---------------------------------------------------------------------------
export interface SeedInvoice {
  n: number;
  kind: "HONORARIOS" | "REEMBOLSO";
  client: number;
  case: string | null;
  quote: number | null; // n de SeedQuote de origen
  issue_date: string;
  due_date: string;
  /**
   * Estado FINAL ESPERADO de la factura, no una instrucción de qué escribir.
   *
   * El seed empuja la factura solo hasta su estado BASE (ver `ESTADO_BASE` en
   * `seed-staging.ts`); los tres estados de cobro —`parcialmente_pagada` y
   * `pagada`— los produce el trigger T7a al aplicarse los pagos de
   * `SEED_PAYMENTS`. Al final el seed VERIFICA que el estado real coincida con
   * este. Si no coincide, falta o sobra un pago.
   *
   * ⚠️ Acá NO hay `amount_paid`, y es a propósito. Esa columna se deriva de
   * `payment_applications` y desde la migración 032 el trigger T4b rechaza
   * escribirla a mano. Para que una factura quede cobrada, se le agrega su pago
   * en `SEED_PAYMENTS`. Una factura sin pago queda en `amount_paid = 0`.
   */
  status:
    | "borrador"
    | "emitida"
    | "parcialmente_pagada"
    | "pagada"
    | "anulada"
    | "cancelada_pre_emision";
  cancellation_reason?: string;
  lines: SeedLine[];
}

export const SEED_INVOICES: SeedInvoice[] = [
  // De la cotización 1 (aceptada): sale una HON y una REI.
  {
    n: 1, kind: "HONORARIOS", client: 1, case: "CORP-002", quote: 1,
    issue_date: "2026-04-05", due_date: "2026-05-05", status: "pagada",
    lines: [{ service: "HON-COR", description: "Honorarios — cambio de junta directiva", quantity: 1, unit_price: 1000, tax_code: "ITBMS_7", invoice_kind: "HONORARIOS" }],
  },
  {
    n: 1, kind: "REEMBOLSO", client: 1, case: "CORP-002", quote: 1,
    issue_date: "2026-04-05", due_date: "2026-05-05", status: "pagada",
    lines: [{ service: "REIM-GOB", description: "Reembolso — tasa de Registro Público", quantity: 1, unit_price: 150, tax_code: "EXENTO", invoice_kind: "REEMBOLSO" }],
  },
  {
    n: 2, kind: "HONORARIOS", client: 4, case: "CORP-003", quote: null,
    issue_date: "2026-05-20", due_date: "2026-06-19", status: "parcialmente_pagada",
    lines: [{ service: "HON-COR", description: "Honorarios — aumento de capital", quantity: 1, unit_price: 1500, tax_code: "ITBMS_7", invoice_kind: "HONORARIOS" }],
  },
  {
    n: 3, kind: "HONORARIOS", client: 2, case: "ADM-002", quote: null,
    issue_date: "2026-06-01", due_date: "2026-07-01", status: "emitida",
    lines: [{ service: "HON-OTROS", description: "Honorarios — recurso de reconsideración", quantity: 1, unit_price: 2000, tax_code: "ITBMS_7", invoice_kind: "HONORARIOS" }],
  },
  {
    n: 2, kind: "REEMBOLSO", client: 5, case: "ADM-001", quote: null,
    issue_date: "2026-06-10", due_date: "2026-07-10", status: "emitida",
    lines: [{ service: "REIM-GOB", description: "Reembolso — tasa municipal de construcción", quantity: 1, unit_price: 400, tax_code: "EXENTO", invoice_kind: "REEMBOLSO" }],
  },
  {
    n: 4, kind: "HONORARIOS", client: 7, case: "LAB-004", quote: null,
    issue_date: "2026-03-12", due_date: "2026-04-11", status: "anulada",
    cancellation_reason: "Emitida con el caso equivocado. Se reemplaza por una factura nueva.",
    lines: [{ service: "HON-LAB", description: "Honorarios — cálculo de prestaciones", quantity: 1, unit_price: 1000, tax_code: "ITBMS_7", invoice_kind: "HONORARIOS" }],
  },
  {
    n: 5, kind: "HONORARIOS", client: 11, case: "PEN-001", quote: null,
    issue_date: "2026-07-05", due_date: "2026-08-04", status: "borrador",
    lines: [{ service: "HON-PEN", description: "Honorarios — querella patrimonial", quantity: 1, unit_price: 2500, tax_code: "ITBMS_7", invoice_kind: "HONORARIOS" }],
  },
  {
    n: 6, kind: "HONORARIOS", client: 12, case: "FAM-001", quote: null,
    issue_date: "2026-07-28", due_date: "2026-08-27", status: "cancelada_pre_emision",
    lines: [{ service: "HON-FAM", description: "Honorarios — divorcio de mutuo consentimiento", quantity: 1, unit_price: 1500, tax_code: "ITBMS_7", invoice_kind: "HONORARIOS" }],
  },
];

// ---------------------------------------------------------------------------
// PAGOS — la ÚNICA fuente de `invoices.amount_paid` y de los estados de cobro
// ---------------------------------------------------------------------------
// Vivían en `seed-asientos.ts` (constante COBROS), donde se creaban para que el
// asiento de cobro tuviera su documento. Se mudaron acá el 2026-09-01, con el
// guard T4b, por dos razones:
//
//   1. `seed:staging` tiene que producir por sí solo un estado final coherente.
//      Mientras los pagos vivieron en el otro script, `seed:staging` dejaba
//      facturas marcadas "pagada" sin un pago detrás — el desfase del 28/08.
//   2. `seed-asientos` ya CONSUME las facturas en vez de crearlas. Consumir
//      también los pagos es la misma regla aplicada dos veces.
//
// `reference` es la clave natural del pago: por ahí lo resuelve `seed-asientos`,
// igual que resuelve las facturas por `invoice_number`. Tiene que ser única.
export interface SeedPayment {
  /** Clave de idempotencia. El id del pago es `id("payment:" + clave)`. */
  clave: string;
  /** Número de la factura que cancela, tal como lo arma `seed-staging`. */
  invoice: string;
  date: string;
  amount: number;
  method: "efectivo" | "transferencia" | "cheque" | "tarjeta" | "ach" | "otro";
  /** Clave natural — única. Por acá lo resuelve `seed-asientos`. */
  reference: string;
}

export const SEED_PAYMENTS: SeedPayment[] = [
  // Cobro TOTAL: la factura llega a 'pagada' y su CxC se cancela.
  {
    clave: "cobro:hon-1-total",
    invoice: "FAC-HON-000001",
    date: "2026-04-20",
    amount: 1070,
    method: "transferencia",
    reference: "Transferencia Banco General 4471902",
  },
  // ---- EL PAGO QUE FALTABA, Y QUE NO LLEVA ASIENTO ------------------------
  // Este es el cobro cuya ausencia produjo el desfase del 28/08: la factura
  // declaraba `amount_paid = 150` a mano y no existía el pago.
  //
  // ⚠️ A PROPÓSITO no tiene entrada en `COBROS` de `seed-asientos.ts`, así que
  // NO genera asiento. No es un olvido:
  //
  //   · La regla del fixture es "todo asiento tiene documento", NO "todo
  //     documento tiene asiento". Lo segundo todavía no aplica porque
  //     factura→asiento no está cableado: solo 4 de las 8 facturas tienen
  //     asiento. Un pago sin asiento es consistente con eso, no una asimetría.
  //   · Y hay un motivo de medición: el mayor de Cuentas por Cobrar cierra hoy
  //     en 194,842.55 contra 191,947.55 del Balance General, y esa diferencia
  //     de 2,895.00 es el baseline con el que se va a validar el bloque de
  //     convergencia de reportes. Agregarle el asiento lo movería a 194,692.55
  //     y se perdería el número contra el cual comparar.
  //
  // Cuando se cablee factura→asiento, este cobro entra al ledger con todos los
  // demás y el baseline deja de hacer falta.
  {
    clave: "cobro:rei-1-total",
    invoice: "FAC-REI-000001",
    date: "2026-04-20",
    amount: 150,
    method: "transferencia",
    reference: "Transferencia Banco General 4471915",
  },
  // Cobro PARCIAL: la factura queda en 'parcialmente_pagada' y la CxC no baja a
  // cero. Da el caso de una cuenta con movimientos de los dos lados que no se
  // cancelan entre sí.
  {
    clave: "cobro:hon-2-parcial",
    invoice: "FAC-HON-000002",
    date: "2026-06-15",
    amount: 1000,
    method: "transferencia",
    reference: "Transferencia Banco General 4488115",
  },
];

// ---------------------------------------------------------------------------
// TAREAS Y PENDIENTES — mínimo para que las pantallas del asistente no
// se vean vacías en staging.
// ---------------------------------------------------------------------------
export const SEED_TASKS = [
  { case: "CORP-002", description: "Recoger copia autenticada del acta en la notaría", deadline: "2026-09-05", assignee: "asistente", status: "pendiente" as const },
  { case: "MIG-001", description: "Escanear pasaporte y adjuntarlo al expediente", deadline: "2026-09-02", assignee: "asistente", status: "pendiente" as const },
  { case: "REG-001", description: "Confirmar recepción del expediente en MINSA", deadline: "2026-08-28", assignee: "asistente", status: "pendiente" as const },
  { case: "CIV-003", description: "Solicitar certificación de finca actualizada", deadline: "2026-08-20", assignee: "asistente", status: "cumplida" as const },
  { case: "ADM-001", description: "Dar seguimiento al permiso en el Municipio", deadline: "2026-09-10", assignee: "abogada2", status: "pendiente" as const },
  { case: "FAM-001", description: "Preparar borrador del acuerdo de divorcio", deadline: "2026-09-01", assignee: "abogada2", status: "pendiente" as const },
];

export const SEED_TODOS = [
  { user: "asistente", description: "Ordenar el archivo físico de expedientes cerrados", deadline: "2026-09-12", status: "pendiente" as const },
  { user: "asistente", description: "Pedir cotización de papelería para la oficina", deadline: "2026-08-30", status: "pendiente" as const },
  { user: "abogada", description: "Revisar vencimientos de sociedades del mes", deadline: "2026-09-15", status: "pendiente" as const },
  { user: "contador", description: "Cerrar conciliación bancaria de agosto", deadline: "2026-09-08", status: "pendiente" as const },
];
