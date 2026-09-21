/**
 * El PDF del RECIBO DE CAJA (Bloque 2, 21/09/2026):
 *
 *   1. El hash cambia con lo que se ve (monto, reversión) y NO con lo que no
 *      (el orden de las claves, el saldo actual de la factura que no entra).
 *   2. `ensureReceiptPdfRow`: cache hit (mismo hash + blob presente) no
 *      regenera; hash distinto regenera y sube la versión; sin fila crea una
 *      con `entity_type='payment'` y `source='auto_receipt_pdf'` (los valores
 *      que la 047 agregó a los CHECK de `documents`); un cobro sin número
 *      devuelve null.
 *   3. Los roles de la ruta del PDF del recibo son los MISMOS que los del PDF
 *      de la factura.
 *
 * Ejecución (el ensure necesita el flag para mock.module):
 *   npx tsx --test --experimental-test-module-mocks src/lib/finanzas/pdf/__tests__/recibo-pdf.test.ts
 */

import test, { mock, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { computeReceiptContentHash, type ReceiptPdfPayload } from "@/lib/finanzas/api/receipt-pdf-hash";
import { buildReceiptPdfPayload, type ReceiptPdfBundle } from "@/lib/finanzas/pdf/receipt-pdf-data";

const MOCKS_ENABLED = typeof mock.module === "function";
const skipNoMocks = MOCKS_ENABLED ? false : "requiere: npx tsx --test --experimental-test-module-mocks";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

function bundle(over: Partial<ReceiptPdfBundle["payment"]> = {}, rev: ReceiptPdfBundle["reversion"] = null): ReceiptPdfBundle {
  return {
    payment: {
      id: "p4",
      payment_number: "REC-000004",
      payment_date: "2026-09-21",
      amount: 250,
      method: "transferencia",
      reference: "Verificacion",
      notes: null,
      status: rev ? "anulado" : "registrado",
      payment_account_code: "100001",
      created_by_name: "Ileana Barrios",
      ...over,
    },
    client: {
      name: "INVERSIONES TOCUMEN REAL, S.A.",
      client_number: "CLI-004",
      tax_id: "1588210-1-713366",
      tax_id_type: "ruc",
      digito_verificador: "05",
      email: null,
      phone: null,
      address: null,
    },
    aplicaciones: [
      { invoice_id: "i1", invoice_number: "FAC-HON-000002", issue_date: "2026-05-20", grand_total: 1605, amount_applied: 250, balance_due: 1355 },
    ],
    banco: { code: "100001", name: "Banco General Operativa" },
    asiento: { entry_number: 22, transaction_date: "2026-09-21" },
    reversion: rev,
  };
}

// ---------------------------------------------------------------------------
// 1. El hash
// ---------------------------------------------------------------------------

test("hash: determinístico y sin importar el orden de las claves", () => {
  const p = buildReceiptPdfPayload(bundle());
  const h1 = computeReceiptContentHash(p);
  const invertido = Object.fromEntries(Object.entries(p).reverse()) as unknown as ReceiptPdfPayload;
  assert.equal(computeReceiptContentHash(invertido), h1);
  assert.match(h1, /^[0-9a-f]{64}$/);
});

test("hash: cambia con el monto y con la reversión", () => {
  const base = computeReceiptContentHash(buildReceiptPdfPayload(bundle()));
  const monto = computeReceiptContentHash(buildReceiptPdfPayload(bundle({ amount: 300 })));
  const reversado = computeReceiptContentHash(
    buildReceiptPdfPayload(bundle({}, { entry_number: 23, reversed_at: "2026-09-21T20:00:00Z", reason: "Cheque devuelto" }))
  );
  assert.notEqual(monto, base);
  assert.notEqual(reversado, base, "al reversar, el PDF tiene que regenerarse con la banda roja");
});

test("hash: NO cambia con el saldo actual de la factura (no es parte del recibo)", () => {
  const a = bundle();
  const b = bundle();
  b.aplicaciones[0].balance_due = 0;
  assert.equal(
    computeReceiptContentHash(buildReceiptPdfPayload(a)),
    computeReceiptContentHash(buildReceiptPdfPayload(b))
  );
});

test("payload: RUC y DV viajan en DOS campos, nunca concatenados", () => {
  const p = buildReceiptPdfPayload(bundle());
  assert.equal(p.client.tax_id, "1588210-1-713366");
  assert.equal(p.client.digito_verificador, "05");
  assert.doesNotMatch(JSON.stringify(p), /1588210-1-713366-?05/);
});

// ---------------------------------------------------------------------------
// 2. ensureReceiptPdfRow, con la base y el generador simulados
// ---------------------------------------------------------------------------

const estado = {
  bundle: null as ReceiptPdfBundle | null,
  fila: null as Record<string, unknown> | null,
  blobExiste: true,
  generados: 0,
  subidos: [] as string[],
  inserts: [] as Record<string, unknown>[],
  updates: [] as Record<string, unknown>[],
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
      assert.equal(t, "documents", "el ensure solo toca documents; el cobro lo trae el bundle");
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
  mock.module("@/lib/finanzas/pdf/receipt-pdf-data", {
    namedExports: {
      fetchReceiptPdfBundle: async () => estado.bundle,
      buildReceiptPdfPayload,
      buildReceiptDocumentProps: () => ({}),
    },
  });
  mock.module("@/lib/finanzas/pdf/generate-receipt-pdf", {
    namedExports: {
      generateReceiptPdfBuffer: async () => {
        estado.generados++;
        return Buffer.from("%PDF-recibo");
      },
    },
  });
}

let ensureReceiptPdfRow: typeof import("@/lib/finanzas/pdf/ensure-receipt-pdf").ensureReceiptPdfRow;

before(async () => {
  if (!MOCKS_ENABLED) return;
  ({ ensureReceiptPdfRow } = await import("@/lib/finanzas/pdf/ensure-receipt-pdf"));
});

const CTX = { tenantId: "t1", userId: "u1", userName: "Ileana" };

function reset(b: ReceiptPdfBundle | null, fila: Record<string, unknown> | null) {
  estado.bundle = b;
  estado.fila = fila;
  estado.blobExiste = true;
  estado.generados = 0;
  estado.subidos = [];
  estado.inserts = [];
  estado.updates = [];
}

test("ensure: cobro inexistente o sin número → null, sin generar nada", { skip: skipNoMocks }, async () => {
  reset(null, null);
  assert.equal(await ensureReceiptPdfRow(fakeDb() as never, CTX, "p-x"), null);
  assert.equal(estado.generados, 0);
});

test("ensure: sin fila → genera, sube y crea la fila payment/auto_receipt_pdf (los valores de la 047)", { skip: skipNoMocks }, async () => {
  const b = bundle();
  reset(b, null);
  const r = await ensureReceiptPdfRow(fakeDb() as never, CTX, "p4");
  assert.ok(r);
  assert.equal(r.regenerated, true);
  assert.equal(r.version, 1);
  assert.equal(r.file_name, "REC-000004.pdf");
  assert.equal(r.storage_key, "t1/receipt_pdf/p4/current.pdf", "la primera carpeta es el tenant (SOP-015)");
  assert.equal(estado.generados, 1);
  assert.deepEqual(estado.subidos, ["t1/receipt_pdf/p4/current.pdf"]);
  assert.equal(estado.inserts.length, 1);
  assert.equal(estado.inserts[0].entity_type, "payment");
  assert.equal(estado.inserts[0].source, "auto_receipt_pdf");
  assert.equal(estado.inserts[0].source_content_hash, computeReceiptContentHash(buildReceiptPdfPayload(b)));
});

test("ensure: mismo hash y blob presente → cache hit, no regenera", { skip: skipNoMocks }, async () => {
  const b = bundle();
  const hash = computeReceiptContentHash(buildReceiptPdfPayload(b));
  reset(b, { id: "d1", storage_key: "t1/receipt_pdf/p4/current.pdf", source_version: 3, source_content_hash: hash, file_name: "REC-000004.pdf" });
  const r = await ensureReceiptPdfRow(fakeDb() as never, CTX, "p4");
  assert.ok(r);
  assert.equal(r.regenerated, false);
  assert.equal(r.version, 3);
  assert.equal(estado.generados, 0);
  assert.equal(estado.updates.length, 0);
});

test("ensure: el cobro se reversó → el hash difiere, regenera y sube la versión", { skip: skipNoMocks }, async () => {
  const antes = computeReceiptContentHash(buildReceiptPdfPayload(bundle()));
  const b = bundle({}, { entry_number: 23, reversed_at: "2026-09-21T20:00:00Z", reason: "Cheque devuelto" });
  reset(b, { id: "d1", storage_key: "t1/receipt_pdf/p4/current.pdf", source_version: 1, source_content_hash: antes, file_name: "REC-000004.pdf" });
  const r = await ensureReceiptPdfRow(fakeDb() as never, CTX, "p4");
  assert.ok(r);
  assert.equal(r.regenerated, true);
  assert.equal(r.version, 2);
  assert.equal(estado.generados, 1);
  assert.equal(estado.updates.length, 1);
  assert.equal(estado.updates[0].source_version, 2);
});

test("ensure: hash igual pero el blob no está → regenera (no sirve un enlace roto)", { skip: skipNoMocks }, async () => {
  const b = bundle();
  const hash = computeReceiptContentHash(buildReceiptPdfPayload(b));
  reset(b, { id: "d1", storage_key: "t1/receipt_pdf/p4/current.pdf", source_version: 1, source_content_hash: hash, file_name: "REC-000004.pdf" });
  estado.blobExiste = false;
  const r = await ensureReceiptPdfRow(fakeDb() as never, CTX, "p4");
  assert.equal(r?.regenerated, true);
  assert.equal(estado.generados, 1);
});

// ---------------------------------------------------------------------------
// 3. Los roles de la ruta: los mismos que el PDF de la factura
// ---------------------------------------------------------------------------

const ROOT = process.cwd();
const rolesDe = (rel: string): string[] => {
  const src = readFileSync(join(ROOT, rel), "utf8");
  const m = src.match(/const ALLOWED_ROLES = \[([^\]]+)\] as const;/);
  assert.ok(m, `${rel}: no se encontró ALLOWED_ROLES`);
  return m[1].split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean);
};

test("la ruta del PDF del recibo declara los MISMOS roles que la del PDF de la factura", () => {
  assert.deepEqual(
    rolesDe("src/app/api/finanzas/payments/[id]/pdf/route.ts"),
    rolesDe("src/app/api/finanzas/invoices/[id]/pdf/route.ts")
  );
  assert.deepEqual(rolesDe("src/app/api/finanzas/payments/[id]/pdf/route.ts"), ["admin", "abogada", "contador"]);
});

test("la ruta del PDF del recibo devuelve el archivo, no un enlace a supabase.co", () => {
  const src = readFileSync(join(ROOT, "src/app/api/finanzas/payments/[id]/pdf/route.ts"), "utf8");
  assert.match(src, /serveStorageFile\(/);
  assert.doesNotMatch(src, /getPublicUrl/);
  assert.doesNotMatch(src, /signedUrl\s*\}/, "no responde { url: signedUrl }");
});
