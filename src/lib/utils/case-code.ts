import type { SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_PREFIX = "EXP";

export function buildCaseCode(prefix: string, number: number): string {
  return `${prefix}-${String(number).padStart(3, "0")}`;
}

export function parseCaseNumberForPrefix(code: string | null | undefined, prefix: string): number | null {
  if (!code) return null;
  const match = code.match(new RegExp(`^${prefix}-(\\d+)$`));
  if (!match) return null;
  const num = parseInt(match[1], 10);
  return Number.isFinite(num) ? num : null;
}

export async function getClassificationPrefix(
  admin: SupabaseClient,
  classificationId: string | null | undefined
): Promise<string> {
  if (!classificationId) return DEFAULT_PREFIX;
  const { data } = await admin
    .from("cat_classifications")
    .select("prefix")
    .eq("id", classificationId)
    .single();
  return (data as { prefix?: string } | null)?.prefix?.trim() || DEFAULT_PREFIX;
}

export async function getMaxCaseNumberForPrefix(
  admin: SupabaseClient,
  tenantId: string,
  prefix: string
): Promise<number> {
  const { data } = await admin
    .from("cases")
    .select("case_code")
    .eq("tenant_id", tenantId)
    .ilike("case_code", `${prefix}-%`);

  let max = 0;
  for (const row of (data ?? []) as Array<{ case_code: string | null }>) {
    const n = parseCaseNumberForPrefix(row.case_code, prefix);
    if (n !== null && n > max) max = n;
  }
  return max;
}

export async function getNextCaseCodeForPrefix(
  admin: SupabaseClient,
  tenantId: string,
  prefix: string
): Promise<string> {
  const max = await getMaxCaseNumberForPrefix(admin, tenantId, prefix);
  return buildCaseCode(prefix, max + 1);
}
