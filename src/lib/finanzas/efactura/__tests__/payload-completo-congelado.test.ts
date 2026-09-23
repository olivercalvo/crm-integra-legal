/**
 * ═══════════════════════════════════════════════════════════════════════════
 * EL PAYLOAD COMPLETO, CONGELADO — la red que va ANTES del refactor
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `receptor-payload-congelado.test.ts` congela **sólo** el bloque
 * `informacionReceptor`. Este congela **todo el documento** que viaja al PAC:
 * `datosGenerales` entero (con `informacionEmisor` y `informacionReceptor`),
 * `listaItems` y `totales`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ AHORA Y NO DESPUÉS
 * ─────────────────────────────────────────────────────────────────────────────
 * El Bloque 9C va a extraer el orquestador de emisión para que la factura y la
 * nota de crédito sean dos instancias del mismo flujo. Ese refactor toca el
 * camino que **hoy autoriza facturas reales del bufete ante la DGI**, y una
 * regresión ahí no se descubre en desarrollo: se descubre como un rechazo de la
 * DGI sobre una factura real, delante del cliente, y el intento no se deshace.
 *
 * Así que la red se pone **antes**. Este archivo es el punto de comparación:
 * mientras el JSON esperado no cambie, el refactor no alteró lo que se manda.
 *
 * 🔴 EL REFACTOR Y ESTE JSON NUNCA VAN EN EL MISMO COMMIT.
 *    Si el diff del refactor incluye `payload-completo-esperado.json`, el
 *    congelamiento no probó nada: se actualizó la referencia junto con lo que
 *    tenía que verificar. Hay un test que lo hace cumplir en
 *    `golden-y-refactor-no-van-juntos.test.ts`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUÉ CONGELA Y POR QUÉ ESOS CUATRO CASOS
 * ─────────────────────────────────────────────────────────────────────────────
 *   · `01-honorarios`      — el caso corriente. `tipoDocumento` 01, CPBS de HON.
 *   · `09-reembolso`       — `tipoDocumento` 09, CPBS de REI. Lo derivó
 *                            `tipoDocumentoDeKind` el 17/09 y lo confirmó ideati;
 *                            es la rama que menos se ejerce y más caro sale.
 *   · `01-extranjero`      — receptor sin RUC panameño. Ejercita
 *                            `id_extranjero` / `pais_receptor` y el
 *                            `tipo_receptor_fe` 04 (no residente).
 *   · `01-multilinea-mixta`— tres líneas con tasas 7%, 0% y exento, cantidades
 *                            que no son 1 y precios con decimales. Es el caso
 *                            donde `mapTotales` puede redondear distinto sin que
 *                            nadie lo note.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CÓMO SE ACTUALIZA CUANDO EL CAMBIO ES INTENCIONAL
 * ─────────────────────────────────────────────────────────────────────────────
 *     ACTUALIZAR_PAYLOAD=1 npm test
 *
 * Después: mirar el diff campo por campo, y commitear el JSON **junto con** el
 * cambio del mapper que lo justifica, explicando en el mensaje por qué el
 * payload cambia. Un commit que **sólo** toca el JSON esperado es una alarma.
 *
 * ⚠️ Antes de dar por buena una diferencia, probarla contra el **sandbox**
 * (`EFACTURA_I_AMB=2`). Nunca contra el ambiente real.
 *
 * Ejecución:  npm test
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { mapInvoiceToEfacturaRequest } from "@/lib/finanzas/efactura/mapper/map-invoice";
import type { EmisorConfig } from "@/lib/finanzas/efactura/config/emisor-config";
import type {
  EfacturaBundleClient,
  EfacturaBundleInvoice,
  EfacturaBundleLine,
  InvoiceEfacturaBundle,
} from "@/lib/finanzas/efactura/data/invoice-efactura-bundle";

const ESPERADO = join(
  process.cwd(),
  "src/lib/finanzas/efactura/__tests__/payload-completo-esperado.json"
);

const ACTUALIZAR = process.env.ACTUALIZAR_PAYLOAD === "1";

// ---------------------------------------------------------------------------
// Fixtures — fijos y sin `new Date()`
// ---------------------------------------------------------------------------
/**
 * 🔴 `fechaEmision` SE PASA EXPLÍCITA. El mapper cae en `new Date()` si no se le
 * da una, y un golden que depende del reloj falla mañana por sí solo — y el
 * reflejo de quien lo ve fallar es regenerarlo, que es justo lo que este archivo
 * existe para impedir.
 */
const FECHA_FIJA = new Date("2026-09-15T14:30:00.000Z");

/** `iAmb: 2` — sandbox. Un fixture nunca describe el ambiente real. */
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

function clienteJuridico(): EfacturaBundleClient {
  return {
    name: "DISTRIBUIDORA PORTOBELO, S.A.",
    client_number: "CLI-001",
    client_status: "active",
    client_type: "persona_juridica",
    tax_id: "155123456-2-2015",
    tax_id_type: "ruc",
    ruc: null,
    email: "pagos@portobelo.test",
    phone: "+507-300-0000",
    address: "Vía España 100",
    digito_verificador: "05",
    tipo_receptor_fe: "01",
    codigo_ubicacion: "8-8-7",
    corregimiento: "Bella Vista",
    distrito: "Panamá",
    provincia: "Panamá",
    id_extranjero: null,
    pais_receptor: null,
  };
}

function clienteExtranjero(): EfacturaBundleClient {
  return {
    ...clienteJuridico(),
    name: "OFFSHORE HOLDINGS LTD",
    client_number: "CLI-099",
    client_type: "persona_juridica",
    tax_id: null,
    tax_id_type: "extranjero",
    ruc: null,
    digito_verificador: null,
    // 🔴 `04` = no residente. `03` NO lo es: exige RUC igual y el mapper corta
    // con "no tiene tax_id ni ruc". Se descubrió al escribir este golden.
    tipo_receptor_fe: "04",
    codigo_ubicacion: null,
    corregimiento: null,
    distrito: null,
    provincia: null,
    id_extranjero: "GB-8842119",
    pais_receptor: "GB",
  };
}

function factura(
  over: Partial<EfacturaBundleInvoice> = {}
): EfacturaBundleInvoice {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    invoice_number: "FAC-HON-000001",
    invoice_kind: "HONORARIOS",
    status: "emitida",
    issue_date: "2026-09-15",
    due_date: "2026-10-15",
    notes: null,
    subtotal_total: 1000,
    tax_total: 70,
    grand_total: 1070,
    ...over,
  };
}

function linea(over: Partial<EfacturaBundleLine> = {}): EfacturaBundleLine {
  const quantity = over.quantity ?? 1;
  const unit_price = over.unit_price ?? 1000;
  const tax_rate = over.tax_rate ?? 0.07;
  const subtotal = Number((quantity * unit_price).toFixed(2));
  const tax_amount = Number((subtotal * tax_rate).toFixed(2));
  return {
    line_order: 0,
    description: "Asesoría legal corporativa",
    quantity,
    unit_price,
    tax_code: tax_rate === 0.07 ? "ITBMS_7" : "EXENTO",
    tax_rate,
    subtotal,
    tax_amount,
    line_total: Number((subtotal + tax_amount).toFixed(2)),
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Los cuatro casos
// ---------------------------------------------------------------------------
interface Caso {
  clave: string;
  porque: string;
  bundle: InvoiceEfacturaBundle;
  sequence: { puntoFacturacion: string; numeroDocumento: number };
}

const l1 = linea();

const CASOS: Caso[] = [
  {
    clave: "01-honorarios",
    porque:
      "El caso corriente: honorarios a un cliente jurídico panameño. tipoDocumento 01 y el CPBS de HON.",
    bundle: { invoice: factura(), client: clienteJuridico(), lines: [l1] },
    sequence: { puntoFacturacion: "051", numeroDocumento: 101 },
  },
  {
    clave: "09-reembolso",
    porque:
      "tipoDocumento 09 derivado de invoice_kind por tipoDocumentoDeKind, y el CPBS de REI. " +
      "Es la rama que menos se ejerce y la más cara de romper: las 34 REI ya emitidas como 01 " +
      "no se corrigen (decisión de Josuarth), así que un error acá se arrastra.",
    bundle: {
      invoice: factura({
        invoice_number: "FAC-REI-000001",
        invoice_kind: "REEMBOLSO",
        subtotal_total: 250,
        tax_total: 0,
        grand_total: 250,
      }),
      client: clienteJuridico(),
      lines: [
        linea({
          description: "Tasa MICI — registro de marca",
          unit_price: 250,
          tax_rate: 0,
        }),
      ],
    },
    sequence: { puntoFacturacion: "051", numeroDocumento: 102 },
  },
  {
    clave: "01-extranjero",
    porque:
      "Receptor no residente (tipo_receptor_fe 04): va con grupoIdentificacionExtranjera y su " +
      "país, sin datosRucReceptor y sin ubicación. Es la rama que un cliente del exterior " +
      "ejercita y la facturación corriente no.",
    bundle: {
      invoice: factura({ invoice_number: "FAC-HON-000002" }),
      client: clienteExtranjero(),
      lines: [l1],
    },
    sequence: { puntoFacturacion: "051", numeroDocumento: 103 },
  },
  {
    clave: "01-multilinea-mixta",
    porque:
      "Tres líneas con 7%, 0% y exento, cantidades que no son 1 y precios con decimales. " +
      "Es donde mapTotales puede redondear distinto sin que nadie lo note hasta que la DGI " +
      "rechaza por descuadre de centavos.",
    bundle: {
      invoice: factura({
        invoice_number: "FAC-HON-000003",
        // 7,5 x 166 = 1245,00 (7%) + 3 x 62,50 = 187,50 (0%) + 2 x 200 = 400,00 (exento)
        // = 1832,50 de neto, 87,15 de ITBMS, 1919,65 de total.
        // 🔴 Los tres tienen que cerrar entre sí. La primera versión de este
        // fixture decía 1837,50 y congeló un documento donde totalNeto + ITBMS
        // no daba valorTotalFactura — un golden así fija un payload que la DGI
        // rechazaría, y el test habría pasado igual.
        subtotal_total: 1832.5,
        tax_total: 87.15,
        grand_total: 1919.65,
      }),
      client: clienteJuridico(),
      lines: [
        linea({
          line_order: 0,
          description: "Horas de asesoría",
          quantity: 7.5,
          unit_price: 166,
          tax_rate: 0.07,
        }),
        linea({
          line_order: 1,
          description: "Gestión ante registro público",
          quantity: 3,
          unit_price: 62.5,
          tax_rate: 0,
          tax_code: "ITBMS_0",
        }),
        linea({
          line_order: 2,
          description: "Servicio exento",
          quantity: 2,
          unit_price: 200,
          tax_rate: 0,
          tax_code: "EXENTO",
        }),
      ],
    },
    sequence: { puntoFacturacion: "051", numeroDocumento: 104 },
  },
];

// ---------------------------------------------------------------------------
// El congelamiento
// ---------------------------------------------------------------------------
/**
 * Se compara el JSON **serializado**, no el objeto. Es lo que de verdad viaja:
 * una clave que pasa a `undefined` desaparece del body y el PAC no la ve, pero
 * un `deepEqual` sobre objetos podría pasarla por alto según cómo se escriba.
 */
function generado(): Record<string, unknown> {
  const salida: Record<string, unknown> = {};
  for (const caso of CASOS) {
    const request = mapInvoiceToEfacturaRequest({
      bundle: caso.bundle,
      emisor: emisor(),
      sequence: caso.sequence,
      options: { fechaEmision: FECHA_FIJA },
    });
    salida[caso.clave] = {
      _porque: caso.porque,
      payload: JSON.parse(JSON.stringify(request)),
    };
  }
  return salida;
}

test("el payload completo no cambió", () => {
  const actual = generado();

  if (ACTUALIZAR) {
    writeFileSync(ESPERADO, JSON.stringify(actual, null, 2) + "\n", "utf8");
    console.log(
      `\n⚠️  payload-completo-esperado.json REGENERADO.\n` +
        `   Mirá el diff campo por campo y commitealo JUNTO con el cambio del mapper.\n` +
        `   Un commit que sólo toca este JSON es una alarma.\n`
    );
    return;
  }

  let esperado: Record<string, unknown>;
  try {
    esperado = JSON.parse(readFileSync(ESPERADO, "utf8"));
  } catch {
    assert.fail(
      `No se pudo leer ${ESPERADO}. Si es la primera corrida, generalo con ` +
        `ACTUALIZAR_PAYLOAD=1 npm test y revisá el resultado antes de commitear.`
    );
  }

  for (const caso of CASOS) {
    const a = (actual[caso.clave] as { payload: unknown })?.payload;
    const e = (esperado[caso.clave] as { payload: unknown })?.payload;
    assert.deepEqual(
      a,
      e,
      `\n\n🔴 El payload de "${caso.clave}" cambió.\n\n` +
        `   ${caso.porque}\n\n` +
        `   Obtenido:\n${JSON.stringify(a, null, 2)}\n\n` +
        `   Esperado:\n${JSON.stringify(e, null, 2)}\n\n` +
        `   Si el cambio es INTENCIONAL: ACTUALIZAR_PAYLOAD=1 npm test, revisá el diff,\n` +
        `   probalo contra el sandbox (EFACTURA_I_AMB=2) y commiteá el JSON junto con el\n` +
        `   cambio del mapper. NUNCA junto con un refactor.\n`
    );
  }

  assert.deepEqual(
    Object.keys(actual).sort(),
    Object.keys(esperado).sort(),
    "cambió el juego de casos congelados: agregar uno está bien, perder uno no"
  );
});

test("🔴 el tipoDocumento de cada caso es el que la DGI espera", () => {
  const g = generado();
  const tipo = (clave: string) =>
    (
      (g[clave] as { payload: { datosGenerales: { tipoDocumento: string } } })
        .payload.datosGenerales
    ).tipoDocumento;

  assert.equal(tipo("01-honorarios"), "01", "honorarios es operación interna");
  assert.equal(
    tipo("09-reembolso"),
    "09",
    "reembolso es 09 — confirmado por ideati el 17/09 y probado en sandbox"
  );
  assert.equal(tipo("01-extranjero"), "01");
  assert.equal(tipo("01-multilinea-mixta"), "01");
});

/**
 * 🔒 UN GOLDEN SOLO SIRVE SI CONGELA UN DOCUMENTO VÁLIDO.
 *
 * La primera versión del fixture multi-línea sumaba mal el encabezado (1837,50
 * donde las líneas daban 1832,50) y congeló un payload donde
 * `totalNeto + totalITBMS` no daba `valorTotalFactura`. El test de
 * congelamiento pasaba igual: comparaba contra sí mismo.
 *
 * Esto lo impide. No prueba al mapper contra la DGI —eso lo hace el sandbox—
 * pero sí que la referencia que estamos congelando no sea un disparate.
 */
test("🔒 todos los payloads congelados CUADRAN", () => {
  const g = generado();
  for (const caso of CASOS) {
    const t = (
      g[caso.clave] as {
        payload: {
          totales: {
            totalNeto: number;
            totalITBMS: number;
            valorTotalFactura: number;
          };
        };
      }
    ).payload.totales;

    const suma = Number((t.totalNeto + t.totalITBMS).toFixed(2));
    assert.equal(
      suma,
      t.valorTotalFactura,
      `"${caso.clave}": totalNeto (${t.totalNeto}) + totalITBMS (${t.totalITBMS}) ` +
        `= ${suma}, pero valorTotalFactura dice ${t.valorTotalFactura}. ` +
        `El fixture no cierra consigo mismo: arreglá el fixture, no el golden.`
    );
  }
});

test("la fecha del payload no depende del reloj", () => {
  const a = generado();
  const b = generado();
  assert.deepEqual(
    a,
    b,
    "dos corridas seguidas tienen que dar lo mismo: si no, hay un new Date() suelto"
  );
});
