import Link from "next/link";
import { redirect } from "next/navigation";
import { Download, FolderOpen } from "lucide-react";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { BackButton } from "@/components/ui/back-button";
import { fechaCorta } from "@/lib/finanzas/contabilidad/inicio-contable";
import { AVISO_FUENTE_DE_LA_APERTURA, ETIQUETA_DEL_ESTADO } from "@/lib/finanzas/contabilidad/apertura";
import { cargarCuadreAlCorte, cargarEstadoDeLaApertura, MENSAJE_MES_DE_APERTURA_CERRADO } from "@/lib/finanzas/api/apertura";
import { AperturaPanel } from "./_components/apertura-panel";
import { ReversarApertura } from "./_components/reversar-apertura";
import { posteoHistoricoHabilitado } from "@/lib/finanzas/posteo-historico";

export const metadata = { title: "Apertura · Asientos de Diario" };

/** Admin y contador, como los asientos de diario y las rutas de la apertura. */
const ROLES = ["admin", "contador"];

const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function AperturaPage() {
  const ctx = await getAuthenticatedContext();
  if (!ROLES.includes(ctx.userRole)) redirect("/finanzas");

  const estado = await cargarEstadoDeLaApertura(ctx.db, ctx.tenantId);
  const { cuadre } = await cargarCuadreAlCorte(ctx.db, ctx.tenantId);
  const v = estado.vigente;
  // Interruptor (07/10): las rutas lo vuelven a exigir con 403.
  const habilitado = posteoHistoricoHabilitado();
  const conDiferencia = cuadre.filas.filter((f) => f.estado !== "cuadra");

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
            {new Date(v.creadaEl).toLocaleString("es-PA", { timeZone: "America/Panama" })}
          </p>
          {estado.mesAbierto ? (
            <ReversarApertura fecha={v.fecha} referencia={v.referencia ?? `asiento ${v.entryNumber}`} habilitado={habilitado} />
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

      {estado.historial.some((a) => a.estado === "reversada") && (
        <section className="space-y-2 rounded-xl border bg-white p-5 shadow-sm text-sm">
          <h2 className="text-base font-semibold text-integra-navy">Aperturas reversadas</h2>
          <ul className="divide-y">
            {estado.historial.filter((a) => a.estado === "reversada").map((a) => (
              <li key={a.id} className="py-2">
                <span className="font-semibold">{a.referencia ?? `asiento ${a.entryNumber}`}</span> al {fechaCorta(a.fecha)} ·{" "}
                <span className="font-mono">{money(a.totalDebitos)}</span> · reversada con el asiento {a.reversion?.entryNumber}
                {a.reversion?.por ? ` por ${a.reversion.por}` : ""}: «{a.reversion?.motivo}»
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
