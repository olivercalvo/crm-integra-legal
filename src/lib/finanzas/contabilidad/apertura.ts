/**
 * ASIENTO DE APERTURA (100/101) · lógica PURA: validar la plantilla y armar el
 * «Cuadre al corte». Sin I/O: lo llaman la pantalla, la ruta y los tests.
 *
 * Los saldos al corte salen de los LIBROS DEL CONTADOR (QuickBooks). La plantilla
 * que baja el CRM viene precargada sólo con lo que el CRM conoce (hoy, una
 * factura real anterior al inicio contable): es una ayuda, no la fuente.
 *
 * Reglas (las mismas que vuelve a exigir post_apertura en la base):
 *   · débitos = créditos; cada fila débito O crédito, positivo, dos decimales;
 *   · cuenta existente y activa;
 *   · 100004 / 200001 (cuentas control): tercero obligatorio (cliente en
 *     100004, proveedor en 200001), real, con documento externo y fecha del
 *     documento no posterior a la apertura;
 *   · al cierre del año fiscal (31/12) sólo cuentas de balance;
 *   · no se repite el par tercero + documento.
 */

import {
  FORMATO_DE_FECHA_POR_DEFECTO,
  parsearFecha,
  parsearMonto,
  type FormatoDeFecha,
} from "@/lib/finanzas/import/asientos-import";

export const ENCABEZADOS_APERTURA = [
  "Cuenta",
  "Tercero",
  "Documento externo",
  "Fecha del documento",
  "Vencimiento",
  "Débito",
  "Crédito",
] as const;

/** El texto de la hoja Léame y de la pantalla: de dónde salen los saldos. */
export const AVISO_FUENTE_DE_LA_APERTURA =
  "Los saldos de la apertura salen de los libros del contador (QuickBooks), incluidas las cuentas por cobrar y por pagar al corte. " +
  "Lo que viene precargado es sólo lo que el CRM conoce de antes del inicio contable: una ayuda para empezar, no la fuente. " +
  "Revisa cada saldo contra los libros y completa lo que falte.";

export type CuentaControl = "clientes" | "proveedores";

export interface CuentaDeApertura {
  code: string;
  name: string;
  account_type: string;
  active: boolean;
  cuenta_control: CuentaControl | null;
}

export interface ContextoDeApertura {
  /** AAAA-MM-DD: la fecha efectiva (parámetro, o el día anterior al inicio). */
  fechaApertura: string;
  cuentas: Map<string, CuentaDeApertura>;
  /** `client_number` en mayúsculas → { id, nombre, dePrueba }. */
  clientes: Map<string, { id: string; nombre: string; dePrueba: boolean }>;
  /** `supplier_number` en mayúsculas → { id, nombre }. */
  proveedores: Map<string, { id: string; nombre: string }>;
  /**
   * Cómo leer una fecha escrita como TEXTO `nn/nn/AAAA` (08/10/2026). Sin dato,
   * el de la pantalla: MM/DD (decisión (c)). Una celda de fecha de Excel, como la
   * de la plantilla, no depende de esto.
   */
  formatoDeFecha?: FormatoDeFecha;
}

export interface ErrorDeApertura {
  fila: number;
  columna: string;
  mensaje: string;
}

export interface LineaDeApertura {
  fila: number;
  account_code: string;
  debit: number;
  credit: number;
  description: string;
  client_id: string | null;
  supplier_id: string | null;
  tercero: string | null;
  terceroNombre: string | null;
  documento_externo: string | null;
  fecha_documento: string | null;
  vencimiento: string | null;
}

export interface ResultadoDeApertura {
  lineas: LineaDeApertura[];
  errores: ErrorDeApertura[];
  totalDebitos: number;
  totalCreditos: number;
  porCuenta: { cuenta: string; nombre: string; debito: number; credito: number }[];
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const fechaCorta = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`;
const TIPOS_DE_RESULTADO = new Set(["income", "cost", "expense"]);

/** ¿La apertura es al cierre del año fiscal (31/12)? Entonces sólo balance. */
export function esCierreDelAnio(fecha: string): boolean {
  return fecha.slice(5) === "12-31";
}

export function validarApertura(matriz: unknown[][], ctx: ContextoDeApertura): ResultadoDeApertura {
  const errores: ErrorDeApertura[] = [];
  const lineas: LineaDeApertura[] = [];
  const err = (fila: number, columna: string, mensaje: string) => errores.push({ fila, columna, mensaje });
  const formato = ctx.formatoDeFecha ?? FORMATO_DE_FECHA_POR_DEFECTO;
  const ejemploDeFecha = formato === "MM/DD" ? "MM/DD/AAAA" : "DD/MM/AAAA";

  const cab = (matriz[0] ?? []).map((c) => String(c ?? "").trim().toLowerCase());
  const col = new Map<string, number>();
  const faltan: string[] = [];
  for (const h of ENCABEZADOS_APERTURA) {
    const i = cab.indexOf(h.toLowerCase());
    if (i < 0 && h !== "Vencimiento") faltan.push(h);
    col.set(h, i);
  }
  if (faltan.length > 0) {
    err(1, "Encabezados", `Faltan columnas: ${faltan.join(", ")}. Usa la plantilla de apertura.`);
    return { lineas, errores, totalDebitos: 0, totalCreditos: 0, porCuenta: [] };
  }
  const celda = (fila: unknown[], h: (typeof ENCABEZADOS_APERTURA)[number]) => {
    const i = col.get(h) ?? -1;
    return i >= 0 ? fila[i] : null;
  };
  const texto = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

  const vistos = new Set<string>();
  for (let i = 1; i < matriz.length; i++) {
    const f = matriz[i] ?? [];
    const n = i + 1;
    if (f.every((c) => texto(c) === "")) continue;

    const codigo = texto(celda(f, "Cuenta"));
    const cuenta = ctx.cuentas.get(codigo);
    if (!codigo) err(n, "Cuenta", "Falta la cuenta.");
    else if (!cuenta) err(n, "Cuenta", `La cuenta ${codigo} no existe en el plan de cuentas.`);
    else if (!cuenta.active) err(n, "Cuenta", `La cuenta ${codigo} está inactiva.`);
    else if (esCierreDelAnio(ctx.fechaApertura) && TIPOS_DE_RESULTADO.has(cuenta.account_type)) {
      err(n, "Cuenta",
        `La apertura es al ${fechaCorta(ctx.fechaApertura)} (cierre del año): lleva sólo cuentas de balance. ` +
          `El resultado del año va en resultados acumulados, no en ${codigo}.`);
    }

    const deb = parsearMonto(celda(f, "Débito"));
    const cre = parsearMonto(celda(f, "Crédito"));
    if (!deb.ok) err(n, "Débito", deb.mensaje);
    if (!cre.ok) err(n, "Crédito", cre.mensaje);
    const d = deb.ok ? deb.valor : 0;
    const c = cre.ok ? cre.valor : 0;
    if (deb.ok && cre.ok) {
      if (d > 0 && c > 0) err(n, "Débito", "Cada fila lleva débito o crédito, nunca los dos.");
      if (d === 0 && c === 0) err(n, "Débito", "La fila no tiene monto.");
    }

    // Tercero y documento.
    const codTercero = texto(celda(f, "Tercero")).toUpperCase();
    const documento = texto(celda(f, "Documento externo")) || null;
    const crudoFecha = celda(f, "Fecha del documento");
    const fechaDoc = parsearFecha(crudoFecha, formato);
    const crudoVence = celda(f, "Vencimiento");
    const vence = parsearFecha(crudoVence, formato);
    if (texto(crudoFecha) !== "" && !fechaDoc) err(n, "Fecha del documento", `«${texto(crudoFecha)}» no es una fecha (${ejemploDeFecha}).`);
    if (texto(crudoVence) !== "" && !vence) err(n, "Vencimiento", `«${texto(crudoVence)}» no es una fecha (${ejemploDeFecha}).`);
    if (fechaDoc && fechaDoc > ctx.fechaApertura) {
      err(n, "Fecha del documento", `La fecha del documento (${fechaCorta(fechaDoc)}) es posterior a la apertura (${fechaCorta(ctx.fechaApertura)}).`);
    }

    let clientId: string | null = null;
    let supplierId: string | null = null;
    let nombre: string | null = null;
    const control = cuenta?.cuenta_control ?? null;
    if (codTercero) {
      const cli = ctx.clientes.get(codTercero);
      const prv = ctx.proveedores.get(codTercero);
      if (control === "clientes" && !cli) err(n, "Tercero", `${codTercero} no es un cliente: la cuenta ${codigo} lleva un cliente (CLI-…).`);
      else if (control === "proveedores" && !prv) err(n, "Tercero", `${codTercero} no es un proveedor: la cuenta ${codigo} lleva un proveedor (PRV-…).`);
      else if (!cli && !prv) err(n, "Tercero", `No hay un cliente ni un proveedor con el código ${codTercero}.`);
      if (cli?.dePrueba) err(n, "Tercero", `El cliente ${codTercero} está marcado de prueba: no entra al libro.`);
      if (cli && control !== "proveedores") { clientId = cli.id; nombre = cli.nombre; }
      else if (prv) { supplierId = prv.id; nombre = prv.nombre; }
    }
    if (control) {
      if (!codTercero) err(n, "Tercero", `La cuenta ${codigo} lleva el ${control === "clientes" ? "cliente (CLI-…)" : "proveedor (PRV-…)"}.`);
      if (!documento) err(n, "Documento externo", `La cuenta ${codigo} lleva el documento (la factura del cliente o del proveedor).`);
      if (!fechaDoc && texto(crudoFecha) === "") err(n, "Fecha del documento", `La cuenta ${codigo} lleva la fecha del documento.`);
      const clave = `${codTercero}|${(documento ?? "").toUpperCase()}`;
      if (codTercero && documento) {
        if (vistos.has(clave)) err(n, "Documento externo", `El documento ${documento} de ${codTercero} está repetido.`);
        vistos.add(clave);
      }
    }

    lineas.push({
      fila: n,
      account_code: codigo,
      debit: d,
      credit: c,
      description: documento ? `Apertura: ${documento}` : `Apertura: ${cuenta?.name ?? codigo}`,
      client_id: clientId,
      supplier_id: supplierId,
      tercero: codTercero || null,
      terceroNombre: nombre,
      documento_externo: documento,
      fecha_documento: fechaDoc ?? (control ? null : ctx.fechaApertura),
      vencimiento: vence,
    });
  }

  const totalDebitos = r2(lineas.reduce((s, l) => s + l.debit, 0));
  const totalCreditos = r2(lineas.reduce((s, l) => s + l.credit, 0));
  if (lineas.length < 2) err(1, "Archivo", "La apertura necesita al menos dos filas.");
  else if (Math.abs(totalDebitos - totalCreditos) >= 0.005) {
    err(1, "Débito", `No cuadra: débitos ${totalDebitos.toFixed(2)} y créditos ${totalCreditos.toFixed(2)} (diferencia ${r2(totalDebitos - totalCreditos).toFixed(2)}).`);
  }

  const m = new Map<string, { cuenta: string; nombre: string; debito: number; credito: number }>();
  for (const l of lineas) {
    const t = m.get(l.account_code) ?? { cuenta: l.account_code, nombre: ctx.cuentas.get(l.account_code)?.name ?? "", debito: 0, credito: 0 };
    t.debito = r2(t.debito + l.debit);
    t.credito = r2(t.credito + l.credit);
    m.set(l.account_code, t);
  }
  return {
    lineas,
    errores,
    totalDebitos,
    totalCreditos,
    porCuenta: Array.from(m.values()).sort((a, b) => a.cuenta.localeCompare(b.cuenta)),
  };
}

// ---------------------------------------------------------------------------
// Cuadre al corte
// ---------------------------------------------------------------------------

export type LadoDelCuadre = "cliente" | "proveedor";

/** Un saldo de un tercero por documento, de un lado o del otro. */
export interface SaldoDeDocumento {
  lado: LadoDelCuadre;
  terceroId: string;
  terceroCodigo: string | null;
  terceroNombre: string;
  documento: string | null;
  fecha: string | null;
  saldo: number;
}

export type EstadoDelCuadre = "cuadra" | "difiere" | "solo_en_la_apertura" | "solo_en_el_crm";

export interface FilaDelCuadre {
  lado: LadoDelCuadre;
  terceroId: string;
  terceroCodigo: string | null;
  terceroNombre: string;
  segunApertura: number;
  segunCrm: number;
  diferencia: number;
  estado: EstadoDelCuadre;
  documentos: { documento: string; segunApertura: number; segunCrm: number; diferencia: number }[];
}

export interface CuadreAlCorte {
  filas: FilaDelCuadre[];
  totales: Record<LadoDelCuadre, { segunApertura: number; segunCrm: number; diferencia: number }>;
}

export const ETIQUETA_DEL_ESTADO: Record<EstadoDelCuadre, string> = {
  cuadra: "Cuadra",
  difiere: "Difiere",
  solo_en_la_apertura: "Sólo en la apertura",
  solo_en_el_crm: "Sólo en el CRM",
};

/**
 * Por tercero: la apertura contra los documentos del CRM al corte. El detalle
 * por documento empareja el documento externo con el número del CRM.
 */
export function cuadreAlCorte(apertura: SaldoDeDocumento[], crm: SaldoDeDocumento[]): CuadreAlCorte {
  const porTercero = new Map<string, FilaDelCuadre>();
  const docs = new Map<string, Map<string, { segunApertura: number; segunCrm: number }>>();
  const sumar = (s: SaldoDeDocumento, deLaApertura: boolean) => {
    const clave = `${s.lado}:${s.terceroId}`;
    const f = porTercero.get(clave) ?? {
      lado: s.lado, terceroId: s.terceroId, terceroCodigo: s.terceroCodigo, terceroNombre: s.terceroNombre,
      segunApertura: 0, segunCrm: 0, diferencia: 0, estado: "cuadra" as EstadoDelCuadre, documentos: [],
    };
    if (deLaApertura) f.segunApertura = r2(f.segunApertura + s.saldo);
    else f.segunCrm = r2(f.segunCrm + s.saldo);
    if (!f.terceroCodigo && s.terceroCodigo) f.terceroCodigo = s.terceroCodigo;
    porTercero.set(clave, f);
    const d = docs.get(clave) ?? new Map();
    const k = (s.documento ?? "(sin documento)").trim().toUpperCase();
    const x = d.get(k) ?? { segunApertura: 0, segunCrm: 0 };
    if (deLaApertura) x.segunApertura = r2(x.segunApertura + s.saldo);
    else x.segunCrm = r2(x.segunCrm + s.saldo);
    d.set(k, x);
    docs.set(clave, d);
  };
  for (const s of apertura) sumar(s, true);
  for (const s of crm) sumar(s, false);

  const totales: CuadreAlCorte["totales"] = {
    cliente: { segunApertura: 0, segunCrm: 0, diferencia: 0 },
    proveedor: { segunApertura: 0, segunCrm: 0, diferencia: 0 },
  };
  const filas = Array.from(porTercero.entries()).map(([clave, f]) => {
    f.diferencia = r2(f.segunApertura - f.segunCrm);
    const tieneA = Math.abs(f.segunApertura) >= 0.005;
    const tieneC = Math.abs(f.segunCrm) >= 0.005;
    f.estado = Math.abs(f.diferencia) < 0.005 ? "cuadra" : tieneA && !tieneC ? "solo_en_la_apertura" : !tieneA && tieneC ? "solo_en_el_crm" : "difiere";
    f.documentos = Array.from((docs.get(clave) ?? new Map()).entries())
      .map(([documento, v]) => ({ documento, ...v, diferencia: r2(v.segunApertura - v.segunCrm) }))
      .sort((a, b) => a.documento.localeCompare(b.documento));
    const t = totales[f.lado];
    t.segunApertura = r2(t.segunApertura + f.segunApertura);
    t.segunCrm = r2(t.segunCrm + f.segunCrm);
    t.diferencia = r2(t.segunApertura - t.segunCrm);
    return f;
  });
  filas.sort((a, b) => a.lado.localeCompare(b.lado) || Math.abs(b.diferencia) - Math.abs(a.diferencia) || a.terceroNombre.localeCompare(b.terceroNombre, "es"));
  return { filas, totales };
}

/** Las líneas validadas de la plantilla como saldos de la apertura (para la vista previa del cuadre). */
export function saldosDeLasLineas(lineas: LineaDeApertura[], cuentas: Map<string, CuentaDeApertura>): SaldoDeDocumento[] {
  const out: SaldoDeDocumento[] = [];
  for (const l of lineas) {
    const control = cuentas.get(l.account_code)?.cuenta_control;
    if (control === "clientes" && l.client_id) {
      out.push({ lado: "cliente", terceroId: l.client_id, terceroCodigo: l.tercero, terceroNombre: l.terceroNombre ?? "",
        documento: l.documento_externo, fecha: l.fecha_documento, saldo: r2(l.debit - l.credit) });
    } else if (control === "proveedores" && l.supplier_id) {
      out.push({ lado: "proveedor", terceroId: l.supplier_id, terceroCodigo: l.tercero, terceroNombre: l.terceroNombre ?? "",
        documento: l.documento_externo, fecha: l.fecha_documento, saldo: r2(l.credit - l.debit) });
    }
  }
  return out;
}
