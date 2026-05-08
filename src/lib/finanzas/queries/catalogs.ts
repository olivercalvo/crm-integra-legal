/**
 * Server queries de catálogos para el módulo Finanzas.
 *
 * Patrón consistente con /legal: admin client (bypass RLS) + filter manual
 * por tenant_id. Estas funciones se invocan desde server components o desde
 * route handlers — nunca desde client components directamente.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ClientOption,
  CaseOption,
  ServiceOption,
  TaxCodeOption,
  AccountOption,
} from "@/lib/finanzas/types/invoice";

type DB = SupabaseClient;

/** Lista de clientes activos para combobox. Ordenado por nombre. */
export async function listClientsActive(db: DB, tenantId: string): Promise<ClientOption[]> {
  const { data, error } = await db
    .from("clients")
    .select("id, name, client_number, default_payment_terms_days, ruc")
    .eq("tenant_id", tenantId)
    .eq("client_status", "active")
    .order("name");

  if (error) {
    console.error("[finanzas/queries] listClientsActive failed", error);
    return [];
  }
  return (data ?? []) as ClientOption[];
}

/**
 * Lista de casos del cliente seleccionado. Si clientId es null devuelve [].
 * Solo activos (no usamos status_id porque el filtro de "activos" puede
 * variar por tenant — usamos cases.active si existe; si no, todos).
 */
export async function listCasesByClient(
  db: DB,
  tenantId: string,
  clientId: string | null
): Promise<CaseOption[]> {
  if (!clientId) return [];

  const { data, error } = await db
    .from("cases")
    .select("id, case_code, description, client_id")
    .eq("tenant_id", tenantId)
    .eq("client_id", clientId)
    .order("case_code");

  if (error) {
    console.error("[finanzas/queries] listCasesByClient failed", error);
    return [];
  }
  return (data ?? []) as CaseOption[];
}

/**
 * Servicios activos del catálogo + denormalizamos default_tax_rate y
 * default_tax_code_id desde tax_codes para evitar un round-trip extra al
 * elegir un servicio en el form.
 */
export async function listServicesActive(db: DB, tenantId: string): Promise<ServiceOption[]> {
  const { data, error } = await db
    .from("services_catalog")
    .select(`
      id,
      code,
      name,
      service_type,
      revenue_account,
      default_tax_code,
      tax_codes!services_catalog_default_tax_code_fk(id, rate)
    `)
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .order("code");

  if (error) {
    console.error("[finanzas/queries] listServicesActive failed", error);
    return [];
  }

  type Row = {
    id: string;
    code: string;
    name: string;
    service_type: ServiceOption["service_type"];
    revenue_account: string;
    default_tax_code: string;
    tax_codes: { id: string; rate: number } | null;
  };

  return (data as unknown as Row[]).map((s) => ({
    id: s.id,
    code: s.code,
    name: s.name,
    service_type: s.service_type,
    revenue_account: s.revenue_account,
    default_tax_code: s.default_tax_code,
    default_tax_rate: s.tax_codes ? Number(s.tax_codes.rate) : undefined,
    default_tax_code_id: s.tax_codes?.id,
  }));
}

/** Tax codes activos. */
export async function listTaxCodesActive(db: DB, tenantId: string): Promise<TaxCodeOption[]> {
  const { data, error } = await db
    .from("tax_codes")
    .select("id, code, name, rate")
    .eq("tenant_id", tenantId)
    .order("code");

  if (error) {
    console.error("[finanzas/queries] listTaxCodesActive failed", error);
    return [];
  }
  return (data ?? []).map((t) => ({
    id: t.id as string,
    code: t.code as string,
    name: t.name as string,
    rate: Number(t.rate),
  }));
}

/** Cuentas activas del chart_of_accounts. Útil para fallback en líneas personalizadas. */
export async function listAccountsActive(db: DB, tenantId: string): Promise<AccountOption[]> {
  const { data, error } = await db
    .from("chart_of_accounts")
    .select("code, name, account_type")
    .eq("tenant_id", tenantId)
    .order("code");

  if (error) {
    console.error("[finanzas/queries] listAccountsActive failed", error);
    return [];
  }
  return (data ?? []) as AccountOption[];
}
