import { redirect } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, Info } from "lucide-react";

import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { loadAntiguedad, type TipoAntiguedad } from "@/lib/finanzas/reports/antiguedad-source";
import { buildAntiguedad, TRAMO_LABEL } from "@/lib/finanzas/reports/antiguedad";
import { RUTA_DEL_DOCUMENTO } from "@/lib/finanzas/reports/destino-documento";
import { StatementHeader, OpeningBalancesNotice } from "../_components/financial-statement";
import { REPORT_FIRM_NAME, formatGeneratedAt } from "../_components/report-meta";
import { AntiguedadTable } from "./_components/antiguedad-table";
import { BotonExportar } from "../_components/boton-exportar";

const FINANZAS_ROLES = ["admin", "abogada", "contador"];

export const metadata = {
  title: "Antigüedad de Saldos · Reportes",
};

function money(n: number): string {
  return n.toLocaleString("es-PA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default async function AntiguedadPage({
  searchParams,
}: {
  searchParams: { tipo?: string };
}) {
  const ctx = await getAuthenticatedContext();
  if (!FINANZAS_ROLES.includes(ctx.userRole)) {
    redirect("/finanzas");
  }

  const tipo: TipoAntiguedad = searchParams.tipo === "pagar" ? "pagar" : "cobrar";
  const esCobrar = tipo === "cobrar";

  const { documentos, control } = await loadAntiguedad(ctx.db, ctx.tenantId, tipo);
  const reporte = buildAntiguedad(documentos, control);

  // ¿Hay una segunda causa además del saldo de apertura? Si no, el desglose no
  // se dibuja: un renglón en 0,00 le pide al contador descartar algo que no
  // existe. Se compara con tolerancia de centavo, no con === 0.
  const hayQueCablear = Math.abs(reporte.control.porCablear) >= 0.005;

  // Lo que el sistema SÍ encontró sin asiento. Se nombra tanto cuando cuadra con
  // el residuo como cuando no: en el segundo caso es justamente lo que el
  // contador necesita para descartar causas, y ocultarlo lo dejaba a ciegas.
  const sa = reporte.control.sinAsiento;
  const loEncontrado = (
    <>
      <strong>
        {sa.documentos.cantidad} {esCobrar ? "factura(s)" : "gasto(s)"} por{" "}
        {money(sa.documentos.monto)}
      </strong>{" "}
      que están en el auxiliar y no en el mayor
      {sa.cobros.cantidad > 0 && (
        <>
          , y{" "}
          <strong>
            {sa.cobros.cantidad} {esCobrar ? "cobro(s)" : "pago(s)"} por {money(sa.cobros.monto)}
          </strong>{" "}
          ya descontados del auxiliar y todavía no del mayor
          {/* Los saldos heredados de la 048 no son pagos que falte cablear: son
              compras que ya estaban pagadas antes de que existieran los pagos a
              proveedor. Se nombran como lo que son. */}
          {(sa.heredados?.cantidad ?? 0) > 0 && (
            <>
              {" "}
              (de los cuales{" "}
              <strong>
                {sa.heredados!.cantidad} por {money(sa.heredados!.monto)}
              </strong>{" "}
              son saldos heredados de la migración, no pagos registrados)
            </>
          )}
        </>
      )}
      {/* D5 (Bloque 7): los asientos manuales contra la cuenta control. Mueven
          el mayor y no el auxiliar, así que son una causa de la diferencia —y
          hasta el 22/09/2026 caían en el residuo anónimo de "una tercera
          causa". NO entran en los tramos: un asiento manual no tiene
          vencimiento. */}
      {(sa.manuales?.cantidad ?? 0) > 0 && (
        <>
          , y{" "}
          <strong>
            {sa.manuales!.cantidad} asiento(s) de diario por {money(sa.manuales!.monto)}
          </strong>{" "}
          contra esta cuenta, que mueven el mayor sin pasar por un documento
          {sa.manuales!.terceros.length > 0 && <> ({sa.manuales!.terceros.join(", ")})</>}
        </>
      )}
    </>
  );

  // Las rutas salen del MISMO resolvedor que el Libro Mayor y el Diario, así que
  // respetan el permiso del rol que las abre. Acá el id del documento ES el
  // destino: no hace falta resolver contra el ledger.
  const destinos = new Map<string, string>(
    documentos
      .filter((d) => RUTA_DEL_DOCUMENTO[d.sourceType])
      .map((d) => [d.id, RUTA_DEL_DOCUMENTO[d.sourceType](d.id)])
  );

  return (
    <div className="space-y-4">

      <StatementHeader
        firmName={REPORT_FIRM_NAME}
        title={esCobrar ? "Antigüedad de Cuentas por Cobrar" : "Antigüedad de Cuentas por Pagar"}
        subtitle="Detallada por documento · clic en un tercero para abrir sus documentos"
        generatedAt={formatGeneratedAt()}
      />

      {/* Selector de auxiliar */}
      <div className="inline-flex overflow-hidden rounded-lg border border-integra-navy/20 bg-white">
        <Link
          href="/finanzas/reportes/aging?tipo=cobrar"
          className={
            "min-h-[44px] px-4 py-2.5 text-sm font-medium transition-colors " +
            (esCobrar ? "bg-integra-navy text-white" : "text-gray-700 hover:bg-gray-50")
          }
        >
          Por cobrar
        </Link>
        <Link
          href="/finanzas/reportes/aging?tipo=pagar"
          className={
            "min-h-[44px] px-4 py-2.5 text-sm font-medium transition-colors " +
            (!esCobrar ? "bg-integra-navy text-white" : "text-gray-700 hover:bg-gray-50")
          }
        >
          Por pagar
        </Link>
      </div>

      <OpeningBalancesNotice />

      {/* ─────────────────────────────────────────────────────────────────
          LAS TRES CIFRAS DE CONTROL. La guía marca como no negociable que el
          auxiliar cuadre con su cuenta control; hoy no cuadra, y en vez de
          esconderlo se declara con su explicación.
          ───────────────────────────────────────────────────────────────── */}
      <div
        className={
          "rounded-md border px-4 py-3 " +
          (reporte.control.cuadra
            ? "border-green-200 bg-green-50"
            : "border-amber-200 bg-amber-50")
        }
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-gray-500">Total del auxiliar</p>
            <p className="font-mono text-base font-bold text-integra-navy">
              {money(reporte.control.totalAuxiliar)}
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-gray-500">
              Cuenta control {reporte.control.cuentaCodigo}
            </p>
            <p className="font-mono text-base font-bold text-integra-navy">
              {money(reporte.control.saldoCuentaControl)}
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-gray-500">Diferencia</p>
            <p
              className={
                "font-mono text-base font-bold " +
                (reporte.control.cuadra ? "text-green-700" : "text-amber-800")
              }
            >
              {money(reporte.control.diferencia)}
            </p>
          </div>
        </div>

        {!reporte.control.cuadra && (
          <div className="mt-3 border-t border-amber-200 pt-3">
            {/* -------------------------------------------------------------
                EL DESGLOSE, y su condicion de render.

                La diferencia puede tener DOS origenes con dos soluciones
                distintas: un dato historico que falta (la apertura), y
                documentos que no llegaron al mayor.

                Cuando `porCablear` es 0 ese segundo renglon NO se muestra. La
                primera version lo dibujaba siempre, con "Son 0 factura(s) por
                0.00" y valor 0.00 al lado: un renglon en cero que le pide al
                contador descartar una causa que no existe. Con una sola causa
                el desglose sobra, alcanza con nombrarla.
                ------------------------------------------------------------- */}
            {hayQueCablear ? (
              <>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-amber-900">
                  De dónde sale esa diferencia
                </p>

                <dl className="space-y-1.5 text-xs text-amber-900">
                  <div className="flex items-start justify-between gap-4">
                    <dt className="flex-1">
                      <strong>Saldo de apertura cargado sin detalle de documentos.</strong> Vino de
                      QuickBooks como un saldo único: está en la cuenta control y no tiene ni una
                      factura detrás que esta tabla pueda abrir.
                    </dt>
                    <dd className="shrink-0 font-mono font-bold tabular-nums">
                      {money(reporte.control.saldoApertura)}
                    </dd>
                  </div>

                  <div className="flex items-start justify-between gap-4">
                    <dt className="flex-1">
                      {/* ⚠️ Esta frase decía que «los asientos todavía no se generan
                          solos». Dejó de ser cierto el 09/09/2026, cuando se desplegó
                          el cableado contable, y quedó contando lo contrario de lo que
                          hace el sistema —en la pantalla que muestra la diferencia más
                          grande del reporte—. Verificado contra staging el 10/09/2026:
                          los tres documentos que quedan sin asiento se registraron el
                          03 y el 04/09, y las facturas emitidas después SÍ tienen el
                          suyo. */}
                      <strong>
                        Documentos anteriores al cableado contable, que nunca llegaron al
                        mayor.
                      </strong>{" "}
                      Se registraron antes del <strong>09/09/2026</strong>, cuando emitir una
                      factura o registrar un cobro todavía no generaba su asiento. Desde esa
                      fecha el asiento se arma en el mismo acto, así que esta diferencia{" "}
                      <strong>no crece con los documentos nuevos</strong>: se corrige cargando
                      a mano los asientos que faltan.
                      {reporte.control.porCablearExplicado && <> Son {loEncontrado}.</>}
                    </dt>
                    <dd className="shrink-0 font-mono font-bold tabular-nums">
                      {money(reporte.control.porCablear)}
                    </dd>
                  </div>

                  <div className="flex items-start justify-between gap-4 border-t border-amber-300 pt-1.5">
                    <dt className="flex-1 font-semibold">Diferencia total</dt>
                    <dd className="shrink-0 font-mono font-bold tabular-nums">
                      {money(reporte.control.diferencia)}
                    </dd>
                  </div>
                </dl>

                {!reporte.control.porCablearExplicado && (
                  <p className="mt-2 flex items-start gap-2 text-xs text-amber-900">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <span>
                      Los documentos sin asiento que el sistema encuentra{" "}
                      <strong>no reconstruyen esos {money(reporte.control.porCablear)}</strong>.
                      Hay una tercera causa que este reporte no sabe explicar, y se dice acá en
                      vez de atribuirla a las dos de arriba. Lo que sí encontró: {loEncontrado}.
                    </span>
                  </p>
                )}

                <p className="mt-2 flex items-start gap-2 text-xs text-amber-900">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span>
                    Las dos se arreglan distinto:{" "}
                    <strong>
                      la apertura necesita el detalle de los documentos pendientes a esa fecha
                    </strong>
                    , que lo tiene el contador y no está en el sistema; los documentos sin asiento
                    se resuelven registrándolos en el libro.
                  </span>
                </p>
              </>
            ) : (
              <p className="flex items-start gap-2 text-xs text-amber-900">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>
                  La diferencia es <strong>exactamente el saldo de apertura</strong> de{" "}
                  <strong>
                    {reporte.control.cuentaCodigo} {reporte.control.cuentaNombre}
                  </strong>
                  , cargado desde QuickBooks como un saldo único y sin detalle de documentos: no
                  tiene ni una factura detrás que esta tabla pueda abrir. Todo lo demás que hay en
                  esa cuenta está registrado en el libro mayor y sí aparece acá.{" "}
                  <strong>
                    Se resuelve con el detalle de los documentos pendientes a la fecha de apertura
                  </strong>
                  , que lo tiene el contador y no está en el sistema.
                </span>
              </p>
            )}
          </div>
        )}
      </div>

      {!esCobrar && (
        <p className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5 text-xs text-blue-800">
          <Info size={14} className="mt-0.5 shrink-0" />
          <span>
            La antigüedad se cuenta desde la <strong>fecha de vencimiento</strong> de cada gasto,
            que sale del <strong>plazo de pago de la ficha del proveedor</strong> y se puede
            ajustar gasto por gasto.{" "}
            <Link href="/finanzas/proveedores" className="font-medium underline">
              Ver proveedores
            </Link>
            . Un gasto sin vencimiento cargado se cuenta desde su fecha, o sea como contado.
          </span>
        </p>
      )}

      {reporte.tramosVacios.length > 0 && reporte.filas.length > 0 && (
        <p className="text-xs text-gray-500">
          Sin documentos en{" "}
          <strong>{reporte.tramosVacios.map((t) => TRAMO_LABEL[t]).join(", ")}</strong>. Las
          columnas se muestran igual para que la estructura del reporte no cambie según los datos.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-gray-500">
          El archivo sale <strong>detallado por documento</strong>, con el RUC y el DV del tercero
          en columnas separadas.
        </p>
        <BotonExportar
          href={`/api/finanzas/reportes/aging/export?tipo=${tipo}`}
          nombreSugerido={`Antiguedad_${esCobrar ? "CxC" : "CxP"}.xlsx`}
        />
      </div>

      <AntiguedadTable reporte={reporte} destinos={destinos} />
    </div>
  );
}
