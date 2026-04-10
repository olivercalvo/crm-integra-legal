"use client";

import { useState } from "react";
import { Paperclip, Download, Loader2 } from "lucide-react";
import { DeleteDocumentButton } from "./delete-document-button";

interface DocumentRowProps {
  documentId: string;
  fileName: string;
  createdAt: string;
  canDelete: boolean;
}

async function getSignedUrl(documentId: string): Promise<string | null> {
  const res = await fetch(`/api/documents/${documentId}/url`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.url ?? null;
}

export function DocumentRow({
  documentId,
  fileName,
  createdAt,
  canDelete,
}: DocumentRowProps) {
  const [loading, setLoading] = useState(false);

  const handleOpen = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const url = await getSignedUrl(documentId);
      if (url) {
        window.open(url, "_blank");
      } else {
        alert("No se pudo abrir el documento");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const url = await getSignedUrl(documentId);
    if (url) {
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.target = "_blank";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } else {
      alert("No se pudo descargar el documento");
    }
  };

  return (
    <div
      onClick={handleOpen}
      className="flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors hover:bg-gray-50 hover:border-integra-gold/40"
    >
      <Paperclip size={18} className="shrink-0 text-integra-navy" />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate">{fileName}</p>
        <p className="text-xs text-gray-500">{createdAt}</p>
      </div>
      {loading && (
        <Loader2 size={16} className="shrink-0 text-gray-400 animate-spin" />
      )}
      <button
        onClick={handleDownload}
        className="shrink-0 rounded-md p-2 text-gray-400 hover:bg-integra-navy/10 hover:text-integra-navy transition-colors"
        title="Descargar"
      >
        <Download size={16} />
      </button>
      {canDelete && (
        <div onClick={(e) => e.stopPropagation()}>
          <DeleteDocumentButton
            documentId={documentId}
            fileName={fileName}
            createdAt={createdAt}
          />
        </div>
      )}
    </div>
  );
}
