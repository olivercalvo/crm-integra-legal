// Server-only: este modulo lee process.env y envia el API Key al PAC.
// NO debe importarse desde componentes cliente.
//
// Cliente HTTP minimo para el PAC eFactura PTY (ideati).
// Lee EFACTURA_API_BASE_URL y EFACTURA_API_KEY en cada request (lazy),
// para que cualquier carga previa de .env.local (scripts) tenga efecto.

type RequestMethod = "GET" | "POST";

interface EfacturaConfig {
  baseUrl: string;
  apiKey: string;
}

function loadConfig(): EfacturaConfig {
  const baseUrl = process.env.EFACTURA_API_BASE_URL;
  const apiKey = process.env.EFACTURA_API_KEY;
  if (!baseUrl) {
    throw new Error(
      "EFACTURA_API_BASE_URL no esta definido en el entorno. Configurarlo en .env.local (dev) o en Vercel (prod).",
    );
  }
  if (!apiKey) {
    throw new Error(
      "EFACTURA_API_KEY no esta definido en el entorno. Configurarlo en .env.local (dev) o en Vercel (prod).",
    );
  }
  return { baseUrl, apiKey };
}

function buildHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Accept-Language": "es-PA",
    "Content-Type": "application/json",
  };
}

function trimBody(text: string, max = 2000): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `... [truncado ${text.length - max} chars]`;
}

async function request(
  method: RequestMethod,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const { baseUrl, apiKey } = loadConfig();
  const url = `${baseUrl}${path}`;

  const res = await fetch(url, {
    method,
    headers: buildHeaders(apiKey),
    body: body !== undefined ? JSON.stringify(body) : undefined,
    // Sin cache; siempre ir al PAC.
    cache: "no-store",
  });

  if (!res.ok) {
    // Importante: NO incluir el API Key en el mensaje de error.
    const text = await res.text().catch(() => "");
    throw new Error(
      `eFactura ${method} ${path} fallo: HTTP ${res.status} ${res.statusText} — ${trimBody(text)}`,
    );
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return res.json();
  }
  // Algunos endpoints podrian devolver text/plain (ej. errores de validacion).
  return res.text();
}

export function get(path: string): Promise<unknown> {
  return request("GET", path);
}

export function post(path: string, body: unknown): Promise<unknown> {
  return request("POST", path, body);
}
