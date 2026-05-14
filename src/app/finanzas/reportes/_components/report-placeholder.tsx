import Link from "next/link";
import { ArrowLeft } from "lucide-react";

interface ReportPlaceholderProps {
  title: string;
  badge: string;
  icon: React.ReactNode;
}

export function ReportPlaceholder({
  title,
  badge,
  icon,
}: ReportPlaceholderProps) {
  return (
    <div className="space-y-5">
      <Link
        href="/finanzas/reportes"
        className="inline-flex items-center gap-1.5 text-sm text-integra-navy/70 hover:text-integra-navy"
      >
        <ArrowLeft size={16} />
        Volver a Reportes
      </Link>

      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-integra-navy/5 p-2 text-integra-gold ring-1 ring-integra-gold/30">
          {icon}
        </div>
        <div>
          <h1 className="text-2xl font-bold text-integra-navy">{title}</h1>
          <p className="text-sm text-gray-500">{badge}</p>
        </div>
      </div>

      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-10 text-center">
        <p className="text-base font-medium text-integra-navy">Próximamente</p>
        <p className="mt-1 text-sm text-gray-500">
          Este reporte se implementa en las próximas fases del Sprint 2F.
        </p>
      </div>
    </div>
  );
}
