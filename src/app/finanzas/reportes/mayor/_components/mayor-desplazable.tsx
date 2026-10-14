"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * El marco del Libro Mayor con el desplazamiento horizontal SIEMPRE a mano
 * (Parte 3, 14/10/2026).
 *
 * Antes la barra horizontal aparecía sólo al final de la tabla: con 125 filas
 * había que bajar hasta el fondo para correrla. Ahora la página se desplaza
 * como siempre y:
 *   · el encabezado de columnas queda fijo debajo de la cabecera de la app;
 *   · una barra horizontal «espejo» queda fija al pie de la ventana mientras la
 *     tabla está a la vista, sincronizada con la tabla y con el encabezado.
 *
 * No se mete la tabla en una caja de alto fijo: ahí la rueda del mouse mueve la
 * caja antes que la página, y la barra quedaba fuera de la vista al empezar.
 *
 * Encabezado y cuerpo son dos tablas `table-fixed` con el MISMO `<colgroup>`:
 * por eso sus columnas coinciden siempre.
 */
export function MayorDesplazable({
  anchos,
  encabezado,
  children,
}: {
  /** Ancho mínimo de cada columna, en px (el de su contenido). */
  anchos: number[];
  /** El `<thead>`. */
  encabezado: ReactNode;
  /** El `<tbody>` y el `<tfoot>`. */
  children: ReactNode;
}) {
  const cabeza = useRef<HTMLDivElement>(null);
  const cuerpo = useRef<HTMLDivElement>(null);
  const barra = useRef<HTMLDivElement>(null);
  const tabla = useRef<HTMLTableElement>(null);
  const [ancho, setAncho] = useState(0);
  const [desborda, setDesborda] = useState(false);
  const minimo = anchos.reduce((s, a) => s + a, 0);

  const medir = useCallback(() => {
    const c = cuerpo.current;
    const t = tabla.current;
    if (!c || !t) return;
    setAncho(t.scrollWidth);
    setDesborda(t.scrollWidth > c.clientWidth + 1);
  }, []);

  useEffect(() => {
    medir();
    const ro = new ResizeObserver(medir);
    if (cuerpo.current) ro.observe(cuerpo.current);
    if (tabla.current) ro.observe(tabla.current);
    return () => ro.disconnect();
  }, [medir]);

  // Una sola fuente de verdad del desplazamiento: quien se movió arrastra a los otros dos.
  const sincronizar = (desde: HTMLDivElement | null) => {
    if (!desde) return;
    const x = desde.scrollLeft;
    for (const el of [cabeza.current, cuerpo.current, barra.current]) {
      if (el && el !== desde && Math.abs(el.scrollLeft - x) > 0.5) el.scrollLeft = x;
    }
  };

  const columnas = (
    <colgroup>
      {anchos.map((a, i) => (
        <col key={i} style={{ width: a }} />
      ))}
    </colgroup>
  );
  const estiloTabla = { width: "100%", minWidth: minimo };

  return (
    <div>
      <div
        ref={cabeza}
        className="sticky top-[calc(4rem+var(--env-band-h,0px))] z-20 overflow-hidden border-b bg-gray-50"
        data-testid="mayor-encabezado"
      >
        <table className="table-fixed" style={estiloTabla}>
          {columnas}
          {encabezado}
        </table>
      </div>
      <div
        ref={cuerpo}
        onScroll={() => sincronizar(cuerpo.current)}
        className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        data-testid="mayor-cuerpo"
      >
        <table ref={tabla} className="table-fixed" style={estiloTabla}>
          {columnas}
          {children}
        </table>
      </div>
      {desborda && (
        <div
          ref={barra}
          onScroll={() => sincronizar(barra.current)}
          className="sticky bottom-0 z-20 overflow-x-auto border-t bg-white"
          data-testid="mayor-barra"
          aria-label="Desplazar la tabla a los lados"
        >
          <div style={{ width: ancho, height: 1 }} />
        </div>
      )}
    </div>
  );
}
