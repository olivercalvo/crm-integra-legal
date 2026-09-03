import Link from "next/link";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { Card, CardContent } from "@/components/ui/card";
import { DollarSign, TrendingUp, TrendingDown, Wallet } from "lucide-react";
import { GastosTable } from "@/components/expenses/gastos-table";
import { GastosIndividualesTable } from "@/components/expenses/gastos-individuales-table";
import {
  contarLineasSinClasificar,
  listarGastosDeTramite,
} from "@/lib/finanzas/queries/expense-tramite";
import { listChartAccounts } from "@/lib/finanzas/queries/chart-of-accounts";

function formatCurrency(amount: number): string {
  return `B/. ${amount.toLocaleString("es-PA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Dos vistas de la misma pantalla:
 *
 *   · `por-caso` (default) — el balance por caso de siempre.
 *   · `gastos`             — los gastos de trámite individuales, entre casos.
 *
 * La segunda se agregó el 03/09/2026 y nació de una necesidad concreta: la
 * migración `036` dejó gastos históricos sin cuenta contable, y **no existía
 * ninguna pantalla que listara gastos individuales** — resolverlos habría
 * significado entrar caso por caso.
 *
 * Va como VISTA y no como pantalla `/gastos/sin-clasificar` aparte porque una
 * pantalla dedicada a una limpieza es un arreglo temporal que se vuelve deuda
 * permanente: hay que acordarse de borrarla. Una lista de gastos entre casos
 * sirve igual después.
 *
 * El gate no cambia: `/legal/gastos` sigue siendo admin y abogada (el asistente
 * lo tiene bloqueado en ASISTENTE_BLOCKED_PATTERNS y el contador no entra a
 * /legal).
 */
interface PageProps {
  searchParams: { vista?: string; filtro?: string };
}

export default async function GastosPage({ searchParams }: PageProps) {
  // El asistente ya no llega acá: el middleware lo rebota a /legal antes de
  // renderizar (ASISTENTE_BLOCKED_PATTERNS). Gastos es admin/abogada.
  const { db, tenantId } = await getAuthenticatedContext();

  const vistaGastos = searchParams.vista === "gastos";
  const soloSinClasificar = searchParams.filtro === "sin-clasificar";

  // El conteo va SIEMPRE: alimenta el contador del toggle, que es lo que hace
  // visible el trabajo pendiente desde la vista por caso. Es un COUNT con head,
  // no trae filas.
  const { sinClasificar, total: totalLineas } = await contarLineasSinClasificar(
    db,
    tenantId
  );

  // El resto solo si se está mirando esa vista.
  const gastosIndividuales = vistaGastos
    ? await listarGastosDeTramite(db, tenantId, { soloSinClasificar })
    : [];

  // Solo cuentas ACTIVAS: los reportes filtran por `active` y ofrecer una
  // inactiva sería ofrecer una clasificación que después no se ve en ningún lado.
  // La ruta de API lo vuelve a validar — el dropdown no es un permiso.
  const cuentas = vistaGastos
    ? (await listChartAccounts(db, tenantId))
        .filter((c) => c.active)
        .map((c) => ({ code: c.code, name: c.name }))
    : [];

  // Fetch all cases with their expenses and payments
  const { data: cases } = await db
    .from("cases")
    .select(`
      id, case_code, description,
      clients(name),
      cat_statuses(name),
      expenses(amount),
      client_payments(amount)
    `)
    .eq("tenant_id", tenantId)
    .order("case_code");

  const rows = (cases ?? []).map((c: Record<string, unknown>) => {
    const client = c.clients as { name: string } | null;
    const status = c.cat_statuses as { name: string } | null;
    const expenses = (c.expenses as { amount: number }[] | null) ?? [];
    const payments = (c.client_payments as { amount: number }[] | null) ?? [];
    const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0);
    const totalPayments = payments.reduce((s, p) => s + Number(p.amount), 0);
    const balance = totalPayments - totalExpenses;
    return {
      id: c.id as string,
      caseCode: c.case_code as string,
      description: c.description as string | null,
      clientName: client?.name ?? "—",
      statusName: status?.name ?? "—",
      totalPayments,
      totalExpenses,
      balance,
    };
  });

  const grandPayments = rows.reduce((s, r) => s + r.totalPayments, 0);
  const grandExpenses = rows.reduce((s, r) => s + r.totalExpenses, 0);
  const grandBalance = grandPayments - grandExpenses;

  // Unique status names for filter dropdown
  const statuses = Array.from(new Set(rows.map((r) => r.statusName))).filter((s) => s !== "—").sort();

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-integra-navy">Balance General de Gastos</h2>
        <p className="text-sm text-gray-500">Resumen financiero por caso</p>
      </div>

      {/* Toggle de vista. Dos enlaces y no un componente cliente: es navegación,
          y así el estado vive en la URL y se puede compartir o marcar. */}
      <div className="flex gap-2">
        <Link
          href="/legal/gastos"
          className={
            "inline-flex min-h-[40px] items-center rounded-lg border px-4 text-sm font-semibold transition " +
            (!vistaGastos
              ? "border-integra-navy bg-integra-navy text-white"
              : "border-gray-200 bg-white text-gray-600 hover:border-integra-navy")
          }
        >
          Por caso
        </Link>
        <Link
          href="/legal/gastos?vista=gastos"
          className={
            "inline-flex min-h-[40px] items-center gap-2 rounded-lg border px-4 text-sm font-semibold transition " +
            (vistaGastos
              ? "border-integra-navy bg-integra-navy text-white"
              : "border-gray-200 bg-white text-gray-600 hover:border-integra-navy")
          }
        >
          Gastos
          {sinClasificar > 0 && !vistaGastos && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
              {sinClasificar}
            </span>
          )}
        </Link>
      </div>

      {vistaGastos ? (
        <GastosIndividualesTable
          rows={gastosIndividuales}
          cuentas={cuentas}
          sinClasificar={sinClasificar}
          totalLineas={totalLineas}
          filtroActivo={soloSinClasificar}
        />
      ) : (
      <>
      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-50">
              <TrendingUp className="text-green-600" size={24} />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500">Total Pagado por Clientes</p>
              <p className="text-xl font-bold text-green-700">{formatCurrency(grandPayments)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50">
              <TrendingDown className="text-amber-600" size={24} />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500">Total Gastos Ejecutados</p>
              <p className="text-xl font-bold text-amber-700">{formatCurrency(grandExpenses)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50">
              <Wallet className={grandBalance < 0 ? "text-red-600" : "text-blue-600"} size={24} />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500">Balance General</p>
              <p className={`text-xl font-bold ${grandBalance < 0 ? "text-red-600" : "text-green-700"}`}>
                {formatCurrency(grandBalance)}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Table with sort + filter */}
      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-20 text-center">
          <DollarSign size={40} className="mb-3 text-gray-300" />
          <p className="font-medium text-gray-500">No hay casos registrados</p>
        </div>
      ) : (
        <GastosTable rows={rows} statuses={statuses} />
      )}
      </>
      )}
    </div>
  );
}
