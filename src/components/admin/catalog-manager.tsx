"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Plus,
  Pencil,
  Check,
  X,
  Search,
  PowerOff,
  Power,
  Loader2,
} from "lucide-react";
import { matchesSearchQuery } from "@/lib/utils/search";

export interface ColumnConfig {
  key: string;
  label: string;
  editable?: boolean;
  uppercase?: boolean;
  width?: string;
}

export interface CatalogManagerProps {
  catalogName: string;
  apiEndpoint: string; // e.g. "cat_classifications"
  columns: ColumnConfig[];
  emptyMessage?: string;
}

interface CatalogItem {
  id: string;
  name: string;
  active: boolean;
  [key: string]: unknown;
}

interface EditState {
  [key: string]: string;
}

export function CatalogManager({
  catalogName,
  apiEndpoint,
  columns,
  emptyMessage = "No hay elementos en este catálogo.",
}: CatalogManagerProps) {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<EditState>({});
  const [saving, setSaving] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newValues, setNewValues] = useState<EditState>({});
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/catalogs?table=${apiEndpoint}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al cargar");
      setItems(json.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  }, [apiEndpoint]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const filtered = items.filter((item) =>
    matchesSearchQuery(
      search,
      ...columns.map((col) => item[col.key]),
      item.active ? "activo" : "inactivo"
    )
  );

  function startEdit(item: CatalogItem) {
    setEditingId(item.id);
    const vals: EditState = {};
    columns.forEach((col) => {
      vals[col.key] = String(item[col.key] ?? "");
    });
    setEditValues(vals);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditValues({});
  }

  async function saveEdit(id: string) {
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {};
      columns.forEach((col) => {
        if (col.editable !== false) {
          payload[col.key] = col.uppercase
            ? editValues[col.key]?.toUpperCase()
            : editValues[col.key];
        }
      });

      const res = await fetch(`/api/admin/catalogs/${id}?table=${apiEndpoint}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al guardar");

      setItems((prev) =>
        prev.map((item) => (item.id === id ? { ...item, ...json.data } : item))
      );
      setEditingId(null);
      setEditValues({});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(item: CatalogItem) {
    setActionLoadingId(item.id);
    setError(null);
    try {
      if (item.active) {
        // Deactivate via DELETE endpoint
        const res = await fetch(
          `/api/admin/catalogs/${item.id}?table=${apiEndpoint}`,
          { method: "DELETE" }
        );
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Error al desactivar");
        setItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, active: false } : i))
        );
      } else {
        // Reactivate via PATCH
        const res = await fetch(
          `/api/admin/catalogs/${item.id}?table=${apiEndpoint}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ active: true }),
          }
        );
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Error al activar");
        setItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, active: true } : i))
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setActionLoadingId(null);
    }
  }

  function startAdd() {
    const vals: EditState = {};
    columns.forEach((col) => {
      vals[col.key] = "";
    });
    setNewValues(vals);
    setShowAddForm(true);
  }

  function cancelAdd() {
    setShowAddForm(false);
    setNewValues({});
  }

  async function saveAdd() {
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {};
      columns.forEach((col) => {
        payload[col.key] = col.uppercase
          ? newValues[col.key]?.toUpperCase()
          : newValues[col.key];
      });

      const res = await fetch(`/api/admin/catalogs?table=${apiEndpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al crear");

      setItems((prev) => [...prev, json.data]);
      setShowAddForm(false);
      setNewValues({});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 pb-3">
        <CardTitle className="text-lg text-integra-navy">
          {catalogName}
        </CardTitle>
        <Button
          onClick={startAdd}
          size="sm"
          className="min-h-[40px] bg-integra-navy text-white hover:bg-integra-navy/90"
          disabled={showAddForm}
        >
          <Plus size={16} />
          Agregar
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Search */}
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="Buscar..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Error message */}
        {error && (
          <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 border border-red-200">
            {error}
          </div>
        )}

        {/* Add form */}
        {showAddForm && (
          <div className="rounded-lg border border-integra-gold/40 bg-integra-gold/5 p-4 space-y-3">
            <p className="text-sm font-medium text-integra-navy">Nuevo elemento</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {columns
                .filter((col) => col.editable !== false)
                .map((col) => (
                  <div key={col.key} className="space-y-1">
                    <Label htmlFor={`new-${col.key}`} className="text-xs">
                      {col.label}
                    </Label>
                    <Input
                      id={`new-${col.key}`}
                      value={newValues[col.key] ?? ""}
                      onChange={(e) =>
                        setNewValues((prev) => ({
                          ...prev,
                          [col.key]: col.uppercase
                            ? e.target.value.toUpperCase()
                            : e.target.value,
                        }))
                      }
                      className="h-9"
                    />
                  </div>
                ))}
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={saveAdd}
                disabled={saving}
                className="min-h-[36px] bg-integra-navy text-white hover:bg-integra-navy/90"
              >
                {saving ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Check size={14} />
                )}
                Guardar
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={cancelAdd}
                disabled={saving}
                className="min-h-[36px]"
              >
                <X size={14} />
                Cancelar
              </Button>
            </div>
          </div>
        )}

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center py-8 text-gray-400">
            <Loader2 size={24} className="animate-spin mr-2" />
            <span className="text-sm">Cargando...</span>
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-500">
            {search.trim()
              ? `No se encontraron resultados para: "${search.trim()}"`
              : emptyMessage}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-gray-500">
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      className="pb-2 pr-4 font-semibold"
                      style={{ width: col.width }}
                    >
                      {col.label}
                    </th>
                  ))}
                  <th className="pb-2 text-right font-semibold">Estado</th>
                  <th className="pb-2 text-right font-semibold">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((item) => {
                  const isEditing = editingId === item.id;
                  const isActionLoading = actionLoadingId === item.id;

                  return (
                    <tr key={item.id} className="group hover:bg-gray-50">
                      {columns.map((col) => (
                        <td key={col.key} className="py-3 pr-4">
                          {isEditing && col.editable !== false ? (
                            <Input
                              value={editValues[col.key] ?? ""}
                              onChange={(e) =>
                                setEditValues((prev) => ({
                                  ...prev,
                                  [col.key]: col.uppercase
                                    ? e.target.value.toUpperCase()
                                    : e.target.value,
                                }))
                              }
                              className="h-8 text-sm"
                              autoFocus={col.key === "name"}
                            />
                          ) : (
                            <span
                              className={
                                !item.active ? "text-gray-400 line-through" : ""
                              }
                            >
                              {String(item[col.key] ?? "—")}
                            </span>
                          )}
                        </td>
                      ))}

                      {/* Active badge */}
                      <td className="py-3 text-right">
                        <Badge
                          variant={item.active ? "default" : "secondary"}
                          className={
                            item.active
                              ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100"
                              : "bg-gray-100 text-gray-500"
                          }
                        >
                          {item.active ? "Activo" : "Inactivo"}
                        </Badge>
                      </td>

                      {/* Action buttons */}
                      <td className="py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {isEditing ? (
                            <>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => saveEdit(item.id)}
                                disabled={saving}
                                title="Guardar"
                                className="h-8 w-8 text-emerald-600 hover:bg-emerald-50"
                              >
                                {saving ? (
                                  <Loader2 size={14} className="animate-spin" />
                                ) : (
                                  <Check size={14} />
                                )}
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={cancelEdit}
                                disabled={saving}
                                title="Cancelar"
                                className="h-8 w-8 text-gray-500 hover:bg-gray-100"
                              >
                                <X size={14} />
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => startEdit(item)}
                                title="Editar"
                                className="h-8 w-8 text-integra-navy opacity-0 group-hover:opacity-100 hover:bg-integra-navy/10"
                              >
                                <Pencil size={14} />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => toggleActive(item)}
                                disabled={isActionLoading}
                                title={item.active ? "Desactivar" : "Activar"}
                                className={`h-8 w-8 opacity-0 group-hover:opacity-100 ${
                                  item.active
                                    ? "text-red-500 hover:bg-red-50"
                                    : "text-emerald-600 hover:bg-emerald-50"
                                }`}
                              >
                                {isActionLoading ? (
                                  <Loader2 size={14} className="animate-spin" />
                                ) : item.active ? (
                                  <PowerOff size={14} />
                                ) : (
                                  <Power size={14} />
                                )}
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Item count */}
        {!loading && items.length > 0 && (
          <p className="text-xs text-gray-400">
            {items.filter((i) => i.active).length} activo(s) · {items.length} total
          </p>
        )}
      </CardContent>
    </Card>
  );
}
