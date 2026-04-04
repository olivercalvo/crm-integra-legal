import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { SeguimientoView, type TaskRow, type CommentRow } from "@/components/seguimiento/seguimiento-view";

export default async function SeguimientoPage() {
  const { db, tenantId } = await getAuthenticatedContext();

  const { data: tasksRaw } = await db
    .from("tasks")
    .select(`
      id, description, deadline, status, completed_at, created_at, case_id, assigned_to,
      cases!inner(case_code, clients!inner(name)),
      assigned:users!tasks_assigned_to_fkey(full_name)
    `)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  const { data: commentsRaw } = await db
    .from("comments")
    .select(`
      id, text, created_at, follow_up_date, case_id,
      cases!inner(case_code, clients!inner(name)),
      users(full_name)
    `)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(100);

  const tasks: TaskRow[] = (tasksRaw ?? []).map((t: Record<string, unknown>) => {
    const c = t.cases as { case_code: string; clients: { name: string } };
    const assigned = t.assigned as { full_name: string } | null;
    return {
      id: t.id as string,
      description: t.description as string,
      deadline: t.deadline as string | null,
      status: t.status as string,
      completed_at: t.completed_at as string | null,
      created_at: t.created_at as string,
      case_id: t.case_id as string,
      caseCode: c.case_code,
      clientName: c.clients.name,
      assignedTo: assigned?.full_name ?? null,
    };
  });

  const comments: CommentRow[] = (commentsRaw ?? []).map((c: Record<string, unknown>) => {
    const cs = c.cases as { case_code: string; clients: { name: string } };
    const u = c.users as { full_name: string } | null;
    return {
      id: c.id as string,
      text: c.text as string,
      created_at: c.created_at as string,
      follow_up_date: c.follow_up_date as string | null,
      case_id: c.case_id as string,
      caseCode: cs.case_code,
      clientName: cs.clients.name,
      userName: u?.full_name ?? "Sistema",
    };
  });

  return <SeguimientoView tasks={tasks} comments={comments} />;
}
