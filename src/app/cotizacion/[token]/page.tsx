/**
 * Página pública del portal de cotizaciones.
 *
 * Sprint 2E.3 hotfix (2026-05-14): PLACEHOLDER profesional. El portal de
 * aceptación digital (con acciones "Aceptar" / "Rechazar" + log de IP/UA)
 * llega recién en Sprint 2E.4. Hasta entonces, este endpoint sirve para
 * que cuando el cliente abre el link del email NO termine en /login del
 * CRM (UX confusa), sino en una página informativa con la marca Integra
 * Panamá y el resumen básico de la cotización + datos de contacto.
 *
 * Comportamiento:
 *   - Server component público (sin auth requirement, sin sidebar/CRM
 *     chrome — el cliente NO es usuario del CRM).
 *   - Valida que [token] tenga formato UUID v4 antes de tocar la BD.
 *   - Si el token es válido formato, busca la quote por public_token y
 *     muestra datos básicos + estado.
 *   - Si NO existe en BD: muestra "Cotización no disponible".
 *   - Si formato inválido: muestra "Link inválido".
 *   - Si quote en estado expirada / cancelada / convertida: muestra
 *     warning específico pero igual renderiza la página.
 *   - Bloqueo noindex/nofollow en layout (no indexable por buscadores).
 */

import Link from "next/link";
import { AlertCircle, Mail, ExternalLink, Calendar } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDate } from "@/lib/utils/format-date";
import type { QuoteStatus } from "@/lib/finanzas/types/quote";

interface PageProps {
  params: { token: string };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CONTACT_EMAIL = "contacto@integra-panama.com";
const SITE_URL = "https://integra-panama.com";

// El portal es contenido dinámico — no cachear (el status puede cambiar).
export const dynamic = "force-dynamic";

interface QuoteSummary {
  id: string;
  quote_number: string;
  valid_until: string;
  status: QuoteStatus;
  client_name: string;
}

async function fetchQuoteByToken(token: string): Promise<QuoteSummary | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("quotes")
    .select("id, quote_number, valid_until, status, client:clients(name)")
    .eq("public_token", token)
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  // Supabase devuelve client como array-of-one cuando es FK; normalizamos.
  const clientField = (data as { client: unknown }).client;
  let clientName = "Cliente";
  if (Array.isArray(clientField) && clientField[0]) {
    clientName = (clientField[0] as { name?: string }).name ?? "Cliente";
  } else if (clientField && typeof clientField === "object") {
    clientName = (clientField as { name?: string }).name ?? "Cliente";
  }

  return {
    id: data.id as string,
    quote_number: data.quote_number as string,
    valid_until: data.valid_until as string,
    status: data.status as QuoteStatus,
    client_name: clientName,
  };
}

function StatusBadge({ status }: { status: QuoteStatus }) {
  // Paleta consistente con QuoteStatusBadge interno, pero adaptada al
  // contexto público (sin jerga interna — "borrador" o
  // "cancelada_pre_envio" no llegan acá porque NO tienen public_token).
  const palettes: Record<QuoteStatus, { bg: string; text: string; label: string }> = {
    borrador: { bg: "bg-gray-100", text: "text-gray-700", label: "Borrador" },
    enviada: { bg: "bg-blue-100", text: "text-blue-800", label: "Enviada" },
    aceptada: { bg: "bg-green-100", text: "text-green-800", label: "Aceptada" },
    rechazada: { bg: "bg-red-100", text: "text-red-800", label: "Rechazada" },
    expirada: { bg: "bg-amber-100", text: "text-amber-800", label: "Expirada" },
    convertida: { bg: "bg-violet-100", text: "text-violet-800", label: "Confirmada" },
    cancelada_pre_envio: { bg: "bg-gray-100", text: "text-gray-700", label: "Cancelada" },
  };
  const p = palettes[status];
  return (
    <span
      className={`inline-flex items-center rounded-md px-2.5 py-1 text-xs font-semibold uppercase tracking-wider ${p.bg} ${p.text}`}
    >
      {p.label}
    </span>
  );
}

function ShellHeader() {
  return (
    <header className="bg-integra-navy py-6 shadow-sm">
      <div className="mx-auto max-w-2xl px-4 flex items-center justify-between">
        <div className="text-white text-2xl font-bold tracking-[0.2em]">INTEGRA</div>
        <div className="text-integra-gold text-[10px] font-bold tracking-[0.3em]">
          LEGAL · PANAMÁ
        </div>
      </div>
    </header>
  );
}

function ShellFooter() {
  return (
    <footer className="mt-12 border-t bg-white py-6">
      <p className="mx-auto max-w-2xl px-4 text-center text-xs text-gray-500">
        © 2026 Integra Panamá — Servicios legales en Panamá
      </p>
    </footer>
  );
}

function ErrorShell({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <>
      <ShellHeader />
      <main className="mx-auto max-w-2xl px-4 py-12">
        <div className="rounded-xl border bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-100">
            <AlertCircle size={28} className="text-red-600" />
          </div>
          <h1 className="text-xl font-bold text-integra-navy">{title}</h1>
          <p className="mt-3 text-sm text-gray-700">{message}</p>
          <p className="mt-6 text-xs text-gray-500">
            Si crees que es un error, contáctanos en{" "}
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="font-medium text-integra-navy hover:underline"
            >
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </div>
      </main>
      <ShellFooter />
    </>
  );
}

export default async function CotizacionPublicPage({ params }: PageProps) {
  const token = params.token?.trim() ?? "";

  // 1. Validar formato del token (UUID v4 sin hyphen rigid → permitimos
  //    UUID v1-5 porque generamos via randomUUID() y solo nos importa el
  //    formato, no la versión). Esto evita queries innecesarios a BD.
  if (!UUID_RE.test(token)) {
    return (
      <ErrorShell
        title="Link inválido"
        message="El link de esta cotización no tiene un formato válido. Verifica que hayas copiado el link completo del correo."
      />
    );
  }

  // 2. Buscar la quote por public_token.
  const quote = await fetchQuoteByToken(token);

  if (!quote) {
    return (
      <ErrorShell
        title="Cotización no disponible"
        message="No encontramos una cotización asociada a este link. Es posible que haya sido reemplazada o que el link tenga un error."
      />
    );
  }

  // 3. Render principal: card con datos + banner "próximamente" + contacto.
  // Warning condicional para estados terminales.
  const isTerminal =
    quote.status === "expirada" ||
    quote.status === "cancelada_pre_envio" ||
    quote.status === "convertida";

  const terminalMessage: Record<string, string> = {
    expirada:
      "Esta cotización venció y ya no está vigente. Contáctanos para coordinar una nueva propuesta.",
    cancelada_pre_envio:
      "Esta cotización fue cancelada antes de su envío. Si esperabas una propuesta, contáctanos para coordinar una nueva.",
    convertida:
      "Esta cotización ya fue confirmada y está en proceso de facturación.",
  };

  return (
    <>
      <ShellHeader />

      <main className="mx-auto max-w-2xl px-4 py-10">
        {/* Título */}
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-integra-navy sm:text-3xl">
            Cotización{" "}
            <span className="font-mono text-integra-gold">
              {quote.quote_number}
            </span>
          </h1>
          <p className="mt-1 text-sm text-gray-500">Integra Panamá</p>
        </div>

        {/* Mensaje principal */}
        <div className="rounded-xl border bg-white p-6 shadow-sm sm:p-8">
          <p className="text-base text-gray-800">
            Hola <strong className="text-integra-navy">{quote.client_name}</strong>,
          </p>
          <p className="mt-4 text-sm leading-relaxed text-gray-700">
            Esta cotización está disponible para ti. El portal de aceptación
            digital estará disponible muy pronto. Mientras tanto, contáctanos
            para coordinar los próximos pasos.
          </p>

          {/* Datos básicos */}
          <dl className="mt-6 grid grid-cols-1 gap-3 rounded-lg border bg-gray-50 p-4 sm:grid-cols-2">
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                Cotización
              </dt>
              <dd className="mt-0.5 font-mono text-sm font-semibold text-integra-navy">
                {quote.quote_number}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold flex items-center gap-1">
                <Calendar size={10} /> Vigencia hasta
              </dt>
              <dd className="mt-0.5 text-sm font-semibold text-integra-navy">
                {formatDate(quote.valid_until)}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                Estado
              </dt>
              <dd className="mt-1">
                <StatusBadge status={quote.status} />
              </dd>
            </div>
          </dl>

          {isTerminal && (
            <div
              role="alert"
              className="mt-5 flex items-start gap-2 rounded-md border-l-4 border-amber-400 bg-amber-50 p-3 text-sm text-amber-900"
            >
              <AlertCircle size={16} className="mt-0.5 shrink-0 text-amber-600" />
              <p>{terminalMessage[quote.status]}</p>
            </div>
          )}

          {/* Botones de contacto */}
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-md bg-integra-gold px-4 py-3 text-sm font-semibold text-integra-navy hover:bg-integra-gold/90"
            >
              <Mail size={16} />
              {CONTACT_EMAIL}
            </a>
            <Link
              href={SITE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-md border border-integra-navy/20 bg-white px-4 py-3 text-sm font-semibold text-integra-navy hover:bg-gray-50"
            >
              <ExternalLink size={16} />
              integra-panama.com
            </Link>
          </div>
        </div>

        {/* Banner próximamente */}
        <div
          role="alert"
          className="mt-5 flex items-start gap-2 rounded-md border-l-4 border-amber-400 bg-amber-50 p-4 text-sm text-amber-900"
        >
          <AlertCircle size={18} className="mt-0.5 shrink-0 text-amber-600" />
          <div>
            <p className="font-semibold">
              Portal de aceptación digital — Próximamente
            </p>
            <p className="mt-1 text-xs text-amber-800">
              Mientras tanto, puedes coordinar la respuesta de esta
              cotización directamente con el equipo de Integra Panamá
              usando los datos de contacto de arriba.
            </p>
          </div>
        </div>
      </main>

      <ShellFooter />
    </>
  );
}
