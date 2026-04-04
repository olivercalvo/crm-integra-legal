"use client";

import { useState } from "react";
import Link from "next/link";
import { ListTodo, Calendar, AlertTriangle, CheckCircle2, MessageSquare, Paperclip, FolderOpen, ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { MarkTaskButton } from "@/components/asistente/mark-task-button";
import { formatDate } from "@/lib/utils/format-date";

interface ParsedTask {
  id: string;
  description: string;
  deadline: string | null;
  status: "pendiente" | "cumplida";
  completed_at: string | null;
  caseId: string;
  caseCode: string;
  clientName: string;
}

interface CaseTaskGroupProps {
  caseId: string;
  caseCode: string;
  clientName: string;
  pendientes: ParsedTask[];
  cumplidas: ParsedTask[];
  defaultOpen?: boolean;
}

function isOverdue(deadline: string | null, status: "pendiente" | "cumplida") {
  if (!deadline || status === "cumplida") return false;
  const today = new Date().toISOString().split("T")[0];
  return deadline < today;
}

export function CaseTaskGroup({ caseId, caseCode, clientName, pendientes, cumplidas, defaultOpen = false }: CaseTaskGroupProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="space-y-2">
      {/* Case header — clickable to toggle */}
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 rounded-lg bg-integra-navy/5 px-4 py-3 text-left hover:bg-integra-navy/10 transition-colors"
      >
        {open ? (
          <ChevronDown size={16} className="shrink-0 text-integra-navy" />
        ) : (
          <ChevronRight size={16} className="shrink-0 text-integra-navy" />
        )}
        <FolderOpen size={16} className="shrink-0 text-integra-navy" />
        <span className="font-mono text-sm font-bold text-integra-navy">
          {caseCode}
        </span>
        <span className="text-sm text-gray-600 truncate">— {clientName}</span>
        {pendientes.length > 0 && (
          <Badge className="ml-auto border-transparent bg-amber-100 text-amber-700 text-xs shrink-0">
            {pendientes.length} pendiente{pendientes.length !== 1 ? "s" : ""}
          </Badge>
        )}
        {pendientes.length === 0 && cumplidas.length > 0 && (
          <Badge className="ml-auto border-transparent bg-green-100 text-green-700 text-xs shrink-0">
            {cumplidas.length} cumplida{cumplidas.length !== 1 ? "s" : ""}
          </Badge>
        )}
      </button>

      {/* Collapsible content */}
      {open && (
        <>
          {/* Pending tasks */}
          {pendientes.map((task) => {
            const overdue = isOverdue(task.deadline, task.status);
            return (
              <Card
                key={task.id}
                className={`border ${overdue ? "border-red-300 bg-red-50/40" : "border-gray-100"}`}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 shrink-0">
                      {overdue ? (
                        <AlertTriangle size={18} className="text-red-500" />
                      ) : (
                        <ListTodo size={18} className="text-amber-500" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 leading-snug">
                        {task.description}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
                        {task.deadline && (
                          <span
                            className={`flex items-center gap-1 ${overdue ? "font-medium text-red-600" : ""}`}
                          >
                            <Calendar size={11} />
                            {overdue ? "Vencida: " : "Límite: "}
                            {formatDate(task.deadline)}
                          </span>
                        )}
                      </div>
                      {/* Action buttons */}
                      <div className="mt-2 flex flex-wrap gap-2">
                        <MarkTaskButton taskId={task.id} />
                        <Link
                          href={`/asistente/casos/${task.caseId}?tab=comentarios`}
                          className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-3 min-h-[48px] text-xs font-medium text-gray-600 hover:bg-gray-50 active:bg-gray-100 transition-colors"
                        >
                          <MessageSquare size={14} />
                          Comentar
                        </Link>
                        <Link
                          href={`/asistente/casos/${task.caseId}?tab=documentos`}
                          className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-3 min-h-[48px] text-xs font-medium text-gray-600 hover:bg-gray-50 active:bg-gray-100 transition-colors"
                        >
                          <Paperclip size={14} />
                          Adjuntar
                        </Link>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}

          {/* Completed tasks */}
          {cumplidas.map((task) => (
            <Card key={task.id} className="border border-gray-100 opacity-70">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-green-500" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-500 line-through leading-snug">
                      {task.description}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-400">
                      {task.completed_at && (
                        <span className="flex items-center gap-1 text-green-600">
                          <Calendar size={11} />
                          Cumplida: {formatDate(task.completed_at)}
                        </span>
                      )}
                    </div>
                  </div>
                  <Badge className="shrink-0 border-transparent bg-green-100 text-green-700 text-xs">
                    Cumplida
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </>
      )}
    </section>
  );
}
