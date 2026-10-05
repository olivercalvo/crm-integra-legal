-- ============================================================================
-- Producción (uqmmkklbhzxqybljiecs) · SOLO LECTURA · la corre Oliver en el SQL Editor
-- ============================================================================
-- Lista lo que PARECE de prueba en producción, para decidir antes de la ventana
-- qué se limpia (eso lo decide una persona, con otra consulta y otra aprobación).
-- Un solo resultado, agrupado por tabla: `total_en_la_tabla` dice cuántos hay en
-- cada una y cada fila es un registro con TODOS los motivos por los que salió.
--
-- Motivos:
--   · nombre    → «prueba», «test», «0TEST», «demo» como palabra (no «testamento»).
--                 En textos largos de un caso (descripción, observaciones) sólo si
--                 el texto EMPIEZA con la palabra: «prueba» también es la prueba
--                 de un juicio y no se marca por aparecer en el medio.
--   · ruc_emisor → el RUC del propio bufete (25046169-3-2021) en un cliente: así
--                 se emitía contra el sandbox (el sandbox rechaza RUC ficticios).
--   · monto     → 1.00 o 1.07 (B/. 1 + ITBMS): montos de prueba de emisión.
--   · sandbox   → i_amb = 2 en la factura o en un envío (fe_emisiones), o un CUFE
--                 cuyo carácter de ambiente (posición 56) es 2. Una fila de
--                 producción que habló con el SANDBOX salió de una máquina
--                 (localhost apuntaba a producción hasta Fase 0, 25/08/2026).
--   · correo    → dominios de prueba (example, test, staging, localhost, invalid).
--   · línea     → una línea de la factura dice prueba/test/demo.
--
-- «Creado desde localhost»: producción no guarda IP ni origen (audit_log, hasta la
-- 024, sólo tiene usuario y fecha). La única huella es el sandbox (arriba). Antes
-- del 25/08/2026 todo lo creado desde una máquina de desarrollo cayó en esta base:
-- `antes_de_fase_0` lo marca para mirar con más cuidado, pero NO es un motivo.
--
-- Sólo columnas que existen hasta la 024 (verificado contra una base local con el
-- esquema exacto de producción: scripts/ensayo-ventana/, base `prod_024`).
-- Sin datos de contacto en el resultado salvo el correo de los usuarios.
-- ============================================================================
WITH
pat AS (
  SELECT '\m(prueba|pruebas|test|tests|testing|demo|0test)\M'      AS palabra,
         '^\s*(prueba|pruebas|test|demo|0test)\M'                  AS al_inicio,
         '(example\.|\.test$|@test\.|staging|localhost|\.invalid$)' AS correo,
         '25046169'                                                AS ruc_emisor
),
marcas AS (
  -- Clientes
  SELECT 'clients' AS tabla, c.id, c.client_number AS referencia, c.name AS texto, c.created_at, NULL::numeric AS monto,
         'nombre' AS motivo
    FROM public.clients c, pat WHERE c.name ~* pat.palabra
  UNION ALL
  SELECT 'clients', c.id, c.client_number, c.name, c.created_at, NULL, 'ruc_emisor'
    FROM public.clients c, pat
   WHERE regexp_replace(coalesce(c.ruc, '') || ' ' || coalesce(c.tax_id, ''), '\D', '', 'g') LIKE '%' || pat.ruc_emisor || '%'
  UNION ALL
  SELECT 'clients', c.id, c.client_number, c.name, c.created_at, NULL, 'correo'
    FROM public.clients c, pat WHERE c.email ~* pat.correo

  -- Casos
  UNION ALL
  SELECT 'cases', k.id, k.case_code, left(coalesce(k.description, ''), 120), k.created_at, NULL, 'nombre'
    FROM public.cases k, pat
   WHERE k.case_code ~* pat.palabra OR k.description ~* pat.al_inicio OR k.observations ~* pat.al_inicio

  -- Facturas
  UNION ALL
  SELECT 'invoices', i.id, i.invoice_number, left(coalesce(i.notes, ''), 120), i.created_at, i.grand_total, 'nombre'
    FROM public.invoices i, pat WHERE i.notes ~* pat.palabra
  UNION ALL
  SELECT 'invoices', i.id, i.invoice_number, left(coalesce(i.notes, ''), 120), i.created_at, i.grand_total, 'monto'
    FROM public.invoices i WHERE i.grand_total IN (1.00, 1.07)
  UNION ALL
  SELECT 'invoices', i.id, i.invoice_number, left(coalesce(i.notes, ''), 120), i.created_at, i.grand_total, 'sandbox'
    FROM public.invoices i
   WHERE i.i_amb = 2
      OR (char_length(btrim(coalesce(i.dgi_cufe, ''))) = 66 AND substr(upper(btrim(i.dgi_cufe)), 56, 1) = '2')
      OR EXISTS (SELECT 1 FROM public.fe_emisiones e WHERE e.invoice_id = i.id AND e.i_amb = 2)
  UNION ALL
  SELECT DISTINCT 'invoices', i.id, i.invoice_number, left(l.description, 120), i.created_at, i.grand_total, 'línea'
    FROM public.invoices i JOIN public.invoice_lines l ON l.invoice_id = i.id, pat
   WHERE l.description ~* pat.palabra

  -- Cobros de Finanzas
  UNION ALL
  SELECT 'payments', p.id, coalesce(p.payment_number, p.reference), left(coalesce(p.notes, p.reference, ''), 120), p.created_at, p.amount, 'nombre'
    FROM public.payments p, pat WHERE p.notes ~* pat.palabra OR p.reference ~* pat.palabra
  UNION ALL
  SELECT 'payments', p.id, coalesce(p.payment_number, p.reference), left(coalesce(p.notes, p.reference, ''), 120), p.created_at, p.amount, 'monto'
    FROM public.payments p WHERE p.amount IN (1.00, 1.07)

  -- Cobros del caso (Legal)
  UNION ALL
  SELECT 'client_payments', cp.id, k.case_code, left(coalesce(cp.description, ''), 120), cp.created_at, cp.amount, 'nombre'
    FROM public.client_payments cp LEFT JOIN public.cases k ON k.id = cp.case_id, pat
   WHERE cp.description ~* pat.palabra
  UNION ALL
  SELECT 'client_payments', cp.id, k.case_code, left(coalesce(cp.description, ''), 120), cp.created_at, cp.amount, 'monto'
    FROM public.client_payments cp LEFT JOIN public.cases k ON k.id = cp.case_id
   WHERE cp.amount IN (1.00, 1.07)

  -- Gastos de trámite
  UNION ALL
  SELECT 'expenses', x.id, k.case_code, left(coalesce(x.concept, ''), 120), x.created_at, x.amount, 'nombre'
    FROM public.expenses x LEFT JOIN public.cases k ON k.id = x.case_id, pat
   WHERE x.concept ~* pat.palabra
  UNION ALL
  SELECT 'expenses', x.id, k.case_code, left(coalesce(x.concept, ''), 120), x.created_at, x.amount, 'monto'
    FROM public.expenses x LEFT JOIN public.cases k ON k.id = x.case_id
   WHERE x.amount IN (1.00, 1.07)

  -- Usuarios
  UNION ALL
  SELECT 'users', u.id, u.email, u.full_name || ' (' || u.role || CASE WHEN u.active THEN '' ELSE ', inactivo' END || ')', u.created_at, NULL, 'nombre'
    FROM public.users u, pat WHERE u.full_name ~* pat.palabra
  UNION ALL
  SELECT 'users', u.id, u.email, u.full_name || ' (' || u.role || CASE WHEN u.active THEN '' ELSE ', inactivo' END || ')', u.created_at, NULL, 'correo'
    FROM public.users u, pat WHERE u.email ~* pat.correo OR u.email ~* pat.palabra

  -- Documentos
  UNION ALL
  SELECT 'documents', d.id, d.entity_type, left(d.file_name, 120), d.created_at, NULL, 'nombre'
    FROM public.documents d, pat WHERE d.file_name ~* pat.palabra
),
por_registro AS (
  SELECT tabla, id,
         max(referencia) AS referencia,
         max(texto)      AS texto,
         max(created_at) AS created_at,
         max(monto)      AS monto,
         string_agg(DISTINCT motivo, ', ' ORDER BY motivo) AS motivos
    FROM marcas
   GROUP BY tabla, id
)
SELECT tabla,
       count(*) OVER (PARTITION BY tabla)   AS total_en_la_tabla,
       motivos,
       referencia,
       texto,
       monto,
       to_char(created_at AT TIME ZONE 'America/Panama', 'DD/MM/YYYY HH24:MI') AS creado,
       created_at < '2026-08-25'::date      AS antes_de_fase_0,
       id
  FROM por_registro
 ORDER BY tabla, created_at;
