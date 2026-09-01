/**
 * SERVIR UN ARCHIVO DEL STORAGE POR EL DOMINIO DE LA APP.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE — el incidente del 01/09/2026
 * ─────────────────────────────────────────────────────────────────────────────
 * Una de las licenciadas no podía descargar una factura: el navegador le daba
 * `DNS_PROBE_FINISHED_NXDOMAIN` sobre `uqmmkklbhzxqybljiecs.supabase.co`. El
 * dominio existe y el proyecto estaba sano — lo que fallaba era la resolución
 * DNS en SU red.
 *
 * El resto del sistema le funcionaba porque esas peticiones las hace el
 * servidor. La descarga no, porque le entregábamos al navegador un enlace
 * firmado que apuntaba DIRECTO al almacenamiento de Supabase: el navegador tenía
 * que resolver un dominio que en su red no resolvía.
 *
 * El mismo día falló la resolución de `supabase.co` desde Node en la máquina de
 * desarrollo, con la conexión a la base funcionando. Dos máquinas distintas en
 * Panamá con el mismo síntoma: no es una anécdota de una red.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUÉ HACE
 * ─────────────────────────────────────────────────────────────────────────────
 * El navegador habla SOLO con el dominio del CRM. El servidor —que sí resuelve—
 * trae el archivo del storage y lo transmite.
 *
 *   navegador → /api/... (dominio del CRM) → [servidor] → storage
 *
 * 🔑 SE TRANSMITE, NO SE CARGA EN MEMORIA. Se hace `fetch` de la URL firmada y
 * se pasa `res.body` —un ReadableStream— directo a la respuesta. Por acá van a
 * pasar también los adjuntos de casos, que no son PDFs de dos páginas:
 * `storage.download()` habría devuelto un Blob entero en memoria por cada
 * descarga concurrente.
 *
 * La URL firmada sigue existiendo, pero vive y muere DENTRO del servidor: 60
 * segundos, y nunca llega al navegador.
 *
 * ⚠️ ESTE HELPER NO VERIFICA PERMISOS. Cada ruta que lo usa tiene que haber
 * comprobado sesión, tenant y rol ANTES de llamarlo. Un `storage_key` no es un
 * permiso: que sea difícil de adivinar no lo convierte en uno.
 */
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Cuánto vive la URL firmada interna. No sale del servidor. */
const TTL_INTERNO_SEGUNDOS = 60;

export interface ServeStorageFileOptions {
  /** Cliente con permisos de servicio. La ruta ya validó al usuario. */
  admin: SupabaseClient;
  bucket: string;
  storageKey: string;
  /**
   * El nombre que ve el usuario al guardar. NUNCA el uuid del storage: quien
   * baja "FAC-HON-000012.pdf" no quiere encontrarse un
   * "a3f9c1e2-....pdf" en su carpeta de descargas.
   */
  fileName: string;
  /**
   * `inline` abre en el visor del navegador (PDFs, imágenes); `attachment`
   * fuerza el diálogo de guardado. Default `inline`, que es lo que el sistema
   * venía haciendo con las URLs firmadas.
   */
  disposition?: "inline" | "attachment";
}

/**
 * Content-Disposition con el nombre en las DOS formas.
 *
 * `filename=` en ASCII para navegadores viejos y `filename*=UTF-8''` para el
 * nombre real. Sin la segunda, "Cotización COT-000123.pdf" se baja con el
 * acento roto; sin la primera, algún navegador antiguo se queda sin nombre.
 * RFC 5987.
 */
function contentDisposition(fileName: string, disposition: "inline" | "attachment"): string {
  const limpio = fileName.replace(/["\\\r\n]/g, "_");
  const ascii = limpio.replace(/[^\x20-\x7E]/g, "_");
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(limpio)}`;
}

/**
 * Trae el archivo del storage y lo devuelve por el dominio de la app.
 *
 * Devuelve una respuesta de error JSON si el archivo no está: el que llama no
 * tiene que distinguir entre "no existe" y "no se pudo firmar", porque para el
 * usuario es lo mismo.
 */
export async function serveStorageFile({
  admin,
  bucket,
  storageKey,
  fileName,
  disposition = "inline",
}: ServeStorageFileOptions): Promise<NextResponse> {
  const { data: firmada, error: errFirma } = await admin.storage
    .from(bucket)
    .createSignedUrl(storageKey, TTL_INTERNO_SEGUNDOS);

  if (errFirma || !firmada?.signedUrl) {
    console.error("[storage/serve] no se pudo firmar", { bucket, storageKey, errFirma });
    return NextResponse.json({ error: "No se pudo acceder al archivo" }, { status: 500 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(firmada.signedUrl);
  } catch (err) {
    // Si el SERVIDOR no llega al storage, es un problema de infraestructura y no
    // del usuario. Se registra distinto justamente para poder distinguirlo del
    // caso que originó este helper, que era la red del usuario.
    console.error("[storage/serve] el servidor no pudo alcanzar el storage", {
      bucket,
      storageKey,
      err,
    });
    return NextResponse.json({ error: "No se pudo acceder al archivo" }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    console.error("[storage/serve] el storage respondió", {
      bucket,
      storageKey,
      status: upstream.status,
    });
    return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 });
  }

  const headers = new Headers();
  headers.set("Content-Type", upstream.headers.get("content-type") ?? "application/octet-stream");
  headers.set("Content-Disposition", contentDisposition(fileName, disposition));
  const largo = upstream.headers.get("content-length");
  if (largo) headers.set("Content-Length", largo);
  // Privado y sin caché: la respuesta depende de quién la pidió.
  headers.set("Cache-Control", "private, no-store");

  return new NextResponse(upstream.body, { status: 200, headers });
}
