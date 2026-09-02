/**
 * Validador de proveedores. Mismo patrón manual que `business-expense.ts`:
 * devuelve `{ ok, data, errors }` con `errors` como mapa campo → mensaje.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * LA DECISIÓN QUE MANDA ACÁ: VALIDAR POCO Y AVISAR MUCHO
 * ═════════════════════════════════════════════════════════════════════════════
 * En Panamá conviven varias familias de RUC, y no todas están documentadas en un
 * solo lugar:
 *
 *   · Persona natural por cédula:     8-123-456 · 3-101-1234 · 10-15-99
 *   · Con prefijo de provincia/tipo:  PE-8-123-456 · E-8-123-456 · N-19-1234
 *   · Persona jurídica moderna:       155123456-2-2015
 *   · Folios y fichas viejas:         12345-678-901234 y variantes
 *
 * Un validador que imponga un patrón va a rechazar RUC legítimos que no
 * previmos, y quien esté cargando un proveedor no va a tener forma de seguir.
 * Eso es peor que aceptar un RUC mal tipeado, que se corrige después.
 *
 * Entonces: **del RUC solo se valida el largo y que tenga caracteres plausibles**
 * (dígitos, letras, guiones, espacios, puntos y barras). El formato se COMENTA en
 * pantalla como sugerencia, nunca se rechaza. `avisosDeRuc()` devuelve esos
 * comentarios, que la UI muestra en ámbar sin bloquear el guardado.
 *
 * El DV sí se acota a dígitos, porque un dígito verificador es un número por
 * definición. Se aceptan 1 a 3 dígitos aunque el formulario de la DGI muestre 2,
 * para no rechazar un "5" escrito sin el cero delante.
 *
 * 🔴 Y en ningún punto de este archivo se concatenan RUC y DV.
 */

import type { CreateSupplierInput } from "@/lib/finanzas/types/supplier";
import { PAYMENT_TERMS_MAX, PAYMENT_TERMS_MIN } from "@/lib/finanzas/types/supplier";

export type ValidationErrors = Record<string, string>;

export type ValidationResult<T> =
  | { ok: true; data: T; errors: null }
  | { ok: false; data: null; errors: ValidationErrors };

/**
 * Lo único que se le exige a un RUC: que sus caracteres puedan pertenecer a
 * alguno de los formatos panameños. Nada de estructura.
 */
const RUC_CARACTERES_PLAUSIBLES = /^[0-9A-Za-zÁÉÍÓÚÑáéíóúñ\-\s./]+$/;

/** El DV es un número. Es lo único que se afirma sobre él. */
const DV_RE = /^[0-9]{1,3}$/;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function texto(raw: unknown): string {
  return String(raw ?? "").trim();
}

/** Campo opcional: "" y null son lo mismo, y ese mismo es `null`. */
function opcional(raw: unknown): string | null {
  const s = texto(raw);
  return s === "" ? null : s;
}

/**
 * Comentarios sobre el RUC, para MOSTRAR, nunca para bloquear.
 *
 * Se devuelven aparte de `errors` justamente para que la UI no pueda
 * confundirlos con un motivo de rechazo.
 */
export function avisosDeRuc(ruc: string | null, dv: string | null): string[] {
  const avisos: string[] = [];
  if (!ruc) return avisos;

  if (/^\d+$/.test(ruc) && ruc.length > 6) {
    avisos.push(
      "El RUC no tiene guiones. Los formatos de la DGI suelen separarlos " +
        "(8-123-456, 155123456-2-2015). Verificá que sea así en el documento."
    );
  }
  if (/\s{2,}/.test(ruc)) {
    avisos.push("El RUC tiene espacios dobles: revisá que no sea un error de tipeo.");
  }
  // El error que este módulo existe para evitar.
  if (dv && ruc.endsWith(`-${dv}`)) {
    avisos.push(
      `El RUC parece terminar con el DV (${dv}). El RUC y el DV van en columnas ` +
        "separadas: sacá el DV del campo RUC."
    );
  }
  if (!dv) {
    avisos.push(
      "Sin DV cargado. Los anexos de la declaración de renta lo piden en su " +
        "propia columna; conviene completarlo."
    );
  } else if (dv.length !== 2) {
    avisos.push(
      `El DV tiene ${dv.length} dígito${dv.length === 1 ? "" : "s"}. En el formulario ` +
        "de la DGI son dos (un 5 se escribe 05). Se guarda igual como lo escribiste."
    );
  }
  return avisos;
}

export function validateCreateSupplier(
  raw: Partial<CreateSupplierInput>
): ValidationResult<CreateSupplierInput> {
  const errors: ValidationErrors = {};

  // -- razón social: lo único realmente obligatorio ---------------------------
  const legalName = texto(raw.legal_name);
  if (!legalName) {
    errors.legal_name = "La razón social es obligatoria";
  } else if (legalName.length < 2) {
    errors.legal_name = "La razón social es muy corta (mínimo 2 caracteres)";
  } else if (legalName.length > 200) {
    errors.legal_name = "La razón social es muy larga (máximo 200 caracteres)";
  }

  const tradeName = opcional(raw.trade_name);
  if (tradeName && tradeName.length > 200) {
    errors.trade_name = "La razón comercial es muy larga (máximo 200 caracteres)";
  }

  // -- RUC: largo y caracteres, NADA de formato ------------------------------
  const ruc = opcional(raw.ruc);
  if (ruc) {
    if (ruc.length > 50) {
      errors.ruc = "El RUC es muy largo (máximo 50 caracteres)";
    } else if (!RUC_CARACTERES_PLAUSIBLES.test(ruc)) {
      errors.ruc = "El RUC tiene caracteres que no corresponden (solo números, letras, guiones y puntos)";
    }
  }

  // -- DV: dígitos ----------------------------------------------------------
  const dv = opcional(raw.dv);
  if (dv && !DV_RE.test(dv)) {
    errors.dv = "El DV debe ser un número de 1 a 3 dígitos (el de la DGI tiene 2)";
  }

  // -- contacto -------------------------------------------------------------
  const address = opcional(raw.address);
  if (address && address.length > 500) {
    errors.address = "La dirección es muy larga (máximo 500 caracteres)";
  }

  const phone = opcional(raw.phone);
  if (phone && phone.length > 50) {
    errors.phone = "El teléfono es muy largo (máximo 50 caracteres)";
  }

  const email = opcional(raw.email);
  if (email) {
    if (email.length > 200) {
      errors.email = "El correo es muy largo (máximo 200 caracteres)";
    } else if (!EMAIL_RE.test(email)) {
      errors.email = "El correo no parece válido";
    }
  }

  // -- términos de pago -----------------------------------------------------
  // Se acepta cualquier plazo del rango, no solo los sugeridos: que un proveedor
  // trabaje a 45 días no puede impedir cargarlo.
  const plazoRaw = raw.payment_terms_days;
  const plazo = plazoRaw === null || plazoRaw === undefined || plazoRaw === ("" as unknown)
    ? 0
    : Number(plazoRaw);
  if (!Number.isFinite(plazo) || !Number.isInteger(plazo)) {
    errors.payment_terms_days = "El plazo de pago debe ser un número entero de días";
  } else if (plazo < PAYMENT_TERMS_MIN || plazo > PAYMENT_TERMS_MAX) {
    errors.payment_terms_days = `El plazo de pago debe estar entre ${PAYMENT_TERMS_MIN} y ${PAYMENT_TERMS_MAX} días`;
  }

  const notes = opcional(raw.notes);
  if (notes && notes.length > 2000) {
    errors.notes = "La nota es muy larga (máximo 2000 caracteres)";
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, data: null, errors };
  }

  return {
    ok: true,
    errors: null,
    data: {
      legal_name: legalName,
      trade_name: tradeName,
      ruc,
      dv,
      address,
      phone,
      email,
      payment_terms_days: plazo,
      active: raw.active !== false,
      notes,
    },
  };
}

export function validateUpdateSupplier(raw: Partial<CreateSupplierInput>) {
  return validateCreateSupplier(raw);
}
