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


/**
 * El título de la pestaña. Sin esto el navegador muestra "CRM Integra Legal" en
 * todas, y con seis pestañas abiertas no se distingue cuál es cuál.
 */
export const metadata = {
  title: "Reportes Contables · Finanzas",
};
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
    title: "Resumen de ITBMS",
    description: "Resumen mensual de ITBMS para presentar a DGI.",
    icon: <Receipt size={22} />,
    badge: "Mensual",
  },
  // ⚠️ ESTE BADGE YA MINTIÓ DOS VECES. Historia corta, porque es una trampa que
  // se repite:
  //
  //   · Decía "Saldos de apertura". Dejó de ser cierto el 02/09 a la mañana con
  //     la convergencia: los dos reportes pasaron a sumar apertura MÁS los
  //     movimientos del ledger.
  //   · Se cambió a "Sin corte por período"… y esa misma tarde entró el corte por
  //     fecha (commit 801692b). Volvió a mentir en menos de un día.
  //
  // 🔑 La lección: **un badge que describe lo que al reporte le FALTA se vuelve
  // falso en cuanto alguien lo construye, y nadie se acuerda de venir a
  // cambiarlo.** Los dos de acá ahora dicen QUÉ ES el reporte —una foto a una
  // fecha, un resultado de un período— que es una propiedad de su naturaleza
  // contable y no del estado del código. Eso no caduca.
  {
    slug: "pyl",
    title: "Estado de Resultado",
    description: "Ingresos, costos, gastos y utilidad del período.",
    icon: <TrendingUp size={22} />,
    // El ER es DE UN PERÍODO, con `desde` y `hasta`. Ver sop.md SOP-021.
    badge: "Por período",
  },
  {
    slug: "balance",
    title: "Balance General",
    description: "Activos, pasivos y patrimonio a una fecha de corte.",
    icon: <Scale size={22} />,
    // El Balance es A UNA FECHA: no existe "el activo entre marzo y junio".
    badge: "A una fecha",
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
    // También de período, con saldo inicial al comienzo del rango (SOP-021).
    badge: "Por período",
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
    title: "Antigüedad de Saldos",
    description: "Por cobrar y por pagar, en tramos y detallada por documento.",
    icon: <Clock size={22} />,
    badge: "Cobranza",
  },
  {
    slug: "estado-cuenta",
    title: "Estado de Cuenta",
    description: "Movimientos y saldo corrido, por cliente o por proveedor.",
    icon: <User size={22} />,
    badge: "Por cliente",
  },
];

export default async function ReportesHubPage() {
  const { userRole, userName } = await getAuthenticatedContext();

  const intro =
    userRole === "contador"
      ? `Hola ${userName}, aquí puede descargar los reportes para el cierre mensual.`
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
