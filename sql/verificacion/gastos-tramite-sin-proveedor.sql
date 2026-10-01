-- ============================================================================
-- PASO PREVIO A ABRIR EL LIBRO EN PRODUCCIÓN (runbook, nota de la 071)
-- Gastos de trámite que van a necesitar PROVEEDOR antes de entrar al libro.
-- ============================================================================
-- Desde E3 (01/10/2026) un gasto de trámite sin proveedor NO se registra en el
-- libro: acredita 200001 y ahí no hay líneas sin proveedor (071 + constructor).
-- En producción el libro está vacío, así que TODO gasto de trámite que se quiera
-- registrar con el botón "Registrar en el libro contable" pasa por esta regla.
--
-- 🛡️ SOLO LECTURA (BEGIN READ ONLY … ROLLBACK). No modifica nada.
-- 🛑 Lo corre una PERSONA en el SQL Editor de producción, en la ventana:
--    DESPUÉS de aplicar la cola de migraciones (la 036 crea `supplier_id` y
--    `posted_entry_id`; antes de ella esta consulta falla) y ANTES de mezclar a
--    `main` y abrir el libro. Ningún agente la corre contra producción.
--
-- Qué hacer con la lista: la abogada o el contador asignan el proveedor de cada
-- gasto (ficha del gasto, campo Proveedor; la 049 lo deja editable) antes de
-- registrarlo en el libro. Si el proveedor no tiene ficha, se crea en
-- Finanzas → Proveedores. Siempre se exige la ficha (decisión del 01/10/2026).
--
-- ⚠️ Esperado en producción: los 137 gastos (ninguno tiene `supplier_id`
--    todavía: la 036 agrega la columna vacía y no la rellena).
-- ============================================================================
BEGIN READ ONLY;

-- 1) El resumen.
SELECT count(*)                                         AS gastos_sin_asiento,
       count(*) FILTER (WHERE e.supplier_id IS NULL)    AS necesitan_proveedor,
       coalesce(sum(e.amount) FILTER (WHERE e.supplier_id IS NULL), 0) AS monto_sin_proveedor
  FROM public.expenses e
 WHERE NOT EXISTS (SELECT 1 FROM public.journal_entries j
                    WHERE j.tenant_id = e.tenant_id
                      AND j.source_type = 'gasto_tramite'
                      AND j.source_id = e.id);

-- 2) La lista, para repartir el trabajo (caso, cliente, fecha, concepto, monto).
SELECT c.case_code                         AS caso,
       cl.name                             AS cliente,
       e.date                              AS fecha_documento,
       e.concept                           AS concepto,
       e.amount                            AS monto,
       e.id                                AS gasto_id
  FROM public.expenses e
  LEFT JOIN public.cases   c  ON c.id  = e.case_id
  LEFT JOIN public.clients cl ON cl.id = c.client_id
 WHERE e.supplier_id IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.journal_entries j
                    WHERE j.tenant_id = e.tenant_id
                      AND j.source_type = 'gasto_tramite'
                      AND j.source_id = e.id)
 ORDER BY c.case_code, e.date, e.concept;

ROLLBACK;
