/**
 * EL MOTIVO DE UNA ANULACIÓN — el largo, en un solo lugar.
 *
 * Módulo PURO, sin Supabase y sin nada de servidor, justamente para que el
 * diálogo (que es un Client Component) y la ruta de API importen **la misma
 * constante**. Si el mínimo viviera duplicado, el día que cambie va a cambiar
 * en uno de los dos y el síntoma va a ser un formulario que deja escribir algo
 * que el servidor rechaza — o peor, al revés.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 LOS 15 CARACTERES NO SON NUESTROS: LOS PIDE LA DGI
 * ─────────────────────────────────────────────────────────────────────────────
 * ideati (Eduardo Méndez, 22/09/2026) respondió que `cancellationReason` del
 * endpoint `POST /api/v1/InvoiceEvents/CreateCancellation` es texto libre con
 * un **mínimo de 15 caracteres**. Hasta el 23/09/2026 el CRM exigía **3**.
 *
 * O sea que, en cuanto el Bloque 9B cablee el envío, un motivo de cuatro letras
 * que el CRM acepta sin chistar se convierte en un **rechazo del PAC sobre una
 * factura real**, delante del cliente y con la anulación a medio hacer. Por eso
 * el mínimo sube ANTES de cablear el envío, y no junto con él: si subiera
 * después, habría una ventana en la que la pantalla promete algo que la DGI no
 * va a aceptar.
 *
 * Son **tres capas y hacen falta las tres**:
 *   1. este validador          → el 400 de la ruta de API;
 *   2. el diálogo              → el botón no se habilita y el contador dice
 *                                cuánto falta (que alguien no pueda apretar es
 *                                mejor que un error después de apretar);
 *   3. el CHECK de la `058`    → `invoices_cancellation_reason_largo`, la capa
 *                                que no se puede saltear. El RPC
 *                                `cancel_invoice_with_reversal` escribe la
 *                                columna directo, así que un script o un `psql`
 *                                no pasan por acá.
 *
 * ⚠️ El mínimo de la NOTA DE CRÉDITO sigue en 3 (`NC_MOTIVO_MIN`, en
 *    `validators/credit-note.ts`). No es un olvido: los 15 son del endpoint de
 *    ANULACIÓN, y una nota de crédito hoy es un documento interno que no se le
 *    manda a nadie (`fe_estado = 'no_emitida'`, Bloque 5). Cuando 9C envíe
 *    notas de crédito al PAC habrá que revisar si su motivo también viaja.
 *    (La anulación crea una NC total con el MISMO motivo, así que por ese
 *    camino la NC ya queda con 15 o más: no hay conflicto.)
 */

/** Mínimo exigido por la DGI para `cancellationReason`. ideati, 22/09/2026. */
export const MOTIVO_ANULACION_MIN = 15;

/** Tope. Ya estaba escrito en `claude.md`; desde la `058` existe en la base. */
export const MOTIVO_ANULACION_MAX = 1000;

export type MotivoDeAnulacion =
  | { ok: true; motivo: string }
  | { ok: false; mensaje: string };

/**
 * Valida el motivo de una anulación. Devuelve el texto ya trimeado: el largo se
 * mide **sin los espacios de los extremos**, igual que el CHECK de la base, que
 * usa `btrim`. Sin eso, quince espacios cumplirían el mínimo acá y la base los
 * rechazaría — o al revés, según cuál de los dos se olvidara del trim.
 */
export function validarMotivoDeAnulacion(raw: unknown): MotivoDeAnulacion {
  const motivo = typeof raw === "string" ? raw.trim() : "";

  if (motivo.length < MOTIVO_ANULACION_MIN) {
    return {
      ok: false,
      mensaje:
        `El motivo de anulación debe tener al menos ${MOTIVO_ANULACION_MIN} caracteres ` +
        `(van ${motivo.length}). Es el mínimo que exige la DGI para anular un documento ` +
        `electrónico, no una regla nuestra.`,
    };
  }
  if (motivo.length > MOTIVO_ANULACION_MAX) {
    return {
      ok: false,
      mensaje: `El motivo de anulación no puede pasar de ${MOTIVO_ANULACION_MAX} caracteres.`,
    };
  }

  return { ok: true, motivo };
}

/**
 * Cuántos caracteres le faltan al texto para llegar al mínimo. 0 cuando ya
 * alcanza. Es lo que el contador del diálogo muestra en vivo: "faltan 7" es
 * accionable; "mínimo 15" obliga a contar.
 */
export function faltanParaElMinimo(texto: string): number {
  const n = texto.trim().length;
  return n >= MOTIVO_ANULACION_MIN ? 0 : MOTIVO_ANULACION_MIN - n;
}
