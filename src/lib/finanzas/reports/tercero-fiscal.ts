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
 *   factura       → invoices.client_id      → clients
 *   pago          → payments → aplicación   → invoices.client_id → clients
 *   nota_credito  → credit_notes → invoice  → clients
 *   gasto         → business_expenses.supplier_id → suppliers
 *   manual / apertura / reversion           → el tercero de la LÍNEA (054)
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
}

function texto(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Resuelve el tercero fiscal de cada asiento, en pocas queries.
 *
 * Devuelve un mapa `entry_id → TerceroFiscal`. Un asiento sin tercero
 * simplemente no aparece en el mapa; el exportador usa `SIN_TERCERO`.
 *
 * 🔒 SEGURIDAD: todas las lecturas filtran por `tenantId`. Es un módulo que
 * cruza cuatro tablas a partir de ids que vienen del ledger, y sin ese filtro
 * sería una vía para leer documentos de otro bufete.
 */
export async function resolverTercerosFiscales(
  db: DB,
  tenantId: string,
  asientos: OrigenDeAsiento[]
): Promise<Map<string, TerceroFiscal>> {
  const resultado = new Map<string, TerceroFiscal>();

  const porTipo = (tipo: string) =>
    asientos.filter((a) => a.source_type === tipo && a.source_id);

  const facturas = porTipo("factura");
  const pagos = porTipo("pago");
  const gastos = porTipo("gasto");
  const notas = porTipo("nota_credito");

  // ── PROVEEDORES (gastos) ────────────────────────────────────────────────
  // El caso que nombró Josuarth. Es el único con RUC y DV separados hoy.
  if (gastos.length > 0) {
    const { data } = await db
      .from("business_expenses")
      .select("id, supplier_id, supplier_name")
      .eq("tenant_id", tenantId)
      .in("id", gastos.map((a) => a.source_id as string));

    const filas = (data ?? []) as {
      id: string;
      supplier_id: string | null;
      supplier_name: string | null;
    }[];

    const idsProveedor = Array.from(
      new Set(filas.map((g) => g.supplier_id).filter((v): v is string => !!v))
    );

    const proveedores = new Map<string, { nombre: string; ruc: string; dv: string }>();
    if (idsProveedor.length > 0) {
      const { data: provs } = await db
        .from("suppliers")
        .select("id, legal_name, trade_name, ruc, dv")
        .eq("tenant_id", tenantId)
        .in("id", idsProveedor);

      for (const p of (provs ?? []) as {
        id: string;
        legal_name: string;
        trade_name: string | null;
        ruc: string | null;
        dv: string | null;
      }[]) {
        proveedores.set(p.id, {
          // La razón SOCIAL, no la comercial: es la que figura en el RUC y la
          // que la DGI espera al lado de ese número.
          nombre: p.legal_name,
          ruc: texto(p.ruc),
          dv: texto(p.dv),
        });
      }
    }

    const porGasto = new Map(filas.map((g) => [g.id, g]));
    for (const a of gastos) {
      const g = porGasto.get(a.source_id as string);
      if (!g) continue;
      const p = g.supplier_id ? proveedores.get(g.supplier_id) : undefined;
      resultado.set(
        a.entry_id,
        p ?? { nombre: texto(g.supplier_name), ruc: "", dv: "" }
      );
    }
  }

  // ── CLIENTES ────────────────────────────────────────────────────────────
  // De factura, de pago (por la factura que cancela) y de nota de crédito.
  const idsFactura = new Set<string>(facturas.map((a) => a.source_id as string));

  /** entry_id → invoice_id, para los asientos que llegan al cliente indirecto. */
  const facturaDeAsiento = new Map<string, string>();
  for (const a of facturas) facturaDeAsiento.set(a.entry_id, a.source_id as string);

  if (pagos.length > 0) {
    const { data } = await db
      .from("payment_applications")
      .select("payment_id, invoice_id")
      .eq("tenant_id", tenantId)
      .in("payment_id", pagos.map((a) => a.source_id as string));

    // Un pago puede aplicarse a varias facturas. Para el nombre del tercero
    // alcanza la primera: todas son del mismo cliente por construcción.
    const primeraPorPago = new Map<string, string>();
    for (const ap of (data ?? []) as { payment_id: string; invoice_id: string }[]) {
      if (!primeraPorPago.has(ap.payment_id)) {
        primeraPorPago.set(ap.payment_id, ap.invoice_id);
      }
    }
    for (const a of pagos) {
      const inv = primeraPorPago.get(a.source_id as string);
      if (inv) {
        facturaDeAsiento.set(a.entry_id, inv);
        idsFactura.add(inv);
      }
    }
  }

  if (notas.length > 0) {
    const { data } = await db
      .from("credit_notes")
      .select("id, invoice_id")
      .eq("tenant_id", tenantId)
      .in("id", notas.map((a) => a.source_id as string));

    const porNota = new Map(
      ((data ?? []) as { id: string; invoice_id: string | null }[]).map((n) => [
        n.id,
        n.invoice_id,
      ])
    );
    for (const a of notas) {
      const inv = porNota.get(a.source_id as string);
      if (inv) {
        facturaDeAsiento.set(a.entry_id, inv);
        idsFactura.add(inv);
      }
    }
  }

  if (idsFactura.size > 0) {
    const { data } = await db
      .from("invoices")
      .select("id, client_id, clients!inner(id, name, ruc, digito_verificador)")
      .eq("tenant_id", tenantId)
      .in("id", Array.from(idsFactura));

    type Fila = {
      id: string;
      clients: { name: string; ruc: string | null; digito_verificador: string | null };
    };
    const clientePorFactura = new Map<string, TerceroFiscal>();
    for (const f of (data ?? []) as unknown as Fila[]) {
      clientePorFactura.set(f.id, {
        nombre: texto(f.clients?.name),
        ruc: texto(f.clients?.ruc),
        // Vacío solo cuando el cliente REALMENTE no tiene DV: un receptor tipo
        // 02 (consumidor final) no lo requiere y la columna queda en NULL. Eso
        // es un dato ausente legítimo, no uno perdido por el camino.
        dv: texto(f.clients?.digito_verificador),
      });
    }

    facturaDeAsiento.forEach((invoiceId, entryId) => {
      const c = clientePorFactura.get(invoiceId);
      if (c) resultado.set(entryId, c);
    });
  }

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
