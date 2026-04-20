/**
 * Classification color mapping.
 * Colors are stored in cat_classifications.color but these are defaults.
 * Official colors from Integra Legal's Excel (2026-04-08).
 */

export const DEFAULT_CLASSIFICATION_COLORS: Record<string, string> = {
  CORPORATIVO: "#1F4E79",
  REGULATORIO: "#F57F17",
  "MIGRACIÓN": "#2E7D32",
  MIGRATORIO: "#2E7D32",
  LABORAL: "#E65100",
  PENAL: "#B71C1C",
  CIVIL: "#6A1B9A",
  ADMINISTRATIVO: "#455A64",
  EXTRAJUDICIAL: "#00695C",
};

/** Get the color for a classification, falling back to defaults */
export function getClassificationColor(name: string, dbColor?: string | null): string {
  if (dbColor) return dbColor;
  const upper = name.toUpperCase();
  for (const [key, color] of Object.entries(DEFAULT_CLASSIFICATION_COLORS)) {
    if (upper.includes(key)) return color;
  }
  return "#6B7280"; // default gray
}

/** Get a light background color from a hex color (for badges) */
export function getClassificationBgColor(hex: string): string {
  return `${hex}15`; // 15 = ~8% opacity in hex
}

/** Get the text color for a classification badge.
 *  REGULATORIO (#F57F17) uses dark text; all others use white. */
export function getClassificationTextColor(name: string, bgHex: string): string {
  // Light backgrounds need dark text
  if (bgHex.toUpperCase() === "#F57F17" || name.toUpperCase().includes("REGULATORIO")) {
    return "#1B2A4A";
  }
  return "#FFFFFF";
}
