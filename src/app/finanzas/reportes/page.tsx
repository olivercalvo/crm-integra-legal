import {
  BarChart3,
  Receipt,
  TrendingUp,
  Scale,
  FileText,
  Clock,
  User,
} from "lucide-react";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { ReportCard } from "./_components/report-card";

interface ReportItem {
  slug: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  badge: string;
}

const REPORTS: ReportItem[] = [
  {
    slug: "vat-summary",
    title: "VAT Summary (ITBMS)",
    description: "Resumen mensual de ITBMS para presentar a DGI.",
    icon: <Receipt size={22} />,
    badge: "Mensual",
  },
  {
    slug: "pyl",
    title: "Estado de Resultados (P&L)",
    description: "Ingresos vs gastos del período.",
    icon: <TrendingUp size={22} />,
    badge: "Mensual / Anual",
  },
  {
    slug: "balance",
    title: "Balance General",
    description: "Activos, pasivos y patrimonio a fecha de corte.",
    icon: <Scale size={22} />,
    badge: "Fecha de corte",
  },
  {
    slug: "ventas-mensuales",
    title: "Ventas Mensuales",
    description: "Detalle factura por factura del mes.",
    icon: <FileText size={22} />,
    badge: "Detallado",
  },
  {
    slug: "aging",
    title: "Aging por Cliente",
    description: "Antigüedad de cuentas por cobrar.",
    icon: <Clock size={22} />,
    badge: "Cobranza",
  },
  {
    slug: "estado-cuenta",
    title: "Estado de Cuenta Cliente",
    description: "Saldo y movimientos por cliente individual.",
    icon: <User size={22} />,
    badge: "Por cliente",
  },
];

export default async function ReportesHubPage() {
  const { userRole, userName } = await getAuthenticatedContext();

  const intro =
    userRole === "contador"
      ? `Hola ${userName}, descarga aquí los reportes para el cierre mensual.`
      : "Reportes disponibles para análisis financiero y cierre mensual.";

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-integra-navy/5 p-2 text-integra-gold ring-1 ring-integra-gold/30">
          <BarChart3 size={24} />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-integra-navy">
            Reportes Contables
          </h1>
          <p className="text-sm text-gray-500">{intro}</p>
        </div>
      </div>

      {/* Grid de reportes */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {REPORTS.map((report) => (
          <ReportCard
            key={report.slug}
            title={report.title}
            description={report.description}
            icon={report.icon}
            badge={report.badge}
            href={`/finanzas/reportes/${report.slug}`}
          />
        ))}
      </div>
    </div>
  );
}
