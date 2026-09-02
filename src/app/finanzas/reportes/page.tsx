import {
  BarChart3,
  BookOpen,
  CalendarDays,
  CheckSquare,
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
  /** true = la pantalla es un marcador de lugar, sin reporte detrás. */
  pendiente?: boolean;
}

const REPORTS: ReportItem[] = [
  {
    slug: "vat-summary",
    title: "VAT Summary (ITBMS)",
    description: "Resumen mensual de ITBMS para presentar a DGI.",
    icon: <Receipt size={22} />,
    badge: "Mensual",
  },
  // El badge dice "Saldos de apertura" y no "Mensual / Anual" porque todavía no
  // hay selector de período: ambos reportes se arman con los saldos cargados en
  // el Plan de Cuentas. Cambia cuando entre el motor de asientos (Paso 3).
  {
    slug: "pyl",
    title: "Estado de Resultado",
    description: "Ingresos, costos, gastos y utilidad del ejercicio.",
    icon: <TrendingUp size={22} />,
    badge: "Saldos de apertura",
  },
  {
    slug: "balance",
    title: "Balance General",
    description: "Activos, pasivos y patrimonio agrupados por subcategoría.",
    icon: <Scale size={22} />,
    badge: "Saldos de apertura",
  },
  {
    slug: "mayor",
    title: "Libro Mayor",
    description: "Movimientos y saldo corrido de cada cuenta, con su contrapartida.",
    icon: <BookOpen size={22} />,
    badge: "Por cuenta",
  },
  {
    slug: "comprobacion",
    title: "Balance de Comprobación",
    description: "Sumas y saldos por cuenta. Los mismos saldos que los estados financieros.",
    icon: <CheckSquare size={22} />,
    badge: "Verificación",
  },
  {
    slug: "diario",
    title: "Diario General",
    description: "Todos los asientos en orden cronológico, con sus líneas.",
    icon: <CalendarDays size={22} />,
    badge: "Cronológico",
  },
  {
    slug: "ventas-mensuales",
    pendiente: true,
    title: "Ventas Mensuales",
    description: "Detalle factura por factura del mes.",
    icon: <FileText size={22} />,
    badge: "Detallado",
  },
  {
    slug: "aging",
    pendiente: true,
    title: "Antigüedad de Saldos",
    description: "Antigüedad de cuentas por cobrar y por pagar, por documento.",
    icon: <Clock size={22} />,
    badge: "Cobranza",
  },
  {
    slug: "estado-cuenta",
    pendiente: true,
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
            pendiente={report.pendiente}
            href={`/finanzas/reportes/${report.slug}`}
          />
        ))}
      </div>
    </div>
  );
}
