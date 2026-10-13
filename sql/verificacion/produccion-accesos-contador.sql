-- ============================================================================
-- Producción (uqmmkklbhzxqybljiecs) · SOLO LECTURA · la corre Oliver en el SQL Editor
-- ============================================================================
-- Paso «Accesos» de la ventana del Bloque 1 (runbook ventana-bloque-1.md §6),
-- después de crear el usuario de Josuarth y desactivar contador.test.
--
-- ✏️ Antes de correrla: poner el correo de Josuarth en `josuarth` (abajo).
--
-- Devuelve una fila por usuario con rol contador, más todo usuario inactivo
-- de cualquier rol que TODAVÍA PUEDE ENTRAR (desactivado antes del 05/10,
-- cuando «Desactivar» no bloqueaba en Auth), y una última fila «VEREDICTO».
--
-- Esperado:
--   · una sola fila contador con activo = sí, y es la de Josuarth, con
--     puede_entrar = sí y ya_entró = sí (definió su contraseña y entró);
--   · contador.test@integra-panama.com con activo = no y puede_entrar = no;
--   · ninguna fila «inactivo pero puede entrar»;
--   · VEREDICTO = OK.
-- ============================================================================
WITH
cfg AS (
  SELECT lower('CORREO-DE-JOSUARTH@CONFIRMAR') AS josuarth,
         lower('contador.test@integra-panama.com') AS de_prueba
),
u AS (
  SELECT pu.email, pu.full_name, pu.role, pu.active,
         au.banned_until,
         (au.banned_until IS NULL OR au.banned_until < now()) AS puede_entrar,
         au.last_sign_in_at, au.email_confirmed_at, pu.created_at
    FROM public.users pu
    LEFT JOIN auth.users au ON au.id = pu.id
),
filas AS (
  SELECT CASE WHEN u.role = 'contador' THEN 'contador'
              ELSE 'inactivo pero puede entrar' END                       AS que,
         u.email, u.full_name, u.role,
         CASE WHEN u.active THEN 'sí' ELSE 'no' END                        AS activo,
         CASE WHEN u.puede_entrar THEN 'sí' ELSE 'no' END                  AS puede_entrar,
         CASE WHEN u.last_sign_in_at IS NOT NULL THEN 'sí' ELSE 'no' END   AS ya_entró,
         to_char(u.last_sign_in_at AT TIME ZONE 'America/Panama', 'DD/MM/YYYY HH24:MI') AS último_ingreso,
         to_char(u.created_at AT TIME ZONE 'America/Panama', 'DD/MM/YYYY HH24:MI')      AS creado
    FROM u
   WHERE u.role = 'contador' OR (NOT u.active AND u.puede_entrar)
),
veredicto AS (
  SELECT CASE
           WHEN (SELECT count(*) FROM u WHERE role = 'contador' AND active) <> 1
             THEN 'REVISAR: ' || (SELECT count(*) FROM u WHERE role = 'contador' AND active) || ' contadores activos (debe haber 1)'
           WHEN NOT EXISTS (SELECT 1 FROM u, cfg WHERE u.role = 'contador' AND u.active AND lower(u.email) = cfg.josuarth)
             THEN 'REVISAR: el contador activo no es ' || (SELECT josuarth FROM cfg)
           WHEN EXISTS (SELECT 1 FROM u, cfg WHERE lower(u.email) = cfg.josuarth AND (NOT u.puede_entrar OR u.last_sign_in_at IS NULL))
             THEN 'REVISAR: Josuarth todavía no entró (o está bloqueado)'
           WHEN NOT EXISTS (SELECT 1 FROM u, cfg WHERE lower(u.email) = cfg.de_prueba)
             THEN 'REVISAR: no aparece ' || (SELECT de_prueba FROM cfg) || ' (¿otro correo?)'
           WHEN EXISTS (SELECT 1 FROM u, cfg WHERE lower(u.email) = cfg.de_prueba AND (u.active OR u.puede_entrar))
             THEN 'REVISAR: contador.test sigue activo o todavía puede entrar'
           WHEN EXISTS (SELECT 1 FROM u WHERE NOT u.active AND u.puede_entrar)
             THEN 'REVISAR: hay usuarios inactivos que todavía pueden entrar (reactivar y desactivar desde Admin > Usuarios)'
           ELSE 'OK'
         END AS texto
)
SELECT que, email, full_name, role, activo, puede_entrar, ya_entró, último_ingreso, creado
  FROM (
    SELECT f.*, CASE f.que WHEN 'contador' THEN 0 ELSE 1 END AS orden FROM filas f
    UNION ALL
    SELECT 'VEREDICTO', (SELECT texto FROM veredicto), NULL, NULL, NULL, NULL, NULL, NULL, NULL, 2
  ) t
 ORDER BY orden, email;
