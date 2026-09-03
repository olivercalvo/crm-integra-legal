-- ============================================================================
-- 035 — EL REEMBOLSO APUNTA A 130003, NO A 2201
-- ============================================================================
-- Decisión del acta de la reunión del 25/08/2026, textual en la lista de
-- "decisiones ya tomadas, no volver a preguntar":
--
--   "Reembolso al facturar: HABER 130003, nunca ingreso."
--
-- Los seis servicios `REIM-*` del catálogo apuntan a `2201 Cuentas por pagar a
-- clientes` desde que se sembraron:
--
--   · 20260505000002_finanzas_catalogos.sql:202-203  → REIM-GOB, REIM-OTH
--   · sql/pending/012:112-115                        → REIM-NOT, REIM-TIM,
--                                                       REIM-REG, REIM-ADM
--
-- Esta migración los mueve a `130003 Fondo Legales de Clientes`.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUÉ NO ES UN DETALLE DE NOMENCLATURA: SON DOS LADOS DEL BALANCE
-- ─────────────────────────────────────────────────────────────────────────────
-- `2201` es un PASIVO (`is_trust_pass_through = true`) y `130003` es un ACTIVO.
-- No es el mismo asiento con otro nombre: acreditar un pasivo lo AUMENTA y
-- acreditar un activo lo DISMINUYE.
--
-- El acta decidió dos cosas que forman un par, y solo cierran si el reembolso
-- vive del lado del activo:
--
--   Al incurrir el gasto de trámite:  DEBE 130003  /  HABER Cuentas por Pagar
--   Al facturar el reembolso:         DEBE CxC     /  HABER 130003
--
-- O sea: el bufete adelanta plata por el cliente (el activo 130003 sube), y
-- cuando le factura ese reembolso el activo se cancela contra la cuenta por
-- cobrar. `130003` vuelve a cero y la plata que el cliente debe queda ENTERA en
-- CxC, sin pasar nunca por una cuenta de ingreso. Con `2201` en su lugar, el
-- reembolso facturado INFLARÍA un pasivo en vez de cancelar el adelanto, y el
-- trust fund quedaría contado dos veces.
--
-- El modelo viejo (`2201`) era el otro camino posible —tratar el fondo del
-- cliente como una deuda del bufete hacia él— y no es un error contable en
-- abstracto. Pero no es el que eligió RM, y **conviven mal**: hay que elegir uno.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ESTE ARCHIVO CORRIGE UNA INCONSISTENCIA QUE YA ESTABA EN EL REPO
-- ─────────────────────────────────────────────────────────────────────────────
-- El acta ya se había respetado en los scripts que siembran el ledger:
--
--   · scripts/seed-asientos.ts:163,183
--   · scripts/backfill-asientos-faltantes.mts:159-160
--
-- Los dos postean el reembolso contra `130003`. O sea: **los asientos sembrados
-- están bien y el catálogo de servicios está mal.** Hasta hoy nadie lo notó
-- porque ninguna ruta de `/api` postea al ledger — `revenue_account` se lee
-- (`src/lib/finanzas/queries/catalogs.ts:80`) pero todavía nadie lo usa para
-- armar un asiento.
--
-- Por eso va ANTES del bloque de gastos de trámite: ese bloque postea
-- DEBE 130003, y no tiene sentido construirlo mientras el catálogo de servicios
-- apunta a otra cuenta para exactamente lo mismo.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ NO TOCA
-- ─────────────────────────────────────────────────────────────────────────────
--   · **Las facturas ya emitidas.** `revenue_account` NO se snapshotea en
--     `invoice_lines` (el snapshot ahí es `tax_code` / `tax_rate`, no la cuenta).
--     Se lee del catálogo en el momento de armar el asiento. Como todavía no hay
--     asientos armados desde una ruta, este UPDATE no reescribe ni un movimiento
--     contable existente. Es un cambio de configuración, no de datos históricos.
--   · **La cuenta `2201`.** Sigue existiendo, activa y con
--     `is_trust_pass_through = true`. Deja de ser el destino del reembolso; qué
--     pasa con su saldo es una decisión aparte.
--   · **`default_tax_code`.** Los REIM-* siguen en `EXENTO`, que es correcto: un
--     reembolso no genera ITBMS.
--   · **Los servicios `HON-*`.** Siguen apuntando a `4101`, que es una de las
--     dos definiciones que faltan del contador (¿qué cuenta de ingreso ACTIVA va
--     en cada servicio?). Esa fila sigue 🔒 y NO se toca acá a ciegas.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- EL GUARD, Y POR QUÉ HACE FALTA
-- ─────────────────────────────────────────────────────────────────────────────
-- `130003` NO viene de ninguna migración: entró por la importación del Excel de
-- las 62 cuentas de Josuar. En una base donde ese import no corrió, la cuenta no
-- existe, y `services_catalog` tiene un FK COMPUESTO
-- `(tenant_id, revenue_account) → chart_of_accounts(tenant_id, code)`
-- (`20260505000002:168-170`): el UPDATE fallaría con un error de constraint que
-- no dice nada útil.
--
-- El paso 1 lo chequea antes y aborta con un mensaje que se entiende.
--
-- IDEMPOTENCIA:
--   El UPDATE filtra por el valor viejo (`revenue_account = '2201'`), así que la
--   segunda corrida toca 0 filas. El guard sigue pasando. Re-ejecutable.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 🔴 ESTE ARCHIVO **NO** ESTÁ EN `BUNDLE_2`, Y ES A PROPÓSITO
-- ─────────────────────────────────────────────────────────────────────────────
-- El bundle de migraciones corre ANTES de `npm run seed:staging`, y la cuenta
-- `130003` la crea el seed. Si esto estuviera en el bundle, el guard del paso 1
-- abortaría en toda base recién reseteada.
--
-- La misma regla vive en DOS lugares, uno por cada situación:
--
--   · **Base que YA existe** (staging hoy, producción algún día) → ESTE archivo.
--   · **Base recién armada** (`--reset` + seed) →
--     `apuntarReembolsosAFondosLegales()` en `scripts/seed-staging.ts`.
--
-- 🔗 Si algún día cambia la cuenta del reembolso, HAY QUE MOVER LOS DOS.
--
-- APLICACIÓN:
--   Staging (base existente): correr este archivo a mano contra staging, DESPUÉS
--   de que el plan de cuentas esté cargado.
--   Staging (desde cero): no hace falta — lo deja bien el seed.
--   🔴 Producción: NO. Solo por merge a `main`, con aprobación explícita de
--   Oliver. En producción hay facturas de reembolso reales y el cambio de cuenta
--   tiene que revisarse con RM antes de aplicarse.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) GUARD — la cuenta destino tiene que existir para el tenant
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_tenant   uuid := 'a0000000-0000-0000-0000-000000000001';
  v_activa   boolean;
  v_tipo     text;
BEGIN
  SELECT active, account_type
    INTO v_activa, v_tipo
    FROM public.chart_of_accounts
   WHERE tenant_id = v_tenant
     AND code      = '130003';

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'La cuenta 130003 no existe para el tenant %. No vino de ninguna migración: entra con la importación del Excel de las 62 cuentas de Josuar. Corré ese import (o el seed del plan de cuentas) antes de esta migración.',
      v_tenant;
  END IF;

  -- No aborta: el FK se cumple igual con una cuenta inactiva. Pero los reportes
  -- filtran `active = true`, así que el reembolso desaparecería del Balance.
  IF NOT v_activa THEN
    RAISE WARNING
      'La cuenta 130003 existe pero está INACTIVA. El UPDATE va a funcionar, pero los reportes filtran active=true y el reembolso no se vería. Activala antes de postear.';
  END IF;

  IF v_tipo <> 'asset' THEN
    RAISE WARNING
      'La cuenta 130003 tiene account_type=% y se esperaba "asset". Revisá el plan antes de seguir: el par de asientos del acta solo cierra si es un activo.',
      v_tipo;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) ESTADO ANTES — queda en el log de la corrida
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_fila record;
BEGIN
  RAISE NOTICE '--- servicios de reembolso ANTES ---';
  FOR v_fila IN
    SELECT code, name, revenue_account
      FROM public.services_catalog
     WHERE tenant_id    = 'a0000000-0000-0000-0000-000000000001'
       AND service_type = 'reembolso'
     ORDER BY code
  LOOP
    RAISE NOTICE '  % (%) -> %', v_fila.code, v_fila.name, v_fila.revenue_account;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3) EL UPDATE
-- ---------------------------------------------------------------------------
-- Doble filtro a propósito: `service_type` dice QUÉ mover y `revenue_account`
-- da la idempotencia. Si algún día un servicio de reembolso se apunta a mano a
-- otra cuenta, esta migración no lo pisa.
UPDATE public.services_catalog
   SET revenue_account = '130003',
       updated_at      = NOW()
 WHERE tenant_id       = 'a0000000-0000-0000-0000-000000000001'
   AND service_type    = 'reembolso'
   AND revenue_account = '2201';

-- ---------------------------------------------------------------------------
-- 4) VERIFICACIÓN — si algo quedó en 2201, aborta y revierte
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_quedan  int;
  v_movidos int;
  v_fila    record;
BEGIN
  SELECT COUNT(*) INTO v_quedan
    FROM public.services_catalog
   WHERE tenant_id       = 'a0000000-0000-0000-0000-000000000001'
     AND service_type    = 'reembolso'
     AND revenue_account = '2201';

  IF v_quedan > 0 THEN
    RAISE EXCEPTION
      'Quedaron % servicios de reembolso apuntando a 2201. La migración no se aplica a medias.',
      v_quedan;
  END IF;

  SELECT COUNT(*) INTO v_movidos
    FROM public.services_catalog
   WHERE tenant_id       = 'a0000000-0000-0000-0000-000000000001'
     AND service_type    = 'reembolso'
     AND revenue_account = '130003';

  RAISE NOTICE '--- servicios de reembolso DESPUÉS ---';
  FOR v_fila IN
    SELECT code, name, revenue_account
      FROM public.services_catalog
     WHERE tenant_id    = 'a0000000-0000-0000-0000-000000000001'
       AND service_type = 'reembolso'
     ORDER BY code
  LOOP
    RAISE NOTICE '  % (%) -> %', v_fila.code, v_fila.name, v_fila.revenue_account;
  END LOOP;
  RAISE NOTICE 'OK: % servicios de reembolso apuntan a 130003.', v_movidos;
END $$;

-- ---------------------------------------------------------------------------
-- 5) OTROS TENANTS — solo avisa, no toca
-- ---------------------------------------------------------------------------
-- Hoy hay un solo tenant y las migraciones del repo lo hardcodean. Si algún día
-- se agrega otro, este aviso es lo que evita que su catálogo quede en el modelo
-- viejo sin que nadie se entere. No se corrige acá: el plan de cuentas de otro
-- bufete puede no tener una `130003`.
DO $$
DECLARE
  v_otros int;
BEGIN
  SELECT COUNT(DISTINCT tenant_id) INTO v_otros
    FROM public.services_catalog
   WHERE tenant_id    <> 'a0000000-0000-0000-0000-000000000001'
     AND service_type  = 'reembolso'
     AND revenue_account = '2201';

  IF v_otros > 0 THEN
    RAISE WARNING
      'Hay % tenant(s) más con servicios de reembolso apuntando a 2201. Esta migración NO los tocó: revisá el plan de cuentas de cada uno antes de moverlos.',
      v_otros;
  END IF;
END $$;

COMMIT;


-- ============================================================================
-- ROLLBACK (correr a mano si hace falta volver atrás)
-- ============================================================================
-- BEGIN;
-- UPDATE public.services_catalog
--    SET revenue_account = '2201', updated_at = NOW()
--  WHERE tenant_id       = 'a0000000-0000-0000-0000-000000000001'
--    AND service_type    = 'reembolso'
--    AND revenue_account = '130003';
-- COMMIT;
-- ============================================================================
