import { redirect } from "next/navigation";
import Link from "next/link";
import { History, Landmark, Truck, Wrench } from "lucide-react";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { BackButton } from "@/components/ui/back-button";
import { fechaCorta } from "@/lib/finanzas/contabilidad/inicio-contable";
import {
  AVISO_ASIENTOS_MANUALES, ETIQUETA_DE_TIPO, ORDEN_DE_TIPOS, RUTA_ASIGNAR_BANCOS, RUTA_ASIGNAR_GASTOS,
  planearPosteo, rangoDelMes, totalesPorCuenta,
} from "@/lib/finanzas/contabilidad/posteo-retroactivo";
import { ContabilizarMes } from "./_components/contabilizar-mes";

export const metadata = { title: "Documentos existentes · Finanzas" };

/** Admin y contador, como los asientos de diario. Coincide con la ruta (ROLES). */
const ROLES = ["admin", "contador"];

interface PageProps {
  searchParams: { mes?: string };
}

export default async function DocumentosExistentesPage({ searchParams }: PageProps) {
  const ctx = await getAuthenticatedContext();
  if (!ROLES.includes(ctx.userRole)) redirect("/finanzas");

  const mes = /^\d{4}-\d{2}$/.test(searchParams.mes ?? "") ? searchParams.mes! : "2026-07";
  const { desde, hasta } = rangoDelMes(mes);
  const plan = await planearPosteo(ctx.db, ctx.tenantId, desde, hasta);
  const tot = totalesPorCuenta(plan.items);
  const debitos = tot.reduce((s, t) => s + t.debito, 0);
  const creditos = tot.reduce((s, t) => s + t.credito, 0);
  const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <BackButton fallbackHref="/finanzas/asientos" label="Volver a asientos" showLabel />
        <div>
          <div className="flex items-center gap-2">
            <History size={22} className="text-integra-gold" />
            <h1 className="font-serif text-2xl text-integra-navy">Contabilizar documentos existentes</h1>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-gray-500">
            Los documentos desde el inicio contable ({fechaCorta(plan.inicio)}) hasta que empezó el registro automático
            no tienen asiento. Se contabilizan un mes por vez, en orden, después de que el contador revisa el Excel en
            seco. Cada asiento es el mismo que el sistema arma al emitir o registrar el documento. Un mes se carga por un
            solo método: si ya tiene asientos importados, no se contabiliza. Los ajustes cargados a mano no lo impiden.
          </p>
        </div>
      </div>

      <form className="flex flex-wrap items-end gap-3" method="get">
        <div>
          <label htmlFor="mes" className="mb-1 block text-xs font-medium">Mes</label>
          <input id="mes" name="mes" type="month" defaultValue={mes} className="min-h-[44px] rounded-md border border-gray-300 px-3 text-sm" />
        </div>
        <button type="submit" className="min-h-[44px] rounded-md border border-gray-300 bg-white px-4 text-sm font-semibold text-integra-navy">
          Ver el mes
        </button>
      </form>

      <section className="space-y-2 rounded-xl border bg-white p-5 shadow-sm text-sm">
        <h2 className="text-base font-semibold text-integra-navy">
          {fechaCorta(plan.desde)} al {fechaCorta(plan.hasta)}
        </h2>
        <p>
          <strong>{plan.items.length}</strong> asiento(s) · débitos <span className="font-mono">{money(debitos)}</span> ·
          créditos <span className="font-mono">{money(creditos)}</span>
        </p>
        <ul className="list-disc pl-5 text-gray-600">
          {ORDEN_DE_TIPOS.map((t) => {
            const n = plan.items.filter((i) => i.tipo === t).length;
            return n > 0 ? <li key={t}>{ETIQUETA_DE_TIPO[t]}: {n}</li> : null;
          })}
        </ul>
        <p className="text-gray-600">
          No se contabilizan: {plan.excluidos.length} (el detalle está en el Excel) · Con problemas: {plan.problemas.length}
        </p>
        {plan.bloqueos.length > 0 && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900">
            <p className="font-semibold">Antes de contabilizar</p>
            <ul className="list-disc pl-5">
              {plan.bloqueos.map((b) => <li key={b}>{b}</li>)}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          <Link href={`${RUTA_ASIGNAR_GASTOS}?mes=${mes}`} className="inline-flex min-h-[48px] items-center gap-2 rounded-md border border-gray-300 bg-white px-4 text-sm font-semibold text-integra-navy hover:border-integra-navy">
            <Truck size={16} /> Proveedores y cuentas de los gastos
          </Link>
          <Link href={`${RUTA_ASIGNAR_BANCOS}?mes=${mes}`} className="inline-flex min-h-[48px] items-center gap-2 rounded-md border border-gray-300 bg-white px-4 text-sm font-semibold text-integra-navy hover:border-integra-navy">
            <Landmark size={16} /> Bancos de los cobros
          </Link>
        </div>
        <ContabilizarMes
          mes={mes}
          puedeContabilizar={plan.bloqueos.length === 0 && plan.items.length > 0}
          resumen={`${plan.items.length} asiento(s) del ${fechaCorta(plan.desde)} al ${fechaCorta(plan.hasta)}, por ${money(debitos)}`}
        />
      </section>

      {plan.problemas.length > 0 && (
        <section className="space-y-2 rounded-xl border border-red-200 bg-white p-5 shadow-sm text-sm">
          <h2 className="text-base font-semibold text-integra-navy">Con problemas ({plan.problemas.length})</h2>
          <p className="text-gray-600">Hay que corregirlos antes de contabilizar el mes. Cada uno lleva a donde se corrige.</p>
          <ul className="divide-y">
            {plan.problemas.map((p) => (
              <li key={`${p.tipo}-${p.numero}-${p.fecha}`} className="flex flex-wrap items-center gap-3 py-2">
                <span className="flex-1">
                  <span className="font-semibold">{ETIQUETA_DE_TIPO[p.tipo]} {p.numero}</span> · {fechaCorta(p.fecha)}
                  <span className="block text-gray-600">{p.motivo}</span>
                </span>
                {p.enlace && (
                  <Link href={p.enlace} className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-gray-300 bg-white px-3 font-semibold text-integra-navy hover:border-integra-navy">
                    <Wrench size={14} /> Corregir
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2 rounded-xl border bg-white p-5 shadow-sm text-sm">
        <h2 className="text-base font-semibold text-integra-navy">Asientos manuales del mes ({plan.manuales.length})</h2>
        {plan.manuales.length === 0 ? (
          <p className="text-gray-600">No hay asientos cargados a mano en este período.</p>
        ) : (
          <>
            <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900">{AVISO_ASIENTOS_MANUALES}</p>
            <ul className="divide-y">
              {plan.manuales.map((m) => (
                <li key={m.numero} className="flex flex-wrap gap-3 py-2">
                  <span className="font-semibold">{m.numero}</span>
                  <span>{fechaCorta(m.fecha)}</span>
                  <span className="flex-1">{m.descripcion}</span>
                  <span className="font-mono">{money(m.monto)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
