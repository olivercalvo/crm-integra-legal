/**
 * LO QUE DICE UN CUFE ADENTRO, y si coincide con la factura que se está cargando.
 *
 * Lo usa «Registrar factura emitida fuera» (`092`): una factura que la DGI ya
 * autorizó desde otro punto (QuickBooks 050, portal 100) entra al CRM con su
 * CUFE. El CUFE no es un número opaco: trae el tipo de documento, la fecha, el
 * número y el punto. Si lo que se cargó no coincide con lo que dice el CUFE, lo
 * más probable es que se haya pegado el CUFE de OTRA factura (las dos de MEI
 * Tower del 14/07 difieren en un solo dígito), y eso no se deja guardar.
 *
 * Estructura (66 caracteres), verificada el 05/10/2026 contra los 238
 * documentos del facturador (enero a octubre, puntos 050, 051 y 100, tipos 01,
 * 04, 06 y 09), sin una sola excepción:
 *
 *   FE | tipo(2) | tipoRuc(1) | RUC(20) | DV(3) | sucursal(4) | AAAAMMDD(8) |
 *   número(10) | punto(3) | tipoEmisión(2) | ambiente(1) | seguridad(9) | dv(1)
 *
 * 🔴 EL CUFE NO TRAE EL MONTO. La base y el ITBMS se comparan contra lo que la
 *    persona copia del documento autorizado (la columna «Monto total» y el
 *    ITBMS del facturador), no contra el CUFE. Lo dice la pantalla.
 *
 * 🔒 La MISMA lectura vive en el RPC `register_external_invoice` (posiciones
 *    1-based 3, 33, 41, 51 y 56). La base vuelve a leerlo: no le cree a esto.
 *
 * Módulo PURO: sin I/O.
 */

export const CUFE_LARGO = 66;

/** El punto de facturación del CRM en producción. Lo de ahí lo emitió el CRM. */
export const PUNTO_DEL_CRM = "051";

/** Tipos de documento que pueden entrar como factura emitida fuera. */
export const TIPO_DE_KIND = {
  HONORARIOS: "01",
  REEMBOLSO: "09",
} as const;

export type KindExterno = keyof typeof TIPO_DE_KIND;

/** Nombre del punto, para mostrarlo. Los que no están acá se muestran por número. */
export const NOMBRE_DE_PUNTO: Record<string, string> = {
  "050": "QuickBooks",
  "051": "CRM",
  "100": "portal de facturación",
};

export interface CufeLeido {
  /** Normalizado: sin espacios, en mayúsculas. */
  cufe: string;
  /** `01` factura, `09` reembolso, `04`/`06` NC, `05`/`07` ND… */
  tipo: string;
  /** `YYYY-MM-DD`. */
  fecha: string;
  numero: number;
  /** Tres dígitos, con ceros: `100`, `050`. */
  punto: string;
  /** `1` producción, `2` pruebas. */
  ambiente: string;
  /** El RUC del emisor, sin el relleno de ceros a la izquierda. */
  rucEmisor: string;
}

export type ResultadoDeLectura =
  | { ok: true; leido: CufeLeido }
  | { ok: false; mensaje: string };

/** Quita todos los espacios (el portal lo muestra cortado en líneas) y pasa a mayúsculas. */
export function normalizarCufe(entrada: string | null | undefined): string {
  return String(entrada ?? "").replace(/\s+/g, "").toUpperCase();
}

export function leerCufe(entrada: string | null | undefined): ResultadoDeLectura {
  const cufe = normalizarCufe(entrada);
  if (cufe.length === 0) {
    return { ok: false, mensaje: "Pega el CUFE de la factura." };
  }
  if (!cufe.startsWith("FE")) {
    return {
      ok: false,
      mensaje: "El CUFE empieza con FE. Revisa que no sea el número de protocolo ni el de autorización.",
    };
  }
  if (cufe.length !== CUFE_LARGO) {
    return {
      ok: false,
      mensaje:
        `El CUFE tiene ${CUFE_LARGO} caracteres y este tiene ${cufe.length}. ` +
        "Puede que se haya copiado cortado o de más.",
    };
  }

  const tipo = cufe.slice(2, 4);
  const ruc = cufe.slice(5, 25);
  const fechaTxt = cufe.slice(32, 40);
  const numeroTxt = cufe.slice(40, 50);
  const punto = cufe.slice(50, 53);
  const ambiente = cufe.slice(55, 56);

  if (!/^\d{2}$/.test(tipo) || !/^\d{8}$/.test(fechaTxt) || !/^\d{10}$/.test(numeroTxt) || !/^\d{3}$/.test(punto)) {
    return {
      ok: false,
      mensaje: "El CUFE no tiene la forma de la DGI: no se pueden leer su fecha, su número o su punto.",
    };
  }

  const fecha = `${fechaTxt.slice(0, 4)}-${fechaTxt.slice(4, 6)}-${fechaTxt.slice(6, 8)}`;
  const d = new Date(`${fecha}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== fecha) {
    return { ok: false, mensaje: `El CUFE trae una fecha que no existe (${fechaTxt}).` };
  }

  return {
    ok: true,
    leido: {
      cufe,
      tipo,
      fecha,
      numero: Number(numeroTxt),
      punto,
      ambiente,
      rucEmisor: ruc.replace(/^0+/, ""),
    },
  };
}

/** Lo que se cargó en el formulario y tiene que coincidir con el CUFE. */
export interface DatosCargados {
  invoice_kind: string;
  issue_date: string;
  punto: string;
  numero_documento: number | null;
}

/**
 * Los desacuerdos entre el CUFE y lo cargado, cada uno con el campo del
 * formulario donde se pinta. Vacío = coinciden.
 */
export function compararCufeConFactura(
  leido: CufeLeido,
  cargado: DatosCargados
): Record<string, string> {
  const errores: Record<string, string> = {};

  const tipoEsperado = TIPO_DE_KIND[cargado.invoice_kind as KindExterno];
  if (!tipoEsperado) {
    errores.invoice_kind = "Una factura emitida fuera es de honorarios (tipo 01) o de reembolso (tipo 09).";
  } else if (leido.tipo !== tipoEsperado) {
    errores.invoice_kind =
      `El CUFE es de un documento tipo ${leido.tipo} y se eligió ` +
      `${cargado.invoice_kind === "HONORARIOS" ? "honorarios (tipo 01)" : "reembolso (tipo 09)"}.`;
  }

  if (leido.fecha !== cargado.issue_date) {
    errores.issue_date = `El CUFE es de un documento del ${fechaCorta(leido.fecha)}.`;
  }

  const punto = normalizarPunto(cargado.punto);
  if (leido.punto !== punto) {
    errores.punto = `El CUFE es del punto ${leido.punto}.`;
  }
  if (cargado.numero_documento === null || leido.numero !== cargado.numero_documento) {
    errores.numero_documento = `El CUFE es del documento n.º ${leido.numero}.`;
  }

  if (leido.punto === PUNTO_DEL_CRM) {
    errores.cufe =
      "Ese CUFE es del punto 051, que es el del CRM: esa factura ya la emitió el CRM. Búscala en el listado de facturas.";
  } else if (leido.ambiente !== "1") {
    errores.cufe = "Ese CUFE es del ambiente de pruebas de la DGI, no de un documento real.";
  }

  return errores;
}

/** `"100"`, `"50"` → `"050"`. Vacío o no numérico queda como vino, para que falle la comparación. */
export function normalizarPunto(punto: string | null | undefined): string {
  const s = String(punto ?? "").trim();
  return /^\d{1,3}$/.test(s) ? s.padStart(3, "0") : s;
}

/** La referencia externa del asiento: `100-0000000002`. La misma que arma el RPC. */
export function referenciaFiscal(punto: string, numero: number): string {
  return `${normalizarPunto(punto)}-${String(numero).padStart(10, "0")}`;
}

function fechaCorta(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
