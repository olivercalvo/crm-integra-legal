"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BookCheck, Download, FileSearch, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmationModal } from "@/components/ui/confirmation-modal";
import type { CuadreAlCorte } from "@/lib/finanzas/contabilidad/apertura";
import { MENSAJE_POSTEO_HISTORICO_APAGADO } from "@/lib/finanzas/posteo-historico-mensaje";
import { FORMATO_DE_FECHA_POR_DEFECTO, type FormatoDeFecha } from "@/lib/finanzas/import/asientos-import";

const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fechaCorta = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`;

interface VistaPrevia {
  hash: string;
  fecha: string;
  errores: { fila: number; columna: string; mensaje: string }[];
  lineas: number;
  totalDebitos: number;
  totalCreditos: number;
  porCuenta: { cuenta: string; nombre: string; debito: number; credito: number }[];
  cuadre: CuadreAlCorte;
  bloqueos: string[];
}

/**
 * Sin apertura vigente: bajar la plantilla (precargada o vacía), subirla,
 * revisarla EN SECO y contabilizarla. Lo aprieta una persona.
 */
export function AperturaPanel({ fecha, mesAbierto, habilitado }: { fecha: string; mesAbierto: boolean; habilitado: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [vista, setVista] = useState<VistaPrevia | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  // Como en la importación de asientos: cómo leer una fecha escrita como texto.
  // Contabilizar manda el MISMO formato que se revisó en seco.
  const [formato, setFormato] = useState<FormatoDeFecha>(FORMATO_DE_FECHA_POR_DEFECTO);
  const [isPending, startTransition] = useTransition();

  function enviar(mode: "preview" | "commit") {
    if (!archivo) return;
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.append("file", archivo);
      fd.append("mode", mode);
      fd.append("date_format", formato);
      if (mode === "commit" && vista) fd.append("hash", vista.hash);
      try {
        const res = await fetch("/api/finanzas/asientos/apertura", { method: "POST", body: fd });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error ?? "No se pudo procesar el archivo.");
          return;
        }
        if (mode === "preview") {
          setVista(data as VistaPrevia);
        } else {
          setConfirmar(false);
          setOk(`Apertura registrada: ${data.reference} al ${fechaCorta(data.fecha)}, por ${money(Number(data.total_debitos))}.`);
          router.refresh();
        }
      } catch {
        setError("Error de red. Intenta de nuevo.");
      }
    });
  }

  const puede = vista && vista.errores.length === 0 && vista.bloqueos.length === 0;

  return (
    <section className="space-y-4 rounded-xl border bg-white p-5 shadow-sm text-sm">
      <h2 className="text-base font-semibold text-integra-navy">Cargar la apertura al {fechaCorta(fecha)}</h2>
      {!mesAbierto && (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-red-800">
          El mes de la apertura ({fechaCorta(fecha).slice(3)}) está cerrado: se reabre en Períodos contables antes de cargarla.
        </p>
      )}
      <div className="space-y-2">
        <p className="font-semibold">1. Bajar la plantilla</p>
        <div className="flex flex-wrap gap-2">
          <a href="/api/finanzas/asientos/apertura/plantilla" className="inline-flex min-h-[48px] items-center gap-2 rounded-md border border-gray-300 bg-white px-4 font-semibold text-integra-navy hover:border-integra-navy">
            <Download size={16} /> Plantilla con lo que conoce el CRM
          </a>
          <a href="/api/finanzas/asientos/apertura/plantilla?vacia=1" className="inline-flex min-h-[48px] items-center gap-2 rounded-md border border-gray-300 bg-white px-4 font-semibold text-integra-navy hover:border-integra-navy">
            <Download size={16} /> Plantilla vacía
          </a>
        </div>
        <p className="text-xs text-gray-500">
          La precargada trae sólo los documentos del CRM con saldo al corte (en producción, hoy, una factura real anterior
          al inicio). Los saldos de verdad salen de QuickBooks.
        </p>
      </div>

      <div className="space-y-2">
        <p className="font-semibold">2. Subir el archivo y revisarlo en seco</p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={input}
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => { setArchivo(e.target.files?.[0] ?? null); setVista(null); setOk(null); }}
            className="min-h-[44px] text-sm"
            aria-label="Archivo de la apertura"
          />
          <label className="inline-flex min-h-[48px] items-center gap-2 text-sm text-gray-700">
            Formato de fecha del archivo
            <select
              value={formato}
              onChange={(e) => { setFormato(e.target.value as FormatoDeFecha); setVista(null); setOk(null); }}
              className="min-h-[44px] rounded-md border border-gray-300 bg-white px-2 text-sm"
            >
              <option value="MM/DD">MM/DD/AAAA (mes primero)</option>
              <option value="DD/MM">DD/MM/AAAA (día primero)</option>
            </select>
          </label>
          <Button type="button" variant="outline" className="min-h-[48px] gap-2" disabled={!archivo || isPending} onClick={() => enviar("preview")}>
            {isPending ? <Loader2 size={16} className="animate-spin" /> : <FileSearch size={16} />} Revisar en seco
          </Button>
        </div>
        <p className="text-xs text-gray-500">
          Revisar no registra nada. El formato sólo cuenta para las fechas escritas como texto; una celda con formato de
          fecha de Excel (como las de la plantilla) se lee igual con los dos.
        </p>
      </div>

      {error && <p className="text-red-700" role="alert">{error}</p>}
      {ok && <p className="text-emerald-700" role="status">{ok}</p>}

      {vista && (
        <div className="space-y-3 border-t pt-3">
          <p>
            <strong>{vista.lineas}</strong> línea(s) · débitos <span className="font-mono">{money(vista.totalDebitos)}</span> ·
            créditos <span className="font-mono">{money(vista.totalCreditos)}</span>
          </p>
          {vista.errores.length > 0 ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-red-800">
              <p className="font-semibold">{vista.errores.length} error(es): no se puede registrar hasta corregirlos.</p>
              <ul className="list-disc pl-5">
                {vista.errores.map((e, i) => <li key={i}>Fila {e.fila}, {e.columna}: {e.mensaje}</li>)}
              </ul>
            </div>
          ) : (
            <p className="text-emerald-700">Sin errores: la apertura cuadra.</p>
          )}
          {vista.bloqueos.map((b) => <p key={b} className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900">{b}</p>)}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-left">
              <thead className="border-b text-xs text-gray-500">
                <tr><th className="py-1">Cuenta</th><th className="py-1 text-right">Débito</th><th className="py-1 text-right">Crédito</th></tr>
              </thead>
              <tbody className="divide-y">
                {vista.porCuenta.map((c) => (
                  <tr key={c.cuenta}>
                    <td className="py-1">{c.cuenta} {c.nombre}</td>
                    <td className="py-1 text-right font-mono">{c.debito ? money(c.debito) : ""}</td>
                    <td className="py-1 text-right font-mono">{c.credito ? money(c.credito) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-gray-600">
            Cuadre al corte con este archivo: clientes {money(vista.cuadre.totales.cliente.segunApertura)} contra{" "}
            {money(vista.cuadre.totales.cliente.segunCrm)} en el CRM; proveedores {money(vista.cuadre.totales.proveedor.segunApertura)} contra{" "}
            {money(vista.cuadre.totales.proveedor.segunCrm)}. {vista.cuadre.filas.filter((f) => f.estado !== "cuadra").length} tercero(s) con diferencia.
          </p>
          <Button type="button" className="min-h-[48px] gap-2" disabled={!habilitado || !puede || isPending} onClick={() => setConfirmar(true)}>
            <BookCheck size={16} /> 3. Contabilizar la apertura
          </Button>
          {!habilitado && <p className="text-sm font-semibold text-amber-800">{MENSAJE_POSTEO_HISTORICO_APAGADO}</p>}
        </div>
      )}

      <ConfirmationModal
        open={confirmar}
        onClose={() => !isPending && setConfirmar(false)}
        onConfirm={() => enviar("commit")}
        loading={isPending}
        title="Contabilizar la apertura"
        confirmButtonText={isPending ? "Registrando…" : "Sí, registrar"}
      >
        <p className="text-sm">
          Se registra un asiento de apertura al {fechaCorta(fecha)} por {vista ? money(vista.totalDebitos) : ""}. No se borra:
          si después hay que corregirla, se reversa con la misma fecha mientras el mes siga abierto.
        </p>
      </ConfirmationModal>
    </section>
  );
}
