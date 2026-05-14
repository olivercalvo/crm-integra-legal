import { TrendingUp } from "lucide-react";
import { ReportPlaceholder } from "../_components/report-placeholder";

export default function PyLPage() {
  return (
    <ReportPlaceholder
      title="Estado de Resultados (P&L)"
      badge="Mensual / Anual"
      icon={<TrendingUp size={24} />}
    />
  );
}
