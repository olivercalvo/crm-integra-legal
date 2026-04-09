import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { DeactivateClientButton } from "@/components/clients/deactivate-client-button";
import { DeleteClientButton } from "@/components/clients/delete-client-button";
import { DocumentUpload } from "@/components/documents/document-upload";
import {
  ChevronLeft,
  Pencil,
  User,
  Phone,
  Mail,
  Hash,
  Building2,
  FileText,
  FolderOpen,
  Paperclip,
  MapPin,
  Calendar,
} from "lucide-react";
import { formatDate } from "@/lib/utils/format-date";
import type { Client } from "@/types/database";

interface PageProps {
  params: { id: string };
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <span className="mt-0.5 shrink-0 text-gray-400">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</p>
        <p className="mt-0.5 text-sm text-gray-800 break-words">{value || "—"}</p>
      </div>
    </div>
  );
}

import { getStatusStyle } from "@/lib/utils/status-styles";

export default async function ClienteDetailPage({ params }: PageProps) {
  const { db, userRole } = await getAuthenticatedContext();
  const { id } = params;

  const { data: client, error } = await db
    .from("clients")
    .select("*, responsible_lawyer:users!clients_responsible_lawyer_id_fkey(full_name)")
    .eq("id", id)
    .single();

  if (error || !client) notFound();

  const typedClient = client as Client;
  const lawyerName = (client.responsible_lawyer as unknown as { full_name: string } | null)?.full_name ?? null;

  // Fetch linked cases with status
  const { data: cases } = await db
    .from("cases")
    .select(`
      id, case_code, description, opened_at, updated_at,
      cat_statuses(name),
      cat_classifications(name)
    `)
    .eq("client_id", id)
    .order("updated_at", { ascending: false });

  // Fetch documents for this client
  const { data: documents } = await db
    .from("documents")
    .select("id, file_name, created_at")
    .eq("entity_type", "client")
    .eq("entity_id", id)
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href="/abogada/clientes" className="flex items-center gap-1 hover:text-integra-navy">
          <ChevronLeft size={16} />
          Clientes
        </Link>
        <span>/</span>
        <span className="text-integra-navy font-medium truncate">{typedClient.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-2xl font-bold text-integra-navy">{typedClient.name}</h2>
            {!typedClient.active && (
              <Badge variant="secondary" className="bg-red-100 text-red-700 border-0">Inactivo</Badge>
            )}
          </div>
          <p className="text-sm font-mono text-gray-400">{typedClient.client_number}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            asChild
            className="min-h-[48px] bg-integra-gold text-integra-navy hover:bg-integra-gold/90 font-semibold"
          >
            <Link href={`/abogada/casos/nuevo?client_id=${id}`}>
              <FolderOpen size={18} className="mr-1" />
              Crear Caso
            </Link>
          </Button>
          <Button
            asChild
            variant="outline"
            className="min-h-[48px] border-integra-navy text-integra-navy hover:bg-integra-navy hover:text-white"
          >
            <Link href={`/abogada/clientes/${id}/editar`}>
              <Pencil size={18} />
              Editar
            </Link>
          </Button>
          {typedClient.active && (
            <DeactivateClientButton clientId={id} clientName={typedClient.name} />
          )}
          {(userRole === "admin" || userRole === "abogada") && (
            <DeleteClientButton
              clientId={id}
              clientNumber={typedClient.client_number}
              clientName={typedClient.name}
              caseCount={cases?.length ?? 0}
            />
          )}
        </div>
      </div>

      {/* Client info */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <User size={18} className="text-integra-gold" />
            Información del Cliente
          </CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          <InfoRow icon={<Hash size={16} />} label="N° Cliente" value={typedClient.client_number} />
          <InfoRow icon={<Building2 size={16} />} label="RUC / Cédula" value={typedClient.ruc} />
          <InfoRow icon={<FileText size={16} />} label="Tipo de Cliente" value={typedClient.type} />
          <InfoRow icon={<User size={16} />} label="Abogada Responsable" value={lawyerName} />
          <InfoRow icon={<User size={16} />} label="Persona de contacto" value={typedClient.contact} />
          <InfoRow icon={<Phone size={16} />} label="Teléfono" value={typedClient.phone} />
          <InfoRow icon={<Mail size={16} />} label="Correo electrónico" value={typedClient.email} />
          <InfoRow
            icon={<MapPin size={16} />}
            label="Dirección Física"
            value={typedClient.address}
          />
          <InfoRow
            icon={<Calendar size={16} />}
            label="Cliente Desde"
            value={typedClient.client_since
              ? formatDate(typedClient.client_since)
              : null}
          />
          {typedClient.observations && (
            <>
              <Separator />
              <div className="pt-3">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Observaciones</p>
                <p className="mt-1.5 text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                  {typedClient.observations}
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Linked cases with colored status badges */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <FolderOpen size={18} className="text-integra-gold" />
              Casos
              {cases && cases.length > 0 && (
                <span className="rounded-full bg-integra-navy/10 px-2 py-0.5 text-xs font-bold text-integra-navy">
                  {cases.length}
                </span>
              )}
            </CardTitle>
            <Button
              asChild
              size="sm"
              className="min-h-[40px] bg-integra-navy hover:bg-integra-navy/90 text-white text-xs"
            >
              <Link href={`/abogada/casos/nuevo?client_id=${id}`}>+ Nuevo Caso</Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {cases && cases.length > 0 ? (
            <div className="space-y-2">
              {cases.map((c: Record<string, unknown>) => {
                const statusObj = c.cat_statuses as { name: string } | null;
                return (
                  <Link
                    key={c.id as string}
                    href={`/abogada/casos/${c.id as string}?from=client&client_id=${id}`}
                    className="flex items-center justify-between rounded-lg border p-3 hover:bg-gray-50 transition-colors"
                  >
                    <div>
                      <p className="font-medium text-sm text-integra-navy">{c.case_code as string}</p>
                      <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">
                        {(c.description as string) || "Sin descripción"}
                      </p>
                      {(c.cat_classifications as Record<string, string> | null) && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          {(c.cat_classifications as Record<string, string>).name}
                        </p>
                      )}
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      {statusObj && (
                        <Badge className={getStatusStyle(statusObj.name)}>
                          {statusObj.name}
                        </Badge>
                      )}
                      <p className="text-xs text-gray-400 mt-1">
                        {formatDate(c.updated_at as string)}
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-gray-400 py-2">No hay casos vinculados a este cliente.</p>
          )}
        </CardContent>
      </Card>

      {/* Documents with upload button */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Paperclip size={18} className="text-integra-gold" />
            Documentos
            {documents && documents.length > 0 && (
              <span className="rounded-full bg-integra-navy/10 px-2 py-0.5 text-xs font-bold text-integra-navy">
                {documents.length}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <DocumentUpload entityType="client" entityId={id} />

          {documents && documents.length > 0 && (
            <div className="space-y-2">
              {documents.map((doc: Record<string, unknown>) => (
                <div
                  key={doc.id as string}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText size={16} className="text-gray-400 shrink-0" />
                    <p className="text-sm font-medium truncate">{doc.file_name as string}</p>
                  </div>
                  <p className="text-xs text-gray-400 shrink-0 ml-3">
                    {formatDate(doc.created_at as string)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
