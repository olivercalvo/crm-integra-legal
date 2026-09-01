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
import { PROD_PROJECT_REFS, projectRefOf } from "../src/lib/env/app-env";
import { inicioPeriodoFiscal } from "../src/lib/finanzas/contabilidad/periodo-fiscal";
import { verificarAmountPaidDerivado } from "../src/lib/finanzas/integridad/verificar-amount-paid";
import {
  SEED_CASES,
  SEED_CLASSIFICATIONS,
  SEED_CLIENTS,
  SEED_EXPENSES,
  SEED_INSTITUTIONS,
  SEED_INVOICES,
  SEED_PAYMENTS,
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

// PROD_PROJECT_REFS y projectRefOf viven en src/lib/env/app-env.ts: la misma
// lista que usa la banda de entorno de la app para decidir si está en
// producción. Una sola fuente, para que no se puedan desincronizar.

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
  if ((PROD_PROJECT_REFS as readonly string[]).includes(ref)) {
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
    // CRÍTICO: `app_metadata.user_role` y `app_metadata.tenant_id`.
    // El middleware (src/middleware.ts:229) autoriza leyendo de ahí, y los
    // helpers de RLS (public.tenant_id / public.user_role) leen el claim
    // `app_metadata` del JWT. Sin esto el login entra y rebota al instante a
    // /login?error=no-role: pasó tal cual la primera vez que se probó esto en
    // staging. Mismo shape que usa /api/admin/users al crear un usuario real.
    const metadata = {
      app_metadata: { user_role: u.role, tenant_id: TENANT_ID },
      user_metadata: { full_name: u.full_name, role: u.role, tenant_id: TENANT_ID },
    };

    if (existingId) {
      const { error } = await db.auth.admin.updateUserById(existingId, {
        password: u.password,
        email_confirm: true,
        ...metadata,
      });
      if (error) throw new Error(`updateUser ${u.email}: ${error.message}`);
      userIds.set(u.key, existingId);
    } else {
      const { data, error } = await db.auth.admin.createUser({
        email: u.email,
        password: u.password,
        email_confirm: true,
        ...metadata,
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

/**
 * Deja en un catálogo SOLO las filas que siembra este script.
 *
 * Hace falta porque las migraciones **también** siembran catálogos:
 * `20260402000002_seed_data.sql` mete estados, clasificaciones e instituciones;
 * `005_add_familia_classification.sql` y `add_extrajudicial_classification.sql`
 * agregan dos más. Ninguno de esos INSERT tiene una clave natural única, así
 * que quedan al lado de los del seed en vez de pisarlos: 5 estados donde debía
 * haber 2 ("Cerrado" y "En trámite" duplicados), 18 clasificaciones donde
 * debía haber 9 ("Civil" y "CIVIL"), 10 instituciones donde debía haber 5.
 *
 * Es el MISMO mecanismo que produjo el incidente de producción que arregló
 * `sql/pending/fix-duplicate-statuses-2026-08-23.sql`. Los UUID determinísticos
 * evitan que el seed se duplique a sí mismo, pero no lo protegen de lo que
 * sembró otro. Por eso hay que reconciliar de verdad.
 *
 * Las filas ajenas se borran si nadie las referencia. Si algún caso apunta a
 * una, se desactiva en vez de borrarla y se avisa: perder el dato de un caso
 * para dejar el catálogo prolijo sería el trueque equivocado.
 */
async function reconciliarCatalogo(
  tabla: "cat_statuses" | "cat_classifications" | "cat_institutions",
  columnaEnCases: "status_id" | "classification_id" | "institution_id",
  idsPropios: string[]
): Promise<void> {
  const { data: ajenas, error } = await db
    .from(tabla)
    .select("id, name")
    .eq("tenant_id", TENANT_ID)
    .not("id", "in", `(${idsPropios.join(",")})`);
  if (error) throw new Error(`select ${tabla}: ${error.message}`);
  if (!ajenas?.length) return;

  let borradas = 0;
  for (const fila of ajenas) {
    const { count, error: e2 } = await db
      .from("cases")
      .select("*", { count: "exact", head: true })
      .eq(columnaEnCases, fila.id);
    if (e2) throw new Error(`count cases.${columnaEnCases}: ${e2.message}`);

    if ((count ?? 0) > 0) {
      await db.from(tabla).update({ active: false }).eq("id", fila.id);
      console.warn(
        `   ⚠️  ${tabla}: "${fila.name}" tiene ${count} caso(s) apuntando. Se desactiva, no se borra.`
      );
      continue;
    }
    const { error: e3 } = await db.from(tabla).delete().eq("id", fila.id);
    if (e3) throw new Error(`delete ${tabla}: ${e3.message}`);
    borradas++;
  }
  if (borradas) {
    console.log(`   🧹 ${tabla}: ${borradas} fila(s) duplicada(s) por las migraciones, eliminadas`);
  }
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

  // Recién ahora, con las filas propias ya escritas, se limpia lo que sembraron
  // las migraciones. El orden importa: primero crear, después reconciliar.
  await reconciliarCatalogo("cat_statuses", "status_id", SEED_STATUSES.map((n) => id(`status:${n}`)));
  await reconciliarCatalogo("cat_classifications", "classification_id", SEED_CLASSIFICATIONS.map((c) => id(`classification:${c.prefix}`)));
  await reconciliarCatalogo("cat_institutions", "institution_id", SEED_INSTITUTIONS.map((n) => id(`institution:${n}`)));

  console.log(
    `✅ Catálogos — ${SEED_STATUSES.length} estados, ${SEED_CLASSIFICATIONS.length} clasificaciones, ${SEED_INSTITUTIONS.length} instituciones`
  );
}

/**
 * Cuentas del plan que NO están en el export del 14/08 porque se crearon
 * después. Se siembran junto a las 62 de Josuar para que staging refleje el
 * plan VIGENTE, no la foto de agosto.
 *
 * `sql/pending/025` también las inserta, pero la migración no alcanza: en un
 * `--reset` las migraciones corren ANTES que el seed, cuando la tabla todavía
 * no tiene el plan de Josuar. Sin esta lista, el barrido de "desactivar todo lo
 * que no sea de Josuar" de más abajo apagaría la cuenta recién creada.
 */
const CUENTAS_FASE1 = [
  {
    code: "200004",
    name: "Anticipo de Clientes",
    account_type: "liability" as const,
    subcategoria: "pasivo_corriente" as const,
    saldo: 0,
  },
  {
    // Sociedad civil: destino del reparto del resultado. Nace y se queda en 0
    // porque el renglón de distribución del Estado de Resultado es CALCULADO
    // (= la utilidad neta con signo opuesto). Cargarle un saldo a mano lo
    // contaría dos veces. Código PROVISIONAL — ver sql/pending/026.
    code: "300004",
    name: "Distribución a Socias",
    account_type: "equity" as const,
    subcategoria: "patrimonio" as const,
    saldo: 0,
  },
];

/**
 * Cuentas CONTROL: su saldo tiene que cuadrar contra el detalle de un auxiliar.
 * Va acá y no solo en la migración por el mismo motivo de orden que arriba.
 */
/**
 * Fecha de los saldos de apertura sembrados: el inicio del período fiscal en
 * curso (Rose: el período va del 1 de enero al 31 de diciembre).
 *
 * ⚠️ Es la fecha que el cliente ESPECIFICÓ, no una fecha de corte verificada.
 * Los saldos cargados son en realidad una foto de mitad de año — ver el
 * encabezado de `sql/pending/027_saldo_inicial_fecha.sql`.
 */
const FECHA_SALDO_INICIAL = inicioPeriodoFiscal(2026);

const CUENTAS_CONTROL_POR_CODIGO: Record<string, "clientes" | "proveedores"> = {
  "100004": "clientes", // Cuentas por Cobrar Clientes
  "200001": "proveedores", // Cuentas por pagar
};

async function seedChartOfAccounts(): Promise<void> {
  // ---------------------------------------------------------------------------
  // SALDOS DE APERTURA REALES — decisión deliberada de Oliver (27/08/2026)
  // ---------------------------------------------------------------------------
  // Staging es un HÍBRIDO a propósito: operación inventada, saldos contables
  // reales. Clientes, casos, tareas y gastos son ficticios porque ahí SÍ hay
  // datos personales protegidos por la Ley 81. Los saldos del plan de cuentas
  // no: son cifras agregadas (bancos, por cobrar, totales de ingreso) sin
  // nombres, cédulas ni expedientes.
  //
  // Y son lo único que hace posible la metodología que pidió Rose ("avances por
  // módulo, lo probemos, corrijas o apruebes"): si el contador abre el Estado de
  // Resultado y ve números que no reconoce, no puede aprobar nada. Si ve los
  // suyos, dice "está bien" o "está mal" en dos minutos.
  //
  // SEED_SALDOS_CERO=1 para volver al comportamiento viejo (todo en 0).
  const enCero = process.env.SEED_SALDOS_CERO === "1";

  const plan = [
    ...JOSUAR_ACCOUNTS.map((a) => ({
      code: a.code,
      name: a.name,
      account_type: a.account_type,
      subcategoria: a.subcategoria,
      saldo: a.saldo,
    })),
    ...CUENTAS_FASE1,
  ];

  await upsert(
    "chart_of_accounts",
    plan.map((a) => ({
      tenant_id: TENANT_ID,
      code: a.code,
      name: a.name,
      account_type: a.account_type,
      subcategoria: a.subcategoria,
      cuenta_control: CUENTAS_CONTROL_POR_CODIGO[a.code] ?? null,
      saldo_inicial: enCero ? 0 : a.saldo,
      // Un saldo sin fecha no dice nada, y desde la Tarea 5 el CHECK
      // `coa_saldo_inicial_requiere_fecha` lo exige. Se usa el inicio del
      // período fiscal, que es la regla que dio Rose (1 de enero a 31 de
      // diciembre). Ver la consulta pendiente sobre la fecha de corte real en
      // sql/pending/027.
      saldo_inicial_fecha:
        enCero || a.saldo === 0 ? null : FECHA_SALDO_INICIAL,
      active: true,
    })),
    "tenant_id,code"
  );

  // Producción tiene las cuentas viejas de QuickBooks desactivadas: los
  // reportes filtran active=true y no las ven. Replicamos ese estado sin borrar
  // nada (services_catalog todavía referencia 4101 y 2201 por FK).
  const codigos = plan.map((a) => a.code);
  const { error } = await db
    .from("chart_of_accounts")
    .update({ active: false })
    .eq("tenant_id", TENANT_ID)
    .not("code", "in", `(${codigos.join(",")})`);
  if (error) throw new Error(`desactivar cuentas legacy: ${error.message}`);

  console.log(
    `✅ Plan de cuentas — ${plan.length} cuentas activas ` +
      `(${JOSUAR_ACCOUNTS.length} de Josuar + ${CUENTAS_FASE1.length} de Fase 1), ` +
      (enCero ? "saldo inicial en 0" : "CON saldos de apertura reales")
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

/**
 * Hasta dónde empuja el seed cada factura A MANO.
 *
 * Ojo con `parcialmente_pagada` y `pagada`: el camino termina en `emitida`, y NO
 * es un descuido. Esos dos estados los produce el trigger T7a cuando se aplica
 * el pago correspondiente de `SEED_PAYMENTS`. Empujarlos a mano acá dejaría una
 * factura marcada "pagada" sin un pago detrás — exactamente el desfase del
 * 28/08/2026 que motivó la migración 032.
 *
 * `anulada` sí se empuja a mano: no sale de los pagos, es una decisión.
 *
 * `SeedInvoice.status` queda como el estado ESPERADO al final de todo, y
 * `verificarEstadosDeFactura()` comprueba que se haya alcanzado.
 */
/** El número que le toca a una factura del fixture. Una sola definición. */
function numeroDeFactura(inv: { kind: string; n: number }): string {
  return `${inv.kind === "HONORARIOS" ? "FAC-HON" : "FAC-REI"}-${String(inv.n).padStart(6, "0")}`;
}

const ESTADO_BASE: Record<string, string[]> = {
  borrador: [],
  emitida: ["emitida"],
  parcialmente_pagada: ["emitida"], // T7a la completa al aplicarse el pago
  pagada: ["emitida"], //              ídem
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
    // `subtotal`, `tax_amount` y `line_total` NO se escriben: en las dos tablas
    // son GENERATED ALWAYS y las calcula la base. La sección 5 de
    // 20260508000002 las convertía en columnas comunes, pero esa sección nunca
    // se aplicó en producción y por eso tampoco se aplica en staging (ver
    // scripts/staging-fixups.mjs, FIXUP 2). Escribirlas daría error.
    //
    // Lo que sí escribe el seed es `quotes.subtotal_hon` / `subtotal_rei`, más
    // arriba: esas las calcula la APLICACIÓN, no la base
    // (src/lib/finanzas/api/quotes.ts:601, 796, 928).
    //
    // OJO: las dos tablas usan vocabularios distintos para lo mismo.
    //   quote_lines.invoice_kind → CHECK IN ('HON','REI')
    //     (20260508000002_quotes_extension_and_terms_template.sql:129)
    //   invoices.invoice_kind    → CHECK IN ('HONORARIOS','REEMBOLSO')
    //     (20260505000004_finanzas_b3b_invoices.sql)
    // El fixture usa el nombre largo y acá se abrevia para la línea.
    ...(table === "quote_lines"
      ? { invoice_kind: l.invoice_kind === "HONORARIOS" ? "HON" : "REI" }
      : {}),
  }));

  const { error } = await db.from(table).insert(rows);
  if (error) throw new Error(`insert ${table}: ${error.message}`);
}

type EstadoDoc = "completo" | "sin-lineas" | "no-existe";

/**
 * En qué estado está el documento antes de tocarlo.
 *
 * La cabecera y las líneas se insertan en dos llamadas distintas: si la primera
 * pasa y la segunda falla, queda un documento sin líneas y con totales en 0. Y
 * como el seed saltea lo que ya existe, ese documento roto quedaría así para
 * siempre. Pasó de verdad la primera corrida contra staging, por el CHECK de
 * `quote_lines.invoice_kind`.
 *
 * La reparación es AGREGAR las líneas que faltan, no borrar y rehacer. Borrar
 * no siempre se puede, y con razón: al intentar borrar COT-000001 el trigger T4
 * lo frenó porque dos facturas PAGADAS la referencian por `quote_id`, y borrarla
 * les habría cambiado ese campo (ON DELETE SET NULL) a documentos inmutables.
 * Los triggers hicieron exactamente lo que tienen que hacer.
 */
async function estadoDocumento(
  tabla: "quotes" | "invoices",
  tablaLineas: "quote_lines" | "invoice_lines",
  claveLinea: "quote_id" | "invoice_id",
  rowId: string,
  numero: string
): Promise<EstadoDoc> {
  const { data, error } = await db.from(tabla).select("id, status").eq("id", rowId).maybeSingle();
  if (error) throw new Error(`select ${tabla}: ${error.message}`);
  if (!data) return "no-existe";

  const { count, error: e2 } = await db
    .from(tablaLineas)
    .select("*", { count: "exact", head: true })
    .eq(claveLinea, rowId);
  if (e2) throw new Error(`count ${tablaLineas}: ${e2.message}`);
  if ((count ?? 0) > 0) return "completo";

  // Sin líneas. Solo se pueden insertar mientras el documento esté en
  // 'borrador' (triggers T5b/T5c).
  const editable =
    data.status === "borrador" ||
    (tabla === "invoices" && data.status === "cancelada_pre_emision");
  if (!editable) {
    console.warn(
      `   ⚠️  ${numero} existe SIN líneas y está en "${data.status}": las líneas ya no se pueden insertar (T5b/T5c). Revisar a mano.`
    );
    return "completo";
  }

  console.log(`   ♻️  ${numero} estaba sin líneas (corrida anterior cortada): se completan`);
  return "sin-lineas";
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
    const estado = await estadoDocumento("quotes", "quote_lines", "quote_id", rowId, number);
    if (estado === "completo") continue;

    const t = totals(q.lines);
    const enviada = ["enviada", "aceptada", "rechazada", "expirada"].includes(q.status);
    const cliente = SEED_CLIENTS.find((c) => c.n === q.client)!;

    if (estado === "no-existe") {
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
    }

    try {
      await seedLines("quote_lines", "quote_id", rowId, q.lines, serviceIds, taxCodeIds);
    } catch (err) {
      // Si la cabecera es de esta corrida se intenta limpiar; si no se puede
      // (hay facturas que la referencian), se deja y la próxima corrida la
      // completa. El error original se propaga igual.
      if (estado === "no-existe") await db.from("quotes").delete().eq("id", rowId);
      throw err;
    }
    // El split HON/REI de la cabecera lo llenaba el trigger T8b-quote, que NO
    // está en el repo (finanzas_recalc_one_quote_totals, el que sí está, solo
    // llena subtotal_total / tax_total / grand_total). Se escribe acá, mientras
    // la cotización todavía está en 'borrador'.
    const hon = money(
      q.lines.filter((l) => l.invoice_kind === "HONORARIOS").reduce((s, l) => s + l.quantity * l.unit_price, 0)
    );
    const rei = money(
      q.lines.filter((l) => l.invoice_kind === "REEMBOLSO").reduce((s, l) => s + l.quantity * l.unit_price, 0)
    );
    const { error: eSplit } = await db
      .from("quotes")
      .update({ subtotal_hon: hon, subtotal_rei: rei })
      .eq("id", rowId);
    if (eSplit) throw new Error(`split HON/REI ${number}: ${eSplit.message}`);

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
    const number = numeroDeFactura(inv);
    const rowId = id(`invoice:${number}`);
    const estadoInv = await estadoDocumento("invoices", "invoice_lines", "invoice_id", rowId, number);
    if (estadoInv === "completo") continue;

    if (estadoInv === "no-existe") {
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
      // `amount_paid` NO se escribe: nace en 0 (DEFAULT de la columna) y sube
      // solo cuando se le aplica un pago. Desde la migración 032 el guard T4b
      // rechaza el INSERT que traiga otra cosa. Ver `seedPayments()`.
      created_by: userIds.get("abogada"),
      cancellation_reason: inv.cancellation_reason ?? null,
      cancelled_at: inv.status === "anulada" ? `${inv.due_date}T16:00:00Z` : null,
    });
    if (error) throw new Error(`insert invoice ${number}: ${error.message}`);
    }

    try {
      await seedLines("invoice_lines", "invoice_id", rowId, inv.lines, serviceIds, taxCodeIds);
    } catch (err) {
      if (estadoInv === "no-existe") await db.from("invoices").delete().eq("id", rowId);
      throw err;
    }
    await advance("invoices", rowId, ESTADO_BASE[inv.status]);
    facturasNuevas++;
  }
  console.log(
    `✅ Facturas — ${facturasNuevas} nuevas, ${SEED_INVOICES.length - facturasNuevas} ya existían`
  );

  await seedPayments();

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
// PAGOS — y con ellos, `amount_paid` y los estados de cobro
// ===========================================================================

/**
 * Siembra los pagos de `SEED_PAYMENTS` y deja que T7a haga el resto.
 *
 * Ninguna línea de acá escribe `invoices.amount_paid` ni lleva una factura a
 * `pagada` / `parcialmente_pagada`: eso lo hace el trigger T7a al insertarse la
 * `payment_application`. Es el punto entero del cambio del 2026-09-01 — mientras
 * el seed escribía el número a mano, podía (y llegó a) contradecir a los pagos.
 *
 * Idempotente por id determinístico, como todo el resto del seed.
 */
async function seedPayments(): Promise<void> {
  let nuevos = 0;
  const facturaPorNumero = new Map(SEED_INVOICES.map((i) => [numeroDeFactura(i), i]));

  for (const p of SEED_PAYMENTS) {
    const declarada = facturaPorNumero.get(p.invoice);
    if (!declarada) {
      throw new Error(
        `el pago "${p.clave}" apunta a la factura ${p.invoice}, que no está en SEED_INVOICES.`
      );
    }
    const invoiceId = id(`invoice:${p.invoice}`);

    const { data: factura, error: errInv } = await db
      .from("invoices")
      .select("id, invoice_number, status, grand_total")
      .eq("id", invoiceId)
      .maybeSingle();
    if (errInv) throw new Error(`pago ${p.clave} — leer ${p.invoice}: ${errInv.message}`);
    if (!factura) {
      throw new Error(
        `el pago "${p.clave}" apunta a la factura ${p.invoice}, que no existe. ` +
          `Revisar que esté en SEED_INVOICES.`
      );
    }
    if (p.amount > Number(factura.grand_total)) {
      throw new Error(
        `el pago "${p.clave}" es de ${p.amount} pero ${p.invoice} totaliza ${factura.grand_total}. ` +
          `T7a no lo rechaza, pero dejaría la factura sobre-cobrada.`
      );
    }

    const pagoId = id(`payment:${p.clave}`);
    const { data: existe, error: errSel } = await db
      .from("payments")
      .select("id")
      .eq("id", pagoId)
      .maybeSingle();
    if (errSel) throw new Error(`pago ${p.clave} — select: ${errSel.message}`);

    if (!existe) {
      const { error } = await db.from("payments").insert({
        id: pagoId,
        tenant_id: TENANT_ID,
        client_id: clientIds.get(declarada.client),
        payment_date: p.date,
        amount: p.amount,
        method: p.method,
        reference: p.reference,
        status: "registrado",
        created_by: userIds.get("abogada"),
      });
      if (error) throw new Error(`insert payment ${p.clave}: ${error.message}`);
      nuevos++;
    }

    // La aplicación. ACÁ es donde T7a recalcula `amount_paid` y transiciona el
    // status de la factura.
    const aplicacionId = id(`payment_application:${p.clave}`);
    const { data: existeApp, error: errApp } = await db
      .from("payment_applications")
      .select("id")
      .eq("id", aplicacionId)
      .maybeSingle();
    if (errApp) throw new Error(`aplicación ${p.clave} — select: ${errApp.message}`);

    if (!existeApp) {
      const { error } = await db.from("payment_applications").insert({
        id: aplicacionId,
        tenant_id: TENANT_ID,
        payment_id: pagoId,
        invoice_id: invoiceId,
        amount_applied: p.amount,
        created_by: userIds.get("abogada"),
      });
      if (error) throw new Error(`insert payment_application ${p.clave}: ${error.message}`);
    }
  }

  console.log(
    `✅ Pagos — ${nuevos} nuevos, ${SEED_PAYMENTS.length - nuevos} ya existían` +
      ` (T7a derivó \`amount_paid\` y el status de cada factura cobrada)`
  );
}

// ===========================================================================
// VERIFICACIONES DE CIERRE
// ===========================================================================

/**
 * El estado real de cada factura contra el que el fixture DECLARA esperar.
 *
 * Existe porque el seed dejó de empujar `pagada` / `parcialmente_pagada` a mano:
 * ahora los produce T7a. Si un pago falta, sobra o quedó por el monto
 * equivocado, la factura termina en otro estado y esto lo dice acá, con nombre y
 * apellido, en vez de dejarlo para que alguien lo note en una pantalla.
 */
async function verificarEstadosDeFactura(): Promise<void> {
  const { data, error } = await db
    .from("invoices")
    .select("invoice_number, status")
    .eq("tenant_id", TENANT_ID);
  if (error) throw new Error(`verificar estados: ${error.message}`);

  const real = new Map(((data ?? []) as { invoice_number: string; status: string }[]).map((f) => [f.invoice_number, f.status]));
  const malos: string[] = [];

  for (const inv of SEED_INVOICES) {
    const numero = numeroDeFactura(inv);
    const actual = real.get(numero);
    if (actual !== inv.status) {
      malos.push(`   · ${numero.padEnd(16)} esperado "${inv.status}" · real "${actual ?? "(no existe)"}"`);
    }
  }

  if (malos.length > 0) {
    console.error(
      `\n❌ ABORTADO — ${malos.length} factura(s) no quedaron en el estado que declara el fixture:\n` +
        `${malos.join("\n")}\n\n` +
        `   Los estados de cobro los produce T7a a partir de SEED_PAYMENTS. Si una\n` +
        `   factura esperaba "pagada" y quedó "emitida", le falta su pago; si esperaba\n` +
        `   "parcialmente_pagada" y quedó "pagada", el monto del pago es de más.\n`
    );
    process.exit(1);
  }

  console.log("🔎 Verificación: las 8 facturas quedaron en el estado que declara el fixture.");
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

  // CIERRE — que una siembra incoherente falle acá y no en una pantalla dentro
  // de seis días. Ver `sop.md` SOP-017.
  await verificarEstadosDeFactura();
  await verificarAmountPaidDerivado(db, TENANT_ID);

  await resumen();

  console.log("\n✅ Seed completo. Correrlo de nuevo no duplica nada.\n");
}

main().catch((err) => {
  console.error(`\n❌ Falló el seed: ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
