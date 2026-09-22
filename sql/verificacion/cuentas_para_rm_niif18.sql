-- =============================================================================
-- PARA RM CONSULTORES — las cuentas que la 025 va a clasificar POR DEFECTO
-- =============================================================================
-- SOLO LECTURA. Un SELECT. No escribe nada.
--
-- PARA QUÉ:
--   La migración `025` (NIIF 18) toma toda cuenta de RESULTADO activa que quede
--   sin subcategoría válida y la clasifica como la actividad **OPERATIVA** de su
--   tipo. Es el default correcto —hoy todo lo que el bufete tiene es operativo—
--   pero es un SUPUESTO, no un dato: NIIF 18 también tiene actividades de
--   INVERSIÓN y de FINANCIAMIENTO, y nadie confirmó que ninguna cuenta caiga ahí.
--
--   Esta consulta devuelve exactamente esa lista, para que el contador la marque
--   cuenta por cuenta antes del despliegue. Es el criterio de la propia guía de
--   RM: «quien modifica la clasificación contable de una cuenta debe ser el
--   contador».
--
-- 🔴 NO ES LA CONSULTA CRUDA DEL PRE-FLIGHT P-1(b), QUE CUENTA DE MÁS.
--   La `025` corre tres UPDATE antes de llegar al default:
--
--     PASO C   expense + subcategoria 'costo'           → cost  + costos_operativos
--     PASO D   income  + subcategoria 'ingreso'         → ingresos_operativos
--     PASO D   expense + subcategoria 'gasto_operativo' → gastos_operativos
--     PASO F-bis  ← el DEFAULT, y solo sobre lo que sigue sin clasificar
--
--   Esas tres son un MAPEO del vocabulario viejo al nuevo: determinista, no hay
--   nada que decidir. Preguntarle a RM por ellas sería hacerle revisar cuentas
--   que ya están clasificadas. La consulta simula C y D primero y lista solo lo
--   que F-bis todavía tiene que inventar.
--
-- CÓMO SE USA:
--   1. Pegar en el SQL Editor de producción y ejecutar.
--   2. Copiar el resultado y pegarlo en Excel (las tres últimas columnas vienen
--      vacías a propósito: son para que las llene el contador).
--   3. Mandárselo a RM.
--
--   Si devuelve CERO filas, no hay nada que preguntar: la `025` no clasifica
--   ninguna cuenta por defecto y ese punto del pre-flight queda cerrado.
--
-- NOTA sobre el tenant:
--   Los pasos C y D filtran por `tenant_id`; el PASO F-bis **no**. Con un solo
--   tenant en producción (verificado el 22/09/2026) es equivalente. Si alguna vez
--   hay más de uno, F-bis tocaría los de todos y esta consulta se quedaría corta.
-- =============================================================================

WITH tras_c_y_d AS (
  SELECT
    code,
    name,
    active,
    account_type AS tipo_hoy,
    subcategoria AS sub_hoy,
    -- PASO C: el único que cambia el account_type
    CASE
      WHEN account_type = 'expense' AND subcategoria = 'costo' THEN 'cost'
      ELSE account_type
    END AS tipo_tras_c,
    -- PASOS C y D: el vocabulario viejo se MAPEA, no se defaultea
    CASE
      WHEN account_type = 'expense' AND subcategoria = 'costo'           THEN 'costos_operativos'
      WHEN account_type = 'income'  AND subcategoria = 'ingreso'         THEN 'ingresos_operativos'
      WHEN account_type = 'expense' AND subcategoria = 'gasto_operativo' THEN 'gastos_operativos'
      ELSE subcategoria
    END AS sub_tras_c_y_d
  FROM public.chart_of_accounts
  WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
)
SELECT
  code                                          AS "Código",
  name                                          AS "Nombre de la cuenta",
  CASE tipo_tras_c
    WHEN 'income'  THEN 'Ingreso'
    WHEN 'cost'    THEN 'Costo'
    WHEN 'expense' THEN 'Gasto'
  END                                           AS "Tipo",
  COALESCE(sub_hoy, '')                         AS "Subcategoría hoy",
  CASE
    WHEN sub_hoy IS NULL THEN 'No tiene subcategoría'
    ELSE 'Tiene una que no corresponde a su tipo'
  END                                           AS "Por qué hay que decidir",
  CASE tipo_tras_c
    WHEN 'income'  THEN 'ingresos_operativos'
    WHEN 'cost'    THEN 'costos_operativos'
    WHEN 'expense' THEN 'gastos_operativos'
  END                                           AS "El sistema le va a poner",
  ''                                            AS "¿Es correcto? (SI / NO)",
  ''                                            AS "Si NO: ¿cuál corresponde?",
  ''                                            AS "Observación"
FROM tras_c_y_d
WHERE active
  AND tipo_tras_c IN ('income', 'cost', 'expense')
  AND (
    sub_tras_c_y_d IS NULL
    OR NOT (
         (tipo_tras_c = 'income'  AND sub_tras_c_y_d IN
            ('ingresos_operativos', 'ingresos_inversion', 'ingresos_financiamiento'))
      OR (tipo_tras_c = 'cost'    AND sub_tras_c_y_d IN
            ('costos_operativos',   'costos_inversion',   'costos_financiamiento'))
      OR (tipo_tras_c = 'expense' AND sub_tras_c_y_d IN
            ('gastos_operativos',   'gastos_inversion',   'gastos_financiamiento'))
    )
  )
ORDER BY
  CASE tipo_tras_c WHEN 'income' THEN 1 WHEN 'cost' THEN 2 ELSE 3 END,
  code;

-- =============================================================================
-- LAS NUEVE OPCIONES, para que RM tenga el vocabulario a mano
-- =============================================================================
--   INGRESO  ingresos_operativos · ingresos_inversion · ingresos_financiamiento
--   COSTO    costos_operativos   · costos_inversion   · costos_financiamiento
--   GASTO    gastos_operativos   · gastos_inversion   · gastos_financiamiento
--
-- Una cuenta de resultado ACTIVA no puede quedarse sin una de estas: el CHECK
-- `coa_resultado_subcategoria_niif18` que crea la misma `025` lo impide, y es
-- por tipo, no contra la lista entera (un ingreso con `gastos_operativos`
-- rompería el Estado de Resultado igual que un NULL).
-- =============================================================================
