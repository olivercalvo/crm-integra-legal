/**
 * Tipos para observation_templates — catálogo de plantillas de observaciones
 * reutilizables en el form de cotización (Sprint QUOTES-POLISH).
 *
 * Patrón análogo a quote_terms_template (Sprint 2E.3) pero con N filas por
 * tenant. CRUD admin-only (gate en API); GET abierto a admin+abogada+
 * contador. La UI de edición queda para el sprint ADMIN-CATALOGS futuro.
 */

/** Longitud máxima del content (alineado con CHECK de BD). */
export const OBSERVATION_TEMPLATE_CONTENT_MAX = 2000;
export const OBSERVATION_TEMPLATE_NAME_MAX = 120;

/**
 * Fila de observation_templates tal como sale del listado público.
 * No exponemos created_by / created_at hacia el cliente.
 */
export interface ObservationTemplate {
  id: string;
  name: string;
  content: string;
  sort_order: number | null;
}

/** Mismo shape que ObservationTemplate, alias para callers que prefieren el nombre largo. */
export type ObservationTemplateOption = ObservationTemplate;
