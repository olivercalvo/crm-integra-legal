"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  Pencil,
  Check,
  X,
  Search,
  PowerOff,
  Power,
  Loader2,
  Lock,
  FileSpreadsheet,
  Filter,
  List,
} from "lucide-react";
import { matchesSearchQuery } from "@/lib/utils/search";
import { ImportAccountsPanel } from "@/app/finanzas/configuracion/cuentas/_components/import-accounts-panel";
import {
  validateCreateChartAccount,
  validateUpdateChartAccount,
  type ValidationErrors,
} from "@/lib/finanzas/validators/chart-of-account";
import {
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_ORDER,
  ACCOUNT_TYPE_LABEL_ES,
  CUENTAS_CONTROL,
  CUENTA_CONTROL_LABEL_ES,
  SUBCATEGORIA_LABEL_ES,
  cuentaControlLabel,
  isSubcategoriaValidaParaTipo,
  requiereSubcategoria,
  subcategoriaLabel,
  subcategoriasParaTipo,
  type AccountType,
  type CuentaControl,
  type Subcategoria,
  type ChartAccountRow,
} from "@/lib/finanzas/types/chart-of-account";

const API_BASE = "/api/finanzas/configuracion/chart-of-accounts";

interface Props {
  initialAccounts: ChartAccountRow[];
  canMutate: boolean;
}

type FormState = {
  mode: "create" | "edit";
  id: string | null;
  isSystem: boolean;
  code: string;
  name: string;
  account_type: AccountType;
  /** "" = sin clasificar (se manda como null). */
  subcategoria: Subcategoria | "";
  /** "" = cuenta normal, sin auxiliar que cuadrar (se manda como null). */
  cuenta_control: CuentaControl | "";
  /** ISO (AAAA-MM-DD). "" = sin fecha; obligatoria si el saldo no es 0. */
  saldo_inicial_fecha: string;
  /** Se mantiene como STRING para no pelear con el input mientras se tipea
   *  ("-", "1500.", "" al borrar todo). Se convierte a número al guardar. */
  saldo_inicial: string;
  description: string;
  active: boolean;
};

function emptyCreateForm(): FormState {
  return {
    mode: "create",
    id: null,
    isSystem: false,
    code: "",
    name: "",
    account_type: "asset",
    subcategoria: "",
    cuenta_control: "",
    saldo_inicial: "0",
    saldo_inicial_fecha: "",
    description: "",
    active: true,
  };
}

/** Formatea un saldo para el listado: B/. con 2 decimales y separador de miles. */
function formatSaldo(n: number): string {
  return n.toLocaleString("es-PA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const selectClass =
  "block w-full rounded-md border px-3 min-h-[44px] text-sm bg-white hover:border-integra-navy focus:border-integra-navy focus:outline-none border-gray-300";

export function ChartOfAccountsManager({ initialAccounts, canMutate }: Props) {
  const router = useRouter();
  const [accounts, setAccounts] = useState<ChartAccountRow[]>(initialAccounts);
  const [search, setSearch] = useState("");
  /**
   * Qué cuentas se listan. Por defecto SOLO LAS ACTIVAS.
   *
   * El plan de Josuarth convive con el anterior: de las 98 cuentas, 34 están
   * inactivas e intercaladas por código entre las vigentes. Sin filtro, él abre
   * su propio catálogo y ve "Cuentas por cobrar — Honorarios (Inactiva)" tres
   * renglones arriba de "100004 Cuentas por Cobrar Clientes". Las inactivas no
   * se borran —tienen historia contable detrás— pero tampoco son lo que alguien
   * viene a mirar.
   */
  const [verInactivas, setVerInactivas] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [fieldErrors, setFieldErrors] = useState<ValidationErrors>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  /**
   * Recarga el listado desde el server tras una carga masiva. Es más simple y
   * más seguro que reconciliar en el cliente: el bulk puede haber creado y
   * actualizado decenas de filas en una pasada.
   */
  async function reloadAccounts() {
    try {
      const res = await fetch(API_BASE);
      const json = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(json.accounts)) {
        setAccounts(json.accounts as ChartAccountRow[]);
      }
    } catch {
      setError("La carga se aplicó, pero no se pudo refrescar el listado. Recargue la página.");
    }
    // El conteo del encabezado ("N cuentas contables") lo renderiza el server
    // component de la página, así que sin esto queda viejo tras la carga.
    router.refresh();
  }

  /** Cuántas inactivas esconde la vista por defecto. Se muestra en el toggle. */
  const inactivasOcultas = useMemo(
    () => accounts.filter((a) => !a.active).length,
    [accounts]
  );

  const filtered = useMemo(
    () =>
      accounts
        .filter((a) => verInactivas || a.active)
        .filter((a) =>
          matchesSearchQuery(
            search,
            a.code,
            a.name,
            a.account_name_qb,
            ACCOUNT_TYPE_LABEL_ES[a.account_type],
            subcategoriaLabel(a.subcategoria),
            cuentaControlLabel(a.cuenta_control),
            a.active ? "activa" : "inactiva"
          )
        ),
    [accounts, search, verInactivas]
  );

  const grouped = useMemo(
    () =>
      ACCOUNT_TYPE_ORDER.map((type) => ({
        type,
        rows: filtered
          .filter((a) => a.account_type === type)
          .sort((x, y) => x.code.localeCompare(y.code, "en", { numeric: true })),
      })).filter((g) => g.rows.length > 0),
    [filtered]
  );

  function startCreate() {
    setError(null);
    setFieldErrors({});
    setForm(emptyCreateForm());
  }

  function startEdit(a: ChartAccountRow) {
    setError(null);
    setFieldErrors({});
    setForm({
      mode: "edit",
      id: a.id,
      isSystem: a.is_system,
      code: a.code,
      name: a.name,
      account_type: a.account_type,
      subcategoria: a.subcategoria ?? "",
      cuenta_control: a.cuenta_control ?? "",
      saldo_inicial_fecha: a.saldo_inicial_fecha ?? "",
      saldo_inicial: String(a.saldo_inicial ?? 0),
      description: a.description ?? "",
      active: a.active,
    });
  }

  function cancelForm() {
    setForm(null);
    setFieldErrors({});
    setError(null);
  }

  async function submitForm() {
    if (!form) return;
    setSaving(true);
    setError(null);
    setFieldErrors({});

    const payloadRaw = {
      code: form.code.trim(),
      name: form.name.trim(),
      account_type: form.account_type,
      subcategoria: form.subcategoria || null,
      cuenta_control: form.cuenta_control || null,
      // Campo vacío = 0 (el validador también defaultea a 0). Un "-" o "abc"
      // suelto llega tal cual y el validador lo rechaza con mensaje inline.
      saldo_inicial: form.saldo_inicial.trim() === "" ? 0 : form.saldo_inicial.trim(),
      saldo_inicial_fecha: form.saldo_inicial_fecha || null,
      description: form.description.trim() || null,
      active: form.active,
    };

    const validation =
      form.mode === "create"
        ? validateCreateChartAccount(payloadRaw)
        : // El código es INMUTABLE al editar (para todas las cuentas): no lo
          // mandamos. El campo se muestra solo-lectura en el form.
          validateUpdateChartAccount({ ...payloadRaw, code: undefined });

    if (!validation.ok) {
      setFieldErrors(validation.errors);
      setSaving(false);
      return;
    }

    try {
      const url =
        form.mode === "create" ? API_BASE : `${API_BASE}/${form.id}`;
      const method = form.mode === "create" ? "POST" : "PATCH";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validation.data),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (json.fieldErrors) setFieldErrors(json.fieldErrors);
        setError(json.error ?? "Error al guardar");
        setSaving(false);
        return;
      }

      const saved = json.account as ChartAccountRow;
      setAccounts((prev) => {
        if (form.mode === "create") return [...prev, saved];
        return prev.map((a) => (a.id === saved.id ? saved : a));
      });
      setForm(null);
      // Mantiene sincronizado el conteo del encabezado (server component).
      router.refresh();
    } catch {
      setError("Error de red al guardar. Intente de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(a: ChartAccountRow) {
    if (a.is_system && a.active) return; // bloqueado en UI (y en server)
    setActionLoadingId(a.id);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/${a.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // El PATCH es REEMPLAZO TOTAL (ver api/chart-of-accounts.ts): hay que
        // reenviar subcategoria y saldo_inicial o el toggle los resetearía a
        // null / 0.
        body: JSON.stringify({
          name: a.name,
          account_type: a.account_type,
          subcategoria: a.subcategoria,
          cuenta_control: a.cuenta_control,
          saldo_inicial_fecha: a.saldo_inicial_fecha,
          saldo_inicial: a.saldo_inicial,
          description: a.description,
          active: !a.active,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Error al cambiar el estado");
        return;
      }
      const saved = json.account as ChartAccountRow;
      setAccounts((prev) => prev.map((x) => (x.id === saved.id ? saved : x)));
    } catch {
      setError("Error de red. Intente de nuevo.");
    } finally {
      setActionLoadingId(null);
    }
  }

  const activeCount = accounts.filter((a) => a.active).length;

  /**
   * ¿La cuenta abre con saldo? De esto dependen la obligatoriedad de la fecha y
   * si el campo está habilitado. Se lee del texto crudo del input porque el
   * usuario puede estar tipeando ("-", "1500." o "" al borrar todo); cualquier
   * cosa que no parsee cuenta como 0, igual que hace el validador.
   */
  const saldoNoEsCero = (() => {
    if (!form) return false;
    const n = Number(form.saldo_inicial.trim());
    return Number.isFinite(n) && n !== 0;
  })();

  return (
    <div className="space-y-5">
      {/* Barra superior: buscar + agregar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full sm:max-w-xs">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <Input
            placeholder="Buscar por código, nombre o QB…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Mismo patrón visual que el toggle de los reportes ("Solo cuentas con
            saldo / Todas las cuentas"): dos opciones en un grupo, con el conteo
            de lo que se esconde al lado. */}
        <div
          role="radiogroup"
          aria-label="Cuentas a mostrar"
          className="inline-flex overflow-hidden rounded-lg border border-integra-navy/20 bg-white"
        >
          <button
            type="button"
            role="radio"
            aria-checked={!verInactivas}
            onClick={() => setVerInactivas(false)}
            className={
              "inline-flex min-h-[40px] items-center gap-1.5 px-3 text-xs font-medium transition-colors " +
              (!verInactivas
                ? "bg-integra-navy text-white"
                : "text-gray-700 hover:bg-gray-50")
            }
          >
            <Filter size={14} />
            Solo activas
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={verInactivas}
            onClick={() => setVerInactivas(true)}
            className={
              "inline-flex min-h-[40px] items-center gap-1.5 px-3 text-xs font-medium transition-colors " +
              (verInactivas
                ? "bg-integra-navy text-white"
                : "text-gray-700 hover:bg-gray-50")
            }
          >
            <List size={14} />
            Todas
          </button>
        </div>

        {inactivasOcultas > 0 && (
          <p className="text-xs text-gray-500">
            {verInactivas ? (
              <>
                Se muestran las <strong>{inactivasOcultas}</strong> cuenta(s) inactivas del plan
                contable anterior.
              </>
            ) : (
              <>
                <strong>{inactivasOcultas}</strong> cuenta(s) inactivas ocultas. Son del plan
                contable anterior y no se pueden usar para clasificar.
              </>
            )}
          </p>
        )}
        {canMutate && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setError(null);
                setForm(null);
                setImporting(true);
              }}
              disabled={importing}
              className="min-h-[44px]"
            >
              <FileSpreadsheet size={18} className="mr-1" />
              Importar cuentas
            </Button>
            <Button
              onClick={startCreate}
              disabled={!!form || importing}
              className="min-h-[44px] bg-integra-gold text-integra-navy hover:bg-integra-gold/90"
            >
              <Plus size={18} className="mr-1" />
              Nueva cuenta
            </Button>
          </div>
        )}
      </div>

      {/* Carga masiva desde Excel */}
      {canMutate && importing && (
        <ImportAccountsPanel
          onImported={reloadAccounts}
          onClose={() => setImporting(false)}
        />
      )}

      {/* Error global */}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Form crear/editar */}
      {form && (
        <div className="rounded-lg border border-integra-gold/40 bg-integra-gold/5 p-4 space-y-4">
          <p className="text-sm font-semibold text-integra-navy">
            {form.mode === "create" ? "Nueva cuenta" : `Editar cuenta ${form.code}`}
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            {/* Código */}
            <div>
              <Label className="mb-1 block text-xs">Código *</Label>
              <Input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                disabled={saving || form.mode === "edit"}
                readOnly={form.mode === "edit"}
                placeholder="Ej. 5210"
                className={fieldErrors.code ? "border-red-300" : ""}
              />
              {form.mode === "edit" && (
                <p className="mt-1 text-xs text-gray-500">
                  El código no se puede modificar. Si está mal, desactivá la cuenta y creá una nueva.
                </p>
              )}
              {fieldErrors.code && (
                <p className="mt-1 text-xs text-red-600">{fieldErrors.code}</p>
              )}
            </div>

            {/* Tipo */}
            <div>
              <Label className="mb-1 block text-xs">Tipo *</Label>
              <select
                value={form.account_type}
                onChange={(e) => {
                  // Al cambiar el tipo hay que LIMPIAR la subcategoría si dejó
                  // de corresponderle: las nueve de resultado y las de balance
                  // no se mezclan, y el servidor rechaza la combinación. Sin
                  // esto el usuario ve un valor viejo en el selector filtrado y
                  // el guardado falla con un error que no se explica solo.
                  const tipo = e.target.value as AccountType;
                  setForm({
                    ...form,
                    account_type: tipo,
                    subcategoria: isSubcategoriaValidaParaTipo(tipo, form.subcategoria)
                      ? form.subcategoria
                      : "",
                  });
                }}
                disabled={saving}
                className={
                  selectClass + (fieldErrors.account_type ? " border-red-300" : "")
                }
              >
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {ACCOUNT_TYPE_LABEL_ES[t]}
                  </option>
                ))}
              </select>
              {fieldErrors.account_type && (
                <p className="mt-1 text-xs text-red-600">{fieldErrors.account_type}</p>
              )}
            </div>

            {/* Subcategoría — filtrada por tipo; obligatoria en resultado */}
            <div>
              <Label className="mb-1 block text-xs">
                Subcategoría {requiereSubcategoria(form.account_type) ? "*" : "(opcional)"}
              </Label>
              <select
                value={form.subcategoria}
                onChange={(e) =>
                  setForm({
                    ...form,
                    subcategoria: e.target.value as Subcategoria | "",
                  })
                }
                disabled={saving}
                className={
                  selectClass + (fieldErrors.subcategoria ? " border-red-300" : "")
                }
              >
                {/* En cuentas de resultado NO se ofrece "sin clasificar": desde
                    NIIF 18 la subcategoría es obligatoria ahí. */}
                {requiereSubcategoria(form.account_type) ? (
                  <option value="">— Seleccione una —</option>
                ) : (
                  <option value="">— Sin clasificar —</option>
                )}
                {subcategoriasParaTipo(form.account_type).map((s) => (
                  <option key={s} value={s}>
                    {SUBCATEGORIA_LABEL_ES[s]}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500">
                {requiereSubcategoria(form.account_type)
                  ? "NIIF 18: clasifica la cuenta por actividad (operación, inversión o financiamiento)."
                  : "Agrupa el Balance General (corriente, no corriente, propiedad planta y equipo)."}
              </p>
              {fieldErrors.subcategoria && (
                <p className="mt-1 text-xs text-red-600">{fieldErrors.subcategoria}</p>
              )}
            </div>

            {/* Cuenta control — marca que la cuenta cuadra contra un auxiliar */}
            <div>
              <Label className="mb-1 block text-xs">Cuenta control (opcional)</Label>
              <select
                value={form.cuenta_control}
                onChange={(e) =>
                  setForm({
                    ...form,
                    cuenta_control: e.target.value as CuentaControl | "",
                  })
                }
                disabled={saving}
                className={
                  selectClass + (fieldErrors.cuenta_control ? " border-red-300" : "")
                }
              >
                <option value="">— No es cuenta control —</option>
                {CUENTAS_CONTROL.map((c) => (
                  <option key={c} value={c}>
                    {CUENTA_CONTROL_LABEL_ES[c]}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500">
                Su saldo debe cuadrar contra el detalle del auxiliar (antigüedad de
                cuentas por cobrar o por pagar).
              </p>
              {fieldErrors.cuenta_control && (
                <p className="mt-1 text-xs text-red-600">{fieldErrors.cuenta_control}</p>
              )}
            </div>

            {/* Saldo inicial — permite negativos */}
            <div>
              <Label className="mb-1 block text-xs">Saldo inicial (B/.)</Label>
              <Input
                type="number"
                step="0.01"
                inputMode="decimal"
                value={form.saldo_inicial}
                onChange={(e) => setForm({ ...form, saldo_inicial: e.target.value })}
                disabled={saving}
                placeholder="0.00"
                className={
                  "text-right font-mono " +
                  (fieldErrors.saldo_inicial ? "border-red-300" : "")
                }
              />
              <p className="mt-1 text-xs text-gray-500">
                Monto de apertura. Admite negativos.
              </p>
              {fieldErrors.saldo_inicial && (
                <p className="mt-1 text-xs text-red-600">{fieldErrors.saldo_inicial}</p>
              )}
            </div>

            {/* Fecha del saldo — obligatoria en cuanto hay monto */}
            <div>
              <Label className="mb-1 block text-xs">
                Fecha del saldo inicial {saldoNoEsCero ? "*" : "(opcional)"}
              </Label>
              <Input
                type="date"
                value={form.saldo_inicial_fecha}
                onChange={(e) =>
                  setForm({ ...form, saldo_inicial_fecha: e.target.value })
                }
                disabled={saving || !saldoNoEsCero}
                className={fieldErrors.saldo_inicial_fecha ? "border-red-300" : ""}
              />
              <p className="mt-1 text-xs text-gray-500">
                {saldoNoEsCero
                  ? "A qué día corresponde el monto. El período fiscal va del 1 de enero al 31 de diciembre."
                  : "Se habilita cuando cargás un saldo distinto de 0."}
              </p>
              {fieldErrors.saldo_inicial_fecha && (
                <p className="mt-1 text-xs text-red-600">
                  {fieldErrors.saldo_inicial_fecha}
                </p>
              )}
            </div>

            {/* Nombre */}
            <div className="sm:col-span-2">
              <Label className="mb-1 block text-xs">Nombre *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                disabled={saving}
                placeholder='Ej. "Gastos de capacitación"'
                className={fieldErrors.name ? "border-red-300" : ""}
              />
              {fieldErrors.name && (
                <p className="mt-1 text-xs text-red-600">{fieldErrors.name}</p>
              )}
            </div>

            {/* Descripción */}
            <div className="sm:col-span-2">
              <Label className="mb-1 block text-xs">Descripción (opcional)</Label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                disabled={saving}
                rows={2}
                placeholder="Notas operativas sobre la cuenta…"
                className={
                  "block w-full rounded-md border px-3 py-2 text-sm bg-white hover:border-integra-navy focus:border-integra-navy focus:outline-none " +
                  (fieldErrors.description ? "border-red-300" : "border-gray-300")
                }
              />
              {fieldErrors.description && (
                <p className="mt-1 text-xs text-red-600">{fieldErrors.description}</p>
              )}
            </div>

            {/* Activa */}
            <div className="sm:col-span-2">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm({ ...form, active: e.target.checked })}
                  disabled={saving || (form.isSystem && form.active)}
                  className="h-4 w-4 rounded border-gray-300 text-integra-navy focus:ring-integra-navy"
                />
                Cuenta activa
              </label>
              {form.isSystem && (
                <p className="mt-1 text-xs text-gray-500">
                  Cuenta del sistema: no se puede desactivar.
                </p>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              onClick={submitForm}
              disabled={saving}
              className="min-h-[40px] bg-integra-navy text-white hover:bg-integra-navy/90"
            >
              {saving ? (
                <Loader2 size={14} className="mr-1 animate-spin" />
              ) : (
                <Check size={14} className="mr-1" />
              )}
              Guardar
            </Button>
            <Button
              variant="outline"
              onClick={cancelForm}
              disabled={saving}
              className="min-h-[40px]"
            >
              <X size={14} className="mr-1" />
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {/* Listado agrupado por tipo */}
      {grouped.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-500">
          {search.trim()
            ? `No se encontraron cuentas para: "${search.trim()}"`
            : "No hay cuentas en el plan."}
        </p>
      ) : (
        <div className="space-y-6">
          {grouped.map((group) => (
            <section key={group.type} className="space-y-2">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-integra-navy">
                  {ACCOUNT_TYPE_LABEL_ES[group.type]}
                </h2>
                <span className="text-xs text-gray-400">({group.rows.length})</span>
              </div>

              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                      <th className="px-3 py-2 font-semibold">Código</th>
                      <th className="px-3 py-2 font-semibold">Nombre</th>
                      <th className="px-3 py-2 font-semibold">Subcategoría</th>
                      <th className="px-3 py-2 text-right font-semibold">
                        Saldo inicial
                      </th>
                      <th className="px-3 py-2 font-semibold">Nombre QB</th>
                      <th className="px-3 py-2 text-right font-semibold">Estado</th>
                      {canMutate && (
                        <th className="px-3 py-2 text-right font-semibold">Acciones</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {group.rows.map((a) => {
                      const isActionLoading = actionLoadingId === a.id;
                      const lockDeactivate = a.is_system && a.active;
                      return (
                        <tr key={a.id} className="group hover:bg-gray-50">
                          <td className="px-3 py-3 font-mono text-xs text-gray-700">
                            <span className={!a.active ? "text-gray-400 line-through" : ""}>
                              {a.code}
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            <span
                              className={
                                "inline-flex items-center gap-1.5 " +
                                (!a.active ? "text-gray-400 line-through" : "")
                              }
                            >
                              {a.name}
                              {a.is_system && (
                                <Badge
                                  variant="secondary"
                                  className="gap-1 bg-integra-navy/10 text-integra-navy hover:bg-integra-navy/10"
                                >
                                  <Lock size={10} />
                                  Sistema
                                </Badge>
                              )}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-gray-500">
                            {a.cuenta_control && (
                              <Badge
                                variant="secondary"
                                className="mr-1 bg-integra-gold/15 font-normal text-integra-navy hover:bg-integra-gold/15"
                                title={`Su saldo cuadra contra el auxiliar de ${a.cuenta_control}`}
                              >
                                {cuentaControlLabel(a.cuenta_control)}
                              </Badge>
                            )}
                            {a.subcategoria ? (
                              <Badge
                                variant="secondary"
                                className="bg-gray-100 font-normal text-gray-600 hover:bg-gray-100"
                              >
                                {subcategoriaLabel(a.subcategoria)}
                              </Badge>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td
                            className={
                              "px-3 py-3 text-right font-mono text-xs tabular-nums " +
                              (a.saldo_inicial < 0
                                ? "text-red-600"
                                : a.saldo_inicial > 0
                                  ? "text-gray-700"
                                  : "text-gray-400")
                            }
                          >
                            {formatSaldo(a.saldo_inicial)}
                            {/* La fecha va debajo del monto y no en columna
                                propia: sin fecha el saldo no se puede
                                interpretar, así que se leen juntos. */}
                            {a.saldo_inicial_fecha && (
                              <span className="mt-0.5 block text-[11px] font-normal text-gray-400">
                                al {a.saldo_inicial_fecha}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-3 text-gray-500">
                            {a.account_name_qb || "—"}
                          </td>
                          <td className="px-3 py-3 text-right">
                            <Badge
                              variant={a.active ? "default" : "secondary"}
                              className={
                                a.active
                                  ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100"
                                  : "bg-gray-100 text-gray-500"
                              }
                            >
                              {a.active ? "Activa" : "Inactiva"}
                            </Badge>
                          </td>
                          {canMutate && (
                            <td className="px-3 py-3 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => startEdit(a)}
                                  disabled={!!form}
                                  title="Editar"
                                  className="h-8 w-8 text-integra-navy hover:bg-integra-navy/10"
                                >
                                  <Pencil size={14} />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => toggleActive(a)}
                                  disabled={isActionLoading || lockDeactivate}
                                  title={
                                    lockDeactivate
                                      ? "Cuenta del sistema — no se puede desactivar"
                                      : a.active
                                        ? "Desactivar"
                                        : "Activar"
                                  }
                                  className={
                                    "h-8 w-8 " +
                                    (lockDeactivate
                                      ? "text-gray-300"
                                      : a.active
                                        ? "text-red-500 hover:bg-red-50"
                                        : "text-emerald-600 hover:bg-emerald-50")
                                  }
                                >
                                  {isActionLoading ? (
                                    <Loader2 size={14} className="animate-spin" />
                                  ) : lockDeactivate ? (
                                    <Lock size={14} />
                                  ) : a.active ? (
                                    <PowerOff size={14} />
                                  ) : (
                                    <Power size={14} />
                                  )}
                                </Button>
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Conteo */}
      <p className="text-xs text-gray-400">
        {activeCount} activa(s) · {accounts.length} total
      </p>
    </div>
  );
}
