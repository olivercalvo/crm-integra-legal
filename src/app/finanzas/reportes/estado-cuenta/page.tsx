import { User } from "lucide-react";
import { ReportPlaceholder } from "../_components/report-placeholder";

export default function EstadoCuentaPage() {
  return (
    <ReportPlaceholder
      title="Estado de Cuenta Cliente"
      badge="Por cliente"
      icon={<User size={24} />}
    />
  );
}
