"use client";

import { useState } from "react";
import { ShieldCheck, ShieldAlert, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Resultado {
  filas: number;
  filas_alteradas: number[];
  anclas: number;
  anclas_que_no_coinciden: { ancla: number; referencia: string; fila: number }[];
  integra: boolean;
}

/** «Verificar integridad»: recalcula la cadena en la base y la compara con las anclas. */
export function VerificarIntegridad({ ruta }: { ruta: string }) {
  const [estado, setEstado] = useState<"idle" | "cargando" | "error">("idle");
  const [r, setR] = useState<Resultado | null>(null);
  const [error, setError] = useState("");

  async function verificar() {
    setEstado("cargando");
    setError("");
    try {
      const res = await fetch(ruta, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo verificar.");
      setR(data as Resultado);
      setEstado("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo verificar.");
      setEstado("error");
    }
  }

  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" className="min-h-[48px] gap-2" onClick={verificar} disabled={estado === "cargando"}>
        {estado === "cargando" ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
        Verificar integridad
      </Button>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {r && r.integra && (
        <p className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          <ShieldCheck size={16} />
          Íntegra: {r.filas.toLocaleString("es-PA")} registros encadenados y {r.anclas} ancla{r.anclas === 1 ? "" : "s"} que coinciden.
        </p>
      )}
      {r && !r.integra && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <p className="flex items-center gap-2 font-semibold">
            <ShieldAlert size={16} />
            La bitácora no coincide con su cadena. Avisa a administración.
          </p>
          {r.filas_alteradas.length > 0 && <p>Registros alterados: {r.filas_alteradas.slice(0, 20).join(", ")}.</p>}
          {r.anclas_que_no_coinciden.length > 0 && (
            <p>Anclas que no coinciden: {r.anclas_que_no_coinciden.map((a) => a.referencia).join(", ")}.</p>
          )}
        </div>
      )}
    </div>
  );
}
