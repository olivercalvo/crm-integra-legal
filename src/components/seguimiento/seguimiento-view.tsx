"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ListTodo,
  MessageSquare,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  FolderOpen,
  Clock,
  ChevronDown,
  ChevronRight,
  Search,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/utils/format-date";

function isOverdue(deadline: string | null, status: string) {
  if (!deadline || status === "cumplida") return false;
  const today = new Date().toISOString().split("T")[0];
  return deadline < today;
}

export interface TaskRow {
  id: string;
  description: string;
  deadline: string | null;
  status: string;
  completed_at: string | null;
  created_at: string;
  case_id: string;
  caseCode: string;
  clientName: string;
  assignedTo: string | null;
}

export interface CommentRow {
  id: string;
  text: string;
  created_at: string;
  follow_up_date: string | null;
  case_id: string;
  caseCode: string;
  clientName: string;
  userName: string;
}

type TimelineEntry =
  | { type: "task"; data: TaskRow; date: string }
  | { type: "comment"; data: CommentRow; date: string };

interface CaseGroup {
  code: string;
  client: string;
  entries: TimelineEntry[];
  pendingCount: number;
  commentCount: number;
}

interface SeguimientoViewProps {
  tasks: TaskRow[];
  comments: CommentRow[];
}

export function SeguimientoView({ tasks, comments }: SeguimientoViewProps) {
  const [search, setSearch] = useState("");
  const [expandedCases, setExpandedCases] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"all" | "pendiente" | "cumplida" | "comentarios">("all");

  const pendientes = tasks.filter((t) => t.status === "pendiente");
  const cumplidas = tasks.filter((t) => t.status === "cumplida");
  const overdueCount = pendientes.filter((t) => isOverdue(t.deadline, t.status)).length;

  // Build timeline
  const timeline: TimelineEntry[] = [
    ...tasks.map((t) => ({ type: "task" as const, data: t, date: t.created_at })),
    ...comments.map((c) => ({ type: "comment" as const, data: c, date: c.created_at })),
  ].sort((a, b) => (a.date > b.date ? -1 : 1));

  // Group by case
  const caseMap = new Map<string, CaseGroup>();
  for (const entry of timeline) {
    const caseId = entry.type === "task" ? entry.data.case_id : entry.data.case_id;
    const code = entry.type === "task" ? entry.data.caseCode : entry.data.caseCode;
    const client = entry.type === "task" ? entry.data.clientName : entry.data.clientName;
    if (!caseMap.has(caseId)) {
      caseMap.set(caseId, { code, client, entries: [], pendingCount: 0, commentCount: 0 });
    }
    const group = caseMap.get(caseId)!;
    group.entries.push(entry);
    if (entry.type === "task" && entry.data.status === "pendiente") group.pendingCount++;
    if (entry.type === "comment") group.commentCount++;
  }

  // Filter by search
  const q = search.toLowerCase();
  const filteredCases = Array.from(caseMap.entries()).filter(([, group]) => {
    if (!q) return true;
    return (
      group.code.toLowerCase().includes(q) ||
      group.client.toLowerCase().includes(q) ||
      group.entries.some((e) =>
        e.type === "task"
          ? e.data.description.toLowerCase().includes(q)
          : e.data.text.toLowerCase().includes(q)
      )
    );
  });

  // Filter entries by type
  const filterEntries = (entries: TimelineEntry[]) => {
    if (filter === "all") return entries;
    if (filter === "pendiente") return entries.filter((e) => e.type === "task" && e.data.status === "pendiente");
    if (filter === "cumplida") return entries.filter((e) => e.type === "task" && e.data.status === "cumplida");
    if (filter === "comentarios") return entries.filter((e) => e.type === "comment");
    return entries;
  };

  const toggleCase = (caseId: string) => {
    setExpandedCases((prev) => {
      const next = new Set(prev);
      if (next.has(caseId)) next.delete(caseId);
      else next.add(caseId);
      return next;
    });
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-integra-navy">Seguimiento</h1>
        <p className="text-sm text-gray-500">Tareas y comentarios de todos los casos</p>
      </div>

      {/* Summary */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
        <Card><CardContent className="flex items-center gap-3 p-4">
          <div className="rounded-lg bg-amber-50 p-2.5"><ListTodo size={20} className="text-amber-600" /></div>
          <div><p className="text-xl font-bold">{pendientes.length}</p><p className="text-xs text-gray-500">Pendientes</p></div>
        </CardContent></Card>
        {overdueCount > 0 && (
          <Card><CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-lg bg-red-50 p-2.5"><AlertTriangle size={20} className="text-red-600" /></div>
            <div><p className="text-xl font-bold text-red-600">{overdueCount}</p><p className="text-xs text-gray-500">Vencidas</p></div>
          </CardContent></Card>
        )}
        <Card><CardContent className="flex items-center gap-3 p-4">
          <div className="rounded-lg bg-green-50 p-2.5"><CheckCircle2 size={20} className="text-green-600" /></div>
          <div><p className="text-xl font-bold">{cumplidas.length}</p><p className="text-xs text-gray-500">Cumplidas</p></div>
        </CardContent></Card>
        <Card><CardContent className="flex items-center gap-3 p-4">
          <div className="rounded-lg bg-blue-50 p-2.5"><MessageSquare size={20} className="text-blue-600" /></div>
          <div><p className="text-xl font-bold">{comments.length}</p><p className="text-xs text-gray-500">Comentarios</p></div>
        </CardContent></Card>
      </div>

      {/* Search + Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por caso, cliente o texto..."
            className="h-11 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-4 text-sm placeholder:text-gray-400 focus:border-integra-gold focus:outline-none focus:ring-1 focus:ring-integra-gold"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {(["all", "pendiente", "cumplida", "comentarios"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                filter === f
                  ? "bg-integra-navy text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {f === "all" ? "Todos" : f === "pendiente" ? "Pendientes" : f === "cumplida" ? "Cumplidas" : "Comentarios"}
            </button>
          ))}
        </div>
      </div>

      {/* Cases — collapsed by default */}
      {filteredCases.length > 0 ? (
        <div className="space-y-2">
          {filteredCases.map(([caseId, group]) => {
            const isExpanded = expandedCases.has(caseId);
            const filtered = filterEntries(group.entries);
            if (filtered.length === 0 && filter !== "all") return null;

            return (
              <Card key={caseId} className="overflow-hidden">
                {/* Collapsible header */}
                <button
                  onClick={() => toggleCase(caseId)}
                  className="flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {isExpanded ? <ChevronDown size={16} className="shrink-0 text-gray-400" /> : <ChevronRight size={16} className="shrink-0 text-gray-400" />}
                    <FolderOpen size={16} className="shrink-0 text-integra-gold" />
                    <span className="font-mono font-bold text-integra-navy text-sm">{group.code}</span>
                    <span className="text-sm text-gray-500 truncate">{group.client}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {group.pendingCount > 0 && (
                      <Badge className="border-transparent bg-amber-100 text-amber-800 text-xs">
                        {group.pendingCount} pendiente{group.pendingCount !== 1 ? "s" : ""}
                      </Badge>
                    )}
                    <span className="text-xs text-gray-400">
                      {group.commentCount} comentario{group.commentCount !== 1 ? "s" : ""}
                    </span>
                  </div>
                </button>

                {/* Expanded content */}
                {isExpanded && (
                  <CardContent className="pt-0 pb-4 space-y-2 border-t">
                    <div className="pt-3 mb-2">
                      <Link
                        href={`/abogada/casos/${caseId}?tab=seguimiento`}
                        className="text-xs text-integra-navy hover:underline font-medium"
                      >
                        Abrir caso completo
                      </Link>
                    </div>
                    {filtered.map((entry) => {
                      if (entry.type === "task") {
                        const t = entry.data;
                        const overdue = isOverdue(t.deadline, t.status);
                        return (
                          <div
                            key={`t-${t.id}`}
                            className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${overdue ? "border-red-200 bg-red-50/50" : ""}`}
                          >
                            {t.status === "cumplida" ? (
                              <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-green-500" />
                            ) : overdue ? (
                              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-500" />
                            ) : (
                              <ListTodo size={16} className="mt-0.5 shrink-0 text-amber-500" />
                            )}
                            <div className="flex-1 min-w-0">
                              <p className={t.status === "cumplida" ? "text-gray-400 line-through" : "text-gray-800"}>
                                {t.description}
                              </p>
                              <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-gray-400">
                                {t.assignedTo && <span>Asignada a: {t.assignedTo}</span>}
                                {t.deadline && (
                                  <span className={overdue ? "text-red-600 font-medium" : ""}>
                                    <Calendar size={11} className="inline mr-0.5" />
                                    {overdue ? "Vencida: " : "Límite: "}{formatDate(t.deadline)}
                                  </span>
                                )}
                                <span>{formatDate(t.created_at)}</span>
                              </div>
                            </div>
                            <Badge className={`shrink-0 text-xs border-transparent ${
                              t.status === "cumplida" ? "bg-green-100 text-green-700"
                                : overdue ? "bg-red-100 text-red-700"
                                : "bg-amber-100 text-amber-700"
                            }`}>
                              {t.status === "cumplida" ? "Cumplida" : overdue ? "Vencida" : "Pendiente"}
                            </Badge>
                          </div>
                        );
                      } else {
                        const c = entry.data;
                        return (
                          <div key={`c-${c.id}`} className="flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50/30 p-3 text-sm">
                            <MessageSquare size={16} className="mt-0.5 shrink-0 text-blue-500" />
                            <div className="flex-1 min-w-0">
                              <p className="text-gray-800">{c.text}</p>
                              <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-gray-400">
                                <span className="font-medium text-integra-navy">{c.userName}</span>
                                {c.follow_up_date && (
                                  <span><Clock size={11} className="inline mr-0.5" />Seguimiento: {formatDate(c.follow_up_date)}</span>
                                )}
                                <span>{formatDate(c.created_at)}</span>
                              </div>
                            </div>
                          </div>
                        );
                      }
                    })}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-20 text-center">
          <ListTodo size={40} className="mb-3 text-gray-300" />
          <p className="font-medium text-gray-500">
            {search ? `Sin resultados para "${search}"` : "No hay seguimiento registrado"}
          </p>
        </div>
      )}
    </div>
  );
}
