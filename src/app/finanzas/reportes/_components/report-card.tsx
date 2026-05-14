import Link from "next/link";
import { cn } from "@/lib/utils";

interface ReportCardProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  badge: string;
  href: string;
}

export function ReportCard({
  title,
  description,
  icon,
  badge,
  href,
}: ReportCardProps) {
  return (
    <Link
      href={href}
      className={cn(
        "group block rounded-xl border border-gray-200 bg-white p-5 shadow-sm",
        "transition-all duration-200",
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
            <span className="shrink-0 rounded-full bg-integra-navy/5 px-2 py-0.5 text-[11px] font-medium text-integra-navy/70 ring-1 ring-integra-navy/10">
              {badge}
            </span>
          </div>
          <p className="mt-1.5 text-sm text-gray-600 leading-snug">
            {description}
          </p>
        </div>
      </div>
    </Link>
  );
}
