import { redirect, notFound } from "next/navigation";
import {
  AlertTriangle,
  BookOpenCheck,
  Calendar,
  CalendarClock,
  Download,
  FileText,
  Hash,
  History,
  Scale,
  Truck,
} from "lucide-react";

import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { formatDate } from "@/lib/utils/format-date";
import { getGastoTramiteContable } from "@/lib/finanzas/queries/expense-tramite";
import { PostToLedgerButton } from "./_components/post-to-ledger-button";
import {
  cuentaLabel,
  haySinClasificar,
  LABEL_SIN_CLASIFICAR,
  round2,
  tasaLabel,
} from "@/lib/finanzas/types/expense-line";

/**
 * DETALLE CONTABLE DE UN GASTO DE TRÁMITE — solo lectura.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * POR QUÉ ESTA PANTALLA EXISTE
 * ═════════════════════════════════════════════════════════════════════════════
 * Un gasto de trámite vive dentro de un caso, en `/legal/casos/{id}`, y el
 * contador **no entra a `/legal/*` en absoluto** (`route-access.ts`:
 * `contador: ["/", "/finanzas"]`).
 *
 * Pero el contador SÍ entra al Libro Mayor, y la guía de RM pide en su lista de
 * validación que "cada reporte permite llegar al documento origen". Sin esta
 * pantalla, el ícono del mayor le prometería abrir el gasto y lo depositaría en
 * otra parte — exactamente el bug del 01/09/2026 que originó
 * `destino-documento.ts`, reintroducido un módulo más adelante.
 *
 * Es el mismo patrón que `/finanzas/facturas/{id}` para el contador: **el
 * detalle sí, el listado no.** No hay listado de gastos de trámite bajo
 * `/finanzas`, y el permiso es un patrón de ruta y no un prefijo, justamente
 * para que si alguien agrega un listado mañana el contador NO lo herede.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔒 EL RECORTE DE PRIVACIDAD — decisión de Oliver, 03/09/2026
 * ─────────────────────────────────────────────────────────────────────────────
 * Los casos son confidenciales. Esta pantalla abre una puerta al módulo legal
 * que el contador hoy no tiene, así que muestra el gasto y **nada del caso más
 * que su número**:
 *
 *   ✅ monto, líneas, cuentas, fecha, proveedor con RUC y DV, vencimiento,
 *      comprobante, y el CÓDIGO del caso.
 *   ❌ descripción del caso, partes, cliente, documentos, notas, historial.
 *
 * El número le alcanza para identificar el gasto en su papel de trabajo, que es
 * para lo que lo necesita. Ampliar el acceso del contador al contenido legal por
 * la puerta de atrás sería un cambio de política del bufete, no una pantalla.
 *
 * **El recorte se hace en el `select`, no acá.** Ver
 * `lib/finanzas/queries/expense-tramite.ts`: el dato confidencial nunca sale de
 * la base, así que no puede filtrarse por descuido al agregar un campo a esta
 * vista. 🔒 Lo fija `gastos-tramite-privacidad.test.ts`.
 *
 * ⚠️ **Y por eso el código del caso NO es un enlace.** Un `<Link>` a
 * `/legal/casos/{id}` sería la puerta de atrás en una línea: el middleware se lo
 * rebotaría al contador, y para la abogada sería un atajo que esta pantalla no
 * tiene por qué ofrecer. El número va como texto.
 */

export const metadata = {
  title: "Gasto de trámite · Finanzas",
};

/**
 * Quién lee esta pantalla. Tiene que coincidir con `route-access.ts`:
 * el contador entra por `CONTADOR_FINANZAS_ALLOWED_PATTERNS`, y admin y abogada
 * por el prefijo `/finanzas`. El asistente no entra a Finanzas.
 */
const READING_ROLES = ["admin", "abogada", "contador"];

/**
 * Quién puede REGISTRAR el gasto en el libro. Tiene que coincidir con
 * `EXPENSE_WRITE_ROLES` de `POST /api/expenses/[id]/post-to-ledger`.
 *
 * El contador entra a esta pantalla —la abre desde el Libro Mayor— pero NO
 * postea: gastos de trámite es del módulo Legal.
 */
const POSTING_ROLES = ["admin", "abogada"];

interface PageProps {
  params: { id: string };
}

function fmtMoney(n: number): string {
  return Number(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default async function GastoTramiteContablePage({ params }: PageProps) {
  const ctx = await getAuthenticatedContext();
  if (!READING_ROLES.includes(ctx.userRole)) {
    redirect("/finanzas");
  }

  const gasto = await getGastoTramiteContable(ctx.db, ctx.tenantId, params.id);
  if (!gasto) notFound();

  const sinClasificar = haySinClasificar(gasto.lineas);
  const posteado = gasto.entry_number !== null;

  // El botón aparece solo cuando la acción se puede ejecutar de verdad. Si falta
  // clasificar, el aviso ámbar de más abajo ya explica qué hacer y un botón
  // deshabilitado al lado sería ruido.
  const puedePostear =
    POSTING_ROLES.includes(ctx.userRole) &&
    !posteado &&
    !sinClasificar &&
    gasto.lineas.length > 0;

  // El encabezado y las líneas conviven hasta que `amount` se vuelva derivado
  // (commit posterior, después de verificar producción). Mientras conviven,
  // pueden discrepar — y si discrepan hay que decirlo, no elegir uno en
  // silencio: el asiento se arma con las LÍNEAS.
  const descuadre = round2(gasto.totales.total - gasto.amount);
  const hayDescuadre = Math.abs(descuadre) >= 0.005;

  return (
    <div className="space-y-5">
      {/* ── Encabezado ─────────────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Gasto de trámite
            </p>
            <h1 className="mt-1 font-serif text-2xl text-integra-navy">
              B/. {fmtMoney(gasto.totales.total)}
            </h1>
            <p className="mt-1 text-sm text-gray-600">{gasto.concept}</p>
          </div>

          <div className="flex flex-col items-end gap-2">
            {posteado ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                <BookOpenCheck size={14} />
                Asiento {gasto.entry_number}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-semibold text-gray-600">
                Sin registrar en el libro
              </span>
            )}
            <span className="text-xs text-gray-400">
              {gasto.expense_type === "administrativo" ? "Administrativo" : "Trámite"}
            </span>
          </div>
        </div>

        {/* Datos del documento. Del caso, SOLO el código. */}
        <dl className="mt-5 grid grid-cols-1 gap-4 border-t border-gray-100 pt-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
              <Calendar size={13} /> Fecha del gasto
            </dt>
            <dd className="mt-1 text-sm text-gray-900">{formatDate(gasto.date)}</dd>
          </div>

          <div>
            <dt className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
              <CalendarClock size={13} /> Vencimiento
            </dt>
            <dd className="mt-1 text-sm text-gray-900">
              {gasto.due_date ? (
                formatDate(gasto.due_date)
              ) : (
                <span className="text-gray-400">Sin plazo</span>
              )}
            </dd>
          </div>

          <div>
            {/* Solo el CÓDIGO, y a propósito NO es un enlace: ver el encabezado. */}
            <dt className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
              <Hash size={13} /> Caso
            </dt>
            <dd className="mt-1 font-mono text-sm text-gray-900">
              {gasto.case_code ?? <span className="font-sans text-gray-400">—</span>}
            </dd>
          </div>

          <div>
            <dt className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
              <Truck size={13} /> Proveedor
            </dt>
            <dd className="mt-1 text-sm text-gray-900">
              {gasto.supplier_legal_name ?? (
                <span className="text-gray-400">Sin proveedor</span>
              )}
            </dd>
          </div>
        </dl>

        {/* 🔴 RUC y DV en DOS columnas. Nunca se concatenan: así los pide el
            formulario de la DGI para los anexos de la renta. */}
        {gasto.supplier_legal_name && (
          <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-gray-100 pt-4 sm:max-w-md">
            <div>
              <dt className="text-xs font-medium text-gray-500">RUC</dt>
              <dd className="mt-1 font-mono text-sm text-gray-900">
                {gasto.supplier_ruc ?? <span className="font-sans text-gray-400">—</span>}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-gray-500">DV</dt>
              <dd className="mt-1 font-mono text-sm text-gray-900">
                {gasto.supplier_dv ?? <span className="font-sans text-gray-400">—</span>}
              </dd>
            </div>
          </dl>
        )}
      </div>

      {/* ── Avisos ─────────────────────────────────────────────────── */}
      {/* Aviso de gasto histórico.
          🎨 ÁMBAR Y NO ROJO, deliberadamente. Rojo dice "algo se rompió"; acá no
          se rompió nada. Es TRABAJO PENDIENTE que hasta hoy era invisible: el
          gasto se cargó cuando el sistema no pedía la cuenta. El ícono es un
          reloj y no un triángulo por el mismo motivo. */}
      {sinClasificar && (
        <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <History size={18} className="mt-0.5 shrink-0 text-amber-600" />
          <div className="text-sm text-amber-800">
            <p className="font-semibold">Gasto histórico, sin cuenta contable todavía.</p>
            <p className="mt-1">
              Se cargó antes de que el sistema pidiera la cuenta, así que{" "}
              <strong>nadie la clasificó</strong>. No se le asignó una por defecto a
              propósito: pudo haber sido fondo del cliente o costo propio del bufete, y
              suponerlo sería inventar el dato.
            </p>
            <p className="mt-2">
              Mientras no tenga cuenta,{" "}
              <strong>este gasto no se puede registrar en el libro contable</strong>. Los
              gastos <strong>nuevos ya no pueden quedar así</strong>: el formulario exige
              la cuenta de cada línea al crearlos.
            </p>
          </div>
        </div>
      )}

      {hayDescuadre && (
        <div className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-600" />
          <div className="text-sm text-red-800">
            <p className="font-semibold">
              El total de las líneas no coincide con el monto del encabezado.
            </p>
            <p className="mt-1">
              Líneas B/. {fmtMoney(gasto.totales.total)} · encabezado B/.{" "}
              {fmtMoney(gasto.amount)} · diferencia B/. {fmtMoney(descuadre)}. El asiento
              se arma con las <strong>líneas</strong>. Avise antes de registrarlo.
            </p>
          </div>
        </div>
      )}

      {puedePostear && (
        <PostToLedgerButton expenseId={gasto.id} total={fmtMoney(gasto.totales.total)} />
      )}

      {/* ── Líneas ─────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-100 px-5 py-3">
          <Scale size={16} className="text-integra-gold" />
          <h2 className="font-semibold text-integra-navy">Detalle contable</h2>
          <span className="text-xs text-gray-400">
            {gasto.lineas.length} {gasto.lineas.length === 1 ? "línea" : "líneas"}
          </span>
        </div>

        {gasto.lineas.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-gray-400">
            Este gasto todavía no tiene líneas.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left">
                  <th className="px-4 py-2 font-semibold text-gray-600">#</th>
                  <th className="px-4 py-2 font-semibold text-gray-600">Descripción</th>
                  <th className="px-4 py-2 font-semibold text-gray-600">Cuenta</th>
                  <th className="px-4 py-2 text-right font-semibold text-gray-600">Base</th>
                  <th className="px-4 py-2 text-right font-semibold text-gray-600">ITBMS</th>
                  <th className="px-4 py-2 text-right font-semibold text-gray-600">Total</th>
                </tr>
              </thead>
              <tbody>
                {gasto.lineas.map((l) => {
                  const falta = !l.chart_account_code;
                  return (
                    <tr key={l.id} className="border-b last:border-0">
                      <td className="px-4 py-2.5 text-gray-400">{l.line_order}</td>
                      <td className="px-4 py-2.5 text-gray-900">{l.description}</td>
                      <td className="px-4 py-2.5">
                        <span
                          className={
                            falta
                              ? "rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800"
                              : "font-mono text-xs text-gray-700"
                          }
                        >
                          {falta ? LABEL_SIN_CLASIFICAR : cuentaLabel(l)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-gray-900">
                        {fmtMoney(l.amount)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">
                        {l.tax_amount === 0 ? (
                          <span className="text-gray-300">—</span>
                        ) : (
                          <>
                            {fmtMoney(l.tax_amount)}
                            <span className="ml-1 text-xs text-gray-400">
                              ({tasaLabel(l.tax_rate)})
                            </span>
                          </>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-gray-900">
                        {fmtMoney(l.line_total)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 font-semibold">
                  <td colSpan={3} className="px-4 py-2.5 text-right text-gray-600">
                    Totales
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-900">
                    {fmtMoney(gasto.totales.base)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-900">
                    {fmtMoney(gasto.totales.impuesto)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-integra-navy">
                    {fmtMoney(gasto.totales.total)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* ── Comprobante ────────────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex items-center gap-2">
          <FileText size={16} className="text-integra-gold" />
          <h2 className="font-semibold text-integra-navy">Comprobante</h2>
        </div>

        {gasto.tiene_comprobante ? (
          <>
            {/* nav-guard-ok: es una ruta de /api, no una pantalla; sirve el
                archivo por el dominio de la app y los cuatro roles la pueden
                llamar (ver el encabezado de esa ruta). */}
            <a
              href={`/api/expenses/${gasto.id}/receipt/download`}
              className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-md border border-integra-navy px-4 text-sm font-semibold text-integra-navy hover:bg-integra-navy hover:text-white"
            >
              <Download size={16} />
              Descargar {gasto.receipt_filename ?? "comprobante"}
            </a>
            <p className="mt-2 text-xs text-gray-400">
              Se sirve por el dominio de la aplicación, no por un enlace directo al
              almacenamiento.
            </p>
          </>
        ) : (
          <p className="mt-3 text-sm text-gray-400">Sin comprobante adjunto.</p>
        )}
      </div>

      <p className="text-xs text-gray-400">
        Vista de solo lectura. Esta pantalla muestra la información contable del gasto y el
        número del caso al que pertenece; el contenido del expediente no se expone acá.
      </p>
    </div>
  );
}
