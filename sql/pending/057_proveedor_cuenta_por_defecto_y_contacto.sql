-- ============================================================================
-- 057 — CUENTA CONTABLE POR DEFECTO Y PERSONA DE CONTACTO DEL PROVEEDOR
-- ============================================================================
--
-- Bloque 8 (23/09/2026). Dos pedidos de Josuarth que caen en la misma tabla, y
-- por eso van en la misma migración: `suppliers` gana cuatro columnas, todas
-- OPCIONALES y todas aditivas. No se toca ninguna columna existente, no hay
-- backfill y no hay dato que se pueda perder.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 1) `default_chart_account_code` — la cuenta por defecto (4.4, estilo QuickBooks)
-- ─────────────────────────────────────────────────────────────────────────────
-- Josuarth: "al crear el proveedor se le asigna una cuenta (la compañía de luz
-- siempre va a Electricidad). Esa cuenta aparece por defecto en cada línea de
-- compra de ese proveedor, pero se puede cambiar en la línea, y también en la
-- ficha del proveedor."
--
-- 🔴 APLICA SOLO A COMPRAS (`business_expenses`). EN GASTOS DE TRÁMITE NO.
--    Está decidido (D2, 23/09/2026) y el motivo es aritmético, no de gusto.
--    Se escribe acá, en el SOP (SOP-036) y en `types/supplier.ts` porque es
--    exactamente el tipo de cosa que alguien "unifica" dentro de seis meses:
--
--    a) El default de trámite es `130003 Fondo Legales de Clientes`, que es un
--       **ACTIVO** (verificado contra `chart_of_accounts`: `account_type='asset'`).
--       La regla que el propio Josuarth puso para esta columna —"tiene que ser
--       de gasto o costo"— vuelve ESTRUCTURALMENTE IMPOSIBLE que la cuenta de un
--       proveedor sea `130003`. O sea que un default de proveedor no podría
--       nunca reproducir el default correcto de trámite: sólo reemplazarlo por
--       uno equivocado.
--
--    b) 🔴 ROMPERÍA EL PAR `130003` / `REIM-*`. Un gasto de trámite es plata que
--       el bufete ADELANTA POR UN CLIENTE: DEBE `130003` al incurrirlo, y la
--       factura de reembolso (`REIM-*`) ACREDITA `130003` al recuperarla. Los
--       dos lados tienen que cerrar — `asiento-factura.ts` lo dice textual:
--       "si divergen, el saldo de 130003 deja de cerrar". Si la cuenta del
--       proveedor pisara ese default, un adelanto recuperable se convertiría en
--       silencio en un gasto propio del bufete, el activo nunca se debitaría y
--       la factura de reembolso acreditaría contra un saldo que no existe.
--
--    c) El MISMO proveedor cae de los dos lados. Una mensajería puede ser un
--       trámite adelantado por un cliente Y un gasto de oficina del bufete. Un
--       solo default no puede estar bien para los dos casos.
--
--    Si algún día lo quieren también en trámite, la forma correcta es una
--    SEGUNDA columna (`default_chart_account_code_tramite`), nunca reusar ésta.
--
-- 🔴 FK LÓGICO, SIN CONSTRAINT — y acá sí se puede afirmar por qué es seguro.
--    Es el mismo patrón de `business_expenses.chart_account_code` y
--    `expense_lines.chart_account_code`. El riesgo clásico de un FK lógico es que
--    renombren la clave y el puntero quede huérfano en silencio; acá ese riesgo
--    NO existe: `updateChartAccount` (`api/chart-of-accounts.ts`) **rechaza
--    cambiar el `code` de cualquier cuenta**, con este texto: "El CÓDIGO es
--    INMUTABLE para TODAS las cuentas […] Si el código está mal, se desactiva la
--    cuenta y se crea una nueva."
--
--    Lo que SÍ puede pasar es que la cuenta se desactive o la reclasifiquen a un
--    tipo que ya no sirve. Para eso la decisión es **DEGRADAR, no bloquear**
--    (D3): la línea se precarga vacía y la pantalla avisa. Un FK real no cubriría
--    ninguno de esos dos casos —no miran `active` ni `account_type`— y a cambio
--    agregaría un modo de falla nuevo: no poder borrar una cuenta.
--
--    La validación de "gasto o costo y activa" vive en la app, con un predicado
--    PROPIO y estricto (`esCuentaValidaComoDefaultDeProveedor`), separado a
--    propósito de `esTipoValidoParaGasto`, que permite `asset` justamente para
--    que `130003` sea legal en trámite.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 2) `contact_name` / `contact_phone` / `contact_email` — la persona (4.1)
-- ─────────────────────────────────────────────────────────────────────────────
-- `suppliers` YA tiene `phone` y `email` desde la `033`. Son los de la EMPRESA
-- y se quedan como están. Estas tres son los de la PERSONA con la que se habla:
-- la central del proveedor y el celular del ejecutivo de cuenta no son el mismo
-- número, y el día que difieran habría que migrar igual (D6).
--
-- Del correo se valida el LARGO, no el formato. Mismo criterio que el RUC en la
-- `033`: un validador estricto rechaza direcciones legítimas y deja a alguien
-- sin poder cargar. El formato se avisa en pantalla.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- IDEMPOTENTE. Re-ejecutable: cada columna y cada CHECK se crean sólo si faltan.
-- APLICACIÓN: staging por `node scripts/run-sql.mjs`. Producción: NO, sólo por
--             merge a `main`. Va en la cola del despliegue DESPUÉS de la `033`
--             (que crea `suppliers`); no depende de ninguna otra.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_agregadas int := 0;
BEGIN
  IF to_regclass('public.suppliers') IS NULL THEN
    RAISE EXCEPTION
      'No existe `suppliers`. Aplicar primero sql/pending/033_proveedores_entidad.sql.';
  END IF;

  -- ---- 1) Las cuatro columnas ----------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='suppliers'
       AND column_name='default_chart_account_code'
  ) THEN
    ALTER TABLE public.suppliers ADD COLUMN default_chart_account_code text NULL;
    v_agregadas := v_agregadas + 1;
    RAISE NOTICE '057: columna `default_chart_account_code` agregada.';
  ELSE
    RAISE NOTICE '057: `default_chart_account_code` ya existía; no se toca.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='suppliers' AND column_name='contact_name'
  ) THEN
    ALTER TABLE public.suppliers ADD COLUMN contact_name text NULL;
    v_agregadas := v_agregadas + 1;
    RAISE NOTICE '057: columna `contact_name` agregada.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='suppliers' AND column_name='contact_phone'
  ) THEN
    ALTER TABLE public.suppliers ADD COLUMN contact_phone text NULL;
    v_agregadas := v_agregadas + 1;
    RAISE NOTICE '057: columna `contact_phone` agregada.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='suppliers' AND column_name='contact_email'
  ) THEN
    ALTER TABLE public.suppliers ADD COLUMN contact_email text NULL;
    v_agregadas := v_agregadas + 1;
    RAISE NOTICE '057: columna `contact_email` agregada.';
  END IF;

  RAISE NOTICE '057: % columna(s) nueva(s) de 4 posibles.', v_agregadas;
END $$;

-- ---- 2) Los CHECK, re-declarados completos --------------------------------
-- Se dropean y se recrean enteros en vez de agregarse condicionalmente: así el
-- archivo DICE cuál es la regla vigente, en vez de describir un delta contra un
-- estado anterior que hay que ir a buscar. Son CHECK nuevos (ninguno existía
-- antes de esta migración) y validan sobre cero filas: todas las columnas
-- acaban de nacer en NULL.

ALTER TABLE public.suppliers
  DROP CONSTRAINT IF EXISTS suppliers_default_account_length;
ALTER TABLE public.suppliers
  ADD CONSTRAINT suppliers_default_account_length CHECK (
    default_chart_account_code IS NULL
    OR char_length(btrim(default_chart_account_code)) BETWEEN 1 AND 20
  );

ALTER TABLE public.suppliers
  DROP CONSTRAINT IF EXISTS suppliers_contact_name_length;
ALTER TABLE public.suppliers
  ADD CONSTRAINT suppliers_contact_name_length CHECK (
    contact_name IS NULL OR char_length(btrim(contact_name)) BETWEEN 2 AND 120
  );

ALTER TABLE public.suppliers
  DROP CONSTRAINT IF EXISTS suppliers_contact_phone_length;
ALTER TABLE public.suppliers
  ADD CONSTRAINT suppliers_contact_phone_length CHECK (
    contact_phone IS NULL OR char_length(btrim(contact_phone)) BETWEEN 3 AND 50
  );

ALTER TABLE public.suppliers
  DROP CONSTRAINT IF EXISTS suppliers_contact_email_length;
ALTER TABLE public.suppliers
  ADD CONSTRAINT suppliers_contact_email_length CHECK (
    contact_email IS NULL OR char_length(btrim(contact_email)) BETWEEN 5 AND 200
  );

-- ---- 3) Comentarios --------------------------------------------------------
COMMENT ON COLUMN public.suppliers.default_chart_account_code IS
  'Cuenta contable que se precarga en cada línea de COMPRA nueva de este proveedor (4.4, Bloque 8). FK LÓGICO a chart_of_accounts(code) — seguro porque el código de una cuenta es inmutable (updateChartAccount lo rechaza). 🔴 SOLO COMPRAS: en gastos de trámite el default sigue siendo 130003, y no se unifica — rompería el par 130003 / REIM-*. Ver el encabezado de la 057 y sop.md SOP-036. La regla "gasto o costo y activa" la valida la app con un predicado propio; si la cuenta deja de servir, la pantalla DEGRADA (precarga vacía + aviso), no bloquea.';

COMMENT ON COLUMN public.suppliers.contact_name IS
  'Nombre de la persona de contacto en el proveedor (4.1, Bloque 8). Opcional. Distinta de `legal_name`, que es la empresa.';

COMMENT ON COLUMN public.suppliers.contact_phone IS
  'Teléfono de la PERSONA de contacto. Distinto de `suppliers.phone`, que es el de la empresa (la central). Opcional.';

COMMENT ON COLUMN public.suppliers.contact_email IS
  'Correo de la PERSONA de contacto. Distinto de `suppliers.email`, que es el de la empresa. Opcional. Se valida el LARGO, no el formato: mismo criterio que el RUC en la 033.';

COMMIT;

-- ============================================================================
-- VERIFICACIÓN — aborta si algo no quedó como se espera
-- ============================================================================
DO $$
DECLARE
  v_cols  int;
  v_check int;
  v_nulls int;
BEGIN
  SELECT count(*) INTO v_cols
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='suppliers'
     AND column_name IN ('default_chart_account_code','contact_name','contact_phone','contact_email');

  SELECT count(*) INTO v_check
    FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid
   WHERE r.relname='suppliers' AND c.contype='c'
     AND c.conname IN ('suppliers_default_account_length','suppliers_contact_name_length',
                       'suppliers_contact_phone_length','suppliers_contact_email_length');

  -- Ninguna columna existente cambió: todas las nuevas nacen en NULL.
  SELECT count(*) INTO v_nulls FROM public.suppliers
   WHERE default_chart_account_code IS NOT NULL OR contact_name IS NOT NULL
      OR contact_phone IS NOT NULL OR contact_email IS NOT NULL;

  RAISE NOTICE '─────────────────────────────────';
  RAISE NOTICE '057 — VERIFICACIÓN';
  RAISE NOTICE '  columnas nuevas ....... % (esperado 4)', v_cols;
  RAISE NOTICE '  CHECK nuevos .......... % (esperado 4)', v_check;
  RAISE NOTICE '  filas con dato ........ % (esperado 0 en la 1ª pasada)', v_nulls;
  RAISE NOTICE '─────────────────────────────────';

  IF v_cols <> 4 THEN
    RAISE EXCEPTION '057: faltan columnas (% de 4).', v_cols;
  END IF;
  IF v_check <> 4 THEN
    RAISE EXCEPTION '057: faltan CHECK (% de 4).', v_check;
  END IF;
END $$;
