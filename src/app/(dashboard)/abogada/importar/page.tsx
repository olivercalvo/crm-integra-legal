import { ImportWizard } from "@/components/import/import-wizard";
import { FileSpreadsheet } from "lucide-react";

export default function ImportarPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-integra-navy sm:text-2xl">
          <FileSpreadsheet size={24} />
          Importación masiva
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Importe clientes y casos desde un archivo Excel o CSV
        </p>
      </div>

      <ImportWizard />
    </div>
  );
}
