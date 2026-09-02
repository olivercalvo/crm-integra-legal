import { redirect } from "next/navigation";

import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { loadAsientosDelDiario } from "@/lib/finanzas/reports/diario-general-source";
import { buildDiarioGeneral } from "@/lib/finanzas/reports/diario-general";
import { loadDestinosDeOrigen } from "@/lib/finanzas/reports/libro-mayor-source";
import { StatementHeader, JournalScopeNotice } from "../_components/financial-statement";
import { REPORT_FIRM_NAME, formatGeneratedAt } from "../_components/report-meta";
import { DiarioFiltros } from "./_components/diario-filtros";
import { DiarioTable } from "./_components/diario-table";

const FINANZAS_ROLES = ["admin", "abogada", "contador"];

export const metadata = {
  title: "Diario General · Reportes",
};

export default async function DiarioGeneralPage({
  searchParams,
}: {
  searchParams: { desde?: string; hasta?: string };
}) {
  const ctx = await getAuthenticatedContext();
  if (!FINANZAS_ROLES.includes(ctx.userRole)) {
    redirect("/finanzas");
  }

  const desde = searchParams.desde?.trim() || "";
  const hasta = searchParams.hasta?.trim() || "";

  const crudos = await loadAsientosDelDiario(ctx.db, ctx.tenantId, { desde, hasta });
  const diario = buildDiarioGeneral(crudos);

  // Los destinos salen del MISMO resolvedor que usa el Libro Mayor, así que los
  // enlaces de los dos reportes van al mismo lugar y respetan el permiso del rol
  // que los abre. Ver `destino-documento.ts`.
  const destinos = await loadDestinosDeOrigen(
    ctx.db,
    ctx.tenantId,
    crudos.map((a) => ({ source_type: a.source_type, source_id: a.source_id }))
  );

  return (
    <div className="space-y-4">

      <StatementHeader
        firmName={REPORT_FIRM_NAME}
        title="Diario General"
        subtitle="Asientos en orden cronológico, con sus líneas"
        generatedAt={formatGeneratedAt()}
      />

      <JournalScopeNotice />

      <DiarioFiltros desde={desde} hasta={hasta} />

      <DiarioTable diario={diario} destinos={destinos} />
    </div>
  );
}
