import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  parseImportFile,
  validateImport,
  type ImportClientRow,
  type ImportCaseRow,
} from "@/lib/utils/import-parser";

// ---------------------------------------------------------------------------
// POST /api/import — Parse & validate (preview mode) or execute import
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
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
      .select("tenant_id, role")
      .eq("id", user.id)
      .single();

    if (!profile) {
      return NextResponse.json({ error: "Perfil no encontrado" }, { status: 403 });
    }

    // Only admin and abogada can import
    if (!["admin", "abogada"].includes(profile.role)) {
      return NextResponse.json({ error: "Sin permisos para importar" }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const mode = formData.get("mode") as string; // "preview" or "execute"

    if (!file) {
      return NextResponse.json({ error: "Archivo requerido" }, { status: 400 });
    }

    // Validate file type
    const validTypes = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "text/csv",
      "application/csv",
    ];
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!validTypes.includes(file.type) && !["xlsx", "xls", "csv"].includes(ext || "")) {
      return NextResponse.json(
        { error: "Formato no soportado. Use .xlsx, .xls o .csv" },
        { status: 400 }
      );
    }

    // Parse file
    const buffer = await file.arrayBuffer();
    const { clientRows, caseRows, sheetNames } = parseImportFile(buffer);

    // Get existing clients for duplicate detection
    const { data: existingClients } = await admin
      .from("clients")
      .select("name, ruc, client_number")
      .eq("tenant_id", profile.tenant_id);

    const preview = validateImport(clientRows, caseRows, existingClients || []);

    // Preview mode — return validation results
    if (mode !== "execute") {
      return NextResponse.json({
        preview,
        sheetNames,
      });
    }

    // -----------------------------------------------------------------------
    // Execute mode — insert data
    // -----------------------------------------------------------------------

    const skipDuplicates = formData.get("skipDuplicates") === "true";
    const results = {
      clientsCreated: 0,
      clientsSkipped: 0,
      casesCreated: 0,
      casesSkipped: 0,
      errors: [] as string[],
    };

    // Build duplicate set for skipping
    const duplicateNames = new Set(
      preview.duplicateClients.map((d) => d.name.toLowerCase().trim())
    );

    // ----- Insert clients -----
    // Get current max client_number
    const { data: lastClient } = await admin
      .from("clients")
      .select("client_number")
      .eq("tenant_id", profile.tenant_id)
      .order("client_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    let nextClientNum = 1;
    if (lastClient?.client_number) {
      const match = lastClient.client_number.match(/CLI-(\d+)/);
      if (match) nextClientNum = parseInt(match[1], 10) + 1;
    }

    // Map: name (lowercase) → client_id (for linking cases)
    const clientMap = new Map<string, string>();

    // Pre-populate with existing clients
    const { data: allExisting } = await admin
      .from("clients")
      .select("id, name")
      .eq("tenant_id", profile.tenant_id);
    for (const ec of allExisting || []) {
      clientMap.set(ec.name.toLowerCase().trim(), ec.id);
    }

    for (const client of preview.clients) {
      const nameLower = client.name.toLowerCase().trim();

      // Skip duplicates if requested
      if (skipDuplicates && duplicateNames.has(nameLower)) {
        results.clientsSkipped++;
        continue;
      }

      // If already exists (and not skipping), also skip
      if (clientMap.has(nameLower)) {
        results.clientsSkipped++;
        continue;
      }

      const clientNumber = `CLI-${String(nextClientNum).padStart(3, "0")}`;
      nextClientNum++;

      const { data: newClient, error } = await admin
        .from("clients")
        .insert({
          tenant_id: profile.tenant_id,
          client_number: clientNumber,
          name: client.name.trim(),
          ruc: client.ruc,
          type: client.type,
          contact: client.contact,
          phone: client.phone,
          email: client.email,
          observations: client.observations,
          active: true,
        })
        .select("id")
        .single();

      if (error) {
        results.errors.push(`Fila ${client.rowNumber}: ${error.message}`);
        continue;
      }

      clientMap.set(nameLower, newClient.id);
      results.clientsCreated++;

      // Audit log
      await admin.from("audit_log").insert({
        tenant_id: profile.tenant_id,
        user_id: user.id,
        entity: "clients",
        entity_id: newClient.id,
        action: "create",
        field: "import",
        old_value: null,
        new_value: JSON.stringify({ name: client.name, source: "bulk_import" }),
      });
    }

    // ----- Insert cases -----
    // Get catalog lookups
    const [classificationsRes, institutionsRes, statusesRes, teamRes] = await Promise.all([
      admin.from("cat_classifications").select("id, name, prefix").eq("tenant_id", profile.tenant_id),
      admin.from("cat_institutions").select("id, name").eq("tenant_id", profile.tenant_id),
      admin.from("cat_statuses").select("id, name").eq("tenant_id", profile.tenant_id),
      admin.from("cat_team").select("id, name").eq("tenant_id", profile.tenant_id),
    ]);

    const classificationMap = new Map<string, { id: string; prefix: string }>();
    for (const c of classificationsRes.data || []) {
      classificationMap.set(c.name.toLowerCase().trim(), { id: c.id, prefix: c.prefix });
    }

    const institutionMap = new Map<string, string>();
    for (const i of institutionsRes.data || []) {
      institutionMap.set(i.name.toLowerCase().trim(), i.id);
    }

    const statusMap = new Map<string, string>();
    for (const s of statusesRes.data || []) {
      statusMap.set(s.name.toLowerCase().trim(), s.id);
    }

    const teamMap = new Map<string, string>();
    for (const t of teamRes.data || []) {
      teamMap.set(t.name.toLowerCase().trim(), t.id);
    }

    // Get default status
    const defaultStatusId = statusesRes.data?.[0]?.id || null;

    // Get current max case_number
    const { data: maxCase } = await admin
      .from("cases")
      .select("case_number")
      .eq("tenant_id", profile.tenant_id)
      .order("case_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    let nextCaseNum = (maxCase?.case_number ?? 0) + 1;

    for (const caseRow of preview.cases) {
      // Find client_id
      const clientNameLower = caseRow.clientName.toLowerCase().trim();
      let clientId = clientMap.get(clientNameLower);

      // If client not found, create it
      if (!clientId && caseRow.clientName) {
        const clientNumber = `CLI-${String(nextClientNum).padStart(3, "0")}`;
        nextClientNum++;

        const { data: autoClient, error: autoErr } = await admin
          .from("clients")
          .insert({
            tenant_id: profile.tenant_id,
            client_number: clientNumber,
            name: caseRow.clientName.trim(),
            ruc: caseRow.clientRuc,
            active: true,
          })
          .select("id")
          .single();

        if (autoErr) {
          results.errors.push(`Fila ${caseRow.rowNumber}: No se pudo crear cliente "${caseRow.clientName}": ${autoErr.message}`);
          results.casesSkipped++;
          continue;
        }

        clientId = autoClient!.id;
        clientMap.set(clientNameLower, clientId!);
        results.clientsCreated++;
      }

      if (!clientId) {
        results.errors.push(`Fila ${caseRow.rowNumber}: Cliente no encontrado`);
        results.casesSkipped++;
        continue;
      }

      // Resolve catalog references
      const classMatch = caseRow.classification
        ? classificationMap.get(caseRow.classification.toLowerCase().trim())
        : null;
      const classId = classMatch?.id || null;
      const prefix = classMatch?.prefix || "EXP";

      const instId = caseRow.institution
        ? institutionMap.get(caseRow.institution.toLowerCase().trim()) || null
        : null;

      const statId = caseRow.status
        ? statusMap.get(caseRow.status.toLowerCase().trim()) || defaultStatusId
        : defaultStatusId;

      const respId = caseRow.responsible
        ? teamMap.get(caseRow.responsible.toLowerCase().trim()) || null
        : null;

      const caseCode = `${prefix}-${String(nextCaseNum).padStart(3, "0")}`;

      const { data: newCase, error: caseErr } = await admin
        .from("cases")
        .insert({
          tenant_id: profile.tenant_id,
          client_id: clientId,
          case_number: nextCaseNum,
          case_code: caseCode,
          description: caseRow.description,
          classification_id: classId,
          institution_id: instId,
          responsible_id: respId,
          opened_at: caseRow.openedAt || new Date().toISOString().split("T")[0],
          status_id: statId,
          physical_location: caseRow.physicalLocation,
          observations: caseRow.observations,
          has_digital_file: caseRow.hasDigitalFile,
        })
        .select("id")
        .single();

      if (caseErr) {
        results.errors.push(`Fila ${caseRow.rowNumber}: ${caseErr.message}`);
        results.casesSkipped++;
        continue;
      }

      nextCaseNum++;
      results.casesCreated++;

      // Audit log
      await admin.from("audit_log").insert({
        tenant_id: profile.tenant_id,
        user_id: user.id,
        entity: "cases",
        entity_id: newCase.id,
        action: "create",
        field: "import",
        old_value: null,
        new_value: JSON.stringify({ case_code: caseCode, client: caseRow.clientName, source: "bulk_import" }),
      });
    }

    return NextResponse.json({ results });
  } catch (error) {
    console.error("Import error:", error);
    return NextResponse.json(
      { error: "Error interno al procesar la importación" },
      { status: 500 }
    );
  }
}
