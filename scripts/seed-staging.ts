/**
 * SEED DEL AMBIENTE DE STAGING — CRM Integra Legal
 * ============================================================================
 *
 *   npm run seed:staging
 *
 * QUÉ HACE
 *   Carga un juego completo de datos FICTICIOS en la base de staging: tenant,
 *   5 usuarios (los 4 roles), catálogos, el plan de cuentas real de Josuar
 *   (62 cuentas), 15 clientes, 30 casos, 20 gastos de trámite, 7 cotizaciones
 *   y 8 facturas en distintos estados, más tareas y pendientes.
 *
 * POR QUÉ ES IDEMPOTENTE Y CÓMO
 *   Correrlo dos veces NO duplica nada. Cada fila tiene un UUID DETERMINÍSTICO
 *   derivado (UUIDv5 sobre un namespace fijo) de su clave natural: el estado
 *   "En trámite" siempre es el mismo UUID, corras el seed una vez o veinte.
 *   Eso ataca de raíz el bug que arrastramos en producción (cat_statuses con
 *   7 filas donde debía haber 2, por correr un script de carga tres veces —
 *   ver sql/pending/fix-duplicate-statuses-2026-08-23.sql). Sin clave natural
 *   estable, un seed "idempotente" con INSERT ... NOT EXISTS igual duplica en
 *   cuanto cambia una tilde.
 *
 *   Excepción documentada: COTIZACIONES y FACTURAS se crean solo si no
 *   existen; si ya están, se dejan como están y no se re-escriben. Motivo:
 *   los triggers T1/T2/T4/T5b/T5c del módulo Finanzas prohíben modificar
 *   líneas y campos de un documento que ya salió de 'borrador', y prohíben
 *   transiciones de estado no whitelisteadas. Un upsert ciego reventaría en
 *   la segunda corrida. Para regenerarlas hay que resetear la base (ver
 *   sop.md).
 *
 * PROTECCIÓN CONTRA CORRERLO EN PRODUCCIÓN
 *   Dos candados independientes, ambos deben pasar:
 *     1. El project ref de la URL de Supabase NO puede estar en la lista de
 *        producción de abajo.
 *     2. NEXT_PUBLIC_APP_ENV debe valer 'staging' o 'local'.
 *   Si alguno falla, el script aborta sin escribir una sola fila.
 *
 * DATOS PERSONALES
 *   Cero datos de clientes reales (Ley 81 de 2019). Ver el encabezado de
 *   scripts/seed-data/staging-fixtures.ts.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import * as dotenv from "dotenv";
import { resolve } from "path";

import { JOSUAR_ACCOUNTS } from "../src/lib/finanzas/reports/__tests__/josuar-accounts.fixture";
import {
  SEED_CASES,
  SEED_CLASSIFICATIONS,
  SEED_CLIENTS,
  SEED_EXPENSES,
  SEED_INSTITUTIONS,
  SEED_INVOICES,
  SEED_QUOTES,
  SEED_STATUSES,
  SEED_TASKS,
  SEED_TODOS,
  SEED_USERS,
  TAX_RATE,
  TENANT_ID,
  TENANT_NAME,
  TENANT_SLUG,
  type SeedLine,
} from "./seed-data/staging-fixtures";

dotenv.config({ path: resolve(__dirname, "../.env.local") });

// ===========================================================================
// CANDADO ANTI-PRODUCCIÓN
// ===========================================================================

/**
 * Project refs de Supabase que son PRODUCCIÓN. El seed se niega a tocarlos.
 * El ref no es secreto: viaja en NEXT_PUBLIC_SUPABASE_URL a todo navegador
 * que abre la app. Está acá justamente para poder compararlo.
 */
const PROD_PROJECT_REFS = ["uqmmkklbhzxqybljiecs"];

function projectRefOf(url: string): string {
  try {
    return new URL(url).hostname.split(".")[0];
  } catch {
    return "";
  }
}

function abort(msg: string): never {
  console.error(`\n❌ ABORTADO — ${msg}\n`);
  process.exit(1);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const APP_ENV = process.env.NEXT_PUBLIC_APP_ENV ?? "";

function guard(): void {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    abort(
      "faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local."
    );
  }

  const ref = projectRefOf(SUPABASE_URL);
  if (PROD_PROJECT_REFS.includes(ref)) {
    abort(
      `el proyecto Supabase "${ref}" es PRODUCCIÓN.\n` +
        `   Este script NUNCA corre contra la base real del bufete.\n` +
        `   Apuntá .env.local a staging antes de intentarlo de nuevo.`
    );
  }

  if (APP_ENV !== "staging" && APP_ENV !== "local") {
    abort(
      `NEXT_PUBLIC_APP_ENV vale "${APP_ENV || "(vacío)"}" y debe ser "staging" o "local".\n` +
        `   Es el segundo candado: sin él no se escribe nada.`
    );
  }

  console.log(`🔒 Candados OK — proyecto "${ref}", entorno "${APP_ENV}".`);
}

// ===========================================================================
// UUID DETERMINÍSTICO (UUIDv5, namespace propio del seed)
// ===========================================================================

const SEED_NAMESPACE = "7f3c9a10-4d2b-5e88-9c41-0b6a2f1d8e70";
const NS_BYTES = Buffer.from(SEED_NAMESPACE.replace(/-/g, ""), "hex");

/** UUIDv5 de `name`. Mismo name → mismo UUID, siempre. */
function id(name: string): string {
  const hash = createHash("sha1")
    .update(Buffer.concat([NS_BYTES, Buffer.from(name, "utf8")]))
    .digest();
  const b = Buffer.from(hash.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50; // versión 5
  b[8] = (b[8] & 0x3f) | 0x80; // variante RFC 4122
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ===========================================================================
// DÍGITO VERIFICADOR
// ===========================================================================

/**
 * DV de 2 dígitos, determinístico, calculado con módulo 11 sobre los dígitos
 * del identificador fiscal.
 *
 * HONESTIDAD SOBRE QUÉ ES ESTO: para un RUC INVENTADO no existe un DV
 * "correcto" — el DV real lo asigna la DGI y no hay forma de verificarlo
 * contra un RUC que no existe. Lo que esta función garantiza es lo que
 * necesitamos en staging: DV BIEN FORMADO (1-2 dígitos, que es lo que valida
 * validateFiscalFields en src/lib/clients/fiscal-fields.ts) y ESTABLE entre
 * corridas. No es un validador DGI y no debe usarse como tal en la app.
 */
function calcularDV(identificador: string): string {
  const digitos = identificador.replace(/\D/g, "");
  let suma = 0;
  for (let i = 0; i < digitos.length; i++) {
    const peso = ((digitos.length - i) % 9) + 2;
    suma += Number(digitos[i]) * peso;
  }
  const dv = (11 - (suma % 11)) % 11;
  return String(dv === 10 ? 0 : dv).padStart(2, "0");
}

// ===========================================================================
// HELPERS DE ESCRITURA
// ===========================================================================

let db: SupabaseClient;

async function upsert(
  table: string,
  rows: Record<string, unknown>[],
  onConflict = "id"
): Promise<void> {
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error } = await db.from(table).upsert(chunk, { onConflict });
    if (error) throw new Error(`upsert ${table}: ${error.message}`);
  }
}

async function exists(table: string, rowId: string): Promise<boolean> {
  const { data, error } = await db.from(table).select("id").eq("id", rowId).maybeSingle();
  if (error) throw new Error(`select ${table}: ${error.message}`);
  return data !== null;
}

function money(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Totales de un set de líneas, con la misma aritmética que las columnas generadas. */
function totals(lines: SeedLine[]) {
  let subtotal = 0;
  let tax = 0;
  for (const l of lines) {
    const s = l.quantity * l.unit_price;
    subtotal += s;
    tax += s * TAX_RATE[l.tax_code];
  }
  return { subtotal: money(subtotal), tax: money(tax), grand: money(subtotal + tax) };
}

// ===========================================================================
// PASOS DEL SEED
// ===========================================================================

async function seedTenant(): Promise<void> {
  await upsert("tenants", [{ id: TENANT_ID, name: TENANT_NAME, slug: TENANT_SLUG }]);
  console.log("✅ Tenant");
}

const userIds = new Map<string, string>();

async function seedUsers(): Promise<void> {
  // auth.users no acepta UUID arbitrario de forma portable entre versiones de
  // GoTrue, así que la clave natural acá es el EMAIL: se busca, y se crea o
  // se actualiza la contraseña. El id que devuelva auth manda para public.users.
  const { data: list, error: listErr } = await db.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (listErr) throw new Error(`listUsers: ${listErr.message}`);
  const byEmail = new Map(list.users.map((u) => [u.email?.toLowerCase() ?? "", u.id]));

  for (const u of SEED_USERS) {
    const existingId = byEmail.get(u.email.toLowerCase());
    if (existingId) {
      const { error } = await db.auth.admin.updateUserById(existingId, {
        password: u.password,
        email_confirm: true,
        user_metadata: { full_name: u.full_name },
      });
      if (error) throw new Error(`updateUser ${u.email}: ${error.message}`);
      userIds.set(u.key, existingId);
    } else {
      const { data, error } = await db.auth.admin.createUser({
        email: u.email,
        password: u.password,
        email_confirm: true,
        user_metadata: { full_name: u.full_name },
      });
      if (error || !data.user) {
        throw new Error(`createUser ${u.email}: ${error?.message ?? "sin user"}`);
      }
      userIds.set(u.key, data.user.id);
    }
  }

  await upsert(
    "users",
    SEED_USERS.map((u) => ({
      id: userIds.get(u.key),
      tenant_id: TENANT_ID,
      email: u.email,
      full_name: u.full_name,
      role: u.role,
      active: true,
    }))
  );
  console.log(`✅ Usuarios (${SEED_USERS.length}) — 4 roles cubiertos`);
}

async function seedCatalogs(): Promise<void> {
  await upsert(
    "cat_statuses",
    SEED_STATUSES.map((name) => ({
      id: id(`status:${name}`),
      tenant_id: TENANT_ID,
      name,
      active: true,
    }))
  );

  await upsert(
    "cat_classifications",
    SEED_CLASSIFICATIONS.map((c) => ({
      id: id(`classification:${c.prefix}`),
      tenant_id: TENANT_ID,
      name: c.name,
      prefix: c.prefix,
      color: c.color,
      active: true,
    }))
  );

  await upsert(
    "cat_institutions",
    SEED_INSTITUTIONS.map((name) => ({
      id: id(`institution:${name}`),
      tenant_id: TENANT_ID,
      name,
      active: true,
    }))
  );

  await upsert(
    "cat_team",
    SEED_USERS.filter((u) => u.role === "abogada" || u.role === "asistente").map((u) => ({
      id: id(`team:${u.key}`),
      tenant_id: TENANT_ID,
      user_id: userIds.get(u.key),
      name: u.full_name,
      role: u.role,
      active: true,
    }))
  );

  console.log(
    `✅ Catálogos — ${SEED_STATUSES.length} estados, ${SEED_CLASSIFICATIONS.length} clasificaciones, ${SEED_INSTITUTIONS.length} instituciones`
  );
}

async function seedChartOfAccounts(): Promise<void> {
  // Los saldos de apertura REALES del bufete solo se cargan si se pide
  // explícitamente. Por defecto van en 0, para que todo lo que muestren los
  // reportes en staging venga de los montos redondos del seed y se pueda
  // validar a mano. La ESTRUCTURA (código, nombre, tipo, subcategoría) es
  // idéntica a producción en los dos modos.
  const conSaldos = process.env.SEED_SALDOS_REALES === "1";

  await upsert(
    "chart_of_accounts",
    JOSUAR_ACCOUNTS.map((a) => ({
      tenant_id: TENANT_ID,
      code: a.code,
      name: a.name,
      account_type: a.account_type,
      subcategoria: a.subcategoria,
      saldo_inicial: conSaldos ? a.saldo : 0,
      active: true,
    })),
    "tenant_id,code"
  );

  // Producción tiene las cuentas viejas de QuickBooks desactivadas: los
  // reportes filtran active=true y ven exactamente 62. Replicamos ese estado
  // sin borrar nada (services_catalog todavía referencia 4101 y 2201 por FK).
  const codigos = JOSUAR_ACCOUNTS.map((a) => a.code);
  const { error } = await db
    .from("chart_of_accounts")
    .update({ active: false })
    .eq("tenant_id", TENANT_ID)
    .not("code", "in", `(${codigos.join(",")})`);
  if (error) throw new Error(`desactivar cuentas legacy: ${error.message}`);

  console.log(
    `✅ Plan de cuentas — ${JOSUAR_ACCOUNTS.length} cuentas activas` +
      (conSaldos ? " CON saldos de apertura reales" : " con saldo inicial en 0")
  );
}

const clientIds = new Map<number, string>();

async function seedClients(): Promise<void> {
  const rows = SEED_CLIENTS.map((c) => {
    const clientNumber = `CLI-${String(c.n).padStart(3, "0")}`;
    const rowId = id(`client:${clientNumber}`);
    clientIds.set(c.n, rowId);
    const requiereDV = c.tipo_receptor_fe === "01" || c.tipo_receptor_fe === "03";
    return {
      id: rowId,
      tenant_id: TENANT_ID,
      client_number: clientNumber,
      name: c.name,
      // ruc y tax_id espejados: la emisión eFactura lee `tax_id ?? ruc`
      // y prefiere tax_id (ver src/lib/clients/ruc-sync.ts).
      ruc: c.ruc_base,
      tax_id: c.ruc_base,
      tax_id_type: c.client_type === "persona_juridica" ? "ruc" : "cedula",
      type: c.client_type === "persona_juridica" ? "Persona Jurídica" : "Persona Natural",
      client_type: c.client_type,
      client_status: c.client_status,
      tipo_receptor_fe: c.tipo_receptor_fe,
      digito_verificador: requiereDV ? calcularDV(c.ruc_base) : null,
      contact: c.contact,
      phone: c.phone,
      email: c.email,
      address: c.address,
      billing_address: c.address,
      client_since: c.client_since,
      responsible_lawyer_id: userIds.get(c.lawyer),
      observations: "Cliente ficticio de staging. No corresponde a ninguna persona real.",
    };
  });

  await upsert("clients", rows);
  console.log(`✅ Clientes (${rows.length}) — 8 jurídicas, 7 naturales`);
}

const caseIds = new Map<string, string>();

async function seedCases(): Promise<void> {
  const rows = SEED_CASES.map((c) => {
    const code = `${c.prefix}-${String(c.seq).padStart(3, "0")}`;
    const rowId = id(`case:${code}`);
    caseIds.set(code, rowId);
    return {
      id: rowId,
      tenant_id: TENANT_ID,
      client_id: clientIds.get(c.client),
      case_code: code,
      description: c.description,
      classification_id: id(`classification:${c.prefix}`),
      institution_id: c.institution ? id(`institution:${c.institution}`) : null,
      status_id: id(`status:${c.status}`),
      responsible_id: userIds.get(c.lawyer),
      assistant_id: c.withAssistant ? userIds.get("asistente") : null,
      opened_at: "2026-01-15",
      case_start_date: "2026-01-15",
      physical_location: `Archivador ${c.prefix} — gaveta ${Math.ceil(c.seq / 3)}`,
      has_digital_file: true,
      observations: null,
    };
  });

  await upsert("cases", rows);
  console.log(`✅ Casos (${rows.length}) — repartidos en ${SEED_CLASSIFICATIONS.length} clasificaciones`);
}

async function seedExpenses(): Promise<void> {
  const rows = SEED_EXPENSES.map((e, i) => ({
    id: id(`expense:${e.case}:${i}`),
    tenant_id: TENANT_ID,
    case_id: caseIds.get(e.case),
    amount: e.amount,
    concept: e.concept,
    date: e.date,
    expense_type: e.expense_type,
    registered_by: userIds.get("abogada"),
  }));

  await upsert("expenses", rows);
  const total = SEED_EXPENSES.reduce((s, e) => s + e.amount, 0);
  console.log(`✅ Gastos de trámite (${rows.length}) — total B/. ${total.toLocaleString("es-PA")}`);
}

async function seedTasks(): Promise<void> {
  await upsert(
    "tasks",
    SEED_TASKS.map((t, i) => ({
      id: id(`task:${t.case}:${i}`),
      tenant_id: TENANT_ID,
      case_id: caseIds.get(t.case),
      description: t.description,
      deadline: t.deadline,
      assigned_to: userIds.get(t.assignee),
      status: t.status,
      created_by: userIds.get("abogada"),
      completed_at: t.status === "cumplida" ? "2026-08-19T15:00:00Z" : null,
    }))
  );

  await upsert(
    "personal_todos",
    SEED_TODOS.map((t, i) => ({
      id: id(`todo:${t.user}:${i}`),
      tenant_id: TENANT_ID,
      user_id: userIds.get(t.user),
      assigned_to: userIds.get(t.user),
      description: t.description,
      deadline: t.deadline,
      status: t.status,
    }))
  );

  console.log(`✅ Tareas (${SEED_TASKS.length}) y pendientes personales (${SEED_TODOS.length})`);
}

// --- Finanzas -------------------------------------------------------------
// Los documentos SIEMPRE se crean en 'borrador', se les insertan las líneas
// (los triggers T8a/T8b recalculan totales solos) y recién ahí se los avanza
// de estado por transiciones whitelisteadas. Cualquier otro orden choca con
// los triggers de inmutabilidad.

const QUOTE_PATH: Record<string, string[]> = {
  borrador: [],
  emitida: ["emitida"],
  enviada: ["emitida", "enviada"],
  aceptada: ["emitida", "enviada", "aceptada"],
  rechazada: ["emitida", "enviada", "rechazada"],
  expirada: ["emitida", "enviada", "expirada"],
  cancelada_pre_envio: ["cancelada_pre_envio"],
};

const INVOICE_PATH: Record<string, string[]> = {
  borrador: [],
  emitida: ["emitida"],
  parcialmente_pagada: ["emitida", "parcialmente_pagada"],
  pagada: ["emitida", "pagada"],
  anulada: ["emitida", "anulada"],
  cancelada_pre_emision: ["cancelada_pre_emision"],
};

async function advance(table: string, rowId: string, path: string[]): Promise<void> {
  for (const status of path) {
    const { error } = await db.from(table).update({ status }).eq("id", rowId);
    if (error) throw new Error(`${table} → ${status}: ${error.message}`);
  }
}

async function seedLines(
  table: "quote_lines" | "invoice_lines",
  parentKey: "quote_id" | "invoice_id",
  parentId: string,
  lines: SeedLine[],
  serviceIds: Map<string, string>,
  taxCodeIds: Map<string, string>
): Promise<void> {
  const rows = lines.map((l, i) => ({
    id: id(`${table}:${parentId}:${i}`),
    tenant_id: TENANT_ID,
    [parentKey]: parentId,
    line_order: i,
    service_id: serviceIds.get(l.service) ?? null,
    description: l.description,
    quantity: l.quantity,
    unit_price: l.unit_price,
    tax_code: l.tax_code,
    tax_rate: TAX_RATE[l.tax_code],
    tax_code_id: taxCodeIds.get(l.tax_code) ?? null,
    created_by: userIds.get("abogada"),
    ...(table === "quote_lines" ? { invoice_kind: l.invoice_kind } : {}),
  }));

  const { error } = await db.from(table).insert(rows);
  if (error) throw new Error(`insert ${table}: ${error.message}`);
}

const quoteIds = new Map<number, string>();

async function seedFinanzas(): Promise<void> {
  // Los catálogos de servicios e impuestos vienen sembrados por la migración
  // 20260505000002; acá solo se resuelven sus ids.
  const { data: services, error: sErr } = await db
    .from("services_catalog")
    .select("id, code")
    .eq("tenant_id", TENANT_ID);
  if (sErr) throw new Error(`services_catalog: ${sErr.message}`);
  const serviceIds = new Map((services ?? []).map((s) => [s.code as string, s.id as string]));

  const { data: taxes, error: tErr } = await db
    .from("tax_codes")
    .select("id, code")
    .eq("tenant_id", TENANT_ID);
  if (tErr) throw new Error(`tax_codes: ${tErr.message}`);
  const taxCodeIds = new Map((taxes ?? []).map((t) => [t.code as string, t.id as string]));

  if (serviceIds.size === 0 || taxCodeIds.size === 0) {
    abort(
      "services_catalog o tax_codes están vacíos. Falta aplicar la migración\n" +
        "   20260505000002_finanzas_catalogos.sql en esta base antes de sembrar."
    );
  }

  // --- Cotizaciones ---
  let quotesNuevas = 0;
  for (const q of SEED_QUOTES) {
    const number = `COT-${String(q.n).padStart(6, "0")}`;
    const rowId = id(`quote:${number}`);
    quoteIds.set(q.n, rowId);
    if (await exists("quotes", rowId)) continue;

    const t = totals(q.lines);
    const enviada = ["enviada", "aceptada", "rechazada", "expirada"].includes(q.status);
    const cliente = SEED_CLIENTS.find((c) => c.n === q.client)!;

    const { error } = await db.from("quotes").insert({
      id: rowId,
      tenant_id: TENANT_ID,
      quote_number: number,
      client_id: clientIds.get(q.client),
      case_id: q.case ? caseIds.get(q.case) : null,
      title: q.title,
      issue_date: q.issue_date,
      valid_until: q.valid_until,
      status: "borrador",
      currency: "USD",
      created_by: userIds.get("abogada"),
      public_token: enviada ? id(`quote-token:${number}`).replace(/-/g, "") : null,
      sent_at: enviada ? `${q.issue_date}T14:00:00Z` : null,
      sent_to_email: enviada ? cliente.email : null,
      sent_by: enviada ? userIds.get("abogada") : null,
      rejection_reason:
        q.status === "rechazada" ? "El cliente contrató a otro despacho." : null,
      cancellation_reason:
        q.status === "cancelada_pre_envio" ? "Se cotizó al cliente equivocado." : null,
    });
    if (error) throw new Error(`insert quote ${number}: ${error.message}`);

    await seedLines("quote_lines", "quote_id", rowId, q.lines, serviceIds, taxCodeIds);
    await advance("quotes", rowId, QUOTE_PATH[q.status]);

    // Chequeo de que los triggers de recálculo dieron lo que esperábamos.
    const { data: check } = await db
      .from("quotes")
      .select("grand_total")
      .eq("id", rowId)
      .single();
    if (check && Number(check.grand_total) !== t.grand) {
      console.warn(
        `   ⚠️  ${number}: grand_total en BD ${check.grand_total} ≠ esperado ${t.grand}`
      );
    }
    quotesNuevas++;
  }
  console.log(
    `✅ Cotizaciones — ${quotesNuevas} nuevas, ${SEED_QUOTES.length - quotesNuevas} ya existían`
  );

  // --- Facturas ---
  let facturasNuevas = 0;
  for (const inv of SEED_INVOICES) {
    const prefix = inv.kind === "HONORARIOS" ? "FAC-HON" : "FAC-REI";
    const number = `${prefix}-${String(inv.n).padStart(6, "0")}`;
    const rowId = id(`invoice:${number}`);
    if (await exists("invoices", rowId)) continue;

    const { error } = await db.from("invoices").insert({
      id: rowId,
      tenant_id: TENANT_ID,
      invoice_number: number,
      invoice_kind: inv.kind,
      quote_id: inv.quote ? quoteIds.get(inv.quote) : null,
      client_id: clientIds.get(inv.client),
      case_id: inv.case ? caseIds.get(inv.case) : null,
      issue_date: inv.issue_date,
      due_date: inv.due_date,
      status: "borrador",
      currency: "USD",
      amount_paid: inv.amount_paid,
      created_by: userIds.get("abogada"),
      cancellation_reason: inv.cancellation_reason ?? null,
      cancelled_at: inv.status === "anulada" ? `${inv.due_date}T16:00:00Z` : null,
    });
    if (error) throw new Error(`insert invoice ${number}: ${error.message}`);

    await seedLines("invoice_lines", "invoice_id", rowId, inv.lines, serviceIds, taxCodeIds);
    await advance("invoices", rowId, INVOICE_PATH[inv.status]);

    const t = totals(inv.lines);
    if (inv.amount_paid > t.grand) {
      console.warn(
        `   ⚠️  ${number}: amount_paid ${inv.amount_paid} > grand_total ${t.grand}`
      );
    }
    facturasNuevas++;
  }
  console.log(
    `✅ Facturas — ${facturasNuevas} nuevas, ${SEED_INVOICES.length - facturasNuevas} ya existían`
  );

  // --- Secuencias ---
  // Se dejan justo por encima del último número usado, para que el próximo
  // documento creado desde la UI no choque con el UNIQUE (tenant, number).
  await upsert(
    "numbering_sequences",
    [
      { tenant_id: TENANT_ID, sequence_type: "quote", last_number: Math.max(...SEED_QUOTES.map((q) => q.n)) },
      { tenant_id: TENANT_ID, sequence_type: "invoice_hon", last_number: Math.max(...SEED_INVOICES.filter((i) => i.kind === "HONORARIOS").map((i) => i.n)) },
      { tenant_id: TENANT_ID, sequence_type: "invoice_reim", last_number: Math.max(...SEED_INVOICES.filter((i) => i.kind === "REEMBOLSO").map((i) => i.n)) },
      { tenant_id: TENANT_ID, sequence_type: "credit_note", last_number: 0 },
      { tenant_id: TENANT_ID, sequence_type: "client", last_number: SEED_CLIENTS.length },
    ],
    "tenant_id,sequence_type"
  );
  console.log("✅ Secuencias de numeración alineadas con los datos sembrados");
}

// ===========================================================================
// RESUMEN
// ===========================================================================

async function resumen(): Promise<void> {
  const tablas = [
    "users",
    "clients",
    "cases",
    "expenses",
    "tasks",
    "personal_todos",
    "quotes",
    "quote_lines",
    "invoices",
    "invoice_lines",
    "chart_of_accounts",
  ];

  console.log("\n┌─ CONTEO FINAL EN STAGING ────────────────");
  for (const t of tablas) {
    const { count, error } = await db
      .from(t)
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", TENANT_ID);
    console.log(`│ ${t.padEnd(20)} ${error ? `error: ${error.message}` : count}`);
  }
  console.log("└──────────────────────────────────────────");

  console.log("\n┌─ USUARIOS DE PRUEBA ─────────────────────");
  for (const u of SEED_USERS) {
    console.log(`│ ${u.role.padEnd(10)} ${u.email.padEnd(26)} ${u.password}`);
  }
  console.log("└──────────────────────────────────────────");
}

// ===========================================================================
// MAIN
// ===========================================================================

async function main(): Promise<void> {
  console.log("\n🌱 SEED DE STAGING — CRM Integra Legal\n");
  guard();

  db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  await seedTenant();
  await seedUsers();
  await seedCatalogs();
  await seedChartOfAccounts();
  await seedClients();
  await seedCases();
  await seedExpenses();
  await seedTasks();
  await seedFinanzas();
  await resumen();

  console.log("\n✅ Seed completo. Correrlo de nuevo no duplica nada.\n");
}

main().catch((err) => {
  console.error(`\n❌ Falló el seed: ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
