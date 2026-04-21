import { SearchX } from "lucide-react";

interface EmptySearchResultProps {
  query: string;
  /** Mensaje alternativo cuando no hay query (lista realmente vacía). */
  emptyMessage?: string;
  /** Icono custom. Default: SearchX. */
  icon?: React.ReactNode;
  className?: string;
}

/**
 * Componente unificado para "sin resultados" — usar en TODOS los listados.
 * Si hay query muestra "No se encontraron resultados para: <query>".
 * Si no hay query muestra `emptyMessage` (o un fallback).
 */
export function EmptySearchResult({
  query,
  emptyMessage = "No hay registros para mostrar.",
  icon,
  className = "",
}: EmptySearchResultProps) {
  const trimmed = query.trim();
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-xl border border-dashed py-12 text-center ${className}`}
    >
      {icon ?? <SearchX size={40} className="mb-3 text-gray-300" />}
      {trimmed ? (
        <>
          <p className="font-medium text-gray-500">
            No se encontraron resultados para: <span className="text-integra-navy">&ldquo;{trimmed}&rdquo;</span>
          </p>
          <p className="mt-1 text-sm text-gray-400">
            Intenta con otro término o quita los filtros.
          </p>
        </>
      ) : (
        <p className="font-medium text-gray-500">{emptyMessage}</p>
      )}
    </div>
  );
}
