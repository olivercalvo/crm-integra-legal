"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Loader2,
  Pencil,
  Trash2,
  X,
  AlertTriangle,
  Plus,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export interface Institution {
  id: string;
  name: string;
}

export type InstitutionUserRole = "admin" | "abogada" | "asistente";

interface InstitutionSelectProps {
  institutions: Institution[];
  value: string;
  onChange: (id: string) => void;
  // "+ Agregar nueva institución" inline-creation flow lives in the parent
  showNewInstitution: boolean;
  onShowNewInstitutionChange: (show: boolean) => void;
  newInstitutionName: string;
  onNewInstitutionNameChange: (name: string) => void;
  userRole: InstitutionUserRole;
}

type DeleteState =
  | { kind: "checking"; item: Institution }
  | { kind: "confirm"; item: Institution }
  | { kind: "blocked"; item: Institution; count: number }
  | { kind: "deleting"; item: Institution };

export function InstitutionSelect({
  institutions,
  value,
  onChange,
  showNewInstitution,
  onShowNewInstitutionChange,
  newInstitutionName,
  onNewInstitutionNameChange,
  userRole,
}: InstitutionSelectProps) {
  // Local copy so renames/deletes reflect without a full page refresh.
  const [items, setItems] = useState<Institution[]>(institutions);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deleteState, setDeleteState] = useState<DeleteState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  // Keep local list in sync if the parent passes a new prop (e.g. after refresh).
  useEffect(() => {
    setItems(institutions);
  }, [institutions]);

  const canManage = userRole === "admin" || userRole === "abogada";
  const selected = items.find((i) => i.id === value);

  // Close on outside click — but stay open if a modal is showing.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (deleteState) return;
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        cancelEdit();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, deleteState]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  function startEdit(item: Institution) {
    setEditingId(item.id);
    setEditValue(item.name);
    setEditError(null);
    // Focus + select after the input renders
    setTimeout(() => {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }, 0);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditValue("");
    setEditError(null);
  }

  async function saveEdit(item: Institution) {
    const trimmed = editValue.trim();
    if (!trimmed) {
      setEditError("El nombre no puede estar vacío");
      return;
    }
    if (trimmed === item.name) {
      cancelEdit();
      return;
    }
    // Local case-insensitive duplicate check (server enforces too).
    const dup = items.find(
      (i) => i.id !== item.id && i.name.toLowerCase() === trimmed.toLowerCase()
    );
    if (dup) {
      setEditError("Ya existe una institución con ese nombre");
      return;
    }

    setSavingId(item.id);
    setEditError(null);
    try {
      const res = await fetch(
        `/api/admin/catalogs/${item.id}?table=cat_institutions`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmed }),
        }
      );
      const json = await res.json();
      if (!res.ok) {
        setEditError(json.error || "Error al guardar");
        return;
      }
      const updatedName: string = json.data?.name ?? trimmed;
      setItems((prev) =>
        prev
          .map((i) => (i.id === item.id ? { ...i, name: updatedName } : i))
          .sort((a, b) => a.name.localeCompare(b.name))
      );
      cancelEdit();
      showToast("Institución actualizada");
    } catch {
      setEditError("Error de conexión");
    } finally {
      setSavingId(null);
    }
  }

  async function requestDelete(item: Institution) {
    setDeleteState({ kind: "checking", item });
    try {
      const res = await fetch(
        `/api/admin/catalogs/${item.id}/usage?table=cat_institutions`
      );
      const json = await res.json();
      if (!res.ok) {
        setDeleteState(null);
        showToast(json.error || "Error al verificar uso");
        return;
      }
      const count: number = json.count ?? 0;
      if (count > 0) {
        setDeleteState({ kind: "blocked", item, count });
      } else {
        setDeleteState({ kind: "confirm", item });
      }
    } catch {
      setDeleteState(null);
      showToast("Error de conexión");
    }
  }

  async function confirmDelete(item: Institution) {
    setDeleteState({ kind: "deleting", item });
    try {
      const res = await fetch(
        `/api/admin/catalogs/${item.id}?table=cat_institutions`,
        { method: "DELETE" }
      );
      const json = await res.json();
      if (!res.ok) {
        // 409 means it became referenced between pre-check and delete.
        if (res.status === 409) {
          setDeleteState({ kind: "blocked", item, count: json.count ?? 1 });
          return;
        }
        setDeleteState(null);
        showToast(json.error || "Error al eliminar");
        return;
      }
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      if (value === item.id) onChange("");
      setDeleteState(null);
      showToast("Institución eliminada");
    } catch {
      setDeleteState(null);
      showToast("Error de conexión");
    }
  }

  // ----- Inline "Agregar nueva institución" mode (lives in parent state) -----
  if (showNewInstitution) {
    return (
      <div className="flex gap-2">
        <Input
          id="new-institution"
          placeholder="Nombre de nueva institución..."
          value={newInstitutionName}
          onChange={(e) => onNewInstitutionNameChange(e.target.value)}
          className="min-h-[48px]"
          autoFocus
        />
        <button
          type="button"
          onClick={() => {
            onShowNewInstitutionChange(false);
            onNewInstitutionNameChange("");
          }}
          className="shrink-0 rounded-md px-3 text-gray-500 hover:text-gray-700"
          aria-label="Cancelar nueva institución"
        >
          <X size={18} />
        </button>
      </div>
    );
  }

  return (
    <div className="relative" ref={containerRef}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-[48px] w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={selected ? "text-foreground" : "text-gray-500"}>
          {selected ? selected.name : "Sin institución"}
        </span>
        <ChevronDown
          size={16}
          className={`shrink-0 text-gray-400 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* Toast */}
      {toast && (
        <p className="mt-1 text-xs font-medium text-emerald-600">{toast}</p>
      )}

      {/* Dropdown panel */}
      {open && (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-md border bg-white shadow-lg"
        >
          {/* "Sin institución" option */}
          <button
            type="button"
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
            className={`flex w-full items-center px-3 py-2.5 text-left text-sm hover:bg-gray-50 ${
              value === "" ? "bg-gray-50 font-medium" : ""
            }`}
          >
            <span className="text-gray-500">Sin institución</span>
          </button>

          {items.length === 0 && (
            <div className="px-3 py-3 text-sm text-gray-500">
              No hay instituciones registradas
            </div>
          )}

          {items.map((item) => {
            const isEditing = editingId === item.id;
            const isSaving = savingId === item.id;
            const isSelected = value === item.id;

            if (isEditing) {
              return (
                <div
                  key={item.id}
                  className="flex flex-col gap-1 border-y border-integra-gold/30 bg-integra-gold/5 px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <Input
                      ref={editInputRef}
                      value={editValue}
                      onChange={(e) => {
                        setEditValue(e.target.value);
                        if (editError) setEditError(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          saveEdit(item);
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          cancelEdit();
                        }
                      }}
                      disabled={isSaving}
                      className="h-9 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => saveEdit(item)}
                      disabled={isSaving}
                      title="Guardar (Enter)"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-emerald-600 hover:bg-emerald-50 disabled:opacity-50"
                    >
                      {isSaving ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <Check size={16} />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      disabled={isSaving}
                      title="Cancelar (Esc)"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 disabled:opacity-50"
                    >
                      <X size={16} />
                    </button>
                  </div>
                  {editError && (
                    <p className="text-xs text-red-600">{editError}</p>
                  )}
                </div>
              );
            }

            return (
              <div
                key={item.id}
                className={`group flex items-center gap-1 hover:bg-gray-50 ${
                  isSelected ? "bg-gray-50 font-medium" : ""
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    onChange(item.id);
                    setOpen(false);
                  }}
                  className="flex-1 px-3 py-2.5 text-left text-sm"
                >
                  {item.name}
                </button>
                {canManage && (
                  <div className="flex shrink-0 items-center gap-0.5 pr-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        startEdit(item);
                      }}
                      title="Editar nombre"
                      aria-label={`Editar ${item.name}`}
                      className="flex h-8 w-8 items-center justify-center rounded-md text-integra-navy hover:bg-integra-navy/10"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        requestDelete(item);
                      }}
                      title="Eliminar institución"
                      aria-label={`Eliminar ${item.name}`}
                      className="flex h-8 w-8 items-center justify-center rounded-md text-red-500 hover:bg-red-50"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {/* "+ Agregar nueva institución" — same UX as before */}
          <button
            type="button"
            onClick={() => {
              onShowNewInstitutionChange(true);
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 border-t bg-integra-gold/5 px-3 py-2.5 text-left text-sm font-medium text-integra-navy hover:bg-integra-gold/10"
          >
            <Plus size={14} />
            Agregar nueva institución
          </button>
        </div>
      )}

      {/* Confirmation modal — institution NOT in use */}
      {deleteState?.kind === "confirm" || deleteState?.kind === "deleting" ? (
        <DeleteModal
          title="Eliminar institución"
          loading={deleteState.kind === "deleting"}
          onClose={() => setDeleteState(null)}
          actions={
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDeleteState(null)}
                disabled={deleteState.kind === "deleting"}
                className="min-h-[44px] flex-1"
              >
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={() => confirmDelete(deleteState.item)}
                disabled={deleteState.kind === "deleting"}
                className="min-h-[44px] flex-1 bg-red-600 text-white hover:bg-red-700"
              >
                {deleteState.kind === "deleting" ? (
                  <>
                    <Loader2 size={14} className="mr-1 animate-spin" />
                    Eliminando...
                  </>
                ) : (
                  "Eliminar"
                )}
              </Button>
            </>
          }
        >
          <p>
            ¿Eliminar{" "}
            <strong className="text-gray-900">
              &lsquo;{deleteState.item.name}&rsquo;
            </strong>
            ? Esta acción no se puede deshacer.
          </p>
        </DeleteModal>
      ) : null}

      {/* Info modal — institution IS in use */}
      {deleteState?.kind === "blocked" && (
        <DeleteModal
          title="No se puede eliminar"
          loading={false}
          onClose={() => setDeleteState(null)}
          actions={
            <Button
              type="button"
              onClick={() => setDeleteState(null)}
              className="min-h-[44px] w-full bg-integra-navy text-white hover:bg-integra-navy/90"
            >
              Entendido
            </Button>
          }
        >
          <p>
            La institución{" "}
            <strong className="text-gray-900">
              &lsquo;{deleteState.item.name}&rsquo;
            </strong>{" "}
            está asignada a {deleteState.count} caso
            {deleteState.count === 1 ? "" : "s"}. Para eliminarla, primero
            cambia esos casos a otra institución.
          </p>
        </DeleteModal>
      )}

      {/* Loading overlay while pre-checking usage — non-blocking */}
      {deleteState?.kind === "checking" && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center">
          <div className="flex items-center gap-2 rounded-md bg-white px-4 py-2 text-sm shadow-lg">
            <Loader2 size={14} className="animate-spin text-integra-navy" />
            Verificando uso...
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Local modal helper ----------

interface DeleteModalProps {
  title: string;
  loading: boolean;
  onClose: () => void;
  actions: React.ReactNode;
  children: React.ReactNode;
}

function DeleteModal({
  title,
  loading,
  onClose,
  actions,
  children,
}: DeleteModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [loading, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={loading ? undefined : onClose}
      />
      <div className="relative w-full max-w-md rounded-lg bg-white shadow-xl">
        <div className="space-y-4 p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100">
              <AlertTriangle size={20} className="text-red-600" />
            </div>
            <h3 className="text-lg font-bold text-gray-900">{title}</h3>
          </div>
          <div className="text-sm text-gray-600">{children}</div>
          <div className="flex gap-3 pt-2">{actions}</div>
        </div>
      </div>
    </div>
  );
}
