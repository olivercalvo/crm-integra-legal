"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BookOpenCheck, Loader2, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import {
  lineaManualVacia,
  totalesManuales,
  type LineaManualDraft,
} from "@/lib/finanzas/contabilidad/asiento-manual";

/**
 * FORMULARIO DE ASIENTO MANUAL DE DIARIO.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * EL TOTALIZADOR EN VIVO NO ES UNA SEGUNDA VALIDACIÓN
 * ═════════════════════════════════════════════════════════════════════════════
 * El cuadre lo hace cumplir `post_journal_entry`, y su mensaje ya dice la
 * diferencia. Acá se muestra ANTES de apretar, que es lo que el contador mira
 * mientras carga: la diferencia en vivo es la diferencia entre un asiento que
 * entra al primer intento y uno que rebota tres veces.
 *
 * Es la misma regla mostrada antes, no una regla nueva. Por eso el botón se
 * deshabilita cuando no cuadra pero **el servidor igual la verifica**: si alguien
 * llega por `curl`, el RPC lo frena.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EL TOKEN DE IDEMPOTENCIA SE GENERA UNA VEZ, AL MONTAR
 * ─────────────────────────────────────────────────────────────────────────────
 * Un asiento manual no tiene documento de origen, así que el UNIQUE de la `034`
 * —parcial sobre `source_id`— no lo cubre. Sin token, un doble clic postea dos
 * asientos idénticos **y no se pueden borrar**.
 *
 * ⚠️ `useState(() => crypto.randomUUID())` con inicializador perezoso, NO
 * `useState(crypto.randomUUID())`: el segundo genera un UUID nuevo en CADA render
 * y el token dejaría de proteger nada. Se renueva a propósito después de un
 * posteo exitoso, para que el formulario limpio pueda registrar otro asiento.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NO HAY FILTRO DE CUENTAS
 * ─────────────────────────────────────────────────────────────────────────────
 * El selector ofrece las 64 cuentas activas, sin lista corta. Un ajuste va contra
 * patrimonio o contra ingreso tan seguido como contra gasto, así que acá no hay
 * "lo más probable" que valga. Ver `contabilidad/asiento-manual.ts`.
 */

export interface CuentaAsientoOption {
  code: string;
  name: string;
}

interface Props {
  cuentas: CuentaAsientoOption[];
  /** Fecha de hoy, calculada en el servidor para no depender del reloj del navegador. */
  hoy: string;
}

interface Resultado {
  entry_number: number | null;
  transaction_date: string;
  record_date: string | null;
  lineas: number;
  total: number;
}

function money(n: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function AsientoManualForm({ cuentas, hoy }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [token, setToken] = useState(() => crypto.randomUUID());
  const [fecha, setFecha] = useState(hoy);
  const [descripcion, setDescripcion] = useState("");
  const [referencia, setReferencia] = useState("");
  const [lineas, setLineas] = useState<LineaManualDraft[]>([
    lineaManualVacia("l0"),
    lineaManualVacia("l1"),
  ]);

  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [ok, setOk] = useState<Resultado | null>(null);

  const totales = useMemo(() => totalesManuales(lineas), [lineas]);

  const hayAlgo = totales.debitos > 0 || totales.creditos > 0;
  const puedeGuardar =
    hayAlgo && totales.cuadra && descripcion.trim().length >= 3 && !enviando;

  function actualizar(i: number, cambios: Partial<LineaManualDraft>) {
    const copia = [...lineas];
    const l = { ...copia[i], ...cambios };
    // Una línea es débito O crédito: al escribir en uno, el otro se limpia. Sin
    // esto es facilísimo dejar los dos cargados, y el RPC lo rechaza recién al
    // guardar con un mensaje que no dice cuál línea.
    if ("debit" in cambios && cambios.debit !== "") l.credit = "";
    if ("credit" in cambios && cambios.credit !== "") l.debit = "";
    copia[i] = l;
    setLineas(copia);
  }

  function agregar() {
    setLineas([...lineas, lineaManualVacia(`l${Date.now()}`)]);
  }

  function quitar(i: number) {
    // Nunca por debajo de dos: un asiento necesita partida doble, y dejar el
    // editor con una sola línea solo produce un rechazo del RPC más tarde.
    if (lineas.length <= 2) {
      const copia = [...lineas];
      copia[i] = lineaManualVacia(copia[i].key);
      setLineas(copia);
      return;
    }
    setLineas(lineas.filter((_, j) => j !== i));
  }

  function limpiar() {
    setFecha(hoy);
    setDescripcion("");
    setReferencia("");
    setLineas([lineaManualVacia(`l${Date.now()}`), lineaManualVacia(`l${Date.now() + 1}`)]);
    // Token NUEVO: el anterior ya quedó consumido por el asiento que se posteó.
    setToken(crypto.randomUUID());
    setError(null);
  }

  async function guardar() {
    setError(null);
    setEnviando(true);
    try {
      const res = await fetch("/api/finanzas/asientos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transaction_date: fecha,
          description: descripcion,
          reference: referencia,
          idempotency_key: token,
          lines: lineas,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "No se pudo registrar el asiento");
        return;
      }
      setOk(data as Resultado);
      startTransition(() => router.refresh());
    } catch {
      setError("Error de conexión. Revise su internet e intente de nuevo.");
    } finally {
      setEnviando(false);
    }
  }

  // ── Confirmación después de postear ──────────────────────────────────────
  if (ok) {
    return (
      <div className="space-y-4 rounded-xl border border-emerald-200 bg-emerald-50 p-5">
        <div className="flex items-center gap-2 text-emerald-800">
          <BookOpenCheck size={20} />
          <h2 className="font-semibold">
            Asiento {ok.entry_number} registrado en el libro
          </h2>
        </div>

        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-emerald-700">Fecha de la operación</dt>
            <dd className="font-medium text-emerald-900">{ok.transaction_date}</dd>
          </div>
          <div>
            {/* Las DOS fechas del Art. 13a. Se muestran juntas a propósito: es lo
                que le demuestra al contador que el sistema las guarda separadas y
                que la de registro no se puede retocar. */}
            <dt className="text-xs text-emerald-700">Fecha de registro</dt>
            <dd className="font-medium text-emerald-900">{ok.record_date ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-emerald-700">Importe</dt>
            <dd className="font-medium text-emerald-900">B/. {money(ok.total)}</dd>
          </div>
        </dl>

        <p className="text-xs text-emerald-700">
          Un asiento registrado no se puede modificar ni borrar. Para corregirlo hace falta
          un asiento de reversión.
        </p>

        <div className="flex flex-wrap gap-2">
          <Button onClick={limpiar} className="min-h-[44px] bg-integra-navy hover:bg-integra-navy/90">
            <Plus size={16} className="mr-1" />
            Registrar otro
          </Button>
          {/* nav-guard-ok: /finanzas/reportes lo ven admin, abogada y contador,
              y esta pantalla es de admin y contador. */}
          <Link
            href="/finanzas/reportes/diario"
            className="inline-flex min-h-[44px] items-center rounded-md border border-emerald-300 px-4 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
          >
            Ver el Diario General
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ── Encabezado ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="fecha" className="mb-1 block">Fecha de la operación *</Label>
          <Input
            id="fecha"
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className="min-h-[48px]"
          />
          <p className="mt-1 text-xs text-gray-400">
            Define el período contable. La fecha de registro la pone el sistema.
          </p>
        </div>

        <div>
          <Label htmlFor="referencia" className="mb-1 block">Referencia</Label>
          <Input
            id="referencia"
            value={referencia}
            onChange={(e) => setReferencia(e.target.value)}
            placeholder="Ej: MEMO-2026-014"
            maxLength={100}
            className="min-h-[48px]"
          />
          <p className="mt-1 text-xs text-gray-400">
            El documento de respaldo: recibo, memo, planilla. Opcional.
          </p>
        </div>

        <div>
          <Label htmlFor="descripcion" className="mb-1 block">Naturaleza del asiento *</Label>
          <Input
            id="descripcion"
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder="Ej: Depreciación de mobiliario — marzo"
            className="min-h-[48px]"
          />
          <p className="mt-1 text-xs text-gray-400">
            Qué operación registra. Es obligatoria (DE 34/1998, Art. 5.5).
          </p>
        </div>
      </div>

      {/* ── Líneas ─────────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-semibold text-integra-navy">Líneas *</Label>
          <span className="text-xs text-gray-400">
            {lineas.length} {lineas.length === 1 ? "línea" : "líneas"}
          </span>
        </div>

        {lineas.map((l, i) => (
          <div key={l.key} className="rounded-lg border border-gray-200 bg-gray-50/50 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-500">Línea {i + 1}</span>
              <button
                type="button"
                onClick={() => quitar(i)}
                aria-label={`Quitar línea ${i + 1}`}
                className="flex h-8 w-8 items-center justify-center rounded text-gray-400 hover:bg-red-50 hover:text-red-600"
              >
                <Trash2 size={15} />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
              <div className="sm:col-span-4">
                <Label className="mb-1 block text-xs">Cuenta</Label>
                <select
                  value={l.account_code}
                  onChange={(e) => actualizar(i, { account_code: e.target.value })}
                  className="block w-full rounded-md border border-gray-300 bg-white px-2 min-h-[44px] text-sm focus:border-integra-navy focus:outline-none"
                >
                  <option value="">— Elegir cuenta —</option>
                  {cuentas.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} · {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-4">
                <Label className="mb-1 block text-xs">Descripción de la línea</Label>
                <Input
                  value={l.description}
                  onChange={(e) => actualizar(i, { description: e.target.value })}
                  placeholder="Opcional"
                  className="min-h-[44px]"
                />
              </div>

              <div className="sm:col-span-2">
                <Label className="mb-1 block text-xs">Débito</Label>
                <NumberInput
                  min="0"
                  step="0.01"
                  value={l.debit}
                  onChange={(e) => actualizar(i, { debit: e.target.value })}
                  placeholder="0.00"
                  className="min-h-[44px]"
                />
              </div>

              <div className="sm:col-span-2">
                <Label className="mb-1 block text-xs">Crédito</Label>
                <NumberInput
                  min="0"
                  step="0.01"
                  value={l.credit}
                  onChange={(e) => actualizar(i, { credit: e.target.value })}
                  placeholder="0.00"
                  className="min-h-[44px]"
                />
              </div>
            </div>
          </div>
        ))}

        <Button type="button" onClick={agregar} variant="ghost" className="min-h-[44px] text-integra-navy">
          <Plus size={16} className="mr-1" />
          Agregar línea
        </Button>
      </div>

      {/* ── El totalizador. Lo que el contador mira mientras carga. ────── */}
      <div
        className={
          "rounded-xl border p-4 " +
          (!hayAlgo
            ? "border-gray-200 bg-gray-50"
            : totales.cuadra
              ? "border-emerald-200 bg-emerald-50"
              : "border-amber-200 bg-amber-50")
        }
      >
        <dl className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <dt className="text-xs text-gray-600">Débitos</dt>
            <dd className="tabular-nums font-semibold text-gray-900">{money(totales.debitos)}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-600">Créditos</dt>
            <dd className="tabular-nums font-semibold text-gray-900">{money(totales.creditos)}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-600">Diferencia</dt>
            <dd
              className={
                "tabular-nums font-semibold " +
                (totales.cuadra ? "text-emerald-700" : "text-amber-800")
              }
            >
              {money(totales.diferencia)}
            </dd>
          </div>
        </dl>
        {hayAlgo && !totales.cuadra && (
          <p className="mt-2 text-xs text-amber-800">
            El asiento no cuadra todavía. Los débitos y los créditos tienen que dar lo mismo.
          </p>
        )}
      </div>

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={guardar}
          disabled={!puedeGuardar}
          className="min-h-[48px] bg-integra-navy hover:bg-integra-navy/90"
        >
          {enviando || isPending ? (
            <Loader2 size={16} className="mr-1.5 animate-spin" />
          ) : (
            <BookOpenCheck size={16} className="mr-1.5" />
          )}
          Registrar en el libro
        </Button>
        <p className="text-xs text-gray-500">
          Un asiento registrado <strong className="font-semibold">no se puede modificar ni
          borrar</strong>. Corregirlo requiere un asiento de reversión.
        </p>
      </div>
    </div>
  );
}
