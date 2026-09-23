/**
 * LO QUE LA DGI RECHAZA, VERIFICADO ANTES DE MANDARLO.
 *
 * Módulo PURO. Lo importan el formulario (que es un Client Component), los
 * validadores de servidor y el gate de emisión — los tres tienen que decir lo
 * mismo, y la única forma es que lean el mismo archivo.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE: DOS RECHAZOS REALES
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   · **DGI 10105** — una descripción de línea de **545 caracteres** cuando el
 *     límite son 500. El CRM la aceptó sin decir nada; el rechazo apareció
 *     recién cuando la DGI contestó, sobre una factura ya emitida y numerada.
 *
 *   · **DGI 1601 / 1602** — RUC o DV que la DGI no reconoce. Peor todavía: el
 *     cliente se corrigió DESPUÉS del rechazo y la factura nunca se reenvió, así
 *     que quedó rechazada ante la DGI con los datos ya arreglados en el CRM.
 *
 * Los dos tienen la misma forma: **el error existía antes de enviar y nadie lo
 * miró**. Un contador de caracteres en el campo y un aviso al guardar el cliente
 * son más baratos que anular una factura ante la DGI.
 *
 * ⚠️ **NO HAY ENDPOINT PARA CONSULTAR UN RUC.** Revisado el swagger completo de
 * ideati el 23/09/2026: sus 17 rutas son catálogos (CPBS, países, monedas,
 * ubicaciones), facturas y el evento de anulación. **Ninguna consulta
 * contribuyentes.** Así que acá se valida FORMA, no existencia; quién dice si
 * un RUC existe de verdad sigue siendo la DGI al recibir el documento.
 */

// ═══════════════════════════════════════════════════════════════════════════
// DESCRIPCIÓN DE LÍNEA — DGI 10105
// ═══════════════════════════════════════════════════════════════════════════

/**
 * El tope de la DGI para la descripción de una línea. El rechazo `10105` llegó
 * con 545 caracteres.
 */
export const DESCRIPCION_LINEA_MAX = 500;

/**
 * Mínimo. Dos y no uno: una descripción de un solo carácter pasa el "requerido"
 * y no le dice nada a nadie — ni al cliente que recibe la factura ni al contador
 * que la lee seis meses después.
 */
export const DESCRIPCION_LINEA_MIN = 2;

export type Verificacion = { ok: true } | { ok: false; mensaje: string };

/**
 * Valida la descripción de una línea de factura, nota de crédito o nota de
 * débito. Mide **trimeado**, igual que se va a guardar.
 */
export function validarDescripcionDeLinea(raw: unknown): Verificacion {
  const texto = typeof raw === "string" ? raw.trim() : "";

  if (texto.length === 0) {
    return { ok: false, mensaje: "Escriba una descripción para esta línea." };
  }
  if (texto.length < DESCRIPCION_LINEA_MIN) {
    return {
      ok: false,
      mensaje: `La descripción es muy corta: necesita al menos ${DESCRIPCION_LINEA_MIN} caracteres.`,
    };
  }
  if (texto.length > DESCRIPCION_LINEA_MAX) {
    const sobran = texto.length - DESCRIPCION_LINEA_MAX;
    return {
      ok: false,
      mensaje:
        `La descripción tiene ${texto.length} caracteres y la DGI acepta hasta ` +
        `${DESCRIPCION_LINEA_MAX}. ${
          sobran === 1 ? "Sobra 1 carácter" : `Sobran ${sobran} caracteres`
        }.`,
    };
  }
  return { ok: true };
}

/**
 * Lo que muestra el contador del campo: `"312/500"`. Cuenta **trimeado**, igual
 * que el validador — si contara los espacios del borde, el número del contador
 * y el del mensaje de error no coincidirían, y a nadie le gusta que un campo le
 * diga 501 y otro 499.
 */
export function contadorDeDescripcion(raw: unknown): {
  usados: number;
  maximo: number;
  excedido: boolean;
  texto: string;
} {
  const usados = (typeof raw === "string" ? raw.trim() : "").length;
  return {
    usados,
    maximo: DESCRIPCION_LINEA_MAX,
    excedido: usados > DESCRIPCION_LINEA_MAX,
    texto: `${usados}/${DESCRIPCION_LINEA_MAX}`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// RUC Y DV DEL RECEPTOR — DGI 1601 / 1602
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Los tipos de receptor que la DGI obliga a identificar con RUC y DV.
 *
 *   `01` contribuyente · `03` gobierno
 *
 * `02` (consumidor final) y `04` (extranjero) no llevan RUC panameño: al `04`
 * lo identifican `id_extranjero` y `pais_receptor`.
 */
export const TIPOS_RECEPTOR_CON_RUC = ["01", "03"] as const;

export function receptorNecesitaRuc(tipoReceptorFe: string | null | undefined): boolean {
  return TIPOS_RECEPTOR_CON_RUC.includes(
    String(tipoReceptorFe ?? "") as (typeof TIPOS_RECEPTOR_CON_RUC)[number]
  );
}

/** Largo mínimo y máximo de un RUC panameño. Ver el comentario de abajo. */
const RUC_LARGO_MIN = 4;
const RUC_LARGO_MAX = 40;

/**
 * 🔴 DEL RUC SE VALIDA LA FORMA MÍNIMA, NO UN PATRÓN CERRADO.
 *
 * Es la misma regla que ya rige para proveedores (`claude.md`), y el motivo es
 * el mismo: en Panamá conviven cédulas (`8-123-456`), prefijos (`PE-`, `E-`,
 * `N-`), jurídicos (`155123456-2-2015`) y folios viejos. Un validador estricto
 * rechaza RUC legítimos y deja a alguien sin poder facturar — que es un daño
 * peor y más silencioso que un rechazo de la DGI, porque no tiene mensaje.
 *
 * Así que se exige lo que ningún RUC real incumple: caracteres que un RUC puede
 * tener (dígitos, letras, guiones y espacios) y un largo razonable. Lo demás lo
 * dictamina la DGI, que es la única que tiene el registro.
 */
const RUC_CARACTERES = /^[0-9A-Za-zÑñ\-\s.]+$/;

export function validarRucDeReceptor(raw: unknown): Verificacion {
  const ruc = typeof raw === "string" ? raw.trim() : "";

  if (ruc.length === 0) {
    return {
      ok: false,
      mensaje: "Falta el RUC del cliente. La DGI lo exige para este tipo de receptor.",
    };
  }
  if (ruc.length < RUC_LARGO_MIN) {
    return { ok: false, mensaje: `El RUC "${ruc}" es demasiado corto para ser válido.` };
  }
  if (ruc.length > RUC_LARGO_MAX) {
    return { ok: false, mensaje: `El RUC tiene ${ruc.length} caracteres: revise si quedó pegado con otro dato.` };
  }
  if (!RUC_CARACTERES.test(ruc)) {
    return {
      ok: false,
      mensaje:
        "El RUC tiene caracteres que no corresponden. Sólo van números, letras, guiones y puntos.",
    };
  }
  if (!/[0-9]/.test(ruc)) {
    return { ok: false, mensaje: "El RUC no tiene ningún número: revise que sea el dato correcto." };
  }
  return { ok: true };
}

/**
 * El DV son uno o dos dígitos. Acá sí se puede ser estricto, porque es un
 * número por definición — igual que en proveedores.
 *
 * 🔴 Y es OBLIGATORIO para los receptores con RUC. El rechazo `1601` llegó
 * justamente por acá.
 */
export function validarDvDeReceptor(raw: unknown): Verificacion {
  const dv = typeof raw === "string" ? raw.trim() : "";

  if (dv.length === 0) {
    return {
      ok: false,
      mensaje:
        "Falta el dígito verificador (DV) del cliente. Son los dos dígitos que van después " +
        "del RUC en el registro de la DGI.",
    };
  }
  if (!/^[0-9]{1,2}$/.test(dv)) {
    return {
      ok: false,
      mensaje: `El DV "${dv}" no es válido: son uno o dos dígitos, sin letras ni guiones.`,
    };
  }
  return { ok: true };
}

/** Un problema encontrado, con el campo que hay que tocar para arreglarlo. */
export interface ProblemaDelReceptor {
  /** El nombre del campo en la ficha del cliente, para que el mensaje lo nombre. */
  campo: "tax_id" | "digito_verificador" | "tipo_receptor_fe" | "client_type";
  etiqueta: string;
  mensaje: string;
}

export interface ReceptorParaVerificar {
  tipo_receptor_fe?: string | null;
  tax_id?: string | null;
  ruc?: string | null;
  digito_verificador?: string | null;
  client_type?: string | null;
}

/**
 * Todos los problemas fiscales del receptor, juntos.
 *
 * Devuelve **la lista completa** y no el primero: si la persona arregla lo que
 * le dice el mensaje, vuelve a guardar y le falla por lo siguiente, el
 * formulario la está haciendo adivinar. Es la misma razón por la que la matriz
 * fiscal junta todos los motivos.
 *
 * ⚠️ Verifica **forma, no existencia**. Que el RUC exista en el registro de la
 * DGI no se puede consultar: ideati no tiene endpoint para eso.
 */
export function problemasDelReceptor(c: ReceptorParaVerificar): ProblemaDelReceptor[] {
  const problemas: ProblemaDelReceptor[] = [];

  if (!receptorNecesitaRuc(c.tipo_receptor_fe)) {
    // `02` consumidor final y `04` extranjero no llevan RUC panameño.
    return problemas;
  }

  // `map-receptor.ts` lee `tax_id ?? ruc`: se verifica el que realmente viaja.
  const rucQueViaja = (c.tax_id ?? c.ruc) ?? null;
  const ruc = validarRucDeReceptor(rucQueViaja);
  if (!ruc.ok) {
    problemas.push({ campo: "tax_id", etiqueta: "RUC", mensaje: ruc.mensaje });
  }

  const dv = validarDvDeReceptor(c.digito_verificador);
  if (!dv.ok) {
    problemas.push({
      campo: "digito_verificador",
      etiqueta: "Dígito verificador (DV)",
      mensaje: dv.mensaje,
    });
  }

  // El mapper deriva el tipoContribuyente del receptor de acá; sin esto lanza
  // un Error plano que la ruta degrada a "Error interno".
  if (!String(c.client_type ?? "").trim()) {
    problemas.push({
      campo: "client_type",
      etiqueta: "Tipo de cliente",
      mensaje:
        "Falta indicar si el cliente es persona natural o jurídica. La DGI lo necesita para " +
        "identificar al receptor.",
    });
  }

  return problemas;
}

/**
 * Un solo párrafo con todo lo que hay que corregir y **dónde**, en lenguaje
 * simple. Es lo que se muestra arriba del formulario o en el diálogo de envío.
 */
export function motivoParaNoEmitir(problemas: ProblemaDelReceptor[]): string | null {
  if (problemas.length === 0) return null;
  if (problemas.length === 1) {
    return `${problemas[0].etiqueta}: ${problemas[0].mensaje}`;
  }
  return (
    "Hay que corregir la ficha del cliente antes de emitir:\n" +
    problemas.map((p) => `· ${p.etiqueta}: ${p.mensaje}`).join("\n")
  );
}
