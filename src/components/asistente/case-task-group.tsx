"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ListTodo, Calendar, AlertTriangle, CheckCircle2, MessageSquare, FolderOpen, ChevronDown, ChevronRight, Send, Loader2, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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

function InlineCommentField({ caseId }: { caseId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [show, setShow] = useState(false);

  if (!show) {
    return (
      <button
        onClick={() => setShow(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-3 min-h-[44px] text-xs font-medium text-gray-600 hover:bg-gray-50 active:bg-gray-100 transition-colors"
      >
        <MessageSquare size={14} />
        Comentar
      </button>
    );
  }

  async function handleSubmit() {
    if (!text.trim()) return;
    setLoading(true);
    try {
      await fetch(`/api/cases/${caseId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim() }),
      });
      setText("");
      setShow(false);
      router.refresh();
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-2 flex gap-2">
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Escribe un comentario..."
        className="flex-1 rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-integra-navy/30"
        autoFocus
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
      />
      <Button
        size="sm"
        onClick={handleSubmit}
        disabled={loading || !text.trim()}
        className="min-h-[40px] bg-integra-navy hover:bg-integra-navy/90"
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => { setShow(false); setText(""); }}
        className="min-h-[40px] text-gray-400"
      >
        &times;
      </Button>
    </div>
  );
}

function MarkCompleteModal({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const router = useRouter();
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleComplete() {
    setLoading(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "cumplida", comment: comment.trim() || undefined }),
      });
      if (res.ok) {
        onClose();
        router.refresh();
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-integra-navy flex items-center gap-2">
          <CheckCircle2 size={20} className="text-green-600" />
          Marcar Cumplida
        </h3>
        <p className="mt-1 text-sm text-gray-500">
          Fecha: {formatDate(new Date().toISOString().split("T")[0])}
        </p>
        <div className="mt-4">
          <label className="text-sm font-medium text-gray-700">Comentario (opcional)</label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Agregar nota sobre la tarea completada..."
            rows={3}
            className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-integra-navy/30 resize-none"
          />
        </div>
        <div className="mt-4 flex gap-2 justify-end">
          <Button variant="ghost" onClick={onClose} disabled={loading} className="min-h-[44px]">
            Cancelar
          </Button>
          <Button
            onClick={handleComplete}
            disabled={loading}
            className="min-h-[44px] bg-green-600 hover:bg-green-700 text-white"
          >
            {loading ? <Loader2 size={14} className="animate-spin mr-1" /> : <CheckCircle2 size={14} className="mr-1" />}
            Confirmar
          </Button>
        </div>
      </div>
    </div>
  );
}

export function CaseTaskGroup({ caseId, caseCode, clientName, pendientes, cumplidas, defaultOpen = false }: CaseTaskGroupProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);

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
                      {/* Action buttons — only comment and mark complete */}
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          onClick={() => setCompletingTaskId(task.id)}
                          className="inline-flex items-center gap-1.5 rounded-md border border-green-300 px-3 min-h-[44px] text-xs font-medium text-green-700 hover:bg-green-50 active:bg-green-100 transition-colors"
                        >
                          <CheckCircle2 size={14} />
                          Marcar Cumplida
                        </button>
                        <InlineCommentField caseId={task.caseId} />
                        <a
                          href={`/asistente/casos/${task.caseId}`}
                          className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-3 min-h-[44px] text-xs font-medium text-gray-600 hover:bg-gray-50 active:bg-gray-100 transition-colors"
                        >
                          <Info size={14} />
                          Info del Caso
                        </a>
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

          {/* Complete task modal */}
          {completingTaskId && (
            <MarkCompleteModal
              taskId={completingTaskId}
              onClose={() => setCompletingTaskId(null)}
            />
          )}
        </>
      )}
    </section>
  );
}
