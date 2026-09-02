import { FileText } from "lucide-react";
import { ReportPlaceholder } from "../_components/report-placeholder";


/**
 * El título de la pestaña. Sin esto el navegador muestra "CRM Integra Legal" en
 * todas, y con seis pestañas abiertas no se distingue cuál es cuál.
 */
export const metadata = {
  title: "Ventas Mensuales · Reportes",
};
export default function VentasMensualesPage() {
  return (
    <ReportPlaceholder
      title="Ventas Mensuales"
      badge="Detallado"
      icon={<FileText size={24} />}
    />
  );
}
