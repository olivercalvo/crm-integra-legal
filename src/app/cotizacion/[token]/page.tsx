/**
 * Portal público de cotizaciones — Sprint 2E.4 (funcional).
 *
 * El cliente accede vía link único en el correo. NO requiere auth: la
 * "autenticación" es el public_token UUID en el path. Validación detallada
 * (status, vigencia) corre server-side; los endpoints públicos
 * (/api/public/cotizaciones/[token]/{accept,reject}) tienen guards
 * independientes.
 *
 * Comportamiento:
 *   - Formato token inválido → ErrorShell "Link inválido".
 *   - No encontrado          → ErrorShell "Cotización no disponible".
 *   - Vencida (P9, valid_until < hoy Panamá) → ExpiredCard sin datos.
 *   - Estados terminales (aceptada/rechazada/convertida/cancelada_pre_envio)
 *     → render read-only con mensaje específico.
 *   - Estado enviada y NO vencida → render completo con botones de acción.
 *
 * SEO: layout root ya bloquea noindex/nofollow.
 */

import { AlertCircle, Calendar, Mail } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getQuoteForPortal,
  isQuoteExpired,
  type PortalQuoteBundle,
} from "@/lib/finanzas/queries/quote-portal";
import { PortalActions } from "./_components/portal-actions";

interface PageProps {
  params: { token: string };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CONTACT_EMAIL = "legal@integra-panama.com";

export const dynamic = "force-dynamic";

// ---------- Helpers de formato ---------------------------------------------

function formatDateEs(iso: string): string {
  if (!iso) return "—";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function formatUSD(n: number): string {
  return `$${(Math.round(n * 100) / 100).toFixed(2)}`;
}

// ---------- Shell y errores ------------------------------------------------

function ShellHeader() {
  return (
    <header className="bg-integra-navy py-5 shadow-sm">
      <div className="mx-auto max-w-3xl px-4 flex items-center justify-between">
        <div className="text-white text-2xl font-bold tracking-[0.2em]">
          INTEGRA
        </div>
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
      <div className="mx-auto max-w-3xl px-4 text-center text-xs text-gray-500 leading-relaxed">
        <p>
          ¿Tienes dudas? Escríbenos a{" "}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="font-medium text-integra-navy hover:underline"
          >
            {CONTACT_EMAIL}
          </a>
          .
        </p>
        <p className="mt-2">© 2026 Integra Legal · Servicios legales en Panamá</p>
      </div>
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
            Si crees que es un error, escribinos a{" "}
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

function ExpiredCard({ quote_number, valid_until }: { quote_number: string; valid_until: string }) {
  return (
    <>
      <ShellHeader />
      <main className="mx-auto max-w-2xl px-4 py-12">
        <div className="rounded-xl border bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100">
            <Calendar size={28} className="text-amber-600" />
          </div>
          <h1 className="text-xl font-bold text-integra-navy">
            Esta cotización venció
          </h1>
          <p className="mt-1 text-sm text-gray-500 font-mono">{quote_number}</p>
          <p className="mt-4 text-sm text-gray-700 leading-relaxed">
            Esta cotización venció el{" "}
            <strong>{formatDateEs(valid_until)}</strong>. Contacta al bufete
            para una cotización actualizada con condiciones vigentes.
          </p>
          <a
            href={`mailto:${CONTACT_EMAIL}?subject=Cotización ${encodeURIComponent(quote_number)} vencida`}
            className="mt-6 inline-flex items-center justify-center gap-2 rounded-md bg-integra-gold px-5 py-3 min-h-[48px] text-sm font-bold text-integra-navy hover:bg-integra-gold/90"
          >
            <Mail size={16} />
            Contactar al bufete
          </a>
        </div>
      </main>
      <ShellFooter />
    </>
  );
}

// ---------- Vista principal -------------------------------------------------

export default async function CotizacionPublicPage({ params }: PageProps) {
  const token = params.token?.trim() ?? "";

  if (!UUID_RE.test(token)) {
    return (
      <ErrorShell
        title="Link inválido"
        message="El link de esta cotización no tiene un formato válido. Verifica que hayas copiado el link completo del correo."
      />
    );
  }

  const db = createAdminClient();
  const quote = await getQuoteForPortal(db, token);

  if (!quote) {
    return (
      <ErrorShell
        title="Cotización no disponible"
        message="No encontramos una cotización asociada a este link. Es posible que haya sido reemplazada o que el link tenga un error."
      />
    );
  }

  // P9 — vencida.
  if (isQuoteExpired(quote.valid_until)) {
    return <ExpiredCard quote_number={quote.quote_number} valid_until={quote.valid_until} />;
  }

  // Estados terminales — read-only.
  const isTerminal =
    quote.status === "aceptada" ||
    quote.status === "rechazada" ||
    quote.status === "convertida" ||
    quote.status === "cancelada_pre_envio" ||
    quote.status === "expirada";

  return (
    <>
      <ShellHeader />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:py-10">
        {/* Encabezado */}
        <div className="mb-6 text-center">
          <p className="text-xs uppercase tracking-[0.2em] text-gray-500 font-semibold">
            Cotización
          </p>
          <h1 className="mt-1 text-2xl sm:text-3xl font-bold text-integra-navy font-mono">
            {quote.quote_number}
          </h1>
          {quote.title && (
            <p className="mt-2 italic text-base text-gray-700 break-words leading-snug">
              {quote.title}
            </p>
          )}
          <p className="mt-3 text-sm text-gray-600">
            Preparada para <strong className="text-integra-navy">{quote.client.name}</strong>
          </p>
        </div>

        {/* Datos clave */}
        <SummaryCard quote={quote} />

        {/* Estado terminal: card de mensaje específico */}
        {isTerminal && <TerminalCard status={quote.status} approved_at={quote.approved_at} rejected_at={quote.rejected_at} />}

        {/* Líneas */}
        <Section title="Detalle de servicios">
          <LinesTable quote={quote} />
        </Section>

        {/* Totales */}
        <Section title="Totales">
          <TotalsBlock quote={quote} />
        </Section>

        {/* Observaciones */}
        {quote.observations && quote.observations.trim().length > 0 && (
          <Section title="Observaciones">
            <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
              {quote.observations}
            </p>
          </Section>
        )}

        {/* T&C collapsable */}
        {quote.terms_and_conditions && quote.terms_and_conditions.trim().length > 0 && (
          <Section title="Términos y Condiciones">
            <details className="group">
              <summary className="cursor-pointer text-sm text-integra-navy underline hover:no-underline">
                Ver términos y condiciones completos
              </summary>
              <div className="mt-3 text-xs text-gray-700 whitespace-pre-wrap leading-relaxed">
                {quote.terms_and_conditions}
              </div>
            </details>
          </Section>
        )}

        {/* Acciones — solo si NO terminal */}
        {!isTerminal && (
          <PortalActions
            token={token}
            quote_number={quote.quote_number}
            client_name={quote.client.name}
          />
        )}

        {/* Aviso legal compacto */}
        <p className="mt-8 text-center text-xs text-gray-400 leading-relaxed">
          La aceptación electrónica de esta cotización tiene validez legal
          según la Ley 51 de 2008 de la República de Panamá (Documentos
          Electrónicos y Firmas Electrónicas).
        </p>
      </main>
      <ShellFooter />
    </>
  );
}

// ---------- Componentes inline (server) ------------------------------------

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6 rounded-xl border bg-white p-5 shadow-sm sm:p-6">
      <h2 className="text-xs uppercase tracking-[0.15em] font-bold text-integra-gold mb-3">
        {title}
      </h2>
      {children}
    </section>
  );
}

function SummaryCard({ quote }: { quote: PortalQuoteBundle }) {
  return (
    <div className="rounded-xl border bg-white p-5 sm:p-6 shadow-sm">
      <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
            Vigencia hasta
          </dt>
          <dd className="mt-1 text-base font-bold text-integra-navy">
            {formatDateEs(quote.valid_until)}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
            Fecha de emisión
          </dt>
          <dd className="mt-1 text-base font-bold text-integra-navy">
            {formatDateEs(quote.issue_date)}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
            Total
          </dt>
          <dd className="mt-1 text-xl font-bold text-integra-navy font-mono">
            {formatUSD(quote.grand_total)} <span className="text-xs font-normal text-gray-500">{quote.currency}</span>
          </dd>
        </div>
      </dl>
    </div>
  );
}

function TerminalCard({
  status,
  approved_at,
  rejected_at,
}: {
  status: PortalQuoteBundle["status"];
  approved_at: string | null;
  rejected_at: string | null;
}) {
  const msg =
    status === "aceptada"
      ? `Esta cotización fue aceptada${approved_at ? ` el ${formatDateEs(approved_at)}` : ""}. El equipo del bufete está coordinando los siguientes pasos.`
      : status === "rechazada"
      ? `Esta cotización fue rechazada${rejected_at ? ` el ${formatDateEs(rejected_at)}` : ""}. Si tu decisión cambió, contacta al bufete.`
      : status === "convertida"
      ? "Esta cotización ya fue confirmada y está en proceso de facturación."
      : status === "cancelada_pre_envio"
      ? "Esta cotización fue cancelada por el bufete. Si esperabas una propuesta, contáctanos para coordinar una nueva."
      : "Esta cotización venció y ya no está vigente.";

  const palette =
    status === "aceptada"
      ? "border-green-200 bg-green-50 text-green-900"
      : status === "rechazada"
      ? "border-red-200 bg-red-50 text-red-900"
      : status === "convertida"
      ? "border-violet-200 bg-violet-50 text-violet-900"
      : "border-amber-200 bg-amber-50 text-amber-900";

  return (
    <div
      role="status"
      className={`mt-5 rounded-md border-l-4 p-4 text-sm leading-relaxed ${palette}`}
    >
      {msg}
    </div>
  );
}

function LinesTable({ quote }: { quote: PortalQuoteBundle }) {
  return (
    <>
      {/* Desktop: tabla */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
              <th className="text-left py-2 pr-2">Descripción</th>
              <th className="text-right py-2 px-2 w-16">Cant.</th>
              <th className="text-right py-2 px-2 w-24">Precio unit.</th>
              <th className="text-right py-2 px-2 w-20">ITBMS</th>
              <th className="text-right py-2 pl-2 w-28">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {quote.lines.map((ln) => (
              <tr key={ln.id} className="border-b border-gray-100">
                <td className="py-2 pr-2 text-gray-800 align-top">
                  {ln.description}
                </td>
                <td className="py-2 px-2 text-right text-gray-700 align-top font-mono text-xs">
                  {ln.quantity}
                </td>
                <td className="py-2 px-2 text-right text-gray-700 align-top font-mono text-xs">
                  {formatUSD(ln.unit_price)}
                </td>
                <td className="py-2 px-2 text-right text-gray-700 align-top font-mono text-xs">
                  {formatUSD(ln.tax_amount)}
                </td>
                <td className="py-2 pl-2 text-right text-gray-900 align-top font-mono font-semibold">
                  {formatUSD(ln.line_total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: cards apiladas */}
      <div className="sm:hidden space-y-3">
        {quote.lines.map((ln) => (
          <div key={ln.id} className="rounded-md border border-gray-200 p-3">
            <p className="text-sm font-medium text-gray-800">{ln.description}</p>
            <dl className="mt-2 grid grid-cols-2 gap-1 text-xs">
              <dt className="text-gray-500">Cantidad</dt>
              <dd className="text-right font-mono text-gray-700">{ln.quantity}</dd>
              <dt className="text-gray-500">Precio unit.</dt>
              <dd className="text-right font-mono text-gray-700">{formatUSD(ln.unit_price)}</dd>
              <dt className="text-gray-500">ITBMS</dt>
              <dd className="text-right font-mono text-gray-700">{formatUSD(ln.tax_amount)}</dd>
              <dt className="text-gray-500 font-semibold">Subtotal</dt>
              <dd className="text-right font-mono font-bold text-gray-900">
                {formatUSD(ln.line_total)}
              </dd>
            </dl>
          </div>
        ))}
      </div>
    </>
  );
}

function TotalsBlock({ quote }: { quote: PortalQuoteBundle }) {
  const hasHon = quote.subtotal_hon > 0;
  const hasRei = quote.subtotal_rei > 0;
  return (
    <dl className="text-sm space-y-1.5">
      {hasHon && (
        <div className="flex justify-between">
          <dt className="text-gray-600">Subtotal honorarios</dt>
          <dd className="font-mono text-gray-800">{formatUSD(quote.subtotal_hon)}</dd>
        </div>
      )}
      {hasRei && (
        <div className="flex justify-between">
          <dt className="text-gray-600">Subtotal reembolso de gastos</dt>
          <dd className="font-mono text-gray-800">{formatUSD(quote.subtotal_rei)}</dd>
        </div>
      )}
      <div className="flex justify-between border-t border-gray-200 pt-1.5">
        <dt className="text-gray-600">Subtotal</dt>
        <dd className="font-mono text-gray-800">{formatUSD(quote.subtotal_total)}</dd>
      </div>
      <div className="flex justify-between">
        <dt className="text-gray-600">ITBMS</dt>
        <dd className="font-mono text-gray-800">{formatUSD(quote.tax_total)}</dd>
      </div>
      <div className="flex justify-between border-t-2 border-integra-navy pt-2 mt-1">
        <dt className="text-base font-bold text-integra-navy">Total</dt>
        <dd className="font-mono font-bold text-lg text-integra-navy">
          {formatUSD(quote.grand_total)} <span className="text-xs font-normal text-gray-500">{quote.currency}</span>
        </dd>
      </div>
    </dl>
  );
}
