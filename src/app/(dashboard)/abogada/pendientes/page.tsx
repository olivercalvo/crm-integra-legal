import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { TodoList } from "@/components/todos/todo-list";

export default async function MisPendientesPage() {
  const { db, userId, tenantId } = await getAuthenticatedContext();

  const { data: todosRaw } = await db
    .from("personal_todos")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  const todos = (todosRaw ?? []).map((t) => ({
    id: t.id as string,
    description: t.description as string,
    deadline: t.deadline as string | null,
    status: t.status as "pendiente" | "cumplida",
    completed_at: t.completed_at as string | null,
    created_at: t.created_at as string,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-integra-navy">Mis Pendientes</h1>
        <p className="text-sm text-gray-500">Tareas personales y recordatorios</p>
      </div>
      <TodoList initialTodos={todos} />
    </div>
  );
}
