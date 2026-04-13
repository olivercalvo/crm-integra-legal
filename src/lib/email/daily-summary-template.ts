export type SummaryTask = {
  id: string;
  case_id: string;
  caseCode: string;
  clientName: string;
  description: string;
  deadline: string | null;
  assignedBy?: string | null;
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
const WHITE = "#FFFFFF";
const RED = "#B91C1C";
const YELLOW_BG = "#FEF3C7";
const YELLOW_TEXT = "#92400E";
const RED_BG = "#FEE2E2";
const GRAY_BORDER = "#E5E7EB";
const GRAY_TEXT = "#6B7280";
const GRAY_BG = "#F9FAFB";
const TEXT = "#1F2937";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "...";
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

function deadlineBadge(deadline: string | null): string {
  if (!deadline) {
    return `<td style="padding:10px 12px;border-bottom:1px solid ${GRAY_BORDER};color:${GRAY_TEXT};font-size:13px;">—</td>`;
  }
  const today = todayPanamaISO();
  const overdue = deadline < today;
  const isToday = deadline === today;

  if (overdue) {
    return `<td style="padding:10px 12px;border-bottom:1px solid ${GRAY_BORDER};font-size:12px;">
      <span style="display:inline-block;background:${RED_BG};color:${RED};padding:3px 8px;border-radius:4px;font-weight:700;font-size:11px;">Vencido ${formatDateShort(deadline)}</span>
    </td>`;
  }
  if (isToday) {
    return `<td style="padding:10px 12px;border-bottom:1px solid ${GRAY_BORDER};font-size:12px;">
      <span style="display:inline-block;background:${YELLOW_BG};color:${YELLOW_TEXT};padding:3px 8px;border-radius:4px;font-weight:700;font-size:11px;">Vence hoy</span>
    </td>`;
  }
  return `<td style="padding:10px 12px;border-bottom:1px solid ${GRAY_BORDER};color:${TEXT};font-size:13px;">${formatDateShort(deadline)}</td>`;
}

function caseLink(caseCode: string, caseId: string, appBaseUrl: string): string {
  const url = `${appBaseUrl}/abogada/casos/${caseId}`;
  return `<a href="${url}" style="color:${GOLD};text-decoration:underline;font-weight:700;font-family:monospace;font-size:13px;">${escapeHtml(caseCode)}</a>`;
}

function sectionButton(label: string, href: string): string {
  return `<div style="text-align:center;padding:12px 0 4px 0;">
    <a href="${href}" style="display:inline-block;background:${NAVY};color:${WHITE};text-decoration:none;padding:10px 24px;border-radius:6px;font-size:13px;font-weight:600;">${escapeHtml(label)}</a>
  </div>`;
}

const TH_STYLE = `padding:10px 12px;font-size:11px;text-transform:uppercase;color:${GRAY_TEXT};letter-spacing:0.5px;border-bottom:1px solid ${GRAY_BORDER};`;
const TD_STYLE = `padding:10px 12px;border-bottom:1px solid ${GRAY_BORDER};font-size:13px;color:${TEXT};`;

function renderMyPendingTable(tasks: SummaryTask[], appBaseUrl: string): string {
  if (tasks.length === 0) {
    return `<p style="padding:16px;margin:0;color:${GRAY_TEXT};font-size:14px;text-align:center;background:${GRAY_BG};border-radius:6px;">No tienes pendientes propios. &iexcl;Excelente trabajo!</p>`;
  }
  const rows = tasks
    .map(
      (t, i) => `
      <tr style="background:${i % 2 === 1 ? GRAY_BG : WHITE};">
        <td style="${TD_STYLE}">${caseLink(t.caseCode, t.case_id, appBaseUrl)}</td>
        <td style="${TD_STYLE}">${escapeHtml(t.clientName)}</td>
        <td style="${TD_STYLE}">${escapeHtml(t.description)}</td>
        ${deadlineBadge(t.deadline)}
      </tr>`,
    )
    .join("");
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid ${GRAY_BORDER};border-radius:6px;overflow:hidden;">
      <thead>
        <tr style="background:${GRAY_BG};">
          <th align="left" style="${TH_STYLE}">Caso</th>
          <th align="left" style="${TH_STYLE}">Cliente</th>
          <th align="left" style="${TH_STYLE}">Tarea</th>
          <th align="left" style="${TH_STYLE}">Vence</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${sectionButton("Ver en el CRM", `${appBaseUrl}/abogada/pendientes`)}`;
}

function renderAssignedTable(tasks: SummaryTask[], appBaseUrl: string): string {
  if (tasks.length === 0) {
    return `<p style="padding:16px;margin:0;color:${GRAY_TEXT};font-size:14px;text-align:center;background:${GRAY_BG};border-radius:6px;">No tienes pendientes asignados por otros.</p>`;
  }
  const rows = tasks
    .map(
      (t, i) => `
      <tr style="background:${i % 2 === 1 ? GRAY_BG : WHITE};">
        <td style="${TD_STYLE}">${caseLink(t.caseCode, t.case_id, appBaseUrl)}</td>
        <td style="${TD_STYLE}">${escapeHtml(t.clientName)}</td>
        <td style="${TD_STYLE}">${escapeHtml(t.description)}</td>
        <td style="${TD_STYLE}">${escapeHtml(t.assignedBy ?? "—")}</td>
        ${deadlineBadge(t.deadline)}
      </tr>`,
    )
    .join("");
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid ${GRAY_BORDER};border-radius:6px;overflow:hidden;">
      <thead>
        <tr style="background:${GRAY_BG};">
          <th align="left" style="${TH_STYLE}">Caso</th>
          <th align="left" style="${TH_STYLE}">Cliente</th>
          <th align="left" style="${TH_STYLE}">Tarea</th>
          <th align="left" style="${TH_STYLE}">Asignado por</th>
          <th align="left" style="${TH_STYLE}">Vence</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${sectionButton("Ver en el CRM", `${appBaseUrl}/abogada/pendientes`)}`;
}

function renderActivityTable(items: SummaryActivity[], appBaseUrl: string): string {
  if (items.length === 0) {
    return `<p style="padding:16px;margin:0;color:${GRAY_TEXT};font-size:14px;text-align:center;background:${GRAY_BG};border-radius:6px;">No hay actividad reciente.</p>`;
  }
  const rows = items
    .map(
      (e, i) => `
      <tr style="background:${i % 2 === 1 ? GRAY_BG : WHITE};">
        <td style="${TD_STYLE} white-space:nowrap;font-size:12px;color:${GRAY_TEXT};">${formatDateShort(e.created_at)}</td>
        <td style="${TD_STYLE}">${caseLink(e.caseCode, e.case_id, appBaseUrl)}</td>
        <td style="${TD_STYLE}">${escapeHtml(e.clientName)}</td>
        <td style="${TD_STYLE}">${escapeHtml(truncate(e.description, 100))}</td>
        <td style="${TD_STYLE} font-size:12px;color:${GRAY_TEXT};">${escapeHtml(e.userName)}</td>
      </tr>`,
    )
    .join("");
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid ${GRAY_BORDER};border-radius:6px;overflow:hidden;">
      <thead>
        <tr style="background:${GRAY_BG};">
          <th align="left" style="${TH_STYLE}">Fecha</th>
          <th align="left" style="${TH_STYLE}">Caso</th>
          <th align="left" style="${TH_STYLE}">Cliente</th>
          <th align="left" style="${TH_STYLE}">Descripci&oacute;n</th>
          <th align="left" style="${TH_STYLE}">Registrado por</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${sectionButton("Ver en el CRM", `${appBaseUrl}/abogada/seguimiento`)}`;
}

export function renderDailySummaryEmail(data: DailySummaryData): string {
  const { recipientName, dateLabel, myPending, assignedByOthers, recentActivity, appBaseUrl } = data;
  const currentYear = new Date().getFullYear();

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Seguimientos y Pendientes — Integra Legal</title>
</head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${TEXT};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${WHITE};border-radius:10px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">

          <!-- HEADER -->
          <tr>
            <td style="background:${NAVY};padding:28px 28px 20px 28px;text-align:center;">
              <h1 style="margin:0;color:${WHITE};font-size:22px;font-family:Georgia,'Times New Roman',serif;letter-spacing:0.5px;">DESPACHO JUR&Iacute;DICO &mdash; INTEGRA LEGAL</h1>
              <p style="margin:6px 0 0 0;color:${GOLD};font-size:14px;font-weight:600;letter-spacing:1px;">Panam&aacute;</p>
              <div style="margin:16px auto 0 auto;width:80px;height:2px;background:${GOLD};border-radius:1px;"></div>
            </td>
          </tr>

          <!-- SUBTITLE & GREETING -->
          <tr>
            <td style="padding:24px 28px 8px 28px;">
              <p style="margin:0;font-size:14px;color:${GOLD};font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Seguimientos y Pendientes &mdash; ${escapeHtml(dateLabel)}</p>
              <p style="margin:12px 0 0 0;font-size:16px;color:${TEXT};">Buenos d&iacute;as, <strong>Licda. ${escapeHtml(recipientName)}</strong></p>
            </td>
          </tr>

          <!-- SECTION 1: TUS PENDIENTES -->
          <tr>
            <td style="padding:20px 28px 8px 28px;">
              <h2 style="margin:0 0 12px 0;color:${NAVY};font-size:15px;border-left:3px solid ${GOLD};padding-left:10px;">Tus Pendientes (${myPending.length})</h2>
              ${renderMyPendingTable(myPending, appBaseUrl)}
            </td>
          </tr>

          <!-- SECTION 2: PENDIENTES ASIGNADOS POR OTROS -->
          <tr>
            <td style="padding:20px 28px 8px 28px;">
              <h2 style="margin:0 0 12px 0;color:${NAVY};font-size:15px;border-left:3px solid ${GOLD};padding-left:10px;">Pendientes Asignados por Otros (${assignedByOthers.length})</h2>
              ${renderAssignedTable(assignedByOthers, appBaseUrl)}
            </td>
          </tr>

          <!-- SECTION 3: SEGUIMIENTOS RECIENTES -->
          <tr>
            <td style="padding:20px 28px 24px 28px;">
              <h2 style="margin:0 0 12px 0;color:${NAVY};font-size:15px;border-left:3px solid ${GOLD};padding-left:10px;">Seguimientos Recientes</h2>
              ${renderActivityTable(recentActivity, appBaseUrl)}
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="background:${NAVY};padding:24px 28px;text-align:center;">
              <p style="margin:0;color:${WHITE};font-size:14px;font-family:Georgia,'Times New Roman',serif;letter-spacing:0.3px;">INTEGRA LEGAL &mdash; Gesti&oacute;n Legal Integral</p>
              <p style="margin:12px 0 0 0;color:${GOLD};font-size:11px;">Este es un mensaje autom&aacute;tico del CRM Integra Legal.</p>
              <p style="margin:4px 0 0 0;color:${GOLD};font-size:11px;">No responder a este correo.</p>
              <p style="margin:12px 0 0 0;color:${GRAY_TEXT};font-size:10px;">&copy; ${currentYear} Integra Legal</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
