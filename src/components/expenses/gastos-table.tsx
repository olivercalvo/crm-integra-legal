"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Search, ArrowUp, ArrowDown, ArrowUpDown, X } from "lucide-react";

interface GastosRow {
  id: string;
  caseCode: string;
  description: string | null;
  clientName: string;
  statusName: string;
  totalPayments: number;
  totalExpenses: number;
  balance: number;
}

interface GastosTableProps {
  rows: GastosRow[];
  statuses: string[];
}

function formatCurrency(amount: number): string {
  return `B/. ${amount.toLocaleString("es-PA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

type SortKey = "caseCode" | "clientName" | "statusName" | "totalPayments" | "totalExpenses" | "balance";

function SortIcon({ column, activeCol, dir }: { column: string; activeCol: string; dir: "asc" | "desc" }) {
  if (column !== activeCol) return <ArrowUpDown size={14} className="text-gray-300 group-hover:text-gray-500" />;
  return dir === "asc" ? <ArrowUp size={14} className="text-integra-navy" /> : <ArrowDown size={14} className="text-integra-navy" />;
}

export function GastosTable({ rows, statuses }: GastosTableProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sortCol, setSortCol] = useState<SortKey>("caseCode");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const handleSort = (col: SortKey) => {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  };

  const filtered = useMemo(() => {
    let result = rows;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (r) =>
          r.caseCode.toLowerCase().includes(q) ||
          r.clientName.toLowerCase().includes(q) ||
          (r.description?.toLowerCase().includes(q) ?? false)
      );
    }
    if (statusFilter) {
      result = result.filter((r) => r.statusName === statusFilter);
    }
    return [...result].sort((a, b) => {
      const aVal = a[sortCol];
      const bVal = b[sortCol];
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      }
      const aStr = String(aVal ?? "").toLowerCase();
      const bStr = String(bVal ?? "").toLowerCase();
      return sortDir === "asc" ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
    });
  }, [rows, search, statusFilter, sortCol, sortDir]);

  const grandPayments = filtered.reduce((s, r) => s + r.totalPayments, 0);
  const grandExpenses = filtered.reduce((s, r) => s + r.totalExpenses, 0);
  const grandBalance = grandPayments - grandExpenses;

  const hasFilters = search || statusFilter;

  return (
    <div className="space-y-4">
      {/* Search + filter bar */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por caso, cliente o descripción..."
            className="h-11 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-4 text-sm placeholder:text-gray-400 focus:border-integra-gold focus:outline-none focus:ring-1 focus:ring-integra-gold"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-11 rounded-lg border border-gray-200 bg-white px-3 text-sm focus:border-integra-gold focus:outline-none focus:ring-1 focus:ring-integra-gold"
        >
          <option value="">Todos los estados</option>
          {statuses.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setSearch(""); setStatusFilter(""); }}
            className="h-11 text-gray-500 hover:text-gray-700"
          >
            <X size={14} className="mr-1" /> Limpiar
          </Button>
        )}
      </div>

      <p className="text-xs text-gray-400">{filtered.length} de {rows.length} casos</p>

      {/* Mobile cards */}
      <div className="flex flex-col gap-3 sm:hidden">
        {filtered.map((row) => (
          <div
            key={row.id}
            onClick={() => router.push(`/abogada/casos/${row.id}?tab=gastos`)}
            className="cursor-pointer"
          >
            <Card className="overflow-hidden hover:shadow-md transition-shadow">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm font-bold text-integra-navy">{row.caseCode}</span>
                  <Badge variant="outline" className={`text-xs ${row.balance < 0 ? "border-red-200 bg-red-50 text-red-700" : "border-green-200 bg-green-50 text-green-700"}`}>
                    {formatCurrency(row.balance)}
                  </Badge>
                </div>
                <p className="text-sm text-gray-600">{row.clientName}</p>
                <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
                  <span>Pagado: <strong className="text-green-700">{formatCurrency(row.totalPayments)}</strong></span>
                  <span>Gastos: <strong className="text-amber-700">{formatCurrency(row.totalExpenses)}</strong></span>
                </div>
              </CardContent>
            </Card>
          </div>
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-hidden rounded-xl border bg-white sm:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3">
                  <button onClick={() => handleSort("caseCode")} className="flex items-center gap-1 hover:text-integra-navy transition-colors group">
                    Caso <SortIcon column="caseCode" activeCol={sortCol} dir={sortDir} />
                  </button>
                </th>
                <th className="px-4 py-3">
                  <button onClick={() => handleSort("clientName")} className="flex items-center gap-1 hover:text-integra-navy transition-colors group">
                    Cliente <SortIcon column="clientName" activeCol={sortCol} dir={sortDir} />
                  </button>
                </th>
                <th className="px-4 py-3">
                  <button onClick={() => handleSort("statusName")} className="flex items-center gap-1 hover:text-integra-navy transition-colors group">
                    Estado <SortIcon column="statusName" activeCol={sortCol} dir={sortDir} />
                  </button>
                </th>
                <th className="px-4 py-3 text-right">
                  <button onClick={() => handleSort("totalPayments")} className="ml-auto flex items-center gap-1 hover:text-integra-navy transition-colors group">
                    Pagado por Cliente <SortIcon column="totalPayments" activeCol={sortCol} dir={sortDir} />
                  </button>
                </th>
                <th className="px-4 py-3 text-right">
                  <button onClick={() => handleSort("totalExpenses")} className="ml-auto flex items-center gap-1 hover:text-integra-navy transition-colors group">
                    Gastos Ejecutados <SortIcon column="totalExpenses" activeCol={sortCol} dir={sortDir} />
                  </button>
                </th>
                <th className="px-4 py-3 text-right">
                  <button onClick={() => handleSort("balance")} className="ml-auto flex items-center gap-1 hover:text-integra-navy transition-colors group">
                    Balance <SortIcon column="balance" activeCol={sortCol} dir={sortDir} />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => router.push(`/abogada/casos/${row.id}?tab=gastos`)}
                  className="cursor-pointer transition-colors hover:bg-gray-100"
                >
                  <td className="px-4 py-3">
                    <span className="font-mono font-bold text-integra-navy">{row.caseCode}</span>
                    {row.description && (
                      <p className="text-xs text-gray-400 truncate max-w-[200px]">{row.description}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-700">{row.clientName}</td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className="text-xs">{row.statusName}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-green-700">
                    {formatCurrency(row.totalPayments)}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-amber-700">
                    {formatCurrency(row.totalExpenses)}
                  </td>
                  <td className={`px-4 py-3 text-right font-bold ${row.balance < 0 ? "text-red-600" : "text-green-700"}`}>
                    {formatCurrency(row.balance)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 bg-gray-50 font-bold">
                <td className="px-4 py-3" colSpan={3}>TOTAL{hasFilters ? ` (${filtered.length} filtrados)` : ""}</td>
                <td className="px-4 py-3 text-right text-green-700">{formatCurrency(grandPayments)}</td>
                <td className="px-4 py-3 text-right text-amber-700">{formatCurrency(grandExpenses)}</td>
                <td className={`px-4 py-3 text-right ${grandBalance < 0 ? "text-red-600" : "text-green-700"}`}>
                  {formatCurrency(grandBalance)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
