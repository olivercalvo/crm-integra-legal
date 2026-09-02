import Link from "next/link";
import { cn } from "@/lib/utils";

interface ReportCardProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  badge: string;
  href: string;
  /**
   * true = la pantalla existe pero todavía no tiene el reporte construido.
   *
   * La tarjeta sigue siendo navegable a propósito: sirve para que se vea qué
   * está planificado. Lo que cambia es que lo dice ANTES del clic, en vez de
   * después.
   */
  pendiente?: boolean;
}

export function ReportCard({
  title,
  description,
  icon,
  badge,
  href,
  pendiente = false,
}: ReportCardProps) {
  return (
    <Link
      href={href}
      className={cn(
        "group block rounded-xl border p-5 shadow-sm",
        "transition-all duration-200",
        pendiente
          ? "border-dashed border-gray-300 bg-gray-50/60"
          : "border-gray-200 bg-white",
        "hover:border-integra-gold hover:shadow-md",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-integra-gold focus-visible:ring-offset-2"
      )}
    >
      <div className="flex items-start gap-4">
        <div className="rounded-lg bg-integra-navy/5 p-2.5 text-integra-gold ring-1 ring-integra-gold/30 group-hover:bg-integra-navy/10">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h2 className="text-base font-semibold text-integra-navy leading-tight">
              {title}
            </h2>
            <span
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1",
                pendiente
                  ? "bg-amber-50 text-amber-800 ring-amber-200"
                  : "bg-integra-navy/5 text-integra-navy/70 ring-integra-navy/10"
              )}
            >
              {pendiente ? "Planificado" : badge}
            </span>
          </div>
          <p className="mt-1.5 text-sm text-gray-600 leading-snug">
            {description}
          </p>
          {pendiente && (
            <p className="mt-1 text-xs text-amber-700">
              Planificado — todavía no hay datos que revisar.
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}
