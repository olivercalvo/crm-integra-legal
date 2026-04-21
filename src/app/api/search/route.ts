import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  fallbackCaseSearchIds,
  fallbackClientSearchIds,
  tryUniversalSearchIds,
} from "@/lib/utils/search-server";

/**
 * GET /api/search?q=texto
 *
 * Búsqueda global del header. Devuelve hasta 8 clientes y 8 casos
 * ordenados por relevancia básica (IDs que matchearon primero), ya
 * filtrados al tenant del usuario autenticado.
 *
 * Usa las RPCs universales cuando están disponibles
 * (sql/pending/002_enable_unaccent_and_search_rpcs.sql); si no, cae
 * al fallback SDK.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!profile) {
      return NextResponse.json({ error: "Perfil no encontrado" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const q = (searchParams.get("q") ?? "").trim();

    if (q.length < 2) {
      return NextResponse.json({ clients: [], cases: [] });
    }

    const tenantId = profile.tenant_id as string;

    const [caseIdsRpc, clientIdsRpc] = await Promise.all([
      tryUniversalSearchIds(admin, "search_cases_ids", tenantId, q),
      tryUniversalSearchIds(admin, "search_clients_ids", tenantId, q),
    ]);

    const caseIds = caseIdsRpc ?? (await fallbackCaseSearchIds(admin, tenantId, q));
    const clientIds =
      clientIdsRpc ?? (await fallbackClientSearchIds(admin, tenantId, q));

    const [clientsRes, casesRes] = await Promise.all([
      clientIds.length > 0
        ? admin
            .from("clients")
            .select("id, name, ruc, client_number")
            .eq("tenant_id", tenantId)
            .eq("active", true)
            .in("id", clientIds.slice(0, 8))
        : Promise.resolve({ data: [] as Array<{ id: string; name: string; ruc: string | null; client_number: string }> }),
      caseIds.length > 0
        ? admin
            .from("cases")
            .select("id, case_code, description, clients!inner(name)")
            .eq("tenant_id", tenantId)
            .in("id", caseIds.slice(0, 8))
        : Promise.resolve({ data: [] as Array<{ id: string; case_code: string; description: string | null; clients: { name: string } | { name: string }[] | null }> }),
    ]);

    return NextResponse.json({
      clients: clientsRes.data ?? [],
      cases: casesRes.data ?? [],
    });
  } catch (err) {
    console.error("Error in /api/search:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
