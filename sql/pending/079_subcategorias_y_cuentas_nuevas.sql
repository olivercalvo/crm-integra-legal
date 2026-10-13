-- ============================================================================
-- 079 — Plan de cuentas, parte técnica (Bloque 1, E6, punto 8 del plan)
-- ============================================================================
-- Pedido de Oliver del 01/10/2026, sobre la revisión de Josuarth:
--
--   1. La subcategoría pasa a ser OBLIGATORIA también en las cuentas de BALANCE
--      activas (antes sólo en resultado, CHECK de la 025).
--   2. Sale `depreciacion_acumulada` como subcategoría: la depreciación es una
--      cuenta de PPE con saldo acreedor y resta DENTRO de PPE en el Balance.
--   3. El patrimonio se abre en tres: capital_social, resultados_acumulados y
--      otras_reservas. Sale `patrimonio`.
--   4. Cuenta de ingreso de Familia: 400009 «Derecho de Familia», y HON-FAM
--      apunta a ella (en staging apuntaba a 400004 por un script de datos; en
--      producción sigue en la 4101 inactiva).
--   5. Otros ingresos: cuenta 440001 «Otros ingresos» y servicio OTR-ING.
--
-- 🟡 EL MAPA CUENTA POR CUENTA ES DE JOSUARTH (P-8a) Y NO LLEGÓ. Esta migración
--    NO aborta por eso: asigna un VALOR POR DEFECTO a cada cuenta activa de
--    balance que no tenga una subcategoría válida, lo INFORMA con un NOTICE por
--    cuenta, y la subcategoría se corrige en Configuración, Plan de Cuentas
--    (admin y contador). La regla por defecto es la MISMA que
--    `subcategoriaPorDefecto()` (types/chart-of-account.ts), que usa la
--    importación de cuentas:
--      · activo: activo_corriente; con «depr.», «depreci» o «amortiz» en el nombre, PPE
--      · pasivo: pasivo_corriente
--      · patrimonio: 300001 o «capital» → capital_social;
--                    300002, 300003 o «utilidad / pérdida / resultado / retenid»
--                    → resultados_acumulados; el resto → otras_reservas
--    Los códigos (400009, 440001) y la subcategoría de los ingresos nuevos
--    (ingresos_operativos) también son propuestas: P-8b y P-8c.
--
-- · OTR-ING es `service_type = 'honorarios'` (factura de honorarios, tipo 01),
--   no 'otro': la regla de consistencia de la factura (SOP-029) sólo deja
--   servicios de honorarios en una factura FAC-HON.
-- · HON-OTROS pasa a 440001 SÓLO si su cuenta actual está inactiva o no existe
--   (en staging y en producción apunta a la 4101 inactiva, que no se puede
--   facturar). Si alguien ya le puso una cuenta activa, no se toca.
-- · Las cuentas INACTIVAS no se exigen (como en la 025), pero las que tengan un
--   valor que ya no existe (`patrimonio`, `depreciacion_acumulada`) también se
--   pasan al nuevo: así no queda un valor fantasma que nadie puede elegir.
-- · No toca el libro. Sólo catálogo.
--
-- Idempotente: correrla dos veces no cambia nada la segunda.
-- ============================================================================
BEGIN;

-- ── 1. Backfill de subcategorías de balance ────────────────────────────────
DO $$
DECLARE
  r        record;
  v_nueva  text;
  v_nombre text;
  v_n      int := 0;
BEGIN
  FOR r IN
    SELECT coa.id, coa.tenant_id, coa.code, coa.name, coa.account_type, coa.subcategoria, coa.active
      FROM public.chart_of_accounts coa
     WHERE coa.account_type IN ('asset', 'liability', 'equity')
       AND (
         -- activas sin una subcategoría válida para su tipo
         (coa.active AND NOT (
              (coa.account_type = 'asset'     AND coa.subcategoria IN ('activo_corriente', 'activo_no_corriente', 'propiedad_planta_equipo', 'otro'))
           OR (coa.account_type = 'liability' AND coa.subcategoria IN ('pasivo_corriente', 'pasivo_no_corriente', 'otro'))
           OR (coa.account_type = 'equity'    AND coa.subcategoria IN ('capital_social', 'resultados_acumulados', 'otras_reservas'))
         ) OR (coa.active AND coa.subcategoria IS NULL))
         -- o cualquiera con un valor que dejó de existir
         OR coa.subcategoria IN ('patrimonio', 'depreciacion_acumulada')
         -- o una de patrimonio con 'otro' (ya no se ofrece para patrimonio)
         OR (coa.account_type = 'equity' AND coa.subcategoria = 'otro')
       )
     ORDER BY coa.tenant_id, coa.code
  LOOP
    v_nombre := lower(translate(r.name, 'ÁÉÍÓÚáéíóúÑñ', 'AEIOUaeiouNn'));
    IF r.account_type = 'asset' THEN
      v_nueva := CASE WHEN r.subcategoria = 'depreciacion_acumulada'
                        OR v_nombre ~ '(depr\.|depreci|amortiz)' THEN 'propiedad_planta_equipo'
                      ELSE 'activo_corriente' END;
    ELSIF r.account_type = 'liability' THEN
      v_nueva := 'pasivo_corriente';
    ELSE
      v_nueva := CASE
        WHEN r.code = '300001' OR v_nombre ~ 'capital' THEN 'capital_social'
        WHEN r.code IN ('300002', '300003') OR v_nombre ~ '(utilidad|perdida|resultado|retenid)' THEN 'resultados_acumulados'
        ELSE 'otras_reservas'
      END;
    END IF;

    UPDATE public.chart_of_accounts SET subcategoria = v_nueva WHERE id = r.id;
    v_n := v_n + 1;
    RAISE NOTICE '079: % «%» (%): % → % (valor por defecto, se corrige en el Plan de Cuentas)',
      r.code, r.name, CASE WHEN r.active THEN 'activa' ELSE 'inactiva' END,
      coalesce(r.subcategoria, 'sin subcategoría'), v_nueva;
  END LOOP;
  RAISE NOTICE '079: % cuenta(s) de balance con subcategoría por defecto', v_n;
END $$;

-- ── 2. El CHECK por tipo, para los SEIS tipos (cuentas activas) ────────────
-- Reemplaza al de la 025 (que sólo miraba resultado): las nueve de NIIF 18 se
-- conservan textuales. Espeja SUBCATEGORIAS_POR_TIPO.
ALTER TABLE public.chart_of_accounts DROP CONSTRAINT IF EXISTS coa_resultado_subcategoria_niif18;
ALTER TABLE public.chart_of_accounts DROP CONSTRAINT IF EXISTS coa_subcategoria_por_tipo;
ALTER TABLE public.chart_of_accounts
  ADD CONSTRAINT coa_subcategoria_por_tipo CHECK (
    active = false
    OR (account_type = 'asset'     AND subcategoria IN ('activo_corriente', 'activo_no_corriente', 'propiedad_planta_equipo', 'otro'))
    OR (account_type = 'liability' AND subcategoria IN ('pasivo_corriente', 'pasivo_no_corriente', 'otro'))
    OR (account_type = 'equity'    AND subcategoria IN ('capital_social', 'resultados_acumulados', 'otras_reservas'))
    OR (account_type = 'income'    AND subcategoria IN ('ingresos_operativos', 'ingresos_inversion', 'ingresos_financiamiento'))
    OR (account_type = 'cost'      AND subcategoria IN ('costos_operativos', 'costos_inversion', 'costos_financiamiento'))
    OR (account_type = 'expense'   AND subcategoria IN ('gastos_operativos', 'gastos_inversion', 'gastos_financiamiento'))
  );

-- ── 3. Cuentas nuevas: Familia y otros ingresos ────────────────────────────
-- En cada bufete que ya tiene plan de cuentas (el de Integra trae la 400001).
INSERT INTO public.chart_of_accounts (tenant_id, code, name, account_type, subcategoria, active)
SELECT DISTINCT coa.tenant_id, '400009', 'Derecho de Familia', 'income', 'ingresos_operativos', true
  FROM public.chart_of_accounts coa WHERE coa.code = '400001'
ON CONFLICT (tenant_id, code) DO NOTHING;

INSERT INTO public.chart_of_accounts (tenant_id, code, name, account_type, subcategoria, active)
SELECT DISTINCT coa.tenant_id, '440001', 'Otros ingresos', 'income', 'ingresos_operativos', true
  FROM public.chart_of_accounts coa WHERE coa.code = '400001'
ON CONFLICT (tenant_id, code) DO NOTHING;

-- ── 4. Servicios ───────────────────────────────────────────────────────────
-- HON-FAM → 400009 (si la cuenta existe en ese bufete).
UPDATE public.services_catalog sc
   SET revenue_account = '400009'
 WHERE sc.code = 'HON-FAM'
   AND sc.revenue_account IS DISTINCT FROM '400009'
   AND EXISTS (SELECT 1 FROM public.chart_of_accounts c
                WHERE c.tenant_id = sc.tenant_id AND c.code = '400009' AND c.active);

-- HON-OTROS → 440001 sólo si su cuenta actual está inactiva o no existe.
UPDATE public.services_catalog sc
   SET revenue_account = '440001'
 WHERE sc.code = 'HON-OTROS'
   AND NOT EXISTS (SELECT 1 FROM public.chart_of_accounts c
                    WHERE c.tenant_id = sc.tenant_id AND c.code = sc.revenue_account AND c.active)
   AND EXISTS (SELECT 1 FROM public.chart_of_accounts c
                WHERE c.tenant_id = sc.tenant_id AND c.code = '440001' AND c.active);

-- OTR-ING: en cada bufete que tenga catálogo de servicios, la cuenta 440001 y
-- la tasa ITBMS_7.
INSERT INTO public.services_catalog (tenant_id, code, name, service_type, revenue_account, default_tax_code, active, sort_order)
SELECT DISTINCT sc.tenant_id, 'OTR-ING', 'Otros ingresos', 'honorarios', '440001', 'ITBMS_7', true, 65
  FROM public.services_catalog sc
 WHERE EXISTS (SELECT 1 FROM public.chart_of_accounts c WHERE c.tenant_id = sc.tenant_id AND c.code = '440001')
   AND EXISTS (SELECT 1 FROM public.tax_codes t WHERE t.tenant_id = sc.tenant_id AND t.code = 'ITBMS_7')
ON CONFLICT (tenant_id, code) DO NOTHING;

-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE
  v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM public.chart_of_accounts
   WHERE subcategoria IN ('patrimonio', 'depreciacion_acumulada');
  IF v_n > 0 THEN
    RAISE EXCEPTION '079: quedan % cuenta(s) con una subcategoría que ya no existe', v_n;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coa_subcategoria_por_tipo') THEN
    RAISE EXCEPTION '079: falta el CHECK coa_subcategoria_por_tipo';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coa_resultado_subcategoria_niif18') THEN
    RAISE EXCEPTION '079: sigue el CHECK viejo de la 025';
  END IF;
  -- Cada bufete con plan de Integra tiene las dos cuentas nuevas.
  SELECT count(*) INTO v_n
    FROM (SELECT DISTINCT coa.tenant_id FROM public.chart_of_accounts coa WHERE coa.code = '400001') b
   WHERE NOT EXISTS (SELECT 1 FROM public.chart_of_accounts c WHERE c.tenant_id = b.tenant_id AND c.code = '400009')
      OR NOT EXISTS (SELECT 1 FROM public.chart_of_accounts c WHERE c.tenant_id = b.tenant_id AND c.code = '440001');
  IF v_n > 0 THEN
    RAISE EXCEPTION '079: % bufete(s) sin la 400009 o la 440001', v_n;
  END IF;
  -- HON-FAM ya no puede quedar en una cuenta inactiva si existe la de Familia.
  SELECT count(*) INTO v_n
    FROM public.services_catalog sc
   WHERE sc.code = 'HON-FAM' AND sc.revenue_account <> '400009'
     AND EXISTS (SELECT 1 FROM public.chart_of_accounts c WHERE c.tenant_id = sc.tenant_id AND c.code = '400009' AND c.active);
  IF v_n > 0 THEN
    RAISE EXCEPTION '079: HON-FAM no quedó en 400009 en % bufete(s)', v_n;
  END IF;
  RAISE NOTICE '079 ✅ subcategoría obligatoria en los seis tipos; 400009, 440001, HON-FAM y OTR-ING listos';
END $$;

COMMIT;
