-- ============================================================================
-- 069 — REVERSIONES, ANULACIONES Y NOTAS: EL CONTADOR ELIGE LA FECHA DE REGISTRO
-- ============================================================================
-- 30/09/2026. Plan: `docs/finanzas/plan-bloque1.md`, punto 1 (E1).
--
-- Revisión de Josuarth del 28/09 y reunión del 30/09: la reversión deja de
-- llevar SIEMPRE la fecha de hoy (acta del 09/09). El contador elige la fecha
-- de registro:
--   · siempre en un período ABIERTO — lo sigue exigiendo `post_journal_entry`,
--     que no cambia;
--   · nunca ANTES del asiento que revierte — lo sigue exigiendo cada RPC, con
--     el chequeo `p_transaction_date < v_orig_date` que ya tenían;
--   · fechas futuras: las decide la app (`PERMITIR_FECHA_DE_REGISTRO_FUTURA`),
--     la base no las mira.
--
-- Lo ÚNICO que cambia en la base es que se va el candado
--     IF p_transaction_date IS NULL OR abs(p_transaction_date - current_date) > 1
-- de los ocho RPC que lo tienen, y el equivalente sobre `p_issue_date` de
-- `create_supplier_credit_note`. Queda la exigencia de que la fecha venga.
-- Además, `cancel_invoice_with_reversal` mide "el mes de la factura" con su
-- fecha de REGISTRO (`accounting_date`, 068) en vez de `issue_date`, y su
-- mensaje ya no promete "una nota de crédito con fecha de hoy".
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUÉ UN PARCHE VERIFICADO Y NO NUEVE COPIAS DE LAS FUNCIONES
-- ─────────────────────────────────────────────────────────────────────────────
-- Las nueve funciones suman ~900 líneas. Copiarlas a mano para cambiar cuatro
-- líneas en cada una es la forma más segura de cambiar, sin querer, algo más.
-- Este archivo toma la definición VIGENTE (`pg_get_functiondef`), reemplaza
-- SOLO el texto exacto del candado y la vuelve a crear. Y ABORTA si el texto
-- no aparece EXACTAMENTE las veces esperadas: si alguien cambió la función
-- entre medio, esto no la pisa a ciegas, se detiene.
--   · `CREATE OR REPLACE` conserva dueño, SECURITY DEFINER, search_path y los
--     permisos (EXECUTE sólo service_role, 030). La verificación del final lo
--     comprueba igual.
--   · Las fuentes históricas (046 … 067) quedan como estaban: son historia.
--     La definición vigente es la de la base, y el inventario la marca.
--
-- 🔴 NO SE TOCA EL LIBRO. Cero filas de journal_entries / journal_entry_lines.
--
-- IDEMPOTENCIA: la segunda corrida encuentra cero candados viejos y los reemplazos
--               ya hechos; lo detecta y no hace nada (ver `p_esperado` = 0 o 1).
-- 🛑 SOLO STAGING hasta la ventana del despliegue. Depende de la 068
--    (`invoices.accounting_date`).
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'accounting_date'
  ) THEN
    RAISE EXCEPTION '069: falta invoices.accounting_date. Aplicar primero la 068.';
  END IF;
END $$;

DO $parche$
DECLARE
  -- El candado viejo, igual en los ocho reversores (con distinta sangría).
  c_candado CONSTANT text :=
    'IF p_transaction_date IS NULL OR abs\(p_transaction_date - current_date\) > 1 THEN.*?END IF;';
  c_nuevo CONSTANT text :=
    E'IF p_transaction_date IS NULL THEN\n'
    '    RAISE EXCEPTION ''La reversión necesita una fecha de registro (la elige el contador, en un período abierto).'';\n'
    '  END IF;';
  -- El comentario que acompañaba al candado en la 055 y la 060.
  c_comentario CONSTANT text :=
    '-- La fecha es la de HOY, como en las otras [a-z]+ \(acta del 09/09\)\. El margen\s*-- de un día cubre la medianoche y las zonas horarias, nada más\.\s*';
  c_comentario_nuevo CONSTANT text :=
    E'-- Fecha de registro ELEGIDA (069: revisión del 28/09 y reunión del 30/09).\n'
    '  -- El período lo exige post_journal_entry; "no antes del original", abajo.\n  ';

  r record;
  v_def text;
  v_n int;
  v_hechos int := 0;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- función, patrón, reemplazo, veces esperadas
      ('public.reverse_payment(uuid,uuid,text,date,text,jsonb,uuid)',              c_candado, c_nuevo, 1),
      ('public.reverse_supplier_payment(uuid,uuid,text,date,text,jsonb,uuid)',     c_candado, c_nuevo, 1),
      ('public.reverse_expense_tramite(uuid,uuid,text,date,text,jsonb,uuid)',      c_candado, c_nuevo, 1),
      ('public.reverse_journal_entry(uuid,uuid,text,date,text,jsonb,uuid)',        c_comentario, c_comentario_nuevo, 1),
      ('public.reverse_journal_entry(uuid,uuid,text,date,text,jsonb,uuid)',        c_candado, c_nuevo, 1),
      ('public.reverse_credit_note(uuid,uuid,text,date,text,jsonb,uuid)',          c_comentario, c_comentario_nuevo, 1),
      ('public.reverse_credit_note(uuid,uuid,text,date,text,jsonb,uuid)',          c_candado, c_nuevo, 1),
      ('public.reverse_supplier_credit_note(uuid,uuid,text,date,text,jsonb,uuid)', c_candado, c_nuevo, 1),
      ('public.cancel_invoice_with_reversal(uuid,uuid,text,text,date,text,jsonb,uuid)', c_candado, c_nuevo, 1),
      -- El "mes de la factura" pasa a ser el de su fecha de REGISTRO (068).
      ('public.cancel_invoice_with_reversal(uuid,uuid,text,text,date,text,jsonb,uuid)',
         'SELECT status, amount_paid, issue_date, invoice_number',
         'SELECT status, amount_paid, accounting_date, invoice_number', 1),
      ('public.cancel_invoice_with_reversal(uuid,uuid,text,text,date,text,jsonb,uuid)',
         'no se anula, se emite una nota de crédito con fecha de hoy\.',
         'no se anula, se corrige con una nota de crédito.', 1),
      -- La NC de compra: su fecha de registro (`issue_date`) deja de ser "hoy".
      ('public.create_supplier_credit_note(uuid,uuid,text,date,text,text,date,jsonb,jsonb,uuid)',
         'IF p_issue_date IS NULL OR abs\(p_issue_date - current_date\) > 1 THEN.*?END IF;',
         E'IF p_issue_date IS NULL THEN\n'
         '    RAISE EXCEPTION ''La nota de crédito de proveedor necesita una fecha de registro (la elige el contador, en un período abierto).'';\n'
         '  END IF;', 1)
    ) AS t(fn, patron, reemplazo, esperado)
  LOOP
    v_def := pg_get_functiondef(r.fn::regprocedure);
    v_n := regexp_count(v_def, r.patron);
    IF v_n = 0 AND position(replace(r.reemplazo, E'\n', '') IN replace(v_def, E'\n', '')) > 0 THEN
      -- Segunda corrida: ya estaba parchada. No se toca.
      RAISE NOTICE '069 · % ya estaba aplicado: %', r.fn, left(r.patron, 50);
      CONTINUE;
    END IF;
    IF v_n <> r.esperado THEN
      RAISE EXCEPTION '069: en % el patrón «%» aparece % vez/veces (se esperaba %). No se toca nada: revisar la función a mano.',
        r.fn, left(r.patron, 60), v_n, r.esperado;
    END IF;
    EXECUTE regexp_replace(v_def, r.patron, r.reemplazo);
    v_hechos := v_hechos + 1;
  END LOOP;
  RAISE NOTICE '069 · % reemplazo(s) aplicados', v_hechos;
END $parche$;

-- Los comentarios de las funciones decían "fechas que no sean hoy".
COMMENT ON FUNCTION public.reverse_payment(uuid,uuid,text,date,text,jsonb,uuid) IS
  'Reversa un cobro contabilizado en UNA transacción: postea el asiento espejo (vía post_journal_entry, con reverses_entry_id y motivo), fotografía y borra sus payment_applications (T7a devuelve la factura a su estado) y marca el cobro anulado. Rechaza líneas que no sean el espejo exacto del original y fechas anteriores al original; la fecha la elige el contador (069) y el período cerrado lo rechaza post_journal_entry. SECURITY DEFINER, EXECUTE solo service_role: confía en p_tenant_id, que la ruta saca del usuario autenticado.';
COMMENT ON FUNCTION public.reverse_supplier_payment(uuid,uuid,text,date,text,jsonb,uuid) IS
  'Reversa un pago a proveedor contabilizado en UNA transacción: postea el espejo (reverses_entry_id + motivo) y marca el pago anulado; el trigger devuelve el documento (compra o gasto de trámite, 049). Rechaza saldos heredados, líneas que no sean el espejo exacto y fechas anteriores al original (la fecha la elige el contador, 069). SECURITY DEFINER, EXECUTE solo service_role.';
COMMENT ON FUNCTION public.reverse_expense_tramite(uuid,uuid,text,date,text,jsonb,uuid) IS
  'Reversa un gasto de trámite contabilizado en UNA transacción: postea el espejo (reverses_entry_id + motivo, con la fecha de registro elegida, 069) y marca el gasto anulado (llave finanzas.tramite_anular de la 049). Rechaza gastos con pagos registrados, líneas que no sean el espejo exacto y fechas anteriores al original. SECURITY DEFINER, EXECUTE solo service_role: confía en p_tenant_id, que la ruta saca del usuario autenticado.';
COMMENT ON FUNCTION public.reverse_journal_entry(uuid,uuid,text,date,text,jsonb,uuid) IS
  'Reversa un asiento MANUAL: verifica que el espejo sea exacto (EXCEPT ALL), que nadie lo haya reversado antes y que la fecha no sea anterior al original (la elige el contador, 069), y lo postea con reverses_entry_id. Rechaza cualquier source_type que no sea manual: un asiento con documento se corrige por su documento. SECURITY DEFINER, EXECUTE solo service_role.';
COMMENT ON FUNCTION public.reverse_credit_note(uuid,uuid,text,date,text,jsonb,uuid) IS
  'Reversa una nota de crédito CON asiento propio: verifica que el espejo sea exacto (EXCEPT ALL), que nadie la haya reversado antes y que la fecha no sea anterior al original (la elige el contador, 069), postea con reverses_entry_id y marca la NC anulada. credited_total, balance_due y el status de la factura NO se escriben: los recalcula trg_recalc_invoice_credited. Rechaza las NC sin asiento (las que salen de anular una factura). SECURITY DEFINER, EXECUTE solo service_role.';
COMMENT ON FUNCTION public.cancel_invoice_with_reversal(uuid,uuid,text,text,date,text,jsonb,uuid) IS
  'Anula una factura: NC total automática + reversión del asiento con la fecha de registro elegida (069), en UNA transacción. Rechaza si el mes de REGISTRO de la factura está cerrado (se corrige con NC). Desde la 063 bloquea sólo por notas de crédito VIGENTES (con asiento propio y sin reversar). SECURITY DEFINER, EXECUTE solo service_role.';

-- ----------------------------------------------------------------------------
-- Verificación
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  v_def text;
BEGIN
  FOR r IN
    SELECT unnest(ARRAY[
      'public.reverse_payment(uuid,uuid,text,date,text,jsonb,uuid)',
      'public.reverse_supplier_payment(uuid,uuid,text,date,text,jsonb,uuid)',
      'public.reverse_expense_tramite(uuid,uuid,text,date,text,jsonb,uuid)',
      'public.reverse_journal_entry(uuid,uuid,text,date,text,jsonb,uuid)',
      'public.reverse_credit_note(uuid,uuid,text,date,text,jsonb,uuid)',
      'public.reverse_supplier_credit_note(uuid,uuid,text,date,text,jsonb,uuid)',
      'public.cancel_invoice_with_reversal(uuid,uuid,text,text,date,text,jsonb,uuid)',
      'public.create_supplier_credit_note(uuid,uuid,text,date,text,text,date,jsonb,jsonb,uuid)'
    ]) AS fn
  LOOP
    v_def := pg_get_functiondef(r.fn::regprocedure);
    IF v_def ~ 'abs\((p_transaction_date|p_issue_date) - current_date\)' THEN
      RAISE EXCEPTION '069: % todavía exige la fecha de hoy', r.fn;
    END IF;
    IF position('SECURITY DEFINER' IN v_def) = 0 THEN
      RAISE EXCEPTION '069: % perdió SECURITY DEFINER', r.fn;
    END IF;
    IF has_function_privilege('anon', r.fn, 'EXECUTE') OR has_function_privilege('authenticated', r.fn, 'EXECUTE') THEN
      RAISE EXCEPTION '069: % quedó ejecutable por anon o authenticated', r.fn;
    END IF;
    -- "No antes del original" sigue en todos los reversores.
    IF r.fn NOT LIKE '%create_supplier_credit_note%'
       AND position('no puede ser anterior al asiento que revierte' IN v_def) = 0 THEN
      RAISE EXCEPTION '069: % perdió el chequeo de "no antes del original"', r.fn;
    END IF;
  END LOOP;

  v_def := pg_get_functiondef('public.cancel_invoice_with_reversal(uuid,uuid,text,text,date,text,jsonb,uuid)'::regprocedure);
  IF position('SELECT status, amount_paid, accounting_date, invoice_number' IN v_def) = 0 THEN
    RAISE EXCEPTION '069: la anulación no mide el mes por accounting_date';
  END IF;

  RAISE NOTICE '069 ✅ ocho RPC sin el candado de "hoy"; siguen: fecha obligatoria, no antes del original, período abierto (post_journal_entry), SECURITY DEFINER y EXECUTE sólo service_role';
END $$;

COMMIT;
