/**
 * SIEMBRA DE ASIENTOS DE PRUEBA EN STAGING
 * ============================================================================
 *
 *   npm run seed:asientos
 *
 * QUÉ HACE
 *   Siembra los DOCUMENTOS de respaldo que falten (gastos del bufete y cobros)
 *   y postea un juego representativo de asientos POR EL RPC
 *   `post_journal_entry`, para que el Libro Mayor tenga algo real que mostrar:
 *   cuentas con saldo inicial, movimientos de los dos lados, saldo corrido y
 *   el enlace al documento que originó cada renglón.
 *
 * ⚠️ LOS ASIENTOS SON INMUTABLES.
 *   Los triggers de `023` rechazan UPDATE y DELETE. Lo que este script escribe
 *   no se corrige: se resetea la base. Por eso los candados de abajo.
 *
 * ⚠️ NO CABLEA FACTURA → ASIENTO.
 *   Esto siembra asientos que IMITAN lo que haría ese cableado. El enganche
 *   automático (disparado por la emisión real) espera la validación de RM y NO
 *   se hizo.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * REGLA DE ORO: NINGÚN ASIENTO SIN DOCUMENTO QUE EXISTA
 * ═══════════════════════════════════════════════════════════════════════════
 * Todo `source_type` que aparezca acá tiene su documento de verdad en staging:
 *
 *   factura → `invoices` (ya sembradas por `seed:staging`; NO se crean acá)
 *   gasto   → `business_expenses` (las crea este script)
 *   pago    → `payments` + `payment_applications` (los crea este script)
 *   manual  → NINGUNO, y por eso su `source_id` va en NULL
 *
 * El asiento de diario es el único sin documento, porque un asiento manual NO
 * TIENE documento de origen: su origen es él mismo. Ponerle un `source_id`
 * sintético sería exactamente el error que este archivo aprendió a no cometer
 * (ver LECCIÓN abajo): un id que no resuelve a nada, indistinguible de un
 * enlace roto.
 *
 * Y LOS MONTOS SALEN DEL DOCUMENTO, NO AL REVÉS:
 *   · Las facturas ya existen, así que el asiento se ARMA desde la factura
 *     (`subtotal_total`, `tax_total`, `grand_total`). No se hardcodean montos:
 *     un asiento que dice "factura X" por un importe que no es el de X es un
 *     descuadre que después nadie sabe si es bug o dato de prueba.
 *   · Los gastos y los cobros los crea este script, así que ahí es al revés: se
 *     declara el asiento y el documento se DERIVA de él. En los dos casos hay
 *     una sola fuente de verdad por operación.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * LECCIÓN DEL 27/08/2026 — POR QUÉ EXISTE `verificarOrigenesHuerfanos()`
 * ═══════════════════════════════════════════════════════════════════════════
 * Este script corrió, y DESPUÉS se editó para cambiar de dónde sale el
 * `source_id` de los asientos de factura (de un UUIDv5 sintético al id de la
 * factura real). Como la idempotencia se apoya en `source_id`, la clave cambió
 * bajo los pies: los 3 asientos ya posteados dejaron de reconocerse, y una
 * segunda corrida los habría duplicado — contabilidad doble, imborrable, y sin
 * un solo mensaje de error.
 *
 * No se puede evitar que la clave cambie. Sí se puede DETECTARLO antes de
 * escribir: si en el ledger hay asientos de un tipo con documento cuyo
 * `source_id` no resuelve, algo se desalineó y sembrar encima es la peor
 * respuesta posible. El script aborta y pide un reset.
 *
 * POR QUÉ ES RE-EJECUTABLE Y CÓMO
 *   Un ledger es append-only: no se puede hacer upsert de un asiento. La
 *   idempotencia se logra por `source_id`, que es el id del documento real. Los
 *   documentos que crea este script usan UUIDv5 determinístico (mismo namespace
 *   que el resto del seed), así que su id es estable entre corridas.
 *
 *   Los asientos de diario, que no tienen documento, se reconocen por
 *   (source_type, descripción, fecha).
 *
 *   Correrlo dos veces NO duplica nada. Para empezar de cero:
 *   `node scripts/apply-staging-sql.mjs --reset` y volver a sembrar.
 *
 * PROTECCIÓN CONTRA CORRERLO EN PRODUCCIÓN
 *   Los mismos dos candados que `seed-staging.ts`, ambos deben pasar:
 *     1. El project ref de la URL de Supabase NO puede estar en la lista de
 *        producción.
 *     2. NEXT_PUBLIC_APP_ENV debe valer 'staging' o 'local'.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import * as dotenv from "dotenv";
import { resolve } from "path";

import { PROD_PROJECT_REFS, projectRefOf } from "../src/lib/env/app-env";
import { TENANT_ID } from "./seed-data/staging-fixtures";
import type { SourceType } from "../src/lib/finanzas/contabilidad/posting";

dotenv.config({ path: resolve(__dirname, "../.env.local") });

// ===========================================================================
// CANDADO ANTI-PRODUCCIÓN
// ===========================================================================

function abort(msg: string): never {
  console.error(`\n❌ ABORTADO — ${msg}\n`);
  process.exit(1);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const APP_ENV = process.env.NEXT_PUBLIC_APP_ENV ?? "";

function guard(): void {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    abort("faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local.");
  }
  const ref = projectRefOf(SUPABASE_URL);
  if ((PROD_PROJECT_REFS as readonly string[]).includes(ref)) {
    abort(
      `el proyecto Supabase "${ref}" es PRODUCCIÓN.\n` +
        `   Los asientos son INMUTABLES: uno de prueba en la base real no se puede borrar.`
    );
  }
  if (APP_ENV !== "staging" && APP_ENV !== "local") {
    abort(`NEXT_PUBLIC_APP_ENV vale "${APP_ENV || "(vacío)"}" y debe ser "staging" o "local".`);
  }
  console.log(`🔒 Candados OK — proyecto "${ref}", entorno "${APP_ENV}".`);
}

// ===========================================================================
// UUID DETERMINÍSTICO — mismo namespace y algoritmo que seed-staging.ts
// ===========================================================================

const SEED_NAMESPACE = "7f3c9a10-4d2b-5e88-9c41-0b6a2f1d8e70";
const NS_BYTES = Buffer.from(SEED_NAMESPACE.replace(/-/g, ""), "hex");

function id(name: string): string {
  const hash = createHash("sha1")
    .update(Buffer.concat([NS_BYTES, Buffer.from(name, "utf8")]))
    .digest();
  const b = Buffer.from(hash.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ===========================================================================
// CUENTAS QUE USA EL FIXTURE
// ===========================================================================

const CTA_BANCO = "100001"; // Banco General Operativa
const CTA_CXC = "100004"; // Cuentas por Cobrar Clientes  (cuenta_control: clientes)
const CTA_CXP = "200001"; // Cuentas por pagar            (cuenta_control: proveedores)
const CTA_ITBMS = "200003"; // ITBMS por Pagar

// ===========================================================================
// 1) FACTURAS — el documento YA EXISTE, el asiento se arma desde él
// ===========================================================================

interface FacturaOp {
  /** Número de la factura en staging. La siembra `seed:staging`. */
  numero: string;
  /**
   * Cuenta que recibe el crédito por el neto facturado.
   *
   * En HONORARIOS es la cuenta de ingreso del área del caso. En REEMBOLSO no
   * hay ingreso: el bufete recupera un costo que pagó por el cliente, así que
   * el crédito va contra la cuenta de costo que se está recuperando.
   *
   * ⚠️ El tratamiento del reembolso es una elección de ESTE FIXTURE para que
   * staging tenga el caso "factura sin ITBMS", no una regla contable
   * confirmada. Cuando se cablee factura→asiento de verdad, el criterio lo
   * define el contador.
   */
  cuentaNeto: string;
  glosaNeto: string;
}

const FACTURAS: FacturaOp[] = [
  { numero: "FAC-HON-000001", cuentaNeto: "400001", glosaNeto: "Honorarios — cambio de junta directiva" },
  // Sin ITBMS (REEMBOLSO exento): deja el asiento de DOS líneas, que es un
  // caso que ningún otro asiento del fixture cubre.
  { numero: "FAC-REI-000001", cuentaNeto: "500005", glosaNeto: "Reembolso — tasa de Registro Público" },
  { numero: "FAC-HON-000002", cuentaNeto: "400001", glosaNeto: "Honorarios — aumento de capital" },
  { numero: "FAC-HON-000003", cuentaNeto: "400006", glosaNeto: "Honorarios — recurso de reconsideración" },
];

// ===========================================================================
// 2) GASTOS DEL BUFETE — el asiento se declara, el documento se DERIVA
// ===========================================================================

interface GastoOp {
  clave: string;
  fecha: string;
  proveedor: string;
  descripcion: string;
  /**
   * Desglose del gasto por cuenta. La contrapartida (Cuentas por pagar) NO se
   * declara: se genera por la suma, así que el asiento no puede descuadrar ni
   * dejar de coincidir con el total del `business_expense`.
   */
  desglose: { code: string; monto: number; glosa?: string }[];
}

const GASTOS: GastoOp[] = [
  {
    clave: "gasto:alquiler-feb",
    fecha: "2026-02-01",
    proveedor: "INMOBILIARIA COSTA DEL ESTE, S.A.",
    descripcion: "Alquiler de oficina — febrero 2026",
    desglose: [{ code: "610001", monto: 1850, glosa: "Canon mensual" }],
  },
  {
    clave: "gasto:combustible-feb",
    fecha: "2026-02-22",
    proveedor: "ESTACIÓN DELTA VÍA ESPAÑA",
    descripcion: "Combustible de la flota — febrero 2026",
    desglose: [{ code: "610009", monto: 246.4 }],
  },
  // ---- VARIAS LÍNEAS CONTRA UNA SOLA CONTRAPARTIDA ------------------------
  // Tres gastos distintos, una sola cuenta por pagar. Desde cualquiera de los
  // gastos la contrapartida es inequívoca ("Cuentas por pagar"); desde la CxP
  // hay tres cuentas enfrente y ahí SÍ es ambigua. Es el caso que hace visible
  // la consulta 3.
  {
    clave: "gasto:paquete-marzo",
    fecha: "2026-03-15",
    proveedor: "DISTRIBUIDORA OFIPLUS, S.A.",
    descripcion: "Compra consolidada de insumos y servicios — marzo 2026",
    desglose: [
      { code: "610008", monto: 412.35, glosa: "Útiles de oficina" },
      { code: "610002", monto: 900, glosa: "Asesoría externa" },
      { code: "500003", monto: 185.5, glosa: "Mensajería" },
    ],
  },
];

// ===========================================================================
// 3) COBROS — el asiento se declara, el pago se DERIVA
// ===========================================================================

interface CobroOp {
  clave: string;
  fecha: string;
  /** Factura que se cobra. De ahí salen el cliente y el destino del enlace. */
  facturaNumero: string;
  monto: number;
  metodo: "efectivo" | "transferencia" | "cheque" | "tarjeta" | "ach" | "otro";
  referencia: string;
}

const COBROS: CobroOp[] = [
  {
    clave: "cobro:hon-1-total",
    fecha: "2026-04-20",
    facturaNumero: "FAC-HON-000001",
    monto: 1070,
    metodo: "transferencia",
    referencia: "Transferencia Banco General 4471902",
  },
  // Cobro PARCIAL: la factura queda en 'parcialmente_pagada' y la CxC no baja
  // a cero. Da el caso de una cuenta con movimientos de los dos lados que no
  // se cancelan entre sí.
  {
    clave: "cobro:hon-2-parcial",
    fecha: "2026-06-15",
    facturaNumero: "FAC-HON-000002",
    monto: 1000,
    metodo: "transferencia",
    referencia: "Transferencia Banco General 4488115",
  },
];

// ===========================================================================
// 4) ASIENTOS DE DIARIO — sin documento, y por eso sin source_id
// ===========================================================================

interface DiarioOp {
  clave: string;
  fecha: string;
  descripcion: string;
  lineas: { code: string; debit: number; credit: number; description?: string }[];
}

const DIARIO: DiarioOp[] = [
  // ---- Asiento GENUINAMENTE AMBIGUO ---------------------------------------
  // Dos cuentas de cada lado: desde cualquier línea hay más de una
  // contrapartida posible. Sin un asiento así, la rama ambigua de
  // `contrapartidaDe()` no se puede ver en pantalla.
  {
    clave: "manual:reclasificacion-marzo",
    fecha: "2026-03-28",
    descripcion: "Reclasificación de costos y gastos de trámite",
    lineas: [
      { code: "500005", debit: 320, credit: 0, description: "Trámites Registro Público" },
      { code: "500003", debit: 140, credit: 0, description: "Mensajería especializada" },
      { code: "610008", debit: 0, credit: 260, description: "Reclasificado desde útiles" },
      { code: "610002", debit: 0, credit: 200, description: "Reclasificado desde honorarios" },
    ],
  },
];

// ===========================================================================
// FORMA COMÚN — a esto se reduce todo antes de postear
// ===========================================================================

interface AsientoAPostear {
  clave: string;
  fecha: string;
  descripcion: string;
  source_type: SourceType;
  /** null SOLO cuando la operación no tiene documento (asiento de diario). */
  source_id: string | null;
  lineas: { code: string; debit: number; credit: number; description?: string | null }[];
}

/** Tablas donde vive el documento de cada `source_type` que las tiene. */
const TABLA_DEL_ORIGEN: Record<string, string> = {
  factura: "invoices",
  nota_credito: "invoices",
  gasto: "business_expenses",
  pago: "payments",
};

// ===========================================================================
// EJECUCIÓN
// ===========================================================================

let db: SupabaseClient;

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * BLINDAJE — la lección del 27/08/2026.
 *
 * Antes de escribir NADA, revisa si el ledger ya tiene asientos de un tipo con
 * documento cuyo `source_id` no resuelve. Si aparece alguno, la clave de
 * idempotencia se desalineó de los datos y seguir sembrando duplicaría
 * contabilidad imborrable. Aborta y explica qué pasó.
 */
async function verificarOrigenesHuerfanos(): Promise<void> {
  const { data, error } = await db
    .from("journal_entries")
    .select("entry_number, source_type, source_id, description")
    .eq("tenant_id", TENANT_ID)
    .not("source_id", "is", null);
  if (error) throw new Error(`leer asientos existentes: ${error.message}`);

  const asientos = (data ?? []) as {
    entry_number: number;
    source_type: string;
    source_id: string;
    description: string;
  }[];
  if (asientos.length === 0) {
    console.log("🛡️  Blindaje: el ledger está vacío, nada que verificar.");
    return;
  }

  const huerfanos: typeof asientos = [];

  // Una consulta por tabla, no una por asiento.
  const porTabla = new Map<string, typeof asientos>();
  for (const a of asientos) {
    const tabla = TABLA_DEL_ORIGEN[a.source_type];
    if (!tabla) continue; // manual/apertura/reversion: no tienen documento
    porTabla.set(tabla, [...(porTabla.get(tabla) ?? []), a]);
  }

  for (const [tabla, lista] of Array.from(porTabla.entries())) {
    const ids = Array.from(new Set(lista.map((a) => a.source_id)));
    const { data: filas, error: errT } = await db
      .from(tabla)
      .select("id")
      .eq("tenant_id", TENANT_ID)
      .in("id", ids);
    if (errT) throw new Error(`verificar ${tabla}: ${errT.message}`);
    const existen = new Set(((filas ?? []) as { id: string }[]).map((f) => f.id));
    for (const a of lista) if (!existen.has(a.source_id)) huerfanos.push(a);
  }

  if (huerfanos.length > 0) {
    console.error(`\n❌ ABORTADO — hay ${huerfanos.length} asiento(s) que apuntan a un documento que NO existe.\n`);
    for (const a of huerfanos.slice(0, 10)) {
      console.error(
        `   · asiento #${a.entry_number} (${a.source_type})  source_id ${a.source_id}` +
          `\n     ${a.description.slice(0, 70)}`
      );
    }
    if (huerfanos.length > 10) console.error(`   … y ${huerfanos.length - 10} más.`);
    console.error(
      `
   QUÉ SIGNIFICA
     La clave de idempotencia de este seed es el \`source_id\`, que tiene que ser
     el id del documento real. Si hay asientos cuyo source_id no resuelve, es
     porque se sembraron con OTRA regla que la que este script usa hoy — pasó el
     27/08/2026, cuando el script se editó después de haber corrido.

   POR QUÉ NO SIGO
     Esos asientos ya no se reconocen como propios, así que sembrar encima los
     duplicaría: doble ingreso, doble ITBMS, doble cuenta por cobrar. Y los
     asientos son INMUTABLES — los triggers de 023 rechazan DELETE, así que el
     duplicado no se podría limpiar.

   QUÉ HACER
     Resetear staging y volver a sembrar limpio:
       node scripts/apply-staging-sql.mjs --reset
       npm run seed:staging
       npm run seed:asientos
`
    );
    process.exit(1);
  }

  console.log(`🛡️  Blindaje: ${asientos.length} asiento(s) con documento, todos resuelven.`);
}

/** Inserta una fila con id determinístico si no está. Devuelve el id. */
async function upsertPorId(
  tabla: string,
  rowId: string,
  fila: Record<string, unknown>,
  etiqueta: string
): Promise<{ id: string; creado: boolean }> {
  const { data: existe, error: errSel } = await db
    .from(tabla)
    .select("id")
    .eq("id", rowId)
    .maybeSingle();
  if (errSel) throw new Error(`select ${tabla} (${etiqueta}): ${errSel.message}`);
  if (existe) return { id: rowId, creado: false };

  const { error } = await db.from(tabla).insert({ ...fila, id: rowId, tenant_id: TENANT_ID });
  if (error) throw new Error(`insert ${tabla} (${etiqueta}): ${error.message}`);
  return { id: rowId, creado: true };
}

async function main() {
  console.log("\n📒 SIEMBRA DE ASIENTOS DE PRUEBA — solo staging\n");
  guard();

  db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  await verificarOrigenesHuerfanos();

  // -- Facturas de staging ---------------------------------------------------
  const { data: facturas, error: errFac } = await db
    .from("invoices")
    .select("id, invoice_number, client_id, subtotal_total, tax_total, grand_total, issue_date")
    .eq("tenant_id", TENANT_ID);
  if (errFac) throw new Error(`leer facturas: ${errFac.message}`);

  type Factura = {
    id: string;
    invoice_number: string;
    client_id: string;
    subtotal_total: number | string;
    tax_total: number | string;
    grand_total: number | string;
    issue_date: string;
  };
  const facturaPorNumero = new Map<string, Factura>(
    ((facturas ?? []) as Factura[]).map((f) => [f.invoice_number, f])
  );

  if (facturaPorNumero.size === 0) {
    abort("no hay facturas en staging. Corré primero `npm run seed:staging`.");
  }

  // -- Nombre de los clientes, para la glosa de la línea de CxC --------------
  const { data: clientes, error: errCli } = await db
    .from("clients")
    .select("id, name")
    .eq("tenant_id", TENANT_ID);
  if (errCli) throw new Error(`leer clientes: ${errCli.message}`);
  const nombrePorCliente = new Map<string, string>(
    ((clientes ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name])
  );

  const asientos: AsientoAPostear[] = [];
  let docsCreados = 0;
  let docsExistentes = 0;

  // =========================================================================
  // FACTURAS — el asiento se arma DESDE la factura
  // =========================================================================
  for (const op of FACTURAS) {
    const f = facturaPorNumero.get(op.numero);
    if (!f) {
      abort(
        `no existe la factura ${op.numero} en staging.\n` +
          `   Corré primero \`npm run seed:staging\`, o saca esta entrada de FACTURAS.`
      );
    }
    const neto = round2(Number(f.subtotal_total));
    const itbms = round2(Number(f.tax_total));
    const total = round2(Number(f.grand_total));
    const cliente = nombrePorCliente.get(f.client_id) ?? "";

    const lineas: AsientoAPostear["lineas"] = [
      { code: CTA_CXC, debit: total, credit: 0, description: cliente },
      { code: op.cuentaNeto, debit: 0, credit: neto, description: op.glosaNeto },
    ];
    // Solo si la factura lleva impuesto. Las de REEMBOLSO son exentas.
    if (itbms > 0) {
      lineas.push({ code: CTA_ITBMS, debit: 0, credit: itbms, description: "ITBMS 7%" });
    }

    asientos.push({
      clave: `factura:${op.numero}`,
      fecha: String(f.issue_date).slice(0, 10),
      descripcion: `Factura ${op.numero} — ${cliente}`,
      source_type: "factura",
      source_id: f.id,
      lineas,
    });
  }

  // =========================================================================
  // GASTOS — se crea el business_expense y el asiento se deriva del desglose
  // =========================================================================
  for (const op of GASTOS) {
    const total = round2(op.desglose.reduce((s, d) => s + d.monto, 0));
    // La cuenta de mayor peso representa al gasto en el documento, que tiene
    // UN solo `chart_account_code` aunque el asiento toque varias cuentas.
    const principal = [...op.desglose].sort((a, b) => b.monto - a.monto)[0].code;

    const gastoId = id(`business_expense:${op.clave}`);
    const r = await upsertPorId(
      "business_expenses",
      gastoId,
      {
        expense_date: op.fecha,
        supplier_name: op.proveedor,
        chart_account_code: principal,
        description: op.descripcion,
        subtotal: total,
        tax_rate: 0,
        tax_amount: 0,
        // El asiento acredita Cuentas por pagar, así que el gasto está
        // devengado y NO pagado. `payment_date` debe ir NULL (CHECK
        // business_expenses_payment_date_consistency_check).
        status: "pendiente_pago",
        notes: "Sembrado por seed:asientos para el Libro Mayor de staging.",
      },
      op.clave
    );
    r.creado ? docsCreados++ : docsExistentes++;

    asientos.push({
      clave: op.clave,
      fecha: op.fecha,
      descripcion: op.descripcion,
      source_type: "gasto",
      source_id: r.id,
      lineas: [
        ...op.desglose.map((d) => ({
          code: d.code,
          debit: d.monto,
          credit: 0,
          description: d.glosa ?? null,
        })),
        { code: CTA_CXP, debit: 0, credit: total, description: op.proveedor },
      ],
    });
  }

  // =========================================================================
  // COBROS — se crea el payment (+ su aplicación) y el asiento se deriva
  // =========================================================================
  for (const op of COBROS) {
    const f = facturaPorNumero.get(op.facturaNumero);
    if (!f) {
      abort(
        `el cobro "${op.clave}" apunta a la factura ${op.facturaNumero}, que no existe en staging.\n` +
          `   Corré primero \`npm run seed:staging\`, o saca esta entrada de COBROS.`
      );
    }
    const cliente = nombrePorCliente.get(f.client_id) ?? "";
    const pagoId = id(`payment:${op.clave}`);

    const r = await upsertPorId(
      "payments",
      pagoId,
      {
        client_id: f.client_id,
        payment_date: op.fecha,
        amount: op.monto,
        method: op.metodo,
        reference: op.referencia,
        status: "registrado",
        notes: "Sembrado por seed:asientos para el Libro Mayor de staging.",
      },
      op.clave
    );
    r.creado ? docsCreados++ : docsExistentes++;

    // La aplicación a la factura. El trigger T7a recalcula amount_paid y el
    // status de la factura a partir de esto, así que el monto tiene que ser el
    // que la factura ya declara como cobrado — si no, T7a le cambiaría el
    // estado a una factura que el fixture de staging dejó en otro.
    await upsertPorId(
      "payment_applications",
      id(`payment_application:${op.clave}`),
      { payment_id: pagoId, invoice_id: f.id, amount_applied: op.monto },
      `${op.clave} → ${op.facturaNumero}`
    );

    asientos.push({
      clave: op.clave,
      fecha: op.fecha,
      descripcion: `Cobro de la factura ${op.facturaNumero} — ${cliente}`,
      source_type: "pago",
      source_id: r.id,
      lineas: [
        { code: CTA_BANCO, debit: op.monto, credit: 0, description: op.referencia },
        { code: CTA_CXC, debit: 0, credit: op.monto, description: cliente },
      ],
    });
  }

  // =========================================================================
  // DIARIO — sin documento, source_id NULL
  // =========================================================================
  for (const op of DIARIO) {
    asientos.push({
      clave: op.clave,
      fecha: op.fecha,
      descripcion: op.descripcion,
      source_type: "manual",
      source_id: null,
      lineas: op.lineas.map((l) => ({ ...l, description: l.description ?? null })),
    });
  }

  console.log(
    `\n📄 Documentos de respaldo — ${docsCreados} nuevos, ${docsExistentes} ya existían\n`
  );

  // =========================================================================
  // POSTEO — en orden cronológico, para que el correlativo siga a las fechas
  // =========================================================================
  asientos.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.clave.localeCompare(b.clave));

  let creados = 0;
  let existentes = 0;

  for (const a of asientos) {
    if (await yaExiste(a)) {
      existentes++;
      continue;
    }

    const debitos = round2(a.lineas.reduce((s, l) => s + l.debit, 0));
    const creditos = round2(a.lineas.reduce((s, l) => s + l.credit, 0));
    if (Math.abs(debitos - creditos) > 0.005) {
      abort(
        `el asiento "${a.clave}" no cuadra: ` +
          `débitos ${debitos.toFixed(2)} vs créditos ${creditos.toFixed(2)}. ` +
          `El RPC lo rechazaría igual, pero es mejor verlo acá.`
      );
    }

    const { data, error } = await db.rpc("post_journal_entry", {
      p_tenant_id: TENANT_ID,
      p_transaction_date: a.fecha,
      p_description: a.descripcion,
      p_source_type: a.source_type,
      p_lines: a.lineas.map((l) => ({
        account_code: l.code,
        debit: l.debit,
        credit: l.credit,
        description: l.description ?? null,
      })),
      p_source_id: a.source_id,
      p_source_cufe: null,
      p_reverses_entry_id: null,
      p_reversal_reason: null,
      p_created_by: null,
      p_record_date: null,
    });

    if (error) {
      abort(`el RPC rechazó el asiento "${a.clave}": ${error.message}`);
    }
    creados++;
    console.log(`   ✓ ${a.fecha}  ${a.descripcion.slice(0, 58)}  → ${String(data).slice(0, 8)}`);
  }

  console.log(
    `\n✅ Asientos — ${creados} nuevos, ${existentes} ya existían (${asientos.length} en el fixture)`
  );

  // ---- Integridad de la cadena, ahora con datos de verdad -----------------
  const { data: rotos, error: errChain } = await db.rpc("verify_accounting_chain", {
    p_tenant_id: TENANT_ID,
  });
  if (errChain) throw new Error(`verificar cadena: ${errChain.message}`);
  const n = (rotos ?? []).length;
  console.log(n === 0 ? "✅ Cadena de hash íntegra" : `❌ CADENA ROTA: ${JSON.stringify(rotos)}`);
  if (n > 0) process.exit(1);

  // ---- Y que ningún asiento haya quedado apuntando a la nada -------------
  await verificarOrigenesHuerfanos();

  // ---- Resumen ------------------------------------------------------------
  const { count: totalAsientos } = await db
    .from("journal_entries")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", TENANT_ID);
  const { count: totalLineas } = await db
    .from("journal_entry_lines")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", TENANT_ID);

  console.log(`\n┌─ LEDGER EN STAGING ──────────────`);
  console.log(`│ asientos            ${totalAsientos}`);
  console.log(`│ líneas              ${totalLineas}`);
  console.log(`└──────────────────────────────────`);
  console.log("\nCorrerlo de nuevo no duplica nada. Para empezar de cero: --reset.\n");
}

/**
 * ¿Ya está posteado este asiento?
 *
 * Con documento, la clave es (source_type, source_id) — el id del documento
 * real. Sin documento (asiento de diario), no hay más remedio que reconocerlo
 * por su contenido: (source_type, descripción, fecha).
 */
async function yaExiste(a: AsientoAPostear): Promise<boolean> {
  let q = db
    .from("journal_entries")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", TENANT_ID)
    .eq("source_type", a.source_type);

  if (a.source_id) {
    q = q.eq("source_id", a.source_id);
  } else {
    q = q.is("source_id", null).eq("description", a.descripcion).eq("transaction_date", a.fecha);
  }

  const { count, error } = await q;
  if (error) throw new Error(`consultar asiento existente: ${error.message}`);
  return (count ?? 0) > 0;
}

main().catch((e) => {
  console.error("\n❌", e.message);
  process.exit(1);
});
