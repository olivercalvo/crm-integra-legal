"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, PowerOff, Power, ChevronDown, Search, ArrowUp, ArrowDown, ArrowUpDown, X } from "lucide-react";
import { matchesSearchQuery } from "@/lib/utils/search";
import type { UserRole } from "@/types/database";

const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Administrador",
  abogada: "Abogada",
  asistente: "Asistente",
};

const ROLE_COLORS: Record<UserRole, string> = {
  admin: "bg-integra-navy/10 text-integra-navy",
  abogada: "bg-integra-gold/20 text-amber-800",
  asistente: "bg-gray-100 text-gray-700",
};

interface UserRow {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
  active: boolean;
  created_at: string;
}

interface UserTableProps {
  users: UserRow[];
  currentUserId: string;
}

type SortKey = "full_name" | "email" | "role" | "active";

function SortIcon({ column, activeCol, dir }: { column: string; activeCol: string; dir: "asc" | "desc" }) {
  if (column !== activeCol) return <ArrowUpDown size={14} className="text-gray-300 group-hover:text-gray-500" />;
  return dir === "asc" ? <ArrowUp size={14} className="text-integra-navy" /> : <ArrowDown size={14} className="text-integra-navy" />;
}

export function UserTable({ users: initialUsers, currentUserId }: UserTableProps) {
  const [users, setUsers] = useState<UserRow[]>(initialUsers);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);

  // Sort & filter state
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [sortCol, setSortCol] = useState<SortKey>("full_name");
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
    let result = users;
    if (search) {
      result = result.filter((u) =>
        matchesSearchQuery(
          search,
          u.full_name,
          u.email,
          u.role,
          ROLE_LABELS[u.role],
          u.active ? "activo" : "inactivo"
        )
      );
    }
    if (roleFilter) {
      result = result.filter((u) => u.role === roleFilter);
    }
    return [...result].sort((a, b) => {
      const aVal = String(a[sortCol]).toLowerCase();
      const bVal = String(b[sortCol]).toLowerCase();
      return sortDir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    });
  }, [users, search, roleFilter, sortCol, sortDir]);

  const hasFilters = search || roleFilter;

  async function toggleActive(user: UserRow) {
    if (user.id === currentUserId) {
      setError("No puedes desactivar tu propia cuenta.");
      return;
    }
    setLoadingId(user.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: user.active ? "DELETE" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: user.active ? undefined : JSON.stringify({ active: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al actualizar");
      setUsers((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, active: !user.active } : u))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoadingId(null);
    }
  }

  async function changeRole(userId: string, newRole: UserRole) {
    setLoadingId(userId);
    setEditingRoleId(null);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al actualizar rol");
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <div className="space-y-3">
      {/* Search + filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre o correo..."
            className="h-11 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-4 text-sm placeholder:text-gray-400 focus:border-integra-gold focus:outline-none focus:ring-1 focus:ring-integra-gold"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="h-11 rounded-lg border border-gray-200 bg-white px-3 text-sm focus:border-integra-gold focus:outline-none focus:ring-1 focus:ring-integra-gold"
        >
          <option value="">Todos los roles</option>
          <option value="admin">Administrador</option>
          <option value="abogada">Abogada</option>
          <option value="asistente">Asistente</option>
        </select>
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setSearch(""); setRoleFilter(""); }}
            className="h-11 text-gray-500 hover:text-gray-700"
          >
            <X size={14} className="mr-1" /> Limpiar
          </Button>
        )}
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-3 text-red-500 hover:text-red-700 font-medium"
          >
            Cerrar
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="px-4 py-3 font-semibold">
                <button onClick={() => handleSort("full_name")} className="flex items-center gap-1 hover:text-integra-navy transition-colors group">
                  Nombre <SortIcon column="full_name" activeCol={sortCol} dir={sortDir} />
                </button>
              </th>
              <th className="px-4 py-3 font-semibold">
                <button onClick={() => handleSort("email")} className="flex items-center gap-1 hover:text-integra-navy transition-colors group">
                  Correo <SortIcon column="email" activeCol={sortCol} dir={sortDir} />
                </button>
              </th>
              <th className="px-4 py-3 font-semibold">
                <button onClick={() => handleSort("role")} className="flex items-center gap-1 hover:text-integra-navy transition-colors group">
                  Rol <SortIcon column="role" activeCol={sortCol} dir={sortDir} />
                </button>
              </th>
              <th className="px-4 py-3 font-semibold text-center">
                <button onClick={() => handleSort("active")} className="flex items-center gap-1 hover:text-integra-navy transition-colors group mx-auto">
                  Estado <SortIcon column="active" activeCol={sortCol} dir={sortDir} />
                </button>
              </th>
              <th className="px-4 py-3 font-semibold text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtered.map((user) => {
              const isLoading = loadingId === user.id;
              const isCurrentUser = user.id === currentUserId;

              return (
                <tr
                  key={user.id}
                  className={`group hover:bg-gray-50 ${!user.active ? "opacity-60" : ""}`}
                >
                  {/* Name */}
                  <td className="px-4 py-3">
                    <div className="font-medium text-integra-navy">
                      {user.full_name}
                      {isCurrentUser && (
                        <span className="ml-2 text-xs text-gray-400">(tú)</span>
                      )}
                    </div>
                  </td>

                  {/* Email */}
                  <td className="px-4 py-3 text-gray-600">{user.email}</td>

                  {/* Role — clickable dropdown */}
                  <td className="px-4 py-3">
                    <div className="relative inline-block">
                      <button
                        type="button"
                        onClick={() =>
                          setEditingRoleId(
                            editingRoleId === user.id ? null : user.id
                          )
                        }
                        disabled={isLoading || isCurrentUser}
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-all ${
                          ROLE_COLORS[user.role]
                        } ${
                          !isCurrentUser
                            ? "cursor-pointer hover:ring-2 hover:ring-integra-navy/20"
                            : "cursor-default"
                        }`}
                      >
                        {ROLE_LABELS[user.role]}
                        {!isCurrentUser && <ChevronDown size={11} />}
                      </button>

                      {editingRoleId === user.id && (
                        <>
                          {/* Backdrop */}
                          <div
                            className="fixed inset-0 z-10"
                            onClick={() => setEditingRoleId(null)}
                          />
                          <div className="absolute left-0 top-full z-20 mt-1 min-w-[160px] rounded-lg border bg-white shadow-lg py-1">
                            {(Object.entries(ROLE_LABELS) as [UserRole, string][]).map(
                              ([value, label]) => (
                                <button
                                  key={value}
                                  type="button"
                                  onClick={() => changeRole(user.id, value)}
                                  className={`block w-full px-4 py-2 text-left text-sm hover:bg-gray-50 ${
                                    user.role === value
                                      ? "font-semibold text-integra-navy"
                                      : "text-gray-700"
                                  }`}
                                >
                                  {label}
                                </button>
                              )
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3 text-center">
                    <Badge
                      variant="secondary"
                      className={
                        user.active
                          ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100"
                          : "bg-gray-100 text-gray-500"
                      }
                    >
                      {user.active ? "Activo" : "Inactivo"}
                    </Badge>
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3 text-right">
                    {!isCurrentUser && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => toggleActive(user)}
                        disabled={isLoading}
                        title={user.active ? "Desactivar usuario" : "Activar usuario"}
                        className={`min-h-[36px] opacity-0 group-hover:opacity-100 ${
                          user.active
                            ? "text-red-500 hover:bg-red-50"
                            : "text-emerald-600 hover:bg-emerald-50"
                        }`}
                      >
                        {isLoading ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : user.active ? (
                          <>
                            <PowerOff size={14} />
                            Desactivar
                          </>
                        ) : (
                          <>
                            <Power size={14} />
                            Activar
                          </>
                        )}
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-400">
                  {search.trim()
                    ? `No se encontraron resultados para: "${search.trim()}"`
                    : "No se encontraron usuarios"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-400">
        {filtered.length} de {users.length} usuario(s) · {users.filter((u) => u.active).length} activo(s)
      </p>
    </div>
  );
}
