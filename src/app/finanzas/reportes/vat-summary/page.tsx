import { Receipt } from "lucide-react";
import { ReportPlaceholder } from "../_components/report-placeholder";

export default function VatSummaryPage() {
  return (
    <ReportPlaceholder
      title="VAT Summary (ITBMS)"
      badge="Mensual"
      icon={<Receipt size={24} />}
    />
  );
}
