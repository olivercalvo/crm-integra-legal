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
  type AccountType,
  type CreateChartAccountInput,
  type UpdateChartAccountInput,
} from "@/lib/finanzas/types/chart-of-account";

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

function validateFields(
  raw: {
    code?: unknown;
    name?: unknown;
    account_type?: unknown;
    description?: unknown;
    active?: unknown;
  },
  opts: { requireCode: boolean }
): {
  errors: ValidationErrors;
  code: string | null;
  name: string;
  accountType: AccountType | null;
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

  // active (acepta boolean o strings "true"/"false")
  const active =
    raw.active === true ||
    raw.active === "true" ||
    raw.active === undefined || // default activa
    raw.active === null;

  return { errors, code, name, accountType, description, active };
}

/** Valida un payload de creación (code obligatorio). */
export function validateCreateChartAccount(
  raw: Partial<Record<keyof CreateChartAccountInput, unknown>>
): ValidationResult<CreateChartAccountInput> {
  const { errors, code, name, accountType, description, active } = validateFields(
    raw,
    { requireCode: true }
  );

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
  const { errors, code, name, accountType, description, active } = validateFields(
    raw,
    { requireCode: false }
  );

  if (Object.keys(errors).length > 0) {
    return { ok: false, data: null, errors };
  }

  const data: UpdateChartAccountInput = {
    name,
    account_type: accountType as AccountType,
    description,
    active,
  };
  if (code !== null) data.code = code;

  return { ok: true, errors: null, data };
}
