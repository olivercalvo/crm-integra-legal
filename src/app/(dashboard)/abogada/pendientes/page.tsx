import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { TodoList } from "@/components/todos/todo-list";

export default async function MisPendientesPage() {
  const { db, userId, tenantId } = await getAuthenticatedContext();

  // Fetch todos created by user
  const { data: ownedRaw } = await db
    .from("personal_todos")
    .select("*, creator:users!personal_todos_user_id_fkey(full_name), assignee:users!personal_todos_assigned_to_fkey(full_name)")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  // Fetch todos assigned to user (by others)
  const { data: assignedRaw } = await db
    .from("personal_todos")
    .select("*, creator:users!personal_todos_user_id_fkey(full_name), assignee:users!personal_todos_assigned_to_fkey(full_name)")
    .eq("tenant_id", tenantId)
    .eq("assigned_to", userId)
    .neq("user_id", userId)
    .order("created_at", { ascending: false });

  const mapTodo = (t: Record<string, unknown>) => ({
    id: t.id as string,
    description: t.description as string,
    deadline: t.deadline as string | null,
    status: t.status as "pendiente" | "cumplida",
    completed_at: t.completed_at as string | null,
    created_at: t.created_at as string,
    user_id: t.user_id as string,
    assigned_to: t.assigned_to as string | null,
    creator_name: (t.creator as { full_name: string } | null)?.full_name ?? null,
    assignee_name: (t.assignee as { full_name: string } | null)?.full_name ?? null,
  });

  const todos = [...(ownedRaw ?? []).map(mapTodo), ...(assignedRaw ?? []).map(mapTodo)];

  // Fetch team members for assignment dropdown
  const { data: teamRaw } = await db
    .from("users")
    .select("id, full_name, role")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .order("full_name");

  const teamMembers = (teamRaw ?? []).map((u) => ({
    id: u.id as string,
    name: u.full_name as string,
    role: u.role as string,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-integra-navy">Mis Pendientes</h1>
        <p className="text-sm text-gray-500">Tareas personales y recordatorios</p>
      </div>
      <TodoList initialTodos={todos} teamMembers={teamMembers} currentUserId={userId} />
    </div>
  );
}
