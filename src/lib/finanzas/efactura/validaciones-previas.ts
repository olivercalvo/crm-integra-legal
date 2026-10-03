/**
 * VALIDACIONES PREVIAS A LA DGI: lo que el PAC rechazaría, verificado ANTES de
 * tomar número.
 *
 * Por qué existe (03/10/2026): 4 facturas de producción (FAC-HON-000489, 000496,
 * 000503, 000508) quedaron emitidas sin llegar a la DGI y nadie se enteró. Un
 * documento que se emite con un dato que la DGI va a rechazar ya quemó su número
 * y su asiento; lo barato es no dejarlo emitir y decir qué corregir.
 *
 * Módulo PURO, sin I/O. Lo usan `emitInvoice` (factura y ND «Enviar a la DGI»),
 * `createCreditNote` (NC «Enviar a la DGI») y los orquestadores de envío al PAC
 * (que vuelven a pasar por acá antes del correlativo fiscal). Los documentos
 * «Interna» no pasan por acá: no van a la DGI.
 *
 * Las reglas salen de la Ficha Técnica para PAC V1.00 (DGI, 25/05/2021), con su
 * código de rechazo entre corchetes. Junta TODOS los problemas, no el primero:
 * si la persona arregla uno y le falla por el siguiente, la está haciendo adivinar.
 *
 * ⚠️ Del RUC se valida la ESTRUCTURA según el tipo de contribuyente, no el
 * dígito verificador: la ficha dice que el DV se calcula «en base al algoritmo
 * del RUC publicado por la DGI», que no está en la ficha, y sin casos reales
 * verificados un algoritmo equivocado bloquearía clientes legítimos. Que el RUC
 * EXISTA sólo lo sabe la DGI [1602]: ideati no tiene endpoint para consultarlo.
 */
import {
  DESCRIPCION_LINEA_MAX,
  validarDescripcionDeLinea,
  validarDvDeReceptor,
} from "@/lib/finanzas/validators/controles-dgi";

export type ClaseDeDocumento = "factura" | "nota_credito" | "nota_debito";

export interface ReceptorParaValidar {
  name: string | null;
  client_type: string | null;
  client_status: string | null;
  tipo_receptor_fe: string | null;
  tax_id: string | null;
  ruc: string | null;
  digito_verificador: string | null;
  id_extranjero: string | null;
  pais_receptor: string | null;
}

export interface LineaParaValidar {
  description: string | null;
  quantity: number;
  unit_price: number;
  tax_rate: number;
  /** Lo guardado (cantidad × precio). Si no viene, se calcula. */
  subtotal?: number | null;
  tax_amount?: number | null;
}

export interface DocumentoParaValidar {
  clase: ClaseDeDocumento;
  receptor: ReceptorParaValidar;
  lineas: LineaParaValidar[];
  /** Totales guardados en el documento. Si no vienen, no se compara el cuadre. */
  totales?: { subtotal: number; impuesto: number; total: number } | null;
  /** Fecha del documento (la que va a la DGI), `YYYY-MM-DD`. */
  fechaDocumento: string;
  /** La factura que corrige o ajusta (04 / 05). `null` ⇒ genérica (06 / 07). */
  referencia?: { numero: string; fecha: string; cufe: string | null } | null;
}

export interface ProblemaParaLaDgi {
  /** Dónde se corrige: la ficha del cliente, una línea o el documento. */
  donde: "cliente" | "linea" | "documento";
  /** Campo concreto (para marcarlo en el formulario). */
  campo: string;
  /** Número de línea, desde 1, si `donde = "linea"`. */
  linea?: number;
  /** El código de la DGI que evita, si lo hay. */
  codigoDgi?: string;
  mensaje: string;
}

/** Tasas de ITBMS que la DGI reconoce (0 %, 7 %, 10 %, 15 %). */
export const TASAS_ITBMS_DGI = [0, 0.07, 0.1, 0.15] as const;

/** Topes de la ficha. */
export const TOTAL_MAXIMO_DGI = 1_000_000; // [2509]
export const TOTAL_MAXIMO_CONSUMIDOR_FINAL = 10_000; // [2515]
export const DIAS_MAXIMOS_NOTA_REFERENCIADA = 180; // [1714]

/**
 * Estructura del RUC de una PERSONA NATURAL (cédula): provincia 1 a 13, o los
 * prefijos de la cédula panameña (PE, E, N, AV, PI, NT), y dos grupos numéricos.
 *   8-742-1183 · PE-12-345 · E-8-123456 · N-12-345 · 8AV-12-345 · 8NT-1-1234
 */
const CEDULA = /^(?:(?:[1-9]|1[0-3])(?:AV|PI|NT)?|PE|E|N)-\d{1,4}-\d{1,6}$/;

/**
 * Estructura del RUC de una PERSONA JURÍDICA: tres grupos numéricos
 * (tomo-folio-asiento, o ficha-rollo-imagen en el formato nuevo).
 *   25046169-3-2021 · 155123456-2-2015 · 1499876-1-690043
 */
const JURIDICA = /^\d{1,10}-\d{1,4}-\d{1,7}$/;

/** El RUC como se compara: mayúsculas y sin espacios. */
export function normalizarRuc(raw: string | null | undefined): string {
  return String(raw ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Todos los problemas del documento para la DGI. Vacío = se puede emitir. */
export function validarParaLaDgi(doc: DocumentoParaValidar): ProblemaParaLaDgi[] {
  const p: ProblemaParaLaDgi[] = [];
  const c = doc.receptor;
  const tipo = String(c.tipo_receptor_fe ?? "").trim();

  // ── El cliente (el receptor) ──────────────────────────────────────────────
  if (c.client_status !== "active") {
    p.push({ donde: "cliente", campo: "client_status", mensaje: "El cliente no está activo: actívelo en su ficha antes de emitir." });
  }
  if (!["01", "02", "03", "04"].includes(tipo)) {
    p.push({
      donde: "cliente",
      campo: "tipo_receptor_fe",
      codigoDgi: "1600",
      mensaje: "Falta el tipo de receptor de la factura electrónica (contribuyente, consumidor final, gobierno o extranjero) en la ficha del cliente.",
    });
  }

  const ruc = normalizarRuc(c.tax_id ?? c.ruc);
  const natural = c.client_type === "persona_natural";
  const juridica = c.client_type === "persona_juridica";

  if (tipo === "01" || tipo === "03") {
    if (!natural && !juridica) {
      p.push({
        donde: "cliente",
        campo: "client_type",
        mensaje: "Falta indicar en la ficha del cliente si es persona natural o jurídica: la DGI lo necesita para identificarlo.",
      });
    }
    if (!ruc) {
      p.push({ donde: "cliente", campo: "tax_id", codigoDgi: "1601", mensaje: "Falta el RUC del cliente. La DGI lo exige para este tipo de receptor." });
    } else if (natural && !CEDULA.test(ruc)) {
      p.push({
        donde: "cliente",
        campo: "tax_id",
        codigoDgi: "1601",
        mensaje:
          `El RUC "${ruc}" no tiene la forma de una cédula panameña (por ejemplo 8-742-1183, PE-12-345 o E-8-123456). ` +
          "Corríjalo en la ficha del cliente, o revise si el cliente es persona jurídica.",
      });
    } else if (juridica && !JURIDICA.test(ruc)) {
      p.push({
        donde: "cliente",
        campo: "tax_id",
        codigoDgi: "1601",
        mensaje:
          `El RUC "${ruc}" no tiene la forma del RUC de una persona jurídica: tres grupos de números separados por guiones ` +
          "(por ejemplo 25046169-3-2021). Corríjalo en la ficha del cliente, o revise si el cliente es persona natural.",
      });
    }
    const dv = validarDvDeReceptor(c.digito_verificador);
    if (!dv.ok) p.push({ donde: "cliente", campo: "digito_verificador", codigoDgi: "1601", mensaje: dv.mensaje });

    const nombre = String(c.name ?? "").trim();
    if (nombre.length < 2 || nombre.length > 100) {
      p.push({
        donde: "cliente",
        campo: "name",
        codigoDgi: "1605",
        mensaje:
          nombre.length < 2
            ? "Falta el nombre o la razón social del cliente."
            : `El nombre del cliente tiene ${nombre.length} caracteres y la DGI acepta hasta 100. Acórtelo en su ficha.`,
      });
    }
  }

  if (tipo === "02" && juridica) {
    p.push({
      donde: "cliente",
      campo: "tipo_receptor_fe",
      codigoDgi: "1621",
      mensaje: "Una persona jurídica no puede recibir la factura como consumidor final. Cambie el tipo de receptor a contribuyente en la ficha del cliente.",
    });
  }

  if (tipo === "04") {
    if (!String(c.id_extranjero ?? "").trim()) {
      p.push({ donde: "cliente", campo: "id_extranjero", codigoDgi: "1618", mensaje: "Falta la identificación del cliente extranjero (pasaporte o documento) en su ficha." });
    }
    if (!String(c.pais_receptor ?? "").trim()) {
      p.push({ donde: "cliente", campo: "pais_receptor", codigoDgi: "1610", mensaje: "Falta el país del cliente extranjero en su ficha." });
    }
  }

  // ── Las líneas ────────────────────────────────────────────────────────────
  if (doc.lineas.length === 0) {
    p.push({ donde: "documento", campo: "lineas", mensaje: "El documento no tiene líneas." });
  }
  let sumaBase = 0;
  let sumaImpuesto = 0;
  doc.lineas.forEach((l, i) => {
    const n = i + 1;
    const d = validarDescripcionDeLinea(l.description);
    if (!d.ok) {
      p.push({
        donde: "linea",
        campo: "description",
        linea: n,
        codigoDgi: String(l.description ?? "").trim().length > DESCRIPCION_LINEA_MAX ? "10105" : undefined,
        mensaje: `Línea ${n}: ${d.mensaje}`,
      });
    }
    if (!(Number(l.quantity) > 0)) {
      p.push({ donde: "linea", campo: "quantity", linea: n, mensaje: `Línea ${n}: la cantidad tiene que ser mayor que cero.` });
    }
    if (!(Number(l.unit_price) >= 0)) {
      p.push({ donde: "linea", campo: "unit_price", linea: n, mensaje: `Línea ${n}: el precio no puede ser negativo.` });
    }
    const tasa = Number(l.tax_rate);
    if (!TASAS_ITBMS_DGI.some((t) => Math.abs(t - tasa) < 0.00001)) {
      p.push({
        donde: "linea",
        campo: "tax_code_id",
        linea: n,
        mensaje: `Línea ${n}: la tasa de ${r2(tasa * 100)} % no es una tasa de ITBMS de la DGI (0, 7, 10 o 15 %).`,
      });
    }
    const base = l.subtotal != null ? Number(l.subtotal) : r2(Number(l.quantity) * Number(l.unit_price));
    sumaBase += base;
    sumaImpuesto += l.tax_amount != null ? Number(l.tax_amount) : r2(base * tasa);
  });

  // ── El documento ──────────────────────────────────────────────────────────
  const total = doc.totales ? Number(doc.totales.total) : r2(sumaBase + sumaImpuesto);
  if (doc.totales) {
    const t = doc.totales;
    if (Math.abs(r2(sumaBase) - Number(t.subtotal)) > 0.005 || Math.abs(r2(sumaImpuesto) - Number(t.impuesto)) > 0.005) {
      p.push({
        donde: "documento",
        campo: "totales",
        codigoDgi: "2500",
        mensaje: `Los totales del documento no coinciden con la suma de sus líneas (base ${r2(sumaBase)} contra ${t.subtotal}; ITBMS ${r2(sumaImpuesto)} contra ${t.impuesto}). Guárdelo de nuevo para que se recalculen.`,
      });
    }
    if (Math.abs(r2(Number(t.subtotal) + Number(t.impuesto)) - Number(t.total)) > 0.005) {
      p.push({ donde: "documento", campo: "totales", codigoDgi: "2507", mensaje: "El total no es la base más el ITBMS. Guarde el documento de nuevo para que se recalcule." });
    }
  }
  if (total > TOTAL_MAXIMO_DGI) {
    p.push({ donde: "documento", campo: "totales", codigoDgi: "2509", mensaje: "La DGI no acepta un documento de más de B/. 1,000,000." });
  }
  if (tipo === "02" && total > TOTAL_MAXIMO_CONSUMIDOR_FINAL) {
    p.push({
      donde: "documento",
      campo: "totales",
      codigoDgi: "2515",
      mensaje: "Un consumidor final no puede recibir un documento de más de B/. 10,000: registre al cliente como contribuyente, con su RUC.",
    });
  }

  // ── La factura referenciada (04 / 05) ─────────────────────────────────────
  if (doc.referencia) {
    const ref = doc.referencia;
    if (!ref.cufe) {
      p.push({
        donde: "documento",
        campo: "referencia",
        codigoDgi: "1705",
        mensaje:
          `La factura ${ref.numero} no tiene CUFE, así que este documento no puede referenciarla ante la DGI. ` +
          "Si se emitió en el portal de ideati, cargue su CUFE primero; si no, emita este documento como interno.",
      });
    }
    const dias = Math.round((Date.parse(doc.fechaDocumento) - Date.parse(ref.fecha.slice(0, 10))) / 86_400_000);
    if (dias > DIAS_MAXIMOS_NOTA_REFERENCIADA) {
      p.push({
        donde: "documento",
        campo: "referencia",
        codigoDgi: "1714",
        mensaje: `La factura ${ref.numero} tiene ${dias} días: la DGI no acepta una nota que referencie una factura de más de ${DIAS_MAXIMOS_NOTA_REFERENCIADA} días.`,
      });
    }
  }

  return p;
}

/**
 * Los problemas en un texto para guardar en el documento y mostrar. Sin «—»:
 * una línea por problema, primero los del cliente.
 */
export function resumirProblemas(problemas: ProblemaParaLaDgi[]): string {
  const orden = { cliente: 0, documento: 1, linea: 2 } as const;
  return [...problemas]
    .sort((a, b) => orden[a.donde] - orden[b.donde] || (a.linea ?? 0) - (b.linea ?? 0))
    .map((x) => (x.donde === "cliente" ? `Ficha del cliente: ${x.mensaje}` : x.mensaje))
    .join("\n");
}

/** Errores por campo para el formulario: `lines.N.campo` (N desde 0) y `client`. */
export function erroresPorCampo(problemas: ProblemaParaLaDgi[]): Record<string, string> {
  const e: Record<string, string> = {};
  for (const x of problemas) {
    const k = x.donde === "linea" ? `lines.${(x.linea ?? 1) - 1}.${x.campo}` : x.donde === "cliente" ? `client.${x.campo}` : x.campo;
    if (!e[k]) e[k] = x.mensaje;
  }
  return e;
}
