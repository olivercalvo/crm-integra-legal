import Link from "next/link";
import { redirect } from "next/navigation";
import { Download, FolderOpen } from "lucide-react";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { BackButton } from "@/components/ui/back-button";
import { fechaCorta } from "@/lib/finanzas/contabilidad/inicio-contable";
import { AVISO_FUENTE_DE_LA_APERTURA, ETIQUETA_DEL_ESTADO } from "@/lib/finanzas/contabilidad/apertura";
import {
  cargarContextoDeApertura,
  cargarCuadreAlCorte,
  cargarEstadoDeLaApertura,
  cargarFilasDeLaApertura,
  MENSAJE_MES_DE_APERTURA_CERRADO,
} from "@/lib/finanzas/api/apertura";
import { AperturaPanel } from "./_components/apertura-panel";
import { ReversarApertura } from "./_components/reversar-apertura";
import { CorregirApertura } from "./_components/corregir-apertura";
import { posteoHistoricoHabilitado } from "@/lib/finanzas/posteo-historico";

export const metadata = { title: "Apertura · Asientos de Diario" };

/** Admin y contador, como los asientos de diario y las rutas de la apertura. */
const ROLES = ["admin", "contador"];

const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** DD/MM/AAAA HH:MM en Panamá. `es-PA` da MM/DD (14/10 salía «10/14/2026»). */
const fechaHora = (iso: string) =>
  new Date(iso).toLocaleString("es-ES", {
    timeZone: "America/Panama", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });

export default async function AperturaPage() {
  const ctx = await getAuthenticatedContext();
  if (!ROLES.includes(ctx.userRole)) redirect("/finanzas");

  const estado = await cargarEstadoDeLaApertura(ctx.db, ctx.tenantId);
  const { cuadre } = await cargarCuadreAlCorte(ctx.db, ctx.tenantId);
  const v = estado.vigente;
  // Interruptor (07/10): las rutas lo vuelven a exigir con 403.
  const habilitado = posteoHistoricoHabilitado();
  const conDiferencia = cuadre.filas.filter((f) => f.estado !== "cuadra");

  // «Corregir la apertura» (102): sólo con una vigente y su mes abierto. Las
  // listas son las de la plantilla: cuentas activas, clientes reales, proveedores.
  const correccion = v && estado.mesAbierto
    ? await (async () => {
        const [filas, contexto] = await Promise.all([
          cargarFilasDeLaApertura(ctx.db, ctx.tenantId, v.id),
          cargarContextoDeApertura(ctx.db, ctx.tenantId, v.fecha),
        ]);
        const porCodigo = (a: { codigo: string }, b: { codigo: string }) => a.codigo.localeCompare(b.codigo);
        return {
          filas,
          cuentas: Array.from(contexto.cuentas.values()).filter((c) => c.active)
            .map((c) => ({ code: c.code, name: c.name, cuenta_control: c.cuenta_control })),
          clientes: Array.from(contexto.clientes.entries()).filter(([, c]) => !c.dePrueba)
            .map(([codigo, c]) => ({ codigo, nombre: c.nombre })).sort(porCodigo),
          proveedores: Array.from(contexto.proveedores.entries())
            .map(([codigo, p]) => ({ codigo, nombre: p.nombre })).sort(porCodigo),
        };
      })()
    : null;
  const historial = [...estado.historial].sort((a, b) => a.version - b.version);

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <BackButton fallbackHref="/finanzas/asientos" label="Volver a asientos" showLabel />
        <div>
          <div className="flex items-center gap-2">
            <FolderOpen size={22} className="text-integra-gold" />
            <h1 className="font-serif text-2xl text-integra-navy">Asiento de apertura</h1>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-gray-500">
            Los saldos de cada cuenta al {fechaCorta(estado.fecha)}, el día del corte, en un solo asiento. Se registra una
            vez. El inicio contable es el {fechaCorta(estado.inicio)}: desde ahí los documentos se registran solos. La fecha
            se cambia en{" "}
            <Link href="/finanzas/configuracion/parametros" className="font-semibold text-integra-navy underline">
              Parámetros contables
            </Link>
            {estado.fechaEsParametro ? "." : " (hoy es el día anterior al inicio contable, porque todavía no se eligió)."}
          </p>
        </div>
      </div>

      <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{AVISO_FUENTE_DE_LA_APERTURA}</p>

      {v ? (
        <section className="space-y-2 rounded-xl border border-emerald-200 bg-white p-5 shadow-sm text-sm">
          <h2 className="text-base font-semibold text-integra-navy">
            Apertura vigente: {v.referencia ?? `asiento ${v.entryNumber}`} al {fechaCorta(v.fecha)}
          </h2>
          <p className="text-gray-600">
            {v.lineas} línea(s) · débitos y créditos <span className="font-mono">{money(v.totalDebitos)}</span> · archivo{" "}
            {v.archivo} · registrada {v.creadaPor ? `por ${v.creadaPor} ` : ""}el{" "}
            {fechaHora(v.creadaEl)}
          </p>
          {correccion ? (
            <CorregirApertura
              aperturaId={v.id}
              fecha={v.fecha}
              referencia={v.referencia ?? `asiento ${v.entryNumber}`}
              habilitado={habilitado}
              filasIniciales={correccion.filas}
              cuentas={correccion.cuentas}
              clientes={correccion.clientes}
              proveedores={correccion.proveedores}
            >
              <ReversarApertura fecha={v.fecha} referencia={v.referencia ?? `asiento ${v.entryNumber}`} habilitado={habilitado} />
            </CorregirApertura>
          ) : (
            <p className="rounded-md border border-gray-200 bg-gray-50 p-3 text-gray-700">{MENSAJE_MES_DE_APERTURA_CERRADO(v.fecha)}</p>
          )}
        </section>
      ) : (
        <AperturaPanel fecha={estado.fecha} mesAbierto={estado.mesAbierto} habilitado={habilitado} />
      )}

      <section className="space-y-3 rounded-xl border bg-white p-5 shadow-sm text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-integra-navy">Cuadre al corte ({fechaCorta(estado.fecha)})</h2>
          <a
            href="/api/finanzas/asientos/apertura/cuadre/export"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-gray-300 bg-white px-3 font-semibold text-integra-navy hover:border-integra-navy"
          >
            <Download size={16} /> Descargar Excel
          </a>
        </div>
        <p className="text-gray-600">
          Por cliente y por proveedor: el saldo de la apertura contra el de los documentos del CRM con fecha hasta el corte.
          {v ? "" : " Todavía no hay apertura: el lado de la apertura está en cero."}
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {(["cliente", "proveedor"] as const).map((lado) => (
            <div key={lado} className="rounded-md border p-3">
              <p className="font-semibold">{lado === "cliente" ? "Clientes (100004)" : "Proveedores (200001)"}</p>
              <p>Según la apertura: <span className="font-mono">{money(cuadre.totales[lado].segunApertura)}</span></p>
              <p>Según el CRM: <span className="font-mono">{money(cuadre.totales[lado].segunCrm)}</span></p>
              <p>Diferencia: <span className="font-mono">{money(cuadre.totales[lado].diferencia)}</span></p>
            </div>
          ))}
        </div>
        {cuadre.filas.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left">
              <thead className="border-b text-xs text-gray-500">
                <tr>
                  <th className="py-2">Cliente o proveedor</th>
                  <th className="py-2 text-right">Según la apertura</th>
                  <th className="py-2 text-right">Según el CRM</th>
                  <th className="py-2 text-right">Diferencia</th>
                  <th className="py-2">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {cuadre.filas.map((f) => (
                  <tr key={`${f.lado}-${f.terceroId}`}>
                    <td className="py-2">
                      {f.terceroNombre} {f.terceroCodigo && <span className="text-gray-500">({f.terceroCodigo})</span>}
                    </td>
                    <td className="py-2 text-right font-mono">{money(f.segunApertura)}</td>
                    <td className="py-2 text-right font-mono">{money(f.segunCrm)}</td>
                    <td className="py-2 text-right font-mono">{money(f.diferencia)}</td>
                    <td className={`py-2 ${f.estado === "cuadra" ? "text-emerald-700" : "font-semibold text-amber-800"}`}>
                      {ETIQUETA_DEL_ESTADO[f.estado]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-gray-500">{conDiferencia.length} de {cuadre.filas.length} con diferencia. El detalle por documento está en el Excel.</p>
          </div>
        )}
      </section>

      {historial.length > 0 && (
        <section className="space-y-2 rounded-xl border bg-white p-5 shadow-sm text-sm">
          <h2 className="text-base font-semibold text-integra-navy">Historial de la apertura</h2>
          <p className="text-gray-600">
            Cada carga por Excel y cada corrección es una versión. Ninguna se borra del libro: la anterior queda
            reversada con su motivo.
          </p>
          <ol className="divide-y">
            {historial.map((a) => (
              <li key={a.id} className="space-y-1 py-2">
                <p>
                  <span className="font-semibold">Versión {a.version}</span> ·{" "}
                  {a.referencia ?? `asiento ${a.entryNumber}`} al {fechaCorta(a.fecha)} ·{" "}
                  <span className="font-mono">{money(a.totalDebitos)}</span> · {a.lineas} línea(s) ·{" "}
                  <span className={a.estado === "vigente" ? "font-semibold text-emerald-700" : "text-gray-500"}>
                    {a.estado === "vigente" ? "Vigente" : "Reversada"}
                  </span>
                </p>
                <p className="text-gray-600">
                  {a.corrige
                    ? <>Corrige la versión {a.corrige.version ?? "anterior"}: «{a.corrige.motivo}»</>
                    : <>Cargada por Excel ({a.archivo})</>}
                  {" · "}registrada {a.creadaPor ? `por ${a.creadaPor} ` : ""}el{" "}
                  {fechaHora(a.creadaEl)}
                </p>
                {a.reversion && (
                  <p className="text-gray-500">
                    Reversada con el asiento {a.reversion.entryNumber}
                    {a.reversion.por ? ` por ${a.reversion.por}` : ""}
                    {a.reversion.el ? ` el ${fechaHora(a.reversion.el)}` : ""}:{" "}
                    «{a.reversion.motivo}»
                  </p>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
