/**
 * QUÉ CUENTA PUEDE CLASIFICAR UNA LÍNEA DE GASTO.
 *
 * Dos cosas viven en este archivo, y viven juntas a propósito:
 *
 *   1. `cuentasSugeridasParaTramite()` — lo que la pantalla OFRECE por defecto.
 *   2. `esTipoValidoParaGasto()`       — lo que el servidor ACEPTA.
 *
 * Son reglas distintas con propósitos distintos, pero si vivieran en archivos
 * separados divergirían: la pantalla ofrecería algo que la ruta rechaza, o al
 * revés. Es la misma disciplina que SOP-013 exige para el vocabulario NIIF 18.
 *
 * Módulo PURO: sin I/O, sin React, sin Supabase.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔬 LA EVIDENCIA DE POR QUÉ ESTO EXISTE — un error real, no una hipótesis
 * ═════════════════════════════════════════════════════════════════════════════
 * El 03/09/2026, al sembrar el gasto de demostración de staging, se clasificó
 * "Honorario del gestor externo" contra **`610002 Honorarios Profesionales`**.
 *
 * Está mal. La cuenta correcta es **`500004 Honorarios Profesionales Externos`**,
 * que existe en el plan y es de costo. `610002` son los honorarios que paga el
 * bufete por LO SUYO —su contador, su propio abogado— no el gestor externo de un
 * caso.
 *
 * Lo importante no es el error: es **quién lo cometió**. Fue la misma persona que
 * acababa de diseñar el modelo de líneas, veinte minutos antes, eligiendo de una
 * lista de 64 cuentas donde dos se llamaban casi igual. Si el nombre parecido
 * alcanza para equivocar a alguien con el modelo entero en la cabeza, alcanza de
 * sobra para equivocar a quien está pasando por 128 filas haciendo clic rápido en
 * la pantalla de limpieza.
 *
 * Y el error quedó **permanente**: el asiento ya estaba posteado y los asientos
 * son inmutables. Corregirlo requiere una reversión que un contador tiene que
 * justificar ante la DGI.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * REGLA 1 — QUÉ SEPARA UN COSTO DE UN GASTO EN UN CASO
 * ═════════════════════════════════════════════════════════════════════════════
 *
 *   Las `5000xx` son **servicios de terceros comprados para el caso**.
 *   Las `610xxx` son **recursos propios del bufete consumidos en el caso**.
 *
 * Con ese criterio se resuelve solo:
 *
 *   · Un traductor, un notario, un investigador, un gestor externo → alguien le
 *     facturó al bufete por ese caso → `5000xx`.
 *   · Una abogada que viaja a Chitré a una audiencia, el combustible de ese
 *     viaje, la papelería de un escrito → el bufete consumió lo suyo → `610xxx`.
 *
 * No es casualidad que las seis cuentas de costo del plan sean, una por una,
 * servicios de terceros que un bufete compra para un caso: Josuarth armó ese
 * bloque exactamente para esto.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * REGLA 2 — EL SERVIDOR RECHAZA LO IMPOSIBLE, NO LO IMPROBABLE
 * ═════════════════════════════════════════════════════════════════════════════
 *
 *   Un guard equivocado **bloquea trabajo legítimo y se descubre tarde**, con
 *   alguien trabado y sin entender por qué. Una sugerencia equivocada **cuesta un
 *   clic**.
 *
 * Por eso los dos mecanismos tienen sesgos opuestos y deliberados:
 *
 *   · La LISTA es opinada y corta: siete cuentas, y todo lo demás a un clic.
 *   · El GUARD es conservador: solo los tres tipos que no tienen ninguna lectura
 *     contable posible.
 *
 * `100001 Banco General` como clasificación de una tasa judicial es un disparate
 * —el banco es de DÓNDE sale la plata, no en qué se convirtió— y aun así **no se
 * bloquea**: no es estructuralmente imposible, y la lista corta ya lo saca del
 * camino. Bloquearlo sería aplicar el sesgo equivocado al mecanismo equivocado.
 */

import type { AccountType } from "@/lib/finanzas/types/chart-of-account";
import { CUENTA_TRAMITE_DEFAULT } from "@/lib/finanzas/types/expense-line";

// ---------------------------------------------------------------------------
// EL GUARD — lo que el servidor rechaza
// ---------------------------------------------------------------------------

/**
 * Los tipos de cuenta que NO pueden clasificar una línea de gasto, nunca.
 *
 * No es una preferencia de interfaz: es aritmética contable. Cada uno tiene su
 * motivo, y el del pasivo es el más fuerte de los tres.
 */
export const TIPOS_IMPOSIBLES_EN_GASTO: AccountType[] = ["income", "equity", "liability"];

/**
 * Por qué cada tipo es imposible. Se escribe explícito para que el mensaje de
 * error EXPLIQUE en vez de solo prohibir: quien lo lee está clasificando y
 * necesita saber hacia dónde ir, no que le digan que no.
 */
export const MOTIVO_TIPO_IMPOSIBLE: Record<string, string> = {
  income:
    "una cuenta de ingreso registra lo que el bufete factura, no en qué se gastó la plata",
  equity:
    "una cuenta de patrimonio registra el capital de las socias y el resultado del ejercicio, no un desembolso",
  // ⚠️ EL MÁS IMPORTANTE DE LOS TRES. El asiento de un gasto de trámite acredita
  // `200001 Cuentas por pagar`. Si una LÍNEA se clasificara contra un pasivo, el
  // asiento tendría la misma cuenta debitada y acreditada a la vez — no dice
  // nada. Y "pagar una deuda" NO es esto: es DEBE CxP / HABER banco, que es otro
  // flujo (el pago a proveedores, Fase B).
  liability:
    "el asiento del gasto ya acredita Cuentas por pagar; una línea contra un pasivo dejaría la misma cuenta de los dos lados del asiento",
};

/** true si una cuenta de ese tipo puede clasificar una línea de gasto. */
export function esTipoValidoParaGasto(t: AccountType): boolean {
  return !TIPOS_IMPOSIBLES_EN_GASTO.includes(t);
}

/**
 * El mensaje de rechazo para una cuenta, o `null` si es válida.
 *
 * Devuelve el texto completo y no un código, porque el único consumidor es una
 * respuesta HTTP que se muestra tal cual.
 */
export function motivoDeRechazo(cuenta: {
  code: string;
  name: string;
  account_type: AccountType;
}): string | null {
  if (esTipoValidoParaGasto(cuenta.account_type)) return null;
  const motivo = MOTIVO_TIPO_IMPOSIBLE[cuenta.account_type] ?? "no puede clasificar un gasto";
  return `La cuenta ${cuenta.code} ${cuenta.name} no puede clasificar un gasto: ${motivo}.`;
}

// ---------------------------------------------------------------------------
// LA LISTA SUGERIDA — lo que la pantalla ofrece por defecto
// ---------------------------------------------------------------------------

/** Lo mínimo que hace falta de una cuenta para decidir. */
export interface CuentaClasificable {
  code: string;
  name: string;
  account_type: AccountType;
  active?: boolean;
}

/**
 * Las cuentas que tienen sentido para un gasto de trámite, en orden de uso.
 *
 * 🔑 **DERIVADA, no una lista de códigos.** Es
 * `130003` + todas las cuentas ACTIVAS de tipo `cost`.
 *
 * Hardcodear los siete códigos se desactualizaría el día que RM toque el plan,
 * que es exactamente lo que van a hacer: si el contador agrega `500007 Peritos`,
 * con esta regla aparece sola y con una lista literal no aparece nunca — y nadie
 * se entera, porque la cuenta existe y el selector simplemente no la muestra.
 *
 * El orden no es alfabético: `130003` va primero porque es la respuesta más
 * frecuente y el default del acta ("Gasto de trámite al incurrirlo: DEBE 130003").
 */
export function cuentasSugeridasParaTramite<T extends CuentaClasificable>(
  cuentas: readonly T[]
): T[] {
  const activas = cuentas.filter((c) => c.active !== false);
  const fondo = activas.filter((c) => c.code === CUENTA_TRAMITE_DEFAULT);
  const costos = activas
    .filter((c) => c.account_type === "cost")
    .sort((a, b) => a.code.localeCompare(b.code));
  return [...fondo, ...costos];
}

/**
 * Todas las cuentas que el SERVIDOR aceptaría, para el "ver todas las cuentas".
 *
 * No es el plan entero: ya saca los tres tipos imposibles. Ofrecer una cuenta que
 * la ruta va a rechazar es la misma clase de error que un botón que rebota — el
 * criterio de CLAUDE.md, "esconder la acción que el rol no puede ejecutar es lo
 * que evita que apriete algo que le va a fallar", aplicado a un selector.
 */
export function cuentasClasificables<T extends CuentaClasificable>(
  cuentas: readonly T[]
): T[] {
  return cuentas
    .filter((c) => c.active !== false && esTipoValidoParaGasto(c.account_type))
    .sort((a, b) => a.code.localeCompare(b.code));
}
