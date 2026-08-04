/**
 * Guardas del hard delete de cliente.
 *
 * Contexto: invoices, quotes, credit_notes y payments referencian clients(id)
 * SIN ON DELETE (o sea NO ACTION / RESTRICT). Si el cliente tiene cualquiera de
 * esos registros, el DELETE explota con un error crudo de Postgres
 * ("violates foreign key constraint invoices_client_id_fkey"). Antes de este
 * módulo ese texto llegaba al alert() del navegador como un 500.
 *
 * Peor: el route handler borraba los documentos ANTES del DELETE del cliente,
 * así que al fallar la FK los documentos ya estaban borrados y el cliente
 * quedaba vivo → borrado parcial con pérdida de datos.
 *
 * Núcleo PURO (sin Supabase) para poder testearlo sin mocks.
 */

/** Tablas que bloquean el borrado por FK RESTRICT, con su etiqueta en español. */
export const FINANCIAL_DEPENDENCIES = [
  { table: "invoices", label: "factura(s)" },
  { table: "quotes", label: "cotización(es)" },
  { table: "credit_notes", label: "nota(s) de crédito" },
  { table: "payments", label: "pago(s)" },
] as const;

export type FinancialTable = (typeof FINANCIAL_DEPENDENCIES)[number]["table"];

/** Conteos por tabla. Un valor ausente o null se trata como 0. */
export type FinancialCounts = Partial<Record<FinancialTable, number | null>>;

/**
 * Mensaje de bloqueo para un cliente con registros financieros, o null si no
 * hay ninguno (→ se puede borrar). Solo enumera los tipos con conteo > 0.
 *
 * Tuteo neutro panameño: "Desactívalo", no "Desactivalo" (CLAUDE.md marca el
 * voseo como anti-patrón).
 */
export function buildFinancialBlockMessage(counts: FinancialCounts): string | null {
  const partes = FINANCIAL_DEPENDENCIES.filter(({ table }) => (counts[table] ?? 0) > 0).map(
    ({ table, label }) => `${counts[table]} ${label}`
  );

  if (partes.length === 0) return null;

  return `Este cliente tiene registros financieros y no se puede eliminar: ${partes.join(
    ", "
  )}. Desactívalo en su lugar.`;
}

/** Mensaje genérico para cualquier FK que bloquee (defensa en profundidad). */
export const GENERIC_FK_BLOCK_MESSAGE =
  "Este cliente tiene registros asociados y no se puede eliminar. Desactívalo en su lugar.";

/**
 * `23503` = foreign_key_violation en Postgres. Si en el futuro se agrega otra
 * FK a clients (hoy ya existe `prospects.converted_client_id`, que tampoco
 * cascadea), esto evita que se filtre el error crudo al usuario.
 */
export function isForeignKeyViolation(error: { code?: string | null } | null | undefined): boolean {
  return error?.code === "23503";
}
