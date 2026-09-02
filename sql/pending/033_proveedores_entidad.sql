-- ============================================================================
-- 033 — PROVEEDORES COMO ENTIDAD
-- ============================================================================
-- Pedido por Josuarth en la reunión del 25/08/2026. Textual, sobre el RUC:
--
--   "el tema del formato de RUC de los proveedores es bien importante porque eso
--    complica o facilita el trabajo al momento de hacer las declaraciones de
--    renta [...] que esté bien diferenciado el RUC en una columna y el DV en
--    otra columna porque así está en el formulario de la DGI, y el nombre en
--    otra columna, una pestaña de número proveedor para tener la secuencia"
--
-- Y sobre los términos de pago: "dentro del módulo de creación de proveedores
-- tenemos que añadir los términos de pago [...] porque esa información me va a
-- ayudar a llenar este reporte", hablando de la antigüedad.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 🔴 ESTA MIGRACIÓN VA A CORRER EN PRODUCCIÓN ALGÚN DÍA
-- ─────────────────────────────────────────────────────────────────────────────
-- `business_expenses` YA TIENE DATOS REALES en producción, que no podemos ver
-- desde acá. Todo lo de abajo está escrito para no romper nada que no conozcamos:
--
--   · Es IDEMPOTENTE: se puede correr dos veces sin efecto adicional.
--   · Es TRANSACCIONAL: o entra completa o no entra nada.
--   · NO BORRA NADA. `supplier_name` y `supplier_ruc` quedan intactas como
--     respaldo. Eliminarlas es un commit posterior, después de verificar.
--   · `supplier_id` es NULLABLE. Hacerlo obligatorio rompería los gastos que ya
--     existen sin proveedor.
--   · NO hay UNIQUE sobre el RUC. Si en producción dos nombres distintos
--     comparten RUC, un UNIQUE haría fallar la migración entera. Se indexa para
--     buscar y se avisa en pantalla; deduplicar es decisión de una persona.
--   · Al final hay un ROLLBACK comentado que revierte todo.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- LA DEDUPLICACIÓN, Y POR QUÉ ES CONSERVADORA
-- ─────────────────────────────────────────────────────────────────────────────
-- Se agrupa por `lower(btrim(supplier_name))`: mismo texto ignorando mayúsculas
-- y espacios de los bordes. NO se normalizan tildes ni sufijos societarios, y la
-- razón es que fusionar de más es irreversible en la práctica: "FARMACIA ARROCHA"
-- y "FARMACIA ARROCHA CHITRÉ" pueden ser dos proveedores de verdad. Lo que quede
-- duplicado lo une una persona desde la ficha, que sabe cuál es cuál.
--
-- En staging (02/09/2026): 3 gastos, 3 nombres distintos, 0 duplicados por
-- cualquier criterio, 0 RUC cargados. La deduplicación acá es 1 a 1.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. LA TABLA
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.suppliers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,

  -- La "pestaña de número proveedor para tener la secuencia" que pidió Josuarth.
  supplier_number    text NOT NULL,

  -- Razón social (la del RUC) y razón comercial (con la que se la conoce).
  legal_name         text NOT NULL,
  trade_name         text,

  -- 🔴 RUC Y DV EN COLUMNAS SEPARADAS. Nunca concatenados, en ningún lado.
  -- Es el requisito literal de Josuarth: el formulario de la DGI los pide en
  -- columnas distintas y los anexos de renta se arman con eso.
  ruc                text,
  dv                 text,

  address            text,
  phone              text,
  email              text,

  -- El plazo del proveedor en días. 0 = contado. De acá sale la fecha de
  -- vencimiento del gasto, y de ahí los tramos de la antigüedad.
  -- No es un enum a propósito: "30, 60, 90" son los habituales, no los únicos.
  payment_terms_days integer NOT NULL DEFAULT 0,

  active             boolean NOT NULL DEFAULT true,
  notes              text,

  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Unicidad del correlativo por bufete. El RUC NO lleva UNIQUE — ver el
-- encabezado.
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_tenant_number_unique
  ON public.suppliers (tenant_id, supplier_number);

-- Dos proveedores con el mismo nombre exacto en el mismo bufete son un error de
-- carga, no un caso de negocio. Se compara igual que la deduplicación.
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_tenant_legal_name_unique
  ON public.suppliers (tenant_id, lower(btrim(legal_name)));

CREATE INDEX IF NOT EXISTS idx_suppliers_ruc
  ON public.suppliers (tenant_id, ruc) WHERE ruc IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_suppliers_active
  ON public.suppliers (tenant_id, active);

-- ---------------------------------------------------------------------------
-- 2. CHECKS — deliberadamente PERMISIVOS
-- ---------------------------------------------------------------------------
-- Un campo que rechaza un RUC legítimo es peor que uno permisivo: bloquea a la
-- persona que está cargando y no hay forma de saltearlo. Panamá tiene varias
-- familias de RUC conviviendo (cédulas 8-123-456, con prefijo PE/E/N,
-- jurídicos 155123456-2-2015, folios viejos). Acá NO se valida el formato del
-- RUC: solo su largo. El formato se comenta en pantalla, no se impone.
--
-- El DV sí se acota a dígitos, porque un dígito verificador es un número por
-- definición. Se aceptan 1 a 3 dígitos aunque el formulario de la DGI muestre 2,
-- para no rechazar un "5" escrito sin el cero delante.
DO $checks$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_legal_name_length') THEN
    ALTER TABLE public.suppliers ADD CONSTRAINT suppliers_legal_name_length
      CHECK (char_length(btrim(legal_name)) BETWEEN 2 AND 200);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_ruc_length') THEN
    ALTER TABLE public.suppliers ADD CONSTRAINT suppliers_ruc_length
      CHECK (ruc IS NULL OR char_length(btrim(ruc)) BETWEEN 1 AND 50);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_dv_format') THEN
    ALTER TABLE public.suppliers ADD CONSTRAINT suppliers_dv_format
      CHECK (dv IS NULL OR dv ~ '^[0-9]{1,3}$');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_payment_terms_range') THEN
    ALTER TABLE public.suppliers ADD CONSTRAINT suppliers_payment_terms_range
      CHECK (payment_terms_days BETWEEN 0 AND 365);
  END IF;
END
$checks$;

COMMENT ON COLUMN public.suppliers.ruc IS
  'RUC SIN el dígito verificador. Nunca se guarda concatenado con dv: los anexos de renta de la DGI los piden en columnas separadas.';
COMMENT ON COLUMN public.suppliers.dv IS
  'Dígito verificador del RUC, en su propia columna. Formato libre de 1 a 3 dígitos a propósito.';
COMMENT ON COLUMN public.suppliers.payment_terms_days IS
  'Plazo de pago en días; 0 = contado. Es el default de la fecha de vencimiento del gasto, no un tramo de la antigüedad.';

-- ---------------------------------------------------------------------------
-- 3. updated_at, RLS y permisos — copiados de business_expenses
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_suppliers_updated_at ON public.suppliers;
CREATE TRIGGER trg_suppliers_updated_at
  BEFORE UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS suppliers_select ON public.suppliers;
CREATE POLICY suppliers_select ON public.suppliers FOR SELECT
  USING (tenant_id = get_tenant_id()
         AND get_user_role() = ANY (ARRAY['admin','abogada','contador']));

DROP POLICY IF EXISTS suppliers_insert ON public.suppliers;
CREATE POLICY suppliers_insert ON public.suppliers FOR INSERT
  WITH CHECK (tenant_id = get_tenant_id()
              AND get_user_role() = ANY (ARRAY['admin','abogada','contador']));

DROP POLICY IF EXISTS suppliers_update ON public.suppliers;
CREATE POLICY suppliers_update ON public.suppliers FOR UPDATE
  USING (tenant_id = get_tenant_id()
         AND get_user_role() = ANY (ARRAY['admin','abogada','contador']))
  WITH CHECK (tenant_id = get_tenant_id()
              AND get_user_role() = ANY (ARRAY['admin','abogada','contador']));

DROP POLICY IF EXISTS suppliers_delete ON public.suppliers;
CREATE POLICY suppliers_delete ON public.suppliers FOR DELETE
  USING (tenant_id = get_tenant_id()
         AND get_user_role() = ANY (ARRAY['admin','abogada','contador']));

-- ---------------------------------------------------------------------------
-- 4. LA SECUENCIA PRV-NNN
-- ---------------------------------------------------------------------------
-- Se suma 'supplier' al CHECK de numbering_sequences y se siembra la fila por
-- bufete. Mismo mecanismo atómico que clientes, facturas y cotizaciones.
ALTER TABLE public.numbering_sequences
  DROP CONSTRAINT IF EXISTS numbering_sequences_sequence_type_check;
ALTER TABLE public.numbering_sequences
  ADD CONSTRAINT numbering_sequences_sequence_type_check
  CHECK (sequence_type = ANY (ARRAY[
    'quote','invoice_hon','invoice_reim','credit_note','client','supplier'
  ]));

INSERT INTO public.numbering_sequences (tenant_id, sequence_type, last_number)
SELECT t.id, 'supplier', 0 FROM public.tenants t
ON CONFLICT (tenant_id, sequence_type) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. LAS COLUMNAS NUEVAS EN business_expenses
-- ---------------------------------------------------------------------------
-- supplier_id NULLABLE a propósito. ON DELETE SET NULL: borrar un proveedor no
-- puede borrar el historial de gastos.
ALTER TABLE public.business_expenses
  ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL;

-- La fecha de vencimiento que hoy no existe, y por la que la antigüedad de
-- cuentas por pagar se venía contando desde la fecha del gasto (más pesimista
-- que la real). Editable: el default sale del plazo del proveedor, pero un
-- comprobante puede decir otra cosa y manda el comprobante.
ALTER TABLE public.business_expenses
  ADD COLUMN IF NOT EXISTS due_date date;

CREATE INDEX IF NOT EXISTS idx_business_expenses_supplier
  ON public.business_expenses (tenant_id, supplier_id) WHERE supplier_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_business_expenses_due_date
  ON public.business_expenses (tenant_id, due_date) WHERE due_date IS NOT NULL;

COMMENT ON COLUMN public.business_expenses.supplier_id IS
  'Proveedor como entidad. NULLABLE: los gastos viejos pueden no tenerlo. supplier_name/supplier_ruc quedan como respaldo hasta verificar la migración.';
COMMENT ON COLUMN public.business_expenses.due_date IS
  'Vencimiento del gasto. Default = expense_date + plazo del proveedor, editable. Es la fecha con la que la antigüedad calcula los tramos.';

-- ---------------------------------------------------------------------------
-- 6. BACKFILL — crear los proveedores y enlazar los gastos
-- ---------------------------------------------------------------------------
-- Un proveedor por cada nombre distinto (ignorando mayúsculas y espacios de los
-- bordes), por bufete. El nombre que queda es el que MÁS VECES aparece escrito
-- así; a igualdad, el alfabéticamente primero, para que correr esto dos veces dé
-- siempre el mismo resultado.
WITH nombres AS (
  SELECT
    be.tenant_id,
    lower(btrim(be.supplier_name))                                   AS clave,
    btrim(be.supplier_name)                                          AS nombre,
    COUNT(*)                                                         AS veces,
    -- Si algún gasto ya traía RUC, se hereda el más antiguo cargado.
    (array_agg(btrim(be.supplier_ruc) ORDER BY be.created_at)
       FILTER (WHERE be.supplier_ruc IS NOT NULL
                 AND btrim(be.supplier_ruc) <> ''))[1]               AS ruc
  FROM public.business_expenses be
  WHERE be.supplier_name IS NOT NULL AND btrim(be.supplier_name) <> ''
  GROUP BY be.tenant_id, lower(btrim(be.supplier_name)), btrim(be.supplier_name)
),
canonicos AS (
  SELECT DISTINCT ON (tenant_id, clave)
         tenant_id, clave, nombre, ruc
    FROM nombres
   ORDER BY tenant_id, clave, veces DESC, nombre ASC
),
-- Solo los que todavía no existen: hace la migración re-ejecutable.
faltantes AS (
  SELECT c.*
    FROM canonicos c
   WHERE NOT EXISTS (
     SELECT 1 FROM public.suppliers s
      WHERE s.tenant_id = c.tenant_id
        AND lower(btrim(s.legal_name)) = c.clave
   )
),
numerados AS (
  SELECT f.*,
         ns.last_number + ROW_NUMBER() OVER (PARTITION BY f.tenant_id ORDER BY f.nombre) AS n
    FROM faltantes f
    JOIN public.numbering_sequences ns
      ON ns.tenant_id = f.tenant_id AND ns.sequence_type = 'supplier'
),
insertados AS (
  INSERT INTO public.suppliers (tenant_id, supplier_number, legal_name, ruc, payment_terms_days, active, notes)
  SELECT tenant_id,
         'PRV-' || lpad(n::text, 3, '0'),
         nombre,
         ruc,
         -- 0 = contado. NO se inventa un plazo: no sabemos el de estos
         -- proveedores, y suponerlo movería los tramos de la antigüedad sin
         -- que nadie lo haya decidido. Se carga cuando alguien lo sepa.
         0,
         true,
         'Creado automáticamente desde los gastos existentes (migración 033). Revisar RUC, DV y términos de pago.'
    FROM numerados
  RETURNING tenant_id
)
UPDATE public.numbering_sequences ns
   SET last_number = ns.last_number + sub.creados,
       updated_at  = now()
  FROM (SELECT tenant_id, COUNT(*) AS creados FROM insertados GROUP BY tenant_id) sub
 WHERE ns.tenant_id = sub.tenant_id AND ns.sequence_type = 'supplier';

-- Enlazar cada gasto con su proveedor, por el mismo criterio.
UPDATE public.business_expenses be
   SET supplier_id = s.id
  FROM public.suppliers s
 WHERE be.supplier_id IS NULL
   AND be.supplier_name IS NOT NULL
   AND s.tenant_id = be.tenant_id
   AND lower(btrim(s.legal_name)) = lower(btrim(be.supplier_name));

-- Vencimiento de los gastos que no lo tienen: fecha del gasto + plazo del
-- proveedor. Con los proveedores recién creados en contado (0), esto da
-- exactamente expense_date, así que LA ANTIGÜEDAD NO SE MUEVE con la migración.
-- Es lo que se quiere: primero migrar sin cambiar números, después cargar los
-- plazos reales y ahí sí ver moverse los tramos.
UPDATE public.business_expenses be
   SET due_date = be.expense_date + COALESCE(s.payment_terms_days, 0)
  FROM public.suppliers s
 WHERE be.due_date IS NULL AND be.supplier_id = s.id;

-- Los gastos sin proveedor tampoco pierden el vencimiento: se les asume contado.
UPDATE public.business_expenses
   SET due_date = expense_date
 WHERE due_date IS NULL;

COMMIT;

-- ============================================================================
-- ROLLBACK — revierte esta migración por completo.
-- Descomentar y correr. Nada de lo de arriba destruye datos, así que volver
-- atrás solo tira lo que la migración agregó.
-- ============================================================================
-- BEGIN;
--   ALTER TABLE public.business_expenses DROP COLUMN IF EXISTS supplier_id;
--   ALTER TABLE public.business_expenses DROP COLUMN IF EXISTS due_date;
--   DROP TABLE IF EXISTS public.suppliers CASCADE;
--   DELETE FROM public.numbering_sequences WHERE sequence_type = 'supplier';
--   ALTER TABLE public.numbering_sequences
--     DROP CONSTRAINT IF EXISTS numbering_sequences_sequence_type_check;
--   ALTER TABLE public.numbering_sequences
--     ADD CONSTRAINT numbering_sequences_sequence_type_check
--     CHECK (sequence_type = ANY (ARRAY[
--       'quote','invoice_hon','invoice_reim','credit_note','client'
--     ]));
-- COMMIT;
