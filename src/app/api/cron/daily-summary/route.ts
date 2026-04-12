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

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization");
  if (header === `Bearer ${secret}`) return true;
  // Vercel Cron sends this header too, plus a ?secret query param works for manual tests
  const url = new URL(req.url);
  if (url.searchParams.get("secret") === secret) return true;
  return false;
}

function formatDateLabelPanama(date: Date): string {
  const panama = new Date(date.getTime() - 5 * 60 * 60 * 1000);
  const dd = String(panama.getUTCDate()).padStart(2, "0");
  const mm = String(panama.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = panama.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

type CaseJoin = { case_code: string; clients: { name: string } };
type TodoOwnedRow = {
  id: string;
  description: string;
  deadline: string | null;
  user_id: string;
  assigned_to: string | null;
  assignee: { full_name: string } | null;
};
type TodoAssignedRow = {
  id: string;
  description: string;
  deadline: string | null;
  user_id: string;
  creator: { full_name: string } | null;
};
type CommentRow = {
  id: string;
  text: string;
  created_at: string;
  case_id: string;
  cases: CaseJoin;
  users: { full_name: string } | null;
};
type TaskActivityRow = {
  id: string;
  description: string;
  created_at: string;
  case_id: string;
  cases: CaseJoin;
  creator: { full_name: string } | null;
};

async function buildSummaryForUser(opts: {
  db: ReturnType<typeof createAdminClient>;
  tenantId: string;
  userId: string;
  recentActivity: SummaryActivity[];
}): Promise<{ myPending: SummaryTask[]; assignedByOthers: SummaryTask[]; recentActivity: SummaryActivity[] }> {
  const { db, tenantId, userId, recentActivity } = opts;

  const { data: myPendingRaw } = await db
    .from("personal_todos")
    .select(`
      id, description, deadline, user_id, assigned_to,
      assignee:users!personal_todos_assigned_to_fkey(full_name)
    `)
    .eq("tenant_id", tenantId)
    .eq("status", "pendiente")
    .eq("user_id", userId)
    .order("deadline", { ascending: true, nullsFirst: false });

  const { data: assignedRaw } = await db
    .from("personal_todos")
    .select(`
      id, description, deadline, user_id,
      creator:users!personal_todos_user_id_fkey(full_name)
    `)
    .eq("tenant_id", tenantId)
    .eq("status", "pendiente")
    .eq("assigned_to", userId)
    .neq("user_id", userId)
    .order("deadline", { ascending: true, nullsFirst: false });

  const myPending: SummaryTask[] = ((myPendingRaw ?? []) as unknown as TodoOwnedRow[]).map((t) => ({
    id: t.id,
    description: t.description,
    deadline: t.deadline,
    assignedTo: t.assigned_to && t.assigned_to !== userId ? t.assignee?.full_name ?? null : null,
  }));

  const assignedByOthers: SummaryTask[] = ((assignedRaw ?? []) as unknown as TodoAssignedRow[]).map((t) => ({
    id: t.id,
    description: t.description,
    deadline: t.deadline,
    assignedBy: t.creator?.full_name ?? null,
  }));

  return { myPending, assignedByOthers, recentActivity };
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

  const url = new URL(req.url);
  const isTest = url.searchParams.get("test") === "true";

  const db = createAdminClient();
  const resend = getResend();

  const { data: tenants } = await db.from("tenants").select("id");
  if (!tenants || tenants.length === 0) {
    return NextResponse.json({ error: "No tenants found" }, { status: 500 });
  }

  const results: Array<{ email: string; status: "sent" | "error"; error?: string }> = [];
  const dateLabel = formatDateLabelPanama(new Date());

  for (const tenant of tenants) {
    const tenantId = tenant.id as string;

    const { data: abogadas } = await db
      .from("users")
      .select("id, full_name, email")
      .eq("tenant_id", tenantId)
      .eq("role", "abogada")
      .eq("active", true);

    if (!abogadas || abogadas.length === 0) continue;

    const recentActivity = await fetchRecentActivity(db, tenantId);

    for (const abogada of abogadas) {
      const { myPending, assignedByOthers } = await buildSummaryForUser({
        db,
        tenantId,
        userId: abogada.id as string,
        recentActivity,
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
      const subject = `Resumen Diario — Integra Legal — ${dateLabel}${isTest ? ` (TEST: ${abogada.full_name})` : ""}`;

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

      if (isTest) {
        // For test mode, only send one email (the first abogada's data) to the admin
        return NextResponse.json({ ok: true, test: true, results });
      }
    }
  }

  return NextResponse.json({ ok: true, results });
}
