/**
 * Cuando falla el registro de auditoría (desde la migración 091).
 *
 * La captura de las bitácoras falla CERRADO: si la fila de bitácora no se puede
 * escribir, la base deshace el cambio entero. Desde la 091 ese error sale de la
 * base con SQLSTATE `AU001`, el mensaje para la persona y el error original en
 * `details`. Acá se hacen las dos cosas que pidió la prueba 3 (03/10/2026):
 *
 *   1. El error REAL queda en el log del servidor. Lo escribe `fetchConAuditoria`,
 *      que va dentro de los dos clientes de Supabase del servidor (el de servicio
 *      y el de sesión): toda escritura pasa por uno de los dos.
 *   2. La persona ve SIEMPRE el mismo mensaje claro. Cada ruta tiene su propio texto
 *      de error («Error al agregar el comentario», …) y no se pueden tocar una por
 *      una sin errar alguna; por eso cada handler de `src/app/api` va envuelto en
 *      `conManejoDeAuditoria`, que reemplaza la respuesta de error sólo si en esa
 *      petición la base contestó `AU001`.
 *
 * 🔒 `error-de-auditoria.test.ts` falla si un handler de `src/app/api` no está
 * envuelto.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { NextResponse } from "next/server";

export const CODIGO_FALLA_AUDITORIA = "AU001";
export const MENSAJE_FALLA_AUDITORIA =
  "No se pudo guardar porque falló el registro de auditoría. Intenta de nuevo y, si se repite, avisa al administrador.";

export interface FallaDeAuditoria {
  /** El error de adentro, tal como lo dio la base: «[SQLSTATE] mensaje». */
  original: string | null;
  /** Dónde: «auditoria.registrar · INSERT comments». */
  donde: string | null;
  /** La llamada a la base que falló (método y ruta de PostgREST, sin parámetros). */
  peticion: string;
}

const contexto = new AsyncLocalStorage<{ falla: FallaDeAuditoria | null }>();

function rutaDe(input: Parameters<typeof fetch>[0]): string {
  try {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return new URL(url).pathname;
  } catch {
    return "?";
  }
}

/**
 * El `fetch` de los clientes de Supabase del servidor. No cambia la respuesta: si
 * es un error `AU001`, lo escribe en el log y lo anota en la petición en curso.
 */
export function fetchConAuditoria(base: typeof fetch = (...a) => fetch(...a)): typeof fetch {
  return async (input, init) => {
    const res = await base(input, init);
    if (res.status >= 400) {
      let cuerpo: { code?: unknown; details?: unknown; hint?: unknown } | null = null;
      try {
        cuerpo = await res.clone().json();
      } catch {
        cuerpo = null;
      }
      if (cuerpo?.code === CODIGO_FALLA_AUDITORIA) {
        const falla: FallaDeAuditoria = {
          original: typeof cuerpo.details === "string" ? cuerpo.details : null,
          donde: typeof cuerpo.hint === "string" ? cuerpo.hint : null,
          peticion: `${init?.method ?? "GET"} ${rutaDe(input)}`,
        };
        console.error("[auditoria] falló el registro de auditoría; la operación se deshizo:", JSON.stringify(falla));
        const s = contexto.getStore();
        if (s && !s.falla) s.falla = falla;
      }
    }
    return res;
  };
}

function respuestaDeFalla() {
  return NextResponse.json({ error: MENSAJE_FALLA_AUDITORIA, codigo: CODIGO_FALLA_AUDITORIA }, { status: 500 });
}

/**
 * Envuelve un handler de ruta. Si durante la petición la base contestó `AU001`, la
 * respuesta de error (4xx/5xx, o una excepción) se reemplaza por el mensaje claro.
 * Una respuesta exitosa no se toca: si la ruta siguió y guardó, guardó.
 */
export function conManejoDeAuditoria<A extends unknown[], R>(
  handler: (...args: A) => Promise<R> | R
): (...args: A) => Promise<R | NextResponse> {
  return (...args: A) =>
    contexto.run({ falla: null }, async () => {
      try {
        const res = await handler(...args);
        const esError = res instanceof Response && res.status >= 400;
        return contexto.getStore()?.falla && esError ? respuestaDeFalla() : res;
      } catch (err) {
        if (contexto.getStore()?.falla) return respuestaDeFalla();
        throw err;
      }
    });
}
