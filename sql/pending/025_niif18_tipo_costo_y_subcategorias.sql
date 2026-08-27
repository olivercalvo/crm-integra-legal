-- =============================================================================
-- FEATURE: NIIF 18 — sexto tipo (costo), nueve subcategorías, cuenta control
-- Sprint:  Contabilidad — Fase 1 (Tareas 1, 2 y parte de la 6)
-- Fecha:   2026-08-27
-- Tenant:  a0000000-0000-0000-0000-000000000001 (Integra Legal)
--
-- CONTEXTO:
--   NIIF 18 es obligatoria desde el 1/1/2027 y reemplaza a NIC 1. Clasifica
--   ingresos Y gastos por ACTIVIDAD (operación / inversión / financiamiento).
--   El módulo contable se está construyendo ahora, así que se construye ya con
--   la norma nueva en vez de rehacerlo en diciembre.
--
--   Esta migración hace TRES cosas que van juntas o no van:
--
--     1. COSTO pasa a ser un TIPO propio (son SEIS: activo, pasivo, patrimonio,
--        ingreso, costo, gasto). Hoy las 6 cuentas de costo (500001-500006)
--        viven como account_type='expense' + subcategoria='costo'.
--
--     2. Las subcategorías de RESULTADO pasan a ser NUEVE (3 naturalezas × 3
--        actividades) y OBLIGATORIAS en cuentas de resultado activas. Las tres
--        genéricas de antes (ingreso, costo, gasto_operativo) desaparecen.
--
--     3. Se agrega `cuenta_control` (Tarea 6) y la cuenta Anticipo de Clientes,
--        que Josuar pidió por correo en agosto y nunca se creó.
--
-- ⚠️ ESTA MIGRACIÓN NO SE PUEDE APLICAR SOLA.
--   `buildEstadoResultado()` deriva los costos de
--   `account_type='expense' AND subcategoria='costo'`. En cuanto las 6 cuentas
--   pasan a account_type='cost', dejan de estar en `expenseAccounts` y TAMPOCO
--   están en `incomeAccounts`: desaparecen del reporte y el Total de Costos
--   queda en 0. Va en el MISMO commit que el cambio de
--   `src/lib/finanzas/reports/accounting-reports.ts` y sus tests.
--   (Es la lección de lock-step del Sprint 2E.1, ver CLAUDE.md.)
--
-- REVIERTE UNA DECISIÓN DE 024:
--   024 dejó `subcategoria` como TEXT sin CHECK a propósito, porque la carga
--   masiva del Excel de Josuar podía necesitar valores nuevos en plena ventana
--   de deadline. Esa ventana ya pasó y NIIF 18 fija el vocabulario en nueve
--   valores normativos, así que ahora SÍ conviene el CHECK — pero solo el
--   condicional (resultado + activa), no una lista cerrada de todo el
--   vocabulario. Las subcategorías de balance siguen sin constraint.
--
-- POR QUÉ EL CHECK EXCLUYE LAS INACTIVAS:
--   Las 34 cuentas viejas de QuickBooks tienen subcategoria=NULL y están
--   desactivadas (los reportes filtran active=true y no las ven). Un CHECK
--   plano las reventaría. Las 5 cuentas is_system (1201, 1202, 2301, 4101,
--   4102) están entre ellas, así que también quedan exentas.
--
-- IDEMPOTENCIA:
--   Re-ejecutable. Los UPDATE filtran por el valor viejo (segunda pasada = 0
--   filas), el INSERT usa WHERE NOT EXISTS, y los constraints se dropean antes
--   de crearse.
--
-- APLICACIÓN:
--   Staging: `node scripts/apply-staging-sql.mjs` (ya está en BUNDLE_2).
--   Producción: NO. Solo por merge a main, y con backup previo.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- PASO A — account_type acepta 'cost'
-- -----------------------------------------------------------------------------
-- El CHECK original se declaró INLINE y sin nombre en
-- 20260505000002_finanzas_catalogos.sql, así que Postgres lo autobautizó. En vez
-- de asumir el nombre generado, lo buscamos por su definición. Así la migración
-- no se rompe si la base quedó con otro nombre (staging recreada, restore, etc.).
--
-- ⚠️ EL FILTRO PIDE '%asset%' ADEMÁS DE '%account_type%', Y NO ES DECORATIVO.
-- La tabla tiene OTRO check que también menciona account_type: el
-- `coa_resultado_subcategoria_niif18` que agrega el PASO G de esta misma
-- migración. Con el filtro ancho, una SEGUNDA corrida de este archivo dropearía
-- los dos. Hoy se salvaba de casualidad —el paso G lo vuelve a crear— pero es
-- exactamente el bug que la primera versión de la 028 sí produjo con
-- `je_reversion_requires_ref`, y ahí no había nada que lo recreara.
--
-- Solo el CHECK del enum lista los tipos, y solo él menciona 'asset': el otro
-- nombra únicamente income/cost/expense. Eso los distingue sin ambigüedad.
DO $$
DECLARE
  v_nombre text;
BEGIN
  FOR v_nombre IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class     rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
     WHERE nsp.nspname = 'public'
       AND rel.relname = 'chart_of_accounts'
       AND con.contype = 'c'
       AND pg_get_constraintdef(con.oid) ILIKE '%account_type%'
       AND pg_get_constraintdef(con.oid) ILIKE '%asset%'
  LOOP
    EXECUTE format('ALTER TABLE public.chart_of_accounts DROP CONSTRAINT %I', v_nombre);
    RAISE NOTICE 'CHECK viejo de account_type eliminado: %', v_nombre;
  END LOOP;
END $$;

ALTER TABLE public.chart_of_accounts
  ADD CONSTRAINT chart_of_accounts_account_type_check
  CHECK (account_type IN ('asset', 'liability', 'equity', 'income', 'cost', 'expense'));

COMMENT ON COLUMN public.chart_of_accounts.account_type IS
  'Tipo de cuenta, en inglés por estándar contable. SEIS valores desde NIIF 18: asset, liability, equity, income, cost, expense. `cost` se separó de `expense` en la Fase 1 del módulo contable (2026-08-27): antes los costos vivían como expense + subcategoria=''costo''. Labels en español en src/lib/finanzas/types/chart-of-account.ts.';

-- -----------------------------------------------------------------------------
-- PASO B — columna cuenta_control (Tarea 6)
-- -----------------------------------------------------------------------------
-- Marca las cuentas cuyo saldo tiene que cuadrar contra el detalle de un
-- auxiliar. NULL = cuenta normal. Con CHECK porque el vocabulario es cerrado y
-- no tiene la presión de la carga masiva que justificó dejar libre subcategoria.
ALTER TABLE public.chart_of_accounts
  ADD COLUMN IF NOT EXISTS cuenta_control text NULL;

ALTER TABLE public.chart_of_accounts
  DROP CONSTRAINT IF EXISTS chart_of_accounts_cuenta_control_check;

ALTER TABLE public.chart_of_accounts
  ADD CONSTRAINT chart_of_accounts_cuenta_control_check
  CHECK (cuenta_control IS NULL OR cuenta_control IN ('clientes', 'proveedores'));

COMMENT ON COLUMN public.chart_of_accounts.cuenta_control IS
  'Indica que la cuenta CONTROLA un auxiliar y su saldo debe cuadrar contra ese detalle: ''clientes'' (antigüedad de cuentas por cobrar) o ''proveedores'' (antigüedad de cuentas por pagar). NULL = cuenta normal.';

-- -----------------------------------------------------------------------------
-- PASO C — las 6 cuentas de costo pasan al tipo propio
-- -----------------------------------------------------------------------------
-- 500001 Traductores Oficiales, 500002 Notarios, 500003 Mensajería
-- Especializada, 500004 Honorarios Profesionales Externos, 500005 Costos
-- trámites legales, 500006 Investigadores.
--
-- Se identifican por subcategoria='costo' (no por rango de código) porque es la
-- clasificación que el contador cargó, y es la que define el reporte hoy.
UPDATE public.chart_of_accounts
   SET account_type = 'cost',
       subcategoria = 'costos_operativos'
 WHERE tenant_id    = 'a0000000-0000-0000-0000-000000000001'
   AND account_type = 'expense'
   AND subcategoria = 'costo';

-- -----------------------------------------------------------------------------
-- PASO D — subcategorías de resultado al vocabulario NIIF 18
-- -----------------------------------------------------------------------------
-- Todo lo que hoy existe es actividad de OPERACIÓN: el bufete no tiene cuentas
-- de inversión ni de financiamiento todavía. Los otros seis valores quedan
-- disponibles en el selector para cuando Josuar las abra.
UPDATE public.chart_of_accounts
   SET subcategoria = 'ingresos_operativos'
 WHERE tenant_id    = 'a0000000-0000-0000-0000-000000000001'
   AND account_type = 'income'
   AND subcategoria = 'ingreso';

UPDATE public.chart_of_accounts
   SET subcategoria = 'gastos_operativos'
 WHERE tenant_id    = 'a0000000-0000-0000-0000-000000000001'
   AND account_type = 'expense'
   AND subcategoria = 'gasto_operativo';

COMMENT ON COLUMN public.chart_of_accounts.subcategoria IS
  'Agrupador de reportes, snake_case, validado en la capa de app (SUBCATEGORIAS_POR_TIPO en src/lib/finanzas/types/chart-of-account.ts). BALANCE (libre, sin CHECK): activo_corriente, activo_no_corriente, propiedad_planta_equipo, pasivo_corriente, pasivo_no_corriente, patrimonio, otro. RESULTADO (NIIF 18, OBLIGATORIA si active=true): ingresos_operativos, ingresos_inversion, ingresos_financiamiento, costos_operativos, costos_inversion, costos_financiamiento, gastos_operativos, gastos_inversion, gastos_financiamiento.';

-- -----------------------------------------------------------------------------
-- PASO E — marcar las cuentas control (Tarea 6)
-- -----------------------------------------------------------------------------
UPDATE public.chart_of_accounts
   SET cuenta_control = 'clientes'
 WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
   AND code      = '100004';   -- Cuentas por Cobrar Clientes

UPDATE public.chart_of_accounts
   SET cuenta_control = 'proveedores'
 WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
   AND code      = '200001';   -- Cuentas por pagar

-- -----------------------------------------------------------------------------
-- PASO F — cuenta Anticipo de Clientes (Tarea 6)
-- -----------------------------------------------------------------------------
-- Pasivo corriente: plata cobrada por adelantado que todavía no es ingreso.
-- Código 200004, siguiendo la numeración de los pasivos corrientes existentes
-- (200001 por pagar, 200002 salarios, 200003 ITBMS).
--
-- WHERE NOT EXISTS en vez de ON CONFLICT para no depender del nombre del índice
-- único, que cambió de nombre entre bases.
INSERT INTO public.chart_of_accounts
  (tenant_id, code, name, account_type, subcategoria, saldo_inicial, active, is_trust_pass_through)
SELECT 'a0000000-0000-0000-0000-000000000001',
       '200004',
       'Anticipo de Clientes',
       'liability',
       'pasivo_corriente',
       0,
       true,
       false
 WHERE NOT EXISTS (
   SELECT 1 FROM public.chart_of_accounts
    WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
      AND code      = '200004'
 );

-- -----------------------------------------------------------------------------
-- PASO F-bis — red de seguridad antes del CHECK
-- -----------------------------------------------------------------------------
-- ⚠️ Sin esto, `apply-staging-sql.mjs --reset` falla.
--
-- El orden real de una base recreada es: migraciones PRIMERO, seed DESPUÉS. En
-- ese momento las únicas cuentas que existen son las ~34 que siembran las
-- migraciones base (20260505000002_finanzas_catalogos.sql), que nacen ACTIVAS y
-- con subcategoria=NULL. Las de tipo income/expense violarían el CHECK del paso
-- G y la migración abortaría.
--
-- Es `seed-staging.ts` quien después las desactiva, al cargar las 62 de Josuar.
-- Pero la migración no puede depender de que el seed haya corrido: tiene que
-- dejar la base consistente por sí sola.
--
-- Así que cualquier cuenta de resultado activa sin subcategoría NIIF 18 válida
-- se clasifica en la actividad de OPERACIÓN de su propio tipo. Es el default
-- correcto —todo lo que existe hoy es operativo— y no toca ninguna cuenta que
-- ya venga bien clasificada de los pasos C y D.
--
-- Contra la base de staging YA sembrada, este UPDATE afecta 0 filas.
UPDATE public.chart_of_accounts
   SET subcategoria = CASE account_type
                        WHEN 'income'  THEN 'ingresos_operativos'
                        WHEN 'cost'    THEN 'costos_operativos'
                        WHEN 'expense' THEN 'gastos_operativos'
                      END
 WHERE active
   AND account_type IN ('income', 'cost', 'expense')
   -- `subcategoria IS NULL` va aparte y PRIMERO: con NULL, cada IN evalúa a
   -- NULL, el OR de NULLs es NULL, y NOT NULL sigue siendo NULL — o sea que un
   -- NOT(...) pelado NO seleccionaría justamente las filas sin clasificar, que
   -- son las que hay que arreglar.
   AND (subcategoria IS NULL
        OR NOT (
              (account_type = 'income'  AND subcategoria IN
                ('ingresos_operativos', 'ingresos_inversion', 'ingresos_financiamiento'))
           OR (account_type = 'cost'    AND subcategoria IN
                ('costos_operativos',   'costos_inversion',   'costos_financiamiento'))
           OR (account_type = 'expense' AND subcategoria IN
                ('gastos_operativos',   'gastos_inversion',   'gastos_financiamiento'))
            ));

-- -----------------------------------------------------------------------------
-- PASO G — subcategoría OBLIGATORIA en cuentas de resultado activas
-- -----------------------------------------------------------------------------
-- Va DESPUÉS de C, D y F-bis: antes de migrar, las filas viejas no cumplirían.
--
-- Solo restringe el caso que importa. Una cuenta de resultado activa sin
-- subcategoría no se puede ubicar en ningún bloque de actividad del Estado de
-- Resultado: o se cae del reporte, o cae en "Sin clasificar" y el contador ve
-- un renglón que no reconoce. Las inactivas y las de balance quedan libres.
ALTER TABLE public.chart_of_accounts
  DROP CONSTRAINT IF EXISTS coa_resultado_subcategoria_niif18;

-- El CHECK es POR TIPO, no contra la lista de nueve entera: una cuenta de
-- ingreso con subcategoria='gastos_operativos' pasaría una lista plana y
-- rompería el Estado de Resultado igual que un NULL. Espeja exactamente
-- SUBCATEGORIAS_POR_TIPO de src/lib/finanzas/types/chart-of-account.ts.
ALTER TABLE public.chart_of_accounts
  ADD CONSTRAINT coa_resultado_subcategoria_niif18 CHECK (
    account_type NOT IN ('income', 'cost', 'expense')
    OR active = false
    OR (account_type = 'income'  AND subcategoria IN
         ('ingresos_operativos', 'ingresos_inversion', 'ingresos_financiamiento'))
    OR (account_type = 'cost'    AND subcategoria IN
         ('costos_operativos',   'costos_inversion',   'costos_financiamiento'))
    OR (account_type = 'expense' AND subcategoria IN
         ('gastos_operativos',   'gastos_inversion',   'gastos_financiamiento'))
  );

COMMIT;

-- =============================================================================
-- VERIFICACIÓN — aborta si algo no quedó como se espera
-- =============================================================================
DO $$
DECLARE
  v_tenant       uuid := 'a0000000-0000-0000-0000-000000000001';
  v_cost         int;
  v_ing_op       int;
  v_gas_op       int;
  v_cos_op       int;
  v_huerfanas    int;
  v_vocab_viejo  int;
  v_anticipo     int;
  v_control      int;
BEGIN
  SELECT COUNT(*) INTO v_cost    FROM public.chart_of_accounts
   WHERE tenant_id = v_tenant AND account_type = 'cost';
  SELECT COUNT(*) INTO v_ing_op  FROM public.chart_of_accounts
   WHERE tenant_id = v_tenant AND subcategoria = 'ingresos_operativos';
  SELECT COUNT(*) INTO v_gas_op  FROM public.chart_of_accounts
   WHERE tenant_id = v_tenant AND subcategoria = 'gastos_operativos';
  SELECT COUNT(*) INTO v_cos_op  FROM public.chart_of_accounts
   WHERE tenant_id = v_tenant AND subcategoria = 'costos_operativos';

  -- Cuentas de resultado ACTIVAS que quedaron sin clasificar (debe ser 0; el
  -- CHECK ya lo impide, esto es el cinturón además de los tirantes).
  SELECT COUNT(*) INTO v_huerfanas FROM public.chart_of_accounts
   WHERE tenant_id = v_tenant
     AND active
     AND account_type IN ('income', 'cost', 'expense')
     AND (subcategoria IS NULL
          OR NOT (
                (account_type = 'income'  AND subcategoria IN
                  ('ingresos_operativos', 'ingresos_inversion', 'ingresos_financiamiento'))
             OR (account_type = 'cost'    AND subcategoria IN
                  ('costos_operativos',   'costos_inversion',   'costos_financiamiento'))
             OR (account_type = 'expense' AND subcategoria IN
                  ('gastos_operativos',   'gastos_inversion',   'gastos_financiamiento'))
              ));

  -- Nadie quedó con el vocabulario viejo.
  SELECT COUNT(*) INTO v_vocab_viejo FROM public.chart_of_accounts
   WHERE tenant_id = v_tenant
     AND subcategoria IN ('ingreso', 'costo', 'gasto_operativo');

  SELECT COUNT(*) INTO v_anticipo FROM public.chart_of_accounts
   WHERE tenant_id = v_tenant AND code = '200004';

  SELECT COUNT(*) INTO v_control FROM public.chart_of_accounts
   WHERE tenant_id = v_tenant AND cuenta_control IS NOT NULL;

  RAISE NOTICE '— POST-CHECK NIIF 18 —';
  RAISE NOTICE 'account_type=cost .............. % (esperado 6)',  v_cost;
  RAISE NOTICE 'ingresos_operativos ............ % (esperado 9)',  v_ing_op;
  RAISE NOTICE 'gastos_operativos .............. % (esperado 30)', v_gas_op;
  RAISE NOTICE 'costos_operativos .............. % (esperado 6)',  v_cos_op;
  RAISE NOTICE 'resultado activas sin clasificar % (esperado 0)',  v_huerfanas;
  RAISE NOTICE 'vocabulario viejo restante ..... % (esperado 0)',  v_vocab_viejo;
  RAISE NOTICE 'Anticipo de Clientes ........... % (esperado 1)',  v_anticipo;
  RAISE NOTICE 'cuentas control marcadas ....... % (esperado 2)',  v_control;

  IF v_huerfanas > 0 THEN
    RAISE EXCEPTION 'ABORT: % cuenta(s) de resultado activas sin subcategoría NIIF 18', v_huerfanas;
  END IF;
  IF v_vocab_viejo > 0 THEN
    RAISE EXCEPTION 'ABORT: % cuenta(s) con el vocabulario viejo (ingreso/costo/gasto_operativo)', v_vocab_viejo;
  END IF;
  IF v_anticipo <> 1 THEN
    RAISE EXCEPTION 'ABORT: se esperaba 1 cuenta 200004 Anticipo de Clientes y hay %', v_anticipo;
  END IF;
END $$;

-- Foto del resultado, para pegar en el commit.
SELECT account_type,
       subcategoria,
       COUNT(*) AS cuentas,
       COUNT(*) FILTER (WHERE active) AS activas
FROM   public.chart_of_accounts
WHERE  tenant_id = 'a0000000-0000-0000-0000-000000000001'
GROUP  BY account_type, subcategoria
ORDER  BY account_type, subcategoria;

-- =============================================================================
-- ROLLBACK (descomentar solo si hay que revertir)
-- -----------------------------------------------------------------------------
-- ATENCIÓN: revertir el tipo 'cost' obliga a revertir también
-- accounting-reports.ts, o el Estado de Resultado queda mostrando 0 en costos.
-- =============================================================================
-- BEGIN;
-- ALTER TABLE public.chart_of_accounts DROP CONSTRAINT IF EXISTS coa_resultado_subcategoria_niif18;
-- UPDATE public.chart_of_accounts SET subcategoria='ingreso'
--  WHERE tenant_id='a0000000-0000-0000-0000-000000000001' AND subcategoria='ingresos_operativos';
-- UPDATE public.chart_of_accounts SET subcategoria='gasto_operativo'
--  WHERE tenant_id='a0000000-0000-0000-0000-000000000001' AND subcategoria='gastos_operativos';
-- UPDATE public.chart_of_accounts SET account_type='expense', subcategoria='costo'
--  WHERE tenant_id='a0000000-0000-0000-0000-000000000001' AND account_type='cost';
-- ALTER TABLE public.chart_of_accounts DROP CONSTRAINT IF EXISTS chart_of_accounts_account_type_check;
-- ALTER TABLE public.chart_of_accounts ADD CONSTRAINT chart_of_accounts_account_type_check
--   CHECK (account_type IN ('asset','liability','equity','income','expense'));
-- DELETE FROM public.chart_of_accounts
--  WHERE tenant_id='a0000000-0000-0000-0000-000000000001' AND code='200004';
-- ALTER TABLE public.chart_of_accounts DROP COLUMN IF EXISTS cuenta_control;
-- COMMIT;
-- =============================================================================
