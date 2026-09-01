import { Clock } from "lucide-react";
import { ReportPlaceholder } from "../_components/report-placeholder";

export default function AgingPage() {
  return (
    <ReportPlaceholder
      title="Antigüedad de Saldos"
      badge="Cobranza — CxC y CxP"
      icon={<Clock size={24} />}
    />
  );
}
