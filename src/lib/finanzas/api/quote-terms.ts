/**
 * Helpers server-side para la plantilla de Términos y Condiciones (D4, D9).
 *
 * Una fila por tenant en `quote_terms_template` (UNIQUE constraint en
 * tenant_id; sin DEFAULT get_tenant_id() — siempre INSERT explícito).
 *
 * Permisos (gate en route handlers, NO en RLS):
 *   - GET: admin, abogada, contador (cualquier rol que use cotizaciones).
 *   - PUT: solo admin (D9).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { MutationError, pgErrorToMessage } from "@/lib/finanzas/api/errors";

type DB = SupabaseClient;

const FALLBACK_TEMPLATE = `Términos y Condiciones

(Plantilla no configurada — el administrador del bufete debe definirla en
el módulo de Configuración de Finanzas antes de enviar cotizaciones.)`;

/**
 * Devuelve el contenido del template del tenant. Si no existe fila (caso
 * raro: tenant nuevo creado después del seed), devuelve un fallback con
 * mensaje claro para que la abogada sepa que falta configurar.
 */
export async function getTermsTemplate(db: DB, tenantId: string): Promise<string> {
  const { data, error } = await db
    .from("quote_terms_template")
    .select("content")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    console.error("[finanzas/quote-terms] getTermsTemplate failed", error);
    return FALLBACK_TEMPLATE;
  }
  if (!data) return FALLBACK_TEMPLATE;
  return (data.content as string) ?? FALLBACK_TEMPLATE;
}

/**
 * Devuelve el row completo (incluye updated_at + updated_by) para mostrar
 * en la pantalla de configuración.
 */
export async function getTermsTemplateRow(
  db: DB,
  tenantId: string
): Promise<{ content: string; updated_at: string | null; updated_by: string | null }> {
  const { data, error } = await db
    .from("quote_terms_template")
    .select("content, updated_at, updated_by")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    console.error("[finanzas/quote-terms] getTermsTemplateRow failed", error);
    return { content: FALLBACK_TEMPLATE, updated_at: null, updated_by: null };
  }
  if (!data) return { content: FALLBACK_TEMPLATE, updated_at: null, updated_by: null };
  return {
    content: (data.content as string) ?? FALLBACK_TEMPLATE,
    updated_at: (data.updated_at as string | null) ?? null,
    updated_by: (data.updated_by as string | null) ?? null,
  };
}

/**
 * UPSERT de la plantilla. El gate de admin se enforza en el route handler
 * (no en RLS). Validación: content trimeado debe tener al menos 10 chars
 * (filtro defensivo contra envíos accidentales vacíos).
 */
export async function updateTermsTemplate(
  db: DB,
  tenantId: string,
  userId: string,
  rawContent: string
): Promise<void> {
  const content = String(rawContent ?? "").trim();
  if (content.length < 10) {
    throw new MutationError(
      "El contenido de la plantilla debe tener al menos 10 caracteres.",
      400
    );
  }

  const { error } = await db
    .from("quote_terms_template")
    .upsert(
      {
        tenant_id: tenantId,
        content,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id" }
    );

  if (error) {
    throw new MutationError(pgErrorToMessage(error), 400, error);
  }
}
