import { FileText } from "lucide-react";
import { ReportPlaceholder } from "../_components/report-placeholder";

export default function VentasMensualesPage() {
  return (
    <ReportPlaceholder
      title="Ventas Mensuales"
      badge="Detallado"
      icon={<FileText size={24} />}
    />
  );
}
