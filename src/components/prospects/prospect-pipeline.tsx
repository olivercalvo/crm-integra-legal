"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Phone,
  Mail,
  Calendar,
  MessageSquare,
  ChevronDown,
  ChevronRight,
  Loader2,
  UserCheck,
  X,
  Briefcase,
  ArrowRight,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils/format-date";
import { matchesSearchQuery } from "@/lib/utils/search";
import { EmptySearchResult } from "@/components/ui/empty-search-result";

interface Prospect {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  service_interest: string | null;
  notes: string | null;
  contact_date: string;
  status: string;
  converted_client_id: string | null;
  created_at: string;
}

const PIPELINE_STAGES = [
  { key: "contacto_inicial", label: "Contacto Inicial", color: "bg-blue-100 text-blue-700 border-blue-300", headerBg: "bg-blue-50 border-blue-200" },
  { key: "propuesta_enviada", label: "Propuesta Enviada", color: "bg-amber-100 text-amber-700 border-amber-300", headerBg: "bg-amber-50 border-amber-200" },
  { key: "en_negociacion", label: "En Negociación", color: "bg-purple-100 text-purple-700 border-purple-300", headerBg: "bg-purple-50 border-purple-200" },
  { key: "ganado", label: "Ganado", color: "bg-green-100 text-green-700 border-green-300", headerBg: "bg-green-50 border-green-200" },
  { key: "perdido", label: "Perdido", color: "bg-gray-100 text-gray-600 border-gray-300", headerBg: "bg-gray-50 border-gray-200" },
];

interface ProspectPipelineProps {
  initialProspects: Prospect[];
}

export function ProspectPipeline({ initialProspects }: ProspectPipelineProps) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, Array<{ id: string; text: string; created_at: string }>>>({});
  const [commentText, setCommentText] = useState("");
  const [commentLoading, setCommentLoading] = useState(false);
  const [viewMode, setViewMode] = useState<"kanban" | "list">("kanban");
  const [search, setSearch] = useState("");

  const filteredProspects = search.trim()
    ? initialProspects.filter((p) =>
        matchesSearchQuery(
          search,
          p.name,
          p.phone,
          p.email,
          p.service_interest,
          p.notes,
          p.status
        )
      )
    : initialProspects;

  // Form fields
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [serviceInterest, setServiceInterest] = useState("");
  const [notes, setNotes] = useState("");

  async function handleCreate() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/prospects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          phone: phone || null,
          email: email || null,
          service_interest: serviceInterest || null,
          notes: notes || null,
        }),
      });
      if (res.ok) {
        setShowForm(false);
        setName(""); setPhone(""); setEmail(""); setServiceInterest(""); setNotes("");
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleMoveStage(prospectId: string, newStatus: string) {
    setActionLoading(prospectId);
    try {
      await fetch(`/api/prospects/${prospectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      router.refresh();
    } finally {
      setActionLoading(null);
    }
  }

  async function handleConvert(prospectId: string) {
    setActionLoading(prospectId);
    try {
      const res = await fetch(`/api/prospects/${prospectId}/convert`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        router.refresh();
        // Navigate to edit the new client
        router.push(`/abogada/clientes/${data.client.id}`);
      }
    } finally {
      setActionLoading(null);
    }
  }

  async function handleToggleComments(prospectId: string) {
    if (expandedId === prospectId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(prospectId);
    if (!comments[prospectId]) {
      const res = await fetch(`/api/prospects/${prospectId}/comments`);
      if (res.ok) {
        const data = await res.json();
        setComments((prev) => ({ ...prev, [prospectId]: data }));
      }
    }
  }

  async function handleAddComment(prospectId: string) {
    if (!commentText.trim()) return;
    setCommentLoading(true);
    try {
      const res = await fetch(`/api/prospects/${prospectId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: commentText.trim() }),
      });
      if (res.ok) {
        const c = await res.json();
        setComments((prev) => ({
          ...prev,
          [prospectId]: [c, ...(prev[prospectId] || [])],
        }));
        setCommentText("");
      }
    } finally {
      setCommentLoading(false);
    }
  }

  function getNextStage(current: string): string | null {
    const idx = PIPELINE_STAGES.findIndex((s) => s.key === current);
    if (idx < 0 || idx >= 3) return null; // ganado/perdido have no next
    return PIPELINE_STAGES[idx + 1].key;
  }

  function renderProspectCard(prospect: Prospect) {
    const stage = PIPELINE_STAGES.find((s) => s.key === prospect.status);
    const isExpanded = expandedId === prospect.id;
    const loading = actionLoading === prospect.id;
    const nextStage = getNextStage(prospect.status);
    const nextStageLabel = nextStage ? PIPELINE_STAGES.find((s) => s.key === nextStage)?.label : null;

    return (
      <Card key={prospect.id} className="border border-gray-100">
        <CardContent className="p-3">
          <div className="space-y-2">
            <div className="flex items-start justify-between">
              <p className="text-sm font-semibold text-gray-900">{prospect.name}</p>
              {viewMode === "list" && stage && (
                <Badge className={`text-xs ${stage.color}`}>{stage.label}</Badge>
              )}
            </div>

            {/* Contact info */}
            <div className="space-y-1 text-xs text-gray-500">
              {prospect.phone && (
                <div className="flex items-center gap-1">
                  <Phone size={11} /> {prospect.phone}
                </div>
              )}
              {prospect.email && (
                <div className="flex items-center gap-1">
                  <Mail size={11} /> {prospect.email}
                </div>
              )}
              {prospect.service_interest && (
                <div className="flex items-center gap-1">
                  <Briefcase size={11} /> {prospect.service_interest}
                </div>
              )}
              <div className="flex items-center gap-1">
                <Calendar size={11} /> {formatDate(prospect.contact_date)}
              </div>
            </div>

            {prospect.notes && (
              <p className="text-xs text-gray-500 line-clamp-2">{prospect.notes}</p>
            )}

            {/* Actions */}
            <div className="flex flex-wrap gap-1 pt-1">
              {nextStage && prospect.status !== "ganado" && prospect.status !== "perdido" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleMoveStage(prospect.id, nextStage)}
                  disabled={loading}
                  className="h-7 text-xs gap-1"
                >
                  {loading ? <Loader2 size={12} className="animate-spin" /> : <ArrowRight size={12} />}
                  {nextStageLabel}
                </Button>
              )}
              {prospect.status === "en_negociacion" && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleMoveStage(prospect.id, "ganado")}
                    disabled={loading}
                    className="h-7 text-xs gap-1 border-green-300 text-green-700 hover:bg-green-50"
                  >
                    <UserCheck size={12} /> Ganado
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleMoveStage(prospect.id, "perdido")}
                    disabled={loading}
                    className="h-7 text-xs gap-1 border-red-300 text-red-600 hover:bg-red-50"
                  >
                    <X size={12} /> Perdido
                  </Button>
                </>
              )}
              {prospect.status === "ganado" && !prospect.converted_client_id && (
                <Button
                  size="sm"
                  onClick={() => handleConvert(prospect.id)}
                  disabled={loading}
                  className="h-7 text-xs gap-1 bg-integra-gold text-integra-navy hover:bg-integra-gold/90"
                >
                  {loading ? <Loader2 size={12} className="animate-spin" /> : <UserCheck size={12} />}
                  Crear como Cliente
                </Button>
              )}
              {prospect.converted_client_id && (
                <Badge className="text-xs bg-green-100 text-green-700 border-transparent">
                  Convertido a cliente
                </Badge>
              )}
              <button
                onClick={() => handleToggleComments(prospect.id)}
                className="inline-flex items-center gap-1 h-7 px-2 text-xs text-gray-500 hover:text-integra-navy"
              >
                {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <MessageSquare size={12} />
              </button>
            </div>

            {/* Comments */}
            {isExpanded && (
              <div className="mt-2 space-y-2 border-t pt-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    placeholder="Nota de seguimiento..."
                    className="flex-1 rounded-md border border-gray-200 px-2 py-1.5 text-xs focus:border-integra-gold focus:outline-none"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddComment(prospect.id);
                      }
                    }}
                  />
                  <Button
                    size="sm"
                    onClick={() => handleAddComment(prospect.id)}
                    disabled={commentLoading || !commentText.trim()}
                    className="h-7 text-xs bg-integra-navy hover:bg-integra-navy/90"
                  >
                    {commentLoading ? <Loader2 size={12} className="animate-spin" /> : "Enviar"}
                  </Button>
                </div>
                {(comments[prospect.id] || []).map((c) => (
                  <div key={c.id} className="rounded bg-gray-50 px-2 py-1.5 text-xs">
                    <p className="text-gray-700">{c.text}</p>
                    <p className="mt-0.5 text-gray-400">{formatDate(c.created_at)}</p>
                  </div>
                ))}
                {comments[prospect.id]?.length === 0 && (
                  <p className="text-xs text-gray-400">Sin notas de seguimiento</p>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre, contacto, interés, etapa..."
          className="h-11 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-9 text-sm placeholder:text-gray-400 focus:border-integra-gold focus:outline-none focus:ring-1 focus:ring-integra-gold"
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            aria-label="Limpiar búsqueda"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Actions bar */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={() => setShowForm(true)}
          className="min-h-[48px] bg-integra-gold text-integra-navy hover:bg-integra-gold/90 font-semibold"
        >
          <Plus size={20} className="mr-2" />
          Nuevo Prospecto
        </Button>
        <div className="ml-auto flex gap-1">
          <Button
            size="sm"
            variant={viewMode === "kanban" ? "default" : "outline"}
            onClick={() => setViewMode("kanban")}
            className={`h-8 text-xs ${viewMode === "kanban" ? "bg-integra-navy" : ""}`}
          >
            Kanban
          </Button>
          <Button
            size="sm"
            variant={viewMode === "list" ? "default" : "outline"}
            onClick={() => setViewMode("list")}
            className={`h-8 text-xs ${viewMode === "list" ? "bg-integra-navy" : ""}`}
          >
            Lista
          </Button>
        </div>
      </div>

      {/* New prospect form */}
      {showForm && (
        <Card className="border border-integra-gold/30 bg-integra-gold/5">
          <CardContent className="p-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nombre del prospecto *"
                autoFocus
                className="rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-integra-gold focus:outline-none"
              />
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Teléfono"
                className="rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-integra-gold focus:outline-none"
              />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Correo electrónico"
                className="rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-integra-gold focus:outline-none"
              />
              <input
                type="text"
                value={serviceInterest}
                onChange={(e) => setServiceInterest(e.target.value)}
                placeholder="Servicio de interés"
                className="rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-integra-gold focus:outline-none"
              />
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notas adicionales..."
              rows={2}
              className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-integra-gold focus:outline-none"
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setShowForm(false); setName(""); setPhone(""); setEmail(""); setServiceInterest(""); setNotes(""); }}
                className="min-h-[36px]"
              >
                Cancelar
              </Button>
              <Button
                size="sm"
                onClick={handleCreate}
                disabled={saving || !name.trim()}
                className="min-h-[36px] bg-integra-navy hover:bg-integra-navy/90"
              >
                {saving ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
                Guardar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty state tras búsqueda */}
      {search.trim() && filteredProspects.length === 0 && (
        <EmptySearchResult query={search} emptyMessage="Sin prospectos" />
      )}

      {/* Kanban view */}
      {viewMode === "kanban" ? (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {PIPELINE_STAGES.map((stage) => {
            const stageProspects = filteredProspects.filter((p) => p.status === stage.key);
            return (
              <div key={stage.key} className="flex-shrink-0 w-72">
                <div className={`rounded-t-lg border px-3 py-2 ${stage.headerBg}`}>
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">{stage.label}</h3>
                    <Badge className={`text-xs ${stage.color}`}>{stageProspects.length}</Badge>
                  </div>
                </div>
                <div className="space-y-2 rounded-b-lg border border-t-0 bg-gray-50/50 p-2 min-h-[120px]">
                  {stageProspects.length > 0 ? (
                    stageProspects.map(renderProspectCard)
                  ) : (
                    <p className="py-8 text-center text-xs text-gray-400">Sin prospectos</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* List view */
        <div className="space-y-2">
          {filteredProspects.length > 0 ? (
            filteredProspects.map(renderProspectCard)
          ) : !search.trim() ? (
            <div className="py-12 text-center text-gray-400">
              <UserCheck size={48} className="mx-auto mb-3 opacity-40" />
              <p className="text-base font-medium text-gray-500">Sin prospectos</p>
              <p className="text-sm">Agrega tu primer prospecto con el botón de arriba</p>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
