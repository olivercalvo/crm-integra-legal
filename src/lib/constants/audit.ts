export const ENTITY_OPTIONS = [
  { value: "clients",   label: "Clientes" },
  { value: "cases",     label: "Casos" },
  { value: "expenses",  label: "Gastos" },
  { value: "tasks",     label: "Tareas" },
  { value: "documents", label: "Documentos" },
  { value: "comments",  label: "Comentarios" },
  { value: "users",     label: "Usuarios" },
  { value: "payments",  label: "Pagos" },
] as const;

export const ACTION_OPTIONS = [
  { value: "create", label: "Creación" },
  { value: "update", label: "Actualización" },
  { value: "delete", label: "Eliminación" },
] as const;
