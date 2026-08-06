# Gestión de Usuarios — CRM Integra Legal

Documento operativo. Cubre cómo se crean, modifican y reparan usuarios del CRM, y qué hacer cuando uno reporta problemas de acceso.

## 1. Roles disponibles

| Rol         | Permisos                                                                                  |
|-------------|-------------------------------------------------------------------------------------------|
| `admin`     | Todo: gestión de usuarios y catálogos, importación masiva, auditoría, todos los CRUD.     |
| `abogada`   | CRUD clientes, expedientes, tareas, gastos, documentos, comentarios; importación masiva.  |
| `asistente` | Ve TODOS los casos del bufete (lectura completa): actualizar estado, registrar gastos, cumplir tareas, comentar, subir documentos. Ficha de cliente individual en solo lectura; SIN directorio de Clientes ni alta/edición. No crea/edita/borra casos ni clientes; sin acceso a Finanzas. |

## 2. Cómo crear un usuario correctamente

**Único flujo soportado:** `/admin/usuarios → Crear Usuario` (UI). Sólo accesible para `admin`.

El formulario requiere:
- Nombre completo (obligatorio)
- Correo electrónico (obligatorio, formato válido, único)
- Contraseña (obligatorio, mínimo 8 caracteres)
- Rol (obligatorio: `admin`, `abogada` o `asistente`)

Internamente, el endpoint `POST /api/admin/users` hace, en orden:

1. Valida rol del invocador (`admin`).
2. Valida campos.
3. Llama `supabase.auth.admin.createUser()` con:
   - `email_confirm: true` (sin verificación por mail; el admin garantiza la identidad).
   - `app_metadata: { user_role, tenant_id }` ← **crítico**: el middleware autoriza por estos campos.
   - `user_metadata: { full_name, role, tenant_id }` ← informativo.
4. Verifica defensivamente que `app_metadata` quedó persistido. Si no, hace rollback (`deleteUser`) y devuelve 500.
5. Inserta fila en `public.users` con el mismo `id`. Si falla, hace rollback y devuelve 500.
6. Inserta en `audit_log`.

**Nunca crear usuarios** desde el dashboard de Supabase ni desde scripts ad-hoc — el flujo de la UI es el único que garantiza que `app_metadata` queda sincronizado.

## 3. Cómo cambiar el rol de un usuario

`/admin/usuarios → ⋯ → Editar` (UI). Internamente `PATCH /api/admin/users/[id]` actualiza `public.users.role` y, si el rol cambió, también `auth.users.app_metadata.user_role`. El cambio se refleja en el JWT del usuario en su próximo login (o al refrescar token).

## 4. Cómo desactivar un usuario

`/admin/usuarios → ⋯ → Desactivar`. Soft delete: `public.users.active = false`. El usuario ya no podrá usar la app pero no se elimina de `auth.users`.

## 5. Diagnóstico cuando un usuario reporta que "no puede entrar"

Síntomas y causa probable:

| Síntoma                                              | Causa probable                                                  |
|------------------------------------------------------|-----------------------------------------------------------------|
| "Correo o contraseña incorrectos"                    | Credenciales mal escritas o usuario inactivo en `public.users`. |
| Redirige a `/login?error=no-role` o loop de redirects | Falta `app_metadata.user_role` en `auth.users`.                 |
| `ERR_TOO_MANY_REDIRECTS`                             | Igual al anterior — es la manifestación en el navegador.        |
| Entra pero no ve nada / no tiene permisos            | `public.users.role` distinto al esperado o RLS mal aplicado.    |

### Pasos de diagnóstico

1. Verificar que el usuario aparece en `/admin/usuarios` y está **activo**.
2. Verificar en Supabase Dashboard → Authentication → Users que el usuario existe, tiene `email_confirmed_at` seteado y su `app_metadata` contiene `user_role` y `tenant_id`.
3. Si falta `app_metadata.user_role` → ejecutar el endpoint de reparación (sección 6).

## 6. Reparar un usuario con `app_metadata` desincronizado

Endpoint **idempotente** y **admin-only**:

```
POST /api/admin/users/{user_id}/sync-metadata
```

Lee `role` y `tenant_id` desde `public.users` y los copia a `auth.users.app_metadata`. Si ya estaban sincronizados, no inserta entrada en `audit_log` (idempotencia). Si no, registra el cambio.

### Invocación desde curl

Hace falta una sesión de admin válida (cookie `sb-...-auth-token`). Forma rápida: estar logueado como admin en el navegador, abrir DevTools → Application → Cookies → copiar la cookie de sesión, y luego:

```bash
curl -X POST \
  -H "Cookie: sb-uqmmkklbhzxqybljiecs-auth-token=<valor>" \
  https://crm-integra-legal.vercel.app/api/admin/users/<USER_ID>/sync-metadata
```

Respuesta esperada:

```json
{
  "data": {
    "id": "<uuid>",
    "email": "usuario@dominio.com",
    "synced": true,
    "already_synced_before": false,
    "app_metadata": { "user_role": "abogada", "tenant_id": "..." }
  }
}
```

## 7. Por qué existe `app_metadata.user_role` (y no se usa el JWT hook)

El proyecto incluye en `supabase/migrations/20260402000001_initial_schema.sql` una función `public.custom_access_token_hook` que inyecta `user_role` y `tenant_id` en el JWT al emitirse el token. **No está activada como Auth Hook en el dashboard de Supabase**. Mientras siga así, la única forma de que el middleware lea el rol es leerlo desde `app_metadata`, que el endpoint POST garantiza al crear y el endpoint PATCH mantiene al cambiar el rol.

### Hardening futuro (opcional, manual)

Activar el hook en Supabase Dashboard → Authentication → Hooks → "Custom Access Token Hook" apuntando a `public.custom_access_token_hook`. Eso da defensa en profundidad: aunque `app_metadata` se desincronice, el hook lo recompondría desde `public.users` en cada emisión de token. **No habilitar sin probar primero en un entorno separado** — un hook con bug deja a todos los usuarios sin poder loguear.

## 8. Cosas que NO hacer

- ❌ Crear usuarios manualmente desde el dashboard de Supabase (no setea `app_metadata`).
- ❌ Modificar `auth.users.raw_app_meta_data` por SQL directo (Supabase no invalida caches de tokens).
- ❌ Eliminar filas de `public.users` sin desactivar primero (rompe FKs hacia casos, gastos, tareas).
- ❌ Cambiar el rol directamente con UPDATE en `public.users.role` sin sincronizar `app_metadata` (queda inconsistente con el JWT).
