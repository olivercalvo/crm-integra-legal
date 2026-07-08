/**
 * Unit tests del mapper eFactura PTY (Fase 2).
 *
 * Ejecución:
 *   npx tsx --test src/lib/finanzas/efactura/__tests__/map-invoice.test.ts
 *
 * Cubre los 8 casos confirmados:
 *   1. HON exento a cliente con RUC (tipoReceptorFe=01, ITBMS "00").
 *   2. Multi-línea HON + REI en la misma factura.
 *   3. Factura a crédito (due_date > issue_date) con grupoInformacionPago.
 *   4. Factura de contado (sin grupoInformacionPago).
 *   5. Receptor consumidor final (cédula → 02).
 *   6. Línea con tax_rate 0.07 → tasaITBMSAplicable "01".
 *   7. Tasa desconocida → error explícito.
 *   8. Totales (totalNeto, totalITBMS, valorTotalFactura) cuadran con la
 *      suma de líneas.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { mapInvoiceToEfacturaRequest } from "@/lib/finanzas/efactura/mapper/map-invoice";
import type { EmisorConfig } from "@/lib/finanzas/efactura/config/emisor-config";
import type {
  EfacturaBundleClient,
  EfacturaBundleInvoice,
  EfacturaBundleLine,
  InvoiceEfacturaBundle,
} from "@/lib/finanzas/efactura/data/invoice-efactura-bundle";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function emisor(): EmisorConfig {
  return {
    ruc: "1234567",
    digitoVerificador: "12",
    tipoContribuyente: 2,
    nombreORazonSocial: "Integra Legal, S.A.",
    codigoSucursal: "0000",
    direccionSucursal: "Calle 50, Edif. Ejemplo",
    ubicacion: {
      codigoUbicacion: "8-8-7",
      corregimiento: "Bella Vista",
      distrito: "Panamá",
      provincia: "Panamá",
    },
    telefonoSucursal: "+507-200-0000",
    direccionCorreoElectronico: "facturas@integra-panama.com",
    puntoFacturacion: "001",
    iAmb: 2,
    defaultTipoOperacion: 1,
    defaultDestinoOperacion: 1,
    defaultFormatoGeneracionCafe: 1,
    defaultManeraEntregaCafe: 1,
    defaultEnvioContenedorReceptor: 2,
    defaultProcesoGeneracionFe: 1,
    defaultTipoTransaccionVenta: 1,
    defaultTipoSucursal: 1,
    defaultFormaPago: "08",
    cpbsServiciosLegalesHon: 99999999,
    cpbsServiciosLegalesRei: 88888888,
  };
}

function clientContribuyente(
  overrides: Partial<EfacturaBundleClient> = {}
): EfacturaBundleClient {
  return {
    name: "Cliente Ejemplo S.A.",
    client_number: "CLI-001",
    client_status: "active",
    client_type: "persona_juridica",
    tax_id: "987654321-1",
    tax_id_type: "ruc",
    ruc: null,
    email: "contacto@ejemplo.com",
    phone: "+507-300-0000",
    address: "Avenida Balboa, Torre Ejemplo",
    digito_verificador: "33",
    tipo_receptor_fe: null,
    codigo_ubicacion: "8-8-7",
    corregimiento: "Bella Vista",
    distrito: "Panamá",
    provincia: "Panamá",
    id_extranjero: null,
    pais_receptor: null,
    ...overrides,
  };
}

function clientConsumidorFinal(): EfacturaBundleClient {
  return clientContribuyente({
    name: "Juan Pérez",
    client_number: "CLI-002",
    client_type: "persona_natural",
    tax_id: "8-123-456",
    tax_id_type: "cedula",
    digito_verificador: null,
    tipo_receptor_fe: null,
  });
}

function invoiceHon(
  overrides: Partial<EfacturaBundleInvoice> = {}
): EfacturaBundleInvoice {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    invoice_number: "FAC-HON-000001",
    invoice_kind: "HONORARIOS",
    status: "borrador",
    issue_date: "2026-05-30",
    due_date: "2026-05-30",
    notes: null,
    subtotal_total: 1000,
    tax_total: 0,
    grand_total: 1000,
    ...overrides,
  };
}

function line(over: Partial<EfacturaBundleLine> = {}): EfacturaBundleLine {
  const quantity = over.quantity ?? 1;
  const unit_price = over.unit_price ?? 1000;
  const tax_rate = over.tax_rate ?? 0;
  const subtotal = quantity * unit_price;
  const tax_amount = subtotal * tax_rate;
  const line_total = subtotal + tax_amount;
  return {
    line_order: 0,
    description: "Honorarios profesionales",
    quantity,
    unit_price,
    tax_code: "ITBMS_0",
    tax_rate,
    subtotal,
    tax_amount,
    line_total,
    ...over,
  };
}

function bundle(opts: {
  invoice?: Partial<EfacturaBundleInvoice>;
  client?: EfacturaBundleClient;
  lines?: EfacturaBundleLine[];
} = {}): InvoiceEfacturaBundle {
  return {
    invoice: invoiceHon(opts.invoice),
    client: opts.client ?? clientContribuyente(),
    lines: opts.lines ?? [line()],
  };
}

const sequence = { puntoFacturacion: "001", numeroDocumento: 1 };
const fechaFija = "2026-05-30";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("1. HON exento a cliente con RUC → tipoReceptorFe '01' y ITBMS '00'", () => {
  const req = mapInvoiceToEfacturaRequest({
    bundle: bundle(),
    emisor: emisor(),
    sequence,
    options: { fechaEmision: fechaFija },
  });

  assert.equal(req.datosGenerales.informacionReceptor.tipoReceptorFe, "01");
  assert.equal(
    req.datosGenerales.informacionReceptor.datosRucReceptor?.tipoContribuyente,
    2,
    "persona_juridica → tipoContribuyente=2"
  );
  assert.equal(
    req.datosGenerales.informacionReceptor.datosRucReceptor?.rucReceptor,
    "987654321-1"
  );
  assert.equal(req.listaItems.length, 1);
  assert.equal(req.listaItems[0].grupoITBMS.tasaITBMSAplicable, "00");
  assert.equal(req.listaItems[0].grupoITBMS.montoITBMS, 0);
  assert.equal(req.listaItems[0].codigoItemCodificacionPanamena, 99999999);
});

test("2. Factura multi-línea HON + REI con totales", () => {
  // Una factura del CRM es HON o REI (no mixta), así que armo una HON
  // con dos líneas: una honorario al 0% y un reembolso de viáticos al 0%.
  // El test valida que ambas se mapean correctamente con su CPBS.
  const linesArr: EfacturaBundleLine[] = [
    line({ line_order: 0, description: "Honorarios redacción", unit_price: 1500 }),
    line({ line_order: 1, description: "Mensajería judicial", unit_price: 25 }),
  ];
  const req = mapInvoiceToEfacturaRequest({
    bundle: bundle({
      invoice: { subtotal_total: 1525, tax_total: 0, grand_total: 1525 },
      lines: linesArr,
    }),
    emisor: emisor(),
    sequence,
    options: { fechaEmision: fechaFija },
  });

  assert.equal(req.listaItems.length, 2);
  assert.equal(req.listaItems[0].numeroSecuenciaItem, 1);
  assert.equal(req.listaItems[1].numeroSecuenciaItem, 2);
  // Por ser invoice_kind=HONORARIOS, ambas líneas usan cpbsHon.
  assert.equal(req.listaItems[0].codigoItemCodificacionPanamena, 99999999);
  assert.equal(req.listaItems[1].codigoItemCodificacionPanamena, 99999999);

  // Cubro REI en otro mapeo aparte: una factura kind=REEMBOLSO con la misma
  // estructura debe usar cpbsRei en sus items.
  const reqRei = mapInvoiceToEfacturaRequest({
    bundle: bundle({
      invoice: { invoice_kind: "REEMBOLSO", invoice_number: "FAC-REI-000001" },
    }),
    emisor: emisor(),
    sequence,
    options: { fechaEmision: fechaFija },
  });
  assert.equal(reqRei.listaItems[0].codigoItemCodificacionPanamena, 88888888);
});

test("3. Factura a crédito → tiempoPago=2 + grupoInformacionPago", () => {
  const req = mapInvoiceToEfacturaRequest({
    bundle: bundle({
      invoice: {
        issue_date: "2026-05-30",
        due_date: "2026-06-30",
      },
    }),
    emisor: emisor(),
    sequence,
    options: { fechaEmision: fechaFija },
  });

  assert.equal(req.totales.tiempoPago, 2);
  assert.ok(req.totales.grupoInformacionPago);
  assert.equal(req.totales.grupoInformacionPago!.length, 1);
  const cuota = req.totales.grupoInformacionPago![0];
  assert.equal(cuota.numeroSecuenciaCuota, 1);
  assert.equal(cuota.valorCuota, 1000);
  // El offset -05:00 está aplicado.
  assert.match(
    cuota.fechaVencimientoCuota,
    /^2026-06-30T00:00:00-05:00$/,
    `fechaVencimientoCuota debe ir con offset -05:00, recibido: ${cuota.fechaVencimientoCuota}`
  );
});

test("4. Factura de contado → tiempoPago=1 SIN grupoInformacionPago", () => {
  const req = mapInvoiceToEfacturaRequest({
    bundle: bundle(),
    emisor: emisor(),
    sequence,
    options: { fechaEmision: fechaFija },
  });

  assert.equal(req.totales.tiempoPago, 1);
  assert.equal(
    req.totales.grupoInformacionPago,
    undefined,
    "Contado no lleva grupoInformacionPago"
  );
  assert.equal(req.totales.grupoFormasPago?.length, 1);
  assert.equal(req.totales.grupoFormasPago?.[0].valorCuotaPagada, 1000);
  assert.equal(req.totales.grupoFormasPago?.[0].formaPago, "08");
});

test("5. Receptor consumidor final (cédula → '02')", () => {
  const req = mapInvoiceToEfacturaRequest({
    bundle: bundle({ client: clientConsumidorFinal() }),
    emisor: emisor(),
    sequence,
    options: { fechaEmision: fechaFija },
  });

  assert.equal(req.datosGenerales.informacionReceptor.tipoReceptorFe, "02");
  // '02' no lleva datosRucReceptor.
  assert.equal(
    req.datosGenerales.informacionReceptor.datosRucReceptor,
    undefined
  );
  assert.equal(
    req.datosGenerales.informacionReceptor.grupoIdentificacionExtranjera,
    undefined
  );
});

test("6. Línea con tax_rate 0.07 → tasaITBMSAplicable '01' + montoITBMS calculado", () => {
  const ln = line({ unit_price: 1000, tax_rate: 0.07 });
  const req = mapInvoiceToEfacturaRequest({
    bundle: bundle({
      invoice: { subtotal_total: 1000, tax_total: 70, grand_total: 1070 },
      lines: [ln],
    }),
    emisor: emisor(),
    sequence,
    options: { fechaEmision: fechaFija },
  });

  assert.equal(req.listaItems[0].grupoITBMS.tasaITBMSAplicable, "01");
  assert.equal(req.listaItems[0].grupoITBMS.montoITBMS, 70);
  assert.equal(req.totales.totalITBMS, 70);
  assert.equal(req.totales.totalGravado, 1000);
});

test("7. tax_rate fuera de la tabla → error explícito", () => {
  const ln = line({ unit_price: 1000, tax_rate: 0.05 });
  assert.throws(
    () =>
      mapInvoiceToEfacturaRequest({
        bundle: bundle({ lines: [ln] }),
        emisor: emisor(),
        sequence,
        options: { fechaEmision: fechaFija },
      }),
    /Tasa ITBMS desconocida/i
  );
});

test("8. Totales cuadran con la suma de líneas (multi-tasa)", () => {
  const linesArr: EfacturaBundleLine[] = [
    line({ line_order: 0, unit_price: 1000, tax_rate: 0 }),        // 1000 + 0
    line({ line_order: 1, unit_price: 500, tax_rate: 0.07 }),       // 500 + 35
    line({ line_order: 2, unit_price: 300, tax_rate: 0.10, description: "Bienes suntuarios" }), // 300 + 30
  ];
  const expectedSubtotal = 1000 + 500 + 300;
  const expectedTax = 0 + 35 + 30;
  const expectedGrand = expectedSubtotal + expectedTax;

  const req = mapInvoiceToEfacturaRequest({
    bundle: bundle({
      invoice: {
        subtotal_total: expectedSubtotal,
        tax_total: expectedTax,
        grand_total: expectedGrand,
      },
      lines: linesArr,
    }),
    emisor: emisor(),
    sequence,
    options: { fechaEmision: fechaFija },
  });

  assert.equal(req.totales.totalNeto, expectedSubtotal);
  assert.equal(req.totales.totalITBMS, expectedTax);
  assert.equal(req.totales.valorTotalFactura, expectedGrand);
  // totalGravado = solo las líneas con tax_rate > 0.
  assert.equal(req.totales.totalGravado, 500 + 300);
  assert.equal(req.totales.numeroTotalItems, 3);
  assert.equal(req.totales.totalTodosItems, expectedGrand);
  assert.equal(req.totales.sumaValoresRecibidos, expectedGrand);
});

// ---------------------------------------------------------------------------
// Smoke checks de los campos estructurales (no se cuentan en los 8 casos)
// ---------------------------------------------------------------------------

test("smoke: fechaEmision se serializa con offset -05:00", () => {
  const req = mapInvoiceToEfacturaRequest({
    bundle: bundle(),
    emisor: emisor(),
    sequence,
    options: { fechaEmision: "2026-05-30" },
  });
  assert.match(
    req.datosGenerales.fechaEmision,
    /^2026-05-30T00:00:00-05:00$/,
    `fechaEmision debe ir con offset -05:00, recibido: ${req.datosGenerales.fechaEmision}`
  );
});

test("smoke: defaults DGI se inyectan desde EmisorConfig", () => {
  const req = mapInvoiceToEfacturaRequest({
    bundle: bundle(),
    emisor: emisor(),
    sequence,
    options: { fechaEmision: fechaFija },
  });
  assert.equal(req.datosGenerales.tipoOperacion, 1);
  assert.equal(req.datosGenerales.destinoOperacion, 1);
  assert.equal(req.datosGenerales.formatoGeneracionCafe, 1);
  assert.equal(req.datosGenerales.tipoEmision, "01");
  assert.equal(req.datosGenerales.tipoDocumento, "01");
  assert.equal(req.datosGenerales.puntoFacturacion, "001");
  assert.equal(req.datosGenerales.numeroDocumento, 1);
});
