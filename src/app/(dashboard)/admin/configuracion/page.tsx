import { redirect } from "next/navigation";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { CatalogManager } from "@/components/admin/catalog-manager";
import type { ColumnConfig } from "@/components/admin/catalog-manager";

// Column configs for each catalog
const CLASSIFICATIONS_COLUMNS: ColumnConfig[] = [
  { key: "name", label: "Nombre", editable: true, width: "40%" },
  { key: "prefix", label: "Prefijo", editable: true, uppercase: true, width: "15%" },
  { key: "description", label: "Descripción", editable: true, width: "45%" },
];

const STATUSES_COLUMNS: ColumnConfig[] = [
  { key: "name", label: "Nombre", editable: true },
];

const INSTITUTIONS_COLUMNS: ColumnConfig[] = [
  { key: "name", label: "Nombre", editable: true },
];

const TEAM_COLUMNS: ColumnConfig[] = [
  { key: "name", label: "Nombre", editable: true, width: "50%" },
  { key: "role", label: "Cargo / Rol", editable: true, width: "50%" },
];

export default async function ConfiguracionPage() {
  const { userRole } = await getAuthenticatedContext();

  if (userRole !== "admin") {
    redirect("/dashboard");
  }

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div>
        <h2 className="text-2xl font-bold text-integra-navy">
          Configuración del Sistema
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Administra los catálogos y valores del sistema. Los cambios aplican a todos los usuarios.
        </p>
      </div>

      {/* Section: Clasificaciones */}
      <section>
        <div className="mb-3">
          <h3 className="text-base font-semibold text-integra-navy">
            Clasificaciones de Casos
          </h3>
          <p className="text-xs text-gray-500">
            Define los tipos de caso y su prefijo para el código automático (ej. CIV-001).
          </p>
        </div>
        <CatalogManager
          catalogName="Clasificaciones"
          apiEndpoint="cat_classifications"
          columns={CLASSIFICATIONS_COLUMNS}
          emptyMessage="No hay clasificaciones. Agrega una para comenzar."
        />
      </section>

      {/* Section: Estados */}
      <section>
        <div className="mb-3">
          <h3 className="text-base font-semibold text-integra-navy">
            Estados de Caso
          </h3>
          <p className="text-xs text-gray-500">
            Los estados disponibles para asignar a los casos (ej. Activo, En Espera, Cerrado).
          </p>
        </div>
        <CatalogManager
          catalogName="Estados"
          apiEndpoint="cat_statuses"
          columns={STATUSES_COLUMNS}
          emptyMessage="No hay estados. Agrega uno para comenzar."
        />
      </section>

      {/* Section: Instituciones */}
      <section>
        <div className="mb-3">
          <h3 className="text-base font-semibold text-integra-navy">
            Instituciones
          </h3>
          <p className="text-xs text-gray-500">
            Tribunales, juzgados, entidades gubernamentales u otras instituciones relacionadas.
          </p>
        </div>
        <CatalogManager
          catalogName="Instituciones"
          apiEndpoint="cat_institutions"
          columns={INSTITUTIONS_COLUMNS}
          emptyMessage="No hay instituciones. Agrega una para comenzar."
        />
      </section>

      {/* Section: Equipo */}
      <section>
        <div className="mb-3">
          <h3 className="text-base font-semibold text-integra-navy">
            Equipo Legal
          </h3>
          <p className="text-xs text-gray-500">
            Miembros del equipo para asignación de responsables en casos.
          </p>
        </div>
        <CatalogManager
          catalogName="Equipo"
          apiEndpoint="cat_team"
          columns={TEAM_COLUMNS}
          emptyMessage="No hay miembros en el equipo. Agrega uno para comenzar."
        />
      </section>
    </div>
  );
}
