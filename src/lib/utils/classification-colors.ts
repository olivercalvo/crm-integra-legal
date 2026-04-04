/**
 * Classification color mapping.
 * Colors are stored in cat_classifications.color but these are defaults.
 */

export const DEFAULT_CLASSIFICATION_COLORS: Record<string, string> = {
  CORPORATIVO: "#2563EB",
  REGULATORIO: "#16A34A",
  "MIGRACIÓN": "#EA580C",
  MIGRATORIO: "#EA580C",
  LABORAL: "#9333EA",
  PENAL: "#DC2626",
  CIVIL: "#0D9488",
  ADMINISTRATIVO: "#6B7280",
  COMERCIAL: "#2563EB",
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
