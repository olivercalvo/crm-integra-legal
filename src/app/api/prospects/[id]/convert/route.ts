import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// POST — convert prospect to client
export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const admin = createAdminClient();
    const { data: profile } = await admin.from("users").select("tenant_id").eq("id", user.id).single();
    if (!profile) return NextResponse.json({ error: "Perfil no encontrado" }, { status: 403 });

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

    // Generate next client_number
    const { data: maxClient } = await admin
      .from("clients")
      .select("client_number")
      .eq("tenant_id", profile.tenant_id)
      .order("client_number", { ascending: false })
      .limit(1)
      .single();

    let nextNum = 1;
    if (maxClient?.client_number) {
      const match = (maxClient.client_number as string).match(/CLI-(\d+)/);
      if (match) nextNum = parseInt(match[1], 10) + 1;
    }
    const clientNumber = `CLI-${String(nextNum).padStart(3, "0")}`;

    // Create client from prospect data
    const { data: newClient, error: clientError } = await admin
      .from("clients")
      .insert({
        tenant_id: profile.tenant_id,
        client_number: clientNumber,
        name: prospect.name,
        phone: prospect.phone,
        email: prospect.email,
        observations: prospect.notes ? `Convertido desde prospecto. ${prospect.notes}` : "Convertido desde prospecto.",
        active: true,
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
