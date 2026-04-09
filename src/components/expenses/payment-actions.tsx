"use client";

import { useState, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2, Paperclip, X, Save, Loader2, FileText, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/utils/format-date";

interface PaymentData {
  id: string;
  amount: number;
  description: string | null;
  payment_date: string;
  payment_type: string;
  receipt_url?: string | null;
  receipt_filename?: string | null;
}

interface PaymentRowProps {
  payment: PaymentData;
  canEdit: boolean;
  colorClass?: string;
}

function formatCurrency(amount: number) {
  return `B/. ${amount.toLocaleString("es-PA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function PaymentRow({ payment, canEdit, colorClass = "text-green-600" }: PaymentRowProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [mode, setMode] = useState<"view" | "edit" | "delete">("view");
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Edit state
  const [editAmount, setEditAmount] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editDate, setEditDate] = useState("");

  // Receipt upload
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const displayName = payment.description || (payment.payment_type === "administrativo" ? "Pago Administrativo" : "Pago Trámite");

  const startEdit = () => {
    setEditAmount(String(payment.amount));
    setEditDescription(payment.description ?? "");
    setEditDate(payment.payment_date);
    setMode("edit");
    setError(null);
  };

  const handleSaveEdit = () => {
    const amount = parseFloat(editAmount);
    if (!amount || amount <= 0) {
      setError("Monto inválido");
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch(`/api/payments/${payment.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount,
            description: editDescription.trim() || null,
            payment_date: editDate,
          }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          setError(json.error ?? "Error al actualizar");
          return;
        }
        setMode("view");
        setError(null);
        showToast("Pago actualizado correctamente");
        router.refresh();
      } catch {
        setError("Error de conexión");
      }
    });
  };

  const handleDelete = () => {
    startTransition(async () => {
      try {
        const res = await fetch(`/api/payments/${payment.id}`, { method: "DELETE" });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          setError(json.error ?? "Error al eliminar");
          return;
        }
        showToast("Pago eliminado correctamente");
        router.refresh();
      } catch {
        setError("Error de conexión");
      }
    });
  };

  const handleUploadReceipt = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      setError("El archivo excede 10MB");
      return;
    }
    const allowed = ["image/jpeg", "image/png", "image/jpg", "application/pdf"];
    if (!allowed.includes(file.type)) {
      setError("Solo se permiten archivos JPG, PNG o PDF");
      return;
    }

    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/payments/${payment.id}/receipt`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? "Error al subir recibo");
        return;
      }
      showToast("Recibo adjuntado correctamente");
      router.refresh();
    } catch {
      setError("Error de conexión");
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteReceipt = () => {
    startTransition(async () => {
      try {
        const res = await fetch(`/api/payments/${payment.id}/receipt`, { method: "DELETE" });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          setError(json.error ?? "Error al eliminar recibo");
          return;
        }
        showToast("Recibo eliminado");
        router.refresh();
      } catch {
        setError("Error de conexión");
      }
    });
  };

  const handleViewReceipt = async () => {
    if (!payment.receipt_url) return;
    try {
      const res = await fetch(`/api/payments/${payment.id}/receipt/url`);
      const json = await res.json();
      if (json.url) {
        window.open(json.url, "_blank");
      }
    } catch {
      setError("No se pudo abrir el recibo");
    }
  };

  const isImage = payment.receipt_filename
    ? /\.(jpg|jpeg|png)$/i.test(payment.receipt_filename)
    : false;

  // ── View mode ──
  if (mode === "view") {
    return (
      <div className="py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="font-medium text-sm">{displayName}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-xs text-gray-500">{formatDate(payment.payment_date)}</p>
              {payment.receipt_url && (
                <button
                  onClick={handleViewReceipt}
                  className="inline-flex items-center gap-0.5 text-xs text-integra-gold hover:text-integra-gold/80"
                  title={payment.receipt_filename ?? "Ver recibo"}
                >
                  {isImage ? <ImageIcon size={12} /> : <FileText size={12} />}
                  <span className="max-w-[100px] truncate">{payment.receipt_filename}</span>
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <span className={`font-semibold text-sm ${colorClass}`}>
              {formatCurrency(payment.amount)}
            </span>
            {canEdit && (
              <>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className={`ml-1 rounded p-1.5 transition-colors ${
                    payment.receipt_url
                      ? "text-integra-gold hover:bg-integra-gold/10"
                      : "text-gray-300 hover:text-integra-gold hover:bg-gray-100"
                  }`}
                  title={payment.receipt_url ? "Cambiar recibo" : "Adjuntar recibo"}
                  disabled={uploading}
                >
                  {uploading ? <Loader2 size={14} className="animate-spin" /> : <Paperclip size={14} />}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".jpg,.jpeg,.png,.pdf"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleUploadReceipt(f);
                    e.target.value = "";
                  }}
                />
                <button
                  onClick={startEdit}
                  className="rounded p-1.5 text-gray-400 hover:text-integra-navy hover:bg-gray-100 transition-colors"
                  title="Editar pago"
                >
                  <Pencil size={14} />
                </button>
                <button
                  onClick={() => { setMode("delete"); setError(null); }}
                  className="rounded p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                  title="Eliminar pago"
                >
                  <Trash2 size={14} />
                </button>
              </>
            )}
          </div>
        </div>
        {toast && (
          <p className="mt-1 text-xs text-green-600 font-medium">{toast}</p>
        )}
        {error && (
          <p className="mt-1 text-xs text-red-600">{error}</p>
        )}
      </div>
    );
  }

  // ── Edit mode ──
  if (mode === "edit") {
    return (
      <div className="py-3 space-y-3 rounded-lg border border-integra-gold/30 bg-amber-50/30 p-3 -mx-1">
        <div className="grid gap-2 grid-cols-1 sm:grid-cols-3">
          <div className="space-y-1">
            <Label className="text-xs">Monto (B/.)</Label>
            <Input
              type="number"
              min="0.01"
              step="0.01"
              value={editAmount}
              onChange={(e) => setEditAmount(e.target.value)}
              className="h-10"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Descripción</Label>
            <Input
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              placeholder="Descripción del pago"
              className="h-10"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Fecha</Label>
            <Input
              type="date"
              value={editDate}
              onChange={(e) => setEditDate(e.target.value)}
              className="h-10"
            />
          </div>
        </div>

        {payment.receipt_url && (
          <div className="flex items-center gap-2 text-xs">
            <Paperclip size={12} className="text-integra-gold" />
            <span className="text-gray-600 truncate max-w-[200px]">{payment.receipt_filename}</span>
            <button
              onClick={handleDeleteReceipt}
              disabled={isPending}
              className="text-red-500 hover:text-red-700 text-xs underline"
            >
              Eliminar recibo
            </button>
          </div>
        )}

        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="flex gap-2 justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setMode("view"); setError(null); }}
            disabled={isPending}
            className="h-9"
          >
            <X size={14} className="mr-1" /> Cancelar
          </Button>
          <Button
            size="sm"
            onClick={handleSaveEdit}
            disabled={isPending}
            className="h-9 bg-integra-navy hover:bg-integra-navy/90"
          >
            {isPending ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Save size={14} className="mr-1" />}
            Guardar
          </Button>
        </div>
      </div>
    );
  }

  // ── Delete confirmation ──
  return (
    <div className="py-3 space-y-2 rounded-lg border border-red-200 bg-red-50/50 p-3 -mx-1">
      <p className="text-sm font-medium text-red-800">
        ¿Estás seguro de que deseas eliminar este pago?
      </p>
      <div className="text-xs text-gray-600 space-y-0.5">
        <p><strong>Descripción:</strong> {displayName}</p>
        <p><strong>Monto:</strong> {formatCurrency(payment.amount)}</p>
        <p><strong>Fecha:</strong> {formatDate(payment.payment_date)}</p>
        {payment.receipt_url && (
          <p className="text-amber-700">Este pago tiene un recibo adjunto que también se eliminará.</p>
        )}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2 justify-end">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { setMode("view"); setError(null); }}
          disabled={isPending}
          className="h-9"
        >
          Cancelar
        </Button>
        <Button
          size="sm"
          onClick={handleDelete}
          disabled={isPending}
          className="h-9 bg-red-600 hover:bg-red-700 text-white"
        >
          {isPending ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Trash2 size={14} className="mr-1" />}
          Sí, eliminar
        </Button>
      </div>
    </div>
  );
}
