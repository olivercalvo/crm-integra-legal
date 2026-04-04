"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TaskForm } from "./task-form";
import { DocumentUpload } from "@/components/documents/document-upload";
import { CheckCircle2, Clock, Calendar, User, Plus, X, Loader2, Paperclip } from "lucide-react";
import { formatDate } from "@/lib/utils/format-date";
import type { Task, User as UserType } from "@/types/database";

interface TaskWithAssignee extends Task {
  assignee?: Pick<UserType, "id" | "full_name"> | null;
}

interface TaskListProps {
  caseId: string;
  tasks: TaskWithAssignee[];
}

function isOverdue(deadline: string | null, status: Task["status"]) {
  if (!deadline || status === "cumplida") return false;
  return new Date(deadline) < new Date(new Date().toISOString().split("T")[0]);
}

export function TaskList({ caseId, tasks }: TaskListProps) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [completing, setCompleting] = useState<string | null>(null);
  const [attachingTo, setAttachingTo] = useState<string | null>(null);

  async function markComplete(taskId: string) {
    setCompleting(taskId);
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "cumplida" }),
      });

      if (res.ok) {
        router.refresh();
      }
    } catch {
      // silent failure — user can retry
    } finally {
      setCompleting(null);
    }
  }

  const pendientes = tasks.filter((t) => t.status === "pendiente");
  const cumplidas = tasks.filter((t) => t.status === "cumplida");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {pendientes.length} pendiente{pendientes.length !== 1 ? "s" : ""} · {cumplidas.length} cumplida{cumplidas.length !== 1 ? "s" : ""}
        </p>
        <Button
          type="button"
          size="sm"
          onClick={() => setShowForm(!showForm)}
          className="h-9 bg-integra-navy text-white hover:bg-integra-navy/90"
        >
          {showForm ? (
            <span className="flex items-center gap-1"><X size={14} /> Cancelar</span>
          ) : (
            <span className="flex items-center gap-1"><Plus size={14} /> Nueva Tarea</span>
          )}
        </Button>
      </div>

      {/* New Task Form */}
      {showForm && (
        <div className="rounded-lg border border-dashed border-integra-navy/30 bg-blue-50/30 p-4">
          <TaskForm caseId={caseId} onSuccess={() => setShowForm(false)} />
        </div>
      )}

      {/* Pending Tasks */}
      {pendientes.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Pendientes</h3>
          {pendientes.map((task) => {
            const overdue = isOverdue(task.deadline, task.status);
            return (
              <Card key={task.id} className={`border ${overdue ? "border-red-200 bg-red-50/30" : "border-gray-100"}`}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <Clock size={18} className={`mt-0.5 flex-shrink-0 ${overdue ? "text-red-500" : "text-amber-500"}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900">{task.description}</p>
                      <div className="mt-1.5 flex flex-wrap gap-2 text-xs text-gray-500">
                        {task.assignee && (
                          <span className="flex items-center gap-1">
                            <User size={12} />
                            {task.assignee.full_name}
                          </span>
                        )}
                        {task.deadline && (
                          <span className={`flex items-center gap-1 ${overdue ? "text-red-600 font-medium" : ""}`}>
                            <Calendar size={12} />
                            {overdue ? "Vencida: " : "Límite: "}{formatDate(task.deadline)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-shrink-0 gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => markComplete(task.id)}
                        disabled={completing === task.id}
                        className="h-9 border-green-300 text-green-700 hover:bg-green-50 text-xs"
                      >
                        {completing === task.id ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <span className="flex items-center gap-1">
                            <CheckCircle2 size={14} />
                            Cumplida
                          </span>
                        )}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setAttachingTo(attachingTo === task.id ? null : task.id)}
                        className="h-9 text-xs text-gray-600 hover:bg-gray-50"
                      >
                        <Paperclip size={14} />
                      </Button>
                    </div>
                  </div>
                  {attachingTo === task.id && (
                    <div className="mt-3 border-t pt-3">
                      <DocumentUpload entityType="task" entityId={task.id} />
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Completed Tasks */}
      {cumplidas.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Cumplidas</h3>
          {cumplidas.map((task) => (
            <Card key={task.id} className="border border-gray-100 opacity-70">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <CheckCircle2 size={18} className="mt-0.5 flex-shrink-0 text-green-500" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-500 line-through">{task.description}</p>
                    <div className="mt-1.5 flex flex-wrap gap-2 text-xs text-gray-400">
                      {task.assignee && (
                        <span className="flex items-center gap-1">
                          <User size={12} />
                          {task.assignee.full_name}
                        </span>
                      )}
                      {task.completed_at && (
                        <span className="flex items-center gap-1">
                          <Calendar size={12} />
                          Completada: {formatDate(task.completed_at)}
                        </span>
                      )}
                    </div>
                  </div>
                  <Badge className="flex-shrink-0 bg-green-100 text-green-700 hover:bg-green-100 text-xs">
                    Cumplida
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Empty state */}
      {tasks.length === 0 && !showForm && (
        <div className="rounded-lg border border-dashed border-gray-200 py-10 text-center">
          <Clock size={32} className="mx-auto mb-2 text-gray-300" />
          <p className="text-sm text-gray-400">No hay tareas para este caso.</p>
          <Button
            type="button"
            size="sm"
            onClick={() => setShowForm(true)}
            className="mt-3 h-9 bg-integra-navy text-white hover:bg-integra-navy/90"
          >
            <span className="flex items-center gap-1"><Plus size={14} /> Crear Primera Tarea</span>
          </Button>
        </div>
      )}
    </div>
  );
}
