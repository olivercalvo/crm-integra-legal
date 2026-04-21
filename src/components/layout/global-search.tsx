"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X, User, FolderOpen } from "lucide-react";

interface SearchResult {
  id: string;
  type: "client" | "case";
  title: string;
  subtitle: string;
  href: string;
}

interface ApiClient {
  id: string;
  name: string;
  ruc: string | null;
  client_number: string;
}

interface ApiCase {
  id: string;
  case_code: string;
  description: string | null;
  clients: { name: string } | { name: string }[] | null;
}

export function GlobalSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async (term: string) => {
    const trimmed = term.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: { clients: ApiClient[]; cases: ApiCase[] } = await res.json();

      const items: SearchResult[] = [];
      for (const c of data.clients ?? []) {
        items.push({
          id: c.id,
          type: "client",
          title: c.name,
          subtitle: [c.client_number, c.ruc].filter(Boolean).join(" · "),
          href: `/abogada/clientes/${c.id}`,
        });
      }
      const seenCaseIds = new Set<string>();
      for (const cs of data.cases ?? []) {
        if (seenCaseIds.has(cs.id)) continue;
        seenCaseIds.add(cs.id);
        const clientName = Array.isArray(cs.clients)
          ? cs.clients[0]?.name
          : cs.clients?.name;
        items.push({
          id: cs.id,
          type: "case",
          title: cs.case_code,
          subtitle: [cs.description, clientName].filter(Boolean).join(" — "),
          href: `/abogada/casos/${cs.id}`,
        });
      }

      setResults(items);
      setSelectedIndex(-1);
      setOpen(true);
    } catch {
      setResults([]);
      setOpen(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => search(val), 300);
  };

  const handleClear = () => {
    setQuery("");
    setResults([]);
    setOpen(false);
    inputRef.current?.focus();
  };

  const handleSelect = (result: SearchResult) => {
    setOpen(false);
    setQuery("");
    setResults([]);
    router.push(result.href);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev < results.length - 1 ? prev + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : results.length - 1));
    } else if (e.key === "Enter" && selectedIndex >= 0) {
      e.preventDefault();
      handleSelect(results[selectedIndex]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div ref={containerRef} className="relative w-full">
      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => results.length > 0 && setOpen(true)}
        placeholder="Buscar clientes, casos..."
        className="w-full rounded-full border border-gray-200 bg-gray-50 py-2 pl-10 pr-9 text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none focus:border-integra-gold focus:ring-1 focus:ring-integra-gold/30"
        aria-label="Búsqueda global"
        aria-expanded={open}
        role="combobox"
        aria-autocomplete="list"
      />
      {query && (
        <button
          onClick={handleClear}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          aria-label="Limpiar búsqueda"
        >
          <X size={16} />
        </button>
      )}

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 rounded-lg border border-gray-200 bg-white shadow-lg z-50 max-h-80 overflow-y-auto">
          {results.map((result, idx) => (
            <button
              key={`${result.type}-${result.id}`}
              onClick={() => handleSelect(result)}
              className={`flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-gray-50 ${
                idx === selectedIndex ? "bg-gray-50" : ""
              } ${idx > 0 ? "border-t border-gray-100" : ""}`}
              role="option"
              aria-selected={idx === selectedIndex}
            >
              {result.type === "client" ? (
                <User size={16} className="shrink-0 text-integra-navy" />
              ) : (
                <FolderOpen size={16} className="shrink-0 text-integra-gold" />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-medium text-gray-900 truncate">{result.title}</p>
                {result.subtitle && (
                  <p className="text-xs text-gray-500 truncate">{result.subtitle}</p>
                )}
              </div>
              <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                {result.type === "client" ? "Cliente" : "Caso"}
              </span>
            </button>
          ))}
        </div>
      )}

      {loading && query.trim().length >= 2 && (
        <div className="absolute top-full left-0 right-0 mt-1 rounded-lg border border-gray-200 bg-white shadow-lg z-50 px-4 py-3 text-sm text-gray-500">
          Buscando...
        </div>
      )}

      {!loading && open && results.length === 0 && query.trim().length >= 2 && (
        <div className="absolute top-full left-0 right-0 mt-1 rounded-lg border border-gray-200 bg-white shadow-lg z-50 px-4 py-3 text-sm text-gray-500">
          No se encontraron resultados para: <span className="font-medium text-integra-navy">&ldquo;{query}&rdquo;</span>
        </div>
      )}
    </div>
  );
}
