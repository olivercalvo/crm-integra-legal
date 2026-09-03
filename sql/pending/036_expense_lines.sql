-- ============================================================================
-- 036 — LÍNEAS DE GASTO. Un gasto deja de tener UNA cuenta y pasa a tener N.
-- ============================================================================
-- Pedido por Josuarth el 25/08/2026: "estructura encabezado + líneas, igual que
-- facturación". Lo que lo volvió urgente fue el hallazgo del 02/09: el gasto del
-- 15/03 del fixture se muestra bajo "Honorarios Profesionales $1.497,85" pero su
-- asiento lo parte en tres — útiles 412,35 / honorarios 900,00 / mensajería
-- 185,50. **El modelo de una cuenta por gasto no puede representar eso.**
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 🔴 ESTA MIGRACIÓN TOCA 128 GASTOS REALES DE LAS ABOGADAS
-- ─────────────────────────────────────────────────────────────────────────────
-- Pre-flight corrido por Oliver contra PRODUCCIÓN el 03/09/2026:
--
--     total ................. 128
--     cero_o_negativos ......   0
--     sin_concepto ..........   0
--     con_adjunto ...........  97   (76%)
--     min / max ............. 0.50 / 3,033.00
--
-- No son filas de prueba: son 128 gastos de trámite cargados a mano por las
-- licenciadas, **con 97 comprobantes escaneados detrás**. Eso cambia cómo hay
-- que leer todo lo que sigue. Cada decisión de abajo está tomada para que un
-- error acá no le haga perder a nadie un recibo del Registro Público que ya no
-- se puede volver a pedir.
--
-- Los dos números del pre-flight que deciden el esquema:
--
--   · `cero_o_negativos = 0` → el CHECK de la línea va **`amount > 0`**. Con un
--     solo gasto en 0 habría tenido que ser `>= 0`, y la migración habría
--     abortado a mitad el día del deploy.
--   · `sin_concepto = 0` → el backfill puede sacar `description` de `concept`
--     sin fallback, porque `expense_lines.description` es NOT NULL.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 🛡️ EL COMPROBANTE NO SE TOCA. NI UNA VEZ.
-- ─────────────────────────────────────────────────────────────────────────────
-- `receipt_url` y `receipt_filename` viven en el ENCABEZADO y ahí se quedan. Un
-- comprobante pertenece al documento, no a una línea: un recibo de 107 no se
-- parte en tres.
--
-- O sea que esta migración **no lee, no mueve y no re-referencia un solo objeto
-- de Storage**. El riesgo de perder un adjunto es cero por construcción, no por
-- cuidado. Aun así el paso 5 AFIRMA el número en el log: 97 antes, 97 después.
-- Un número verificado vale más que una promesa de diseño.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ **NO** HACE (y dónde va)
-- ─────────────────────────────────────────────────────────────────────────────
--   · **No dropea `expenses.amount`, ni lo vuelve derivado.** Conviven, y el
--     código escribe los dos. Es el patrón seguro de migración destructiva de
--     CLAUDE.md, la lección del Sprint 2E.1: agregar → backfill → refactorizar
--     → deploy y verificar producción → **y recién en un commit posterior**
--     volverlo derivado por trigger, como `invoices.grand_total` con T8c.
--   · **No amplía el CHECK de `journal_entries.source_type`** con
--     `'gasto_tramite'`, ni crea el trigger de inmutabilidad. Van en la `037`,
--     junto con la ruta que postea: un trigger sin posteo es código muerto y sin
--     probar. ⚠️ Al tocar ese CHECK, filtrar por su CONTENIDO y no solo por la
--     columna — hay DOS que mencionan `source_type` y la primera versión de la
--     `028` dropeó los dos (ver `029` y `sop.md` SOP-014).
--
-- IDEMPOTENCIA:
--   DDL con IF NOT EXISTS, backfill con WHERE NOT EXISTS, y un UNIQUE parcial
--   que rechaza una segunda línea 1 aunque el guard fallara. La segunda corrida
--   inserta 0 filas y las cinco verificaciones siguen pasando.
--
-- APLICACIÓN:
--   Staging: `node scripts/run-sql.mjs sql/pending/036_expense_lines.sql`
--   🔴 Producción: NO desde una máquina. Solo por merge a `main`, con backup
--   previo y con el pre-flight de arriba vuelto a correr el mismo día.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) FOTO DE ANTES — lo que las verificaciones del paso 5 van a comparar
-- ---------------------------------------------------------------------------
-- En una tabla temporal y no en variables porque cada bloque DO tiene su propio
-- alcance. `ON COMMIT DROP` la limpia sola.
CREATE TEMP TABLE _036_antes ON COMMIT DROP AS
SELECT
  COUNT(*)                                          AS gastos,
  COUNT(*) FILTER (WHERE receipt_url IS NOT NULL)    AS con_adjunto,
  COALESCE(ROUND(SUM(amount), 2), 0)                 AS suma
FROM public.expenses;

DO $$
DECLARE a record;
BEGIN
  SELECT * INTO a FROM _036_antes;
  RAISE NOTICE '--- ANTES: % gastos · % con comprobante · suma %',
    a.gastos, a.con_adjunto, a.suma;
END $$;

-- ---------------------------------------------------------------------------
-- 2) LA TABLA
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.expense_lines (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,

  -- ── EL ARCO EXCLUSIVO ────────────────────────────────────────────────────
  -- Dos FK nullables y un CHECK que exige exactamente una. Es lo que permite
  -- que gastos de trámite y compras del bufete compartan tabla, validador,
  -- editor y builder de asiento — compras entra sin esquema nuevo.
  --
  -- La alternativa polimórfica (`entity_type` + `entity_id`, como usa
  -- `documents`) se descartó: pierde el FK y el ON DELETE CASCADE, así que
  -- borrar un gasto dejaría líneas huérfanas que ningún constraint impide.
  expense_id          uuid NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  business_expense_id uuid NULL REFERENCES public.business_expenses(id) ON DELETE CASCADE,

  line_order          int  NOT NULL,
  description         text NOT NULL,

  -- ── 🔴 NULLABLE, Y ES UNA DECISIÓN ───────────────────────────────────────
  -- Las 128 líneas que crea el backfill del paso 4 quedan en NULL, NO en
  -- '130003'. Esos gastos se cargaron cuando el campo no existía: **nadie los
  -- clasificó nunca**, y algunos pudieron ser costo propio del bufete (500005)
  -- y no fondos de cliente. Escribirles el default del acta no sería aplicar un
  -- default: sería inventar un dato y darle la misma apariencia que a uno
  -- cargado por una persona.
  --
  -- Un comentario acá documenta la intención pero NO VIAJA CON LA FILA. Con
  -- NULL, el tipo de la app es `string | null` y **el builder del asiento no
  -- compila si no maneja el caso**: una línea sin clasificar no se puede
  -- postear por accidente. Y la consulta de limpieza
  -- (`WHERE chart_account_code IS NULL`) se vacía sola a medida que alguien
  -- clasifica — un flag `clasificacion_verificada` habría que acordarse de
  -- consultarlo.
  --
  -- Lo NUEVO nunca nace en NULL: lo exige `validators/expense-line.ts`, con un
  -- test que lo fija. El NOT NULL dejó de estar acá y pasó a estar ahí.
  --
  -- FK LÓGICO a `chart_of_accounts(code)`, SIN constraint — igual que
  -- `business_expenses.chart_account_code` (ver `010`). El código es inmutable
  -- por regla de la app (`api/chart-of-accounts.ts`), que es lo que lo sostiene.
  chart_account_code  text NULL,

  amount              numeric(12,2) NOT NULL,
  tax_rate            numeric(5,4)  NOT NULL DEFAULT 0,
  tax_amount          numeric(12,2) NOT NULL DEFAULT 0,
  -- Generada: es la que suma el asiento, y tiene que dar lo mismo en la base y
  -- en la app. Que la calcule un solo lado evita que diverjan.
  line_total          numeric(12,2) GENERATED ALWAYS AS (amount + tax_amount) STORED,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,

  CONSTRAINT expense_lines_un_solo_padre CHECK (
    (expense_id IS NOT NULL) <> (business_expense_id IS NOT NULL)
  ),
  -- `> 0` y no `>= 0` porque el pre-flight dio cero_o_negativos = 0 sobre los
  -- 128 gastos reales. Si alguna vez hay que aceptar un 0, es una migración
  -- aparte con su propio motivo escrito.
  CONSTRAINT expense_lines_amount_positivo   CHECK (amount > 0),
  CONSTRAINT expense_lines_tax_rate_rango    CHECK (tax_rate >= 0 AND tax_rate <= 1),
  CONSTRAINT expense_lines_tax_amount_nonneg CHECK (tax_amount >= 0),
  CONSTRAINT expense_lines_line_order_pos    CHECK (line_order >= 1),
  CONSTRAINT expense_lines_description_largo CHECK (char_length(btrim(description)) BETWEEN 3 AND 300)
);

-- El UNIQUE parcial es la tercera capa de la idempotencia: aunque el
-- `WHERE NOT EXISTS` del backfill estuviera mal escrito, no puede haber dos
-- líneas 1 para el mismo gasto. Mismo criterio que la `034`: el chequeo previo
-- da el mensaje, el índice es la garantía.
CREATE UNIQUE INDEX IF NOT EXISTS expense_lines_expense_order_unique
  ON public.expense_lines (expense_id, line_order) WHERE expense_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS expense_lines_compra_order_unique
  ON public.expense_lines (business_expense_id, line_order) WHERE business_expense_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_expense_lines_tenant  ON public.expense_lines (tenant_id);
CREATE INDEX IF NOT EXISTS idx_expense_lines_expense ON public.expense_lines (expense_id) WHERE expense_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_expense_lines_compra  ON public.expense_lines (business_expense_id) WHERE business_expense_id IS NOT NULL;
-- Para la pantalla "sin clasificar": son 128 filas hoy y el índice parcial se
-- achica solo a medida que las clasifican, hasta desaparecer.
CREATE INDEX IF NOT EXISTS idx_expense_lines_sin_clasificar
  ON public.expense_lines (tenant_id) WHERE chart_account_code IS NULL;

ALTER TABLE public.expense_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS expense_lines_tenant_isolation ON public.expense_lines;
CREATE POLICY expense_lines_tenant_isolation ON public.expense_lines
  FOR ALL USING (tenant_id = public.get_tenant_id());

DROP TRIGGER IF EXISTS trg_expense_lines_updated_at ON public.expense_lines;
CREATE TRIGGER trg_expense_lines_updated_at
  BEFORE UPDATE ON public.expense_lines
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

COMMENT ON TABLE public.expense_lines IS
  'Líneas de un gasto de trámite (expenses) O de una compra del bufete (business_expenses). Arco exclusivo: exactamente una de las dos FK.';
COMMENT ON COLUMN public.expense_lines.chart_account_code IS
  'FK lógico a chart_of_accounts(code). NULL = nadie la clasificó nunca (líneas del backfill de los 128 gastos históricos). No se le pone default a propósito: ver el encabezado de 036.';

-- ---------------------------------------------------------------------------
-- 3) COLUMNAS NUEVAS DEL ENCABEZADO — aditivas, nada se dropea
-- ---------------------------------------------------------------------------
ALTER TABLE public.expenses
  -- "Campo proveedor en el formulario de gasto de trámite" (acta 25/08). Va en
  -- el encabezado y no en la línea: un documento tiene un proveedor, y si hay
  -- dos son dos documentos.
  ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  -- "Fecha de vencimiento en el encabezado", textual del acta. Se precarga con
  -- `suppliers.payment_terms_days` y queda editable. Cambiar el plazo de un
  -- proveedor NO reescribe los vencimientos ya cargados.
  ADD COLUMN IF NOT EXISTS due_date date,
  -- "Campo de cuenta de la que sale el dinero, abierto" (Rose). El campo existe
  -- desde ahora; el asiento del PAGO (DEBE CxP / HABER banco) es la Fase B, su
  -- propio bloque.
  ADD COLUMN IF NOT EXISTS payment_account_code text,
  -- Cache del asiento que registró el gasto, para no consultar journal_entries
  -- en cada render. La garantía real sigue siendo el UNIQUE de la `034`.
  ADD COLUMN IF NOT EXISTS posted_entry_id uuid REFERENCES public.journal_entries(id);

CREATE INDEX IF NOT EXISTS idx_expenses_supplier
  ON public.expenses (tenant_id, supplier_id) WHERE supplier_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_due_date
  ON public.expenses (tenant_id, due_date) WHERE due_date IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4) BACKFILL — un gasto histórico = una línea, sin cuenta
-- ---------------------------------------------------------------------------
-- `chart_account_code` va NULL. Ver el comentario de la columna: es la decisión
-- central de esta migración.
--
-- `tax_rate`/`tax_amount` en 0 porque el modelo viejo no desglosaba impuesto: el
-- `amount` histórico es el total pagado. Ponerle un 7% inventado sería el mismo
-- error que ponerle una cuenta.
INSERT INTO public.expense_lines
  (tenant_id, expense_id, line_order, description, chart_account_code,
   amount, tax_rate, tax_amount, created_by)
SELECT e.tenant_id,
       e.id,
       1,
       btrim(e.concept),
       NULL,
       e.amount,
       0,
       0,
       e.registered_by
  FROM public.expenses e
 WHERE NOT EXISTS (
   SELECT 1 FROM public.expense_lines l WHERE l.expense_id = e.id
 );

-- ---------------------------------------------------------------------------
-- 5) VERIFICACIÓN — cinco comprobaciones. Si una falla, revierte TODO.
-- ---------------------------------------------------------------------------
-- Se verifica en CANTIDAD y no solo en cuadre: dos errores distintos pueden dar
-- la misma suma. Un gasto que perdió su línea y otro que ganó una de más suman
-- igual y son dos bugs.
DO $$
DECLARE
  a                  record;
  v_gastos_despues   bigint;
  v_lineas           bigint;
  v_suma_lineas      numeric;
  v_adjuntos_despues bigint;
  v_sin_linea        bigint;
  v_descuadrados     bigint;
  v_sin_clasificar   bigint;
BEGIN
  SELECT * INTO a FROM _036_antes;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE receipt_url IS NOT NULL)
    INTO v_gastos_despues, v_adjuntos_despues
    FROM public.expenses;

  SELECT COUNT(*), COALESCE(ROUND(SUM(amount), 2), 0)
    INTO v_lineas, v_suma_lineas
    FROM public.expense_lines
   WHERE expense_id IS NOT NULL;

  -- (1) No se perdió ni se creó un gasto.
  IF v_gastos_despues <> a.gastos THEN
    RAISE EXCEPTION
      'La cantidad de gastos cambió: % antes, % después. Esta migración NO crea ni borra gastos.',
      a.gastos, v_gastos_despues;
  END IF;

  -- (2) Uno a uno, exacto. Ni de más ni de menos.
  IF v_lineas <> a.gastos THEN
    RAISE EXCEPTION
      'Se esperaba UNA línea por gasto: % gastos y % líneas. Diferencia de %.',
      a.gastos, v_lineas, v_lineas - a.gastos;
  END IF;

  -- (3) Ningún gasto quedó sin línea. Redundante con (2) por aritmética, pero
  --     lo NOMBRA: si (2) fallara por un gasto sin línea y otro con dos, este
  --     dice cuál de los dos problemas es.
  SELECT COUNT(*) INTO v_sin_linea
    FROM public.expenses e
   WHERE NOT EXISTS (SELECT 1 FROM public.expense_lines l WHERE l.expense_id = e.id);
  IF v_sin_linea > 0 THEN
    RAISE EXCEPTION 'Quedaron % gasto(s) sin ninguna línea.', v_sin_linea;
  END IF;

  -- (4) La plata es la misma, al centavo, en total Y gasto por gasto.
  IF v_suma_lineas <> a.suma THEN
    RAISE EXCEPTION
      'La suma no coincide: % en los gastos, % en las líneas. Diferencia de %.',
      a.suma, v_suma_lineas, v_suma_lineas - a.suma;
  END IF;

  SELECT COUNT(*) INTO v_descuadrados
    FROM public.expenses e
    JOIN (SELECT expense_id, ROUND(SUM(amount), 2) AS suma
            FROM public.expense_lines WHERE expense_id IS NOT NULL
           GROUP BY expense_id) l ON l.expense_id = e.id
   WHERE l.suma <> ROUND(e.amount, 2);
  IF v_descuadrados > 0 THEN
    RAISE EXCEPTION
      '% gasto(s) con líneas que no suman su monto. El total daba bien: dos errores se estaban compensando.',
      v_descuadrados;
  END IF;

  -- (5) Los comprobantes. Esta migración no toca Storage, pero el número queda
  --     AFIRMADO en el log: vale más que la promesa de diseño.
  IF v_adjuntos_despues <> a.con_adjunto THEN
    RAISE EXCEPTION
      'La cantidad de comprobantes cambió: % antes, % después. Esta migración no debe tocar ni uno.',
      a.con_adjunto, v_adjuntos_despues;
  END IF;

  SELECT COUNT(*) INTO v_sin_clasificar
    FROM public.expense_lines WHERE chart_account_code IS NULL;

  RAISE NOTICE '--- DESPUÉS ---';
  RAISE NOTICE '  gastos ................ %  (sin cambios)', v_gastos_despues;
  RAISE NOTICE '  líneas ................ %  (una por gasto)', v_lineas;
  RAISE NOTICE '  suma .................. %  (idéntica)', v_suma_lineas;
  RAISE NOTICE '  con comprobante ....... %  (sin cambios, Storage intacto)', v_adjuntos_despues;
  RAISE NOTICE '  líneas SIN CLASIFICAR . %', v_sin_clasificar;
  RAISE NOTICE '';
  RAISE NOTICE 'Las líneas sin clasificar NO son un error: son los gastos que se';
  RAISE NOTICE 'cargaron antes de que el sistema pidiera la cuenta contable. Se';
  RAISE NOTICE 'resuelven desde /legal/gastos con el filtro "Sin clasificar".';
  RAISE NOTICE 'OK — las cinco verificaciones pasaron.';
END $$;

COMMIT;


-- ============================================================================
-- ROLLBACK (correr a mano si hace falta volver atrás)
-- ============================================================================
-- ⚠️ Dropear la tabla borra las líneas que alguien haya CLASIFICADO después de
--    aplicar esto. Verificar antes:
--      SELECT COUNT(*) FROM expense_lines WHERE chart_account_code IS NOT NULL;
--    Si da más de 0, ese trabajo se pierde. Exportarlo primero.
--
-- BEGIN;
-- DROP TABLE IF EXISTS public.expense_lines;
-- ALTER TABLE public.expenses
--   DROP COLUMN IF EXISTS supplier_id,
--   DROP COLUMN IF EXISTS due_date,
--   DROP COLUMN IF EXISTS payment_account_code,
--   DROP COLUMN IF EXISTS posted_entry_id;
-- COMMIT;
-- ============================================================================
