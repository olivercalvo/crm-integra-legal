# Hotfix 084 en producción: `audit_log` solo de agregar

> Para que **Oliver** lo aplique en el SQL Editor de producción (`uqmmkklbhzxqybljiecs`).
> Ningún agente lo aplica. Rama: `hotfix/audit-log-solo-agregar` (desde `main` 24b227a).

## Qué corrige

Hoy, en producción, `audit_log` tiene la política `audit_tenant_isolation` **FOR ALL**, y `anon` y
`authenticated` tienen `DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE`. Consecuencia:
cualquier usuario logueado puede editar o borrar la bitácora de su bufete desde el navegador, con su propia
sesión. Lo confirmó la consulta del 03/10.

**Después de la 084:**
- el usuario solo **lee** las filas de su bufete;
- `anon` no tiene nada;
- y un trigger rechaza `UPDATE`, `DELETE` y `TRUNCATE` a todos salvo el superusuario de la plataforma
  (`supabase_admin`).

**La app no cambia:** las 32 escrituras y las 2 lecturas de `audit_log` usan el cliente de servicio
(revisado en `main` y en la rama del Bloque 1). No hay código en este hotfix.

## Antes de empezar

1. **Respaldo:** confirmar que corrió el respaldo diario («Respaldo Base Integra») de hoy. `audit_log` está
   en el respaldo.
2. Tener a mano los tres archivos de la rama:
   - `sql/verificacion/produccion-audit-log-permisos.sql` (la consulta, solo lectura);
   - `sql/pending/084_audit_log_solo_agregar.sql` (el hotfix);
   - `sql/hotfix/084_deshacer.sql` (solo si hay que volver atrás).
3. 🔴 **No correr** `sql/tests/verificacion-084-audit-log-solo-agregar.sql` en producción:
   - crea un bufete de prueba e inserta filas (aunque al final lo deshace todo);
   - tiene IDs de staging.

   Es para staging, donde salió 11/11 el 03/10.

## Paso a paso

### Paso 1: foto de ANTES (solo lectura)

Pegar **todo** `sql/verificacion/produccion-audit-log-permisos.sql` en una pestaña nueva y **Run**.

Debe salir algo así (guardar una captura o exportar el CSV):

| tipo | nombre | detalle |
|---|---|---|
| filas | audit_log | *N* (anotar el número) |
| permiso | anon | DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE |
| permiso | authenticated | DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE |
| permiso | service_role | DELETE, INSERT, … |
| politica | audit_tenant_isolation | FOR ALL USING (tenant_id = **…**) |
| rls | audit_log | true |
| trigger | trg_audit_log_sin_truncate | NO EXISTE |
| trigger | trg_audit_log_solo_agregar | NO EXISTE |

**Anotar la expresión del USING** (en staging es `tenant_id()`; en producción puede ser `auth.tenant_id()`).
La 084 la copia tal cual.

### Paso 2: aplicar la 084

Pegar **todo** `sql/pending/084_audit_log_solo_agregar.sql` en una pestaña nueva y **Run**.

- **Debe salir:** «Success. No rows returned». El SQL Editor puede no mostrar los `NOTICE`. No hacen falta:
  el paso 3 es la prueba.
- **Si sale un error en rojo:** no cambió nada. La migración es una sola transacción (`BEGIN … COMMIT`) y
  tiene su propia verificación al final, que aborta si algo no quedó como debe. Copiar el error completo y
  pasármelo. No reintentar a ciegas.

### Paso 3: foto de DESPUÉS (solo lectura)

Volver a correr la consulta del paso 1. Debe salir:

| tipo | nombre | detalle |
|---|---|---|
| filas | audit_log | **el mismo *N* del paso 1** (o más, si alguien trabajó en el medio; nunca menos) |
| permiso | authenticated | INSERT, REFERENCES, SELECT, TRIGGER |
| permiso | service_role | DELETE, INSERT, … (sin cambio: las rutas insertan con este rol; el trigger le impide editar y borrar) |
| politica | audit_log_select | FOR SELECT USING (**la misma expresión del paso 1**) |
| rls | audit_log | true |
| trigger | trg_audit_log_sin_truncate | existe (activo) |
| trigger | trg_audit_log_solo_agregar | existe (activo) |

`anon` **no aparece**: se quedó sin permisos.

### Paso 4: prueba en la app (2 minutos)

Hacer una acción normal que deje registro y confirmar que funciona y queda escrita:
1. Como admin, en Legal: editar un dato inofensivo de un cliente (por ejemplo, el teléfono) y volverlo a
   dejar como estaba. Debe guardar sin error.
2. Abrir **Legal → Admin → Auditoría**: deben aparecer las dos ediciones arriba de todo.
3. Correr la consulta otra vez: `filas` subió en 2.

Si algo de esto falla, ir a **Deshacer**.

## Deshacer (solo si algo salió mal)

Pegar **todo** `sql/hotfix/084_deshacer.sql` y **Run**.

- Vuelve exactamente al estado de antes, ya probado en staging el 03/10: política FOR ALL con la misma
  expresión, permisos completos para `anon` y `authenticated` y sin triggers.
- No toca filas. Correr la consulta: tiene que salir igual que la foto del paso 1.
- ⚠️ Reabre el agujero. Es para salir de un problema, no para quedarse así.

## Qué cambia en el día a día después del hotfix

- **Nadie borra ni edita filas de `audit_log`**, tampoco desde el SQL Editor: en Supabase `postgres` no es
  superusuario.
  - Si algún día hiciera falta, alguien tendría que quitar el trigger (`DROP TRIGGER`), y eso queda a la vista.
  - Borrar un bufete entero (`tenants`) también queda bloqueado por la cascada hacia `audit_log`. No es algo
    que se haga.
- Los scripts viejos que hacían `DELETE FROM audit_log` ya no corren:
  - `scripts/run_all_pending.sql`, retirado del Bloque 1;
  - las migraciones v1.1 de abril, que no se vuelven a correr.

## Cuando llegue la ventana grande (025 → 084)

La 084 entra igual en la cola y **no falla ni cambia nada** si el hotfix ya está aplicado. Probado en staging
el 03/10 corriéndola dos veces seguidas:
- **La política:** detecta que ya está reemplazada, avisa «la política ya estaba reemplazada, se deja como
  está» y no la toca.
- **Los permisos:** los `REVOKE` son idempotentes.
- **La función y los triggers:** se recrean idénticos.
- **Resultado:** la consulta antes y después de la segunda corrida da exactamente lo mismo (política,
  triggers, permisos y filas).
- **Y nada antes de ella lo deshace:** ninguna migración de la 025 a la 083 toca `audit_log` ni da permisos
  sobre todas las tablas (revisado).

## La rama `hotfix/audit-log-solo-agregar`

**Qué tiene:**
- la 084 y su verificación de staging;
- la consulta de solo lectura;
- el script de deshacer;
- este documento.

**Qué no tiene:** código de la app ni nada del Bloque 1. Los archivos son **idénticos** byte a byte a los de
`feat/bloque1-contable`, así que cuando el Bloque 1 se integre no hay conflicto.

**Recomendación: merge a `main` después de aplicarla en producción** (con aprobación de Oliver, como todo
merge a `main`), y después `main` → `develop`.
- `main` es lo que dice qué tiene producción, y el repo ya sigue ese patrón con los hotfix
  (`hotfix/tipo-09-y-gate-de-mezcla`).
- El auto-deploy de Vercel no cambia nada funcional: no hay código.
- **Dejarla solo como registro** obligaría a recordar que producción tiene algo que `main` no dice. Es
  exactamente el tipo de hueco que llevó a crear el inventario de migraciones.
