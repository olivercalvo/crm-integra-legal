import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/supabase/server-query";
import { allocateClientNumber } from "@/lib/clients/numbering";
import { validateClientType } from "@/lib/clients/fiscal-fields";

// POST — convert prospect to client
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    // La tabla `prospects` NO tiene client_type (es OTRA cosa que el prospect
    // del flujo de cotizaciones). Al convertir a cliente hay que CAPTURARLO:
    // sin él, el cliente entraría con client_type NULL y rompería la emisión
    // de FE ("Error interno").
    const body = await request.json().catch(() => ({}));
    const clientTypeError = validateClientType(body?.client_type);
    if (clientTypeError) {
      return NextResponse.json(
        { error: clientTypeError, fieldErrors: { client_type: clientTypeError } },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    const { data: profile } = await admin.from("users").select("tenant_id, role").eq("id", user.id).single();
    if (!profile) return NextResponse.json({ error: "Perfil no encontrado" }, { status: 403 });

    // Solo admin y abogada convierten prospectos a cliente (matriz de roles).
    const denied = requireRole(profile.role, ["admin", "abogada"]);
    if (denied) return denied;

    // Get prospect
    const { data: prospect } = await admin
      .from("prospects")
      .select("*")
      .eq("id", params.id)
      .eq("tenant_id", profile.tenant_id)
      .single();

    if (!prospect) return NextResponse.json({ error: "Prospecto no encontrado" }, { status: 404 });
    if (prospect.converted_client_id) {
      return NextResponse.json({ error: "Este prospecto ya fue convertido a cliente" }, { status: 400 });
    }

    // Generate next client_number via allocator atómico
    // (numbering_sequences + RPC). Reemplaza la lógica vieja lex-sort+regex
    // que colisionaba cuando había filas con prefijo > 'CLI-' (ej. TEST-FE-).
    const clientNumber = await allocateClientNumber(admin, profile.tenant_id);

    // Create client from prospect data
    const { data: newClient, error: clientError } = await admin
      .from("clients")
      .insert({
        tenant_id: profile.tenant_id,
        client_number: clientNumber,
        name: prospect.name,
        client_type: body.client_type,
        phone: prospect.phone,
        email: prospect.email,
        observations: prospect.notes ? `Convertido desde prospecto. ${prospect.notes}` : "Convertido desde prospecto.",
        client_status: "active",
      })
      .select()
      .single();

    if (clientError) {
      return NextResponse.json({ error: clientError.message }, { status: 500 });
    }

    // Update prospect with converted_client_id
    await admin
      .from("prospects")
      .update({
        status: "ganado",
        converted_client_id: newClient.id,
      })
      .eq("id", params.id);

    return NextResponse.json({
      client: newClient,
      message: `Cliente ${clientNumber} creado exitosamente`,
    }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
