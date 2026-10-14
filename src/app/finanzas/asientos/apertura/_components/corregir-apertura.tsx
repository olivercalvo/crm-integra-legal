"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { BookCheck, FileSearch, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmationModal } from "@/components/ui/confirmation-modal";
import type { CuadreAlCorte, FilaEditableDeApertura } from "@/lib/finanzas/contabilidad/apertura";
import { MENSAJE_POSTEO_HISTORICO_APAGADO } from "@/lib/finanzas/posteo-historico-mensaje";

const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fechaCorta = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`;
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface CuentaParaCorregir {
  code: string;
  name: string;
  cuenta_control: "clientes" | "proveedores" | null;
}
export interface TerceroParaCorregir {
  codigo: string;
  nombre: string;
}

/** Una fila en pantalla: los montos como texto mientras se escriben. */
interface Fila {
  key: number;
  cuenta: string;
  tercero: string;
  documento: string;
  fecha: string;
  vencimiento: string;
  debito: string;
  credito: string;
}

interface VistaPrevia {
  hash: string;
  errores: { fila: number; columna: string; mensaje: string }[];
  lineas: number;
  totalDebitos: number;
  totalCreditos: number;
  cambios: { cuenta: string; nombre: string; antes: number; despues: number }[];
  cuadre: CuadreAlCorte;
  bloqueos: string[];
}

/** «1,250.50» → 1250.5; vacío → 0; lo que no es un monto válido → NaN. */
function monto(texto: string): number {
  const s = texto.trim().replace(/,/g, "");
  if (s === "") return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return Number.NaN;
  return Number(s);
}

const montoEnTexto = (n: number) => (n ? String(r2(n)) : "");

/**
 * «Corregir la apertura» (102): las líneas de la apertura vigente en una tabla
 * editable. «Revisar» la valida con las MISMAS reglas del Excel; «Guardar»
 * reversa la vigente y registra la corregida en una sola transacción, con
 * motivo. Lo aprieta una persona (admin o contador).
 */
export function CorregirApertura({
  aperturaId,
  fecha,
  referencia,
  habilitado,
  filasIniciales,
  cuentas,
  clientes,
  proveedores,
  children,
}: {
  aperturaId: string;
  fecha: string;
  referencia: string;
  habilitado: boolean;
  filasIniciales: FilaEditableDeApertura[];
  cuentas: CuentaParaCorregir[];
  clientes: TerceroParaCorregir[];
  proveedores: TerceroParaCorregir[];
  /** El botón de «Reversar la apertura», al lado del de corregir. */
  children?: ReactNode;
}) {
  const router = useRouter();
  const inicial = (): Fila[] =>
    filasIniciales.map((f, i) => ({
      key: i + 1, cuenta: f.cuenta, tercero: f.tercero, documento: f.documento, fecha: f.fecha,
      vencimiento: f.vencimiento, debito: montoEnTexto(f.debito), credito: montoEnTexto(f.credito),
    }));
  const [abierto, setAbierto] = useState(false);
  const [filas, setFilas] = useState<Fila[]>(inicial);
  const [siguiente, setSiguiente] = useState(filasIniciales.length + 1);
  const [vista, setVista] = useState<VistaPrevia | null>(null);
  const [motivo, setMotivo] = useState("");
  const [confirmar, setConfirmar] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const porCodigo = useMemo(() => new Map(cuentas.map((c) => [c.code, c])), [cuentas]);

  const totales = useMemo(() => {
    let d = 0, c = 0, malos = 0;
    for (const f of filas) {
      const x = monto(f.debito), y = monto(f.credito);
      if (Number.isNaN(x) || Number.isNaN(y)) { malos++; continue; }
      d += x; c += y;
    }
    return { debitos: r2(d), creditos: r2(c), diferencia: r2(d - c), malos };
  }, [filas]);

  const erroresPorLinea = useMemo(() => {
    const m = new Map<number, string[]>();
    for (const e of vista?.errores ?? []) {
      if (e.fila <= 0) continue;
      m.set(e.fila, [...(m.get(e.fila) ?? []), `${e.columna}: ${e.mensaje}`]);
    }
    return m;
  }, [vista]);
  const erroresGenerales = (vista?.errores ?? []).filter((e) => e.fila <= 0);

  function cambiar(key: number, campo: keyof Omit<Fila, "key">, valor: string) {
    setFilas((fs) => fs.map((f) => {
      if (f.key !== key) return f;
      const nueva = { ...f, [campo]: valor };
      // Cambiar a una cuenta control de otro lado deja el tercero vacío para elegir de nuevo.
      if (campo === "cuenta") {
        const antes = porCodigo.get(f.cuenta)?.cuenta_control ?? null;
        const despues = porCodigo.get(valor)?.cuenta_control ?? null;
        if (despues && antes !== despues) nueva.tercero = "";
      }
      return nueva;
    }));
    setVista(null);
    setOk(null);
  }

  function agregar() {
    setFilas((fs) => [...fs, { key: siguiente, cuenta: "", tercero: "", documento: "", fecha: "", vencimiento: "", debito: "", credito: "" }]);
    setSiguiente((n) => n + 1);
    setVista(null);
  }

  function quitar(key: number) {
    setFilas((fs) => fs.filter((f) => f.key !== key));
    setVista(null);
  }

  function cancelar() {
    setFilas(inicial());
    setVista(null);
    setMotivo("");
    setError(null);
    setAbierto(false);
  }

  function paraEnviar(): FilaEditableDeApertura[] {
    return filas.map((f) => ({
      cuenta: f.cuenta, tercero: f.tercero, documento: f.documento.trim(), fecha: f.fecha, vencimiento: f.vencimiento,
      debito: monto(f.debito) || 0, credito: monto(f.credito) || 0,
    }));
  }

  function enviar(mode: "preview" | "commit") {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/finanzas/asientos/apertura/corregir", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode, aperturaId, filas: paraEnviar(), motivo, hash: vista?.hash }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error ?? "No se pudo procesar la corrección.");
          setConfirmar(false);
          return;
        }
        if (mode === "preview") {
          setVista(data as VistaPrevia);
        } else {
          setConfirmar(false);
          setAbierto(false);
          setVista(null);
          setMotivo("");
          setOk(`Apertura corregida: ${data.reference} (versión ${data.version}) al ${fechaCorta(data.fecha)}, por ` +
            `${money(Number(data.total_debitos))}. La anterior quedó reversada con el asiento ${data.reversion_entry_number}.`);
          router.refresh();
        }
      } catch {
        setError("Error de red. Intenta de nuevo.");
      }
    });
  }

  const puedeGuardar = !!vista && vista.errores.length === 0 && vista.bloqueos.length === 0 && motivo.trim().length >= 3;
  const inputCls = "min-h-[40px] w-full rounded-md border border-gray-300 bg-white px-2 text-sm";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start gap-2">
        {!abierto && (
          <Button type="button" className="min-h-[48px] gap-2" onClick={() => { setAbierto(true); setOk(null); }}>
            <Pencil size={16} /> Corregir la apertura
          </Button>
        )}
        {children}
      </div>
      {ok && <p className="text-emerald-700" role="status">{ok}</p>}

      {abierto && (
        <div className="space-y-3 rounded-lg border border-integra-gold/50 bg-amber-50/30 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="font-semibold text-integra-navy">Corregir {referencia} al {fechaCorta(fecha)}</h3>
              <p className="max-w-3xl text-xs text-gray-600">
                Cambia montos, cuentas y terceros, agrega o quita líneas. Al guardar no se edita el libro: se reversa la
                apertura vigente con su misma fecha y se registra la corregida, las dos en un solo paso. Las cuentas por
                cobrar (100004) y por pagar (200001) llevan el tercero, el documento y su fecha.
              </p>
            </div>
            <Button type="button" variant="outline" className="min-h-[44px] gap-2" onClick={cancelar} disabled={isPending}>
              <X size={16} /> Cancelar
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-left text-sm">
              <thead className="border-b text-xs text-gray-500">
                <tr>
                  <th className="w-10 py-2">#</th>
                  <th className="py-2">Cuenta</th>
                  <th className="py-2">Tercero</th>
                  <th className="py-2">Documento externo</th>
                  <th className="py-2">Fecha del documento</th>
                  <th className="py-2">Vencimiento</th>
                  <th className="py-2 text-right">Débito</th>
                  <th className="py-2 text-right">Crédito</th>
                  <th className="w-12 py-2"><span className="sr-only">Quitar</span></th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f, i) => {
                  const control = porCodigo.get(f.cuenta)?.cuenta_control ?? null;
                  const opciones = control === "clientes" ? clientes : control === "proveedores" ? proveedores : [...clientes, ...proveedores];
                  const errs = erroresPorLinea.get(i + 1);
                  const malDebito = Number.isNaN(monto(f.debito));
                  const malCredito = Number.isNaN(monto(f.credito));
                  return (
                    <FilaConErrores key={f.key} errores={errs}>
                      <td className="py-1 pr-1 align-top text-xs text-gray-500">{i + 1}</td>
                      <td className="py-1 pr-1 align-top">
                        <select aria-label={`Cuenta de la línea ${i + 1}`} value={f.cuenta} onChange={(e) => cambiar(f.key, "cuenta", e.target.value)} className={`${inputCls} min-w-[210px]`}>
                          <option value="">Elegir cuenta…</option>
                          {!porCodigo.has(f.cuenta) && f.cuenta && <option value={f.cuenta}>{f.cuenta} (inactiva o inexistente)</option>}
                          {cuentas.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
                        </select>
                      </td>
                      <td className="py-1 pr-1 align-top">
                        <select aria-label={`Tercero de la línea ${i + 1}`} value={f.tercero} onChange={(e) => cambiar(f.key, "tercero", e.target.value)} className={`${inputCls} min-w-[190px]`}>
                          <option value="">{control ? (control === "clientes" ? "Elegir cliente…" : "Elegir proveedor…") : "Sin tercero"}</option>
                          {f.tercero && !opciones.some((o) => o.codigo === f.tercero) && <option value={f.tercero}>{f.tercero}</option>}
                          {opciones.map((o) => <option key={o.codigo} value={o.codigo}>{o.codigo} · {o.nombre}</option>)}
                        </select>
                      </td>
                      <td className="py-1 pr-1 align-top">
                        <input aria-label={`Documento externo de la línea ${i + 1}`} value={f.documento} maxLength={200} onChange={(e) => cambiar(f.key, "documento", e.target.value)} className={`${inputCls} min-w-[120px]`} />
                      </td>
                      <td className="py-1 pr-1 align-top">
                        <input type="date" aria-label={`Fecha del documento de la línea ${i + 1}`} value={f.fecha} max={fecha} onChange={(e) => cambiar(f.key, "fecha", e.target.value)} className={inputCls} />
                      </td>
                      <td className="py-1 pr-1 align-top">
                        <input type="date" aria-label={`Vencimiento de la línea ${i + 1}`} value={f.vencimiento} onChange={(e) => cambiar(f.key, "vencimiento", e.target.value)} className={inputCls} />
                      </td>
                      <td className="py-1 pr-1 align-top">
                        <input inputMode="decimal" aria-label={`Débito de la línea ${i + 1}`} value={f.debito} onChange={(e) => cambiar(f.key, "debito", e.target.value)}
                          className={`${inputCls} min-w-[110px] text-right font-mono ${malDebito ? "border-red-500" : ""}`} />
                      </td>
                      <td className="py-1 pr-1 align-top">
                        <input inputMode="decimal" aria-label={`Crédito de la línea ${i + 1}`} value={f.credito} onChange={(e) => cambiar(f.key, "credito", e.target.value)}
                          className={`${inputCls} min-w-[110px] text-right font-mono ${malCredito ? "border-red-500" : ""}`} />
                      </td>
                      <td className="py-1 align-top">
                        <button type="button" onClick={() => quitar(f.key)} aria-label={`Quitar la línea ${i + 1}`} title="Quitar la línea"
                          className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-md text-red-700 hover:bg-red-50">
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </FilaConErrores>
                  );
                })}
              </tbody>
              <tfoot className="border-t text-sm font-semibold">
                <tr>
                  <td colSpan={6} className="py-2 text-right">
                    Totales {Math.abs(totales.diferencia) >= 0.005
                      ? <span className="text-red-700">(diferencia {money(totales.diferencia)})</span>
                      : <span className="text-emerald-700">(cuadra)</span>}
                  </td>
                  <td className="py-2 pr-3 text-right font-mono">{money(totales.debitos)}</td>
                  <td className="py-2 pr-3 text-right font-mono">{money(totales.creditos)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          {totales.malos > 0 && (
            <p className="text-sm text-red-700">Hay montos que no son válidos (en rojo): números positivos con hasta dos decimales.</p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="min-h-[48px] gap-2" onClick={agregar} disabled={isPending}>
              <Plus size={16} /> Agregar línea
            </Button>
            <Button type="button" variant="outline" className="min-h-[48px] gap-2" onClick={() => enviar("preview")} disabled={isPending || totales.malos > 0 || filas.length === 0}>
              {isPending && !confirmar ? <Loader2 size={16} className="animate-spin" /> : <FileSearch size={16} />} Revisar
            </Button>
          </div>
          <p className="text-xs text-gray-500">«Revisar» no registra nada: aplica las mismas reglas que la carga por Excel.</p>

          {error && <p className="text-red-700" role="alert">{error}</p>}

          {vista && (
            <div className="space-y-3 border-t pt-3">
              {vista.errores.length > 0 ? (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-red-800">
                  <p className="font-semibold">{vista.errores.length} error(es): no se puede guardar hasta corregirlos.</p>
                  {erroresGenerales.map((e, i) => <p key={i}>{e.mensaje}</p>)}
                  {erroresPorLinea.size > 0 && <p>Los de cada línea están marcados en la tabla.</p>}
                </div>
              ) : (
                <p className="text-emerald-700">Sin errores: la apertura corregida cuadra ({money(vista.totalDebitos)}).</p>
              )}
              {vista.bloqueos.map((b) => <p key={b} className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900">{b}</p>)}

              {vista.cambios.length > 0 && (
                <div className="overflow-x-auto">
                  <p className="font-semibold">Qué cambia (saldo por cuenta, débito menos crédito)</p>
                  <table className="w-full min-w-[420px] text-left">
                    <thead className="border-b text-xs text-gray-500">
                      <tr><th className="py-1">Cuenta</th><th className="py-1 text-right">Antes</th><th className="py-1 text-right">Después</th></tr>
                    </thead>
                    <tbody className="divide-y">
                      {vista.cambios.map((c) => (
                        <tr key={c.cuenta}>
                          <td className="py-1">{c.cuenta} {c.nombre}</td>
                          <td className="py-1 text-right font-mono">{money(c.antes)}</td>
                          <td className="py-1 text-right font-mono">{money(c.despues)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-gray-600">
                Cuadre al corte con la corrección: clientes {money(vista.cuadre.totales.cliente.segunApertura)} contra{" "}
                {money(vista.cuadre.totales.cliente.segunCrm)} en el CRM; proveedores {money(vista.cuadre.totales.proveedor.segunApertura)} contra{" "}
                {money(vista.cuadre.totales.proveedor.segunCrm)}.
              </p>

              {vista.errores.length === 0 && vista.bloqueos.length === 0 && (
                <div className="space-y-2">
                  <label htmlFor="motivo-correccion" className="block text-sm font-medium">
                    Motivo de la corrección (obligatorio: queda en el libro, en el historial y en la bitácora)
                  </label>
                  <textarea id="motivo-correccion" value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} maxLength={1000}
                    className="w-full rounded-md border border-gray-300 p-2 text-sm" />
                  <Button type="button" className="min-h-[48px] gap-2" disabled={!habilitado || !puedeGuardar || isPending} onClick={() => setConfirmar(true)}>
                    <BookCheck size={16} /> Guardar la corrección
                  </Button>
                  {!habilitado && <p className="text-sm font-semibold text-amber-800">{MENSAJE_POSTEO_HISTORICO_APAGADO}</p>}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <ConfirmationModal
        open={confirmar}
        onClose={() => !isPending && setConfirmar(false)}
        onConfirm={() => enviar("commit")}
        loading={isPending}
        title="Guardar la corrección de la apertura"
        confirmButtonText={isPending ? "Guardando…" : "Sí, corregir"}
      >
        <p className="text-sm">
          Se reversa {referencia} con su misma fecha ({fechaCorta(fecha)}) y se registra la apertura corregida por{" "}
          {vista ? money(vista.totalDebitos) : ""}, las dos en un solo paso. Si algo falla, no se registra nada.
        </p>
      </ConfirmationModal>
    </div>
  );
}

/** La fila y, debajo, sus errores de la última revisión. */
function FilaConErrores({ errores, children }: { errores?: string[]; children: ReactNode }) {
  return (
    <>
      <tr className={errores ? "bg-red-50/60" : ""}>{children}</tr>
      {errores && (
        <tr className="bg-red-50/60">
          <td />
          <td colSpan={8} className="pb-2 text-xs text-red-800">
            {errores.map((e, i) => <p key={i}>{e}</p>)}
          </td>
        </tr>
      )}
    </>
  );
}
