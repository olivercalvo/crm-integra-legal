import { Scale } from "lucide-react";
import { ReportPlaceholder } from "../_components/report-placeholder";

export default function BalancePage() {
  return (
    <ReportPlaceholder
      title="Balance General"
      badge="Fecha de corte"
      icon={<Scale size={24} />}
    />
  );
}
