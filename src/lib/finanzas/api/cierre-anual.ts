/**
 * CIERRE ANUAL DEL EJERCICIO (E11, migración `080`): vista previa y posteo.
 *
 * 🔑 SOP-014: los dos RPC (`finanzas_saldos_de_resultado`, `close_fiscal_year`)
 *    tienen EXECUTE sólo para `service_role`, así que van con el cliente de
 *    SERVICIO (`ledgerDb`) y el `tenantId` sale del perfil autenticado, nunca
 *    del body. Las lecturas del estado van con la sesión (RLS).
 *
 * La vista previa y el posteo arman las líneas con la MISMA función
 * (`construirAsientoDeCierre`) sobre los MISMOS saldos (los de la base), y el
 * RPC las vuelve a verificar: si algo se registró entre la vista previa y la
 * confirmación, el RPC lo rechaza en vez de cerrar con números viejos.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { MutationError } from "@/lib/finanzas/api/errors";
import {
  CUENTA_RESULTADOS_ACUMULADOS,
  construirAsientoDeCierre,
  fechaDeCierre,
  SOURCE_TYPE_CIERRE,
  type ResultadoCierre,
  type SaldoDeResultado,
} from "@/lib/finanzas/contabilidad/cierre-anual";

type DB = SupabaseClient;

export interface CierreVigente {
  entry_id: string;
  entry_number: number;
  reference: string | null;
}

export interface PreparacionDeCierre {
  anio: number;
  vigente: CierreVigente | null;
  armado: ResultadoCierre;
}

/** El cierre vigente (no reversado) de un año, o null. */
export async function cierreVigente(db: DB, tenantId: string, anio: number): Promise<CierreVigente | null> {
  const { data, error } = await db
    .from("journal_entries")
    .select("id, entry_number, reference")
    .eq("tenant_id", tenantId)
    .eq("source_type", SOURCE_TYPE_CIERRE)
    .eq("transaction_date", fechaDeCierre(anio));
  if (error) throw new MutationError("No se pudo leer el estado del cierre.", 500, error);
  const cierres = (data ?? []) as { id: string; entry_number: number; reference: string | null }[];
  if (cierres.length === 0) return null;
  const { data: rev, error: errRev } = await db
    .from("journal_entries")
    .select("reverses_entry_id")
    .eq("tenant_id", tenantId)
    .in("reverses_entry_id", cierres.map((c) => c.id));
  if (errRev) throw new MutationError("No se pudo leer el estado del cierre.", 500, errRev);
  const reversados = new Set(((rev ?? []) as { reverses_entry_id: string }[]).map((r) => r.reverses_entry_id));
  const vivo = cierres.find((c) => !reversados.has(c.id));
  return vivo ? { entry_id: vivo.id, entry_number: Number(vivo.entry_number), reference: vivo.reference } : null;
}

export async function prepararCierre(
  db: DB,
  ledgerDb: DB,
  tenantId: string,
  anio: number
): Promise<PreparacionDeCierre> {
  if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) {
    throw new MutationError("El año del cierre no es válido.", 400);
  }
  const [vigente, saldosRes, cuentaRes] = await Promise.all([
    cierreVigente(db, tenantId, anio),
    ledgerDb.rpc("finanzas_saldos_de_resultado", { p_tenant_id: tenantId, p_anio: anio }),
    db
      .from("chart_of_accounts")
      .select("code, name, active")
      .eq("tenant_id", tenantId)
      .eq("code", CUENTA_RESULTADOS_ACUMULADOS)
      .maybeSingle(),
  ]);
  if (saldosRes.error) {
    console.error("[finanzas/cierre] finanzas_saldos_de_resultado failed", saldosRes.error);
    throw new MutationError("No se pudieron calcular los saldos del año.", 500, saldosRes.error);
  }
  const cuenta = cuentaRes.data as { code: string; name: string; active: boolean } | null;
  if (!cuenta || !cuenta.active) {
    return {
      anio,
      vigente,
      armado: {
        ok: false,
        mensaje: `Falta la cuenta ${CUENTA_RESULTADOS_ACUMULADOS} (resultados acumulados) activa en el Plan de Cuentas.`,
      },
    };
  }
  const saldos = ((saldosRes.data ?? []) as Record<string, unknown>[]).map(
    (r): SaldoDeResultado => ({
      account_code: String(r.account_code),
      account_name: String(r.account_name),
      account_type: r.account_type as SaldoDeResultado["account_type"],
      saldo: Number(r.saldo ?? 0),
    })
  );
  return { anio, vigente, armado: construirAsientoDeCierre(anio, saldos, { code: cuenta.code, name: cuenta.name }) };
}

export async function cerrarEjercicio(
  db: DB,
  ledgerDb: DB,
  tenantId: string,
  userId: string,
  anio: number
): Promise<{ entry_id: string; entry_number: number; reference: string | null }> {
  const prep = await prepararCierre(db, ledgerDb, tenantId, anio);
  if (prep.vigente) {
    throw new MutationError(
      `El ejercicio ${anio} ya está cerrado (asiento ${prep.vigente.entry_number}). Para volver a cerrarlo, reversa ese asiento primero.`,
      409
    );
  }
  if (!prep.armado.ok) throw new MutationError(prep.armado.mensaje, 422);

  const { data, error } = await ledgerDb.rpc("close_fiscal_year", {
    p_tenant_id: tenantId,
    p_anio: anio,
    p_lines: prep.armado.lineas.map((l) => ({
      account_code: l.account_code,
      debit: l.debit,
      credit: l.credit,
      description: l.description,
    })),
    p_created_by: userId,
  });
  if (error) {
    // Los mensajes del RPC vienen redactados para una persona (período cerrado,
    // año anterior sin cerrar, saldos que cambiaron).
    throw new MutationError(error.message || "No se pudo cerrar el ejercicio.", 422, error);
  }
  const r = data as { entry_id: string; entry_number: number; reference: string | null };
  return { entry_id: r.entry_id, entry_number: Number(r.entry_number), reference: r.reference ?? null };
}
