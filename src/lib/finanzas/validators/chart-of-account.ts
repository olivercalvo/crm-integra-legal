/**
 * Validadores manuales para chart_of_accounts — sin Zod, mismo patrón que
 * validators/business-expense.ts: cada validador devuelve
 * `{ ok: true, data, errors: null } | { ok: false, data: null, errors }`
 * con `errors` como mapa flat campo → mensaje en español para mostrar inline.
 *
 * La UNICIDAD del código NO se valida acá (requiere lookup en BD); la verifica
 * el helper server-side (api/chart-of-accounts.ts) antes del INSERT/UPDATE.
 */

import {
  isAccountType,
  isCuentaControl,
  isSubcategoria,
  isSubcategoriaValidaParaTipo,
  requiereSubcategoria,
  subcategoriasParaTipo,
  ACCOUNT_TYPE_LABEL_ES,
  SUBCATEGORIA_LABEL_ES,
  type AccountType,
  type CuentaControl,
  type Subcategoria,
  type CreateChartAccountInput,
  type UpdateChartAccountInput,
} from "@/lib/finanzas/types/chart-of-account";
import {
  ANIO_MINIMO_SALDO_INICIAL,
  anioMaximoSaldoInicial,
  esFechaISOValida,
} from "@/lib/finanzas/contabilidad/periodo-fiscal";

export type ValidationErrors = Record<string, string>;

export type ValidationResult<T> =
  | { ok: true; data: T; errors: null }
  | { ok: false; data: null; errors: ValidationErrors };

/**
 * Formato de código: letras, dígitos, guion y punto. Los códigos del bufete
 * son numéricos (1201, 4101…) pero dejamos margen para códigos alfanuméricos
 * (ej. "1201-A") sin abrir a caracteres raros que rompan búsquedas/QB.
 */
const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9.\-]*$/;
const CODE_MAX = 20;
const NAME_MIN = 2;
const NAME_MAX = 120;
const DESCRIPTION_MAX = 1000;

/**
 * Tope de saldo_inicial. La columna es numeric(14,2) → 12 dígitos enteros + 2
 * decimales. Cortamos en 1e12 (exclusivo) para dar un error accionable en vez
 * de un 22003 "numeric field overflow" crudo de Postgres.
 */
const SALDO_ABS_MAX = 1_000_000_000_000; // 1e12

/** Redondeo a 2 decimales (misma helper que validators/business-expense.ts). */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function validateFields(
  raw: {
    code?: unknown;
    name?: unknown;
    account_type?: unknown;
    subcategoria?: unknown;
    cuenta_control?: unknown;
    saldo_inicial?: unknown;
    saldo_inicial_fecha?: unknown;
    description?: unknown;
    active?: unknown;
  },
  opts: { requireCode: boolean }
): {
  errors: ValidationErrors;
  code: string | null;
  name: string;
  accountType: AccountType | null;
  subcategoria: Subcategoria | null;
  cuentaControl: CuentaControl | null;
  saldoInicial: number;
  saldoInicialFecha: string | null;
  description: string | null;
  active: boolean;
} {
  const errors: ValidationErrors = {};

  // code
  let code: string | null = null;
  const codeRaw = raw.code == null ? "" : String(raw.code).trim();
  if (opts.requireCode || codeRaw !== "") {
    if (!codeRaw) {
      errors.code = "Código requerido";
    } else if (codeRaw.length > CODE_MAX) {
      errors.code = `Código muy largo (máximo ${CODE_MAX} caracteres)`;
    } else if (!CODE_RE.test(codeRaw)) {
      errors.code = "Código inválido (use letras, dígitos, guion o punto)";
    } else {
      code = codeRaw;
    }
  }

  // name
  const name = String(raw.name ?? "").trim();
  if (!name) {
    errors.name = "Nombre requerido";
  } else if (name.length < NAME_MIN) {
    errors.name = `Nombre muy corto (mínimo ${NAME_MIN} caracteres)`;
  } else if (name.length > NAME_MAX) {
    errors.name = `Nombre muy largo (máximo ${NAME_MAX} caracteres)`;
  }

  // account_type (debe ser un valor inglés válido)
  let accountType: AccountType | null = null;
  if (!isAccountType(raw.account_type)) {
    errors.account_type = "Tipo de cuenta inválido";
  } else {
    accountType = raw.account_type;
  }

  // active (acepta boolean o strings "true"/"false").
  // Se resuelve ANTES que la subcategoría porque la obligatoriedad depende de
  // si la cuenta queda activa.
  const active =
    raw.active === true ||
    raw.active === "true" ||
    raw.active === undefined || // default activa
    raw.active === null;

  // subcategoria — desde NIIF 18 depende del TIPO:
  //   · En cuentas de RESULTADO (ingreso/costo/gasto) ACTIVAS es OBLIGATORIA:
  //     sin ella el Estado de Resultado no puede ubicar la cuenta en su bloque
  //     de actividad. Espeja el CHECK `coa_resultado_subcategoria_niif18`.
  //   · Tiene que pertenecer AL TIPO, no solo existir: un ingreso con
  //     'gastos_operativos' es tan inválido como uno sin nada.
  //   · En cuentas de BALANCE sigue siendo opcional.
  let subcategoria: Subcategoria | null = null;
  const subRaw =
    raw.subcategoria == null ? "" : String(raw.subcategoria).trim();

  if (subRaw === "") {
    if (accountType && active && requiereSubcategoria(accountType)) {
      errors.subcategoria = `Subcategoría requerida en cuentas de tipo ${ACCOUNT_TYPE_LABEL_ES[accountType]}`;
    }
  } else if (!isSubcategoria(subRaw)) {
    errors.subcategoria = "Subcategoría inválida";
  } else if (accountType && !isSubcategoriaValidaParaTipo(accountType, subRaw)) {
    const validas = subcategoriasParaTipo(accountType)
      .map((s) => SUBCATEGORIA_LABEL_ES[s])
      .join(", ");
    errors.subcategoria = `"${SUBCATEGORIA_LABEL_ES[subRaw]}" no corresponde a una cuenta de tipo ${ACCOUNT_TYPE_LABEL_ES[accountType]}. Opciones: ${validas}`;
  } else {
    subcategoria = subRaw;
  }

  // cuenta_control (OPCIONAL: null / "" / ausente = cuenta normal).
  let cuentaControl: CuentaControl | null = null;
  const ccRaw =
    raw.cuenta_control == null ? "" : String(raw.cuenta_control).trim();
  if (ccRaw !== "") {
    if (!isCuentaControl(ccRaw)) {
      errors.cuenta_control = "Cuenta control inválida";
    } else {
      cuentaControl = ccRaw;
    }
  }

  // saldo_inicial (OPCIONAL en el payload → default 0).
  // PERMITE NEGATIVOS a propósito (patrimonio con pérdida acumulada,
  // contra-cuentas como depreciación acumulada).
  let saldoInicial = 0;
  if (
    raw.saldo_inicial !== undefined &&
    raw.saldo_inicial !== null &&
    String(raw.saldo_inicial).trim() !== ""
  ) {
    const n = Number(raw.saldo_inicial);
    if (!Number.isFinite(n)) {
      errors.saldo_inicial = "Saldo inicial debe ser un número";
    } else if (Math.abs(n) >= SALDO_ABS_MAX) {
      errors.saldo_inicial = "Saldo inicial fuera de rango (máximo 12 dígitos)";
    } else {
      saldoInicial = round2(n);
    }
  }

  // saldo_inicial_fecha — un saldo sin fecha no dice nada.
  //
  // "191,947.55 por cobrar" es un dato distinto al 1 de enero que al 14 de
  // agosto. Por eso es OBLIGATORIA en cuanto el saldo no es 0, y se guarda como
  // null cuando la cuenta abre en cero. Espeja el CHECK
  // `coa_saldo_inicial_requiere_fecha`.
  //
  // Se valida DESPUÉS de saldo_inicial porque la obligatoriedad depende de él.
  let saldoInicialFecha: string | null = null;
  const fechaRaw =
    raw.saldo_inicial_fecha == null ? "" : String(raw.saldo_inicial_fecha).trim();
  const haySaldo = saldoInicial !== 0;

  if (fechaRaw === "") {
    // Si el saldo YA falló su propia validación no se pide la fecha además: dos
    // errores encadenados por la misma causa confunden más de lo que ayudan.
    if (haySaldo && !errors.saldo_inicial) {
      errors.saldo_inicial_fecha = "Indique a qué fecha corresponde el saldo inicial";
    }
  } else if (!esFechaISOValida(fechaRaw)) {
    errors.saldo_inicial_fecha = "Fecha inválida (formato AAAA-MM-DD)";
  } else {
    const anio = Number(fechaRaw.slice(0, 4));
    const anioMax = anioMaximoSaldoInicial(new Date());
    if (anio < ANIO_MINIMO_SALDO_INICIAL || anio > anioMax) {
      // Un año fuera de rango casi siempre es un dedazo, no una intención.
      errors.saldo_inicial_fecha = `El año debe estar entre ${ANIO_MINIMO_SALDO_INICIAL} y ${anioMax}`;
    } else {
      saldoInicialFecha = fechaRaw;
    }
  }

  // Con el saldo en 0 la fecha no aporta y se descarta, para no dejar una fecha
  // colgada de un saldo que ya no existe.
  if (!haySaldo) saldoInicialFecha = null;

  // description (opcional)
  let description: string | null = null;
  if (raw.description != null && String(raw.description).trim() !== "") {
    const d = String(raw.description).trim();
    if (d.length > DESCRIPTION_MAX) {
      errors.description = `Descripción muy larga (máximo ${DESCRIPTION_MAX} caracteres)`;
    } else {
      description = d;
    }
  }

  return {
    errors,
    code,
    name,
    accountType,
    subcategoria,
    cuentaControl,
    saldoInicial,
    saldoInicialFecha,
    description,
    active,
  };
}

/** Valida un payload de creación (code obligatorio). */
export function validateCreateChartAccount(
  raw: Partial<Record<keyof CreateChartAccountInput, unknown>>
): ValidationResult<CreateChartAccountInput> {
  const {
    errors,
    code,
    name,
    accountType,
    subcategoria,
    cuentaControl,
    saldoInicial,
    saldoInicialFecha,
    description,
    active,
  } = validateFields(raw, { requireCode: true });

  if (Object.keys(errors).length > 0) {
    return { ok: false, data: null, errors };
  }

  return {
    ok: true,
    errors: null,
    data: {
      code: code as string,
      name,
      account_type: accountType as AccountType,
      subcategoria,
      cuenta_control: cuentaControl,
      saldo_inicial: saldoInicial,
      saldo_inicial_fecha: saldoInicialFecha,
      description,
      active,
    },
  };
}

/**
 * Valida un payload de edición. `code` es opcional: si NO llega, se conserva
 * el actual; si llega, se valida el formato (y el server bloquea el cambio en
 * cuentas is_system).
 */
export function validateUpdateChartAccount(
  raw: Partial<Record<keyof UpdateChartAccountInput, unknown>>
): ValidationResult<UpdateChartAccountInput> {
  const {
    errors,
    code,
    name,
    accountType,
    subcategoria,
    cuentaControl,
    saldoInicial,
    saldoInicialFecha,
    description,
    active,
  } = validateFields(raw, { requireCode: false });

  if (Object.keys(errors).length > 0) {
    return { ok: false, data: null, errors };
  }

  const data: UpdateChartAccountInput = {
    name,
    account_type: accountType as AccountType,
    subcategoria,
    cuenta_control: cuentaControl,
    saldo_inicial: saldoInicial,
    saldo_inicial_fecha: saldoInicialFecha,
    description,
    active,
  };
  if (code !== null) data.code = code;

  return { ok: true, errors: null, data };
}
