/**
 * Bitácoras de auditoría: lectura, verificación y exportación (03/10/2026).
 *
 * Las filas las escribe la BASE (triggers de la 087) y nadie las edita ni las
 * borra (086). Desde la app sólo se leen, por dos RPC con EXECUTE para
 * service_role: `bitacora_leer` y `bitacora_verificar`. Como el posteo del libro,
 * la ruta pasa el tenant y el usuario SACADOS DEL PERFIL y la función vuelve a
 * verificar el rol (contable: admin y contador; legal: admin).
 *
 * Lo usan las dos pantallas y sus exportaciones: una sola lectura, una sola
 * forma de armar el Excel.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { texto, type Celda, type HojaExport } from "@/lib/finanzas/reports/exportar-xlsx";

export type ModuloBitacora = "contable" | "legal";

/** Quién ve cada bitácora. Lo vuelve a exigir la base (`auditoria.exigir_lector`). */
export const LECTORES: Record<ModuloBitacora, readonly string[]> = {
  contable: ["admin", "contador"],
  legal: ["admin"],
};

export interface FilaBitacora {
  id: number;
  evento_id: string;
  ocurrido_en: string;
  usuario_id: string | null;
  usuario_nombre: string | null;
  rol: string | null;
  accion: string;
  tabla: string;
  registro_id: string | null;
  documento: string | null;
  cambios: Record<string, [unknown, unknown]>;
  origen: "usuario" | "sistema" | "legado";
}

export interface FiltrosBitacora {
  /** AAAA-MM-DD, día de Panamá. */
  desde?: string;
  hasta?: string;
  usuario?: string;
  accion?: string;
  grupo?: string;
  documento?: string;
  origen?: string;
}

/** Los «módulos» de cada pantalla, como grupos de tablas. */
export const GRUPOS: Record<ModuloBitacora, Record<string, { etiqueta: string; tablas: string[] }>> = {
  contable: {
    ventas: {
      etiqueta: "Ventas y DGI",
      tablas: ["invoices", "invoice_lines", "credit_notes", "credit_note_lines", "credit_note_applications",
        "fe_emisiones", "fe_anulaciones", "clients"],
    },
    cobros: { etiqueta: "Cobros", tablas: ["payments", "payment_applications", "payment_reversals"] },
    compras: {
      etiqueta: "Compras y pagos",
      tablas: ["business_expenses", "expense_lines", "expenses", "supplier_payments", "supplier_credit_notes",
        "supplier_credit_note_lines", "supplier_credit_note_applications", "tax_payments"],
    },
    libro: { etiqueta: "Libro y períodos", tablas: ["journal_entries", "journal_imports", "accounting_periods"] },
    catalogos: {
      etiqueta: "Catálogos",
      tablas: ["chart_of_accounts", "tax_codes", "services_catalog", "numbering_sequences", "suppliers"],
    },
    configuracion: { etiqueta: "Configuración y accesos", tablas: ["finanzas_parametros", "users"] },
    cotizaciones: { etiqueta: "Cotizaciones", tablas: ["quotes", "quote_lines", "quote_terms_template"] },
  },
  legal: {
    clientes: { etiqueta: "Clientes", tablas: ["clients"] },
    casos: { etiqueta: "Casos", tablas: ["cases", "comments", "tasks", "documents"] },
    gastos: { etiqueta: "Gastos y cobros del caso", tablas: ["expenses", "expense_lines", "client_payments"] },
    catalogos: {
      etiqueta: "Catálogos",
      tablas: ["cat_classifications", "cat_institutions", "cat_statuses", "cat_team"],
    },
    usuarios: { etiqueta: "Usuarios", tablas: ["users"] },
  },
};

export const ETIQUETA_ACCION: Record<string, string> = {
  crear: "Crear",
  editar: "Editar",
  eliminar: "Eliminar",
  emitir: "Emitir",
  anular: "Anular",
  reversar: "Reversar",
  aplicar: "Aplicar",
  contabilizar: "Contabilizar",
  cierre_anual: "Cierre anual",
  apertura: "Apertura",
  enviar_dgi: "Enviar a la DGI",
  anular_dgi: "Anular ante la DGI",
  marcar_interna: "Marcar interna",
  cargar_cufe: "Cargar CUFE",
  registrar_en_libro: "Registrar en el libro",
  cerrar: "Cerrar período",
  reabrir: "Reabrir período",
  cambiar_rol: "Cambiar rol",
  activar: "Activar",
  desactivar: "Desactivar",
  cancelar: "Cancelar",
  enviar: "Enviar",
  aceptar: "Aceptar",
  rechazar: "Rechazar",
  cumplir: "Cumplir",
};

export const ETIQUETA_TABLA: Record<string, string> = {
  invoices: "Factura",
  invoice_lines: "Línea de factura",
  credit_notes: "Nota de crédito",
  credit_note_lines: "Línea de NC",
  credit_note_applications: "Aplicación de NC",
  fe_emisiones: "Envío a la DGI",
  fe_anulaciones: "Anulación ante la DGI",
  payments: "Cobro",
  payment_applications: "Aplicación de cobro",
  payment_reversals: "Reversión de cobro",
  business_expenses: "Compra",
  expense_lines: "Línea de gasto",
  expenses: "Gasto de trámite",
  supplier_payments: "Pago a proveedor",
  supplier_credit_notes: "NC de proveedor",
  supplier_credit_note_lines: "Línea de NC de proveedor",
  supplier_credit_note_applications: "Aplicación de NC de proveedor",
  tax_payments: "Pago de impuesto",
  journal_entries: "Asiento",
  journal_imports: "Importación de asientos",
  accounting_periods: "Período contable",
  chart_of_accounts: "Cuenta contable",
  tax_codes: "Tasa de impuesto",
  services_catalog: "Servicio",
  numbering_sequences: "Serie de numeración",
  suppliers: "Proveedor",
  finanzas_parametros: "Parámetros contables",
  quotes: "Cotización",
  quote_lines: "Línea de cotización",
  quote_terms_template: "Plantilla de términos",
  clients: "Cliente",
  users: "Usuario",
  cases: "Caso",
  comments: "Comentario",
  tasks: "Tarea",
  documents: "Documento",
  client_payments: "Cobro del caso",
  cat_classifications: "Clasificación",
  cat_institutions: "Institución",
  cat_statuses: "Estado de caso",
  cat_team: "Equipo",
};

export const ETIQUETA_ORIGEN: Record<string, string> = {
  usuario: "Usuario",
  sistema: "Sistema",
  legado: "Registro anterior",
};

const DIA = /^\d{4}-\d{2}-\d{2}$/;

/** El día de Panamá como instante: 00:00 en UTC−5 (Panamá no tiene horario de verano). */
export function inicioDelDiaEnPanama(dia: string): string {
  return `${dia}T00:00:00-05:00`;
}

function diaSiguiente(dia: string): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Lee los filtros de la URL sin confiar en nada: lo que no tiene forma se ignora. */
export function filtrosDesdeParams(modulo: ModuloBitacora, sp: Record<string, string | undefined>): FiltrosBitacora {
  const f: FiltrosBitacora = {};
  if (sp.desde && DIA.test(sp.desde)) f.desde = sp.desde;
  if (sp.hasta && DIA.test(sp.hasta)) f.hasta = sp.hasta;
  if (sp.usuario && /^[0-9a-f-]{36}$/i.test(sp.usuario)) f.usuario = sp.usuario;
  if (sp.accion && ETIQUETA_ACCION[sp.accion]) f.accion = sp.accion;
  if (sp.grupo && GRUPOS[modulo][sp.grupo]) f.grupo = sp.grupo;
  if (sp.documento && sp.documento.trim()) f.documento = sp.documento.trim().slice(0, 60);
  if (sp.origen && ETIQUETA_ORIGEN[sp.origen]) f.origen = sp.origen;
  return f;
}

export async function leerBitacora(
  db: SupabaseClient,
  modulo: ModuloBitacora,
  tenantId: string,
  usuarioId: string,
  filtros: FiltrosBitacora,
  pagina: { limite: number; offset: number }
): Promise<{ filas: FilaBitacora[]; total: number }> {
  const { data, error } = await db.rpc("bitacora_leer", {
    p_modulo: modulo,
    p_tenant_id: tenantId,
    p_usuario_id: usuarioId,
    p_desde: filtros.desde ? inicioDelDiaEnPanama(filtros.desde) : null,
    p_hasta: filtros.hasta ? inicioDelDiaEnPanama(diaSiguiente(filtros.hasta)) : null,
    p_filtro_usuario: filtros.usuario ?? null,
    p_accion: filtros.accion ?? null,
    p_tablas: filtros.grupo ? GRUPOS[modulo][filtros.grupo].tablas : null,
    p_documento: filtros.documento ?? null,
    p_origen: filtros.origen ?? null,
    p_limite: pagina.limite,
    p_offset: pagina.offset,
  });
  if (error) throw new Error(error.message);
  const filas = (data ?? []) as (FilaBitacora & { total: number })[];
  return { filas, total: filas.length > 0 ? Number(filas[0].total) : 0 };
}

export interface ResultadoVerificacion {
  modulo: ModuloBitacora;
  filas: number;
  filas_alteradas: number[];
  anclas: number;
  anclas_que_no_coinciden: { ancla: number; referencia: string; fila: number }[];
  integra: boolean;
}

export async function verificarBitacora(
  db: SupabaseClient,
  modulo: ModuloBitacora,
  tenantId: string,
  usuarioId: string
): Promise<ResultadoVerificacion> {
  const { data, error } = await db.rpc("bitacora_verificar", {
    p_modulo: modulo,
    p_tenant_id: tenantId,
    p_usuario_id: usuarioId,
  });
  if (error) throw new Error(error.message);
  return data as ResultadoVerificacion;
}

/** Fecha y hora de Panamá, «03/10/2026 14:05». */
export function horaDePanama(iso: string): string {
  const p = new Intl.DateTimeFormat("es-PA", {
    timeZone: "America/Panama",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${v("day")}/${v("month")}/${v("year")} ${v("hour")}:${v("minute")}`;
}

/** Un valor del antes o el después, para leer. Vacío se muestra vacío. */
export function valorLegible(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "Sí" : "No";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Cada campo cambiado como «campo: antes → después», uno por línea. */
export function cambiosLegibles(cambios: FilaBitacora["cambios"]): string[] {
  return Object.entries(cambios ?? {}).map(([campo, par]) => {
    const [antes, despues] = Array.isArray(par) ? par : [null, par];
    const a = valorLegible(antes);
    const d = valorLegible(despues);
    if (!a) return `${campo}: ${d}`;
    if (!d) return `${campo}: ${a} (quitado)`;
    return `${campo}: ${a} → ${d}`;
  });
}

export function etiquetaDeUsuario(f: Pick<FilaBitacora, "usuario_nombre" | "usuario_id" | "origen">): string {
  if (f.usuario_nombre) return f.usuario_nombre;
  if (f.usuario_id) return "Usuario sin ficha";
  return "Sistema";
}

/** La hoja de Excel: una fila por campo cambiado, para poder filtrar por campo. */
export function hojaDeBitacora(modulo: ModuloBitacora, filas: FilaBitacora[], filtrosTexto: string): HojaExport {
  const out: Celda[][] = [];
  for (const f of filas) {
    const base: Celda[] = [
      texto(horaDePanama(f.ocurrido_en)),
      texto(etiquetaDeUsuario(f)),
      texto(f.rol),
      texto(ETIQUETA_ACCION[f.accion] ?? f.accion),
      texto(ETIQUETA_TABLA[f.tabla] ?? f.tabla),
      texto(f.documento),
      texto(ETIQUETA_ORIGEN[f.origen] ?? f.origen),
    ];
    const campos = Object.entries(f.cambios ?? {});
    if (campos.length === 0) {
      out.push([...base, texto(null), texto(null), texto(null), texto(f.evento_id)]);
    }
    for (const [campo, par] of campos) {
      const [antes, despues] = Array.isArray(par) ? par : [null, par];
      out.push([...base, texto(campo), texto(valorLegible(antes)), texto(valorLegible(despues)), texto(f.evento_id)]);
    }
  }
  return {
    nombre: modulo === "contable" ? "Bitácora contable" : "Bitácora legal",
    encabezado: [
      [modulo === "contable" ? "Bitácora contable" : "Bitácora legal"],
      [`Hora de Panamá. ${filtrosTexto}`],
    ],
    columnas: [
      { titulo: "Fecha y hora", ancho: 17 },
      { titulo: "Usuario", ancho: 26 },
      { titulo: "Rol", ancho: 11 },
      { titulo: "Acción", ancho: 20 },
      { titulo: "Registro", ancho: 22 },
      { titulo: "Documento", ancho: 18 },
      { titulo: "Origen", ancho: 14 },
      { titulo: "Campo", ancho: 24 },
      { titulo: "Antes", ancho: 30 },
      { titulo: "Después", ancho: 30 },
      { titulo: "Evento", ancho: 38 },
    ],
    filas: out,
  };
}

/** Los filtros en palabras, para el encabezado del Excel. */
export function describirFiltros(modulo: ModuloBitacora, f: FiltrosBitacora): string {
  const partes: string[] = [];
  if (f.desde) partes.push(`desde ${f.desde}`);
  if (f.hasta) partes.push(`hasta ${f.hasta}`);
  if (f.grupo) partes.push(`módulo ${GRUPOS[modulo][f.grupo].etiqueta}`);
  if (f.accion) partes.push(`acción ${ETIQUETA_ACCION[f.accion]}`);
  if (f.documento) partes.push(`documento «${f.documento}»`);
  if (f.origen) partes.push(`origen ${ETIQUETA_ORIGEN[f.origen]}`);
  if (f.usuario) partes.push("un usuario");
  return partes.length ? `Filtros: ${partes.join(", ")}.` : "Sin filtros.";
}

/** Tope del Excel: una exportación no es un respaldo. */
export const MAX_FILAS_EXPORT = 20000;
