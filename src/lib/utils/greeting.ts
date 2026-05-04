/**
 * Devuelve el saludo apropiado ("Buenos días" / "Buenas tardes" / "Buenas noches")
 * según la hora actual en zona horaria de Panamá (UTC-5, sin DST).
 *
 * Rangos:
 *   - 05:00–11:59 → "Buenos días"
 *   - 12:00–18:59 → "Buenas tardes"
 *   - 19:00–04:59 → "Buenas noches"
 */
export function getGreetingPanama(now: Date = new Date()): string {
  const panama = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  const hour = panama.getUTCHours();
  if (hour >= 5 && hour < 12) return "Buenos días";
  if (hour >= 12 && hour < 19) return "Buenas tardes";
  return "Buenas noches";
}
