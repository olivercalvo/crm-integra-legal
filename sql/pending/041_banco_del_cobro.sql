-- ============================================================================
-- 041 — EL BANCO DEL COBRO
-- ============================================================================
--
-- `payments` no tiene columna de cuenta bancaria. `method` dice CÓMO entró la
-- plata (`efectivo`, `transferencia`, `cheque`, `tarjeta`, `ach`, `otro`) pero no
-- A DÓNDE, y hay tres bancos activos: `100001 Banco General Operativa`,
-- `100002 Banco General Inversiones`, `100003 Banco General Saldo Clientes`.
--
-- Sin esa columna el asiento del cobro no se puede armar sin adivinar el banco.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 🔴 NULLABLE, Y LOS COBROS VIEJOS QUEDAN EN NULL
-- ─────────────────────────────────────────────────────────────────────────────
-- Es el mismo patrón que la `036` usó con `expense_lines.chart_account_code`, y
-- por el mismo motivo: **nadie eligió el banco de esos cobros**, porque el campo
-- no existía cuando se registraron. Escribirles `100001` no sería aplicar un
-- default, sería inventar un dato y darle la misma apariencia que a uno que una
-- persona eligió.
--
-- Y hay una razón concreta para no elegir `100001`: `100003 Banco General Saldo
-- Clientes` existe justamente porque parte de la plata que entra NO es del
-- bufete. Un backfill a la operativa podría estar diciendo que el bufete cobró
-- algo que en realidad está reteniendo.
--
-- El NULL es lo que hace que el rechazo al postear sea honesto: "este cobro no
-- dice de qué banco salió" es cierto, y se arregla preguntando, no adivinando.
--
-- ⚠️ **NO se agrega un CHECK NOT NULL, ni siquiera NOT VALID.** La `037` lo hizo
-- con `expense_lines` porque ahí el objetivo era que ninguna línea NUEVA entrara
-- sin cuenta. Acá el que garantiza es el código —`createPayment` exige el banco—
-- y un CHECK sobre `payments` rompería el DELETE compensatorio y los tests que
-- crean cobros históricos. Si algún día se limpian los viejos, el CHECK va en su
-- propia migración, como la `037`.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- FK LÓGICO, NO CONSTRAINT
-- ─────────────────────────────────────────────────────────────────────────────
-- Igual que `expense_lines.chart_account_code` y que `business_expenses.
-- payment_account_code`: `chart_of_accounts` tiene clave compuesta
-- `(tenant_id, code)` y la app valida contra ella. Poner el FK compuesto acá
-- sería inconsistente con las otras dos columnas del mismo tipo.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- LO QUE NO HACE FALTA MIGRAR
-- ─────────────────────────────────────────────────────────────────────────────
-- `business_expenses.payment_account_code` **ya existe** desde la `036` y tenía
-- cero usos. El pago a proveedor la usa; no hay columna nueva de ese lado.
--
-- IDEMPOTENCIA: `ADD COLUMN IF NOT EXISTS`. Re-ejecutable.
--
-- ESTADO EN STAGING al 04/09/2026: 3 cobros, ninguno con banco, 2 con asiento.
-- ============================================================================

BEGIN;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS payment_account_code TEXT;

COMMENT ON COLUMN payments.payment_account_code IS
  'Cuenta del plan (chart_of_accounts.code) donde ENTRÓ la plata. La elige quien '
  'registra el cobro, sin default — criterio de Rose, 25/08/2026. NULLABLE porque '
  'los cobros anteriores a la migración 041 no la tienen: nadie la eligió. Un cobro '
  'sin esta columna NO se puede postear al libro, y el rechazo lo nombra. FK lógico '
  'a (tenant_id, code); lo valida la app, igual que expense_lines.chart_account_code.';

CREATE INDEX IF NOT EXISTS idx_payments_account_code
  ON payments (tenant_id, payment_account_code)
  WHERE payment_account_code IS NOT NULL;

-- ---------------------------------------------------------------------------
-- VERIFICACIÓN
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_existe   BOOL;
  v_total    INT;
  v_sin      INT;
  v_con_as   INT;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='payments'
       AND column_name='payment_account_code'
  ) INTO v_existe;
  IF NOT v_existe THEN
    RAISE EXCEPTION 'La columna payment_account_code no quedó creada.';
  END IF;

  SELECT COUNT(*) INTO v_total FROM payments;
  SELECT COUNT(*) INTO v_sin   FROM payments WHERE payment_account_code IS NULL;
  SELECT COUNT(*) INTO v_con_as
    FROM payments p
    JOIN journal_entries je ON je.source_type='pago' AND je.source_id = p.id;

  -- Nada de esto aborta: son números para el log, no invariantes. La migración
  -- solo agrega una columna vacía; no puede romper nada que ya estuviera bien.
  RAISE NOTICE '════════════════════════════════════════════════════';
  RAISE NOTICE '041 OK';
  RAISE NOTICE '  cobros totales        : %', v_total;
  RAISE NOTICE '  sin banco (esperado)  : %', v_sin;
  RAISE NOTICE '  ya con asiento        : %', v_con_as;
  RAISE NOTICE '  → los que ya tienen asiento NO se tocan: su asiento ya cita';
  RAISE NOTICE '    un banco, elegido por el seed. Ver la 4ª instancia de la';
  RAISE NOTICE '    divergencia en task_plan.md.';
  RAISE NOTICE '════════════════════════════════════════════════════';
END $$;

COMMIT;
