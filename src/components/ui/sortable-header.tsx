"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";

interface SortableHeaderProps {
  column: string;
  label: string;
  currentSort?: string;
  currentDir?: string;
}

export function SortableHeader({ column, label, currentSort, currentDir }: SortableHeaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const isActive = currentSort === column;
  const nextDir = isActive && currentDir === "asc" ? "desc" : "asc";

  const handleClick = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("sort", column);
    params.set("dir", nextDir);
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <button
      onClick={handleClick}
      className="flex items-center gap-1 hover:text-integra-navy transition-colors group"
    >
      {label}
      {isActive ? (
        currentDir === "asc" ? (
          <ArrowUp size={14} className="text-integra-navy" />
        ) : (
          <ArrowDown size={14} className="text-integra-navy" />
        )
      ) : (
        <ArrowUpDown size={14} className="text-gray-300 group-hover:text-gray-500" />
      )}
    </button>
  );
}
