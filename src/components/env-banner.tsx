import { currentAppEnv, envBadge } from "@/lib/env/app-env";

/**
 * Banda de entorno. Se muestra en TODA pantalla — incluido el login y el portal
 * público de cotizaciones — salvo en producción, donde no renderiza nada.
 *
 * Decisiones deliberadas:
 *   - `sticky top-0`: queda pegada arriba de todo mientras se scrollea. El
 *     header de la app se pega justo debajo (usa `top-[var(--env-band-h)]`).
 *   - Rayas diagonales: ningún otro elemento del CRM las tiene. Se reconoce con
 *     el rabillo del ojo, sin leer.
 *   - Ámbar / violeta / rojo: los tres bien lejos del navy y el dorado de la
 *     paleta Integra, para que nunca se lea como parte del diseño normal.
 *   - Sin botón de cerrar. Una banda que se puede ocultar no sirve para esto.
 *   - Server Component sin estado: se decide en el render y no parpadea.
 *
 * La altura vive en `--env-band-h` (globals.css) y la activa el atributo
 * `data-env-band` del <html> en app/layout.tsx. Los offsets del header y del
 * sidebar leen esa variable, así que la banda no pisa nada.
 */
export function EnvBanner() {
  const badge = envBadge(currentAppEnv());
  if (!badge) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-[60] flex h-7 w-full items-center justify-center gap-2 overflow-hidden px-3 text-[11px] font-bold uppercase tracking-wider"
      style={{
        color: badge.foreground,
        backgroundColor: badge.background,
        backgroundImage:
          "repeating-linear-gradient(45deg, rgba(255,255,255,0.14) 0 10px, transparent 10px 20px)",
      }}
    >
      <span className="whitespace-nowrap">{badge.label}</span>
      <span className="hidden truncate font-medium normal-case tracking-normal opacity-90 sm:inline">
        · {badge.detail}
      </span>
    </div>
  );
}
