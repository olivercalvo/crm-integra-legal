import type { SupabaseClient } from "@supabase/supabase-js";
import { buildIlikeOrClause } from "@/lib/utils/search";

export type SearchRpc =
  | "search_cases_ids"
  | "search_clients_ids"
  | "search_prospects_ids";

/**
 * Intenta invocar la RPC de búsqueda universal correspondiente.
 *
 * Devuelve un array de IDs si la RPC existe y responde; `null` si falla
 * (p.ej. la RPC aún no se instaló en la BD). El caller debe usar el
 * fallback `fallbackCaseSearchIds` / `fallbackClientSearchIds` en ese caso.
 */
export async function tryUniversalSearchIds(
  client: SupabaseClient,
  rpc: SearchRpc,
  tenantId: string,
  query: string
): Promise<string[] | null> {
  const q = query.trim();
  if (!q) return [];

  const { data, error } = await client.rpc(rpc, {
    p_tenant_id: tenantId,
    p_query: q,
  });

  if (error) {
    // RPC no existe todavía (code 42883, mensaje "Could not find the function")
    // o cualquier otro fallo → el caller cae al fallback.
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[search] RPC ${rpc} no disponible: ${error.message}`);
    }
    return null;
  }

  return (data as Array<{ id: string }> | null)?.map((r) => r.id) ?? [];
}

/**
 * Fallback de búsqueda de casos sin RPC: hace varias queries SDK en paralelo
 * cubriendo los campos más comunes + JOINs manuales (cliente, clasificación,
 * institución, abogada, asistente). Menos eficiente que la RPC pero cubre los
 * mismos campos. Case-insensitive (ILIKE). NO tolera acentos en la BD
 * (requiere la extensión unaccent, que viene con el SQL 002).
 */
export async function fallbackCaseSearchIds(
  client: SupabaseClient,
  tenantId: string,
  query: string
): Promise<string[]> {
  const q = query.trim();
  if (!q) return [];

  const caseDirectFields = [
    "case_code",
    "description",
    "observations",
    "physical_location",
    "entity",
    "procedure_type",
    "institution_procedure_number",
    "institution_case_number",
  ];

  const clientFields = ["name", "client_number", "ruc", "email", "phone", "type", "address", "contact"];
  const classificationFields = ["name", "prefix"];
  const institutionFields = ["name"];
  const statusFields = ["name"];
  const userFields = ["full_name", "email"];

  const [direct, clientsRes, classRes, instRes, statusRes, usersRes] = await Promise.all([
    client
      .from("cases")
      .select("id")
      .eq("tenant_id", tenantId)
      .or(buildIlikeOrClause(q, caseDirectFields)),
    client
      .from("clients")
      .select("id")
      .eq("tenant_id", tenantId)
      .or(buildIlikeOrClause(q, clientFields)),
    client
      .from("cat_classifications")
      .select("id")
      .eq("tenant_id", tenantId)
      .or(buildIlikeOrClause(q, classificationFields)),
    client
      .from("cat_institutions")
      .select("id")
      .eq("tenant_id", tenantId)
      .or(buildIlikeOrClause(q, institutionFields)),
    client
      .from("cat_statuses")
      .select("id")
      .eq("tenant_id", tenantId)
      .or(buildIlikeOrClause(q, statusFields)),
    client
      .from("users")
      .select("id")
      .eq("tenant_id", tenantId)
      .or(buildIlikeOrClause(q, userFields)),
  ]);

  const directIds = new Set<string>(
    (direct.data ?? []).map((r: { id: string }) => r.id)
  );

  const extraFilters: Array<Promise<{ data: Array<{ id: string }> | null }>> = [];
  const pushByRelation = (col: string, ids: Array<{ id: string }> | null) => {
    const idList = (ids ?? []).map((r) => r.id);
    if (idList.length > 0) {
      extraFilters.push(
        client
          .from("cases")
          .select("id")
          .eq("tenant_id", tenantId)
          .in(col, idList) as unknown as Promise<{ data: Array<{ id: string }> | null }>
      );
    }
  };
  pushByRelation("client_id", clientsRes.data);
  pushByRelation("classification_id", classRes.data);
  pushByRelation("institution_id", instRes.data);
  pushByRelation("status_id", statusRes.data);
  pushByRelation("responsible_id", usersRes.data);
  pushByRelation("assistant_id", usersRes.data);

  const relResults = await Promise.all(extraFilters);
  for (const res of relResults) {
    for (const row of res.data ?? []) directIds.add(row.id);
  }

  return Array.from(directIds);
}

/**
 * Fallback de búsqueda de clientes sin RPC.
 */
export async function fallbackClientSearchIds(
  client: SupabaseClient,
  tenantId: string,
  query: string
): Promise<string[]> {
  const q = query.trim();
  if (!q) return [];

  const directFields = [
    "name",
    "client_number",
    "ruc",
    "email",
    "phone",
    "type",
    "address",
    "contact",
    "observations",
  ];

  // Also match clients that have cases matching by code/description.
  const [direct, caseMatch] = await Promise.all([
    client
      .from("clients")
      .select("id")
      .eq("tenant_id", tenantId)
      .or(buildIlikeOrClause(q, directFields)),
    client
      .from("cases")
      .select("client_id")
      .eq("tenant_id", tenantId)
      .or(buildIlikeOrClause(q, ["case_code", "description"])),
  ]);

  const ids = new Set<string>(
    (direct.data ?? []).map((r: { id: string }) => r.id)
  );
  for (const row of caseMatch.data ?? []) {
    if ((row as { client_id: string | null }).client_id) {
      ids.add((row as { client_id: string }).client_id);
    }
  }
  return Array.from(ids);
}

/**
 * Fallback de búsqueda de prospectos sin RPC.
 */
export async function fallbackProspectSearchIds(
  client: SupabaseClient,
  tenantId: string,
  query: string
): Promise<string[]> {
  const q = query.trim();
  if (!q) return [];

  const fields = ["name", "phone", "email", "service_interest", "notes", "status"];
  const { data } = await client
    .from("prospects")
    .select("id")
    .eq("tenant_id", tenantId)
    .or(buildIlikeOrClause(q, fields));

  return (data ?? []).map((r: { id: string }) => r.id);
}
