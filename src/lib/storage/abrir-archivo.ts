/**
 * Abrir un archivo que devuelve una ruta de la app, del lado del navegador.
 *
 * Contraparte de `serve-file.ts`. Desde el 01/09/2026 las rutas de descarga
 * devuelven el ARCHIVO y no un enlace firmado a `*.supabase.co`, así que el
 * cliente ya no puede hacer `window.open(url)`: tiene que leer la respuesta.
 *
 * El patrón (blob → objectURL → anchor programático) no es un capricho, y ya se
 * usaba en la nota de crédito:
 *
 *   · `window.open()` sobre una ruta de la app abre una pestaña que vuelve a
 *     pedir el recurso SIN las cookies de sesión en algunos navegadores, y
 *     termina en un 401.
 *   · Un `<a href>` directo tiene el mismo problema y además no puede leer el
 *     error cuando el servidor responde 403: el usuario ve una pestaña en
 *     blanco en vez de un mensaje.
 *
 * Leyendo la respuesta con `fetch` se conserva la sesión, se puede mostrar el
 * error de verdad, y el objectURL vive solo en la pestaña del usuario.
 */

/** Lo que el servidor puso en `Content-Disposition`, o el fallback. */
function nombreDeLaRespuesta(res: Response, fallback: string): string {
  const cd = res.headers.get("content-disposition") ?? "";
  const utf8 = cd.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8) {
    try {
      return decodeURIComponent(utf8[1]);
    } catch {
      /* nombre mal codificado: se usa el simple */
    }
  }
  const simple = cd.match(/filename="([^"]+)"/i);
  return simple ? simple[1] : fallback;
}

export interface AbrirArchivoResultado {
  ok: boolean;
  /** Mensaje para mostrarle al usuario cuando `ok` es false. */
  error?: string;
  /** Cabeceras útiles de la respuesta (ej. si el PDF se regeneró). */
  headers?: Headers;
}

/**
 * Pide el archivo, y lo abre en una pestaña nueva o lo baja.
 *
 * @param url      ruta de la app (nunca un dominio externo)
 * @param opts.descargar  true fuerza el diálogo de guardado en vez de abrir
 * @param opts.nombre     nombre por defecto si el servidor no manda uno
 */
export async function abrirArchivo(
  url: string,
  opts: { descargar?: boolean; nombre?: string } = {}
): Promise<AbrirArchivoResultado> {
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store" });
  } catch {
    return { ok: false, error: "Error de red al pedir el archivo." };
  }

  if (!res.ok) {
    // El cuerpo de error es JSON; si no lo es, no se rompe por eso.
    const data = await res.json().catch(() => ({}) as { error?: string });
    return {
      ok: false,
      error: data?.error ?? "No se pudo abrir el archivo.",
      headers: res.headers,
    };
  }

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const nombre = nombreDeLaRespuesta(res, opts.nombre ?? "archivo");

  const a = document.createElement("a");
  a.href = objectUrl;
  if (opts.descargar) {
    a.download = nombre;
  } else {
    a.target = "_blank";
    a.rel = "noopener noreferrer";
  }
  document.body.appendChild(a);
  a.click();
  a.remove();

  // Margen para que el navegador termine de abrirlo antes de soltar la URL.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);

  return { ok: true, headers: res.headers };
}
