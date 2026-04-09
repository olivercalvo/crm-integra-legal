import { createClient } from "@/lib/supabase/client";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

interface UploadOptions {
  file: File;
  bucket?: string;
  /** Storage path prefix, e.g. "gastos/case123/expense456" */
  pathPrefix: string;
  onProgress?: (percent: number) => void;
  maxSize?: number;
  allowedTypes?: string[];
}

interface UploadResult {
  storagePath: string;
  fileName: string;
}

let cachedTenantId: string | null = null;

async function getTenantId(): Promise<string> {
  if (cachedTenantId) return cachedTenantId;
  const res = await fetch("/api/storage/prepare");
  if (!res.ok) throw new Error("No se pudo obtener contexto de upload");
  const { tenantId } = await res.json();
  cachedTenantId = tenantId;
  return tenantId;
}

/**
 * Upload a file directly to Supabase Storage from the browser.
 * Uses XMLHttpRequest for progress tracking.
 * Bypasses Next.js API routes — no Vercel body size limit.
 */
export async function directUpload({
  file,
  bucket = "documents",
  pathPrefix,
  onProgress,
  maxSize = MAX_FILE_SIZE,
  allowedTypes,
}: UploadOptions): Promise<UploadResult> {
  // Validate size
  if (file.size > maxSize) {
    throw new Error(`Archivo demasiado grande (máximo ${Math.round(maxSize / 1024 / 1024)}MB)`);
  }

  // Validate type
  if (allowedTypes && !allowedTypes.includes(file.type)) {
    throw new Error("Tipo de archivo no permitido");
  }

  const tenantId = await getTenantId();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${tenantId}/${pathPrefix}/${Date.now()}_${safeName}`;

  // Get access token from Supabase client
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error("Sesión no válida");
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const uploadUrl = `${supabaseUrl}/storage/v1/object/${bucket}/${storagePath}`;

  // Use XMLHttpRequest for progress tracking
  return new Promise<UploadResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ storagePath, fileName: file.name });
      } else {
        let msg = "Error al subir archivo";
        try {
          const body = JSON.parse(xhr.responseText);
          msg = body.message || body.error || msg;
        } catch { /* ignore parse error */ }
        reject(new Error(msg));
      }
    });

    xhr.addEventListener("error", () => reject(new Error("Error de conexión al subir archivo")));
    xhr.addEventListener("abort", () => reject(new Error("Upload cancelado")));

    xhr.open("POST", uploadUrl);
    xhr.setRequestHeader("Authorization", `Bearer ${session.access_token}`);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.setRequestHeader("x-upsert", "false");
    xhr.send(file);
  });
}

/** Clear cached tenant ID (e.g. on logout) */
export function clearUploadCache() {
  cachedTenantId = null;
}
