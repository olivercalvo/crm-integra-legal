import Link from "next/link";
import { ChevronLeft, ChevronRight, Download, FileText, Filter, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { VerificarIntegridad } from "@/components/auditoria/verificar-integridad";
import {
  cambiosLegibles,
  ETIQUETA_ACCION,
  ETIQUETA_ORIGEN,
  ETIQUETA_TABLA,
  etiquetaDeUsuario,
  GRUPOS,
  horaDePanama,
  type FilaBitacora,
  type FiltrosBitacora,
  type ModuloBitacora,
} from "@/lib/auditoria/bitacoras";

interface Props {
  modulo: ModuloBitacora;
  titulo: string;
  descripcion: string;
  filas: FilaBitacora[];
  total: number;
  pagina: number;
  porPagina: number;
  filtros: FiltrosBitacora;
  usuarios: { id: string; full_name: string | null; email: string | null }[];
  /** Ruta de esta pantalla, para los filtros y la paginación. */
  ruta: string;
  rutaExport: string;
  rutaVerificar: string;
  /** Enlace opcional al registro anterior (audit_log), mientras no se copie el legado. */
  enlaceAnterior?: string;
}

const CAMPO = "min-h-[44px] w-full rounded-md border border-gray-300 bg-white px-3 text-sm";

function query(filtros: FiltrosBitacora, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...filtros, ...extra })) if (v) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

function ColorAccion({ accion }: { accion: string }) {
  const rojo = ["eliminar", "anular", "anular_dgi", "reversar", "desactivar", "reabrir"];
  const verde = ["crear", "emitir", "contabilizar", "aplicar", "registrar_en_libro", "activar"];
  const cls = rojo.includes(accion)
    ? "bg-red-50 text-red-800 border-red-200"
    : verde.includes(accion)
      ? "bg-green-50 text-green-800 border-green-200"
      : "bg-amber-50 text-amber-800 border-amber-200";
  return (
    <Badge variant="outline" className={`text-xs font-medium ${cls}`}>
      {ETIQUETA_ACCION[accion] ?? accion}
    </Badge>
  );
}

function Cambios({ fila }: { fila: FilaBitacora }) {
  const lineas = cambiosLegibles(fila.cambios);
  if (lineas.length === 0) return <span className="text-gray-400">Sin detalle de campos</span>;
  return (
    <ul className="space-y-0.5">
      {lineas.slice(0, 8).map((l, i) => (
        <li key={i} className="break-words font-mono text-xs text-gray-600">{l.length > 160 ? `${l.slice(0, 160)}…` : l}</li>
      ))}
      {lineas.length > 8 && <li className="text-xs text-gray-400">y {lineas.length - 8} campos más (en el Excel)</li>}
    </ul>
  );
}

/** La pantalla de una bitácora. Sólo lectura: no hay ningún botón que escriba. */
export function VistaBitacora(p: Props) {
  const totalPaginas = Math.max(1, Math.ceil(p.total / p.porPagina));
  const grupos = GRUPOS[p.modulo];
  const hayFiltros = Object.values(p.filtros).some(Boolean);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-integra-navy">{p.titulo}</h2>
          <p className="text-sm text-gray-500">{p.descripcion}</p>
          <p className="text-sm text-gray-500">
            {p.total.toLocaleString("es-PA")} registro{p.total === 1 ? "" : "s"}. Hora de Panamá.
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <Button asChild variant="outline" className="min-h-[48px] gap-2">
            <a href={`${p.rutaExport}${query(p.filtros)}`}>
              <Download size={16} />
              Exportar a Excel
            </a>
          </Button>
          <VerificarIntegridad ruta={p.rutaVerificar} />
        </div>
      </div>

      <form method="get" action={p.ruta} className="space-y-3 rounded-xl border bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2 text-sm font-semibold text-integra-navy">
          <Filter size={15} />
          Filtros
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1 text-sm">
            <span className="text-gray-600">Desde</span>
            <input type="date" name="desde" defaultValue={p.filtros.desde ?? ""} className={CAMPO} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-gray-600">Hasta</span>
            <input type="date" name="hasta" defaultValue={p.filtros.hasta ?? ""} className={CAMPO} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-gray-600">Usuario</span>
            <select name="usuario" defaultValue={p.filtros.usuario ?? ""} className={CAMPO}>
              <option value="">Todos</option>
              {p.usuarios.map((u) => (
                <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-gray-600">Módulo</span>
            <select name="grupo" defaultValue={p.filtros.grupo ?? ""} className={CAMPO}>
              <option value="">Todos</option>
              {Object.entries(grupos).map(([k, g]) => (
                <option key={k} value={k}>{g.etiqueta}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-gray-600">Acción</span>
            <select name="accion" defaultValue={p.filtros.accion ?? ""} className={CAMPO}>
              <option value="">Todas</option>
              {Object.entries(ETIQUETA_ACCION).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-gray-600">Documento</span>
            <input
              type="text"
              name="documento"
              defaultValue={p.filtros.documento ?? ""}
              placeholder={p.modulo === "contable" ? "FAC-HON-000022" : "Código del caso o cliente"}
              className={CAMPO}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-gray-600">Origen</span>
            <select name="origen" defaultValue={p.filtros.origen ?? ""} className={CAMPO}>
              <option value="">Todos</option>
              {Object.entries(ETIQUETA_ORIGEN).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </label>
          <div className="flex items-end gap-2">
            <Button type="submit" className="min-h-[44px] flex-1 gap-2">
              <Filter size={15} />
              Aplicar
            </Button>
            {hayFiltros && (
              <Button asChild variant="outline" className="min-h-[44px] gap-1">
                <Link href={p.ruta}>
                  <X size={15} />
                  Limpiar
                </Link>
              </Button>
            )}
          </div>
        </div>
      </form>

      {p.filas.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
          <FileText size={40} className="mb-3 text-gray-300" />
          <p className="font-medium text-gray-500">No hay registros con estos filtros</p>
        </div>
      ) : (
        <div className="space-y-3">
          {p.filas.map((f) => (
            <div key={f.id} className="rounded-xl border bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-mono text-xs text-gray-500">{horaDePanama(f.ocurrido_en)}</span>
                  <ColorAccion accion={f.accion} />
                  <span className="font-medium text-integra-navy">{ETIQUETA_TABLA[f.tabla] ?? f.tabla}</span>
                  {f.documento && <span className="font-mono text-xs text-gray-700">{f.documento}</span>}
                </div>
                <div className="text-right text-xs text-gray-500">
                  <span className="font-medium text-gray-700">{etiquetaDeUsuario(f)}</span>
                  {f.rol && <span> · {f.rol}</span>}
                  {f.origen !== "usuario" && <span> · {ETIQUETA_ORIGEN[f.origen]}</span>}
                </div>
              </div>
              <div className="mt-2">
                <Cambios fila={f} />
              </div>
            </div>
          ))}
        </div>
      )}

      {totalPaginas > 1 && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-gray-500">
            Página {p.pagina} de {totalPaginas}
          </p>
          <div className="flex gap-2">
            {p.pagina > 1 && (
              <Button asChild variant="outline" className="min-h-[44px] gap-1">
                <Link href={`${p.ruta}${query(p.filtros, { pagina: String(p.pagina - 1) })}`}>
                  <ChevronLeft size={15} />
                  Anterior
                </Link>
              </Button>
            )}
            {p.pagina < totalPaginas && (
              <Button asChild variant="outline" className="min-h-[44px] gap-1">
                <Link href={`${p.ruta}${query(p.filtros, { pagina: String(p.pagina + 1) })}`}>
                  Siguiente
                  <ChevronRight size={15} />
                </Link>
              </Button>
            )}
          </div>
        </div>
      )}

      {p.enlaceAnterior && (
        <p className="text-sm text-gray-500">
          Los cambios anteriores a esta bitácora siguen en el{" "}
          <Link href={p.enlaceAnterior} className="font-medium text-integra-navy underline">
            registro anterior
          </Link>
          , hasta que se copien acá.
        </p>
      )}
    </div>
  );
}
