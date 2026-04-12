export type SummaryTask = {
  id: string;
  description: string;
  deadline: string | null;
  assignedBy?: string | null;
  assignedTo?: string | null;
};

export type SummaryActivity = {
  id: string;
  case_id: string;
  caseCode: string;
  clientName: string;
  type: "tarea" | "comentario";
  description: string;
  userName: string;
  created_at: string;
};

export type DailySummaryData = {
  recipientName: string;
  dateLabel: string;
  myPending: SummaryTask[];
  assignedByOthers: SummaryTask[];
  recentActivity: SummaryActivity[];
  appBaseUrl: string;
};

const NAVY = "#1B2A4A";
const GOLD = "#C5A55A";
const RED = "#B91C1C";
const GRAY_BORDER = "#E5E7EB";
const GRAY_TEXT = "#6B7280";
const TEXT = "#1F2937";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDateShort(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function todayPanamaISO(): string {
  const now = new Date();
  const panama = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  return panama.toISOString().split("T")[0];
}

function deadlineCell(deadline: string | null): string {
  if (!deadline) {
    return `<td style="padding:10px 12px;border-bottom:1px solid ${GRAY_BORDER};color:${GRAY_TEXT};font-size:13px;">—</td>`;
  }
  const today = todayPanamaISO();
  const overdue = deadline < today;
  const urgent = deadline === today;
  const color = overdue ? RED : urgent ? "#B45309" : TEXT;
  const label = overdue ? "Vencido" : urgent ? "Hoy" : formatDateShort(deadline);
  const weight = overdue || urgent ? "700" : "500";
  return `<td style="padding:10px 12px;border-bottom:1px solid ${GRAY_BORDER};color:${color};font-size:13px;font-weight:${weight};white-space:nowrap;">${escapeHtml(label)}</td>`;
}

function renderMyPendingTable(tasks: SummaryTask[]): string {
  if (tasks.length === 0) {
    return `<p style="padding:16px;margin:0;color:${GRAY_TEXT};font-size:14px;text-align:center;background:#F9FAFB;border-radius:6px;">No tienes pendientes. ¡Buen trabajo!</p>`;
  }
  const rows = tasks
    .map((t) => {
      const assignedTo = t.assignedTo
        ? `<div style="color:${GRAY_TEXT};font-size:12px;margin-top:2px;">Asignado a: <strong>${escapeHtml(t.assignedTo)}</strong></div>`
        : "";
      return `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid ${GRAY_BORDER};color:${TEXT};font-size:13px;">
            ${escapeHtml(t.description)}
            ${assignedTo}
          </td>
          ${deadlineCell(t.deadline)}
        </tr>`;
    })
    .join("");
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid ${GRAY_BORDER};border-radius:6px;overflow:hidden;">
      <thead>
        <tr style="background:#F9FAFB;">
          <th align="left" style="padding:10px 12px;font-size:11px;text-transform:uppercase;color:${GRAY_TEXT};letter-spacing:0.5px;border-bottom:1px solid ${GRAY_BORDER};">Descripción</th>
          <th align="left" style="padding:10px 12px;font-size:11px;text-transform:uppercase;color:${GRAY_TEXT};letter-spacing:0.5px;border-bottom:1px solid ${GRAY_BORDER};">Fecha límite</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderAssignedTable(tasks: SummaryTask[]): string {
  if (tasks.length === 0) {
    return `<p style="padding:16px;margin:0;color:${GRAY_TEXT};font-size:14px;text-align:center;background:#F9FAFB;border-radius:6px;">No tienes pendientes asignados por otros.</p>`;
  }
  const rows = tasks
    .map((t) => {
      return `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid ${GRAY_BORDER};color:${TEXT};font-size:13px;">${escapeHtml(t.description)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid ${GRAY_BORDER};color:${TEXT};font-size:13px;">${escapeHtml(t.assignedBy ?? "—")}</td>
          ${deadlineCell(t.deadline)}
        </tr>`;
    })
    .join("");
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid ${GRAY_BORDER};border-radius:6px;overflow:hidden;">
      <thead>
        <tr style="background:#F9FAFB;">
          <th align="left" style="padding:10px 12px;font-size:11px;text-transform:uppercase;color:${GRAY_TEXT};letter-spacing:0.5px;border-bottom:1px solid ${GRAY_BORDER};">Descripción</th>
          <th align="left" style="padding:10px 12px;font-size:11px;text-transform:uppercase;color:${GRAY_TEXT};letter-spacing:0.5px;border-bottom:1px solid ${GRAY_BORDER};">Asignado por</th>
          <th align="left" style="padding:10px 12px;font-size:11px;text-transform:uppercase;color:${GRAY_TEXT};letter-spacing:0.5px;border-bottom:1px solid ${GRAY_BORDER};">Fecha límite</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderActivityTable(items: SummaryActivity[], appBaseUrl: string): string {
  if (items.length === 0) {
    return `<p style="padding:16px;margin:0;color:${GRAY_TEXT};font-size:14px;text-align:center;background:#F9FAFB;border-radius:6px;">No hay actividad reciente.</p>`;
  }
  const rows = items
    .map((e) => {
      const caseUrl = `${appBaseUrl}/abogada/casos/${e.case_id}`;
      const typeLabel = e.type === "tarea" ? "Tarea" : "Comentario";
      const typeColor = e.type === "tarea" ? "#7C3AED" : "#2563EB";
      return `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid ${GRAY_BORDER};color:${GRAY_TEXT};font-size:12px;white-space:nowrap;">${formatDateShort(e.created_at)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid ${GRAY_BORDER};font-size:13px;">
            <a href="${caseUrl}" style="color:${NAVY};font-weight:700;text-decoration:none;font-family:monospace;">${escapeHtml(e.caseCode)}</a>
            <div style="color:${GRAY_TEXT};font-size:12px;margin-top:2px;">${escapeHtml(e.clientName)}</div>
          </td>
          <td style="padding:10px 12px;border-bottom:1px solid ${GRAY_BORDER};font-size:12px;color:${typeColor};font-weight:600;">${typeLabel}</td>
          <td style="padding:10px 12px;border-bottom:1px solid ${GRAY_BORDER};color:${TEXT};font-size:13px;">${escapeHtml(e.description)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid ${GRAY_BORDER};color:${GRAY_TEXT};font-size:12px;">${escapeHtml(e.userName)}</td>
        </tr>`;
    })
    .join("");
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid ${GRAY_BORDER};border-radius:6px;overflow:hidden;">
      <thead>
        <tr style="background:#F9FAFB;">
          <th align="left" style="padding:10px 12px;font-size:11px;text-transform:uppercase;color:${GRAY_TEXT};letter-spacing:0.5px;border-bottom:1px solid ${GRAY_BORDER};">Fecha</th>
          <th align="left" style="padding:10px 12px;font-size:11px;text-transform:uppercase;color:${GRAY_TEXT};letter-spacing:0.5px;border-bottom:1px solid ${GRAY_BORDER};">Caso</th>
          <th align="left" style="padding:10px 12px;font-size:11px;text-transform:uppercase;color:${GRAY_TEXT};letter-spacing:0.5px;border-bottom:1px solid ${GRAY_BORDER};">Tipo</th>
          <th align="left" style="padding:10px 12px;font-size:11px;text-transform:uppercase;color:${GRAY_TEXT};letter-spacing:0.5px;border-bottom:1px solid ${GRAY_BORDER};">Descripción</th>
          <th align="left" style="padding:10px 12px;font-size:11px;text-transform:uppercase;color:${GRAY_TEXT};letter-spacing:0.5px;border-bottom:1px solid ${GRAY_BORDER};">Creado por</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

export function renderDailySummaryEmail(data: DailySummaryData): string {
  const { recipientName, dateLabel, myPending, assignedByOthers, recentActivity, appBaseUrl } = data;

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Resumen Diario — Integra Legal</title>
</head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${TEXT};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:720px;background:#FFFFFF;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:${NAVY};padding:24px 28px;">
              <h1 style="margin:0;color:#FFFFFF;font-size:20px;font-family:Georgia,'Times New Roman',serif;letter-spacing:0.3px;">Integra Legal</h1>
              <p style="margin:4px 0 0 0;color:${GOLD};font-size:13px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;">Resumen Diario</p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 28px 8px 28px;">
              <p style="margin:0;font-size:14px;color:${GRAY_TEXT};">${escapeHtml(dateLabel)}</p>
              <p style="margin:4px 0 0 0;font-size:16px;color:${TEXT};">Hola <strong>${escapeHtml(recipientName)}</strong>, este es tu resumen del día.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 28px 8px 28px;">
              <h2 style="margin:0 0 12px 0;color:${NAVY};font-size:15px;border-left:3px solid ${GOLD};padding-left:10px;">Tus Pendientes (${myPending.length})</h2>
              ${renderMyPendingTable(myPending)}
            </td>
          </tr>
          <tr>
            <td style="padding:20px 28px 8px 28px;">
              <h2 style="margin:0 0 12px 0;color:${NAVY};font-size:15px;border-left:3px solid ${GOLD};padding-left:10px;">Pendientes Asignados por Otros (${assignedByOthers.length})</h2>
              ${renderAssignedTable(assignedByOthers)}
            </td>
          </tr>
          <tr>
            <td style="padding:20px 28px 24px 28px;">
              <h2 style="margin:0 0 12px 0;color:${NAVY};font-size:15px;border-left:3px solid ${GOLD};padding-left:10px;">Seguimientos Recientes</h2>
              ${renderActivityTable(recentActivity, appBaseUrl)}
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 24px 28px;text-align:center;border-top:1px solid ${GRAY_BORDER};">
              <a href="${appBaseUrl}/abogada" style="display:inline-block;background:${NAVY};color:#FFFFFF;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:13px;font-weight:600;">Abrir Dashboard</a>
              <p style="margin:16px 0 0 0;font-size:11px;color:${GRAY_TEXT};">Este es un mensaje automático del CRM Integra Legal.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
