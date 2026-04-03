"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface PagePaginationProps {
  page: number;
  totalPages: number;
}

export function PagePagination({ page, totalPages }: PagePaginationProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (totalPages <= 1) return null;

  const goToPage = (newPage: number) => {
    const params = new URLSearchParams(searchParams.toString());
    if (newPage <= 1) {
      params.delete("page");
    } else {
      params.set("page", String(newPage));
    }
    router.push(`${pathname}?${params.toString()}`);
  };

  // Generate page numbers to display
  const pages: (number | "ellipsis")[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3) pages.push("ellipsis");
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) {
      pages.push(i);
    }
    if (page < totalPages - 2) pages.push("ellipsis");
    pages.push(totalPages);
  }

  return (
    <div className="flex items-center justify-center gap-1 mt-4">
      <button
        onClick={() => goToPage(page - 1)}
        disabled={page <= 1}
        className="flex items-center gap-1 min-h-[44px] min-w-[44px] justify-center rounded-md border px-2 text-sm font-medium disabled:opacity-40 hover:bg-gray-100 transition-colors"
        aria-label="Página anterior"
      >
        <ChevronLeft size={16} />
        <span className="hidden sm:inline">Anterior</span>
      </button>

      {pages.map((p, i) =>
        p === "ellipsis" ? (
          <span key={`e${i}`} className="px-2 text-gray-400">…</span>
        ) : (
          <button
            key={p}
            onClick={() => goToPage(p)}
            className={`min-h-[44px] min-w-[44px] rounded-md border px-3 text-sm font-medium transition-colors ${
              p === page
                ? "bg-integra-navy text-white border-integra-navy"
                : "hover:bg-gray-100"
            }`}
          >
            {p}
          </button>
        )
      )}

      <button
        onClick={() => goToPage(page + 1)}
        disabled={page >= totalPages}
        className="flex items-center gap-1 min-h-[44px] min-w-[44px] justify-center rounded-md border px-2 text-sm font-medium disabled:opacity-40 hover:bg-gray-100 transition-colors"
        aria-label="Página siguiente"
      >
        <span className="hidden sm:inline">Siguiente</span>
        <ChevronRight size={16} />
      </button>
    </div>
  );
}
