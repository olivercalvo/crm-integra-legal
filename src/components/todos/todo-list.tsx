"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { directUpload } from "@/lib/storage/direct-upload";
import {
  Plus,
  CheckCircle2,
  Circle,
  Calendar,
  AlertTriangle,
  Trash2,
  MessageSquare,
  ChevronDown,
  ChevronRight,
  Loader2,
  Paperclip,
  UserPlus,
  FileText,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils/format-date";
import { matchesSearchQuery } from "@/lib/utils/search";

interface Todo {
  id: string;
  description: string;
  deadline: string | null;
  status: "pendiente" | "cumplida";
  completed_at: string | null;
  created_at: string;
  user_id: string;
  assigned_to: string | null;
  creator_name: string | null;
  assignee_name: string | null;
}

interface TeamMember {
  id: string;
  name: string;
  role: string;
}

interface TodoDoc {
  id: string;
  file_name: string;
  file_path: string;
  created_at: string;
}

interface TodoListProps {
  initialTodos: Todo[];
  teamMembers: TeamMember[];
  currentUserId: string;
}

function isOverdue(deadline: string | null, status: string) {
  if (!deadline || status === "cumplida") return false;
  return deadline < new Date().toISOString().split("T")[0];
}

export function TodoList({ initialTodos, teamMembers, currentUserId }: TodoListProps) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [description, setDescription] = useState("");
  const [deadline, setDeadline] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [expandedTodo, setExpandedTodo] = useState<string | null>(null);
  const [commentText, setCommentText] = useState("");
  const [comments, setComments] = useState<Record<string, Array<{ id: string; text: string; created_at: string }>>>({});
  const [commentLoading, setCommentLoading] = useState(false);
  const [documents, setDocuments] = useState<Record<string, TodoDoc[]>>({});
  const [docLoading, setDocLoading] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadTodoId, setUploadTodoId] = useState<string | null>(null);

  // Filter & sort state
  const [searchTodo, setSearchTodo] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "pendiente" | "cumplida">("all");
  const [sortTodo, setSortTodo] = useState<"recent" | "deadline" | "alpha">("recent");

  const filteredTodos = initialTodos
    .filter((t) => {
      if (statusFilter === "pendiente" && t.status !== "pendiente") return false;
      if (statusFilter === "cumplida" && t.status !== "cumplida") return false;
      if (searchTodo.trim()) {
        return matchesSearchQuery(
          searchTodo,
          t.description,
          t.assignee_name,
          t.creator_name,
          t.status,
          t.deadline
        );
      }
      return true;
    })
    .sort((a, b) => {
      if (sortTodo === "deadline") {
        const aD = a.deadline ?? "9999";
        const bD = b.deadline ?? "9999";
        return aD.localeCompare(bD);
      }
      if (sortTodo === "alpha") return a.description.localeCompare(b.description);
      return b.created_at.localeCompare(a.created_at); // recent
    });

  const pendientes = filteredTodos.filter((t) => t.status === "pendiente");
  const cumplidas = filteredTodos.filter((t) => t.status === "cumplida");

  const overdueCount = pendientes.filter((t) => isOverdue(t.deadline, t.status)).length;
  const hasFilters = searchTodo || statusFilter !== "all";

  async function handleCreate() {
    if (!description.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: description.trim(),
          deadline: deadline || null,
          assigned_to: assignedTo || null,
        }),
      });
      if (res.ok) {
        setDescription("");
        setDeadline("");
        setAssignedTo("");
        setShowForm(false);
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleStatus(todo: Todo) {
    setActionLoading(todo.id);
    try {
      const newStatus = todo.status === "pendiente" ? "cumplida" : "pendiente";
      await fetch(`/api/todos/${todo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      router.refresh();
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDelete(id: string) {
    setActionLoading(id);
    try {
      await fetch(`/api/todos/${id}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setActionLoading(null);
    }
  }

  async function handleToggleComments(todoId: string) {
    if (expandedTodo === todoId) {
      setExpandedTodo(null);
      return;
    }
    setExpandedTodo(todoId);
    if (!comments[todoId]) {
      const res = await fetch(`/api/todos/${todoId}/comments`);
      if (res.ok) {
        const data = await res.json();
        setComments((prev) => ({ ...prev, [todoId]: data }));
      }
    }
    if (!documents[todoId]) {
      const res = await fetch(`/api/todos/${todoId}/documents`);
      if (res.ok) {
        const data = await res.json();
        setDocuments((prev) => ({ ...prev, [todoId]: data }));
      }
    }
  }

  async function handleAddComment(todoId: string) {
    if (!commentText.trim()) return;
    setCommentLoading(true);
    try {
      const res = await fetch(`/api/todos/${todoId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: commentText.trim() }),
      });
      if (res.ok) {
        const newComment = await res.json();
        setComments((prev) => ({
          ...prev,
          [todoId]: [newComment, ...(prev[todoId] || [])],
        }));
        setCommentText("");
      }
    } finally {
      setCommentLoading(false);
    }
  }

  async function handleFileUpload(todoId: string, files: FileList) {
    setDocLoading(todoId);
    try {
      const uploaded: TodoDoc[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const { storagePath, fileName } = await directUpload({
          file,
          pathPrefix: `todos/${todoId}`,
        });
        const res = await fetch(`/api/todos/${todoId}/documents/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file_name: fileName, storage_path: storagePath }),
        });
        if (res.ok) {
          uploaded.push(await res.json());
        }
      }
      if (uploaded.length > 0) {
        setDocuments((prev) => ({
          ...prev,
          [todoId]: [...uploaded, ...(prev[todoId] || [])],
        }));
      }
    } finally {
      setDocLoading(null);
      setUploadTodoId(null);
    }
  }

  function renderTodo(todo: Todo) {
    const overdue = isOverdue(todo.deadline, todo.status);
    const isCompleted = todo.status === "cumplida";
    const isExpanded = expandedTodo === todo.id;
    const loading = actionLoading === todo.id;
    const isAssignedToMe = todo.assigned_to === currentUserId && todo.user_id !== currentUserId;
    const isOwner = todo.user_id === currentUserId;

    return (
      <Card
        key={todo.id}
        className={`border ${
          overdue ? "border-red-300 bg-red-50/40" : isCompleted ? "border-gray-100 opacity-70" : isAssignedToMe ? "border-blue-200 bg-blue-50/30" : "border-gray-100"
        }`}
      >
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            {/* Toggle status */}
            <button
              onClick={() => handleToggleStatus(todo)}
              disabled={loading}
              className="mt-0.5 shrink-0"
            >
              {loading ? (
                <Loader2 size={20} className="animate-spin text-gray-400" />
              ) : isCompleted ? (
                <CheckCircle2 size={20} className="text-green-500" />
              ) : overdue ? (
                <AlertTriangle size={20} className="text-red-500" />
              ) : (
                <Circle size={20} className="text-gray-300 hover:text-integra-gold" />
              )}
            </button>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium leading-snug ${isCompleted ? "text-gray-500 line-through" : "text-gray-900"}`}>
                {todo.description}
              </p>

              {/* Assignment badges */}
              <div className="mt-1 flex flex-wrap gap-1.5">
                {isAssignedToMe && todo.creator_name && (
                  <Badge variant="outline" className="text-[10px] text-blue-600 border-blue-200">
                    <UserPlus size={10} className="mr-0.5" />
                    Asignado por {todo.creator_name}
                  </Badge>
                )}
                {isOwner && todo.assigned_to && todo.assignee_name && (
                  <Badge variant="outline" className="text-[10px] text-purple-600 border-purple-200">
                    <UserPlus size={10} className="mr-0.5" />
                    Asignado a {todo.assignee_name}
                  </Badge>
                )}
              </div>

              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
                <span className="flex items-center gap-1">
                  <Calendar size={11} />
                  Creado: {formatDate(todo.created_at)}
                </span>
                {todo.deadline ? (
                  <span className={`flex items-center gap-1 ${overdue ? "font-medium text-red-600" : ""}`}>
                    <Calendar size={11} />
                    {overdue ? "Vencida: " : "Vence: "}
                    {formatDate(todo.deadline)}
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-gray-400 italic">
                    Sin fecha límite
                  </span>
                )}
                {isCompleted && todo.completed_at && (
                  <span className="flex items-center gap-1 text-green-600">
                    <CheckCircle2 size={11} />
                    Cumplida: {formatDate(todo.completed_at)}
                  </span>
                )}
              </div>

              {/* Action buttons */}
              <div className="mt-2 flex gap-3">
                <button
                  onClick={() => handleToggleComments(todo.id)}
                  className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-integra-navy"
                >
                  {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <MessageSquare size={14} />
                  Comentarios
                </button>
                <button
                  onClick={() => {
                    setUploadTodoId(todo.id);
                    fileInputRef.current?.click();
                  }}
                  disabled={docLoading === todo.id}
                  className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-integra-navy"
                >
                  {docLoading === todo.id ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Paperclip size={14} />
                  )}
                  Adjuntar
                </button>
              </div>

              {/* Expanded section: comments + documents */}
              {isExpanded && (
                <div className="mt-3 space-y-3 border-t pt-3">
                  {/* Documents list */}
                  {(documents[todo.id] || []).length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-gray-500 uppercase">Documentos</p>
                      {(documents[todo.id] || []).map((d) => (
                        <div key={d.id} className="flex items-center gap-2 rounded-md bg-blue-50 px-3 py-1.5 text-sm">
                          <FileText size={14} className="text-blue-500 shrink-0" />
                          <span className="truncate text-blue-700">{d.file_name}</span>
                          <span className="ml-auto text-xs text-gray-400">{formatDate(d.created_at)}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add comment */}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={commentText}
                      onChange={(e) => setCommentText(e.target.value)}
                      placeholder="Agregar comentario..."
                      className="flex-1 rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-integra-gold focus:outline-none"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleAddComment(todo.id);
                        }
                      }}
                    />
                    <Button
                      size="sm"
                      onClick={() => handleAddComment(todo.id)}
                      disabled={commentLoading || !commentText.trim()}
                      className="min-h-[36px] bg-integra-navy hover:bg-integra-navy/90"
                    >
                      {commentLoading ? <Loader2 size={14} className="animate-spin" /> : "Enviar"}
                    </Button>
                  </div>
                  {/* Comment list */}
                  {(comments[todo.id] || []).map((c) => (
                    <div key={c.id} className="rounded-md bg-gray-50 px-3 py-2 text-sm">
                      <p className="text-gray-700">{c.text}</p>
                      <p className="mt-1 text-xs text-gray-400">{formatDate(c.created_at)}</p>
                    </div>
                  ))}
                  {comments[todo.id]?.length === 0 && (
                    <p className="text-xs text-gray-400">Sin comentarios aún</p>
                  )}
                </div>
              )}
            </div>

            {/* Delete */}
            {!isCompleted && isOwner && (
              <button
                onClick={() => handleDelete(todo.id)}
                disabled={loading}
                className="shrink-0 rounded p-1 text-gray-400 hover:text-red-500"
                title="Eliminar"
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0 && uploadTodoId) {
            handleFileUpload(uploadTodoId, e.target.files);
          }
          e.target.value = "";
        }}
      />

      {/* Search + filter */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchTodo}
            onChange={(e) => setSearchTodo(e.target.value)}
            placeholder="Buscar pendientes..."
            className="h-11 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-4 text-sm placeholder:text-gray-400 focus:border-integra-gold focus:outline-none focus:ring-1 focus:ring-integra-gold"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {(["all", "pendiente", "cumplida"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                statusFilter === f ? "bg-integra-navy text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {f === "all" ? "Todos" : f === "pendiente" ? "Pendientes" : "Cumplidos"}
            </button>
          ))}
          <select
            value={sortTodo}
            onChange={(e) => setSortTodo(e.target.value as "recent" | "deadline" | "alpha")}
            className="h-9 rounded-md border border-gray-200 bg-white px-2 text-xs focus:border-integra-gold focus:outline-none focus:ring-1 focus:ring-integra-gold"
          >
            <option value="recent">Más reciente</option>
            <option value="deadline">Por vencimiento</option>
            <option value="alpha">Alfabético</option>
          </select>
          {hasFilters && (
            <button
              onClick={() => { setSearchTodo(""); setStatusFilter("all"); }}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
            >
              <X size={14} /> Limpiar
            </button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-4 text-sm text-gray-500">
        <span>{pendientes.length} pendiente{pendientes.length !== 1 ? "s" : ""}</span>
        {overdueCount > 0 && (
          <span className="font-medium text-red-600">{overdueCount} vencida{overdueCount !== 1 ? "s" : ""}</span>
        )}
        <span>{cumplidas.length} cumplida{cumplidas.length !== 1 ? "s" : ""}</span>
      </div>

      {/* Add button */}
      {!showForm ? (
        <Button
          onClick={() => setShowForm(true)}
          className="min-h-[48px] bg-integra-gold text-integra-navy hover:bg-integra-gold/90 font-semibold"
        >
          <Plus size={20} className="mr-2" />
          Nuevo Pendiente
        </Button>
      ) : (
        <Card className="border border-integra-gold/30 bg-integra-gold/5">
          <CardContent className="p-4 space-y-3">
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="¿Qué necesitas hacer?"
              autoFocus
              className="w-full rounded-md border border-gray-200 px-3 py-2.5 text-sm focus:border-integra-gold focus:outline-none"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleCreate();
                }
              }}
            />
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <Calendar size={16} className="text-gray-400" />
                <label className="text-xs text-gray-500">Vencimiento:</label>
                <input
                  type="date"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                  className="rounded-md border border-gray-200 px-2 py-1.5 text-sm focus:border-integra-gold focus:outline-none"
                />
              </div>
              <div className="flex items-center gap-2">
                <UserPlus size={16} className="text-gray-400" />
                <label className="text-xs text-gray-500">Asignar a:</label>
                <select
                  value={assignedTo}
                  onChange={(e) => setAssignedTo(e.target.value)}
                  className="rounded-md border border-gray-200 px-2 py-1.5 text-sm focus:border-integra-gold focus:outline-none"
                >
                  <option value="">— Nadie (solo mío) —</option>
                  {teamMembers
                    .filter((m) => m.id !== currentUserId)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.role})
                      </option>
                    ))}
                </select>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setShowForm(false); setDescription(""); setDeadline(""); setAssignedTo(""); }}
                className="min-h-[36px]"
              >
                Cancelar
              </Button>
              <Button
                size="sm"
                onClick={handleCreate}
                disabled={saving || !description.trim()}
                className="min-h-[36px] bg-integra-navy hover:bg-integra-navy/90"
              >
                {saving ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
                Guardar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pending todos */}
      {pendientes.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Pendientes</h2>
          {pendientes.map(renderTodo)}
        </section>
      )}

      {/* Empty state */}
      {pendientes.length === 0 && cumplidas.length === 0 && (
        <div className="py-12 text-center text-gray-400">
          <CheckCircle2 size={48} className="mx-auto mb-3 opacity-40" />
          {searchTodo.trim() ? (
            <>
              <p className="text-base font-medium text-gray-500">
                No se encontraron resultados para:{" "}
                <span className="text-integra-navy">&ldquo;{searchTodo.trim()}&rdquo;</span>
              </p>
              <p className="text-sm">Intenta con otro término o quita los filtros.</p>
            </>
          ) : (
            <>
              <p className="text-base font-medium text-gray-500">Sin pendientes</p>
              <p className="text-sm">Crea tu primer pendiente con el botón de arriba</p>
            </>
          )}
        </div>
      )}

      {/* Completed todos */}
      {cumplidas.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
            Completados ({cumplidas.length})
          </h2>
          {cumplidas.map(renderTodo)}
        </section>
      )}
    </div>
  );
}
