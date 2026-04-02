import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ClientListSearch, ClientListPagination } from "@/components/clients/client-list";
import { Plus, User, Phone } from "lucide-react";
import type { Client } from "@/types/database";

const PAGE_SIZE = 10;

interface PageProps {
  searchParams: { q?: string; page?: string };
}

export default async function ClientesPage({ searchParams }: PageProps) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const search = searchParams.q?.trim() ?? "";
  const page = Math.max(1, parseInt(searchParams.page ?? "1", 10));
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = supabase
    .from("clients")
    .select("*", { count: "exact" })
    .eq("active", true)
    .order("client_number", { ascending: true })
    .range(from, to);

  if (search) {
    query = query.or(
      `name.ilike.%${search}%,ruc.ilike.%${search}%,client_number.ilike.%${search}%`
    );
  }

  const { data: clients, count, error } = await query;

  if (error) {
    console.error("Error fetching clients:", error);
  }

  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const list: Client[] = clients ?? [];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-serif text-2xl font-bold text-integra-navy">Clientes</h2>
          <p className="text-sm text-gray-500">
            {count ?? 0} cliente{(count ?? 0) !== 1 ? "s" : ""} activo{(count ?? 0) !== 1 ? "s" : ""}
          </p>
        </div>
        <Button
          asChild
          className="min-h-[48px] bg-integra-gold text-integra-navy hover:bg-integra-gold/90 font-semibold"
        >
          <Link href="/abogada/clientes/nuevo">
            <Plus size={18} />
            Nuevo Cliente
          </Link>
        </Button>
      </div>

      {/* Search */}
      <ClientListSearch defaultSearch={search} />

      {/* Empty state */}
      {list.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
          <User size={40} className="mb-3 text-gray-300" />
          <p className="font-medium text-gray-500">
            {search ? "No se encontraron clientes" : "Aún no hay clientes"}
          </p>
          <p className="mt-1 text-sm text-gray-400">
            {search
              ? "Intenta con otro término de búsqueda"
              : "Crea el primero haciendo clic en «Nuevo Cliente»"}
          </p>
        </div>
      )}

      {/* Mobile: card list */}
      {list.length > 0 && (
        <>
          <div className="flex flex-col gap-3 sm:hidden">
            {list.map((client) => (
              <Link
                key={client.id}
                href={`/abogada/clientes/${client.id}`}
                className="block"
              >
                <Card className="hover:shadow-md transition-shadow active:scale-[0.99]">
                  <CardContent className="p-4 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-integra-navy leading-tight">
                          {client.name}
                        </p>
                        <p className="text-xs text-gray-400 font-mono">{client.client_number}</p>
                      </div>
                      {client.type && (
                        <Badge className="shrink-0 bg-integra-navy/10 text-integra-navy border-0 text-xs">
                          {client.type}
                        </Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500">
                      {client.ruc && <span>RUC: {client.ruc}</span>}
                      {client.phone && (
                        <span className="flex items-center gap-1">
                          <Phone size={13} /> {client.phone}
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>

          {/* Desktop: table */}
          <div className="hidden sm:block overflow-hidden rounded-xl border bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3">N° Cliente</th>
                  <th className="px-4 py-3">Nombre</th>
                  <th className="px-4 py-3">RUC</th>
                  <th className="px-4 py-3">Teléfono</th>
                  <th className="px-4 py-3">Clasificación</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {list.map((client) => (
                  <tr
                    key={client.id}
                    className="hover:bg-gray-50 transition-colors cursor-pointer"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/abogada/clientes/${client.id}`}
                        className="block font-mono text-xs text-gray-500 hover:text-integra-navy"
                      >
                        {client.client_number}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/abogada/clientes/${client.id}`}
                        className="block font-medium text-integra-navy hover:underline"
                      >
                        {client.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{client.ruc ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-500">{client.phone ?? "—"}</td>
                    <td className="px-4 py-3">
                      {client.type ? (
                        <Badge className="bg-integra-navy/10 text-integra-navy border-0 text-xs">
                          {client.type}
                        </Badge>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <ClientListPagination page={page} totalPages={totalPages} />
        </>
      )}
    </div>
  );
}
