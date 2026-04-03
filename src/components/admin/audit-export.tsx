"use client";

import { ExportButton } from "@/components/admin/export-button";
import { formatDateForExport, type ColumnConfig } from "@/lib/utils/export";
import { ENTITY_OPTIONS } from "@/lib/constants/audit";
import type { AuditLog } from "@/types/database";

interface AuditRow extends AuditLog {
  users: {
    full_name: string | null;
    email: string | null;
  } | null;
}

const ENTITY_LABELS: Record<string, string> = Object.fromEntries(
  ENTITY_OPTIONS.map((o) => [o.value, o.label])
);

function getUserName(row: AuditRow): string {
  return row.users?.full_name || row.users?.email || row.user_id || "Sistema";
}

function getEntityLabel(entity: string): string {
  return ENTITY_LABELS[entity] ?? entity;
}

const EXPORT_COLUMNS: ColumnConfig<AuditRow>[] = [
  {
    key: "created_at",
    header: "Fecha y hora",
    formatter: (v) => formatDateForExport(v as string),
  },
  {
    key: "users",
    header: "Usuario",
    formatter: (_, row) => getUserName(row),
  },
  {
    key: "action",
    header: "Acción",
    formatter: (v) => {
      const map: Record<string, string> = {
        create: "Creación",
        update: "Actualización",
        delete: "Eliminación",
      };
      return map[v as string] ?? String(v);
    },
  },
  {
    key: "entity",
    header: "Entidad",
    formatter: (v) => getEntityLabel(v as string),
  },
  { key: "entity_id", header: "ID Entidad" },
  { key: "field", header: "Campo" },
  { key: "old_value", header: "Valor anterior" },
  { key: "new_value", header: "Valor nuevo" },
];

interface AuditExportProps {
  data: AuditRow[];
  filename: string;
}

export function AuditExport({ data, filename }: AuditExportProps) {
  return (
    <ExportButton<AuditRow>
      data={data}
      columns={EXPORT_COLUMNS}
      filename={filename}
      formats={["csv", "excel"]}
      label="Exportar página"
    />
  );
}
