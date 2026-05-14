import { Clock } from "lucide-react";
import { ReportPlaceholder } from "../_components/report-placeholder";

export default function AgingPage() {
  return (
    <ReportPlaceholder
      title="Aging por Cliente"
      badge="Cobranza"
      icon={<Clock size={24} />}
    />
  );
}
