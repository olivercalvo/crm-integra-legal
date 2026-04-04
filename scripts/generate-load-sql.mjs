/**
 * generate-load-sql.mjs
 * Reads the Excel file and generates load_real_data.sql with INSERT statements.
 * Run: node scripts/generate-load-sql.mjs
 */
import XLSX from 'xlsx';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const wb = XLSX.readFile(join(ROOT, 'REGISTRO DE EXPEDIENTES OFICINA INTEGRA LEGAL-2026.xlsx'));

const TENANT = "'TENANT_ID_HERE'";

// ── Helper: escape single quotes for SQL ──
function esc(str) {
  if (!str) return null;
  return String(str).trim().replace(/'/g, "''");
}

// ── Helper: convert Excel date to YYYY-MM-DD ──
function parseDate(val) {
  if (!val) return null;

  // Pure year number (e.g. 2021, 2024)
  if (typeof val === 'number' && val >= 1900 && val <= 2100) {
    return `${val}-01-01`;
  }

  // Excel serial date number
  if (typeof val === 'number' && val > 40000) {
    const d = XLSX.SSF.parse_date_code(val);
    const mm = String(d.m).padStart(2, '0');
    const dd = String(d.d).padStart(2, '0');
    return `${d.y}-${mm}-${dd}`;
  }

  // String date like "13/03/2026" or "20/3/2026"
  if (typeof val === 'string') {
    const m = val.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }
  }

  return null;
}

// ── Helper: normalize responsible name ──
function normalizeResponsible(name) {
  if (!name) return null;
  const n = name.trim();
  const lower = n.toLowerCase();
  if (lower === 'dave' || lower === 'daveiva') return 'Daveiva';
  if (lower === 'mile' || lower === 'milena') return 'Milena';
  return n;
}

// ══════════════════════════════════════════════
// 1. PARSE CLIENTES SHEET
// ══════════════════════════════════════════════
const clientSheet = wb.Sheets['CLIENTES'];
const clientRows = XLSX.utils.sheet_to_json(clientSheet, { header: 1 });

const clients = [];
// Header row is at index 2, data starts at index 3
for (let i = 3; i < clientRows.length; i++) {
  const r = clientRows[i];
  if (!r || !r[0] || !r[1]) continue; // skip empty or rows without name
  const clientNumber = esc(r[0]);
  const name = esc(r[1]);
  const ruc = esc(r[2]);
  const type = esc(r[3]);
  const contact = esc(r[4]);
  const phone = esc(r[5]);
  const email = esc(r[6]);
  const observations = esc(r[7]);

  clients.push({ clientNumber, name, ruc, type, contact, phone, email, observations });
}

console.log(`Parsed ${clients.length} clients`);

// ══════════════════════════════════════════════
// 2. PARSE REGISTRO MAESTRO SHEET
// ══════════════════════════════════════════════
const caseSheet = wb.Sheets['REGISTRO MAESTRO'];
const caseRows = XLSX.utils.sheet_to_json(caseSheet, { header: 1 });

const cases = [];
// Header row at index 3, data starts at index 4
for (let i = 4; i < caseRows.length; i++) {
  const r = caseRows[i];
  if (!r || !r[2] || !r[4]) continue; // must have client name and case code
  const clientName = esc(r[2]);
  if (!clientName) continue;

  const classification = esc(r[3]);
  const caseCode = esc(r[4]);
  if (!caseCode) continue;

  const description = esc(r[5]);
  const responsible = normalizeResponsible(r[6]);
  const openedAt = parseDate(r[7]);
  const status = esc(r[8]) || 'En trámite';
  const physicalLocation = esc(r[9]);
  const observations = esc(r[10]);
  const hasDigitalFile = r[11] && String(r[11]).trim().toLowerCase() === 'sí';

  cases.push({
    clientName,
    classification,
    caseCode,
    description,
    responsible,
    openedAt,
    status,
    physicalLocation,
    observations,
    hasDigitalFile,
  });
}

console.log(`Parsed ${cases.length} cases`);

// ══════════════════════════════════════════════
// 3. GENERATE SQL
// ══════════════════════════════════════════════
let sql = `-- ============================================================
-- load_real_data.sql
-- Generated on ${new Date().toISOString().slice(0, 10)}
-- Replace TENANT_ID_HERE with the actual tenant UUID before running
-- ============================================================

-- ============================================================
-- STEP 0: Ensure catalog data exists
-- ============================================================

-- Classifications (upsert by name)
INSERT INTO cat_classifications (tenant_id, name, prefix, description, active)
VALUES
  (${TENANT}, 'CORPORATIVO', 'CORP', 'Constitución de sociedades, actas, reformas, poderes, cesiones, disoluciones', true),
  (${TENANT}, 'MIGRACIÓN', 'MIG', 'Permisos de trabajo, residencias, visas, trámites migratorios', true),
  (${TENANT}, 'LABORAL', 'LAB', 'Contratos, terminaciones, demandas laborales, reglamentos internos', true),
  (${TENANT}, 'PENAL', 'PEN', 'Denuncias, querellas, defensas penales, procesos penales', true),
  (${TENANT}, 'CIVIL', 'CIV', 'Demandas civiles, procesos de cobro, sucesiones, contratos civiles', true),
  (${TENANT}, 'ADMINISTRATIVO', 'ADM', 'Licencias, permisos, avisos de operación, trámites gubernamentales', true),
  (${TENANT}, 'REGULATORIO', 'REG', 'Cumplimiento regulatorio, reportes AML/GAFI, auditorías, inspecciones', true)
ON CONFLICT DO NOTHING;

-- Statuses
INSERT INTO cat_statuses (tenant_id, name, active)
VALUES
  (${TENANT}, 'En trámite', true),
  (${TENANT}, 'Cerrado', true)
ON CONFLICT DO NOTHING;

-- Team members (responsible)
INSERT INTO cat_team (tenant_id, name, role, active)
VALUES
  (${TENANT}, 'Daveiva', 'abogada', true),
  (${TENANT}, 'Milena', 'asistente', true)
ON CONFLICT DO NOTHING;

-- ============================================================
-- STEP 1: INSERT CLIENTS (${clients.length} clients)
-- ============================================================

`;

for (const c of clients) {
  const vals = [
    TENANT,
    `'${c.clientNumber}'`,
    `'${c.name}'`,
    c.ruc ? `'${c.ruc}'` : 'NULL',
    c.type ? `'${c.type}'` : 'NULL',
    c.contact ? `'${c.contact}'` : 'NULL',
    c.phone ? `'${c.phone}'` : 'NULL',
    c.email ? `'${c.email}'` : 'NULL',
    c.observations ? `'${c.observations}'` : 'NULL',
    'true',
  ];
  sql += `INSERT INTO clients (tenant_id, client_number, name, ruc, type, contact, phone, email, observations, active)
VALUES (${vals.join(', ')})
ON CONFLICT DO NOTHING;\n\n`;
}

sql += `
-- ============================================================
-- STEP 2: INSERT CASES (${cases.length} cases)
-- ============================================================

`;

for (const c of cases) {
  const clientSubquery = `(SELECT id FROM clients WHERE name = '${c.clientName}' AND tenant_id = ${TENANT} LIMIT 1)`;
  const classifSubquery = c.classification
    ? `(SELECT id FROM cat_classifications WHERE name = '${c.classification}' AND tenant_id = ${TENANT} LIMIT 1)`
    : 'NULL';

  // Map status name
  const statusName = c.status === 'Activo' ? 'En trámite' : c.status;
  const statusSubquery = `(SELECT id FROM cat_statuses WHERE name = '${statusName}' AND tenant_id = ${TENANT} LIMIT 1)`;

  const responsibleSubquery = c.responsible
    ? `(SELECT id FROM cat_team WHERE name = '${c.responsible}' AND tenant_id = ${TENANT} LIMIT 1)`
    : 'NULL';

  const vals = [
    TENANT,
    clientSubquery,
    `'${c.caseCode}'`,
    c.description ? `'${c.description}'` : 'NULL',
    classifSubquery,
    'NULL', // institution_id - not in Excel
    responsibleSubquery,
    c.openedAt ? `'${c.openedAt}'` : 'NULL',
    statusSubquery,
    c.physicalLocation ? `'${c.physicalLocation}'` : 'NULL',
    c.observations ? `'${c.observations}'` : 'NULL',
    c.hasDigitalFile ? 'true' : 'false',
  ];

  sql += `INSERT INTO cases (tenant_id, client_id, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
VALUES (${vals.join(', ')})
ON CONFLICT DO NOTHING;\n\n`;
}

sql += `-- ============================================================
-- END OF LOAD
-- Total: ${clients.length} clients, ${cases.length} cases
-- ============================================================
`;

const outPath = join(ROOT, 'scripts', 'load_real_data.sql');
writeFileSync(outPath, sql, 'utf8');
console.log(`\nSQL written to: ${outPath}`);
console.log(`Total: ${clients.length} clients, ${cases.length} cases`);
