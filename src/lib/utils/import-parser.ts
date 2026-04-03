/**
 * Import parser utilities for CRM Integra Legal
 * Handles Excel/CSV parsing, validation, normalization, and duplicate detection.
 */
import * as XLSX from "xlsx";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ImportClientRow {
  rowNumber: number;
  name: string;
  ruc: string | null;
  type: string | null;
  contact: string | null;
  phone: string | null;
  email: string | null;
  observations: string | null;
}

export interface ImportCaseRow {
  rowNumber: number;
  clientName: string;
  clientRuc: string | null;
  description: string | null;
  classification: string | null;
  institution: string | null;
  responsible: string | null;
  openedAt: string | null;
  status: string | null;
  physicalLocation: string | null;
  observations: string | null;
  hasDigitalFile: boolean;
}

export interface ValidationError {
  row: number;
  field: string;
  message: string;
  severity: "error" | "warning";
}

export interface ImportPreview {
  clients: ImportClientRow[];
  cases: ImportCaseRow[];
  errors: ValidationError[];
  warnings: ValidationError[];
  duplicateClients: { row: number; name: string; matchField: string }[];
  stats: {
    totalRows: number;
    validClients: number;
    validCases: number;
    errorCount: number;
    warningCount: number;
    duplicateCount: number;
  };
}

// ---------------------------------------------------------------------------
// Alias normalization
// ---------------------------------------------------------------------------

const NAME_ALIASES: Record<string, string> = {
  dave: "Daveiva",
  daveiva: "Daveiva",
  mile: "Milena",
  milena: "Milena",
};

function normalizeAlias(name: string): string {
  const lower = name.toLowerCase().trim();
  for (const [alias, canonical] of Object.entries(NAME_ALIASES)) {
    // Match standalone alias (word boundary)
    const regex = new RegExp(`\\b${alias}\\b`, "i");
    if (regex.test(lower)) {
      return name.replace(regex, canonical);
    }
  }
  return name;
}

// ---------------------------------------------------------------------------
// Date normalization
// ---------------------------------------------------------------------------

/**
 * Normalizes various date formats to YYYY-MM-DD.
 * Handles: DD/MM/YYYY, DD-MM-YYYY, MM/DD/YYYY (US), YYYY-MM-DD, Excel serial numbers
 */
export function normalizeDate(value: unknown): string | null {
  if (value == null || value === "") return null;

  // Excel serial number (number type)
  if (typeof value === "number") {
    const date = XLSX.SSF.parse_date_code(value);
    if (date) {
      const y = date.y;
      const m = String(date.m).padStart(2, "0");
      const d = String(date.d).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }
    return null;
  }

  const str = String(value).trim();
  if (!str) return null;

  // Already ISO format YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  // DD/MM/YYYY or DD-MM-YYYY (common in Latin America)
  const ddmmyyyy = str.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (ddmmyyyy) {
    const day = parseInt(ddmmyyyy[1], 10);
    const month = parseInt(ddmmyyyy[2], 10);
    const year = parseInt(ddmmyyyy[3], 10);
    // If day > 12, it's definitely DD/MM/YYYY
    // If month > 12, it's MM/DD/YYYY
    // Otherwise assume DD/MM/YYYY (Latin American standard)
    if (month > 12 && day <= 12) {
      // Swap: was actually MM/DD/YYYY
      return `${year}-${String(day).padStart(2, "0")}-${String(month).padStart(2, "0")}`;
    }
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  // Try native Date parse as last resort
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split("T")[0];
  }

  return null;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** Column mapping: maps various column header names to canonical field names */
const CLIENT_COLUMN_MAP: Record<string, keyof ImportClientRow> = {
  nombre: "name",
  name: "name",
  cliente: "name",
  "nombre del cliente": "name",
  "nombre cliente": "name",
  ruc: "ruc",
  "ruc/cedula": "ruc",
  cedula: "ruc",
  "n° cliente": "ruc",
  "no. cliente": "ruc",
  tipo: "type",
  type: "type",
  "tipo de persona": "type",
  contacto: "contact",
  contact: "contact",
  telefono: "phone",
  teléfono: "phone",
  phone: "phone",
  tel: "phone",
  celular: "phone",
  email: "email",
  correo: "email",
  "correo electrónico": "email",
  "correo electronico": "email",
  observaciones: "observations",
  observations: "observations",
  notas: "observations",
};

const CASE_COLUMN_MAP: Record<string, keyof ImportCaseRow> = {
  cliente: "clientName",
  "nombre cliente": "clientName",
  "nombre del cliente": "clientName",
  "ruc cliente": "clientRuc",
  descripcion: "description",
  descripción: "description",
  description: "description",
  detalle: "description",
  clasificacion: "classification",
  clasificación: "classification",
  classification: "classification",
  tipo: "classification",
  "tipo de caso": "classification",
  institucion: "institution",
  institución: "institution",
  institution: "institution",
  juzgado: "institution",
  tribunal: "institution",
  responsable: "responsible",
  responsible: "responsible",
  abogado: "responsible",
  "abogado responsable": "responsible",
  "fecha apertura": "openedAt",
  "fecha de apertura": "openedAt",
  fecha: "openedAt",
  "opened at": "openedAt",
  estado: "status",
  status: "status",
  "ubicacion fisica": "physicalLocation",
  "ubicación física": "physicalLocation",
  "ubicacion": "physicalLocation",
  ubicación: "physicalLocation",
  observaciones: "observations",
  observations: "observations",
  notas: "observations",
  "archivo digital": "hasDigitalFile",
  "expediente digital": "hasDigitalFile",
};

function mapColumns<T>(headers: string[], columnMap: Record<string, keyof T>): Map<number, keyof T> {
  const mapping = new Map<number, keyof T>();
  headers.forEach((header, index) => {
    const normalized = header.toLowerCase().trim();
    if (columnMap[normalized]) {
      mapping.set(index, columnMap[normalized]);
    }
  });
  return mapping;
}

function isRowEmpty(row: unknown[]): boolean {
  return row.every((cell) => cell == null || String(cell).trim() === "");
}

function cleanString(value: unknown): string | null {
  if (value == null) return null;
  const str = String(value).trim();
  return str || null;
}

function parseBool(value: unknown): boolean {
  if (value == null) return false;
  const str = String(value).toLowerCase().trim();
  return ["si", "sí", "yes", "true", "1", "x"].includes(str);
}

// ---------------------------------------------------------------------------
// Main parse function
// ---------------------------------------------------------------------------

export function parseImportFile(buffer: ArrayBuffer, sheetName?: string): {
  clientRows: ImportClientRow[];
  caseRows: ImportCaseRow[];
  sheetNames: string[];
} {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheetNames = workbook.SheetNames;

  // Try to find client and case sheets
  const clientSheetName = sheetNames.find((n) =>
    /client|cliente/i.test(n)
  ) || (sheetNames.length >= 1 ? sheetNames[0] : undefined);

  const caseSheetName = sheetNames.find((n) =>
    /case|expedient|caso/i.test(n)
  ) || (sheetNames.length >= 2 ? sheetNames[1] : undefined);

  const clientRows: ImportClientRow[] = [];
  const caseRows: ImportCaseRow[] = [];

  // Parse clients sheet
  if (clientSheetName) {
    const sheet = workbook.Sheets[clientSheetName];
    const data: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });

    if (data.length > 0) {
      const headers = (data[0] as string[]).map((h) => String(h || ""));
      const colMap = mapColumns<ImportClientRow>(headers, CLIENT_COLUMN_MAP);

      for (let i = 1; i < data.length; i++) {
        const row = data[i] as unknown[];
        if (isRowEmpty(row)) continue;

        const client: Partial<ImportClientRow> = { rowNumber: i + 1 };
        colMap.forEach((field, colIdx) => {
          const val = row[colIdx];
          if (field === "name") {
            let name = cleanString(val);
            if (name) name = normalizeAlias(name);
            (client as Record<string, unknown>)[field] = name;
          } else {
            (client as Record<string, unknown>)[field] = cleanString(val);
          }
        });

        if (client.name) {
          clientRows.push({
            rowNumber: client.rowNumber!,
            name: client.name as string,
            ruc: (client.ruc as string) || null,
            type: (client.type as string) || null,
            contact: (client.contact as string) || null,
            phone: (client.phone as string) || null,
            email: (client.email as string) || null,
            observations: (client.observations as string) || null,
          });
        }
      }
    }
  }

  // Parse cases sheet
  if (caseSheetName && caseSheetName !== clientSheetName) {
    const sheet = workbook.Sheets[caseSheetName];
    const data: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });

    if (data.length > 0) {
      const headers = (data[0] as string[]).map((h) => String(h || ""));
      const colMap = mapColumns<ImportCaseRow>(headers, CASE_COLUMN_MAP);

      for (let i = 1; i < data.length; i++) {
        const row = data[i] as unknown[];
        if (isRowEmpty(row)) continue;

        const caseRow: Partial<ImportCaseRow> = { rowNumber: i + 1 };
        colMap.forEach((field, colIdx) => {
          const val = row[colIdx];
          if (field === "clientName") {
            let name = cleanString(val);
            if (name) name = normalizeAlias(name);
            (caseRow as Record<string, unknown>)[field] = name;
          } else if (field === "openedAt") {
            (caseRow as Record<string, unknown>)[field] = normalizeDate(val);
          } else if (field === "hasDigitalFile") {
            (caseRow as Record<string, unknown>)[field] = parseBool(val);
          } else {
            (caseRow as Record<string, unknown>)[field] = cleanString(val);
          }
        });

        if (caseRow.clientName || caseRow.description) {
          caseRows.push({
            rowNumber: caseRow.rowNumber!,
            clientName: (caseRow.clientName as string) || "",
            clientRuc: (caseRow.clientRuc as string) || null,
            description: (caseRow.description as string) || null,
            classification: (caseRow.classification as string) || null,
            institution: (caseRow.institution as string) || null,
            responsible: (caseRow.responsible as string) || null,
            openedAt: (caseRow.openedAt as string) || null,
            status: (caseRow.status as string) || null,
            physicalLocation: (caseRow.physicalLocation as string) || null,
            observations: (caseRow.observations as string) || null,
            hasDigitalFile: (caseRow.hasDigitalFile as boolean) || false,
          });
        }
      }
    }
  }

  // If only one sheet, try to detect if it has case columns too
  if (sheetNames.length === 1 && caseRows.length === 0) {
    const sheet = workbook.Sheets[sheetNames[0]];
    const data: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
    if (data.length > 0) {
      const headers = (data[0] as string[]).map((h) => String(h || ""));
      const colMap = mapColumns<ImportCaseRow>(headers, CASE_COLUMN_MAP);
      // If we find case-specific columns (description, classification, institution), parse as cases too
      const colValues: (keyof ImportCaseRow)[] = [];
      colMap.forEach((v) => colValues.push(v));
      const hasCaseColumns = colValues.some((f) =>
        ["description", "classification", "institution", "openedAt"].includes(f)
      );
      if (hasCaseColumns) {
        for (let i = 1; i < data.length; i++) {
          const row = data[i] as unknown[];
          if (isRowEmpty(row)) continue;

          const caseRow: Partial<ImportCaseRow> = { rowNumber: i + 1 };
          colMap.forEach((field, colIdx) => {
            const val = row[colIdx];
            if (field === "clientName") {
              let name = cleanString(val);
              if (name) name = normalizeAlias(name);
              (caseRow as Record<string, unknown>)[field] = name;
            } else if (field === "openedAt") {
              (caseRow as Record<string, unknown>)[field] = normalizeDate(val);
            } else if (field === "hasDigitalFile") {
              (caseRow as Record<string, unknown>)[field] = parseBool(val);
            } else {
              (caseRow as Record<string, unknown>)[field] = cleanString(val);
            }
          });

          if (caseRow.clientName || caseRow.description) {
            caseRows.push({
              rowNumber: caseRow.rowNumber!,
              clientName: (caseRow.clientName as string) || "",
              clientRuc: (caseRow.clientRuc as string) || null,
              description: (caseRow.description as string) || null,
              classification: (caseRow.classification as string) || null,
              institution: (caseRow.institution as string) || null,
              responsible: (caseRow.responsible as string) || null,
              openedAt: (caseRow.openedAt as string) || null,
              status: (caseRow.status as string) || null,
              physicalLocation: (caseRow.physicalLocation as string) || null,
              observations: (caseRow.observations as string) || null,
              hasDigitalFile: (caseRow.hasDigitalFile as boolean) || false,
            });
          }
        }
      }
    }
  }

  return { clientRows, caseRows, sheetNames };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateImport(
  clientRows: ImportClientRow[],
  caseRows: ImportCaseRow[],
  existingClients: { name: string; ruc: string | null; client_number: string }[]
): ImportPreview {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];
  const duplicateClients: { row: number; name: string; matchField: string }[] = [];

  // Build sets for duplicate detection
  const existingNames = new Set(existingClients.map((c) => c.name.toLowerCase().trim()));
  const existingRucs = new Set(
    existingClients.filter((c) => c.ruc).map((c) => c.ruc!.toLowerCase().trim())
  );

  // Track within-file duplicates
  const seenNames = new Map<string, number>();
  const seenRucs = new Map<string, number>();

  // Validate clients
  const validClients: ImportClientRow[] = [];
  for (const client of clientRows) {
    let hasError = false;

    // Required: name
    if (!client.name || !client.name.trim()) {
      errors.push({ row: client.rowNumber, field: "nombre", message: "Nombre es requerido", severity: "error" });
      hasError = true;
    }

    // Check email format if provided
    if (client.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(client.email)) {
      warnings.push({ row: client.rowNumber, field: "email", message: "Formato de email inválido", severity: "warning" });
    }

    // Check for duplicate by name in DB
    if (client.name && existingNames.has(client.name.toLowerCase().trim())) {
      duplicateClients.push({ row: client.rowNumber, name: client.name, matchField: "nombre" });
    }

    // Check for duplicate by RUC in DB
    if (client.ruc && existingRucs.has(client.ruc.toLowerCase().trim())) {
      duplicateClients.push({ row: client.rowNumber, name: client.name, matchField: "RUC" });
    }

    // Check for duplicate within file (by name)
    const nameLower = client.name?.toLowerCase().trim();
    if (nameLower && seenNames.has(nameLower)) {
      warnings.push({
        row: client.rowNumber,
        field: "nombre",
        message: `Duplicado en archivo (misma fila ${seenNames.get(nameLower)})`,
        severity: "warning",
      });
    } else if (nameLower) {
      seenNames.set(nameLower, client.rowNumber);
    }

    // Check for duplicate within file (by RUC)
    if (client.ruc) {
      const rucLower = client.ruc.toLowerCase().trim();
      if (seenRucs.has(rucLower)) {
        warnings.push({
          row: client.rowNumber,
          field: "ruc",
          message: `RUC duplicado en archivo (misma fila ${seenRucs.get(rucLower)})`,
          severity: "warning",
        });
      } else {
        seenRucs.set(rucLower, client.rowNumber);
      }
    }

    if (!hasError) validClients.push(client);
  }

  // Validate cases
  const validCases: ImportCaseRow[] = [];
  const allClientNames = new Set([
    ...existingClients.map((c) => c.name.toLowerCase().trim()),
    ...clientRows.map((c) => c.name.toLowerCase().trim()),
  ]);

  for (const caseRow of caseRows) {
    let hasError = false;

    // Required: clientName
    if (!caseRow.clientName || !caseRow.clientName.trim()) {
      errors.push({ row: caseRow.rowNumber, field: "cliente", message: "Nombre del cliente es requerido para el caso", severity: "error" });
      hasError = true;
    }

    // Warn if client not found in DB or import
    if (caseRow.clientName && !allClientNames.has(caseRow.clientName.toLowerCase().trim())) {
      warnings.push({
        row: caseRow.rowNumber,
        field: "cliente",
        message: `Cliente "${caseRow.clientName}" no encontrado; se creará automáticamente`,
        severity: "warning",
      });
    }

    if (!hasError) validCases.push(caseRow);
  }

  return {
    clients: validClients,
    cases: validCases,
    errors,
    warnings,
    duplicateClients,
    stats: {
      totalRows: clientRows.length + caseRows.length,
      validClients: validClients.length,
      validCases: validCases.length,
      errorCount: errors.length,
      warningCount: warnings.length,
      duplicateCount: duplicateClients.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Template generation
// ---------------------------------------------------------------------------

export function generateTemplate(): ArrayBuffer {
  const wb = XLSX.utils.book_new();

  // Clients sheet
  const clientHeaders = [
    "Nombre", "RUC/Cédula", "Tipo", "Contacto", "Teléfono", "Email", "Observaciones",
  ];
  const clientExample = [
    "Empresa ABC, S.A.", "1234567-1-890", "Jurídica", "Juan Pérez", "+507 6000-0000", "contacto@empresa.com", "Cliente referido",
  ];
  const clientSheet = XLSX.utils.aoa_to_sheet([clientHeaders, clientExample]);

  // Set column widths
  clientSheet["!cols"] = [
    { wch: 30 }, { wch: 18 }, { wch: 12 }, { wch: 20 }, { wch: 18 }, { wch: 25 }, { wch: 30 },
  ];
  XLSX.utils.book_append_sheet(wb, clientSheet, "Clientes");

  // Cases sheet
  const caseHeaders = [
    "Cliente", "Descripción", "Clasificación", "Institución", "Responsable",
    "Fecha Apertura", "Estado", "Ubicación Física", "Observaciones", "Archivo Digital",
  ];
  const caseExample = [
    "Empresa ABC, S.A.", "Demanda laboral contra Empresa XYZ", "LABORAL", "Juzgado Primero Civil",
    "Daveiva", "01/04/2026", "Activo", "Estante 3, Carpeta 12", "Caso prioritario", "Sí",
  ];
  const caseSheet = XLSX.utils.aoa_to_sheet([caseHeaders, caseExample]);
  caseSheet["!cols"] = [
    { wch: 30 }, { wch: 40 }, { wch: 15 }, { wch: 25 }, { wch: 15 },
    { wch: 15 }, { wch: 12 }, { wch: 20 }, { wch: 30 }, { wch: 15 },
  ];
  XLSX.utils.book_append_sheet(wb, caseSheet, "Casos");

  return XLSX.write(wb, { bookType: "xlsx", type: "array" });
}
