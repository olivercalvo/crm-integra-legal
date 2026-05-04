import { ImportWizard } from "@/components/import/import-wizard";
import { FileSpreadsheet, Users, FolderOpen, ArrowRight } from "lucide-react";

export default function ImportarPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-integra-navy sm:text-2xl">
          <FileSpreadsheet size={24} />
          Importación Masiva
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Importe clientes y casos desde archivos Excel o CSV
        </p>
      </div>

      {/* Recommended flow */}
      <div className="flex items-center gap-3 rounded-lg border border-integra-gold/30 bg-integra-gold/5 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium text-integra-navy">
          <Users size={16} />
          Paso 1: Importar Clientes
        </div>
        <ArrowRight size={16} className="text-integra-gold" />
        <div className="flex items-center gap-2 text-sm font-medium text-integra-navy">
          <FolderOpen size={16} />
          Paso 2: Importar Casos
        </div>
      </div>

      {/* Clients import */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Users size={20} className="text-integra-navy" />
          <h2 className="text-lg font-semibold text-integra-navy">Importar Clientes</h2>
        </div>
        <ImportWizard importType="clients" />
      </section>

      {/* Separator */}
      <hr className="border-gray-200" />

      {/* Cases import */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <FolderOpen size={20} className="text-integra-navy" />
          <h2 className="text-lg font-semibold text-integra-navy">Importar Casos</h2>
        </div>
        <p className="text-sm text-gray-500">
          Los clientes deben existir previamente en el sistema. Si el cliente de un caso no se encuentra, aparecerá como error en la validación.
        </p>
        <ImportWizard importType="cases" />
      </section>
    </div>
  );
}
