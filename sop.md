# SOP.MD — CRM INTEGRA LEGAL

## SOP-001: Configuración Inicial del Proyecto
1. Crear repositorio con `gh repo create crm-integra-legal --public --clone`
2. Inicializar Next.js 14 con App Router, TypeScript, Tailwind, ESLint
3. Instalar dependencias: `shadcn/ui`, `@supabase/supabase-js`, `@supabase/ssr`, `idb` (IndexedDB wrapper)
4. Configurar estructura de carpetas (v1.11+ — selector de módulos):
   ```
   src/
     app/
       page.tsx                  ← selector de módulos (post-login)
       (auth)/login/
       legal/                    ← módulo Gestión Legal (abogada/asistente/admin)
         layout.tsx              ← auth + DashboardShell con sidebar
         page.tsx                ← dashboard del módulo (role-based)
         clientes/
         casos/
         gastos/
         seguimiento/
         pendientes/             ← unifica abogada/pendientes + asistente/tareas
         prospectos/
         importar/
         admin/                  ← admin-only: usuarios, auditoría, configuración
       finanzas/                 ← módulo Finanzas (Fase 1B; placeholder hoy)
         layout.tsx              ← auth + HomeHeader (sin sidebar)
         page.tsx                ← "Próximamente"
       api/
     components/
       ui/          (shadcn)
       layout/                   ← Header, Sidebar, BottomNav, DashboardShell
       home/                     ← HomeHeader del selector
       dashboards/               ← variantes asistente del dashboard / pendientes
                                   (asistente-gastos*.tsx borrados el 24/08/2026 con el
                                    recorte de alcance del rol)
       clients/
       cases/
       expenses/
       tasks/
       comments/
       documents/
       import/
     lib/
       supabase/    (client, server, middleware, types)
       offline/     (queue, sync, conflict-resolution)
       utils/                    ← greeting.ts (saludo Panamá), format-date, etc.
     middleware.ts               ← gating por rol + redirects 301 legacy
     types/
     hooks/
   ```
   **Notas sobre routing**:
   - El selector en `/` está abierto a todo rol autenticado. Las cards visibles dependen del rol.
   - `/legal/*` es accesible para abogada/asistente/admin (NO contador). El gating fino de botones/acciones está en los componentes.
   - **Visibilidad de casos:** la LECTURA de casos es del tenant completo para los 3 roles legales — el asistente ve y abre TODOS los casos del bufete, igual que abogada (cambio 06/08/2026). Lo ÚNICO que sigue siendo personal del asistente son sus TAREAS: `/legal/pendientes` y las tarjetas "Tareas Pendientes"/"Tareas Cumplidas" del panel filtran por `tasks.assigned_to`. El panel `/legal` cuenta TODOS los casos del tenant ("Casos del Bufete", 22/08/2026).
   - **ALCANCE DEL ASISTENTE (vigente desde el 24/08/2026 — decisión de negocio del cliente).** Es SOLO LECTURA sobre los casos. Ve tres pantallas: `/legal`, `/legal/casos` y `/legal/pendientes`. Dentro de un caso hace exactamente DOS cosas: **subir documentos y comentar**. Sigue cumpliendo tareas desde Mis Pendientes. Perdió: ver y registrar gastos, y cambiar el estado del caso (antes sí podía).
     **Dónde se hace cumplir cada restricción — los tres niveles se mueven juntos:**

     | Restricción | UI (ocultar) | Ruta (server) | API (403) |
     |---|---|---|---|
     | Gastos | `nav-config.ts` saca el ítem; el tab "Gastos" del detalle no se le renderiza y `?tab=gastos` cae a `info` | `ASISTENTE_BLOCKED_PATTERNS` bloquea `/legal/gastos` por PREFIJO | `POST /api/expenses` y `PATCH`/`DELETE /api/expenses/[id]` → `requireRole(["admin","abogada"])` |
     | Cambio de estado | `<CaseStatusChanger>` gateado a admin/abogada en el detalle | — | `PATCH /api/cases/[id]` → `requireRole(["admin","abogada"])` para TODA acción, `change-status` incluida |
     | Editar caso | editor inline gateado a admin/abogada | — | mismo gate del PATCH |
     | Crear tareas | `<AddTaskForm>` gateado a admin/abogada en el tab Seguimiento | — | `POST /api/tasks` → `requireRole(["admin","abogada"])`; `POST /api/todos` rechaza `assigned_to` de otra persona |

     **Lo que el asistente SÍ conserva y NO hay que romper:** `POST /api/documents/register` y `POST /api/comments` siguen aceptando rol `asistente` explícitamente, y `PATCH /api/tasks/[id]` NO lleva gate de rol — cumplir tareas es su flujo diario. Si alguna vez se endurece `/api`, esos tres son la excepción.
     **`PATCH /api/tasks/[id]` va por PROPIEDAD, no por rol** (24/08/2026): el asistente solo cierra tareas con `assigned_to` = él; admin/abogada cierran cualquiera. El handler además solo acepta `status: "cumplida"` e ignora el resto del body, así que no reasigna ni reescribe tareas. Cubierto por `src/app/api/tasks/__tests__/patch-task-ownership.test.ts`.
     **Regla de oro:** ocultar el ítem del menú NO es un permiso. `nav-config.ts` es cosmético; el permiso real vive en `middleware.ts` y en `requireRole()`. Cambiar uno solo de los tres niveles deja el sistema mintiendo.
   - **`cases.assistant_id` está retirado de la UI (22/08/2026).** La columna SIGUE en la BD por la regla aditiva del proyecto, pero ninguna pantalla la lee ni la escribe: no hay selector de "Asistente Responsable" en crear/editar caso ni en el editor inline, no hay columna "Asistente" en el listado, `PATCH /api/cases/[id]` ya no acepta el campo en el body, y la búsqueda universal ya no cruza por él. Se conserva a propósito en `trackedFields` del PATCH, que es la lista de campos AUDITABLES: si el campo vuelve, o alguien lo toca por SQL, el historial lo registra igual. Si se decide reponerlo, el cambio es solo de UI — no hay migración que correr.
   - **Routing de clientes (asistente):** gate por ruta EXACTA, no por prefijo (`ASISTENTE_BLOCKED_PATTERNS` en `middleware.ts`). Bloqueados con redirect a `/legal`: `/legal/clientes` (directorio), `/legal/clientes/nuevo` y `/legal/clientes/{id}/editar`. PERMITIDA: `/legal/clientes/{id}` — la ficha individual, a la que llega desde el link del cliente en el detalle de un caso, renderizada en solo lectura (sin Crear Caso / Editar / Desactivar / Eliminar; sí conserva Adjuntar Documento). Si se agrega una sub-ruta nueva bajo `/legal/clientes/*` hay que decidir explícitamente si sumarla al array de bloqueo — por defecto quedaría accesible.
   - `/legal/admin/*` es admin-only (subset transversal).
   - `/finanzas/*` está abierto a todos los 4 roles (incluido contador). En Fase 1B tendrá su propia gating.
   - Rutas legacy (`/abogada/*`, `/asistente/*`, `/admin/*`, `/dashboard`) hacen redirect 301 al destino nuevo. Mantenidas ~4 semanas para preservar bookmarks y emails ya enviados.
5. Configurar Supabase: proyecto en la CUENTA DEL CLIENTE (no la de Oliver). Solicitar al cliente las env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY. No proceder sin estas credenciales.
6. Configurar middleware de Auth + tenant isolation
7. Branch `develop` como default de trabajo
8. Commit inicial + push

**Edge cases:**
- Si el repo ya existe, clonar en vez de crear
- Verificar que Node.js >= 18 está instalado
- No commitear `.env.local`

---

## SOP-002: Schema de Base de Datos
1. Diseñar schema completo antes de codificar (Data-First Rule)
2. Crear migraciones SQL en Supabase
3. Tablas core:
   - `tenants` (id, name, slug, branding, created_at)
   - `users` (id, tenant_id, email, role, full_name, active)
   - `clients` (id, tenant_id, client_number, name, ruc, type, contact, phone, email, observations, active, created_at, updated_at)
   - `cases` (id, tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file, created_at, updated_at)
   - `expenses` (id, tenant_id, case_id, amount, concept, date, registered_by, created_at)
   - `client_payments` (id, tenant_id, case_id, amount, payment_date, registered_by, created_at)
   - `tasks` (id, tenant_id, case_id, description, deadline, assigned_to, status, created_by, completed_at, created_at)
   - `comments` (id, tenant_id, case_id, text, user_id, created_at) — NO update, NO delete
   - `documents` (id, tenant_id, entity_type, entity_id, file_name, file_path, storage_key, uploaded_by, created_at)
   - `audit_log` (id, tenant_id, user_id, entity, entity_id, action, field, old_value, new_value, created_at) — NO update, NO delete
   - `cat_classifications` (id, tenant_id, name, prefix, description, active)
   - `cat_statuses` (id, tenant_id, name, active)
   - `cat_institutions` (id, tenant_id, name, active)
   - `cat_team` (id, tenant_id, user_id, name, role, active)
4. Aplicar RLS policies en TODAS las tablas con `tenant_id = auth.jwt()->>'tenant_id'`
5. Crear índices en: client_number, ruc, case_code, tenant_id, status, classification
6. Seed data: catálogos iniciales (7 clasificaciones, 3 estados, instituciones conocidas)
7. Verificar migraciones en dev antes de aplicar en prod

**Edge cases:**
- NUNCA ejecutar migraciones destructivas en prod sin backup
- Verificar entorno (dev/prod) antes de cada migración
- Si hay error, rollback inmediato

---

## SOP-003: Implementación Offline-First
1. Crear servicio de cola en `lib/offline/queue.ts` usando IndexedDB (librería `idb`)
2. Toda operación de escritura (create/update/delete):
   a. Guardar en IndexedDB con timestamp, tipo de operación, datos, estado (pending)
   b. Intentar sync inmediata si online
   c. Si offline, queda en cola
3. Detector de conectividad: `navigator.onLine` + ping periódico al servidor
4. Sync service (`lib/offline/sync.ts`):
   a. Al detectar reconexión, procesar cola en orden FIFO
   b. Enviar operación al servidor
   c. Si éxito: marcar como synced, eliminar de cola
   d. Si conflicto (409): aplicar resolución por timestamp
   e. Si error de red: retry con backoff exponencial (1s, 2s, 4s, 8s, max 30s)
   f. NUNCA eliminar de cola hasta confirmación del servidor
5. UI: indicador de estado (online/offline/sincronizando) en header
6. Resolución de conflictos: last-write-wins comparando timestamps, con log del conflicto en audit

**Edge cases:**
- Usuario cierra el navegador con operaciones pendientes → persisten en IndexedDB, se procesan al reabrir
- Dos usuarios editan el mismo registro offline → last-write-wins por timestamp, ambas versiones quedan en audit log
- Cola muy grande → procesar en batches de 10
- Error persistente → mostrar alerta al usuario después de 5 retries fallidos

---

## SOP-004: Migración de Datos desde Excel
1. Leer archivo Excel con hojas CLIENTES y REGISTRO MAESTRO
2. Limpieza automática:
   - Normalizar fechas (4 formatos detectados: `DD/MM/YYYY`, `YYYY`, `datetime`, `D/M/YYYY`)
   - Trim espacios en todos los campos de texto
   - Unificar aliases de responsables: Dave/Dave → Daveiva, Mile/Mile → Milena
   - Eliminar filas placeholder vacías (N° sin datos)
   - Normalizar capitalización en tipos y clasificaciones
3. Validación:
   - Campos obligatorios presentes
   - N° Cliente único
   - Código de expediente único
   - Cliente referenciado existe
4. Mapeo de campos Excel → schema DB
5. Mostrar resumen pre-importación: OK / errores / duplicados
6. Ejecutar solo tras confirmación explícita
7. Log de importación en audit_log

**Edge cases:**
- Fechas que son solo año (ej. "2021") → convertir a 01/01/YYYY
- Campos de clasificación en Excel que no coinciden con catálogo → mapear o rechazar
- Columna COLOR del Excel → ignorar (no se usa en el CRM)
- Institución mezclada con ubicación física en Excel → separar según contexto

---

## SOP-005: Carga Masiva (Importación en Lote) — IMPLEMENTADO
1. Usuario sube archivo Excel/CSV desde `/abogada/importar`
2. Parsear archivo con SheetJS (xlsx): detecta hojas Clientes y Expedientes automáticamente
3. Mapeo flexible de columnas: soporta encabezados en español e inglés, case-insensitive
4. Ejecutar validaciones (SOP-004 paso 3)
5. Wizard de 4 pasos:
   - **Paso 1:** Upload del archivo + descarga de plantilla
   - **Paso 2:** Preview con tabla de clientes/expedientes, errores, advertencias, duplicados
   - **Paso 3:** Confirmación con estadísticas finales + opción omitir duplicados
   - **Paso 4:** Resultado con contadores de creados/omitidos/errores
6. Auto-genera client_number (CLI-NNN) y case_code (PREFIX-NNN) secuenciales
7. Si un expediente referencia un cliente inexistente, lo crea automáticamente
8. Audit log con field="import" y source="bulk_import"
9. Roles permitidos: admin, abogada
10. API: POST /api/import (mode=preview | mode=execute)

**Archivos:**
- Parser: `src/lib/utils/import-parser.ts`
- API: `src/app/api/import/route.ts`
- UI: `src/components/import/import-wizard.tsx`
- Página: `src/app/(dashboard)/abogada/importar/page.tsx`

---

## SOP-006: Pre-Deploy Checklist (13 pasos)
1. Todos los tests pasan
2. Linting sin errores
3. Build local exitoso (`next build`)
4. Env vars de producción verificadas
5. Migraciones de DB aplicadas en prod (si aplica)
6. RLS policies verificadas
7. Funcionalidad crítica probada con Playwright MCP
8. Changelog actualizado
9. Diff review del merge a main
10. **PAUSA — solicitar aprobación de Oliver**
11. Merge a main
12. Verificar deploy automático en Vercel (cuenta del CLIENTE)
13. Verificación post-deploy: abrir URL de prod, probar flujos críticos

---

## SOP-007: Gestión de Documentos Adjuntos
1. Usuario selecciona archivo desde UI (input file, botón 48px+)
2. Validar tipo y tamaño (dentro de límites de Supabase Storage)
3. Subir a Supabase Storage en bucket organizado: `/{tenant_id}/{entity_type}/{entity_id}/{filename}`
4. Crear registro en tabla `documents` con metadatos
5. Mostrar en lista de documentos del cliente/expediente
6. Descargar: generar signed URL temporal desde Supabase Storage

**Edge cases:**
- Archivo duplicado (mismo nombre) → agregar timestamp al nombre
- Upload falla → retry automático, mostrar error si persiste
- Offline → encolar upload, sync al reconectar (archivos < 5MB)

---

## SOP-008: Self-Annealing (Ciclo de Reparación)
1. **Analyze:** Identificar el error y su causa raíz
2. **Document:** Registrar en `findings.md` (error, contexto, causa, impacto)
3. **Patch:** Implementar corrección
4. **Test:** Verificar con Playwright MCP que funciona
5. **Update SOP:** Si el error revela un gap en los SOPs, actualizar el SOP relevante
6. **Commit:** Auto-commit con mensaje descriptivo

---

## SOP-009: Verificación con Playwright MCP
1. **ANTES de cada cambio:** `playwright_navigate` a localhost:3000, verificar estado actual
2. Implementar cambio
3. **DESPUÉS del cambio:** `playwright_navigate` a localhost:3000, verificar:
   - La página carga sin errores
   - El cambio se refleja visualmente
   - No hay regresiones en funcionalidad existente
   - Mobile viewport (375px) se ve correcto
4. Si hay errores → Self-Annealing (SOP-008)
5. Si OK → commit y reportar

---

## SOP-010: Borrado de entidades con dependencias (FK RESTRICT)

Regla general para cualquier hard delete: **todas las validaciones van ANTES del primer
borrado**. Si una validación queda después de un borrado parcial (documentos, storage,
filas hijas), un fallo posterior deja el sistema en estado inconsistente y con pérdida
de datos.

### Orden obligatorio en el handler
1. Auth + rol.
2. La entidad existe y pertenece al tenant.
3. **Todos** los chequeos de dependencias (conteos).
4. — recién acá — borrados en cascada manual (storage, documentos).
5. DELETE de la entidad.
6. `audit_log`.

### Cliente (`POST /api/clients/[id]/delete`)
Bloquean el borrado:
- `cases` → mensaje propio ("Elimina los casos primero").
- `invoices`, `quotes`, `credit_notes`, `payments` → FK sin `ON DELETE`
  (NO ACTION / RESTRICT). Conteo por `client_id` + `tenant_id`; el mensaje enumera
  solo los tipos con conteo > 0 y sugiere desactivar en lugar de eliminar.

Helpers en `src/lib/clients/delete-guards.ts` (núcleo puro, sin Supabase). El mismo
`buildFinancialBlockMessage()` lo usa el front (`delete-client-button.tsx`) para
deshabilitar el botón, así que UI y API dicen exactamente lo mismo.

### Defensa en profundidad
El `DELETE` final siempre debe capturar `error.code === '23503'`
(`foreign_key_violation`) y devolver **400 con mensaje amigable**, nunca el mensaje
crudo de Postgres con 500. Hoy cubre `prospects.converted_client_id`, que no está en
la lista de conteos. Al agregar una tabla nueva que referencie `clients`, sumarla a
`FINANCIAL_DEPENDENCIES` (o a su propio chequeo) para dar un mensaje específico.

### Nunca
- Exponer `error.message` de Postgres al usuario final.
- Borrar documentos o archivos de storage antes de saber que el DELETE va a proceder.

---

## SOP-011: Rutas nuevas de primer nivel y el gating del middleware

**Regla:** toda ruta que NO cuelgue de `/legal` ni de `/finanzas` necesita una excepción
EXPLÍCITA en `src/middleware.ts`, o el usuario termina rebotado sin ver la pantalla.

El gating por rol usa `ROLE_ROUTES`, donde cada rol declara los prefijos que puede abrir:
`"/"`, `"/legal"`, `"/finanzas"`. El prefijo `"/"` **matchea de forma EXACTA** (`pathname === "/"`),
no como prefijo de todo. Consecuencia: una ruta nueva como `/mi-pantalla` no matchea nada,
`hasAccess` da false y el middleware redirige a la home del rol. La pantalla nunca se ve, y
no hay error en consola que lo delate — parece que "no funciona el link".

Al crear una ruta de primer nivel, decidir en cuál de estos tres casos cae:

| Caso | Dónde va la excepción | Ejemplo |
|---|---|---|
| Pública, sin sesión | Junto al bloque de `/login` y `/api/auth`, ANTES del chequeo de auth | `/auth/recuperar`, `/cotizacion/[token]` |
| Con sesión, sin importar el rol | Después del timeout de sesión y ANTES de resolver el rol | `/nueva-contrasena` |
| Con sesión y rol específico | Agregarla a `ROLE_ROUTES` de los roles que corresponda | — |

### Cuidado extra con `/api/auth/*`
Ese bloque **rebota a `/` a cualquier usuario CON sesión**. Sirve para que un usuario logueado
no vuelva al login, pero rompe cualquier flujo que necesite procesar un token estando logueado.
Por eso `/auth/recuperar` es una ruta aparte y se exceptúa antes: si cayera en ese bloque, un
usuario con la sesión viva que pide recuperar su contraseña nunca llegaría a canjear el código.

### Verificación mínima (sin sesión, con `curl`)
```
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost:3000/<ruta-nueva>
```
Un 307 al login es correcto para rutas protegidas; un 307 a `/` o a `/legal` significa que el
gating por rol la está rebotando y falta la excepción.

---

## SOP-012: Entornos — staging vs. producción

**Vigente desde Fase 0 (2026-08-25).** Antes de esta fecha `localhost` escribía en la base
real del bufete. Ya no.

### Por qué existe esta separación

El módulo contable escribe asientos **inmutables**: los triggers de
`sql/pending/023_contabilidad_fase1_ledger.sql` rechazan `UPDATE` y `DELETE` sobre
`journal_entries`, `journal_entry_lines` y `accounting_legajos`. Un asiento equivocado no se
borra — se revierte con otro asiento, y los dos quedan en el libro. Eso significa que una
prueba hecha por error contra producción **contamina permanentemente** los libros que el
contador tiene que certificar ante la DGI.

### Las dos bases

| | Proyecto Supabase | Quién apunta acá | Datos |
|---|---|---|---|
| **Staging** | `xtyenhakplrkyifbcaow` | `.env.local`, y los entornos Preview y Development de Vercel | Ficticios. Se puede romper |
| **Producción** | `uqmmkklbhzxqybljiecs` | **Solo** el entorno Production de Vercel | Reales. Se toca únicamente por deploy a `main` |

**Regla:** producción no se toca desde una máquina. Ni con un script, ni con el SQL Editor
"para una cosita rápida", ni poniendo sus credenciales en `.env.local`. El único camino a
producción es un merge a `main` que dispare el auto-deploy.

### Cómo saber contra qué base estás

De un vistazo: **la banda de arriba de todo**.

| Banda | Entorno |
|---|---|
| Ámbar con rayas, "STAGING — DATOS DE PRUEBA" | Staging |
| Violeta con rayas, "LOCAL — DATOS DE PRUEBA" | Local |
| Roja, "⚠ ENTORNO SIN DEFINIR" | Falta `NEXT_PUBLIC_APP_ENV` — **no confíes en la pantalla** |
| **Sin banda** | Producción |

La banda no se puede cerrar y sale en toda pantalla, incluido el login y el portal público de
cotizaciones. Vive en `src/components/env-banner.tsx`; la lógica de resolución está en
`src/lib/env/app-env.ts`.

Si en producción llegara a aparecer la banda roja, la app **sigue funcionando** — es solo un
aviso de que falta la variable. Se arregla cargando `NEXT_PUBLIC_APP_ENV=production` en Vercel.

### Levantar el entorno de staging desde cero

Hace falta `.env.staging-db.local` con la connection string del **session pooler**
(puerto 5432; el de transacción, 6543, no sirve para DDL). Está ignorado por git:

```
STAGING_DATABASE_URL=postgresql://postgres.<ref>:<password>@<host>:5432/postgres
```

```bash
node scripts/apply-staging-sql.mjs --reset   # esquema, de cero
npm run seed:staging                          # datos ficticios
```

El script aplica los 48 archivos en orden, uno por uno, y corta en el primero que falle
diciendo cuál fue. Tiene el mismo candado anti-producción que el seed. `--check` solo
reporta el estado sin escribir.

**Por qué no se usa la `service_role` key:** no puede ejecutar DDL. PostgREST solo habla de
tablas, `/pg/query` responde 404 y no hay RPC tipo `exec_sql`. (Ese 404 es también la razón
por la que `scripts/run-migration.mjs` nunca funcionó: apunta justo a ese endpoint.)

**Alternativa sin connection string:** `node scripts/build-staging-bundle.mjs` arma
`sql/staging/bundle-1-schema-base.sql` y `bundle-2-pending.sql` con exactamente el mismo
SQL, para pegar a mano en el SQL Editor. El separador `ARCHIVO n/N` marca dónde se corta si
algo falla.

Los bundles **excluyen a propósito** `20260402000003_seed_clients_cases.sql`, que contiene
23 clientes y 46 casos **reales** del bufete sacados del Excel. Copiar eso a staging sería
una violación de la Ley 81 y justamente lo que Fase 0 vino a evitar. La lista completa de
exclusiones está en `docs/staging/inventario-migraciones.md` §4.

Al terminar, verificar que la banda ámbar aparece y que se puede entrar con
`admin@staging.test`.

### Divergencias conocidas entre staging y producción

Son **dos** de nombre, más una migración que se saltea a propósito. Ninguna es de lógica.
**Quien escriba una migración nueva tiene que conocerlas.**

| # | Producción | Staging | Por qué |
|---|---|---|---|
| 1 | `auth.tenant_id()` y `auth.user_role()` | `public.tenant_id()` y `public.user_role()` | En los proyectos Supabase **nuevos** el esquema `auth` está reservado: no puede escribir ahí ni el rol de la conexión (`postgres`) ni el del SQL Editor (`dashboard_user`). Producción se creó en abril de 2026, cuando todavía se podía |
| 2 | `idx_payments_tenant` sobre **`payments`**. `client_payments` quedó **sin** índice sobre `tenant_id` | `idx_payments_tenant` sobre `client_payments` + `idx_payments_tenant_fin` sobre `payments`: las **dos** indexadas | Dos migraciones definen el mismo nombre de índice sobre tablas distintas, y los nombres son globales por esquema. En prod se resolvió a mano quitando el viejo; acá corrieron de corrido |
| 3 | La **sección 5** de `20260508000002` no está aplicada: `quote_lines.subtotal/tax_amount/line_total` siguen `GENERATED ALWAYS` | Igual — la sección 5 se omite a propósito | El archivo dice "YA APLICADO" pero esa sección nunca corrió (tiene un bug de sintaxis). Staging la saltea para no divergir. **No es divergencia: es lo que evita una** |

Sobre la divergencia 2, verificado en producción el 2026-08-25: **es staging el que está
mejor**. En producción `client_payments` no tiene índice sobre `tenant_id` — impacto bajo hoy
(25 filas), pero es un arreglo pendiente del lado de producción, no de staging.

**Si una migración nueva referencia `auth.tenant_id()`**, va a funcionar en producción y no
en staging. `scripts/apply-staging-sql.mjs` reescribe las referencias al vuelo, así que
alcanza con que la migración pase por ese script. Escribirla directo en el SQL Editor de
staging, no.

Convergir producción a `public.*` está anotado en `task_plan.md` como pendiente con sprint
propio: implica recrear todas las políticas de RLS.

Los detalles de cada divergencia están en `scripts/staging-public-helpers.mjs` y
`scripts/staging-fixups.mjs`, con la consulta para verificar qué tiene producción.

### Regenerar los datos de prueba

`npm run seed:staging` es idempotente: correrlo de nuevo no duplica nada. Cada fila tiene un
UUID determinístico (UUIDv5) derivado de su clave natural — el estado "En trámite" es siempre
el mismo UUID. Eso es lo que evita que vuelva a pasar lo de `cat_statuses` con 7 filas donde
debía haber 2.

**Excepción:** cotizaciones y facturas se crean solo si no existen; si ya están, el seed las
deja como están. Los triggers T1/T2/T4/T5b/T5c del módulo Finanzas prohíben modificar líneas
o campos de un documento que salió de `borrador`, así que un upsert reventaría. Lo que el
seed sí repara es un documento que quedó **sin líneas** porque una corrida anterior se cortó
entre la cabecera y el detalle: le agrega las líneas que faltan, siempre que siga en
`borrador`.

Para regenerar todo de cero: `node scripts/apply-staging-sql.mjs --reset` y de nuevo el seed.
El `--reset` dropea el esquema `public` y lo recrea con los grants de Supabase; **no toca
`auth`**, así que los usuarios de prueba sobreviven y no hay que volver a repartir claves.

Si hace falta que los reportes den los mismos totales que producción, el plan de cuentas se
puede sembrar con los saldos de apertura reales:

```bash
SEED_SALDOS_REALES=1 npm run seed:staging
```

Por defecto van en 0, para que todo lo que muestre un reporte venga de los montos redondos
del seed y se pueda validar a mano.

### Usuarios de prueba

| Rol | Email | Contraseña |
|---|---|---|
| admin | `admin@staging.test` | `Staging2026$Admin` |
| abogada | `abogada@staging.test` | `Staging2026$Abogada` |
| abogada | `abogada2@staging.test` | `Staging2026$Abogada2` |
| asistente | `asistente@staging.test` | `Staging2026$Asistente` |
| contador | `contador@staging.test` | `Staging2026$Contador` |

Nombres inventados a propósito — ninguno es el de una licenciada. El dominio `.test` está
reservado por RFC 2606: no resuelve, así que ningún correo puede salir hacia una persona real.

### Cambiar de entorno

**No hay que cambiar de entorno.** `.env.local` apunta a staging y se queda ahí.

Si alguna vez hiciera falta leer producción desde la máquina — un diagnóstico puntual, nada
más — se hace en el SQL Editor del dashboard de Supabase con consultas de **solo lectura**, y
nunca reapuntando `.env.local`. El `.env.local` que apuntaba a producción quedó respaldado en
`.env.backup-produccion-2026-08-25.local` (ignorado por git); está ahí para recuperar las
credenciales de eFactura y Resend, no para volver a usarlo tal cual.

### Variables de entorno en Vercel

| Variable | Production | Preview | Development |
|---|---|---|---|
| `NEXT_PUBLIC_APP_ENV` | `production` | `staging` | `staging` |
| `NEXT_PUBLIC_SUPABASE_URL` | proyecto de prod | proyecto de staging | proyecto de staging |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon de prod | anon de staging | anon de staging |
| `SUPABASE_SERVICE_ROLE_KEY` | service de prod | service de staging | service de staging |

El resto de las variables (eFactura, Resend, CRON) no cambian por entorno hoy. **Ojo con
`RESEND_API_KEY` en Preview:** la cuenta tiene `integra-panama.com` verificado y manda correo
real. En `.env.local` está comentada por eso mismo.

#### Cómo se cargan en el panel (el orden importa)

Vercel **no acepta dos variables con la misma clave si sus entornos se solapan.** Las tres de
Supabase ya existían con alcance "All Environments" apuntando a producción, así que la de
staging no se puede crear encima: hay que ir en este orden.

1. Entrar a **`/settings/environment-variables`**. El selector de entornos **solo es editable
   ahí**; desde la vista por entorno aparece bloqueado.
2. **Acotar la que ya existe, sin tocarle el valor**: de "All Environments" a solo
   **Production**. Es la que apunta a la base real — se le reduce el alcance y nada más.
3. **Recién entonces crear la de staging**, con alcance "All Pre-Production Environments"
   (Preview + Development).

Al revés no funciona: Vercel rechaza la segunda por clave duplicada.

**Cargarlas no alcanza.** Vercel no aplica variables a deploys ya construidos: hasta que no se
dispare un deploy nuevo, el preview sigue corriendo con las de antes. Cualquier commit a
`develop` sirve para forzarlo.

Para verificar el alcance sin esperar un build:

```bash
vercel env pull ./tmp.env --environment=preview
```

Tiene que devolver `NEXT_PUBLIC_APP_ENV="staging"` y un `NEXT_PUBLIC_SUPABASE_URL` con el ref
de staging. **Nunca correr el equivalente con `--environment=production`**: eso baja las
credenciales reales de la base del bufete a la máquina, que es exactamente lo que esta
separación existe para evitar. Y borrar el archivo después.

### Antes de dar por bueno un cambio

Correrlo contra staging con datos de prueba, no contra producción. Ese es el punto de todo
esto.

---

## SOP-013: Plan de cuentas — vocabulario NIIF 18 y como tocarlo

### Las tres fuentes que se mueven JUNTAS

El vocabulario contable vive en tres lugares y los tres tienen que decir lo mismo:

1. `src/lib/finanzas/types/chart-of-account.ts` — **la fuente de verdad**.
   `ACCOUNT_TYPES`, `SUBCATEGORIAS_POR_TIPO`, labels en español.
2. El CHECK `coa_resultado_subcategoria_niif18` en BD (migracion `025`), que espeja
   `SUBCATEGORIAS_POR_TIPO`.
3. `src/lib/finanzas/import/chart-of-accounts-mapping.ts`, que traduce los encabezados del
   Excel de Josuar a ese vocabulario.

Si se agrega o saca un valor, van los tres o el sistema queda inconsistente: la UI ofrece
algo que la BD rechaza, o el import carga algo que el reporte no sabe agrupar.

### Regla de oro: el tipo decide la seccion, la subcategoria decide el grupo

`buildEstadoResultado()` deriva sus tres secciones del `account_type`
(`income` / `cost` / `expense`), NO de la subcategoria. Es lo que garantiza que ninguna
cuenta pueda evaporarse del reporte: cada cuenta tiene exactamente un tipo.

**Antes de NIIF 18 no era asi** y por eso hay que tener cuidado al leer codigo viejo: costos
y gastos compartian `account_type='expense'` y se separaban por `subcategoria`. Si alguien
reintroduce ese patron, mover una cuenta de subcategoria la puede tirar fuera del reporte.

### Cambiar el tipo de una cuenta rompe el reporte si no se mueve el codigo

Es la leccion del Sprint 2E.1 aplicada de nuevo: **schema y codigo en lock-step.** La
migracion `025` y el cambio de `accounting-reports.ts` van en el MISMO commit. Si se aplica
solo la migracion, las 6 cuentas de costo dejan de estar en `expense`, no estan en `income`,
y el Total de Costos queda en 0 sin que nada falle a gritos.

### Como verificar que los reportes siguen cuadrando

El criterio de aceptacion NO es que compile: es que los totales sigan dando lo mismo que el
Excel del contador.

```bash
npx tsx --test src/lib/finanzas/reports/__tests__/accounting-reports.test.ts
```

Compara contra `josuar-accounts.fixture.ts`, que son las 62 cuentas reales con sus saldos.
Los cinco totales del Estado de Resultado y los cinco del Balance estan clavados ahi. Una
reclasificacion NO debe moverlos: la plata es la misma, solo cambia donde se agrupa.

Contra la base, la misma verificacion sale de la app: `/finanzas/reportes/pyl` y
`/finanzas/reportes/balance` con la sesion de `admin@staging.test`.

### Permisos — donde se hacen cumplir

En `updateChartAccount()` (`src/lib/finanzas/api/chart-of-accounts.ts`), **no en la ruta**:
la restriccion es POR CAMPO, no por endpoint. La abogada entra al PATCH porque puede
renombrar; lo que no puede es tocar `account_type` ni `subcategoria`.

Cubierto por `src/lib/finanzas/api/__tests__/chart-of-accounts-permisos.test.ts`.

### La regla de "cuentas con movimientos" ya esta puesta aunque no aplique todavia

`contarMovimientos()` consulta `journal_entry_lines`, que hoy esta VACIA: el motor de posteo
llega en la Fase 2. O sea que hoy la regla nunca dispara. Esta implementada igual, a
proposito — cuando empiecen a entrar asientos ya esta, en vez de acordarse despues de haber
reclasificado una cuenta con movimientos.

Si `contarMovimientos()` falla, **bloquea**: ante la duda no se asume que la cuenta esta
libre.

### Las DOS convenciones de signo — la trampa más cara de este módulo

Conviven dos, a propósito, y confundirlas rompe reportes en silencio:

| | Convención | Dónde |
|---|---|---|
| **Balanza** | saldos tal cual: débito +, crédito − | `accounting-reports.ts`, Balance General, el fixture, TODOS los tests |
| **Reporte** | ingresos +, costos y gastos entre paréntesis | SOLO `estado-resultado-niif18.ts` |

**El vuelco vive únicamente en la capa de presentación del Estado de Resultado.** No se
invierte el motor. Si alguien "arregla" los signos en `accounting-reports.ts` porque le
parecen al revés:

- el Balance General deja de cuadrar (su cuadre es `Activo + (Pasivo + Patrimonio) = 0`, que
  solo se cumple en balanza), y
- se pierden los tests contra el Excel de Josuar, que son la única red que hay.

La regla de presentación completa, sin casos especiales:

```
monto = |balanza|        va entre paréntesis  ⟺  balanza > 0
```

Sirve para todo renglón porque en balanza un débito siempre reduce el resultado y un crédito
siempre lo aumenta. El caso que lo prueba es `430001 Descuentos otorgados`: es un DÉBITO
dentro de INGRESOS y tiene que leerse restando — sale `(663.25)`.

### El oráculo: cómo se evita que las dos vistas diverjan

`buildEstadoResultado()` (balanza) y `buildEstadoResultadoNiif18()` (reporte) calculan lo
mismo por caminos distintos. El test **"EL ORÁCULO"** de
`estado-resultado-niif18.test.ts` compara la Utilidad Operativa de los dos. Si alguien toca
uno y la plata deja de coincidir, salta ahí.

No borrar `buildEstadoResultado()` aunque la UI ya no lo use: es la referencia contra el
Excel del contador.

### Sociedad civil: por qué el ISR es 0 y el ejercicio cierra en cero

Integra es sociedad civil y no paga ISR a nivel de empresa: reparte a las socias y cada una
paga su renta personal. Por eso `DEFAULT_ISR_RATE = 0` y hay una sección de distribución que
deja el resultado del ejercicio en 0 **por construcción** (la distribución es el opuesto
exacto de la utilidad neta).

`isrRate` y `distribucionASocias` siguen siendo parámetros: para una sociedad anónima se
pasa la tasa y `distribucionASocias: false`, sin tocar la lógica del reporte.

El código de la cuenta de distribución (`300004`) es un **parámetro**, no un literal
regado por el código: `CUENTA_DISTRIBUCION_SOCIAS` en `estado-resultado-niif18.ts`. Es
provisional hasta que Josuar lo confirme.

### Fecha del saldo inicial — la regla y su trampa

`saldo_inicial_fecha` es DATE y es **obligatoria en cuanto `saldo_inicial <> 0`** (CHECK
`coa_saldo_inicial_requiere_fecha` + validador). Con saldo 0 se guarda null.

La regla NO depende de cuál sea la fecha de corte correcta —que es una consulta abierta con el
contador—: dice solamente que un saldo cargado tiene que declarar a qué día corresponde. Eso
es cierto en cualquier escenario.

**Trampa al cargar cuentas desde el Excel:** la plantilla no tiene columna de fecha. El import
usa `inicioPeriodoFiscal(añoActual)` y, en los UPDATE, preserva la fecha que ya tenga la
cuenta. Si alguna vez se agrega la columna al Excel, hay que sacar ese default o va a pisar lo
que traiga el archivo.

### Lo que hay cargado NO es una apertura al 1 de enero

Verificable en un comando:

```sql
SELECT CASE WHEN account_type IN ('income','cost','expense') THEN 'resultado' ELSE 'balance' END,
       ROUND(SUM(saldo_inicial), 2)
FROM chart_of_accounts WHERE active GROUP BY 1;
```

Da `balance 244,476.91` y `resultado -244,476.91`. En una apertura de verdad al 1 de enero las
de resultado darían 0 y las de balance cuadrarían solas contra el patrimonio.

**Consecuencia para la Fase 2:** el asiento de apertura no se puede armar solo con las cuentas
de balance —no cuadraría, le faltaría exactamente el resultado acumulado— y armarlo con TODAS
metería movimiento del ejercicio dentro de un asiento que dice ser de apertura. Está pendiente
de confirmación del contador antes de escribir el motor de posteo.

### La cuenta del reembolso: `130003`, y por qué el lado importa (03/09/2026)

Los servicios `REIM-*` de `services_catalog` apuntan a **`130003 Fondo Legales de Clientes`**.
Lo decidió el acta del 25/08: *"Reembolso al facturar: HABER 130003, nunca ingreso"*.

Hasta el 03/09 apuntaban a `2201 Cuentas por pagar a clientes`, que es como se sembraron en
`20260505000002:202-203` y `sql/pending/012:112-115`. Lo corrige
`sql/pending/035_reembolso_a_fondos_legales.sql`.

**No es lo mismo con otro nombre: `2201` es un PASIVO y `130003` un ACTIVO.** Acreditar un
pasivo lo AUMENTA; acreditar un activo lo DISMINUYE. El acta decidió dos asientos que forman
un par y solo cierran del lado del activo:

```
Al incurrir el gasto de trámite:  DEBE 130003  /  HABER Cuentas por Pagar
Al facturar el reembolso:         DEBE CxC     /  HABER 130003
```

El bufete adelanta plata por el cliente (el activo sube) y al facturarle el reembolso el
adelanto se cancela contra la cuenta por cobrar: **`130003` vuelve a cero** y lo que el cliente
debe queda entero en CxC, sin tocar una cuenta de ingreso. Con `2201` en su lugar, facturar el
reembolso inflaría un pasivo en vez de cancelar el adelanto, y el fondo del cliente quedaría
contado dos veces.

El modelo viejo —tratar el fondo del cliente como una deuda del bufete hacia él— no es un
error contable en abstracto, pero **no es el que eligió RM y conviven mal**: hay que elegir uno.

🔗 **La regla vive en DOS lugares y hay que mover los dos:**

| Situación | Dónde |
|---|---|
| Base que YA existe (staging hoy, producción algún día) | `sql/pending/035_reembolso_a_fondos_legales.sql` |
| Base recién armada (`--reset` + seed) | `apuntarReembolsosAFondosLegales()` en `scripts/seed-staging.ts` |

**Por qué 035 NO está en `BUNDLE_2`:** necesita que `130003` exista, y esa cuenta no viene de
ninguna migración — la crea `npm run seed:staging` desde el Excel de las 62 cuentas. El bundle
corre ANTES del seed, así que ahí la migración abortaría en toda base reseteada. La nota larga
está en `scripts/staging-migration-order.mjs`.

⚠️ **Los `HON-*` siguen en `4101`, a propósito.** Qué cuenta de ingreso ACTIVA va en cada
servicio es una de las tres definiciones que faltan del contador. `4101` es del plan viejo y
está inactiva: postear contra ella es peor que no postear. Por eso el seed la deja inactiva
pero existiendo — para no romperle el FK a `services_catalog`.

---

## SOP-014: El ledger — cómo se escribe y cómo NO

### Regla única: al ledger se escribe SOLO por `post_journal_entry`

Nunca con un INSERT directo a `journal_entries` / `journal_entry_lines`, ni desde la app ni
desde el SQL Editor. El RPC es lo que garantiza partida doble, correlativo sin huecos,
período válido y cadena de hash. Un INSERT a mano se saltea las cuatro cosas **y no se puede
deshacer**: los triggers de 023 rechazan UPDATE y DELETE.

Del lado de TypeScript se llama con `postJournalEntry()`
(`src/lib/finanzas/contabilidad/posting.ts`), que es un envoltorio y **no repite ninguna
validación del RPC** — a propósito. Dos copias que se desincronizan dan la ilusión de que algo
está validado cuando ya no lo está.

### Por qué el motor vive en la base y no en la app

Un asiento son dos escrituras y supabase-js no tiene transacciones multi-statement. Si la
segunda falla, la cabecera queda escrita y **no se puede borrar**. El resultado sería un
asiento sin líneas, descuadrado, permanente, en los libros que se certifican ante la DGI.

Es la misma razón por la que cualquier operación futura que escriba más de una fila del ledger
(el asiento de apertura, el cierre de ejercicio) tiene que ser también una función.

### Al ledger no se puede escribir directo — ni siquiera con la service key

Desde la migración `030`:

| | anon | authenticated | service_role |
|---|---|---|---|
| INSERT / UPDATE / DELETE / TRUNCATE en el ledger | ✗ | ✗ | ✗ |
| SELECT | ✓ | ✓ | ✓ |
| EXECUTE del RPC | ✗ | ✗ | ✓ |

`post_journal_entry` y `ensure_accounting_periods` son **SECURITY DEFINER**;
`verify_accounting_chain` sigue INVOKER porque solo lee.

**El orden de esos tres cambios importa y está explicado en el encabezado de la 030.** En
resumen: con SECURITY DEFINER y EXECUTE en PUBLIC se pasaría de "puede falsificar la cadena de
su propio tenant" a "puede escribir en el de cualquiera".

🔴 **Y ojo con lo que se mudó de la base al código:** SECURITY DEFINER significa que el RPC
**ya no corre bajo RLS** y confía en el `p_tenant_id` que recibe. La ruta de API que lo llame
tiene que sacar el tenant del usuario autenticado y **nunca del cuerpo del request**.

### Cómo correr las pruebas del motor

```bash
node scripts/run-sql.mjs sql/tests/motor-posteo.test.sql
```

Corre dentro de una transacción que termina en ROLLBACK, así que se puede lanzar contra una
staging con datos sin miedo. Cubre 14 comprobaciones: posteo válido, correlativo, encadenado
del hash, verificador, nueve rechazos, y la auto-creación acotada de períodos.

`scripts/run-sql.mjs` sirve además para aplicar una migración suelta sin `--reset`, y lleva el
mismo candado anti-producción que el aplicador.

### Antes de postear hace falta que exista el período

El motor **auto-crea los períodos del año en curso y del siguiente**, y nada más.

La cota resuelve el problema real —el 1 de enero el primer asiento del año fallaba hasta que
alguien se acordara, y enero es justo cuando el contador cierra un ejercicio y abre el otro—
sin perder el freno que importa: un 2029 escrito por error sigue fallando fuerte en vez de
abrir doce períodos en silencio.

Los años PASADOS tampoco se abren solos: que un período viejo no exista significa que ese
ejercicio nunca se abrió, y crearlo ahora dejaría postear dentro de un año fiscal que el
contador ya certificó.

Para cualquier año fuera de esa cota, a mano:

```sql
SELECT ensure_accounting_periods('a0000000-0000-0000-0000-000000000001', 2030);
```

### ⚠️ El hash se calcula en la BASE — la 023 dice lo contrario y está desactualizada

`sql/pending/023_contabilidad_fase1_ledger.sql`, línea 23, dice:

> "Hash-chain SHA-256; se computa en la app, se verifica en la BD (Fase 2)."

**Eso ya no es cierto, y el archivo no se puede corregir en su lugar porque está aplicado.**
Queda anotado acá y en el CLAUDE.md.

Se hace al revés por un motivo concreto: `prev_hash` es el hash del asiento anterior, así que
calcularlo en la app obliga a leer el último asiento y después escribir. Dos posteos
concurrentes leerían el MISMO `prev_hash` y bifurcarían la cadena en silencio — exactamente lo
que una cadena de hash existe para impedir.

Dentro del RPC, el `SELECT ... FOR UPDATE` sobre la fila de `accounting_sequences` serializa
las dos cosas con un solo candado: el correlativo sin huecos y la cadena. `sha256()` es nativo
desde PostgreSQL 11 (la base corre 17.6), así que no hace falta pgcrypto.

### Verificar la integridad de la cadena

```sql
SELECT * FROM verify_accounting_chain('a0000000-0000-0000-0000-000000000001');
```

Sin filas = cadena íntegra. Conviene correrla antes de sellar el legajo anual y ante cualquier
sospecha. Desde TS: `verifyAccountingChain()`.

### Cómo se prueba el motor sin ensuciar la base

Los asientos son INMUTABLES: unos de prueba no se podrían borrar después. La prueba de punta a
punta corre **dentro de una transacción que termina en ROLLBACK**. Los triggers solo se
disparan con UPDATE y DELETE reales, así que un rollback no los toca y no deja nada.

### ⚠️ Al tocar un CHECK anónimo, filtrar por su CONTENIDO, no solo por la columna

Los CHECK inline de 023 no tienen nombre propio, así que hay que descubrirlos por su
definición. La primera versión de la 028 usó `ILIKE '%source_type%'` y **dropeó dos**: el enum
que quería ampliar y `je_reversion_requires_ref`, que también menciona la columna y hace
cumplir el Art. 5.7.

Antes de dropear algo descubierto dinámicamente, **listar primero qué matchea**:

```sql
SELECT con.conname, pg_get_constraintdef(con.oid)
FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
WHERE rel.relname = 'journal_entries' AND con.contype = 'c';
```

Y que la migración avise por `RAISE NOTICE` de cada uno que elimina: así fue como se cazó.

### La CONTRAPARTIDA se decide en UN solo archivo

`src/lib/finanzas/contabilidad/contrapartida.ts`. Está aislada porque la respuesta del contador
sobre qué mostrar cuando el asiento tiene más de dos líneas cae exactamente ahí.

Para saber si una contrapartida es ambigua, usar `contrapartidaEsAmbigua()` y **nunca comparar
el texto contra "Varios"**: esa etiqueta es lo primero que va a cambiar.

---

### 🔴 REGLA GENERAL: un `DROP FUNCTION` se lleva los GRANT

> **Toda migración que haga `DROP` + `CREATE` de una función `SECURITY DEFINER`
> tiene que RE-DECLARAR sus `GRANT` y VERIFICARLOS antes de cerrar.** El `DROP` se
> lleva los privilegios, y la función nueva nace con `EXECUTE` para `PUBLIC`.

**Por qué es de lo más difícil de detectar: nada falla.** La migración corre limpia,
la función anda, los tests pasan y los reportes dan bien. Lo único que cambió es que
un endurecimiento hecho en una migración anterior se deshizo **en silencio**, y no
hay ningún síntoma hasta que alguien lo busca a propósito.

Es una migración deshaciendo lo que hizo otra. Y va a volver a pasar, porque
`post_journal_entry` se toca seguido: lleva cuatro versiones (`028`, `029`, `030`,
`039`) en una semana.

#### El caso concreto: `030` → `039`

| | |
|---|---|
| La `030` | Revocó `EXECUTE` a `PUBLIC`, `anon` y `authenticated`, y se lo dio **solo a `service_role`**. Es lo que hace que el RPC NO sea llamable desde la sesión del usuario, y por lo tanto lo que obliga a que todo el posteo pase por una ruta server-side con el cliente de servicio |
| La `039` | Tuvo que **dropear** la función para pasarla de 11 a 13 parámetros (ver abajo por qué no alcanzaba `CREATE OR REPLACE`) |
| Sin el paso 3 de la `039` | El RPC habría vuelto a ser ejecutable por `anon` y `authenticated` — **exactamente lo que la `030` existe para impedir**, y sin un solo error en ningún lado |

#### La plantilla, para copiar

```sql
-- 1) DROP con la firma COMPLETA de la versión vieja.
DROP FUNCTION IF EXISTS public.mi_funcion(uuid, date, text);

-- 2) CREATE ... SECURITY DEFINER ...

-- 3) 🔴 REHACER LOS PERMISOS. No es opcional.
REVOKE EXECUTE ON FUNCTION public.mi_funcion(uuid, date, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.mi_funcion(uuid, date, text, text)
  TO service_role;

-- 4) VERIFICAR, y ABORTAR si no se cumple.
DO $verif$
DECLARE v_funcs int; v_definer int; v_publico int;
BEGIN
  -- Una sola firma viva: ver la nota de la sobrecarga.
  SELECT COUNT(*) INTO v_funcs FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'mi_funcion';

  SELECT COUNT(*) INTO v_definer FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'mi_funcion' AND p.prosecdef;

  SELECT COUNT(*) INTO v_publico FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'mi_funcion'
     AND (has_function_privilege('anon', p.oid, 'EXECUTE')
       OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));

  IF v_funcs   <> 1 THEN RAISE EXCEPTION 'ABORT: quedaron % firmas vivas', v_funcs; END IF;
  IF v_definer <> 1 THEN RAISE EXCEPTION 'ABORT: no quedó SECURITY DEFINER'; END IF;
  IF v_publico <> 0 THEN
    RAISE EXCEPTION 'ABORT: anon o authenticated pueden ejecutarla. El DROP se llevó los GRANT y no se rehicieron.';
  END IF;
END $verif$;
```

`has_function_privilege()` es la clave: pregunta por el permiso EFECTIVO, así que
agarra tanto el GRANT olvidado como el heredado de `PUBLIC`.

#### ⚠️ Y de paso: `CREATE OR REPLACE` NO reemplaza si cambia la firma

En PostgreSQL las funciones se sobrecargan por firma. `CREATE OR REPLACE` con un
parámetro más **crea una segunda función**, no reemplaza la primera. Las llamadas
viejas siguen entrando a la vieja.

En la `039` eso habría sido invisible: las cuatro llamadas de once argumentos
habrían seguido posteando **bien**, pero perdiendo el campo `reference` en silencio.
Nadie lo nota hasta que un contador pregunta por qué su referencia no aparece en el
Diario General.

Por eso el paso 4 cuenta las firmas vivas y aborta si hay más de una.

### 🧭 EL PATRÓN DE UNA RUTA QUE POSTEA (desde el 03/09/2026)

`app/api/expenses/[id]/post-to-ledger/route.ts` es la **primera ruta de `/api` que escribe en
el ledger**, y está pensada para que factura, cobro y compra la copien. Los seis puntos, en
orden:

1. **Auth → perfil → rol.** `createClient()` para la sesión, `createAdminClient()` para todo lo
   demás. El `tenant_id` sale de `users`, **nunca del body** — el RPC es `SECURITY DEFINER` y
   desde la `030` dejó de correr bajo RLS, así que la ruta es la única que valida contra qué
   bufete se escribe.
2. **Capa 1 — el cache.** `expenses.posted_entry_id` corta temprano sin pegarle al ledger. Es
   un cache: puede estar desactualizado, por eso no es la garantía.
3. **Capa 2 — la verdad.** `SELECT` sobre `journal_entries` por `(source_type, source_id)`. Da
   el mensaje entendible con el número de asiento. ⚠️ **Si ese SELECT falla, se ABORTA** — no se
   asume "no hay asiento": postear de más es lo único que no se puede deshacer.
4. **El armado, en un módulo PURO** (`contabilidad/asiento-gasto-tramite.ts`) que devuelve un
   resultado discriminado. Nada de I/O ahí adentro, y el compilador obliga a manejar el
   rechazo.
5. **El posteo, solo por `postJournalEntry()`.** Cero INSERT directo.
6. **Capa 3 — el UNIQUE de la `034`.** Es LA garantía: las capas 1 y 2 dejan una ventana entre
   el SELECT y el INSERT que dos requests simultáneos pasan. El `23505` se traduce **al mismo
   mensaje de la capa 2**: para quien apretó dos veces, las dos rutas tienen que contar lo mismo.

⚠️ **El código de Postgres viaja en `MutationError.detail`, NO en `cause`.** `postJournalEntry`
hace `new MutationError(msg, 422, error)` y el tercer argumento es `detail`. La primera versión
de la ruta miraba `cause` y contestaba 422 ("el asiento está mal armado") a un doble clic que en
realidad ya estaba posteado. Lo encontró su propio test.

⚠️ **Si el cache falla DESPUÉS del posteo, el request NO falla.** El asiento ya está en el libro
y eso es lo irreversible; devolver un error haría que alguien reintente un posteo que ya se hizo.
Se loguea y se sigue: la verdad la lee `getNumeroDeAsiento()` contra `journal_entries`.

### Un gasto asentado no se edita — y el guard vive en la BASE

`038` pone dos triggers (`expenses` y `expense_lines`). El gate de la ruta da el mensaje; el
trigger es el permiso. Toda la escritura de este módulo va con el cliente de servicio, que
**saltea RLS**: un script, el SQL Editor o una segunda ruta editan igual, y eso deja el asiento
diciendo una cosa y el documento otra, en silencio y para siempre.

La lista de lo editable con el gasto ya asentado es **BLANCA y explícita** — con una lista negra,
cada columna nueva de `expenses` nacería editable sin que nadie lo decida:

| ✅ Permitido | ❌ Rechazado |
|---|---|
| `receipt_url`, `receipt_filename` — escanear el recibo tarde no toca los libros | monto, fecha, concepto, caso, proveedor, vencimiento, cuenta de pago |
| `posted_entry_id` — es lo que escribe el propio posteo | agregar, modificar o borrar cualquier línea |
| | borrar el gasto |

🔒 Verificado contra staging con el RPC real y ROLLBACK:
`sql/tests/verificacion-038-inmutabilidad.sql`, ocho casos, 8/8.

### `gasto` y `gasto_tramite` son DOS `source_type` distintos

| valor | tabla | pantalla |
|---|---|---|
| `gasto` | `business_expenses` (compras del bufete) | `/finanzas/gastos-bufete/{id}` |
| `gasto_tramite` | `expenses` (módulo Legal) | `/finanzas/gastos-tramite/{id}` |

Compartirlos mandaría un gasto de trámite a la pantalla de compras con un id que ahí no existe —
el bug del 01/09/2026 que originó `destino-documento.ts`. Un valor nuevo tiene además **cero
backfill**. Las tres fuentes se mueven juntas: el CHECK de la base, `SourceType` en `posting.ts`
y `RUTA_DEL_DOCUMENTO`.

⚠️ **Al tocar ese CHECK, filtrar por CONTENIDO y no solo por columna.** Hay DOS que mencionan
`source_type` y la primera versión de la `028` dropeó los dos, perdiendo
`je_reversion_requires_ref` (ver `029`). La `038` filtra además por `'%factura%'` y **verifica al
final que ese constraint siga en pie**, que es la comprobación que le habría ahorrado la `029`.


## SOP-015: El bucket `documents` es PRIVADO

### Qué significa privado, y qué NO significa

Privado quita **la URL anónima**: `/storage/v1/object/public/documents/...` deja de servir
nada. No dice nada sobre quién puede leer qué — **eso lo deciden las políticas de
`storage.objects`**, que son cosa aparte.

Las dos piezas tienen que estar. Un bucket privado sin políticas por tenant seguiría dejando
que un usuario del bufete A leyera los archivos del B.

### Cómo se lee un archivo

Siempre por **URL firmada con vencimiento** (`createSignedUrl`) generada del lado servidor, o
por `download()` con el cliente de servicio.

🔴 **NUNCA `getPublicUrl()`.** No hay ni un uso en el repo y no debe haberlo: con el bucket
privado devuelve una URL que da 400, y el error no se ve hasta que un usuario hace clic.

Si aparece una variable llamada `publicUrl` o `receiptPublicUrl`, es un nombre viejo que
miente — todas llevan URLs firmadas. Se renombraron a `signedUrl` justamente para que nadie
deduzca del nombre que puede usar `getPublicUrl`.

### Qué NO se rompe con el bucket privado (verificado)

- `scripts/backup-supabase.mjs` baja los archivos con la **service key**
  (`Authorization: Bearer`), no como anónimo.
- `src/lib/storage/direct-upload.ts` sube con el **JWT del usuario**. Las subidas siempre
  fueron autenticadas.
- El correo de cotización adjunta un **buffer** que sale de `db.storage.download()`, no de una
  URL. El portal público tampoco sirve el PDF por URL.

### Verificación de la propiedad de seguridad

No se prueba con clics: se prueba contra la API, que aísla exactamente lo que importa.

| Prueba | Esperado |
|---|---|
| Subir con el JWT del usuario a su propia carpeta | 200 |
| Leer su propio archivo con su JWT | 200 |
| URL firmada con service key | 200 |
| `/object/public/...` anónimo | **400** |
| `/object/...` sin token | **400** |
| Leer la carpeta de OTRO tenant con el mismo JWT | **400** |
| Subir a la carpeta de OTRO tenant | **400** |

Las políticas comparan `(storage.foldername(name))[1]` contra
`jwt -> app_metadata ->> 'tenant_id'`, y eso calza con la ruta que arma `direct-upload.ts`:
`${tenantId}/${prefijo}/${archivo}`. **Si alguna vez se cambia esa ruta, hay que mover las
políticas con ella** o el aislamiento se rompe en silencio.

### Producción

El cambio es de configuración y va con la **pausa obligatoria** del CLAUDE.md: lo hace Oliver.

Dashboard de Supabase → **Storage** → bucket `documents` → menú **···** → **Edit bucket** →
apagar **Public bucket** → **Save**.

**Reversible al instante** volviendo a encender el switch. No migra ni reescribe archivos: es
un flag en `storage.buckets.public`.

---

## SOP-016: Sembrar el ledger en staging (`seed:asientos`)

**Cuándo:** cuando staging necesita asientos con qué probar el Libro Mayor, o después de un
reset. **Nunca en producción**: el script tiene dos candados (project ref y
`NEXT_PUBLIC_APP_ENV`) y aborta antes de tocar nada.

### La secuencia, en orden

```
node scripts/apply-staging-sql.mjs --reset   # solo si hay que arrancar de cero
npm run seed:staging                          # clientes, casos, plan de cuentas, FACTURAS
npm run seed:asientos                         # gastos, pagos y los asientos
```

`seed:asientos` **depende** de `seed:staging`: las facturas y los pagos tienen que existir
antes, porque el asiento se arma desde el documento real. Si falta alguno, aborta diciendo cuál.

### Quién crea qué (cambió el 2026-09-01)

| documento | quién lo crea | dónde se declara |
|---|---|---|
| `invoices` + líneas | `seed:staging` | `SEED_INVOICES` |
| **`payments` + `payment_applications`** | **`seed:staging`** | **`SEED_PAYMENTS`** |
| `business_expenses` | `seed:asientos` | `GASTOS` |
| — (asiento de diario) | nadie: `source_id` va NULL | `DIARIO` |

**Los pagos vivían en `seed:asientos` y se mudaron a `seed:staging`.** El motivo está en
SOP-017: mientras los pagos vivieron en el segundo script, el primero dejaba facturas marcadas
"pagada" con `amount_paid` escrito a mano y sin un pago detrás. Hoy `seed:staging` produce por
sí solo un estado final coherente, y `seed:asientos` **consume** los pagos igual que ya consumía
las facturas — los busca por su `reference`.

Si hace falta un cobro nuevo: se agrega a `SEED_PAYMENTS`, **no** a `COBROS`. Al revés no
funciona; `seed:asientos` ya no crea pagos y aborta si el que nombra no existe. Y un pago no
necesita entrada en `COBROS`: la regla es *todo asiento tiene documento*, no *todo documento
tiene asiento* (ver el cobro de FAC-REI-000001, que a propósito no genera asiento).

### La regla: ningún asiento sin documento que exista

Todo `source_type` que aparezca en el fixture tiene su documento real. El asiento de diario
(`manual`) es el único sin documento, y por eso su `source_id` va en **NULL** — no un id
sintético.

**Los montos salen del documento, no al revés.** Un asiento que dice "factura X" por un
importe que no es el de X es un descuadre que después nadie sabe si es bug o dato de prueba.

### 🛡️ Si el seed aborta con "asientos que apuntan a un documento que NO existe"

**No lo forces y no borres nada.** Es el blindaje haciendo su trabajo, y el diagnóstico es
casi siempre el mismo: la clave de idempotencia del seed cambió después de que el seed corrió.

Pasó el **27/08/2026**. El script se editó doce minutos después de haber posteado, cambiando el
`source_id` de los asientos de factura de un UUIDv5 sintético al id de la factura real. Los
asientos ya escritos dejaron de reconocerse como propios, y una segunda corrida los habría
duplicado: doble ingreso, doble ITBMS, doble cuenta por cobrar. **Imborrable** — los triggers
de `023` rechazan DELETE — y sin un solo mensaje de error.

La salida es resetear y volver a sembrar, que es exactamente lo que el mensaje del abort dice.

### Por qué no alcanza con "correrlo de nuevo"

Un ledger es append-only: no hay upsert de un asiento. La idempotencia se apoya en una clave
externa (`source_id`, o (tipo, descripción, fecha) para el diario). Si esa clave se toca, la
idempotencia se rompe hacia atrás y no hay forma de repararla desde la app. De ahí la regla
práctica: **tocar cómo se calcula el `source_id` obliga a resetear staging**, no a re-correr.

### Qué deja sembrado (10 asientos, 27 líneas)

| # | tipo | documento | para qué caso del mayor |
|---|---|---|---|
| 1-3 | gasto | 3 `business_expenses` | uno de 4 líneas: varias cuentas contra UNA cuenta por pagar |
| 4 | manual | ninguno | 2 cuentas de cada lado → contrapartida **ambigua** |
| 5,8,9 | factura | FAC-HON-000001/2/3 | 3 líneas con ITBMS |
| 6 | factura | FAC-REI-000001 | REEMBOLSO exento → 2 líneas, contrapartida inequívoca |
| 7,10 | pago | 2 de los 3 `payments` | uno total y uno **parcial** |

El tercer pago (el de FAC-REI-000001, B/. 150.00) **no tiene asiento a propósito** — ver
`SEED_PAYMENTS` en `scripts/seed-data/staging-fixtures.ts`, donde está escrito el porqué:
sostenía el baseline de 2,895.00 entre el mayor de Cuentas por Cobrar y el Balance — **cerrado el
02/09/2026 con el backfill de los dos asientos que faltaban**, ver el bloque de idempotencia del
`changelog.md`. El neto pasó a 3,145.00 y la diferencia del auxiliar quedó con una sola causa
General (191,947.55), que es el número contra el que se va a validar la convergencia de
reportes.

La cuenta para verlo todo junto es `100004 Cuentas por Cobrar Clientes`: saldo inicial,
movimientos de los dos lados y saldo corrido. Y `610008 Utiles de Oficina` muestra en la misma
pantalla un renglón con enlace al documento y otro (el manual) sin enlace.

### Verificación después de sembrar

El script ya corre `verify_accounting_chain` y el blindaje al cerrar. Si querés confirmarlo
aparte, lo que tiene que dar:

```sql
SELECT (SELECT count(*) FROM journal_entries)                       AS asientos,      -- 10
       (SELECT count(*) FROM journal_entry_lines)                   AS lineas,        -- 27
       (SELECT count(*) FROM journal_entries je WHERE NOT EXISTS
         (SELECT 1 FROM journal_entry_lines l WHERE l.entry_id=je.id)) AS sin_lineas, -- 0
       (SELECT count(*) FROM verify_accounting_chain('<tenant>'))   AS cadena_rota;   -- 0
```

`sin_lineas` distinto de 0 **no es un problema del seed, es un agujero en el motor de posteo**:
el RPC es atómico y una cabecera sin líneas no debería poder existir. Eso pasa a ser prioridad
por encima de cualquier reporte.

---

## SOP-017: `invoices.amount_paid` es derivado — y desde ahora, garantizado

**Desde:** 2026-09-01 · migración `sql/pending/032_amount_paid_derivado.sql`

### La regla, en una línea

`invoices.amount_paid` NO se escribe. Se escribe el **pago**, y el trigger T7a deriva la
columna. Lo mismo vale para los estados de cobro (`parcialmente_pagada`, `pagada`), que también
los pone T7a.

```sql
-- ❌ NUNCA
UPDATE invoices SET amount_paid = 150 WHERE id = ...;

-- ✅ SIEMPRE
INSERT INTO payments (...) VALUES (...);
INSERT INTO payment_applications (payment_id, invoice_id, amount_applied) VALUES (..., 150);
-- T7a actualiza amount_paid Y el status. No hay paso 3.
```

Desde el 2026-09-01 el guard **T4b** (`finanzas_guard_amount_paid`) rechaza lo primero, en
UPDATE y en INSERT.

### Por qué existe el guard, si T7a ya hacía el trabajo

Porque *derivado* y *garantizado* no son lo mismo. T7a recalculaba la columna desde el día uno,
pero T4 (`finanzas_invoice_immutability`) autorizaba explícitamente escribirla a mano en una
factura emitida, y ningún grant lo impedía. La derivación estaba **acostumbrada**, no
garantizada — y un número derivado que además se puede escribir a mano se vuelve a desalinear
tarde o temprano.

Se cobró el **28/08/2026**: `seed-staging.ts` creaba FAC-REI-000001 con `amount_paid = 150.00`
y cero pagos. La pantalla mostraba "PAGADO $150.00" al lado de "Aún no hay pagos registrados".
Y como `balance_due` es `GENERATED ALWAYS AS (grand_total - amount_paid)`, el saldo falso en
0.00 además **escondía el botón "Registrar pago"**: un dato falso que encima desactivaba la
función que lo habría corregido.

### Qué NO cubre el guard

- **`status` sigue siendo escribible, y está bien.** No es una columna derivada: T7a solo opina
  sobre tres de sus seis estados. `borrador`, `cancelada_pre_emision` y `anulada` son estados de
  máquina que no salen de los pagos. Cerrarle la escritura rompería `emitInvoice()` y
  `cancelInvoice()`.
- **No corrige desfases anteriores a él.** Impide nuevos, no repara viejos. Antes de aplicar la
  032 en una base con datos reales hay que correr la consulta de diagnóstico (al pie de la
  migración) y resolver lo que aparezca **aparte**: en producción un desfase no es un bug de
  fixture, es un problema contable.

### 🔑 La válvula de escape

Va a existir el caso legítimo: restaurar un respaldo, una migración de datos, una corrección
puntual autorizada. Se abre con un flag de transacción **distinto** del que usa T7a, para que en
el log de Postgres una corrección humana se distinga de la operación normal del sistema:

```sql
BEGIN;
  SELECT set_config('finanzas.amount_paid_override', 'on', true);  -- true = local a la TX
  UPDATE invoices SET amount_paid = ... WHERE id = ...;
COMMIT;
```

El flag es **local a la transacción**: se apaga solo en el COMMIT o el ROLLBACK, así que no
puede quedar abierto por olvido. Cada escritura que pasa por acá deja un `WARNING` en el log de
Postgres con el número de la factura.

**Después de usarla, correr la consulta de diagnóstico.** Si la corrección dejó la columna
desalineada de los pagos, la dejaste peor que antes.

### 🚫 Cuándo NO usarla

- **Para que un seed o un test pase.** Si el seed falla, es porque falta un pago. Se agrega a
  `SEED_PAYMENTS`; no se fuerza el número.
- **Para "arreglar" un número que se ve mal en pantalla.** Un `amount_paid` que no cuadra no es
  el problema: es el síntoma. El problema es el pago que falta, sobra o está mal aplicado.
  Escribir la columna borra la evidencia y deja el pago mal igual.
- **Con un `DROP TRIGGER`.** Si alguna vez el guard estorba de verdad, la conversación es sobre
  el guard, no un `DROP` a las once de la noche. Esta válvula existe justamente para que esa
  noche no haga falta.

### El chequeo permanente, en dos lugares y por razones distintas

| Dónde | Qué corre | Por qué ahí |
|---|---|---|
| Cierre de `seed:staging` y `seed:asientos` | `verificarAmountPaidDerivado()` | Una siembra incoherente falla en el momento, no seis días después en una pantalla |
| Suite de tests | `src/lib/finanzas/integridad/__tests__/amount-paid-derivado.test.ts` | La lógica rompe aunque nadie siembre |

El núcleo es puro y está en `src/lib/finanzas/integridad/amount-paid-derivado.ts`; la parte que
habla con Supabase está al lado, en `verificar-amount-paid.ts`.

**No está dentro de `verify_accounting_chain()`, a propósito.** Esa función verifica el
LEDGER; esto es facturación. Mezclarlas haría que un problema de facturación se reporte como
cadena de asientos rota, que es el diagnóstico equivocado y el más caro de perseguir.

### La consulta de diagnóstico

Cero filas = la derivación está sana. Vale para staging y para producción (es solo lectura).

```sql
SELECT i.invoice_number, i.status, i.grand_total, i.amount_paid,
       COALESCE(pa.aplicado, 0) AS suma_aplicada,
       i.amount_paid - COALESCE(pa.aplicado, 0) AS diferencia,
       i.balance_due
  FROM invoices i
  LEFT JOIN (SELECT invoice_id, SUM(amount_applied) AS aplicado
               FROM payment_applications GROUP BY invoice_id) pa
    ON pa.invoice_id = i.id
 WHERE i.amount_paid IS DISTINCT FROM COALESCE(pa.aplicado, 0)
 ORDER BY i.invoice_number;
```

---

## SOP-018: Fuera de producción NO sale un solo correo

**Desde:** 2026-09-01, antes de abrir staging a alguien de afuera del equipo.

### La regla

`getResend()` corta el envío si `NEXT_PUBLIC_APP_ENV` no es `production`. Cubre los cuatro
puntos de envío de una sola vez, porque todos pasan por ahí: envío y reenvío de cotización,
notificaciones del portal público, y el resumen diario del cron.

### Por qué el candado vive en el código y no en la configuración

`EMAIL_FROM` es `Integra Legal <notificaciones@integra-panama.com>` — un dominio REAL y
verificado en Resend. Un correo mandado desde staging llega al destinatario **a nombre del
bufete**, indistinguible de uno auténtico. Eso no es un bug: es un problema con el cliente.

El riesgo es concreto, no hipotético: **el diálogo "Enviar cotización" deja escribir CUALQUIER
dirección**. Alcanza con que alguien probando el ambiente escriba su propio correo — o el de
una licenciada — para que salga.

Hasta el 01/09 la única defensa era que `RESEND_API_KEY` estuviera ausente, y es una defensa
que depende de un panel: en Vercel la variable está en *All Environments*, así que los deploys
de Preview/Staging SÍ la tienen. `.env.local` la tiene comentada a propósito, pero eso solo
protege a `localhost`, no al deploy que se le pasa a alguien por link.

### Por qué falla fuerte en vez de simular el envío

Un "modo sandbox" que dice "enviado" sin enviar es exactamente el bug del banner verde
mentiroso que ya se pagó en el Sprint 2E.3: la cotización figuraba enviada y nunca llegaba.
Acá se lanza una excepción con el motivo, la ruta devuelve `email_sent: false` + `email_error`,
y la UI lo muestra. El mensaje aclara que **el documento quedó registrado y el enlace público
sirve igual** — para que no se lea como una falla del sistema.

### 🔑 La válvula

```bash
ALLOW_REAL_EMAILS=1
```

Server-only (sin prefijo `NEXT_PUBLIC_`), así que no viaja al navegador. Cada envío que pasa por
ahí deja un `WARNING` en el log nombrando el remitente.

**Cuándo sí:** probar el envío a propósito contra **una dirección propia**, en local, y volver a
sacarla al terminar.

**Cuándo NO:**
- En un deploy compartido. Si está puesta en Vercel, cualquiera que entre puede mandar correo
  real a nombre del bufete.
- "Para ver si funciona" con la dirección de un cliente o de una licenciada.
- Para destrabar un test. Un test que necesita mandar correo de verdad está mal escrito.

### eFactura: el mismo criterio

`loadEmisorConfig()` rechaza `EFACTURA_I_AMB=1` (producción DGI) cuando el entorno no es
producción. `iAmb = 1` emite un documento fiscal **REAL**: se le asigna CUFE y queda en los
registros del contribuyente. Una emisión de prueba con esa variable mal puesta no se deshace con
un DELETE — se anula ante la DGI, con ventana de 182 horas, o se arrastra hasta una nota de
crédito.

El sandbox (`iAmb = 2`) **no** se bloquea: probar contra el PAC de pruebas desde staging es para
lo que existe.

### Otras salidas al mundo — revisadas el 01/09/2026

| Salida | Estado |
|---|---|
| Resend (4 puntos de envío) | 🔒 cerrado por `assertRealEmailAllowed()` |
| eFactura / PAC ideati | 🔒 `iAmb=1` imposible fuera de producción; el sandbox sigue abierto |
| Cron `daily-summary` | Corre solo en Production (Vercel no ejecuta crons en Preview) y además pasa por el mismo candado |
| Emails del fixture de staging | Todos `.test` — dominio reservado por RFC 2606, no resuelve en ningún proveedor |
| `connectivity.ts`, `offline/sync.ts`, `direct-upload.ts` | Rutas internas de la propia app. No salen a Internet |

Hay tests que lo fijan: `src/lib/email/__tests__/candado-ambiente.test.ts`.

---

## SOP-019: Congelar staging mientras alguien de afuera lo revisa

**Desde:** 2026-09-01, primera revisión de Josuarth (contador de RM).

### El problema

Si mientras alguien revisa se sigue reseteando la base o mergeando a `develop`, el ambiente le
cambia bajo los pies: los números que anotó ayer no son los de hoy, y el feedback deja de servir
— peor, empieza a reportar como bugs cosas que ya arreglamos y a no reportar las que rompimos.

### La regla: VENTANA DE REVISIÓN

Mientras haya una revisión abierta con alguien de afuera del equipo:

| | |
|---|---|
| 🔴 **Prohibido** | `node scripts/apply-staging-sql.mjs --reset`. Borra la base entera. Es lo único que de verdad no se puede hacer |
| 🔴 **Prohibido** | Aplicar migraciones a staging (`run-sql.mjs`) |
| 🔴 **Prohibido** | Correr los seeds. Son idempotentes, pero `seed:staging` alinea el catálogo de impuestos y puede pisar algo que el revisor cambió a propósito |
| 🟡 **Con aviso** | Deploys de Preview desde `develop`. El código cambia bajo sus pies. Si es necesario, se le avisa y se anota qué cambió |
| ✅ **Libre** | Commitear en `develop` sin desplegar. Trabajar en local contra… (ver abajo) |

**El trabajo NO se detiene.** Lo que se detiene es tocar *ese* ambiente. Durante una ventana de
revisión se sigue commiteando en `develop`, y las pruebas locales que necesiten resetear la base
esperan a que cierre la ventana. Si hay que probar algo destructivo antes, se pide explícitamente
la interrupción de la ventana — no se hace y se avisa después.

### Cómo se abre y se cierra

1. **Antes de abrir:** dejar staging en un estado reproducible desde cero
   (`--reset` + `seed:staging` + `seed:asientos`) y anotar en `changelog.md` los números de
   control con los que queda. Sin eso no hay a qué volver.
2. **Se abre** cuando se manda el correo con el acceso.
3. **Se cierra** cuando el revisor confirma que terminó, o cuando su feedback ya está recibido
   por escrito.
4. **Al cerrar:** se aplica el feedback, se resetea, se vuelve a sembrar, y recién ahí se abre la
   siguiente ventana.

### El estado de referencia (revisión de Josuarth, 01/09/2026)

Números con los que quedó staging. Si alguno no coincide, el ambiente se tocó:

| | |
|---|---|
| Clientes / casos / facturas | 15 / 30 / 8 |
| Pagos y aplicaciones | 3 / 3 |
| Asientos y líneas del ledger | 12 / 31 · cadena íntegra · correlativo 12 |
| Mayor de Cuentas por Cobrar (100004) | inicial 191,947.55 · neto 3,145.00 · **final 195,092.55** |
| Balance — Total de Activo | 257,902.46 |
| Estado de Resultado — utilidad operativa | −244,476.91 |
| Plan de cuentas | 64 activas |
| Desfases de `amount_paid` | 0 |

---

## SOP-020: Proveedores — el RUC, el DV y el plazo de pago

**Desde:** 2026-09-02 (migración `033_proveedores_entidad.sql`)

### Por qué existe este SOP

Josuarth pidió el módulo por una razón concreta, y el día que alguien "simplifique" alguna de
estas tres cosas lo rompe sin darse cuenta.

### 1. 🔴 El RUC y el DV NO se concatenan. Nunca.

Son dos columnas (`suppliers.ruc`, `suppliers.dv`) y dos campos en pantalla, porque los anexos de
la declaración de renta se arman así: *"que esté bien diferenciado el RUC en una columna y el DV
en otra columna porque así está en el formulario de la DGI"*.

`ruc` guarda el RUC **sin** el dígito verificador. Si hace falta mostrarlos juntos, se muestran en
dos elementos al lado — no se arma un string.

**Cómo se hace cumplir:** `src/lib/finanzas/validators/__tests__/ruc-dv-separados.test.ts` lee
todo `src/` buscando la *operación* de unirlos (`+`, template string, `.join`, `.concat`), saltea
comentarios y nombres de test, y tiene un test que verifica que el escáner detecta una
concatenación de verdad. Es una regla que TypeScript no puede sostener: `ruc + dv` compila.

### 2. ⚠️ Del RUC se valida el LARGO, no el formato

En Panamá conviven al menos estas familias, y ninguna lista es exhaustiva:

| Tipo | Ejemplo |
|---|---|
| Persona natural por cédula | `8-123-456`, `3-101-1234`, `10-15-99` |
| Con prefijo | `PE-8-123-456`, `E-8-123-456`, `N-19-1234` |
| Persona jurídica moderna | `155123456-2-2015` |
| Folios y fichas viejas | `1234567-1-123456` |

**El criterio es: validá poco y avisá en pantalla.** Un campo que rechaza un RUC legítimo bloquea a
quien está cargando y no hay forma de saltearlo; uno permisivo acepta un tipeo que se corrige
después. `avisosDeRuc()` devuelve los comentarios —el DV pegado al RUC, el DV faltante, el DV de un
solo dígito— y la UI los muestra en ámbar **sin bloquear el guardado**, diciéndolo con esas
palabras.

El DV sí se acota a dígitos (1 a 3), porque un dígito verificador es un número por definición. Se
aceptan tres para no rechazar un `5` escrito sin el cero delante.

**Si alguien propone endurecer la validación del RUC:** que traiga primero la lista completa de
formatos que la DGI acepta. Sin esa lista, endurecer es apostar.

### 3. El plazo de pago NO es un tramo de la antigüedad

Son tres cosas encadenadas, y confundirlas es el error fácil:

```
plazo del proveedor  →  vencimiento del gasto  →  tramo de la antigüedad
(payment_terms_days)    (business_expenses.due_date)   (corriente / 1-30 / …)
```

- El **plazo** vive en la ficha del proveedor. 0 = contado. Acepta 0 a 365: "30, 60, 90" son los
  habituales, no los únicos.
- El **vencimiento** vive en el gasto, se propone desde el plazo y **es editable**: manda lo que
  diga el comprobante. El formulario deja de recalcularlo en cuanto alguien lo toca.
- Los **tramos** los calcula el reporte desde el vencimiento.

🔴 **Cambiar el plazo de un proveedor NO reescribe los vencimientos ya cargados.** Sería reescribir
historia. El default aplica a los gastos nuevos; los viejos se editan de a uno.

Un gasto sin `due_date` se cuenta desde `expense_date`, que equivale a tratarlo como contado. Es el
comportamiento viejo, no un caso de error.

### 4. Lo que la migración 033 dejó a medias, a propósito

- **`supplier_name` y `supplier_ruc` siguen en `business_expenses`.** Son el respaldo de la
  migración. Eliminarlas es un commit posterior, después de verificar que nada se perdió —el mismo
  patrón que se usó con `clients.active`, y por la misma lección.
- **`supplier_id` es NULLABLE.** Obligatorio rompería los gastos que ya existen sin proveedor.
- **No hay UNIQUE sobre el RUC.** Si en producción dos nombres compartieran RUC, un UNIQUE haría
  fallar la migración entera. Los duplicados se **detectan y se avisan** (`proveedoresConRucRepetido`),
  y unirlos es decisión de una persona.
- **Los proveedores creados automáticamente quedan en contado y sin RUC.** No sabemos su plazo real
  y suponerlo movería la antigüedad sin que nadie lo decidiera. Su nota lo dice.

### 5. Si hay que correr la 033 en producción

`business_expenses` **tiene datos reales allá**. La migración está escrita para eso: es
idempotente, transaccional, no borra nada y trae un ROLLBACK comentado al final. Aun así:

1. Backup antes (SOP de DB Safety).
2. Correr el inventario primero — `sql/verificacion/inventario_proveedores.sql`, solo lectura —
   para saber cuántos nombres hay y si alguno parece el mismo proveedor escrito de dos formas.
3. Si aparecen duplicados, decidir **antes** si se unen a mano; la migración no los fusiona.
4. Verificar después: ningún gasto sin enlazar, ningún gasto sin `due_date`, y el auxiliar de
   cuentas por pagar sumando lo mismo que antes.

Y como siempre: **el único camino a producción es un merge a `main`**.

---

## SOP-021: El corte de fechas de los estados financieros

Desde el 02/09/2026 el Balance General, el Estado de Resultado y el Balance de
Comprobación aceptan corte por fecha. **Las tres semánticas son distintas y confundirlas
es un error contable, no de interfaz.**

| Reporte | Forma | Qué le pasa a la apertura |
|---|---|---|
| Balance General | **A UNA FECHA** (`hasta`) | se incluye siempre |
| Estado de Resultado | **DE UN PERÍODO** (`desde`/`hasta`) | la de cuentas de resultado se **EXCLUYE** |
| Balance de Comprobación | **DE UN PERÍODO** (`desde`/`hasta`) | se incluye, dentro del saldo inicial |

El Balance no lleva `desde` a propósito: no existe "el activo entre marzo y junio".

### 🔴 La regla que no se puede romper

> **`buildBalanceGeneral` recibe siempre una utilidad calculada sobre el IDÉNTICO
> `ReportAccount[]` que se le entrega.** Nunca un número que venga de otra carga con otro
> alcance de fechas.

El renglón "Utilidad del Ejercicio" del patrimonio sale de un cálculo de resultado. Si
alguna vez se le pasa el resultado DEL PERÍODO mientras sus activos son los ACUMULADOS a
la fecha, el Balance deja de cuadrar — medido en staging, por **244.476,91**. Hoy la
garantía la da `buildAccountingReports()`, que arma los dos del mismo conjunto. Si se
separan esas dos llamadas alguna vez, hay que mantener la regla a mano.

Por eso son **dos cargas distintas**, no una compartida:

```ts
// /balance — acumulado a la fecha, apertura incluida
loadReportAccounts(db, tenantId, { rango: { hasta } })

// /pyl — período, apertura de resultado excluida. NO alimenta al Balance.
loadReportAccounts(db, tenantId, {
  rango: { desde, hasta },
  aperturaDeResultado: "excluir",
})
```

### El rango vive en la FUENTE, no en los builders

`loadReportAccounts()` es lo que hace que los tres reportes no puedan divergir: no es una
coincidencia a mantener, es que los tres leen la misma función. **Partir el cálculo en
calculadoras separadas destruiría esa garantía.** Los tres builders no saben nada de
fechas y así tienen que seguir.

### Cómo verificar que un corte está bien hecho

Cuatro invariantes. Los tres primeros valen en **cualquier** rango:

1. **Σ saldo inicial = 0,00.** Un ledger de partida doble está cuadrado en cualquier
   fecha. Si un corte lo rompe, el corte está mal. Es la alarma más barata que hay.
2. **Σ débitos = Σ créditos** dentro del rango.
3. **Activo = Pasivo + Patrimonio**, o sea `descuadre` 0,00.
4. Sin filtro, los cuatro totales son los de siempre: Activo **262.717,46** · Pasivo
   **−17.334,80** · Patrimonio **−245.382,66** · descuadre **0,00**.

🔒 Están fijados en `src/lib/finanzas/reports/__tests__/periodo-estados-financieros.test.ts`
sobre siete cortes.

### ⚠️ Al elegir un rango para probar: cuidado con el neteo a cero

**Un rango cuyos movimientos previos se cancelan entre sí no prueba nada.** El 02/09/2026,
verificando el Libro Mayor contra staging, el primer rango probado (mayo–junio sobre la
cuenta 100004) tenía los movimientos de abril netos en cero —+1.070 +150 −1.070 −150— y el
saldo ajustado se veía idéntico al de apertura. Ese rango habría dado por buena una
implementación rota, en los dos sentidos.

**Elegir siempre un corte donde lo anterior NO se cancele**, y confirmarlo antes de sacar
conclusiones: `arranque_ajustado` en el Mayor, `movimientoAnterior ≠ 0` en el loader.

### El aviso del Estado de Resultado lleva el número

Con período activo, `/pyl` avisa **cuánto** excluyó, no solo que excluyó algo: *"Se
excluyeron 244.476,91 de saldos de apertura…"*. Con el número el contador lo verifica; sin
el número es una disculpa. El valor se suma de `aperturaExcluida` de las cuentas —el mismo
dato que el reporte no usó— y nunca de un cálculo paralelo.

Ese número, además, es hoy una pregunta abierta para RM: ver `task_plan.md` **A-quinquies**.

### Lo que NO tiene corte de fechas

El Libro Mayor y el Diario ya lo tenían. **Antigüedad, Estado de cuenta y Ventas mensuales
no**, y no es un olvido: son fotos a hoy, no reportes de período. Filtrarlas es mover la
fecha de referencia de los tramos, que es otro diseño con su propia pregunta contable.

---

## SOP-022: El contador y el gasto de trámite — una puerta al módulo Legal, recortada

### El problema que resuelve, y por qué no es una pantalla más

Un gasto de trámite vive dentro de un caso, en `/legal/casos/{id}`. El contador **no entra a
`/legal/*` en absoluto**: `route-access.ts` le da `contador: ["/", "/finanzas"]`.

Pero el contador sí entra al Libro Mayor, y la guía de RM pide en su lista de validación que
"cada reporte permite llegar al documento origen". Sin una pantalla bajo `/finanzas`, el ícono
del mayor le prometería abrir el gasto y lo depositaría en otra parte — **exactamente el bug
del 01/09/2026 que originó `destino-documento.ts`**, reintroducido un módulo más adelante.

De ahí `/finanzas/gastos-tramite/{id}`, mismo patrón que el detalle de factura: **el detalle
sí, el listado no.**

### 🔒 Pero es una puerta a información confidencial, y el recorte es política del bufete

Los casos son confidenciales. Esta pantalla le abre al contador un acceso al módulo Legal que
antes no tenía, así que su alcance lo decidió Oliver el 03/09/2026 y **no es negociable desde
el código**:

| | |
|---|---|
| ✅ **Muestra** | monto, líneas, cuentas contables, fecha, proveedor (razón social, RUC y DV en columnas separadas), vencimiento, comprobante, y el **NÚMERO** del caso |
| ❌ **No muestra** | descripción del caso, partes, cliente, documentos, notas, historial |

El número le alcanza para identificar el gasto en su papel de trabajo, que es para lo que lo
necesita. En palabras de Oliver: *"ampliar el acceso del contador al contenido legal por la
puerta de atrás sería un cambio de política del bufete, no una pantalla"*.

### Dónde vive el recorte: en el `select`, NUNCA en el JSX

`src/lib/finanzas/queries/expense-tramite.ts`, y la constante
`CAMPOS_DE_CASO_PERMITIDOS = ["case_code"]`.

Si el query trajera el caso entero y la pantalla eligiera qué renderizar, **el dato
confidencial ya estaría en el servidor y a un `{caso.description}` de distancia**. Cualquiera
que agregue un campo a la vista en seis meses lo tendría a mano sin enterarse de que no debe.
Con el recorte en el query, el dato **nunca sale de la base**.

Por el mismo motivo la pantalla **no hace ni un `.from()` propio**: todo lo que muestra pasa
por el query recortado, que es el único lugar que hay que auditar.

### ⚠️ Y por eso el código del caso NO es un enlace

Un `<Link href={/legal/casos/${id}}>` sería la puerta de atrás en una línea. El middleware se
lo rebotaría al contador —un botón que falla al apretarlo— y para la abogada sería un atajo
que esta pantalla no tiene por qué ofrecer. **El número va como texto.**

### 🔒 El test que lo sostiene

`src/lib/finanzas/queries/__tests__/gastos-tramite-privacidad.test.ts`. Es una regla que
ningún tipo de TypeScript puede sostener: agregar `description` al `select` compila perfecto y
pasa un code review si el diff es grande. Así que se verifica **leyendo el código**, igual que
`ruc-dv-separados.test.ts`.

Comprueba cinco cosas:

1. `CAMPOS_DE_CASO_PERMITIDOS` es exactamente `["case_code"]`.
2. El embed `cases(...)` del query pide **solo** campos de esa lista blanca — y rechaza
   `cases(*)`. Es lista **blanca** y no negra a propósito: así falla también con un campo que a
   nadie se le hubiera ocurrido prohibir.
3. El query no hace `.from()` sobre `cases`, `comments`, `documents` ni `clients`. Un
   `.from("cases")` directo esquivaría la comprobación del punto 2.
4. La pantalla no consulta la base por su cuenta, y no construye ninguna ruta `/legal/*`.
5. El permiso y el enlace se mueven juntos: el contador abre el detalle y **no** el listado, el
   `/editar` ni `/nuevo`; y `gasto_tramite` enlaza a esta pantalla y **no** a la de compras.

**Nota sobre la primera versión de ese test:** miraba todos los `.select(...)` del archivo
pegados en una cadena y marcó `description`, que es `expense_lines.description` — legítima. Se
lo hizo PRECISO en vez de agregarle una excepción. Un test que grita cuando no hay nada roto se
termina desactivando, y entonces deja de proteger.

### El comprobante: el contador dejó de tener un 403

`/api/expenses/[id]/receipt/download` tenía un `if (profile.role === "contador") return 403`.
Era correcto mientras el contador no tuviera forma de llegar a un gasto de trámite; dejó de
serlo con esta pantalla, porque **auditar un asiento es poder ver su comprobante** y un 403 acá
dejaría un botón de descarga que falla al apretarlo.

⚠️ Esto amplía el acceso del contador a **un archivo** —una factura o un recibo de proveedor,
material contable— **no al expediente**. El aislamiento real de esa ruta es el
`.eq("tenant_id", ...)`, no el gate por rol.

### Si hay que ampliar el alcance

Se habla con Oliver, se suma el campo a `CAMPOS_DE_CASO_PERMITIDOS` **en el mismo commit y con
el motivo escrito**, y se mueven junto con eso la tabla de roles de `CLAUDE.md` y este SOP. No
es un cambio de pantalla.

---

## SOP-023: Líneas de gasto — el NULL histórico, el CHECK NOT VALID y la limpieza

### El modelo, en una línea

`expense_lines` cuelga de un gasto de trámite (`expenses`) **o** de una compra
(`business_expenses`), con dos FK nullables y un CHECK de exclusividad. Una tabla, un
validador, un editor y un builder para los dos módulos. Migración `036`.

### 🔴 `chart_account_code` es NULLABLE a propósito

Las líneas que creó el backfill de los gastos históricos —128 en producción— quedan en
**NULL**, no en `130003`. Esos gastos se cargaron cuando el sistema no pedía la cuenta:
**nadie los clasificó nunca**, y algunos pudieron ser costo propio del bufete (`500005`) y no
fondos de cliente. Escribirles el default del acta no sería aplicar un default: sería inventar
un dato y darle la misma apariencia que a uno cargado por una persona.

Un comentario en la migración documenta la intención pero **no viaja con la fila**. Con NULL,
el tipo de la app es `string | null` y **el builder del asiento no compila si no maneja el
caso**. La consulta de limpieza es `WHERE chart_account_code IS NULL` y se vacía sola.

### 🔬 `CHECK ... NOT VALID` — la semántica real, medida y no supuesta

El `NOT NULL` no puede estar en la columna (rompería el backfill), así que la garantía la da un
CHECK agregado después, en la `037`. **"NOT VALID" NO significa "las filas viejas quedan
exentas para siempre"**, y confundirlo cuesta caro.

Medido en staging el 03/09/2026 con `sql/tests/experimento-check-not-valid.sql`:

| Operación | Resultado |
|---|---|
| `ADD CONSTRAINT ... NOT VALID` con 20 filas en NULL | ✅ pasa, no escanea |
| INSERT nuevo **sin** cuenta | ✅ **RECHAZADO** (el objetivo) |
| INSERT nuevo **con** cuenta | ✅ aceptado |
| UPDATE de la **descripción** de una fila vieja en NULL | ⚠️ **RECHAZADO** |
| UPDATE que **asigna** la cuenta a una fila vieja | ✅ aceptado |
| `VALIDATE CONSTRAINT` con NULLs presentes | ✅ rechazado (correcto) |

**`NOT VALID` salta el scan inicial, pero el CHECK se hace cumplir en TODO UPDATE** — incluso
sobre una fila vieja, y aunque el UPDATE no toque la columna del CHECK. Postgres evalúa la fila
NUEVA completa.

**El costo, aceptado:** lo único prohibido es *modificar una línea histórica sin clasificarla en
el mismo UPDATE*. Clasificarla, borrarla, el CASCADE y la asignación masiva siguen funcionando.
Se acepta porque hoy no hay ninguna pantalla que edite una línea, porque pedir la cuenta a quien
ya está editando esa línea es razonable, y porque empuja la limpieza en vez de dejarla para
siempre.

⚠️ **Antes de escribir cualquier UPDATE masivo sobre `expense_lines`:** si toca filas históricas
y no les asigna cuenta, falla.

### El orden 036 → 037 es obligatorio

El backfill de la `036` INSERTA con NULL. Con el CHECK de la `037` puesto, ese INSERT falla y la
migración entera aborta.

### Cómo se termina la limpieza

```sql
ALTER TABLE public.expense_lines VALIDATE CONSTRAINT expense_lines_cuenta_obligatoria;
```

Mientras quede una sola línea en NULL, eso falla. **El comando es el semáforo: el día que corre
limpio, la limpieza terminó.** No hay que llevar la cuenta a mano.

### 🔑 La asignación masiva solo llena blancos

`POST /api/expenses/lines/bulk-classify` filtra por `chart_account_code IS NULL`. Sin eso, un
clic sobre 40 líneas destruye clasificaciones que alguien decidió una por una y que **nadie
recuerda cuáles eran** — no hay historial de la cuenta anterior.

⚠️ **Ese mismo filtro hace un segundo trabajo:** garantiza que la masiva nunca toca un gasto ya
asentado. Un gasto no se puede postear con líneas en NULL, así que **toda línea en NULL
pertenece por definición a un gasto no posteado.** El filtro de clasificación y el de
inmutabilidad son el mismo.

🚫 **Por eso la ruta masiva NO tiene un guard aparte de "gasto posteado", y no es un olvido.** Un
segundo chequeo que siempre da lo mismo que el primero es código que nadie puede probar que haga
falta, y el día que alguien simplifique va a sacar el equivocado. La ruta INDIVIDUAL
(`PATCH /api/expenses/lines/[id]`) sí lo lleva, porque ahí sí se puede pedir cambiar una cuenta
ya asignada.

🔒 Los dos comportamientos los fija `bulk-classify.route.test.ts`, con un fake que **registra la
cadena de filtros** en vez de simular una base — un fake que filtrara de mentira pasaría igual
si el `.is()` desapareciera. Verificado por mutación: sacando el filtro, el test falla.

### Dónde se resuelve, y cómo se presenta

`/legal/gastos` → vista **Gastos** → chip **Sin clasificar**. Es una VISTA y no una pantalla
`/sin-clasificar` aparte: una pantalla dedicada a una limpieza es un arreglo temporal que se
vuelve deuda permanente. Una lista de gastos entre casos sirve igual después.

🎨 **Se presenta como un estado, no como una alarma:** chip y no banner, ámbar y reloj y nunca
rojo y triángulo, el chip **desaparece al llegar a cero**, y muestra avance (`84 de 128`) en vez
de deuda. La explicación aparece una sola vez, en gris chico y solo con el filtro activo.


---

## SOP-024: Qué cuenta puede clasificar un gasto — la lista corta y el guard

### El error real que lo motivó, y quién lo cometió

El 03/09/2026, al sembrar el gasto de demostración de staging, se clasificó "Honorario del
gestor externo" contra **`610002 Honorarios Profesionales`**. La correcta es
**`500004 Honorarios Profesionales Externos`**.

`610002` son los honorarios que paga el bufete por LO SUYO —su contador, su propio abogado—.
El gestor externo de un caso es un servicio de tercero comprado PARA el caso.

**Lo importante no es el error: es quién lo cometió.** La misma persona que acababa de diseñar
el modelo de líneas, veinte minutos antes, eligiendo de 64 cuentas donde dos se llaman casi
igual. Si eso alcanza para equivocar a alguien con el modelo entero en la cabeza, alcanza de
sobra para equivocar a quien pasa por 128 filas haciendo clic rápido en la pantalla de limpieza.

Y quedó **permanente**: el asiento ya estaba posteado, y los asientos son inmutables.

### 📐 REGLA 1 — qué separa un costo de un gasto en un caso

> Las **`5000xx`** son **servicios de terceros comprados para el caso**.
> Las **`610xxx`** son **recursos propios del bufete consumidos en el caso**.

Con ese criterio se resuelve solo:

| Caso | Cuenta | Por qué |
|---|---|---|
| Traductor, notario, investigador, gestor externo | `5000xx` | alguien le facturó al bufete por ese caso |
| Una abogada viaja a Chitré a una audiencia; el combustible; la papelería de un escrito | `610xxx` | el bufete consumió lo suyo |

No es casualidad que las seis cuentas de costo del plan sean, una por una, servicios de
terceros: Josuarth armó ese bloque exactamente para esto.

### 📐 REGLA 2 — el servidor rechaza lo imposible, no lo improbable

> Un guard equivocado **bloquea trabajo legítimo y se descubre tarde**, con alguien trabado y
> sin entender por qué. Una sugerencia equivocada **cuesta un clic**.

Por eso los dos mecanismos tienen sesgos **opuestos y deliberados**:

| | Sesgo | Qué hace |
|---|---|---|
| **La lista** (`cuentasSugeridasParaTramite`) | opinada, corta | ofrece 7 de 64; el resto a un clic |
| **El guard** (`esTipoValidoParaGasto`) | conservador | rechaza solo los 3 tipos sin lectura contable posible |

`100001 Banco General` como clasificación de una tasa judicial es un disparate —el banco es de
DÓNDE sale la plata, no en qué se convirtió— y aun así **no se bloquea**: no es estructuralmente
imposible, y la lista corta ya lo saca del camino.

### 📐 REGLA 3 — una lista sugerida y un guard NO se derivan uno del otro

> Una **lista sugerida** y un **guard** son mecanismos distintos, con sesgos
> opuestos. Uno responde *"¿qué es lo más probable?"*; el otro *"¿qué es
> imposible?"*. **Derivar uno del otro produce un error, y produce los dos.**

El 03/09/2026 los vimos a los dos, el mismo día, en los dos módulos:

| | Qué pasó | Consecuencia |
|---|---|---|
| **Gastos de trámite** | Una lista de presentación demasiado **ancha** —las 64 cuentas— usada como si fuera el conjunto válido | Se podía clasificar una tasa judicial como `300001 Capital Social`, y el asiento se posteaba contra patrimonio |
| **Compras** | Un filtro de presentación **endurecido en permiso**: `listExpenseAccountOptions` filtraba `account_type = 'expense'` "para que el select solo muestre cuentas relevantes", y `validarCuentaDeGasto` reusó el mismo `.eq()` como guard del servidor | **No se podía comprar una computadora.** `110001 Mobiliario y equipo` es un activo, y el acta lo pide explícitamente |

El de compras además daba el mensaje equivocado: como el tipo se filtraba **dentro
de la consulta**, un activo legítimo volvía como `"no-existe"` — le decía a la
persona que la cuenta no estaba en el plan cuando sí estaba y era la correcta.
**Existir, estar activa y poder clasificar un desembolso son tres cosas distintas y
merecen tres respuestas distintas.**

🔑 **La prueba de que están bien separados:** el guard y la lista pueden discrepar
sin que ninguno esté mal. `100001 Banco General` **pasa el guard y no está en la
lista** — es improbable, no imposible. Si un mecanismo se deriva del otro, esa
discrepancia no se puede expresar, y hay que elegir entre bloquear de más o sugerir
de más.

Lo que sí tiene que cumplirse es la inclusión: **todo lo sugerido pasa el guard.**
Ofrecer algo que la ruta rechaza es un botón que rebota. Hay un test que lo fija.

### La lista es DERIVADA, no siete códigos literales

`130003` + **todas las cuentas activas de tipo `cost`**.

Hardcodear los siete se desactualizaría el día que RM toque el plan, que es exactamente lo que
van a hacer: si el contador agrega `500007 Peritos`, con la regla derivada aparece sola; con una
lista literal no aparece nunca **y nadie se entera**, porque la cuenta existe y el selector
simplemente no la muestra.

### Los tres tipos imposibles

| Tipo | Por qué |
|---|---|
| `income` | registra lo que el bufete factura, no en qué se gastó la plata |
| `equity` | registra el capital de las socias y el resultado, no un desembolso |
| **`liability`** | **el más fuerte de los tres:** el asiento del gasto YA acredita `200001`; una línea contra un pasivo dejaría la misma cuenta de los dos lados. Y "pagar una deuda" no es esto — es DEBE CxP / HABER banco, otro flujo |

`asset` NO se puede cerrar: `130003` es un activo y es el caso principal.
`112001 Depr. acumulada` pasa: debitarla es legítimo en una baja de activo.

### Dónde vive, y por qué junto

`src/lib/finanzas/contabilidad/cuentas-de-gasto.ts` — **la lista y el predicado en el mismo
archivo**. Si vivieran separados divergirían: la pantalla ofrecería algo que la ruta rechaza, o
al revés. Hay un test que cruza los dos (`todo lo sugerido pasa el guard`).

El guard corre en las tres rutas que escriben una cuenta:
`POST /api/expenses`, `PATCH /api/expenses/lines/[id]` y `POST /api/expenses/lines/bulk-classify`.

### Compras usa el MISMO predicado desde el 03/09/2026

`validarCuentaDeGasto()` filtraba `account_type = 'expense'` y rechazaba `cost` y `asset` —
contra el acta del 25/08, que pide "la cuenta de gasto, **costo o activo** que elija el
usuario". Hoy delega en `esTipoValidoParaGasto()` y devuelve un veredicto discriminado
(`ok` / `no-existe` / `inactiva` / `tipo-invalido`).

⚠️ **El selector se movió en el mismo commit.** Aflojar el guard sin tocar
`listExpenseAccountOptions()` no se nota: la cuenta capitalizable sigue sin poder elegirse.
🔒 `cuenta-de-compra.test.ts` fija las dos mitades, con el caso concreto de comprar una
computadora contra `110001`.

**Lo que NO se hizo:** una lista corta para compras. El recorte útil sería sacar las 8 cuentas
de planilla (`600001 Sueldos`, `600004 Décimo Tercer Mes`…), y ahí hay una pregunta que no es
de diseño: **¿`600006 CSS Patronal` y `600007 Seguro Educativo` se registran como una compra
con proveedor, o salen de la planilla y nunca pasan por este módulo?** Va a RM —son los
contadores del bufete y saben cómo se asienta la planilla—; está anotado en `task_plan.md`.
