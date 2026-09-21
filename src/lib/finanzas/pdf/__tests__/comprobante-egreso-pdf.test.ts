/**
 * El PDF del COMPROBANTE DE EGRESO (Bloque 3, 21/09/2026):
 *
 *   1. El hash cambia con lo que se ve (monto, reversión) y NO con lo que no
 *      (el orden de las claves, el saldo actual de la compra que no entra).
 *      RUC y DV del proveedor viajan separados.
 *   2. `ensureSupplierPaymentPdfRow`: cache hit (mismo hash + blob presente)
 *      no regenera; hash distinto regenera y sube la versión; sin fila crea
 *      una con `entity_type='supplier_payment'` y
 *      `source='auto_supplier_payment_pdf'` (los valores que la 048 agregó a
 *      los CHECK de `documents`); un pago inexistente devuelve `no-existe`.
 *      🔒 Un SALDO HEREDADO devuelve `saldo-heredado` SIN generar ni escribir
 *      nada: no es un pago registrado y no tiene comprobante.
 *   3. Los roles de la ruta del PDF son los MISMOS que los del comprobante
 *      adjunto de la compra (`receipt/download`), y la ruta devuelve el
 *      archivo, no un enlace.
 *   4. La sección "Pagos" no renderiza el botón del PDF para un heredado.
 *
 * Ejecución (el ensure necesita el flag para mock.module):
 *   npx tsx --test --experimental-test-module-mocks src/lib/finanzas/pdf/__tests__/comprobante-egreso-pdf.test.ts
 */

import test, { mock, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  computeSupplierPaymentContentHash,
  type SupplierPaymentPdfPayload,
} from "@/lib/finanzas/api/supplier-payment-pdf-hash";
import {
  buildSupplierPaymentPdfPayload,
  type SupplierPaymentPdfBundle,
  type SupplierPaymentPdfLookup,
} from "@/lib/finanzas/pdf/supplier-payment-pdf-data";

const MOCKS_ENABLED = typeof mock.module === "function";
const skipNoMocks = MOCKS_ENABLED ? false : "requiere: npx tsx --test --experimental-test-module-mocks";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

function bundle(
  over: Partial<SupplierPaymentPdfBundle["payment"]> = {},
  rev: SupplierPaymentPdfBundle["reversion"] = null
): SupplierPaymentPdfBundle {
  return {
    payment: {
      id: "sp1",
      payment_number: "CE-000001",
      payment_date: "2026-09-21",
      amount: 400,
      method: "transferencia",
      reference: "TRF-778899",
      notes: null,
      status: rev ? "anulado" : "registrado",
      payment_account_code: "100001",
      created_by_name: "Elías Pimentel",
      ...over,
    },
    proveedor: {
      name: "DISTRIBUIDORA OFIPLUS, S.A.",
      supplier_number: "PRV-003",
      ruc: "155612345-2-2019",
      dv: "05",
      email: null,
      phone: null,
    },
    compra: {
      id: "c1",
      description: "Compra consolidada de insumos y servicios — marzo 2026",
      expense_date: "2026-03-15",
      supplier_invoice_number: "F-00123",
      total: 1605,
      saldo_actual: 1205,
    },
    banco: { code: "100001", name: "Banco General Operativa" },
    asiento: { entry_number: 28, transaction_date: "2026-09-21" },
    reversion: rev,
  };
}

// ---------------------------------------------------------------------------
// 1. El hash
// ---------------------------------------------------------------------------

test("hash: determinístico y sin importar el orden de las claves", () => {
  const p = buildSupplierPaymentPdfPayload(bundle());
  const h1 = computeSupplierPaymentContentHash(p);
  const invertido = Object.fromEntries(Object.entries(p).reverse()) as unknown as SupplierPaymentPdfPayload;
  assert.equal(computeSupplierPaymentContentHash(invertido), h1);
  assert.match(h1, /^[0-9a-f]{64}$/);
});

test("hash: cambia con el monto y con la reversión", () => {
  const base = computeSupplierPaymentContentHash(buildSupplierPaymentPdfPayload(bundle()));
  const monto = computeSupplierPaymentContentHash(buildSupplierPaymentPdfPayload(bundle({ amount: 300 })));
  const reversado = computeSupplierPaymentContentHash(
    buildSupplierPaymentPdfPayload(bundle({}, { entry_number: 30, reversed_at: "2026-09-21T20:00:00Z", reason: "Transferencia rechazada" }))
  );
  assert.notEqual(monto, base);
  assert.notEqual(reversado, base, "al reversar, el PDF tiene que regenerarse con la banda roja");
});

test("hash: NO cambia con el saldo actual de la compra (no es parte del comprobante)", () => {
  const a = bundle();
  const b = bundle();
  b.compra.saldo_actual = 0;
  assert.equal(
    computeSupplierPaymentContentHash(buildSupplierPaymentPdfPayload(a)),
    computeSupplierPaymentContentHash(buildSupplierPaymentPdfPayload(b))
  );
});

test("payload: RUC y DV del proveedor viajan en DOS campos, nunca concatenados", () => {
  const p = buildSupplierPaymentPdfPayload(bundle());
  assert.equal(p.proveedor.ruc, "155612345-2-2019");
  assert.equal(p.proveedor.dv, "05");
  assert.doesNotMatch(JSON.stringify(p), /155612345-2-2019-?05/);
});

// ---------------------------------------------------------------------------
// 2. ensureSupplierPaymentPdfRow, con la base y el generador simulados
// ---------------------------------------------------------------------------

const estado = {
  lookup: { ok: false, motivo: "no-existe" } as SupplierPaymentPdfLookup,
  fila: null as Record<string, unknown> | null,
  blobExiste: true,
  generados: 0,
  subidos: [] as string[],
  inserts: [] as Record<string, unknown>[],
  updates: [] as Record<string, unknown>[],
  consultasADocuments: 0,
};

function fakeDb() {
  const documents = () => {
    const q: Record<string, unknown> = {};
    const self = () => q;
    q.select = self;
    q.eq = self;
    q.maybeSingle = async () => ({ data: estado.fila, error: null });
    q.update = (payload: Record<string, unknown>) => {
      estado.updates.push(payload);
      return { eq: async () => ({ error: null }) };
    };
    q.insert = async (payload: Record<string, unknown>) => {
      estado.inserts.push(payload);
      return { error: null };
    };
    return q;
  };
  return {
    from: (t: string) => {
      assert.equal(t, "documents", "el ensure solo toca documents; el pago lo trae el bundle");
      estado.consultasADocuments++;
      return documents();
    },
    storage: {
      from: () => ({
        createSignedUrl: async () =>
          estado.blobExiste ? { data: { signedUrl: "https://x/y" }, error: null } : { data: null, error: { message: "no" } },
        upload: async (path: string) => {
          estado.subidos.push(path);
          return { error: null };
        },
      }),
    },
  };
}

if (MOCKS_ENABLED) {
  mock.module("@/lib/finanzas/pdf/supplier-payment-pdf-data", {
    namedExports: {
      fetchSupplierPaymentPdfBundle: async () => estado.lookup,
      buildSupplierPaymentPdfPayload,
      buildSupplierPaymentDocumentProps: () => ({}),
    },
  });
  mock.module("@/lib/finanzas/pdf/generate-supplier-payment-pdf", {
    namedExports: {
      generateSupplierPaymentPdfBuffer: async () => {
        estado.generados++;
        return Buffer.from("%PDF-egreso");
      },
    },
  });
}

let ensureSupplierPaymentPdfRow: typeof import("@/lib/finanzas/pdf/ensure-supplier-payment-pdf").ensureSupplierPaymentPdfRow;

before(async () => {
  if (!MOCKS_ENABLED) return;
  ({ ensureSupplierPaymentPdfRow } = await import("@/lib/finanzas/pdf/ensure-supplier-payment-pdf"));
});

const CTX = { tenantId: "t1", userId: "u1", userName: "Elías" };

function reset(lookup: SupplierPaymentPdfLookup, fila: Record<string, unknown> | null) {
  estado.lookup = lookup;
  estado.fila = fila;
  estado.blobExiste = true;
  estado.generados = 0;
  estado.subidos = [];
  estado.inserts = [];
  estado.updates = [];
  estado.consultasADocuments = 0;
}

test("ensure: pago inexistente → no-existe, sin generar nada", { skip: skipNoMocks }, async () => {
  reset({ ok: false, motivo: "no-existe" }, null);
  const r = await ensureSupplierPaymentPdfRow(fakeDb() as never, CTX, "sp-x");
  assert.deepEqual(r, { ok: false, motivo: "no-existe" });
  assert.equal(estado.generados, 0);
});

test("🔒 ensure: un SALDO HEREDADO → saldo-heredado, sin generar, subir ni escribir en documents", { skip: skipNoMocks }, async () => {
  reset({ ok: false, motivo: "saldo-heredado" }, null);
  const r = await ensureSupplierPaymentPdfRow(fakeDb() as never, CTX, "sp-heredado");
  assert.deepEqual(r, { ok: false, motivo: "saldo-heredado" });
  assert.equal(estado.generados, 0);
  assert.equal(estado.subidos.length, 0);
  assert.equal(estado.inserts.length, 0);
  assert.equal(estado.consultasADocuments, 0, "ni siquiera busca la fila: no hay comprobante que cachear");
});

test("ensure: sin fila → genera, sube y crea la fila supplier_payment/auto_supplier_payment_pdf (los valores de la 048)", { skip: skipNoMocks }, async () => {
  const b = bundle();
  reset({ ok: true, bundle: b }, null);
  const r = await ensureSupplierPaymentPdfRow(fakeDb() as never, CTX, "sp1");
  assert.ok(r.ok);
  assert.equal(r.regenerated, true);
  assert.equal(r.version, 1);
  assert.equal(r.file_name, "CE-000001.pdf");
  assert.equal(r.storage_key, "t1/supplier_payment_pdf/sp1/current.pdf", "la primera carpeta es el tenant (SOP-015)");
  assert.equal(estado.generados, 1);
  assert.deepEqual(estado.subidos, ["t1/supplier_payment_pdf/sp1/current.pdf"]);
  assert.equal(estado.inserts.length, 1);
  assert.equal(estado.inserts[0].entity_type, "supplier_payment");
  assert.equal(estado.inserts[0].source, "auto_supplier_payment_pdf");
  assert.equal(estado.inserts[0].source_content_hash, computeSupplierPaymentContentHash(buildSupplierPaymentPdfPayload(b)));
});

test("ensure: mismo hash y blob presente → cache hit, no regenera", { skip: skipNoMocks }, async () => {
  const b = bundle();
  const hash = computeSupplierPaymentContentHash(buildSupplierPaymentPdfPayload(b));
  reset({ ok: true, bundle: b }, { id: "d1", storage_key: "t1/supplier_payment_pdf/sp1/current.pdf", source_version: 3, source_content_hash: hash, file_name: "CE-000001.pdf" });
  const r = await ensureSupplierPaymentPdfRow(fakeDb() as never, CTX, "sp1");
  assert.ok(r.ok);
  assert.equal(r.regenerated, false);
  assert.equal(r.version, 3);
  assert.equal(estado.generados, 0);
  assert.equal(estado.updates.length, 0);
});

test("ensure: el pago se reversó → el hash difiere, regenera y sube la versión", { skip: skipNoMocks }, async () => {
  const antes = computeSupplierPaymentContentHash(buildSupplierPaymentPdfPayload(bundle()));
  const b = bundle({}, { entry_number: 30, reversed_at: "2026-09-21T20:00:00Z", reason: "Transferencia rechazada" });
  reset({ ok: true, bundle: b }, { id: "d1", storage_key: "t1/supplier_payment_pdf/sp1/current.pdf", source_version: 1, source_content_hash: antes, file_name: "CE-000001.pdf" });
  const r = await ensureSupplierPaymentPdfRow(fakeDb() as never, CTX, "sp1");
  assert.ok(r.ok);
  assert.equal(r.regenerated, true);
  assert.equal(r.version, 2);
  assert.equal(estado.generados, 1);
  assert.equal(estado.updates.length, 1);
  assert.equal(estado.updates[0].source_version, 2);
});

test("ensure: hash igual pero el blob no está → regenera (no sirve un enlace roto)", { skip: skipNoMocks }, async () => {
  const b = bundle();
  const hash = computeSupplierPaymentContentHash(buildSupplierPaymentPdfPayload(b));
  reset({ ok: true, bundle: b }, { id: "d1", storage_key: "t1/supplier_payment_pdf/sp1/current.pdf", source_version: 1, source_content_hash: hash, file_name: "CE-000001.pdf" });
  estado.blobExiste = false;
  const r = await ensureSupplierPaymentPdfRow(fakeDb() as never, CTX, "sp1");
  assert.ok(r.ok && r.regenerated);
  assert.equal(estado.generados, 1);
});

// ---------------------------------------------------------------------------
// 3. La ruta: roles de las compras, archivo y no enlace, 409 al heredado
// ---------------------------------------------------------------------------

const ROOT = process.cwd();
const RUTA_PDF = "src/app/api/finanzas/supplier-payments/[id]/pdf/route.ts";
const rolesDe = (rel: string): string[] => {
  const src = readFileSync(join(ROOT, rel), "utf8");
  const m = src.match(/const ALLOWED_ROLES = \[([^\]]+)\](?: as const)?;/);
  assert.ok(m, `${rel}: no se encontró ALLOWED_ROLES`);
  return m[1].split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean);
};

test("la ruta del PDF declara los MISMOS roles que el comprobante adjunto de la compra", () => {
  assert.deepEqual(
    rolesDe(RUTA_PDF),
    rolesDe("src/app/api/finanzas/business-expenses/[id]/receipt/download/route.ts")
  );
  assert.deepEqual(rolesDe(RUTA_PDF), ["admin", "abogada", "contador"]);
});

test("la ruta devuelve el archivo, no un enlace a supabase.co, y responde 409 al saldo heredado", () => {
  const src = readFileSync(join(ROOT, RUTA_PDF), "utf8");
  assert.match(src, /serveStorageFile\(/);
  assert.doesNotMatch(src, /getPublicUrl/);
  assert.doesNotMatch(src, /signedUrl\s*\}/, "no responde { url: signedUrl }");
  assert.match(src, /"saldo-heredado"[\s\S]*status: 409/);
});

// ---------------------------------------------------------------------------
// 4. La pantalla no ofrece el botón a un saldo heredado
// ---------------------------------------------------------------------------

test("🔒 la sección Pagos condiciona el botón del PDF a que NO sea un saldo heredado", () => {
  const src = readFileSync(join(ROOT, "src/app/finanzas/gastos-bufete/_components/supplier-payments-section.tsx"), "utf8");
  assert.match(src, /const tieneComprobante = !heredado && !!p\.payment_number;/);
  assert.match(src, /\{tieneComprobante && \(\s*<DownloadReceiptPdfButton\s+variante="egreso"/);
});
