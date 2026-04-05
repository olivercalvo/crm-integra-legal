#!/usr/bin/env node
/**
 * seed-from-excel.mjs
 * Reads the Excel workbook, cleans data, and inserts clients + cases
 * into Supabase via the REST API (service_role key).
 */

import XLSX from "xlsx";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Config (from environment variables) ──────────────────────────────────────
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TENANT_ID = process.env.TENANT_ID || "a0000000-0000-0000-0000-000000000001";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  apikey: SERVICE_ROLE_KEY,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

async function supabaseGet(table, params = "") {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${params}`;
  const res = await fetch(url, { headers, method: "GET" });
  if (!res.ok) throw new Error(`GET ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function supabasePost(table, rows) {
  const url = `${SUPABASE_URL}/rest/v1/${table}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { ...headers, Prefer: "return=representation,resolution=ignore-duplicates" },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`POST ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

function trim(v) {
  return typeof v === "string" ? v.trim() : v;
}

/**
 * Normalize the messy date formats in the Excel:
 *  - "13/03/2026"  → "2026-03-13"
 *  - "20/3/2026"   → "2026-03-20"
 *  - 2021 (year)   → "2021-01-01"
 *  - 46024 (Excel serial) → proper date
 *  - ""            → null
 */
function parseDate(raw) {
  if (!raw && raw !== 0) return null;

  // Excel serial number (e.g. 46024)
  if (typeof raw === "number" && raw > 10000) {
    const d = XLSX.SSF.parse_date_code(raw);
    return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }

  // Plain year (e.g. 2021, 2024)
  if (typeof raw === "number" && raw >= 2000 && raw <= 2100) {
    return `${raw}-01-01`;
  }

  const s = String(raw).trim();
  if (!s) return null;

  // DD/MM/YYYY or D/M/YYYY
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }

  return null;
}

/**
 * Normalize responsible aliases → full name
 */
function normalizeResponsible(raw) {
  const s = trim(raw || "").toLowerCase();
  if (!s) return null;
  if (["daveiva", "dave"].includes(s)) return "Daveiva";
  if (["milena", "mile"].includes(s)) return "Milena";
  return trim(raw);
}

/**
 * Separate "UBICACIÓN FÍSICA" into institution vs physical_location.
 * Known institutions from the catalog.
 */
const KNOWN_INSTITUTIONS = ["MINSA", "MICI", "Registro Público", "Migración", "Municipio"];

function parseLocation(raw) {
  const s = trim(raw || "");
  if (!s) return { institution: null, location: null };

  // Check if value matches a known institution
  const inst = KNOWN_INSTITUTIONS.find((i) => i.toUpperCase() === s.toUpperCase());
  if (inst) return { institution: inst, location: null };

  // "CORPORATIVO", "REGULATORIO" etc. → these are classification-based filing sections
  if (["CORPORATIVO", "REGULATORIO", "MIGRACIÓN", "LABORAL", "PENAL", "CIVIL", "ADMINISTRATIVO"].includes(s.toUpperCase())) {
    return { institution: null, location: `Archivo - Sección ${s.charAt(0) + s.slice(1).toLowerCase()}` };
  }

  // Everything else is a physical location
  return { institution: null, location: s };
}

function normalizeStatus(raw) {
  const s = trim(raw || "");
  if (!s) return "Activo"; // default
  if (s.toLowerCase() === "activo") return "Activo";
  if (s.toLowerCase().includes("trámite") || s.toLowerCase().includes("tramite")) return "En trámite";
  if (s.toLowerCase() === "cerrado") return "Cerrado";
  return "Activo";
}

function normalizeClassification(raw) {
  const s = trim(raw || "").toUpperCase();
  const map = {
    CORPORATIVO: "Corporativo",
    MIGRACIÓN: "Migración",
    MIGRACION: "Migración",
    REGULATORIO: "Regulatorio",
    LABORAL: "Laboral",
    PENAL: "Penal",
    CIVIL: "Civil",
    ADMINISTRATIVO: "Administrativo",
  };
  return map[s] || trim(raw);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("📖 Reading Excel...");
  const xlsPath = path.resolve(__dirname, "..", "REGISTRO DE EXPEDIENTES OFICINA INTEGRA LEGAL-2026.xlsx");
  const wb = XLSX.readFile(xlsPath);

  // ── 1. Load catalogs from Supabase ─────────────────────────────────────
  console.log("📦 Loading catalogs from Supabase...");
  const [classifications, statuses, institutions, teamMembers] = await Promise.all([
    supabaseGet("cat_classifications", `tenant_id=eq.${TENANT_ID}`),
    supabaseGet("cat_statuses", `tenant_id=eq.${TENANT_ID}`),
    supabaseGet("cat_institutions", `tenant_id=eq.${TENANT_ID}`),
    supabaseGet("cat_team", `tenant_id=eq.${TENANT_ID}`),
  ]);

  const classMap = Object.fromEntries(classifications.map((c) => [c.name, c.id]));
  const statusMap = Object.fromEntries(statuses.map((s) => [s.name, s.id]));
  const instMap = Object.fromEntries(institutions.map((i) => [i.name, i.id]));
  const teamMap = Object.fromEntries(teamMembers.map((t) => [t.name, t.id]));

  console.log("  Classifications:", Object.keys(classMap));
  console.log("  Statuses:", Object.keys(statusMap));
  console.log("  Institutions:", Object.keys(instMap));
  console.log("  Team:", Object.keys(teamMap));

  // ── 2. Ensure team members exist ───────────────────────────────────────
  const neededTeam = ["Daveiva", "Milena"];
  const missingTeam = neededTeam.filter((n) => !teamMap[n]);
  if (missingTeam.length > 0) {
    console.log(`  Creating team members: ${missingTeam.join(", ")}`);
    // Look up user IDs
    const users = await supabaseGet("users", `tenant_id=eq.${TENANT_ID}`);
    const userByFirstName = {};
    for (const u of users) {
      const first = u.full_name.split(" ")[0];
      userByFirstName[first] = u.id;
    }

    const newTeam = missingTeam.map((name) => ({
      tenant_id: TENANT_ID,
      name,
      user_id: userByFirstName[name] || null,
      role: "abogada",
    }));
    const created = await supabasePost("cat_team", newTeam);
    for (const t of created) teamMap[t.name] = t.id;
  }

  // ── 3. Parse CLIENTES sheet ────────────────────────────────────────────
  console.log("\n👥 Parsing CLIENTES...");
  const clientRows = XLSX.utils.sheet_to_json(wb.Sheets["CLIENTES"], { header: 1, defval: "" });
  const clients = [];

  for (let i = 3; i < clientRows.length; i++) {
    const r = clientRows[i];
    const clientNum = trim(r[0]);
    const name = trim(r[1]);
    if (!clientNum || !name) continue; // skip empty placeholders

    clients.push({
      tenant_id: TENANT_ID,
      client_number: clientNum,
      name,
      ruc: trim(r[2]) || null,
      type: trim(r[3]) ? trim(r[3]).charAt(0).toUpperCase() + trim(r[3]).slice(1).toLowerCase().trim() : null,
      contact: trim(r[4]) || null,
      phone: trim(String(r[5])) || null,
      email: trim(r[6]) || null,
      observations: trim(r[7]) || null,
      active: true,
    });
  }
  console.log(`  Found ${clients.length} clients (after removing empty placeholders)`);

  // Insert clients
  console.log("  Inserting clients...");
  const insertedClients = await supabasePost("clients", clients);
  console.log(`  ✅ Inserted ${insertedClients.length} clients`);

  // Build lookup by client_number
  const clientIdMap = Object.fromEntries(insertedClients.map((c) => [c.client_number, c.id]));

  // ── 4. Parse REGISTRO MAESTRO sheet ────────────────────────────────────
  console.log("\n📋 Parsing REGISTRO MAESTRO (cases)...");
  const caseRows = XLSX.utils.sheet_to_json(wb.Sheets["REGISTRO MAESTRO"], { header: 1, defval: "" });
  const cases = [];

  for (let i = 4; i < caseRows.length; i++) {
    // data starts at row 4 (row 3 is header)
    const r = caseRows[i];
    const expNum = r[0];
    const clientNum = trim(r[1]);
    if (!expNum || !clientNum) continue;

    const clientId = clientIdMap[clientNum];
    if (!clientId) {
      console.warn(`  ⚠ Case row ${i}: client ${clientNum} not found, skipping`);
      continue;
    }

    const classification = normalizeClassification(r[3]);
    const caseCode = trim(r[4]);
    const description = trim(r[5]) || null;
    const responsible = normalizeResponsible(r[6]);
    const openedAt = parseDate(r[7]);
    const status = normalizeStatus(r[8]);
    const { institution, location } = parseLocation(r[9]);
    const observations = trim(r[10]) || null;
    const hasDigitalFile = String(r[11]).toLowerCase().includes("sí") || String(r[11]).toLowerCase().includes("si");

    cases.push({
      tenant_id: TENANT_ID,
      client_id: clientId,
      case_code: caseCode,
      description,
      classification_id: classMap[classification] || null,
      institution_id: institution ? instMap[institution] || null : null,
      responsible_id: responsible ? teamMap[responsible] || null : null,
      opened_at: openedAt,
      status_id: statusMap[status] || null,
      physical_location: location,
      observations,
      has_digital_file: hasDigitalFile,
    });
  }
  console.log(`  Found ${cases.length} cases`);

  // Insert cases
  console.log("  Inserting cases...");
  const insertedCases = await supabasePost("cases", cases);
  console.log(`  ✅ Inserted ${insertedCases.length} cases`);

  // ── 5. Summary ─────────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════");
  console.log(`  RESUMEN DE MIGRACIÓN`);
  console.log(`  Clientes insertados: ${insertedClients.length}`);
  console.log(`  Expedientes insertados: ${insertedCases.length}`);
  console.log("══════════════════════════════════════════\n");
}

main().catch((err) => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});
