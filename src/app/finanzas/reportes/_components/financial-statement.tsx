import Link from "next/link";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import type { ReportGroup, ReportSection } from "@/lib/finanzas/reports/accounting-reports";

/**
 * Piezas de presentación compartidas por el Balance General y el Estado de
 * Resultado. Replican el formato de los modelos que mandó Josuar: encabezado con
 * el nombre de la firma, secciones en mayúsculas, subtotales en negrita y montos
 * alineados a la derecha.
 *
 * Los montos se muestran TAL CUAL vienen (convención de balanza): los créditos
 * —ingresos, pasivos, patrimonio— aparecen negativos, igual que en su Excel.
 */

/** Formatea un monto en B/. con separador de miles es-PA y 2 decimales. */
export function formatAmount(n: number): string {
  return n.toLocaleString("es-PA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Celda de monto: negativos en rojo, ceros en gris tenue. */
export function Amount({ value, bold }: { value: number; bold?: boolean }) {
  const tone =
    value < 0 ? "text-red-600" : value === 0 ? "text-gray-400" : "text-gray-800";
  return (
    <span className={`font-mono text-sm tabular-nums ${tone} ${bold ? "font-bold" : ""}`}>
      {formatAmount(value)}
    </span>
  );
}

export function StatementHeader({
  title,
  subtitle,
  firmName,
  generatedAt,
}: {
  title: string;
  subtitle: string;
  firmName: string;
  generatedAt: string;
}) {
  return (
    <>
      <Link
        href="/finanzas/reportes"
        className="inline-flex items-center gap-1.5 text-sm text-integra-navy/70 hover:text-integra-navy"
      >
        <ArrowLeft size={16} />
        Volver a Reportes
      </Link>

      <div className="rounded-xl border border-integra-gold/30 bg-white px-6 py-5 text-center">
        <p className="text-base font-semibold uppercase tracking-wide text-integra-navy">
          {firmName}
        </p>
        <h1 className="mt-1 font-serif text-2xl font-bold text-integra-navy">{title}</h1>
        <p className="mt-1 text-sm text-gray-600">{subtitle}</p>
        <p className="mt-2 text-xs text-gray-400">Generado el {generatedAt}</p>
      </div>
    </>
  );
}

/** Aviso de que la fuente de datos son los saldos de apertura (Paso 2). */
export function OpeningBalancesNotice() {
  return (
    <p className="rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5 text-xs text-blue-800">
      Este reporte se arma con los <strong>saldos de apertura</strong> cargados en el Plan de
      Cuentas. Cuando entre el motor de asientos, pasará a incluir los movimientos del período.
      La <strong>fecha de corte</strong> está pendiente de confirmación del contador.
    </p>
  );
}

/** Aviso cuando hay cuentas sin subcategoría (caerían fuera del agrupamiento). */
export function UnclassifiedWarning({ sections }: { sections: ReportSection[] }) {
  const count = sections
    .flatMap((s) => s.groups)
    .filter((g) => g.isUnclassified)
    .reduce((acc, g) => acc + g.rows.length, 0);

  if (count === 0) return null;

  return (
    <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
      <span>
        Hay <strong>{count} cuenta(s) sin subcategoría</strong>. Están incluidas en los totales bajo
        &ldquo;Sin clasificar&rdquo;, pero conviene clasificarlas en el Plan de Cuentas para que el
        reporte quede agrupado como corresponde.
      </span>
    </p>
  );
}

/** Encabezado de sección (SECCIÓN EN MAYÚSCULAS sobre fondo navy tenue). */
export function SectionHeaderRow({ label }: { label: string }) {
  return (
    <tr className="bg-integra-navy/5">
      <td
        colSpan={3}
        className="px-4 py-2.5 text-sm font-bold uppercase tracking-wide text-integra-navy"
      >
        {label}
      </td>
    </tr>
  );
}

/** Renglón de total de sección (negrita, con reglas arriba y abajo). */
export function SectionTotalRow({ label, value }: { label: string; value: number }) {
  return (
    <tr className="border-y-2 border-integra-navy/20 bg-white">
      <td />
      <td className="py-2.5 pr-4 text-sm font-bold text-integra-navy">{label}</td>
      <td className="py-2.5 pr-4 text-right">
        <Amount value={value} bold />
      </td>
    </tr>
  );
}

/** Fila de cuenta: código, nombre y monto. */
export function AccountRow({ code, name, amount }: { code: string; name: string; amount: number }) {
  return (
    <tr className="border-b border-gray-100 last:border-0">
      <td className="w-24 py-1.5 pl-6 pr-2 font-mono text-xs text-gray-500">{code}</td>
      <td className="py-1.5 pr-4 text-sm text-gray-700">{name}</td>
      <td className="w-40 py-1.5 pr-4 text-right">
        <Amount value={amount} />
      </td>
    </tr>
  );
}

function GroupBlock({ group }: { group: ReportGroup }) {
  return (
    <>
      {group.label && (
        <tr className={group.isUnclassified ? "bg-amber-50/60" : "bg-gray-50/60"}>
          <td colSpan={3} className="px-4 py-2 text-sm font-semibold text-integra-navy">
            {group.label}
          </td>
        </tr>
      )}
      {group.rows.map((r) => (
        <AccountRow key={r.code} code={r.code} name={r.name} amount={r.amount} />
      ))}
      {group.subtotalLabel && (
        <tr className="border-b border-gray-200">
          <td />
          <td className="py-2 pr-4 text-sm font-semibold text-integra-navy">
            {group.subtotalLabel}
          </td>
          <td className="py-2 pr-4 text-right">
            <Amount value={group.subtotal} bold />
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * Sección completa: encabezado, grupos y total.
 *
 * `emptyLabel` deja cambiar el texto de "no hay filas": no es lo mismo que la
 * sección no tenga cuentas a que el filtro "solo con saldo" las haya ocultado.
 */
export function StatementSection({
  section,
  emptyLabel = "Sin cuentas registradas",
}: {
  section: ReportSection;
  emptyLabel?: string;
}) {
  return (
    <>
      <SectionHeaderRow label={section.label} />
      {section.groups.length === 0 ? (
        <tr>
          <td colSpan={3} className="px-6 py-3 text-sm italic text-gray-400">
            {emptyLabel}
          </td>
        </tr>
      ) : (
        section.groups.map((g, i) => <GroupBlock key={g.label ?? `flat-${i}`} group={g} />)
      )}
      <SectionTotalRow label={section.totalLabel} value={section.total} />
    </>
  );
}

/** Renglones de cuenta de una sección, sin encabezado ni total (los pone el caller). */
export function SectionAccountRows({ section }: { section: ReportSection }) {
  return (
    <>
      {section.groups.flatMap((g) =>
        g.rows.map((r) => (
          <AccountRow key={r.code} code={r.code} name={r.name} amount={r.amount} />
        ))
      )}
    </>
  );
}

/**
 * Renglón calculado (no viene de una cuenta): subtotales del Estado de
 * Resultado, ISR, Utilidad del Ejercicio. `emphasis` lo resalta como resultado
 * principal.
 */
export function ComputedRow({
  label,
  value,
  emphasis,
  note,
}: {
  label: string;
  value: number;
  emphasis?: boolean;
  note?: string;
}) {
  return (
    <tr
      className={
        emphasis
          ? "border-y-2 border-integra-gold/50 bg-integra-gold/10"
          : "border-b border-gray-200 bg-gray-50/40"
      }
    >
      <td />
      <td className={`py-2.5 pr-4 text-sm ${emphasis ? "font-bold" : "font-semibold"} text-integra-navy`}>
        {label}
        {note && <span className="ml-2 text-xs font-normal text-gray-500">{note}</span>}
      </td>
      <td className="py-2.5 pr-4 text-right">
        <Amount value={value} bold />
      </td>
    </tr>
  );
}

/** Contenedor de la tabla del estado financiero. */
export function StatementTable({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-white">
      <table className="w-full min-w-[560px]">
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/**
 * Nota al pie sobre la convención de signos. Va en los dos reportes porque es lo
 * primero que sorprende a quien no viene de leer una balanza de comprobación.
 */
export function SignConventionNote() {
  return (
    <p className="text-xs text-gray-500">
      <strong>Convención de signos:</strong> los saldos se presentan como en la balanza de
      comprobación — débitos (activos, costos, gastos) en positivo y créditos (pasivos, patrimonio,
      ingresos) en negativo. Por eso una <strong>ganancia aparece en negativo</strong> y el Total
      Pasivo + Patrimonio es igual y opuesto al Total de Activo.
    </p>
  );
}
