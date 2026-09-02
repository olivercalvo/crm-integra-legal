"use client";

import { useRouter } from "next/navigation";

/**
 * Selector de tercero. Viaja por la URL, igual que el del Libro Mayor, para que
 * el estado de cuenta de un cliente sea un enlace que se pueda compartir.
 */
export function TerceroSelector({
  tipo,
  opciones,
  seleccionado,
}: {
  tipo: "cliente" | "proveedor";
  /** value = id (clientes) o nombre (proveedores, que no son entidad). */
  opciones: { value: string; label: string }[];
  seleccionado: string;
}) {
  const router = useRouter();

  return (
    <div className="rounded-xl border bg-white p-4">
      <label htmlFor="tercero" className="mb-1 block text-xs font-medium text-gray-600">
        {tipo === "cliente" ? "Cliente" : "Proveedor"}
      </label>
      <select
        id="tercero"
        value={seleccionado}
        onChange={(e) => {
          const v = e.target.value;
          const p = new URLSearchParams({ tipo });
          if (v) p.set("id", v);
          router.push(`/finanzas/reportes/estado-cuenta?${p.toString()}`);
        }}
        className="block w-full max-w-lg rounded-md border border-gray-300 bg-white px-3 min-h-[44px] text-sm hover:border-integra-navy focus:border-integra-navy focus:outline-none"
      >
        <option value="">
          Seleccione un {tipo === "cliente" ? "cliente" : "proveedor"}…
        </option>
        {opciones.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {opciones.length === 0 && (
        <p className="mt-2 text-xs text-gray-500">
          No hay {tipo === "cliente" ? "clientes" : "proveedores"} con movimientos registrados
          todavía.
        </p>
      )}
    </div>
  );
}
