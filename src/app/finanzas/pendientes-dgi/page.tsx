import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, CheckCircle2, FileWarning } from "lucide-react";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { formatDate, formatDateTime } from "@/lib/utils/format-date";
import { fmtImporte } from "@/lib/utils/importe";
import { listarPendientesDgi, PENDIENTES_DGI_DESDE } from "@/lib/finanzas/queries/pendientes-dgi";
import { esDeUnMesAnterior, MENSAJE_MES_ANTERIOR } from "@/lib/finanzas/efactura/orchestration/enviar-a-la-dgi";
import { ReintentarEnvioDgi } from "./_components/reintentar-envio-dgi";

export const metadata = {
  title: "Pendientes de enviar a la DGI · Finanzas",
};

/** Ven la lista admin, abogada y contador; reintentan admin y abogada (los que emiten). */
const ROLES = ["admin", "abogada", "contador"];
const PUEDEN_ENVIAR = ["admin", "abogada"];

const TIPO: Record<string, string> = { factura: "Factura", nota_debito: "Nota de débito", nota_credito: "Nota de crédito" };

/**
 * PENDIENTES DE ENVIAR A LA DGI (03/10/2026): facturas, ND y NC emitidas sin
 * autorización de la DGI, con el motivo guardado (085) y el reintento. Existe
 * por las 4 facturas de producción que quedaron así sin que nadie se enterara.
 */
export default async function PendientesDgiPage() {
  const { db, tenantId, userRole } = await getAuthenticatedContext();
  if (!ROLES.includes(userRole)) redirect("/finanzas");

  const pendientes = await listarPendientesDgi(db, tenantId);
  const puedeEnviar = PUEDEN_ENVIAR.includes(userRole);

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <FileWarning size={22} className="mt-1 shrink-0 text-integra-gold" />
        <div>
          <h1 className="text-2xl font-bold text-integra-navy">Pendientes de enviar a la DGI</h1>
          <p className="text-sm text-gray-500">
            Facturas, notas de débito y notas de crédito emitidas que todavía no tienen autorización de la DGI, desde el{" "}
            {formatDate(PENDIENTES_DGI_DESDE)}. No valen ante el fisco hasta que la DGI las autorice.
          </p>
        </div>
      </div>

      {pendientes.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          <CheckCircle2 size={18} />
          No hay documentos pendientes: todo lo emitido está autorizado por la DGI o se emitió como interno.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b bg-gray-50 text-left text-xs uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Documento</th>
                <th className="px-3 py-2">Cliente</th>
                <th className="px-3 py-2 text-right">Monto</th>
                <th className="px-3 py-2">Creado por</th>
                <th className="px-3 py-2">Motivo</th>
                <th className="px-3 py-2">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {pendientes.map((p) => {
                const mesAnterior = esDeUnMesAnterior(p.fecha);
                const href = p.tipo === "nota_credito" ? `/finanzas/notas-credito/${p.id}` : `/finanzas/facturas/${p.id}`;
                return (
                  <tr key={`${p.tipo}-${p.id}`} className="align-top">
                    <td className="whitespace-nowrap px-3 py-2">{formatDate(p.fecha)}</td>
                    <td className="px-3 py-2">
                      <Link href={href} className="font-mono font-semibold text-integra-navy hover:underline">
                        {p.numero}
                      </Link>
                      <div className="text-xs text-gray-500">{TIPO[p.tipo]}</div>
                    </td>
                    <td className="px-3 py-2">{p.cliente}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-mono">B/. {fmtImporte(p.monto)}</td>
                    <td className="px-3 py-2">{p.creadoPor ?? ""}</td>
                    <td className="max-w-md px-3 py-2">
                      <span
                        className={`mb-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                          p.feEstado === "error" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"
                        }`}
                      >
                        {p.feEstado === "error" ? "Rechazada o sin conexión" : "Nunca se envió"}
                      </span>
                      <p className="whitespace-pre-line text-xs text-gray-700">
                        {p.motivo ?? "Sin motivo guardado: se emitió y no se envió a la DGI."}
                      </p>
                      {p.motivoEn && <p className="mt-0.5 text-[11px] text-gray-400">{formatDateTime(p.motivoEn)}</p>}
                    </td>
                    <td className="px-3 py-2">
                      {!puedeEnviar ? (
                        <span className="text-xs text-gray-500">Lo envían admin o abogada</span>
                      ) : mesAnterior ? (
                        <p className="flex max-w-[16rem] items-start gap-1 text-xs text-amber-800">
                          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                          {MENSAJE_MES_ANTERIOR}
                        </p>
                      ) : (
                        <ReintentarEnvioDgi tipo={p.tipo} id={p.id} numero={p.numero} esReintento={p.feEstado === "error"} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
