/**
 * Queries server-side para gastos del bufete (business_expenses).
 * Patrón: admin client (bypass RLS) + filtro manual por tenant_id. Invocado
 * desde server components y route handlers.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BusinessExpenseListItem,
  BusinessExpenseStatus,
  BusinessExpenseWithDetails,
  SupplierSnapshot,
} from "@/lib/finanzas/types/business-expense";

import {
  esTipoValidoParaGasto,
  motivoDeRechazo,
} from "@/lib/finanzas/contabilidad/cuentas-de-gasto";
import type { AccountType } from "@/lib/finanzas/types/chart-of-account";

type DB = SupabaseClient;

/** Opción del select de cuenta contable de una compra del bufete. */
export interface ExpenseAccountOption {
  code: string;
  name: string;
  /** true solo para la cuenta que el gasto ya tenía y quedó desactivada. */
  inactiva?: boolean;
  /** Naturaleza de la cuenta, para poder agrupar el selector. */
  account_type?: AccountType;
}

interface ListBusinessExpensesParams {
  status?: BusinessExpenseStatus | null;
  /** Filtro por chart_account_code exacto. */
  accountCode?: string | null;
  /** Filtro por rango de expense_date (inclusivo). */
  fromDate?: string | null;
  toDate?: string | null;
  /** true → solo con ITBMS > 0; false → solo exentos; null → todos. */
  hasItbms?: boolean | null;
  /** Búsqueda libre contra description/supplier_name (ilike). */
  search?: string | null;
  page?: number;
  pageSize?: number;
}

export interface ListBusinessExpensesResult {
  rows: BusinessExpenseListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const DEFAULT_PAGE_SIZE = 25;

/**
 * Trae los proveedores de un conjunto de gastos, en una sola query.
 *
 * Se separa del SELECT principal por lo mismo que las cuentas contables: el join
 * de Supabase necesitaría la FK declarada en el esquema que lee PostgREST, y
 * una query extra es más barata de leer que de depurar.
 */
async function hidratarProveedores(
  db: DB,
  tenantId: string,
  filas: { supplier_id: string | null }[]
): Promise<Record<string, SupplierSnapshot>> {
  const ids = Array.from(
    new Set(filas.map((r) => r.supplier_id).filter((v): v is string => !!v))
  );
  if (ids.length === 0) return {};

  const { data } = await db
    .from("suppliers")
    .select("id, supplier_number, legal_name, trade_name, payment_terms_days")
    .eq("tenant_id", tenantId)
    .in("id", ids);

  const mapa: Record<string, SupplierSnapshot> = {};
  for (const s of (data ?? []) as unknown as SupplierSnapshot[]) mapa[s.id] = s;
  return mapa;
}

/**
 * Lista paginada de gastos del bufete con join al chart_of_accounts.
 * Ordenada por expense_date DESC por default (la consulta más frecuente
 * de la UI).
 */
export async function listBusinessExpenses(
  db: DB,
  tenantId: string,
  params: ListBusinessExpensesParams = {}
): Promise<ListBusinessExpensesResult> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let q = db
    .from("business_expenses")
    .select(
      `
        id, tenant_id, expense_date, due_date, supplier_id,
        supplier_name, supplier_ruc,
        chart_account_code, description,
        subtotal, tax_rate, tax_amount, total,
        status, payment_date, payment_method,
        receipt_url, receipt_filename, notes,
        created_by, created_at, updated_at
      `,
      { count: "exact" }
    )
    .eq("tenant_id", tenantId)
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (params.status) q = q.eq("status", params.status);
  if (params.accountCode) q = q.eq("chart_account_code", params.accountCode);
  if (params.fromDate) q = q.gte("expense_date", params.fromDate);
  if (params.toDate) q = q.lte("expense_date", params.toDate);
  if (params.hasItbms === true) q = q.gt("tax_amount", 0);
  if (params.hasItbms === false) q = q.eq("tax_amount", 0);
  if (params.search?.trim()) {
    const term = params.search.trim();
    // Búsqueda en description O supplier_name (campos free-text)
    q = q.or(
      `description.ilike.%${term}%,supplier_name.ilike.%${term}%`
    );
  }

  const { data, count, error } = await q;
  if (error) {
    console.error("[finanzas/queries] listBusinessExpenses failed", error);
    return { rows: [], total: 0, page, pageSize, totalPages: 1 };
  }

  // Hidratamos los account names en una sola query separada para evitar
  // el join de Supabase que requiere FK declarada (no la tenemos por D — la FK
  // es lógica). Es un single round-trip extra y mucho más legible.
  const codes = Array.from(
    new Set(
      (data ?? [])
        .map((r) => r.chart_account_code as string | null)
        .filter((c): c is string => !!c)
    )
  );

  let accountMap: Record<string, string> = {};
  if (codes.length > 0) {
    const { data: accs } = await db
      .from("chart_of_accounts")
      .select("code, name")
      .eq("tenant_id", tenantId)
      .in("code", codes);
    for (const a of accs ?? []) {
      accountMap[a.code as string] = a.name as string;
    }
  }

  // Mismo criterio que las cuentas: una query aparte en vez del join de Supabase.
  const supplierMap = await hidratarProveedores(db, tenantId, (data ?? []) as { supplier_id: string | null }[]);

  const rows: BusinessExpenseListItem[] = (data ?? []).map((r) => ({
    ...(r as unknown as BusinessExpenseListItem),
    account: r.chart_account_code
      ? { code: r.chart_account_code as string, name: accountMap[r.chart_account_code as string] ?? r.chart_account_code as string }
      : null,
    supplier: r.supplier_id ? supplierMap[r.supplier_id as string] ?? null : null,
  }));

  return {
    rows,
    total: count ?? 0,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)),
  };
}

/**
 * Detalle completo. Devuelve null si no existe o está fuera del tenant.
 */
export async function getBusinessExpenseById(
  db: DB,
  tenantId: string,
  id: string
): Promise<BusinessExpenseWithDetails | null> {
  const { data, error } = await db
    .from("business_expenses")
    .select(
      `
        id, tenant_id, expense_date, due_date, supplier_id,
        supplier_name, supplier_ruc,
        chart_account_code, description,
        subtotal, tax_rate, tax_amount, total,
        status, payment_date, payment_method,
        receipt_url, receipt_filename, notes,
        created_by, created_at, updated_at
      `
    )
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();

  if (error || !data) {
    if (error) console.error("[finanzas/queries] getBusinessExpenseById failed", error);
    return null;
  }

  // Account name (lookup independiente, FK lógica)
  let account: { code: string; name: string } | null = null;
  if (data.chart_account_code) {
    const { data: acc } = await db
      .from("chart_of_accounts")
      .select("code, name")
      .eq("tenant_id", tenantId)
      .eq("code", data.chart_account_code)
      .maybeSingle();
    account = acc
      ? { code: acc.code as string, name: acc.name as string }
      : { code: data.chart_account_code as string, name: data.chart_account_code as string };
  }

  // Creator name
  let createdByName: string | null = null;
  if (data.created_by) {
    const { data: u } = await db
      .from("users")
      .select("full_name")
      .eq("id", data.created_by)
      .maybeSingle();
    createdByName = (u?.full_name as string | undefined) ?? null;
  }

  const supplierMap = await hidratarProveedores(db, tenantId, [
    { supplier_id: (data.supplier_id as string | null) ?? null },
  ]);

  return {
    ...(data as unknown as BusinessExpenseWithDetails),
    account,
    supplier: data.supplier_id ? supplierMap[data.supplier_id as string] ?? null : null,
    created_by_name: createdByName,
  };
}

/**
 * Cuentas disponibles para clasificar una compra del bufete.
 *
 * =============================================================================
 * GASTO, COSTO **O ACTIVO** — corregido el 03/09/2026
 * =============================================================================
 * Hasta hoy filtraba `account_type = expense` y el comentario decía "para que el
 * select del form solo muestre cuentas relevantes (no activos, no pasivos, no
 * ingresos)".
 *
 * **Estaba mal, y contra un requisito explícito.** El acta del 25/08/2026 pide
 * para compras "la cuenta de gasto, **costo o activo** que elija el usuario".
 * Faltaban dos de los tres.
 *
 * El caso que lo rompe es cotidiano: **comprar una computadora** va a
 * `110001 Mobiliario y equipo`, que es un activo. Con el filtro viejo no se podía
 * elegir, así que o se registraba contra una cuenta de gasto —inflando el
 * resultado del ejercicio con algo que había que capitalizar— o no se registraba.
 *
 * Y el filtro no era solo del selector: `validarCuentaDeGasto()` reusaba el mismo
 * `.eq()` como GUARD. Un criterio de presentación convertido en permiso. Ver
 * `sop.md` SOP-024, tercera regla.
 *
 * El selector y el guard se mueven JUNTOS: aflojar uno sin el otro no se nota.
 */
export async function listExpenseAccountOptions(
  db: DB,
  tenantId: string,
  /**
   * Código que hay que incluir aunque esté inactivo: el que ya tiene el gasto
   * que se está editando. Sin esto, abrir un gasto viejo cuya cuenta se
   * desactivó vaciaría el selector y guardar lo reclasificaría en silencio.
   */
  incluirCodigo?: string | null
): Promise<ExpenseAccountOption[]> {
  // 🔴 SOLO ACTIVAS (02/09/2026). Hasta hoy esta consulta traía las 49 cuentas
  // de gasto, incluidas las 19 del plan anterior a Josuarth (5101, 5201,
  // 5205…). El formulario las ofrecía y el servidor las aceptaba, así que un
  // gasto se podía clasificar contra una cuenta muerta — y eso no se ve hasta
  // que el contador arma el reporte y la cuenta no aparece en ningún lado.
  const { data, error } = await db
    .from("chart_of_accounts")
    .select("code, name, active, account_type")
    .eq("tenant_id", tenantId)
    // Los tres tipos del acta. Qué tipo NO puede clasificar un desembolso vive en
    // `cuentas-de-gasto.ts`, así que el selector y el guard no pueden divergir.
    .in("account_type", ["asset", "cost", "expense"])
    .order("code");

  if (error) {
    console.error("[finanzas/queries] listExpenseAccountOptions failed", error);
    return [];
  }

  const filas = (data ?? []) as {
    code: string;
    name: string;
    active: boolean;
    account_type: AccountType;
  }[];
  return filas
    .filter((r) => r.active || (incluirCodigo != null && r.code === incluirCodigo))
    .map((r) => ({
      code: r.code,
      name: r.name,
      account_type: r.account_type,
      // La UI lo marca para que se entienda por qué aparece una cuenta que ya
      // no se ofrece a las demás.
      inactiva: !r.active,
    }));
}

/**
 * Verifica que un chart_account_code exista para el tenant y sea de tipo
 * expense. Usado por los validators server-side antes de INSERT/UPDATE.
 * Devuelve true si es válido O si el code es null (cuenta no clasificada).
 */
export type ResultadoCuentaGasto =
  | { estado: "ok" }
  | { estado: "no-existe" }
  | { estado: "inactiva" }
  | { estado: "tipo-invalido"; mensaje: string };

/**
 * ¿Se puede clasificar un gasto contra esta cuenta?
 *
 * 🔴 Devuelve `"inactiva"` para las cuentas del plan viejo. Ocultarlas del
 * selector no alcanza: el gate del servidor es el permiso, y esconder el botón
 * no reemplaza al rechazo — la misma regla que el repo aplica a los roles.
 *
 * `codigoPrevio` es la cuenta que el gasto YA tenía: si no cambió, se acepta
 * aunque esté inactiva. Editar la descripción de un gasto viejo no puede
 * fallar porque su cuenta se desactivó después.
 */
export async function validarCuentaDeGasto(
  db: DB,
  tenantId: string,
  code: string | null,
  codigoPrevio?: string | null
): Promise<ResultadoCuentaGasto> {
  if (code === null) return { estado: "ok" };

  // El `.eq("account_type", "expense")` que estaba acá hacía DOS cosas a la vez,
  // y una estaba mal: filtraba el tipo Y decidía el permiso. Un activo legítimo
  // volvía como "no-existe", o sea que el mensaje decía que la cuenta no estaba
  // en el plan cuando sí estaba y era la correcta.
  //
  // Ahora la consulta trae la cuenta y el TIPO se juzga aparte, con el predicado
  // compartido: existir, estar activa y poder clasificar un desembolso son tres
  // cosas distintas y merecen tres respuestas distintas.
  const { data, error } = await db
    .from("chart_of_accounts")
    .select("code, name, active, account_type")
    .eq("tenant_id", tenantId)
    .eq("code", code)
    .maybeSingle();

  if (error) {
    console.error("[finanzas/queries] validarCuentaDeGasto failed", error);
    return { estado: "no-existe" };
  }
  if (!data) return { estado: "no-existe" };

  const fila = data as {
    code: string;
    name: string;
    active: boolean;
    account_type: AccountType;
  };

  // El TIPO se juzga PRIMERO: una cuenta de ingreso no clasifica un desembolso ni
  // aunque esté activa, y contestar "está inactiva" mandaría a buscar el problema
  // al lugar equivocado.
  if (!esTipoValidoParaGasto(fila.account_type)) {
    return { estado: "tipo-invalido", mensaje: motivoDeRechazo(fila)! };
  }

  if (fila.active) return { estado: "ok" };
  // Inactiva, pero es la que ya tenía: se respeta.
  return codigoPrevio != null && code === codigoPrevio
    ? { estado: "ok" }
    : { estado: "inactiva" };
}


