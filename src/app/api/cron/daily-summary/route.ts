import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { EMAIL_FROM, getResend } from "@/lib/email/resend";
import {
  renderDailySummaryEmail,
  type SummaryActivity,
  type SummaryTask,
} from "@/lib/email/daily-summary-template";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const APP_BASE_URL = "https://crm-integra-legal.vercel.app";
const TEST_RECIPIENT = "oliver@clienteenelcentro.com";
const TENANT_ID = "a0000000-0000-0000-0000-000000000001";

const DAYS_ES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const MONTHS_ES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization");
  if (header === `Bearer ${secret}`) return true;
  const url = new URL(req.url);
  if (url.searchParams.get("secret") === secret) return true;
  return false;
}

/** Returns e.g. "Lunes, 13 de abril de 2026" */
function formatDateLabelPanama(date: Date): string {
  const panama = new Date(date.getTime() - 5 * 60 * 60 * 1000);
  const dayName = DAYS_ES[panama.getUTCDay()];
  const day = panama.getUTCDate();
  const month = MONTHS_ES[panama.getUTCMonth()];
  const year = panama.getUTCFullYear();
  return `${dayName}, ${day} de ${month} de ${year}`;
}

/** Returns "DD/MM/YYYY" for the email subject */
function formatDateSubject(date: Date): string {
  const panama = new Date(date.getTime() - 5 * 60 * 60 * 1000);
  const dd = String(panama.getUTCDate()).padStart(2, "0");
  const mm = String(panama.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = panama.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/** Returns day of week in Panama timezone (0=Sunday) */
function panamaDayOfWeek(date: Date): number {
  const panama = new Date(date.getTime() - 5 * 60 * 60 * 1000);
  return panama.getUTCDay();
}

type PersonalTodoOwnRow = {
  id: string;
  description: string;
  deadline: string | null;
  status: string;
  user_id: string;
  assigned_to: string | null;
  assignee: { full_name: string } | null;
};

type PersonalTodoAssignedRow = {
  id: string;
  description: string;
  deadline: string | null;
  status: string;
  user_id: string;
  creator: { full_name: string } | null;
};

type CommentRow = {
  id: string;
  text: string;
  created_at: string;
  case_id: string;
  cases: {
    case_code: string;
    clients: { name: string };
  };
  users: { full_name: string } | null;
};

type TaskActivityRow = {
  id: string;
  description: string;
  created_at: string;
  case_id: string;
  cases: {
    case_code: string;
    clients: { name: string };
  };
  creator: { full_name: string } | null;
};

async function buildSummaryForUser(opts: {
  db: ReturnType<typeof createAdminClient>;
  tenantId: string;
  userId: string;
}): Promise<{ myPending: SummaryTask[]; assignedByOthers: SummaryTask[] }> {
  const { db, tenantId, userId } = opts;

  // Replica exactamente la lógica del dashboard /abogada (page.tsx): consulta
  // personal_todos, filtra status='pendiente' en JS, slice 15. Cada query está
  // scopeada por userId — sin fugas entre usuarias.
  const { data: myPendingRaw } = await db
    .from("personal_todos")
    .select(`
      id, description, deadline, status, user_id, assigned_to,
      assignee:users!personal_todos_assigned_to_fkey(full_name)
    `)
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .order("deadline", { ascending: true, nullsFirst: false });

  const { data: assignedRaw } = await db
    .from("personal_todos")
    .select(`
      id, description, deadline, status, user_id,
      creator:users!personal_todos_user_id_fkey(full_name)
    `)
    .eq("tenant_id", tenantId)
    .eq("assigned_to", userId)
    .neq("user_id", userId)
    .order("deadline", { ascending: true, nullsFirst: false });

  const myPending: SummaryTask[] = ((myPendingRaw ?? []) as unknown as PersonalTodoOwnRow[])
    .filter((t) => t.status === "pendiente")
    .slice(0, 15)
    .map((t) => ({
      id: t.id,
      description: t.description,
      deadline: t.deadline,
      assigneeName:
        t.assigned_to && t.assigned_to !== userId ? t.assignee?.full_name ?? null : null,
    }));

  const assignedByOthers: SummaryTask[] = ((assignedRaw ?? []) as unknown as PersonalTodoAssignedRow[])
    .filter((t) => t.status === "pendiente")
    .slice(0, 15)
    .map((t) => ({
      id: t.id,
      description: t.description,
      deadline: t.deadline,
      assignedBy: t.creator?.full_name ?? null,
    }));

  return { myPending, assignedByOthers };
}

async function fetchRecentActivity(
  db: ReturnType<typeof createAdminClient>,
  tenantId: string,
): Promise<SummaryActivity[]> {
  const [tasksRes, commentsRes] = await Promise.all([
    db
      .from("tasks")
      .select(`
        id, description, created_at, case_id,
        cases!inner(case_code, clients!inner(name)),
        creator:users!tasks_created_by_fkey(full_name)
      `)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(20),
    db
      .from("comments")
      .select(`
        id, text, created_at, case_id,
        cases!inner(case_code, clients!inner(name)),
        users(full_name)
      `)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const tasks: SummaryActivity[] = ((tasksRes.data ?? []) as unknown as TaskActivityRow[]).map((t) => ({
    id: `t-${t.id}`,
    case_id: t.case_id,
    caseCode: t.cases.case_code,
    clientName: t.cases.clients.name,
    type: "tarea",
    description: t.description,
    userName: t.creator?.full_name ?? "Sistema",
    created_at: t.created_at,
  }));

  const comments: SummaryActivity[] = ((commentsRes.data ?? []) as unknown as CommentRow[]).map((c) => ({
    id: `c-${c.id}`,
    case_id: c.case_id,
    caseCode: c.cases.case_code,
    clientName: c.cases.clients.name,
    type: "comentario",
    description: c.text,
    userName: c.users?.full_name ?? "Sistema",
    created_at: c.created_at,
  }));

  return [...tasks, ...comments]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 15);
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Check if today is Sunday in Panama timezone — no email on Sundays
    const now = new Date();
    const dayOfWeek = panamaDayOfWeek(now);
    if (dayOfWeek === 0) {
      return NextResponse.json({ ok: true, message: "Domingo, no se envía" });
    }

    const url = new URL(req.url);
    const isTest = url.searchParams.get("test") === "true";

    const db = createAdminClient();
    const resend = getResend();

    const results: Array<{ email: string; status: "sent" | "error"; error?: string }> = [];
    const dateLabel = formatDateLabelPanama(now);
    const dateSubject = formatDateSubject(now);

    // Fetch abogadas for the tenant
    const { data: abogadas } = await db
      .from("users")
      .select("id, full_name, email")
      .eq("tenant_id", TENANT_ID)
      .eq("role", "abogada")
      .eq("active", true);

    if (!abogadas || abogadas.length === 0) {
      return NextResponse.json({ ok: true, message: "No active abogadas found" });
    }

    // Fetch recent activity once (shared across all recipients)
    const recentActivity = await fetchRecentActivity(db, TENANT_ID);

    for (const abogada of abogadas) {
      const { myPending, assignedByOthers } = await buildSummaryForUser({
        db,
        tenantId: TENANT_ID,
        userId: abogada.id as string,
      });

      const html = renderDailySummaryEmail({
        recipientName: (abogada.full_name as string) ?? "Abogada",
        dateLabel,
        myPending,
        assignedByOthers,
        recentActivity,
        appBaseUrl: APP_BASE_URL,
      });

      const to = isTest ? TEST_RECIPIENT : (abogada.email as string);
      const subject = `Seguimientos y Pendientes - ${dateSubject}${isTest ? ` (TEST: ${abogada.full_name})` : ""}`;

      try {
        await resend.emails.send({
          from: EMAIL_FROM,
          to,
          subject,
          html,
        });
        results.push({ email: to, status: "sent" });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({ email: to, status: "error", error: message });
      }
    }

    return NextResponse.json({ ok: true, test: isTest, results });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "Internal error", detail: message }, { status: 500 });
  }
}
