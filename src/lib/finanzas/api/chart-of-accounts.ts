/**
 * Helpers server-side para mutaciones de chart_of_accounts (Plan de Cuentas).
 * Llamados desde los route handlers `/api/finanzas/configuracion/chart-of-accounts`.
 *
 * Mismo patrón que api/business-expenses.ts: admin client (bypass RLS) + filter
 * manual por tenant_id + MutationError con código HTTP sugerido + audit_log en
 * cada mutación (entity='chart_of_accounts').
 *
 * Reglas de negocio (ver CLAUDE.md / prompt AG):
 *   - code único por tenant (guard app-level + UNIQUE en BD como red final).
 *   - is_system=true (1201,1202,2301,4101,4102): NO se puede desactivar ni
 *     cambiar el código. El nombre/tipo/descripción sí se pueden editar.
 *   - Sin hard delete: "borrar" = active=false.
 *   - RECLASIFICAR (account_type / subcategoria) es solo admin+contador. La
 *     abogada conserva crear, renombrar, describir y cargar saldo.
 *   - Una cuenta CON MOVIMIENTOS no cambia de naturaleza ni se desactiva, la
 *     toque quien la toque. Protege los reportes históricos.
 *
 * CONTRATO DEL PATCH — reemplazo total, no parche parcial:
 *   updateChartAccount escribe TODOS los campos editables (incluidos
 *   subcategoria y saldo_inicial) con lo que traiga el input validado. Como el
 *   validador defaultea saldo_inicial a 0 y subcategoria a null cuando el campo
 *   no viene en el body, un PATCH que omita esos campos los RESETEA. Quien
 *   llame al endpoint debe mandar la fila completa — así lo hace la UI, tanto
 *   en el form de edición como en el toggle de activar/desactivar.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ChartAccountRow,
  CreateChartAccountInput,
  UpdateChartAccountInput,
} from "@/lib/finanzas/types/chart-of-account";
import { MutationError, pgErrorToMessage } from "@/lib/finanzas/api/errors";
import { findChartAccountByCode } from "@/lib/finanzas/queries/chart-of-accounts";

type DB = SupabaseClient;

const ENTITY = "chart_of_accounts";
const SELECT_COLS =
  "id, code, name, account_type, subcategoria, cuenta_control, saldo_inicial, saldo_inicial_fecha, account_name_qb, description, is_trust_pass_through, is_system, active";

/**
 * Roles que pueden cambiar la CLASIFICACIÓN CONTABLE de una cuenta
 * (`account_type` y `subcategoria`).
 *
 * Criterio de aceptación del documento de RM Consultores. La abogada conserva
 * crear y renombrar cuentas: lo que pierde es reclasificarlas, porque de esa
 * clasificación dependen el Balance General y el Estado de Resultado que firma
 * el contador.
 */
const ROLES_CLASIFICACION = ["admin", "contador"] as const;

/** Campos que constituyen la "clasificación contable" a efectos del permiso. */
const CAMPOS_CLASIFICACION = ["account_type", "subcategoria"] as const;

/**
 * Cuántos asientos tocan esta cuenta.
 *
 * Hoy siempre devuelve 0: el ledger existe (023) pero el motor de posteo llega
 * en la Fase 2, así que `journal_entry_lines` está vacía. La regla se
 * implementa igual desde ahora — cuando empiecen a entrar asientos ya está
 * puesta, en vez de acordarse después de haber reclasificado una cuenta con
 * movimientos.
 */
async function contarMovimientos(
  db: DB,
  tenantId: string,
  accountId: string
): Promise<number> {
  const { count, error } = await db
    .from("journal_entry_lines")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("account_id", accountId);

  if (error) {
    // Si no se puede saber, NO se asume que está libre: bloquear es lo
    // conservador cuando lo que está en juego son los reportes históricos.
    console.error("[finanzas/api] contarMovimientos failed", error);
    throw new MutationError(
      "No se pudo verificar si la cuenta tiene movimientos. Intentá de nuevo.",
      500,
      error
    );
  }
  return count ?? 0;
}

/** true si el error de Postgres es una violación de UNIQUE (código 23505). */
function isUniqueViolation(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as { code?: string }).code === "23505";
}

/**
 * Normaliza la fila devuelta por el INSERT/UPDATE. `saldo_inicial` es numeric
 * en BD; lo forzamos a number para que la UI (que consume esta respuesta
 * directamente y reemplaza la fila en su estado local) no reciba un string.
 */
function toRow(raw: unknown): ChartAccountRow {
  const r = raw as Record<string, unknown>;
  return {
    ...(r as unknown as ChartAccountRow),
    saldo_inicial: Number(r.saldo_inicial ?? 0),
  };
}

// ---------------------------------------------------------------------------
// CREATE
// ---------------------------------------------------------------------------

export async function createChartAccount(
  db: DB,
  tenantId: string,
  userId: string,
  input: CreateChartAccountInput
): Promise<ChartAccountRow> {
  // Unicidad de código por tenant (guard app-level → 400 accionable).
  const dup = await findChartAccountByCode(db, tenantId, input.code);
  if (dup) {
    throw new MutationError(
      `Ya existe una cuenta con el código "${input.code}". Usá un código distinto.`,
      400
    );
  }

  const { data, error } = await db
    .from("chart_of_accounts")
    .insert({
      tenant_id: tenantId,
      code: input.code,
      name: input.name,
      account_type: input.account_type,
      subcategoria: input.subcategoria,
      cuenta_control: input.cuenta_control,
      saldo_inicial: input.saldo_inicial,
      saldo_inicial_fecha: input.saldo_inicial_fecha,
      description: input.description,
      active: input.active,
      // La pantalla mantiene la tabla PLANA y no gestiona trust/QB/is_system:
      is_trust_pass_through: false,
      is_system: false,
    })
    .select(SELECT_COLS)
    .single();

  if (error || !data) {
    // Red final: si dos requests concurrentes pasaron el guard, la UNIQUE de BD
    // frena el segundo. Lo traducimos al mismo 409 accionable.
    if (isUniqueViolation(error)) {
      throw new MutationError(
        `Ya existe una cuenta con el código "${input.code}". Usá un código distinto.`,
        400
      );
    }
    console.error("[finanzas/api] createChartAccount failed", error);
    throw new MutationError(pgErrorToMessage(error), 500, error);
  }

  await db.from("audit_log").insert({
    tenant_id: tenantId,
    user_id: userId,
    entity: ENTITY,
    entity_id: data.id as string,
    action: "create",
    field: null,
    old_value: null,
    new_value: JSON.stringify({
      code: input.code,
      name: input.name,
      account_type: input.account_type,
      subcategoria: input.subcategoria,
      cuenta_control: input.cuenta_control,
      saldo_inicial: input.saldo_inicial,
      saldo_inicial_fecha: input.saldo_inicial_fecha,
      description: input.description,
      active: input.active,
    }),
  });

  return toRow(data);
}

// ---------------------------------------------------------------------------
// UPDATE
// ---------------------------------------------------------------------------

export async function updateChartAccount(
  db: DB,
  tenantId: string,
  id: string,
  userId: string,
  userRole: string,
  input: UpdateChartAccountInput
): Promise<ChartAccountRow> {
  // Existencia + tenant ownership (defensa en profundidad sobre RLS).
  const { data: existing, error: errExisting } = await db
    .from("chart_of_accounts")
    .select(
      "id, code, name, account_type, subcategoria, cuenta_control, saldo_inicial, saldo_inicial_fecha, description, active, is_system"
    )
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();

  if (errExisting) {
    throw new MutationError(pgErrorToMessage(errExisting), 500, errExisting);
  }
  if (!existing) {
    throw new MutationError("Cuenta no encontrada", 404);
  }

  const isSystem = existing.is_system === true;

  // ---------------------------------------------------------------------------
  // Movimientos: se consulta como mucho UNA vez, y solo si hace falta.
  // ---------------------------------------------------------------------------
  let movimientosCache: number | null = null;
  const movimientos = async (): Promise<number> => {
    if (movimientosCache === null) {
      movimientosCache = await contarMovimientos(db, tenantId, id);
    }
    return movimientosCache;
  };

  // ---------------------------------------------------------------------------
  // Regla 1 — reclasificar contablemente es de admin/contador
  // ---------------------------------------------------------------------------
  // La abogada conserva renombrar, describir y cargar saldo; lo que no puede es
  // mover una cuenta de tipo o de subcategoría, porque eso reescribe el Balance
  // General y el Estado de Resultado.
  const camposReclasificados = CAMPOS_CLASIFICACION.filter(
    (f) =>
      (existing as unknown as Record<string, unknown>)[f] !==
      (input as unknown as Record<string, unknown>)[f]
  );

  if (camposReclasificados.length > 0) {
    if (!(ROLES_CLASIFICACION as readonly string[]).includes(userRole)) {
      throw new MutationError(
        "Solo el contador o un administrador pueden cambiar la clasificación contable (tipo y subcategoría) de una cuenta.",
        403
      );
    }

    // ---------------------------------------------------------------------------
    // Regla 2 — una cuenta CON MOVIMIENTOS no cambia de naturaleza. Nadie.
    // ---------------------------------------------------------------------------
    // Ni el contador, ni el admin. Reclasificar una cuenta que ya tiene asientos
    // reescribe retroactivamente reportes de períodos cerrados: el mismo asiento
    // pasaría a sumar en otra línea del Estado de Resultado y los estados que el
    // contador ya certificó dejarían de reproducirse. Si la clasificación está
    // mal, se desactiva la cuenta y se crea una nueva.
    const movs = await movimientos();
    if (movs > 0) {
      throw new MutationError(
        `La cuenta "${existing.code}" tiene ${movs} movimiento(s) contables y no se le puede cambiar la naturaleza. ` +
          `Desactivala y creá una cuenta nueva con la clasificación correcta.`,
        409
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Regla 3 — tampoco se DESACTIVA una cuenta con movimientos
  // ---------------------------------------------------------------------------
  // "Borrar" en este sistema es `active=false`, y los reportes filtran por
  // `active=true`: desactivar una cuenta con asientos la haría desaparecer de
  // los reportes y su saldo dejaría de sumar. Mismo daño que reclasificarla.
  if (existing.active === true && input.active === false) {
    const movs = await movimientos();
    if (movs > 0) {
      throw new MutationError(
        `La cuenta "${existing.code}" tiene ${movs} movimiento(s) contables y no se puede desactivar: ` +
          `desaparecería de los reportes y su saldo dejaría de sumar.`,
        409
      );
    }
  }

  // Regla: no se puede DESACTIVAR una cuenta del sistema (la usan los reportes).
  // Reactivar (false→true) sí se permite; editar nombre/tipo/desc también.
  if (isSystem && existing.active === true && input.active === false) {
    throw new MutationError(
      `La cuenta "${existing.code}" es del sistema (la usan los reportes) y no se puede desactivar.`,
      409
    );
  }

  // El CÓDIGO es INMUTABLE para TODAS las cuentas (no solo is_system). Es la
  // identidad contable de la cuenta y actúa como FK LÓGICO desde
  // business_expenses.chart_account_code (SIN constraint ni ON UPDATE CASCADE,
  // ver 010_create_business_expenses.sql): renombrarlo orfanaría en silencio
  // los gastos que la referencian. Si el código está mal, se desactiva la
  // cuenta y se crea una nueva.
  const wantsCode = input.code !== undefined && input.code !== existing.code;
  if (wantsCode) {
    throw new MutationError(
      "El código de una cuenta no se puede modificar. Si está mal, desactivala y creá una nueva.",
      400
    );
  }

  const updatePayload: Record<string, unknown> = {
    name: input.name,
    account_type: input.account_type,
    subcategoria: input.subcategoria,
    cuenta_control: input.cuenta_control,
    saldo_inicial: input.saldo_inicial,
    saldo_inicial_fecha: input.saldo_inicial_fecha,
    description: input.description,
    active: input.active,
  };

  const { data, error: errUpdate } = await db
    .from("chart_of_accounts")
    .update(updatePayload)
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .select(SELECT_COLS)
    .single();

  if (errUpdate || !data) {
    console.error("[finanzas/api] updateChartAccount failed", errUpdate);
    throw new MutationError(pgErrorToMessage(errUpdate), 500, errUpdate);
  }

  // Audit log: diff de campos modificados. El código nunca cambia (inmutable),
  // así que no forma parte del diff.
  const fields: Array<keyof typeof updatePayload> = [
    "name",
    "account_type",
    "subcategoria",
    "cuenta_control",
    "saldo_inicial",
    "saldo_inicial_fecha",
    "description",
    "active",
  ];
  const changed: Record<string, { old: unknown; new: unknown }> = {};
  for (const f of fields) {
    if (!(f in updatePayload)) continue;
    const oldVal = (existing as unknown as Record<string, unknown>)[f];
    const newVal = updatePayload[f];
    // saldo_inicial es numeric en BD: según la config de PostgREST puede volver
    // como number o como string ("1500.00"). Comparamos por valor numérico para
    // no registrar un cambio fantasma 1500 → 1500 en cada guardado.
    if (f === "saldo_inicial") {
      if (Number(oldVal ?? 0) !== Number(newVal ?? 0)) {
        changed[f] = { old: Number(oldVal ?? 0), new: newVal };
      }
      continue;
    }
    if (oldVal !== newVal) changed[f] = { old: oldVal, new: newVal };
  }

  if (Object.keys(changed).length > 0) {
    await db.from("audit_log").insert({
      tenant_id: tenantId,
      user_id: userId,
      entity: ENTITY,
      entity_id: id,
      action: "update",
      field: Object.keys(changed).join(","),
      old_value: JSON.stringify(
        Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v.old]))
      ),
      new_value: JSON.stringify(
        Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v.new]))
      ),
    });
  }

  return toRow(data);
}
