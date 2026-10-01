"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, FileMinus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { CampoFechaDeRegistro } from "@/components/finanzas/campo-fecha-de-registro";
import { ExpenseLinesEditor, type CuentaOption } from "@/components/finanzas/expense-lines-editor";
import { fmtImporte } from "@/lib/utils/importe";
import { hoyEnPanama } from "@/lib/utils/hoy-en-panama";
import { lineaVacia } from "@/lib/finanzas/validators/expense-line";
import type { ExpenseLineDraft } from "@/lib/finanzas/types/expense-line";
import type { TaxCodeOption } from "@/lib/finanzas/types/invoice";
import {
  calcularNcDeCompra,
  disponibleEnLinea,
  type LineaPedida,
  type TasaParaNcDeCompra,
} from "@/lib/finanzas/contabilidad/asiento-nota-credito-compra";
import type { CompraAbiertaParaNc } from "@/lib/finanzas/queries/notas-credito";

export interface ProveedorParaNc {
  id: string;
  nombre: string;
}

/**
 * LA NOTA DE CRÉDITO DE COMPRA COMO MÓDULO PROPIO (E8, 01/10/2026).
 *
 * Se elige el proveedor; la compra es OPCIONAL. Al elegirla se cargan sus
 * líneas (lo que queda por acreditar) y todo queda editable con el MISMO editor
 * de líneas que la compra (`ExpenseLinesEditor`): cuenta, descripción, base,
 * gravada o exenta y el ITBMS. Sin compra, la NC queda como saldo a favor con
 * el proveedor y se aplica después desde su detalle.
 *
 * 🔒 La vista previa usa `calcularNcDeCompra`, la MISMA función que el
 *    servidor; y la base recalcula y verifica el asiento.
 */
export function NcDeProveedorForm({
  proveedores,
  compras,
  compraInicial,
  cuentas,
  taxCodes,
  tasas,
  cuentasValidas,
}: {
  proveedores: ProveedorParaNc[];
  compras: CompraAbiertaParaNc[];
  compraInicial: string | null;
  cuentas: CuentaOption[];
  taxCodes: TaxCodeOption[];
  /** El catálogo de tasas con su cuenta (073), por id. */
  tasas: [string, TasaParaNcDeCompra][];
  cuentasValidas: string[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const hoy = hoyEnPanama();

  const inicial = compras.find((c) => c.id === compraInicial) ?? null;
  const [proveedorId, setProveedorId] = useState<string>(inicial?.supplier_id ?? "");
  const [compraId, setCompraId] = useState<string | null>(inicial?.id ?? null);
  const [{ lineas, origen }, setEditor] = useState(() => (inicial ? desdeLaCompra(inicial) : vacio(taxCodes)));
  const [doc, setDoc] = useState("");
  const [docFecha, setDocFecha] = useState(hoy);
  const [fechaRegistro, setFechaRegistro] = useState(hoy);
  const [cufe, setCufe] = useState("");
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmandoSinCompra, setConfirmandoSinCompra] = useState(false);

  const compra = compras.find((c) => c.id === compraId) ?? null;
  const comprasDelProveedor = compras.filter((c) => c.supplier_id === proveedorId);
  const catalogos = useMemo(
    () => ({ tasas: new Map(tasas), cuentasValidas: new Set(cuentasValidas) }),
    [tasas, cuentasValidas]
  );

  const pedido: LineaPedida[] = lineas
    .filter((l) => Number(l.amount) > 0)
    .map((l) => ({
      expense_line_id: origen[l.key] ?? null,
      amount: Number(l.amount),
      chart_account_code: l.chart_account_code,
      description: l.description,
      tax_code_id: l.tax_code_id || null,
      tax_amount: l.tax_amount === "" ? null : Number(l.tax_amount),
    }));
  const calculo = useMemo(
    () => calcularNcDeCompra(compra?.lineas ?? [], pedido, compra ? compra.balance_due : null, catalogos),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [compra, lineas, catalogos]
  );
  const faltaDato = !proveedorId || doc.trim().length === 0 || motivo.trim().length < 3 || !docFecha || !fechaRegistro;

  function elegirProveedor(id: string) {
    setProveedorId(id);
    if (compra && compra.supplier_id !== id) {
      setCompraId(null);
      setEditor(vacio(taxCodes));
    }
  }

  function elegirCompra(id: string) {
    const c = compras.find((x) => x.id === id) ?? null;
    setCompraId(c?.id ?? null);
    setEditor(c ? desdeLaCompra(c) : vacio(taxCodes));
  }

  function enviar() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/finanzas/supplier-credit-notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            business_expense_id: compra?.id ?? null,
            supplier_id: proveedorId,
            supplier_document_number: doc,
            supplier_document_date: docFecha,
            fecha_registro: fechaRegistro,
            supplier_cufe: cufe || null,
            reason: motivo,
            lineas: pedido,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const campos = data.fieldErrors ? Object.values(data.fieldErrors).join(" ") : "";
          setError([data.error, campos].filter(Boolean).join(" ") || "No se pudo registrar la nota de crédito.");
          return;
        }
        router.push(`/finanzas/notas-credito-proveedor/${data.id}?registrada=1`);
        router.refresh();
      } catch {
        setError("Error de red. Intenta de nuevo.");
      }
    });
  }

  function onSubmit() {
    if (!compra && !confirmandoSinCompra) {
      setConfirmandoSinCompra(true);
      return;
    }
    setConfirmandoSinCompra(false);
    enviar();
  }

  const selectClass =
    "block w-full rounded-md border border-gray-300 bg-white px-3 min-h-[44px] text-sm hover:border-integra-navy focus:border-integra-navy focus:outline-none";

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
      <form
        className="space-y-5"
        onSubmit={(ev) => {
          ev.preventDefault();
          onSubmit();
        }}
      >
        <section className="space-y-4 rounded-xl border bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-integra-navy">Datos de la nota de crédito del proveedor</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="ncp_proveedor" className="mb-1 block">Proveedor *</Label>
              <select
                id="ncp_proveedor"
                value={proveedorId}
                onChange={(ev) => elegirProveedor(ev.target.value)}
                disabled={isPending}
                className={selectClass}
              >
                <option value="">Elige el proveedor</option>
                {proveedores.map((p) => (
                  <option key={p.id} value={p.id}>{p.nombre}</option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="ncp_compra" className="mb-1 block">Compra que corrige (opcional)</Label>
              <select
                id="ncp_compra"
                value={compraId ?? ""}
                onChange={(ev) => (ev.target.value ? elegirCompra(ev.target.value) : (setCompraId(null), setEditor(vacio(taxCodes))))}
                disabled={isPending || !proveedorId}
                className={selectClass}
              >
                <option value="">
                  {!proveedorId
                    ? "Elige primero el proveedor"
                    : comprasDelProveedor.length === 0
                      ? "Este proveedor no tiene compras con saldo: la nota queda como saldo a favor"
                      : "Sin compra (queda como saldo a favor con el proveedor)"}
                </option>
                {comprasDelProveedor.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.numero ? `${c.numero} · ` : ""}{c.description} · saldo B/. {fmtImporte(c.balance_due)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="ncp_doc" className="mb-1 block">Número del documento del proveedor *</Label>
              <Input id="ncp_doc" value={doc} onChange={(ev) => setDoc(ev.target.value)} maxLength={100} placeholder="Ej: NC-0045" disabled={isPending} />
            </div>
            <div>
              <Label htmlFor="ncp_doc_fecha" className="mb-1 block">Fecha del documento *</Label>
              <Input id="ncp_doc_fecha" type="date" value={docFecha} onChange={(ev) => setDocFecha(ev.target.value)} disabled={isPending} />
            </div>
            <div className="sm:col-span-2">
              <CampoFechaDeRegistro
                id="ncp_fecha_registro"
                value={fechaRegistro}
                onChange={setFechaRegistro}
                disabled={isPending}
                ayuda="Es la fecha contable: define el mes del asiento y del resumen de ITBMS. La del documento del proveedor queda como referencia."
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="ncp_cufe" className="mb-1 block">CUFE (opcional, si el proveedor emitió factura electrónica)</Label>
              <Input id="ncp_cufe" value={cufe} onChange={(ev) => setCufe(ev.target.value)} className="font-mono text-xs" disabled={isPending} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="ncp_motivo" className="mb-1 block">Motivo *</Label>
              <textarea
                id="ncp_motivo"
                value={motivo}
                onChange={(ev) => setMotivo(ev.target.value)}
                rows={2}
                maxLength={1000}
                disabled={isPending}
                placeholder="Ej: descuento por servicio incompleto, devolución de mercancía"
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-integra-navy focus:outline-none"
              />
            </div>
          </div>
        </section>

        <section className="space-y-3 rounded-xl border bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-integra-navy">Líneas de la nota de crédito</h2>
          {compra && (
            <p className="text-xs text-gray-600">
              Se cargaron las líneas de la compra con lo que queda por acreditar de cada una. Cambia los montos, borra
              las que no se acreditan o agrega otras.
            </p>
          )}
          <ExpenseLinesEditor
            lineas={lineas}
            onChange={(nuevas) => setEditor({ lineas: nuevas, origen })}
            cuentas={cuentas}
            cuentaPorDefecto=""
            taxCodes={taxCodes}
            impuestoPorDefecto="ITBMS_7"
            disabled={isPending}
          />
        </section>

        {confirmandoSinCompra && (
          <div role="alertdialog" className="flex flex-wrap items-center justify-between gap-3 rounded-md border-l-4 border-amber-500 bg-amber-50 p-4 text-sm text-amber-900">
            <span>No estás asociando esta nota a una factura. ¿Deseas continuar?</span>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setConfirmandoSinCompra(false)}>
                No, elegir una compra
              </Button>
              <Button type="button" onClick={enviar} className="bg-integra-navy text-white">
                Sí, continuar
              </Button>
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center justify-end gap-3 border-t bg-gray-50 px-1 py-3">
          <Button type="button" variant="outline" onClick={() => router.back()} disabled={isPending} className="min-h-[48px]">
            Cancelar
          </Button>
          <Button
            type="submit"
            disabled={isPending || faltaDato || !calculo.ok}
            className="min-h-[48px] bg-integra-navy text-white hover:bg-integra-navy/90"
          >
            {isPending ? <Loader2 size={16} className="mr-2 animate-spin" /> : <FileMinus size={16} className="mr-2" />}
            {isPending ? "Registrando…" : "Registrar nota de crédito"}
          </Button>
        </div>
      </form>

      <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
        <div className={`rounded-lg border bg-white p-4 ${calculo.ok || pedido.length === 0 ? "" : "border-red-200"}`}>
          {calculo.ok ? (
            <div className="space-y-1 font-mono text-sm">
              <p className="flex justify-between"><span>Base</span><span>B/. {fmtImporte(calculo.subtotal)}</span></p>
              <p className="flex justify-between"><span>Impuesto</span><span>B/. {fmtImporte(calculo.itbms)}</span></p>
              <p className="flex justify-between text-lg font-bold text-integra-navy"><span>Total</span><span>B/. {fmtImporte(calculo.total)}</span></p>
            </div>
          ) : pedido.length > 0 ? (
            <p role="alert" className="text-sm text-red-700">{calculo.mensaje}</p>
          ) : (
            <p className="text-sm text-gray-500">Escribe el monto de al menos una línea.</p>
          )}
          {compra && (
            <p className="mt-2 text-xs text-gray-600">
              Lo que falta pagar de la compra: <span className="font-mono">B/. {fmtImporte(compra.balance_due)}</span>. Es el
              máximo que se le puede acreditar.
            </p>
          )}
        </div>
        <div className="rounded-lg border bg-white p-4 text-xs text-gray-500">
          <p className="mb-1 font-semibold text-gray-700">Sobre la nota de crédito del proveedor</p>
          <p>
            Se numera <span className="font-mono">NC-CO-</span> y entra al libro en una sola transacción: baja Cuentas por
            pagar con el proveedor, la cuenta de cada línea y el impuesto de compras de ese mes.
          </p>
        </div>
      </aside>
    </div>
  );
}

/** El editor vacío, con una línea en blanco. */
function vacio(taxCodes: TaxCodeOption[]): { lineas: ExpenseLineDraft[]; origen: Record<string, string> } {
  const itbms = taxCodes.find((t) => t.code === "ITBMS_7") ?? null;
  return { lineas: [lineaVacia("ncp-0", "", itbms ? { id: itbms.id, rate: itbms.rate } : null)], origen: {} };
}

/**
 * Las líneas de la compra como valor INICIAL: lo que queda por acreditar de
 * cada una, con el ITBMS que le queda. `origen` recuerda de qué línea de la
 * compra salió cada fila del editor.
 */
function desdeLaCompra(c: CompraAbiertaParaNc): { lineas: ExpenseLineDraft[]; origen: Record<string, string> } {
  const origen: Record<string, string> = {};
  const lineas = c.lineas
    .filter((l) => disponibleEnLinea(l) > 0.0001)
    .map((l) => {
      const key = `ncp-${l.id}`;
      origen[key] = l.id;
      return {
        key,
        description: l.description,
        chart_account_code: l.chart_account_code ?? "",
        amount: disponibleEnLinea(l).toFixed(2),
        tax_code_id: l.tax_code_id ?? "",
        tax_rate: String(l.tax_rate),
        tax_amount: (Math.round((l.tax_amount - l.acreditado_itbms) * 100) / 100).toFixed(2),
      };
    });
  return { lineas, origen };
}
