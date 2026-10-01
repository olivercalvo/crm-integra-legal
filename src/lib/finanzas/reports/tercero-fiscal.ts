/**
 * DATOS FISCALES DEL TERCERO de un movimiento del ledger.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * PARA QUÉ EXISTE
 * ═════════════════════════════════════════════════════════════════════════════
 * Josuarth, 25/08/2026: *"si yo entro a la cuenta de gastos de combustible, yo
 * debo poder extraer eso en Excel y ese Excel debe venir con DV, nombre,
 * cantidad de gastos"*. Y antes: *"los anexos van detallados con el RUC de cada
 * proveedor de cada cosita que compraste"*.
 *
 * Separar el RUC del DV en la ficha solo sirve si salen separados en el archivo
 * con el que él arma los anexos. Este módulo es el puente.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * POR QUÉ NO ALCANZA CON EL NOMBRE QUE YA MUESTRA EL MAYOR
 * ═════════════════════════════════════════════════════════════════════════════
 * La columna "Nombre" del Libro Mayor sale de `nombreDelTercero()`, que lee la
 * DESCRIPCIÓN de la línea que toca la cuenta control. Es texto: sirve para leer
 * el reporte, no para identificar a nadie. Un RUC no se puede deducir de un
 * nombre.
 *
 * Así que el tercero se resuelve por el DOCUMENTO ORIGEN del asiento
 * (`source_type` + `source_id`), que es la misma trazabilidad que ya usan los
 * enlaces del mayor y del diario:
 *
 *   factura                → invoices.client_id                → clients
 *   pago (cobro)           → payments.client_id                → clients
 *   nota_credito           → credit_notes.client_id            → clients
 *   gasto (compra)         → business_expenses.supplier_id     → suppliers
 *   gasto_tramite          → expenses.supplier_id              → suppliers   (E2)
 *   pago_proveedor         → supplier_payments → compra o gasto → suppliers  (E2)
 *   nota_credito_proveedor → supplier_credit_notes.supplier_id → suppliers   (E2)
 *   reversion              → el tipo del asiento que revierte, mismo source_id (E2)
 *   manual / apertura      → el tercero de la LÍNEA (054)
 *
 * E2 (30/09/2026): el cobro y la NC van DIRECTO a su `client_id`. Antes el
 * cobro pasaba por `payment_applications`, que la reversión BORRA (046): un
 * cobro reversado se quedaba sin nombre. La NC pasaba por su factura, que es el
 * mismo cliente pero un salto de más. La pantalla del Mayor usa esta misma
 * resolución desde E2 (segundo escalón de `nombreDelTercero`).
 *
 * ⚠️ **EL DV DE UN CLIENTE SE LLAMA `digito_verificador`, NO `dv`.**
 *
 * Los dos nombres conviven en el esquema y significan lo mismo:
 *
 *   · `clients.digito_verificador`  — migración `019`, en producción desde el
 *     30/05/2026. Es la MISMA columna que el mapper le manda a la DGI como
 *     `digitoVerificador` (`map-receptor.ts`).
 *   · `suppliers.dv`                — migración `033`, 02/09/2026.
 *
 * La primera versión de este archivo mandaba el DV de clientes VACÍO, porque se
 * escribió afirmando que la columna no existía: se la buscó por el nombre `dv` y
 * `digito_verificador` no lo contiene. Corregido el 02/09/2026. Queda escrito
 * acá porque el próximo que busque "dv" en `clients` va a tropezar igual.
 *
 * Lo que NO hay que hacer: agregar una columna `dv` a `clients`. Sería un
 * segundo campo para el mismo dato, y el mapper seguiría leyendo el primero.
 *
 * 🔴 El RUC y el DV viajan en dos campos y se escriben en dos columnas. Nunca
 * se concatenan — hay un test que lo verifica leyendo el código.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

type DB = SupabaseClient;

/** Los datos fiscales de un tercero, tal como van a las columnas del Excel. */
export interface TerceroFiscal {
  nombre: string;
  /** RUC sin el dígito verificador. Cadena vacía si no se conoce. */
  ruc: string;
  /** Dígito verificador, en su propia columna. Vacío si no se conoce. */
  dv: string;
}

/** Un tercero desconocido: las tres columnas vacías, nunca "N/A" ni "—". */
export const SIN_TERCERO: TerceroFiscal = { nombre: "", ruc: "", dv: "" };

/**
 * EL TERCERO DE UNA LÍNEA (migración `054`) — la otra vía, y la que manda.
 *
 * Desde el Bloque 7 una línea puede nombrar al cliente o al proveedor
 * directamente, sin pasar por el documento de origen. Eso cubre justo lo que
 * esta resolución por `source_type` no podía: un asiento manual, donde cada
 * línea puede ser de un tercero distinto.
 *
 * La clave del mapa es `"cliente:<uuid>"` / `"proveedor:<uuid>"`, la misma
 * forma que usa el `<select>` del formulario (`valorDeTercero`), para que no
 * haya dos vocabularios para lo mismo.
 */
export function claveDeTercero(
  clientId: string | null | undefined,
  supplierId: string | null | undefined
): string | null {
  if (clientId) return `cliente:${clientId}`;
  if (supplierId) return `proveedor:${supplierId}`;
  return null;
}

export async function resolverTercerosDeLineas(
  db: DB,
  tenantId: string,
  claves: readonly (string | null)[]
): Promise<Map<string, TerceroFiscal>> {
  const resultado = new Map<string, TerceroFiscal>();
  const clientes = new Set<string>();
  const proveedores = new Set<string>();
  for (const c of claves) {
    if (!c) continue;
    if (c.startsWith("cliente:")) clientes.add(c.slice("cliente:".length));
    else if (c.startsWith("proveedor:")) proveedores.add(c.slice("proveedor:".length));
  }
  if (clientes.size === 0 && proveedores.size === 0) return resultado;

  // 🔒 Las dos lecturas filtran por tenant: los ids vienen del ledger y sin ese
  // filtro serían una vía para leer fichas de otro bufete.
  const [cli, prov] = await Promise.all([
    clientes.size > 0
      ? db
          .from("clients")
          .select("id, name, ruc, digito_verificador")
          .eq("tenant_id", tenantId)
          .in("id", Array.from(clientes))
      : Promise.resolve({ data: [], error: null }),
    proveedores.size > 0
      ? db
          .from("suppliers")
          .select("id, legal_name, ruc, dv")
          .eq("tenant_id", tenantId)
          .in("id", Array.from(proveedores))
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (cli.error) console.error("[finanzas/tercero] resolverTercerosDeLineas(clients) failed", cli.error);
  if (prov.error) console.error("[finanzas/tercero] resolverTercerosDeLineas(suppliers) failed", prov.error);

  for (const c of (cli.data ?? []) as Record<string, unknown>[]) {
    resultado.set(`cliente:${String(c.id)}`, {
      nombre: texto(c.name),
      ruc: texto(c.ruc),
      // ⚠️ En clientes el DV se llama `digito_verificador`. Ver arriba.
      dv: texto(c.digito_verificador),
    });
  }
  for (const s of (prov.data ?? []) as Record<string, unknown>[]) {
    resultado.set(`proveedor:${String(s.id)}`, {
      nombre: texto(s.legal_name),
      ruc: texto(s.ruc),
      dv: texto(s.dv),
    });
  }
  return resultado;
}

/** Lo mínimo que hace falta de un asiento para resolver su tercero. */
export interface OrigenDeAsiento {
  entry_id: string;
  source_type: string | null;
  source_id: string | null;
  /**
   * E2: si el asiento es una reversión, el `source_type` del asiento que
   * revierte. La reversión conserva el `source_id` del documento.
   */
  reverses_source_type?: string | null;
}

function texto(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** El tipo con el que se busca al tercero: el del original, si es una reversión. */
function tipoEfectivo(a: OrigenDeAsiento): string | null {
  return a.source_type === "reversion" ? a.reverses_source_type ?? null : a.source_type;
}

type Uno<T> = T | T[] | null | undefined;
const uno = <T,>(x: Uno<T>): T | null => (Array.isArray(x) ? x[0] ?? null : x ?? null);

/**
 * Resuelve el tercero fiscal de cada asiento, en pocas queries.
 *
 * Devuelve un mapa `entry_id → TerceroFiscal`. Un asiento sin tercero
 * simplemente no aparece en el mapa; el exportador usa `SIN_TERCERO`.
 *
 * 🔒 SEGURIDAD: todas las lecturas filtran por `tenantId`. Es un módulo que
 * cruza varias tablas a partir de ids que vienen del ledger, y sin ese filtro
 * sería una vía para leer documentos de otro bufete.
 */
export async function resolverTercerosFiscales(
  db: DB,
  tenantId: string,
  asientos: OrigenDeAsiento[]
): Promise<Map<string, TerceroFiscal>> {
  const resultado = new Map<string, TerceroFiscal>();

  const porTipo = (tipo: string) =>
    asientos.filter((a) => tipoEfectivo(a) === tipo && a.source_id);
  const ids = (xs: OrigenDeAsiento[]) => Array.from(new Set(xs.map((a) => a.source_id as string)));

  /** entry_id → cliente o proveedor. */
  const clienteDeAsiento = new Map<string, string>();
  const proveedorDeAsiento = new Map<string, string>();
  /** entry_id → nombre de respaldo (compras sin ficha de proveedor, 033). */
  const nombreDeRespaldo = new Map<string, string>();

  // Una consulta por tipo de documento: id del documento → id del tercero.
  async function porDocumento(
    tipo: string,
    tabla: string,
    columna: "client_id" | "supplier_id",
    destino: Map<string, string>,
    extra?: string
  ) {
    const xs = porTipo(tipo);
    if (xs.length === 0) return;
    const { data } = await db
      .from(tabla)
      .select(`id, ${columna}${extra ? `, ${extra}` : ""}`)
      .eq("tenant_id", tenantId)
      .in("id", ids(xs));
    const filas = (data ?? []) as unknown as Record<string, string | null>[];
    const porId = new Map(filas.map((f) => [String(f.id), f]));
    for (const a of xs) {
      const f = porId.get(a.source_id as string);
      if (!f) continue;
      const tercero = f[columna];
      if (tercero) destino.set(a.entry_id, tercero);
      else if (extra && f[extra]) nombreDeRespaldo.set(a.entry_id, texto(f[extra]));
    }
  }

  await porDocumento("factura", "invoices", "client_id", clienteDeAsiento);
  await porDocumento("pago", "payments", "client_id", clienteDeAsiento);
  await porDocumento("nota_credito", "credit_notes", "client_id", clienteDeAsiento);
  await porDocumento("gasto", "business_expenses", "supplier_id", proveedorDeAsiento, "supplier_name");
  await porDocumento("gasto_tramite", "expenses", "supplier_id", proveedorDeAsiento);
  await porDocumento("nota_credito_proveedor", "supplier_credit_notes", "supplier_id", proveedorDeAsiento);

  // El pago a proveedor no tiene proveedor propio: es el de lo que paga (049).
  const pagosProv = porTipo("pago_proveedor");
  if (pagosProv.length > 0) {
    const { data } = await db
      .from("supplier_payments")
      .select(
        "id, compra:business_expenses!supplier_payments_business_expense_id_fkey(supplier_id, supplier_name), " +
          "tramite:expenses!supplier_payments_expense_id_fkey(supplier_id)"
      )
      .eq("tenant_id", tenantId)
      .in("id", ids(pagosProv));
    type Fila = {
      id: string;
      compra: Uno<{ supplier_id: string | null; supplier_name: string | null }>;
      tramite: Uno<{ supplier_id: string | null }>;
    };
    const porId = new Map(((data ?? []) as unknown as Fila[]).map((f) => [f.id, f]));
    for (const a of pagosProv) {
      const f = porId.get(a.source_id as string);
      if (!f) continue;
      const prov = uno(f.compra)?.supplier_id ?? uno(f.tramite)?.supplier_id ?? null;
      if (prov) proveedorDeAsiento.set(a.entry_id, prov);
      else if (uno(f.compra)?.supplier_name) nombreDeRespaldo.set(a.entry_id, texto(uno(f.compra)?.supplier_name));
    }
  }

  // ── Las fichas, una consulta por tabla ─────────────────────────────────
  const idsCliente = Array.from(new Set(clienteDeAsiento.values()));
  if (idsCliente.length > 0) {
    const { data } = await db
      .from("clients")
      .select("id, name, ruc, digito_verificador")
      .eq("tenant_id", tenantId)
      .in("id", idsCliente);
    const fichas = new Map(
      ((data ?? []) as { id: string; name: string; ruc: string | null; digito_verificador: string | null }[]).map(
        (c) => [
          c.id,
          {
            nombre: texto(c.name),
            ruc: texto(c.ruc),
            // Vacío solo cuando el cliente REALMENTE no tiene DV: un receptor tipo
            // 02 (consumidor final) no lo requiere y la columna queda en NULL.
            dv: texto(c.digito_verificador),
          },
        ]
      )
    );
    clienteDeAsiento.forEach((clienteId, entryId) => {
      const c = fichas.get(clienteId);
      if (c) resultado.set(entryId, c);
    });
  }

  const idsProveedor = Array.from(new Set(proveedorDeAsiento.values()));
  if (idsProveedor.length > 0) {
    const { data } = await db
      .from("suppliers")
      .select("id, legal_name, ruc, dv")
      .eq("tenant_id", tenantId)
      .in("id", idsProveedor);
    const fichas = new Map(
      ((data ?? []) as { id: string; legal_name: string; ruc: string | null; dv: string | null }[]).map((p) => [
        p.id,
        // La razón SOCIAL, no la comercial: es la que figura en el RUC y la que
        // la DGI espera al lado de ese número.
        { nombre: texto(p.legal_name), ruc: texto(p.ruc), dv: texto(p.dv) },
      ])
    );
    proveedorDeAsiento.forEach((provId, entryId) => {
      const p = fichas.get(provId);
      if (p) resultado.set(entryId, p);
    });
  }

  nombreDeRespaldo.forEach((nombre, entryId) => {
    if (!resultado.has(entryId) && nombre) resultado.set(entryId, { nombre, ruc: "", dv: "" });
  });

  return resultado;
}

/**
 * Datos fiscales de los DOCUMENTOS de la antigüedad.
 *
 * A diferencia del mayor, acá no se parte del ledger sino de los documentos
 * mismos: facturas en cobrar, gastos del bufete en pagar. Devuelve un mapa
 * `id del documento → TerceroFiscal`.
 *
 * 🔒 Igual que arriba: todo filtrado por `tenantId`.
 */
export async function resolverTercerosDeDocumentos(
  db: DB,
  tenantId: string,
  tipo: "cobrar" | "pagar",
  ids: string[]
): Promise<Map<string, TerceroFiscal>> {
  const resultado = new Map<string, TerceroFiscal>();
  if (ids.length === 0) return resultado;

  if (tipo === "cobrar") {
    const { data } = await db
      .from("invoices")
      .select("id, clients!inner(name, ruc, digito_verificador)")
      .eq("tenant_id", tenantId)
      .in("id", ids);

    type Fila = {
      id: string;
      clients: { name: string; ruc: string | null; digito_verificador: string | null };
    };
    for (const f of (data ?? []) as unknown as Fila[]) {
      resultado.set(f.id, {
        nombre: texto(f.clients?.name),
        ruc: texto(f.clients?.ruc),
        dv: texto(f.clients?.digito_verificador),
      });
    }
    return resultado;
  }

  const { data } = await db
    .from("business_expenses")
    .select("id, supplier_id, supplier_name")
    .eq("tenant_id", tenantId)
    .in("id", ids);

  const filas = (data ?? []) as {
    id: string;
    supplier_id: string | null;
    supplier_name: string | null;
  }[];

  const idsProveedor = Array.from(
    new Set(filas.map((g) => g.supplier_id).filter((v): v is string => !!v))
  );

  const proveedores = new Map<string, TerceroFiscal>();
  if (idsProveedor.length > 0) {
    const { data: provs } = await db
      .from("suppliers")
      .select("id, legal_name, ruc, dv")
      .eq("tenant_id", tenantId)
      .in("id", idsProveedor);

    for (const p of (provs ?? []) as {
      id: string;
      legal_name: string;
      ruc: string | null;
      dv: string | null;
    }[]) {
      proveedores.set(p.id, { nombre: p.legal_name, ruc: texto(p.ruc), dv: texto(p.dv) });
    }
  }

  for (const g of filas) {
    const p = g.supplier_id ? proveedores.get(g.supplier_id) : undefined;
    resultado.set(g.id, p ?? { nombre: texto(g.supplier_name), ruc: "", dv: "" });
  }
  return resultado;
}

/**
 * E2: los orígenes de los movimientos del Mayor, listos para
 * `resolverTercerosFiscales`. La pantalla y el Excel los arman igual.
 */
export function origenesDeMovimientos(
  movimientos: {
    entry_id: string;
    source_type: string | null;
    source_id: string | null;
    reverses_source_type?: string | null;
  }[]
): OrigenDeAsiento[] {
  return movimientos.map((m) => ({
    entry_id: m.entry_id,
    source_type: m.source_type,
    source_id: m.source_id,
    reverses_source_type: m.reverses_source_type ?? null,
  }));
}

/** E2: `entry_id → nombre`, para el segundo escalón de `nombreDelTercero`. */
export function nombresPorAsiento(terceros: Map<string, TerceroFiscal>): Map<string, string> {
  const nombres = new Map<string, string>();
  terceros.forEach((t, entryId) => {
    if (t.nombre) nombres.set(entryId, t.nombre);
  });
  return nombres;
}
