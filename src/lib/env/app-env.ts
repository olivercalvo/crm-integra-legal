/**
 * Identidad del entorno en el que corre la app.
 *
 * Existe desde Fase 0 (2026-08-25), cuando se separó la base de staging de la de
 * producción. Antes de eso, localhost escribía en la base real del bufete y no
 * había ninguna señal en pantalla que lo dijera.
 *
 * Por qué importa: el módulo contable escribe asientos INMUTABLES (los triggers
 * de `023_contabilidad_fase1_ledger.sql` rechazan UPDATE y DELETE). Una prueba
 * hecha contra producción por error no se puede borrar — queda en los libros que
 * el contador certifica ante la DGI. La única defensa contra eso, del lado
 * humano, es que sea imposible confundirse de entorno de un vistazo.
 *
 * Módulo PURO: sin I/O, sin React. Lo usan el banner (cliente) y el seed (Node).
 */

/**
 * Project refs de Supabase que son PRODUCCIÓN.
 *
 * El ref NO es secreto: viaja en `NEXT_PUBLIC_SUPABASE_URL` a todo navegador que
 * abre la app. Está acá justamente para poder compararlo — es la fuente única
 * que usan tanto el fallback de `resolveAppEnv()` como el candado de
 * `scripts/seed-staging.ts`.
 *
 * ⚠️ ESTA LISTA ESTÁ REPETIDA EN TRES ARCHIVOS. Los otros dos corren con `node`
 * y no pueden importar este módulo TypeScript:
 *   - `scripts/backup-supabase.mjs`   (aborta si el ref NO es de producción)
 *   - `scripts/apply-staging-sql.mjs` (aborta si el ref SÍ es de producción)
 * Si alguna vez cambia el proyecto de producción, hay que tocar los tres.
 */
export const PROD_PROJECT_REFS = ["uqmmkklbhzxqybljiecs"] as const;

export type AppEnv = "production" | "staging" | "local" | "unknown";

/** Extrae el project ref de una URL de Supabase. "" si no parsea. */
export function projectRefOf(url: string | undefined | null): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.split(".")[0];
  } catch {
    return "";
  }
}

export function isProdProjectRef(url: string | undefined | null): boolean {
  const ref = projectRefOf(url);
  return ref !== "" && (PROD_PROJECT_REFS as readonly string[]).includes(ref);
}

/**
 * Resuelve el entorno.
 *
 * 1. `NEXT_PUBLIC_APP_ENV` explícito manda.
 * 2. Si no está seteada, se cae al project ref de Supabase: si es el de
 *    producción, es producción.
 * 3. Cualquier otra cosa → "unknown", y el banner lo grita en rojo.
 *
 * El paso 2 existe para que olvidarse de cargar la variable en Vercel NO le
 * ponga una banda de alerta enfrente a las licenciadas. El fallback resuelve
 * "producción" solo cuando la base ES la de producción; ante la duda, avisa.
 */
export function resolveAppEnv(
  appEnv: string | undefined | null,
  supabaseUrl: string | undefined | null
): AppEnv {
  const declared = (appEnv ?? "").trim().toLowerCase();
  if (declared === "production" || declared === "prod") return "production";
  if (declared === "staging" || declared === "preview") return "staging";
  if (declared === "local" || declared === "development" || declared === "dev") {
    return "local";
  }
  if (isProdProjectRef(supabaseUrl)) return "production";
  return "unknown";
}

/** El entorno de ESTE proceso, leído de las env vars públicas. */
export function currentAppEnv(): AppEnv {
  return resolveAppEnv(
    process.env.NEXT_PUBLIC_APP_ENV,
    process.env.NEXT_PUBLIC_SUPABASE_URL
  );
}

export interface EnvBadge {
  /** Texto corto y en mayúsculas: lo que se lee de un vistazo. */
  label: string;
  /** Aclaración de una línea, se oculta en pantallas chicas. */
  detail: string;
  background: string;
  foreground: string;
}

const BADGES: Record<Exclude<AppEnv, "production">, EnvBadge> = {
  staging: {
    label: "STAGING — DATOS DE PRUEBA",
    detail: "Esta NO es la base del bufete. Nada de lo que hagas acá es real.",
    background: "#B45309", // ámbar oscuro: no se parece a nada de la paleta Integra
    foreground: "#FFFFFF",
  },
  local: {
    label: "LOCAL — DATOS DE PRUEBA",
    detail: "Desarrollo en tu máquina, contra la base de staging.",
    background: "#4C1D95", // violeta
    foreground: "#FFFFFF",
  },
  unknown: {
    label: "⚠ ENTORNO SIN DEFINIR",
    detail: "Falta NEXT_PUBLIC_APP_ENV. No confíes en esta pantalla hasta saber contra qué base corre.",
    background: "#991B1B", // rojo
    foreground: "#FFFFFF",
  },
};

/**
 * El distintivo a mostrar, o `null` en producción — donde la app se ve limpia,
 * sin banda, y esa ausencia es en sí misma la señal de "acá es en serio".
 */
export function envBadge(env: AppEnv): EnvBadge | null {
  return env === "production" ? null : BADGES[env];
}
