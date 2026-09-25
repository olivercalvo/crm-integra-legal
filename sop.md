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

### 🔬 Las tres versiones de la fórmula del `content_hash`

`content_hash` se computa dentro de `post_journal_entry` sobre un `concat_ws('|', …)` de la
cabecera más un `string_agg` de las líneas. **Esa fórmula cambió dos veces**, y quien alguna vez
escriba un verificador que RECALCULE el contenido desde las columnas —el actual no lo hace—
tiene que conocer las tres versiones o va a reportar como adulterados todos los asientos viejos:

| Desde | Migración | Qué se agregó | Línea hasheada |
|---|---|---|---|
| **2026-08-27** | `028` | la fórmula original | `code:debit:credit:descr` |
| **2026-09-03** | `039` | `reference` en la cabecera (`idempotency_key` **no**: es transporte, no contabilidad) | `code:debit:credit:descr` |
| **2026-09-22** | `054` | `client_id` y `supplier_id` de cada línea | `code:debit:credit:descr:client_id:supplier_id` |

Los dos campos del tercero se concatenan **siempre**, también vacíos: una fórmula de forma
variable no se puede auditar.

🔴 **Cambiar la fórmula NO rompe nada de lo ya escrito, y esto está verificado, no supuesto:**
`verify_accounting_chain()` (028) comprueba dos cosas —que `prev_hash` encadene con el `hash`
anterior y que `hash = sha256(prev_hash || content_hash)`— y **nunca recalcula `content_hash`
desde las columnas**. Los asientos viejos conservan el suyo y la cadena sigue íntegra. Por eso
también hay que decir qué NO detecta el hash: una cadena rota, sí; un campo adulterado, no. Lo
que protege los campos son los triggers de inmutabilidad de la `023`.

**Si mañana se agrega un campo más:** entra al hash solo si es contenido contable, se suma una
fila a esta tabla con su fecha, y se deja la fórmula con forma fija.

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
| 🔴 **Prohibido** | **Push a `develop`** (corregido el 25/09/2026). El revisor entra por un Shareable Link de Vercel del deploy de `develop`, y ese enlace **siempre muestra la última versión de la rama**: cualquier push le cambia el sistema en medio de la revisión. Antes esta fila decía "con aviso"; no alcanza |
| ✅ **Libre** | Trabajar en una **rama aparte** (`revision/<tema>`), con sus propios pushes y su Preview. Se integra a `develop` cuando cierra la ventana. ⚠️ Ese Preview usa la **misma base de staging**: ahí no se tocan los documentos que usa la revisión |

**El trabajo NO se detiene.** Lo que se detiene es tocar *ese* ambiente. Durante una ventana de
revisión se trabaja en una rama aparte (no en `develop`, que es lo que ve el revisor), y las
pruebas locales que necesiten resetear la base esperan a que cierre la ventana. Si hay que probar algo destructivo antes, se pide explícitamente
la interrupción de la ventana — no se hace y se avisa después.

### Cómo se abre y se cierra

1. **Antes de abrir:** dejar staging en un estado reproducible desde cero
   (`--reset` + `seed:staging` + `seed:asientos`) y anotar en `changelog.md` los números de
   control con los que queda. Sin eso no hay a qué volver.
2. **Se abre** cuando se manda el correo con el acceso. Desde ese momento `develop` queda
   congelado: ni un push hasta que cierre.
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

---

## SOP-025: La frontera cliente/servidor — qué puede cruzar y qué no

**Por qué existe:** el 09/09/2026, delante de RM, tres pantallas de reportes devolvieron
«Application error: a server-side exception has occurred» al aplicar un filtro de fechas.
`fechaLarga()` vivía en `_components/periodo-filtros.tsx`, que empieza con `"use client"`, y los
Server Components de pyl, balance y comprobación la importaban de ahí.

### La regla

> Un módulo `"use client"` sólo puede exportar **componentes** hacia un módulo de servidor.

Cuando un Server Component importa de un módulo cliente **no recibe la función**: recibe la
referencia de cliente que React usa para hidratar. Llamarla lanza `… is not a function`.

- ✅ `export function PeriodoFiltros()` — componente, cruza la frontera
- ❌ `export function fechaLarga()` — función común, **no** cruza
- ❌ `export const TROZO = 3180` — constante, **no** cruza

### Por qué no alcanza con tener cuidado

**Nada lo detecta antes de producción.** TypeScript compila, `next build` pasa y la pantalla
funciona mientras no se ejecute la línea que llama a la función. Acá eso significaba «anda sin
filtro, revienta con filtro» — y el filtro es justo lo que hace un contador.

En producción el mensaje ni siquiera nombra el archivo: sale un digest opaco
(`483177356`) y hay que ir a los logs del hosting para saber qué pasó.

### El arreglo, cuando pasa

**No es renombrar la función.** Es MOVERLA a un módulo sin `"use client"`, que los dos lados
pueden importar. Precedente: `src/lib/finanzas/reports/fecha-larga.ts`.

### 🔒 El candado

`src/lib/finanzas/reports/__tests__/frontera-cliente-servidor.test.ts` recorre `src/`, junta lo
que cada módulo `"use client"` exporta y no es un componente (por PascalCase, la convención de
`claude.md` §10) y falla si algún módulo de servidor lo importa. El mensaje nombra el archivo, el
símbolo y el arreglo.

---

## SOP-026: Los importes del encabezado de una compra salen de las líneas

**Por qué existe:** hasta el 09/09/2026 el formulario de Gastos del Bufete tenía tres campos
editables en el encabezado —subtotal, tasa de ITBMS y monto de ITBMS— que convivían con las
líneas **sin estar conectados a ellas**. Se cargaba todo dos veces, y no era sólo incómodo.

### Lo que rompía, medido

`business_expenses_tax_consistency_check` acopla los tres campos del encabezado. Medido contra
staging con INSERTs reales dentro de una transacción con ROLLBACK:

| Caso | Resultado con la tasa tipeada a mano |
|---|---|
| Mixta (una gravada al 7% + una exenta), cabecera 7% | pasa |
| **Todas exentas, cabecera 7%** — el valor **por defecto** del formulario | **RECHAZA** |
| **Mixta, cabecera 0%** | **RECHAZA** |
| Todas gravadas 7%, cabecera 7% | pasa |

O sea: dejar el formulario como venía y cargar dos renglones exentos no guardaba, y el error que
salía era el CHECK crudo de Postgres.

### La regla

    subtotal   = Σ amount de las líneas
    tax_amount = Σ tax_amount de las líneas
    tax_rate   = 0 si no hay ITBMS
                 si hay, la tasa MÁS ALTA entre las líneas que efectivamente lo pagan

`tax_rate` en el encabezado **no es un dato contable**: el ITBMS real es la suma por línea. La
columna existe desde antes de que hubiera líneas, y el CHECK la mira. La regla es la mínima que
lo satisface sin mentir.

### Se calcula en TRES lugares, y es a propósito

| Dónde | Por qué ahí |
|---|---|
| `business-expense-form.tsx` | mostrar el total sin esperar la respuesta |
| `validators/business-expense.ts` | validar antes de pegarle a la base |
| `api/business-expenses.ts` | el servidor no confía en un número que llegó por la red |

⚠️ Si divergen, la compra se guarda con un encabezado que no es la suma de sus partes y el asiento
deja de cuadrar contra su propio documento. Lo fija
`validators/__tests__/compra-importes-derivados.test.ts`.

### Dónde se ajusta el ITBMS a mano

En la LÍNEA, no en el encabezado. Si el comprobante trae un redondeo distinto, se corrige en el
renglón que lo tiene. La tasa de línea se acota a `0..1` (el rango del CHECK de la base), **no** a
la whitelist panameña: el campo es numérico libre para que un comprobante raro se pueda cargar.


---

## SOP-027: Un botón apagado tiene que decir por qué

**Origen:** la demo del 09/09/2026. RM armó un asiento manual cuadrado, 100 contra 100, y el
botón "Registrar en el libro" nunca se habilitó. No era el cuadre ni un problema de recálculo:
el botón decidía con un booleano de cuatro cláusulas y **una sola tenía explicación en
pantalla**. La que bloqueaba —la descripción del asiento— no avisaba nada. Desde afuera se veía
como un botón roto, y costó el módulo que más le gustó al cliente.

### La regla

> **Toda condición que deshabilite un botón de guardar, emitir o registrar tiene que poder
> decir por qué, en pantalla y con palabras del negocio.**

La forma de hacerla cumplir no es acordarse: es **devolver el motivo en vez de un booleano**.

```ts
// ❌ Se puede agregar una cláusula muda sin que nadie se entere.
const puedeGuardar = hayAlgo && cuadra && descripcion.length >= 3 && !enviando;

// ✅ Agregar una cláusula OBLIGA a escribir su frase.
const { puede, motivo } = estadoDelRegistro(lineas, descripcion, enviando);
```

El ejemplo vivo es `estadoDelRegistro()` en `lib/finanzas/contabilidad/asiento-manual.ts`.

### Tres detalles que importan

1. **Un solo motivo, el próximo paso.** No la lista de todo lo que falta. El orden es el de
   dependencia: sin importes no tiene sentido hablar de cuadre.
2. **Redactado para quien carga, no para quien programa.** *"Falta describir la naturaleza del
   asiento"*, nunca `descripcion.length < 3`. Y cuando se puede, se nombra el elemento concreto:
   *"Elegí la cuenta contable de la línea 2"*.
3. **La lógica va en un módulo puro, no en el `.tsx`.** El proyecto no tiene jsdom ni
   testing-library: la suite es `node:test` sobre `src/**/*.test.ts`. Si la decisión vive dentro
   del componente, no se puede probar. Sacarla es lo que hace que el test exista.

### El patrón alternativo, que también es correcto

El botón **siempre habilitado**, con la validación al enviar y el error inline campo por campo.
Es lo que hacen `invoice-form.tsx` y `business-expense-form.tsx` (`disabled={isPending}` a
secas), y no tiene forma de quedar mudo. Cualquiera de los dos sirve. **Lo que no sirve es el
intermedio:** deshabilitar por contenido y no explicar.

### Al revisar

Buscar `disabled={` con más de una cláusula, o cualquier `disabled={!algo}` donde `algo` dependa
de lo que la persona cargó. Por cada cláusula, preguntarse qué ve alguien que no puede apretar el
botón. Si la respuesta es "nada", es el bug del 09/09 otra vez.

---

## SOP-028: El impuesto de una línea de compra es un código del catálogo, no un número

**Por qué existe:** el ITBMS por línea en compras funcionaba desde la `036` (cada línea tiene
`tax_rate` y `tax_amount`, el asiento suma línea por línea, el editor tiene el desplegable desde
el 10/09). Lo que faltaba era **el vínculo al catálogo**: la línea guardaba un decimal y no sabía
CUÁL código de `tax_codes` lo produjo. Tres consecuencias reales, todas cerradas el 16/09/2026
con la migración `045`:

| Consecuencia | Antes | Ahora |
|---|---|---|
| Fuente del desplegable | `OPCIONES_DE_IMPUESTO`, lista fija en el código. Si Rose cambiaba la tasa en Configuración → Impuestos, facturación la seguía y compras no | `listTaxCodesActive()` + `TaxCodeSelect`, **los mismos que facturación** |
| `EXENTO` vs `ITBMS_0` | Indistinguibles: los dos son tasa 0 | `expense_lines.tax_code_id`, FK a `tax_codes` |
| Confianza en el body | El servidor guardaba la tasa que mandaba la pantalla | El servidor **resuelve el id contra el catálogo** y escribe la tasa de ahí |

### El modelo

`expense_lines.tax_code_id uuid REFERENCES tax_codes(id)` + `tax_rate` como **snapshot** de
`tax_codes.rate` al cargar la línea. Es el mismo modelo que `invoice_lines`: si el catálogo cambia
después, la línea sigue diciendo la tasa con la que se cargó. No se copia el texto del código
(`invoice_lines.tax_code`): ese texto es herencia del FK compuesto de `services_catalog`, no del
patrón, y `updateTaxCode()` no permite renombrar `code`.

### Compras: obligatorio. Trámite: opcional. Y no es una inconsistencia

`CHECK (business_expense_id IS NULL OR tax_code_id IS NOT NULL)`, **validado** (no NOT VALID).
Aplica solo a compras porque:

- En compras el ITBMS es crédito fiscal y va a `200003`; el código importa para la declaración.
- En trámite es pass-through al cliente y no toca `200003`. Las 20 líneas históricas quedaron en
  NULL, y **un UPDATE sobre ellas fallaría** por dos guards ya aplicados: el CHECK NOT VALID de
  la `037` (se hace cumplir en todo UPDATE, SOP-023) y el trigger de inmutabilidad de la `038`.

El backfill de la `045` **no toca trámite** por eso. Si algún día se quiere obligatorio ahí, es
otra migración, después de la limpieza de las 20.

### El backfill de compras: tasa 0 → `EXENTO`

Decidido por Oliver el 16/09/2026. No es inventar el dato: la única opción de cero que el
formulario ofreció desde el 10/09 se llamaba "Exento (0%)", e `ITBMS_0` no tiene un solo uso en
el sistema. Tasa > 0 → el **único** código activo del tenant con esa tasa; con cero o más de uno,
la migración aborta nombrando las líneas.

📋 **Pre-flight contra producción antes de aplicar** (la `045` corre después de 036→037→038→040
en el mismo deploy):

    SELECT tax_rate, COUNT(*) FROM business_expenses GROUP BY 1 ORDER BY 1;
    SELECT code, rate, active FROM tax_codes ORDER BY code;

### Lo que hace el servidor con una línea que llega (`createBusinessExpense`)

1. `resolverCodigosDeImpuesto(db, tenant, ids)` — una consulta a `tax_codes` filtrando **tenant y
   `active`**. La FK es global: sin el filtro de tenant, un id de otro bufete pasa la base.
2. La tasa que se guarda es la del catálogo. Si el body trae `tax_rate: 0` con el id de ITBMS 7%,
   se guarda 7%.
3. El `tax_amount` tecleado se verifica contra `amount × tasa del catálogo` con ±0,02 (el mismo
   margen que trámite). Elegir EXENTO y teclear 7,00 de ITBMS se rechaza nombrando la línea.
   ⚠️ Hasta el 16/09 compras **no verificaba** el ITBMS de la línea: cualquier importe pasaba.

Lo fijan `api/__tests__/business-expense-gate.test.ts` (los cuatro últimos) y
`validators/__tests__/compra-impuesto-por-linea.test.ts`.

### Lo que cambió en el Resumen de ITBMS

**Línea 5 "Compras gravadas"** sale de las líneas con `tax_amount > 0`, no del subtotal del
encabezado. Para la factura del internet (25,00 gravados + 10,00 exentos) reporta **25,00**, antes
35,00. Línea 6 (crédito fiscal) no cambia: siempre fue una suma. Criterio "gravada = tasa > 0";
la alternativa (todo lo que no es `EXENTO`, o sea `ITBMS_0` como gravada al 0%) da el mismo
número mientras `ITBMS_0` no se use. Queda anotado en `task_plan.md`.

### `listTaxCodesActive()` ahora filtra `active`

No lo hacía, a pesar del nombre: un código desactivado seguía apareciendo en facturas y
cotizaciones. Se corrigió al reusar el loader para compras, con los tres códigos activos, así que
no cambió nada visible. Las líneas ya cargadas con un código inactivo conservan su snapshot.

---

## SOP-029: `invoice_kind` ↔ `service_type` — una factura de reembolso no lleva honorarios

**Por qué existe:** Josuarth Torres, por correo el 17/09/2026: *"Las facturas de reembolso solo
deben ser usadas para la facturación de lo que realmente representa un reembolso de gasto y es
exenta del impuesto."* Un barrido de producción encontró tres facturas FAC-REI-* (jul-ago/2026)
con líneas HON-COR adentro.

### El hueco, exacto

`ServiceCombobox` filtra por `invoice_kind` — pero solo decide qué se OFRECE para una línea
NUEVA. Cambiar el "Tipo de documento" del encabezado (`invoice-form.tsx`) **después** de tener
líneas cargadas no dispara nada: `setKind` no tiene ningún efecto que reaccione, así que la línea
vieja queda huérfana. Confirmado con grep sobre `src/` entero: `createInvoice`/`updateInvoice` en
`api/invoices.ts` son los DOS ÚNICOS lugares que escriben en `invoice_lines` — el guard ahí cubre
el 100% de los caminos reales, incluida la conversión de cotizaciones (`convertToInvoices` llama
a `createInvoice` directamente).

🔎 Cotizaciones ya tenía la solución, un nivel más abajo: `quote-lines-editor.tsx` → `onKindChange()`
limpia el `service_id` de una línea cuando deja de combinar con SU kind (ahí es por línea, no por
encabezado). Este SOP es la misma idea, un nivel arriba.

### La regla

`services_catalog.service_type` (`'honorarios' | 'reembolso' | 'subcontratado' | 'otro'`) tiene
que combinar con `invoices.invoice_kind` (`'HONORARIOS' | 'REEMBOLSO'`) en TODAS las líneas de la
factura — en los dos sentidos: ni HON-COR en una REEMBOLSO, ni REIM-* en una HONORARIOS.

    validarConsistenciaDeKind(lineas, serviciosPorId, invoiceKind)   // validators/invoice.ts

Módulo PURO. El caller arma `serviciosPorId`:
  - **Cliente** (`invoice-form.tsx`): desde `props.services`, ya en memoria — solo para no gastar
    un round-trip; el servidor no le cree a esto.
  - **Servidor** (`api/invoices.ts`): `resolverServiciosPorId()`, contra `services_catalog`
    **filtrado por tenant**. `services_catalog.id` es una FK global (sin tenant_id compuesto,
    igual que `expense_lines.tax_code_id` antes de la 045) — sin el filtro, un `service_id` de
    otro bufete pasaría igual. Se cierra de paso, no era el objetivo de este bloque.

Corre ANTES de cualquier INSERT/UPDATE de línea, en `createInvoice` y `updateInvoice`. Rechaza
sin escribir nada: ni encabezado ni líneas.

⚠️ **Una línea Personalizada (`service_id: null`) queda FUERA del control, a propósito.** No tiene
`service_type` contra qué comparar — mismo límite que ya tiene el filtro del combobox hoy. No se
puede clasificar texto libre.

### Bloqueo duro, no advertencia (decisión de Oliver, 17/09/2026)

Josuarth pidió "una alerta". Se decidió bloqueo duro: una advertencia dismissible es el mismo
mecanismo por el que ya pasó tres veces — no cambia el resultado, solo agrega un clic que se
puede saltear. La consecuencia es fiscal (la serie REI se declara exenta ante la DGI), no
cosmética.

Mensaje (SOP-027: un motivo, el elemento concreto nombrado, el próximo paso):

> *"No se puede guardar: la línea 2 (HON-COR · Honorarios corporativos) es un servicio de
> Honorarios, y esta factura es de Reembolso — una factura de reembolso solo puede llevar líneas
> de reembolso. Cambie el servicio de esa línea, o cambie el Tipo de documento a Honorarios."*

`MutationError` ganó un campo `fieldErrors?: Record<string,string>` — separado de `detail`
(que el propio comentario de la clase documenta como "NO mostrar al usuario"). Las dos rutas
(`POST` y `PATCH` de `/api/finanzas/invoices`) lo reenvían junto con `error`.

### El slot muerto que se conectó de paso

`invoice-line-items.tsx` ya leía `errors["lines.<idx>.service"]` en `lineErrors.service`, pero
nunca lo renderizaba, y la fila de la línea no tenía `data-error` — el scroll-to-error de
`invoice-form.tsx` no llegaba ahí. Los dos se agregaron.

### Fuera de este SOP, anotado en `task_plan.md`

- El tax_code de una línea REIM se puede sobrescribir a gravado (`onTaxChange` no lo impide) —
  familia del mismo problema, distinto de lo que Josuarth reportó.
- La cuenta `130003` de los reembolsos y el Decreto 91 art. 7-H — dos definiciones de Josuarth
  sin código todavía, ver `task_plan.md`.


## SOP-030: Reversar un cobro contabilizado — una función de Postgres, no tres llamadas

**Por qué existe:** desde el gate del 04/09 un cobro con asiento no se puede borrar, y el mensaje
prometía una reversión que no existía. Y porque reversar es la operación donde un estado a medias
en los libros es inaceptable: el espejo posteado (inmutable) con la factura todavía "pagada".

### Cuándo se reversa y cuándo se elimina

| El cobro… | Botón | Camino |
|---|---|---|
| NO tiene asiento (anterior al cableado del 04/09) | Eliminar | `deletePayment` → DELETE, CASCADE, T7a |
| tiene asiento (`journal_entries` con `source_type='pago'`) | Reversar | `reversePayment` → RPC `reverse_payment` |
| ya está `anulado` | ninguno | fila tachada, con motivo y N° del espejo |

Nunca los dos botones a la vez. La sección decide por `p.asiento`, y el servidor lo vuelve a
decidir por su cuenta (409 en los dos sentidos).

### Qué hace el RPC, en orden, y por qué en ese orden

1. Candado sobre el cobro (`FOR UPDATE`), estado `registrado`.
2. Busca el asiento original y rechaza si ya hay otro con `reverses_entry_id` apuntándole.
3. **Verifica** que `p_lines` sea el espejo exacto del original (`EXCEPT ALL` en los dos
   sentidos sobre cuenta/débito/crédito). No lo calcula: lo compara.
4. `post_journal_entry(... 'reversion', p_lines, source_id = cobro, reverses_entry_id, motivo,
   reference = la del original)`. Va primero porque es el paso con más motivos legítimos para
   fallar (período cerrado). En una transacción el orden no cambia el resultado; cambia qué
   queda en el log.
5. `INSERT INTO payment_reversals` (la foto) y `DELETE FROM payment_applications` → T7a
   recalcula `amount_paid` y el status de la factura.
6. `UPDATE payments SET status = 'anulado'` (T3 lo permite desde `registrado`).

Cualquier excepción en cualquier paso deshace TODO. `sql/tests/verificacion-046-reversion-cobro.sql`
lo prueba con un trigger que revienta entre el paso 4 y el 5.

### La fecha

La de la reversión (`current_date` ±1 día de tolerancia entre el reloj del servidor y el de la
base). Nunca la del original: acta del 09/09. El servidor y el diálogo calculan "hoy" con la misma
fórmula del resto del módulo (`new Date().toISOString().slice(0, 10)`, UTC).

### El espejo se arma UNA vez

`construirAsientoDeReversion(original, { hoy, motivo, source_id })` en
`contabilidad/reversion.ts`. Lo llama el diálogo para la vista previa y el helper para postear.
Si la pantalla necesita mostrar algo distinto de lo que devuelve esa función, **la función está
mal, no la pantalla**: se corrige ahí y cambia en los dos lados.

### Qué mirar si algo falla

- *"Las líneas recibidas no son el espejo exacto del asiento N"* → alguien cambió
  `construirAsientoDeReversion` (o el RPC) sin el otro. Correr `reversion.test.ts` y la
  verificación SQL.
- *"El período AAAA-MM está CERRADO"* → la reversión cae en el mes actual; si está cerrado, el
  contador lo reabre en `/finanzas/periodos` y vuelve a intentar. No se postea con otra fecha.
- El cobro reversado no aparece en la factura → `payment_reversals` vacía para ese cobro. El
  RPC es el único que escribe ahí; si la fila no está, la reversión no ocurrió.
- *En staging, una factura reversada vuelve a "Pago parcial" después de correr el seed* → es
  FND-005 (21/09/2026): el seed veía la aplicación borrada por la reversión y la volvía a crear.
  Desde ese día `seedPayments()` respeta los cobros `anulado` y lo dice en el resumen ("N
  reversados en staging, sin tocar"). Si vuelve a pasar, revisar que ese guard siga ahí.

## SOP-031: Recibo de caja — numeración `REC-`, huecos aceptados, PDF y dos puertas

**Por qué existe:** desde el 21/09/2026 un cobro es un recibo de caja con número propio,
pantalla propia (`/finanzas/cobros`) y PDF. Este SOP fija las decisiones que no se deducen del
código y que alguien podría "arreglar" sin saber por qué están así.

### 1. El número: correlativo interno, no fiscal

`payments.payment_number` = `REC-` + seis dígitos, de la secuencia `'payment'` de
`numbering_sequences` (migración `047`), por la MISMA RPC `get_next_sequence_number` que
facturas, cotizaciones, clientes y proveedores. Un recibo de caja **no es documento fiscal en
Panamá**: no pasa por la DGI, no lleva CUFE, y por eso el correlativo lo lleva el bufete.

Formato en `numbering/receipt-numbering.ts` (`formatReceiptNumber`). Es el mismo que escribe
el backfill de la 047 (`'REC-' || lpad(n, 6, '0')`); un test lo fija. Índice único parcial
sobre `(tenant_id, payment_number)`.

### 2. 🔴 Los huecos en la numeración son una decisión, no un descuido

`createPayment` toma el número **después de todas las validaciones y antes del INSERT**, y lo
escribe en el mismo INSERT. Si después falla la aplicación o el asiento (período cerrado, banco
inválido), el DELETE compensatorio deshace el cobro, pero **el número ya se consumió**: la
secuencia no tiene rollback, y no puede tenerlo sin que dos altas concurrentes compartan un
número. Queda un HUECO.

Se acepta a conciencia (Oliver, 21/09/2026), con el criterio de `emitInvoice`:

- Un hueco se explica. Un recibo no es fiscal, así que no tiene consecuencia ante la DGI.
- La alternativa —numerar DESPUÉS del asiento— dejaría, si el UPDATE final falla, **un cobro
  contabilizado sin recibo**, y ese estado no se puede compensar porque el asiento es inmutable.
- Un RPC atómico (número + INSERT + aplicación + `post_journal_entry` en una transacción, como
  `reverse_payment`) daría cero huecos. Se descartó para este bloque porque
  `construirAsientoDeCobro` arma el asiento releyendo el cobro **ya insertado**
  (`cargarCobroParaAsiento`); harían falta un loader desde el input y un RPC nuevo. Es un
  bloque aparte, de un día, si algún día el bufete lo pide.

Hay un test en `payments-gate.test.ts` que fija el hueco como hecho documentado: si alguien lo
"arregla" moviendo el número después del asiento, el test lo nombra.

### 2b. 🔴 Y el número del ASIENTO es el mismo que el de la factura (FND-011, 22/09/2026)

Un hueco se acepta; un asiento con el número de OTRO documento, no. `emitInvoice` es el único
creador que escribe el número **después** de postear (paso 3 correlativo → 3b asiento → 4
UPDATE), así que es el único donde el UNIQUE `invoices_tenant_number_unique` puede fallar con el
asiento ya en un libro inmutable. Pasó en staging el 22/09: asiento 43 con `FAC-HON-000007`
—número de otra factura— sobre un borrador, porque el seed rebobinaba `numbering_sequences`.

Dos cierres en `api/invoices.ts`, los dos con test que falla sin ellos
(`emit-invoice-numero-del-asiento.test.ts`):

1. **`asegurarNumeroLibre()` antes de postear.** Si el número ya es de otra factura: 409, no se
   postea nada y la factura sigue en borrador. El mensaje dice que la numeración quedó detrás.
2. **`asientoDeFacturaExistente()` en el reintento.** Una emisión que posteó y no llegó al
   UPDATE se retoma con el número **del asiento** (`reference`), no con uno nuevo, y sin volver a
   postear. Lo hace posible el UNIQUE `journal_entries_un_asiento_por_documento` (tenant,
   source_type, source_id) de la `034`. Si ese número ya se lo llevó otra factura → 409 que
   nombra el asiento; si el asiento no tiene `reference` (anterior a la `039`) → 409 en vez de
   inventar uno.

Los otros tres creadores con correlativo —`createPayment` (`REC-`), `createSupplierPayment`
(`CE-`) y `createCreditNote` (`NC-`)— escriben el número **en el mismo INSERT** y postean
después, así que una colisión aparece antes de tocar el libro y el DELETE compensatorio alcanza.
No hay que "emparejarlos" con esto.

⚠️ **Un asiento mal posteado NO se borra: se reversa.** `scripts/reversar-asiento-huerfano.ts`
postea el espejo con `construirAsientoDeReversion` (fecha de hoy, `reverses_entry_id`), que es la
misma función del diálogo de cobros y de la anulación. Solo staging.

### 3. Dos puertas, un formulario, dos rutas a la misma función

Se registra desde el detalle de la factura (diálogo, UNA factura) o desde `/finanzas/cobros/nuevo`
(una o VARIAS, desde la Parte B del 21/09/2026). Las dos usan
`components/finanzas/cobros/payment-form-fields.tsx` y llegan a la misma `createPayment`: el
diálogo por el atajo `POST /api/finanzas/invoices/[id]/payments` (envuelve el body en una
aplicación) y el alta por `POST /api/finanzas/payments` con `applications[]`. **No hay una segunda
validación.** `payment-form-una-sola-implementacion.test.ts` lee las puertas y falla si alguna
vuelve a declarar sus campos.

**Varias facturas, cómo:** un recibo es de UN cliente (400 si se mezclan); el total de la
transferencia tiene que ser IGUAL a la suma de lo aplicado; cada monto ≤ el saldo de su factura;
ninguno en 0 (el CHECK de `payment_applications` lo prohíbe: la fila en 0 se saca). El reparto lo
propone la pantalla por antigüedad (`lib/finanzas/cobros/repartir-por-antiguedad.ts`, de la más
vieja a la más nueva) y la persona lo corrige; el servidor no reparte, valida.

🔴 **El excedente se rechaza**, no se guarda como `amount_unapplied`: sin saber si va a 100004 o a
una cuenta de anticipos, el asiento no se puede postear bien, y una cuenta por cobrar con saldo
acreedor no es una cuenta por cobrar (Oliver, 21/09). El mensaje dice los dos montos, la
diferencia y la salida (otra factura del mismo cliente o ajustar el monto). La pregunta que lo
desbloquea está en `task_plan.md` para Josuarth.

**El asiento sigue siendo UNO de DOS líneas** (banco / 100004 por el total): 100004 es cuenta
control y su auxiliar es por cliente; el detalle por factura vive en `payment_applications` y en
el PDF. Su `reference` es el número de recibo. La reversión (046) no cambió: fotografía y borra
TODAS las aplicaciones y T7a devuelve cada factura.

#### (texto original del 21/09, mañana)
### 3. Dos puertas, un formulario, una ruta

Se registra desde el detalle de la factura (diálogo) o desde `/finanzas/cobros/nuevo` (dos
pasos). Las dos usan `components/finanzas/cobros/payment-form-fields.tsx` (campos, validación
de cliente, armado del body) y pegan a `POST /api/finanzas/invoices/[id]/payments` →
`createPayment`. **No hay una segunda ruta ni una segunda validación.**
`payment-form-una-sola-implementacion.test.ts` lee las dos puertas y falla si alguna vuelve a
declarar sus campos. Cuando se agregue una puerta nueva, se suma a la lista `PUERTAS` de ese
test.

El día que entre "un recibo aplicado a varias facturas", nace `POST /api/finanzas/payments`
con `applications[]`; hasta entonces `invoice_id` va en el path.

### 4. El PDF: cache por hash, y se regenera al reversar

`ensure-receipt-pdf.ts` es el espejo de `ensure-invoice-pdf.ts`: fila en `documents` con
`entity_type='payment'` y `source='auto_receipt_pdf'` (047), blob en
`{tenant}/receipt_pdf/{payment_id}/current.pdf` (la primera carpeta es el tenant, SOP-015),
hash SHA-256 con la misma serialización canónica que factura y cotización
(`receipt-pdf-hash.ts`).

- **Entran al hash** `status` y la reversión: al reversar, el PDF cambia (banda roja, motivo,
  asiento espejo) y se regenera solo en la próxima descarga.
- **NO entra** el saldo actual de la factura: cambia con cada cobro posterior y el recibo es
  una foto del cobro, no de la cuenta corriente.
- **RUC y DV en dos campos** también en el PDF (`clients.digito_verificador`); un test busca
  la concatenación.
- La ruta `GET /api/finanzas/payments/[id]/pdf` devuelve el ARCHIVO (`serveStorageFile`), con
  los mismos roles que el PDF de la factura (admin, abogada, contador). Un test cruza las dos
  listas.

### 5. El backfill y el seed

La 047 numera todos los cobros existentes por `payment_date, created_at, id` y deja
`last_number` en el último. Es idempotente (numera solo los NULL). `seed-staging.ts` llama a la
misma función después de sembrar pagos, porque en un `--reset` la migración corre sobre
`payments` vacía. **Un cobro reversado conserva su número.**

⚠️ Y desde el mismo día el seed **respeta los cobros `anulado`**: antes recreaba la aplicación
que la reversión había borrado y la factura volvía a "pagada" (FND-005).

### Qué mirar si algo falla

- *"No se pudo asignar el número de recibo. ¿Está aplicada la migración 047…?"* → la secuencia
  `'payment'` no existe en esa base. Aplicar la 047.
- Un `REC-` salteado en el listado → un alta que falló después del correlativo. Buscar en los
  logs el `DELETE compensatorio`; no es un bug, ver el punto 2.
- Un cobro sin número en el listado → base sin backfill. Correr la 047 (es idempotente) o
  `SELECT backfill_payment_numbers('<tenant>')`.
- El PDF de un cobro reversado sale sin la banda → el hash no cambió: revisar que
  `buildReceiptPdfPayload` siga incluyendo `status` y `reversion`.


## SOP-032: Pagos a proveedores — parcial sí, uno por compra, el banco en el PAGO, saldos heredados

**Por qué existe:** desde el 21/09/2026 (Bloque 3, migración `048`, aplicada SOLO en staging) el
pago de una compra del bufete es una entidad (`supplier_payments`) con número `CE-000001`,
asiento propio y PDF, y ya no un botón que escribía tres columnas de la compra. Este SOP fija lo
que no se deduce del código.

### 1. Las dos reglas de Josuarth (21/09/2026), textuales

> 3. A un proveedor SÍ se le puede pagar por partes (pago parcial).
> 4. NO hace falta que un pago cubra varias facturas de proveedor. Un pago por factura.

O sea: **varios pagos por compra; cada pago apunta a UNA compra.** Sin tabla N:M. Es la
diferencia estructural con los cobros (Parte B): acá `repartirPorAntiguedad` no se importa.

### 2. 🔴 `amount_paid` y `status` de la compra NO se escriben: se escribe el PAGO

Es el mismo criterio que `invoices.amount_paid` (SOP-017): `business_expenses.amount_paid` la
deriva el trigger `finanzas_recalc_one_expense_amount_paid` como `SUM(amount)` de los pagos
`registrado`, y con ella el `status` (`0 → pendiente_pago`, `0 < x < total → parcialmente_pagado`,
`≥ total → pagado`) y `payment_date` (la del último pago). El guard
`finanzas_guard_expense_amount_paid` rechaza cualquier otra escritura de las tres, en UPDATE y en
INSERT (una compra NACE `pendiente_pago` con 0). La válvula de escape es la misma de SOP-017
(`finanzas.amount_paid_override`) y tiene los mismos "cuándo NO".

**"Ya está pagada" en el alta** significa registrar el pago al crear: fecha, método y BANCO
obligatorio. El servidor crea la compra (pendiente) y después el pago con su asiento. Si el pago
falla, la compra queda `pendiente_pago` —es la verdad— y la pantalla lleva al detalle con el
error, donde está "Registrar pago". `updateBusinessExpense` ya no escribe estado ni fecha de pago.

### 3. 🔴 El banco vive en el PAGO, y el asiento sale del PAGO

FND-009: el botón viejo escribía `business_expenses.payment_account_code`, columna que la tabla
no tiene. Ahora `supplier_payments.payment_account_code` es NOT NULL para un pago, y
`construirAsientoDePagoProveedor` parte del pago: `source_id = pago_id` (el UNIQUE de la 034
permite el segundo pago de la misma compra), monto = `amount` del pago, `reference =
payment_number`. DEBE 200001 / HABER banco. `loadDestinosDeOrigen` resuelve pago → compra para
que el Mayor y el Diario abran la compra.

### 4. Numeración `CE-`, y el hueco

Secuencia `'supplier_payment'` de `numbering_sequences` (048), formato en
`numbering/supplier-payment-numbering.ts`. **"CE-" (comprobante de egreso) es una propuesta**
hasta que Josuarth confirme el nombre (`task_plan.md`); cambiarlo es una constante.
`createSupplierPayment` toma el número después de las validaciones y antes del INSERT; si el
asiento falla, el DELETE compensatorio deshace el pago y **queda un hueco**, con el mismo criterio
y la misma justificación de SOP-031 §2. Un test lo fija.

### 5. 🔴 Un SALDO HEREDADO no es un pago

La 048 crea, por cada compra `pagado` sin pagos, UN `supplier_payment` con `kind =
'migrated_balance'` por el total: **sin número, sin banco, sin método, sin asiento, sin
comprobante** (el CHECK `supplier_payments_kind_consistency` lo hace imposible de violar). Motivo
(Oliver, 21/09): en cobros los cobros existentes eran reales; acá la mayoría de las compras están
en `pagado` por el default de la 010 y un `CE-000001` para eso es un documento inventado que
terminaría impreso frente a un proveedor o a la DGI.

Qué hace cada pantalla con él:
- El detalle de la compra lo muestra como **"Saldo heredado de la migración — no es un pago
  registrado"**, con Eliminar y SIN Reversar ni Comprobante.
- **Eliminarlo es la corrección honesta** si la compra nunca se pagó: vuelve a `pendiente_pago`
  y a la antigüedad. Si SÍ se pagó, primero se registra el pago real (con banco y asiento) y
  después se elimina el heredado.
- `reverseSupplierPayment` le responde 409; `GET …/supplier-payments/[id]/pdf` también.
- La antigüedad por pagar los cuenta aparte ("saldos heredados"), no como pagos sin asiento.
- El backfill de numeración (`backfill_supplier_payment_numbers`) los ignora.

### 6. Reversar: el RPC `reverse_supplier_payment` (048)

Igual que `reverse_payment` (SOP-030) pero sin aplicaciones que fotografiar: candado sobre el
pago, verificación del espejo contra el original (`EXCEPT ALL`), `post_journal_entry` del espejo
con la fecha de HOY, `UPDATE supplier_payments SET status='anulado'` (el trigger de §2 devuelve
la compra). Una transacción; `sql/tests/verificacion-048-pagos-a-proveedores.sql` fuerza una falla
después del posteo. El diálogo es `reverse-payment-dialog.tsx` con `variante="pago"`: la vista
previa es la MISMA función (`reversion-una-sola-implementacion.test.ts` sigue leyendo ese archivo).
Un pago SIN asiento se elimina (`DELETE …/supplier-payments/[id]`); con asiento, 409 → reversar.

### 7. El PDF: comprobante de egreso

`ensure-supplier-payment-pdf.ts` es el espejo de `ensure-receipt-pdf.ts`: `documents` con
`entity_type='supplier_payment'` y `source='auto_supplier_payment_pdf'` (048), blob en
`{tenant}/supplier_payment_pdf/{id}/current.pdf`, hash con la misma serialización. Entran
`status` y la reversión (se regenera con la banda roja); **NO entra el saldo actual de la compra**
—y a propósito tampoco un "saldo después de este pago": cambiaría al reversar un pago anterior, y
el comprobante es una foto del pago, no de la cuenta corriente. Proveedor con **RUC y DV en dos
líneas** (`suppliers.ruc`, `suppliers.dv`); sin ficha vale el texto libre y el DV va vacío.
Ruta `GET /api/finanzas/supplier-payments/[id]/pdf`, roles = compras (admin, abogada, contador),
devuelve el archivo. El botón es `DownloadReceiptPdfButton` con `variante="egreso"`.

### 8. Vocabulario del Diario y del Mayor

Desde el 21/09 `pago` se rotula **"Cobro"** y `pago_proveedor` **"Pago a proveedor"**
(`TIPO_TRANSACCION_ES`, `libro-mayor.ts`). Con los dos orígenes en el mismo Diario, "Pago" para un
recibo de caja se leía al revés. Es el vocabulario de Josuarth: vender, cobrar, comprar, pagar.

### Qué mirar si algo falla

- *"No se pudo asignar el número del comprobante…"* → falta la secuencia `'supplier_payment'`.
  Aplicar la 048.
- Un `CE-` salteado → un alta que falló después del correlativo (§4). No es un bug.
- Una compra "Pagado" cuyo único pago es un saldo heredado → es la 048, no un error. Ver §5.
- *"no puede escribirse directamente"* al tocar `status`/`amount_paid`/`payment_date` de una
  compra → el guard de §2. Se escribe el pago, no la compra.
- El comprobante de un pago reversado sale sin la banda → revisar que
  `buildSupplierPaymentPdfPayload` siga incluyendo `status` y `reversion`.
- La antigüedad por pagar no cuadra contra el mayor y nombra una "tercera causa" → FND-010:
  los gastos de trámite acreditan 200001 y el reporte no los lee. Bloque propio.


## SOP-033: Gasto de trámite completo — nace en el libro, se paga aparte, se reversa

**Por qué existe:** desde el 21/09/2026 (Bloque 4, migraciones `049` y `050`, SOLO en staging) el
gasto de trámite (`expenses`, módulo Legal) cierra su ciclo contable: se postea al crearse, se
paga con un `CE-` por el mismo motor que las compras, se reversa, y la antigüedad por pagar lo
lee. Cuatro cosas dejaron de ser como eran y alguien podría "devolverlas" sin saber por qué.

### 1. 🔴 El posteo dejó de ser manual, y el botón NO hacía falta

Josuarth: registrar el gasto YA es la transacción (DEBE la cuenta de cada línea / HABER 200001,
acta del 25/08). Hasta el 21/09 el asiento dependía de "Registrar en el libro contable" en
`/finanzas/gastos-tramite/{id}`, que el contador no podía apretar; 20 de 21 gastos de staging
nunca llegaron al libro. Ahora `POST /api/expenses` postea en el mismo acto, con el orden de
D1: insert gasto + líneas → posteo → `posted_entry_id`; **si el posteo falla, DELETE
compensatorio del gasto** (las líneas caen por el CASCADE de la 036; el trigger de la 038 lo
deja pasar porque todavía no hay asiento) y el error vuelve como *"El gasto no se registró:
<motivo>"* (período cerrado, cuenta inválida). Una implementación (`postearGastoTramite`,
`lib/finanzas/api/expense-tramite.ts`) para las dos puertas.

**El botón sigue existiendo como REINTENTO**, no como camino: es para los gastos anteriores al
cambio, que nacieron sin asiento y cuyas líneas hay que clasificar primero. Un gasto nuevo nunca
llega a él (nace con `posted_entry_id`; la capa 1 responde 409). Si alguien lo saca, los gastos
viejos de producción (128 según el pre-flight del 03/09) no tienen forma de entrar al libro.

Consecuencias: el gasto **nace inmutable** (038) —por eso la reversión va ANTES (D6)—, y un
mes cerrado rechaza el alta con fecha en ese mes, igual que compras y facturas.

### 2. La reversión (`reverse_expense_tramite`, 050)

Espejo de la 046/048: motivo, fecha de HOY, líneas verificadas con `EXCEPT ALL` (el RPC no
construye), `post_journal_entry` con `reverses_entry_id`, `expenses.status = 'anulado'` con la
llave `finanzas.tramite_anular` (049). UNA transacción. 🔴 **Un gasto con pagos registrados no se
reversa**: primero se eliminan o reversan sus pagos. `posted_entry_id` queda (trazabilidad); el
gasto se muestra "Anulado · asiento N" con su espejo. Roles = reversar un cobro (admin, abogada,
contador). Diálogo: `reverse-payment-dialog.tsx` con `variante="gasto"` (misma vista previa).

### 3. 🔴 El pago es la SEGUNDA transacción, y va por el arco de la 049

`supplier_payments` tiene `business_expense_id` O `expense_id` (`CHECK num_nonnulls = 1`, el
patrón de `expense_lines`). Una sola serie `CE-`, un solo comprobante de egreso, un solo RPC de
reversión ramificado. `expenses.amount_paid` y `status` (`pendiente_pago` /
`parcialmente_pagado` / `pagado` / `anulado`) los deriva el trigger de la 049 con su guard: NO se
escriben. **Un gasto sin asiento no se paga (409)**: no hay cuenta por pagar en el libro que
debitar. Dos entradas (Oliver, 21/09): (a) "Ya se pagó" en el formulario del caso — admin y
abogada — dispara el pago en el mismo acto pero como asiento separado; si el pago falla, **el
gasto QUEDA** pendiente y se avisa (no se deshace un gasto por un pago que no entró). (b)
"Registrar pago" en `/finanzas/gastos-tramite/{id}` — admin y contador. La ruta
`POST /api/expenses/[id]/payments` admite a los tres.
🔒 `supplier-payments-dos-destinos.test.ts`: toda lectura que embeba la compra embebe también el
gasto de trámite; si no, el otro destino sale vacío sin que nada falle.

### 4. 🔴 `expenses.payment_account_code` sigue ahí y NO se escribe

Es un resto de la 036: nadie lo escribe, la 038 lo congela en cuanto hay asiento, y el banco es
del PAGO (FND-009: un documento puede tener varios pagos de bancos distintos). La 049 lo dejó
congelado a propósito; si alguien le "arregla" el banco escribiéndolo ahí, el trigger lo rechaza y
el pago no sale de igual manera. Se dropea en una migración posterior (D3).

### 5. `supplier_id` sí se reabrió; la antigüedad y el drill-down

La 049 saca `supplier_id` de la lista congelada de la 038: un gasto asentado recibe su ficha
después (los anexos de renta la necesitan; el asiento no cambia, 200001 no tiene auxiliar). Sin
proveedor no se bloquea (D2): el auxiliar lo agrupa como "(sin proveedor)" y el comprobante lo
dice. La antigüedad por pagar lee los gastos de trámite **en el libro** (FND-010 cerrado); los que
no tienen asiento no están en 200001 y no entran hasta que se registren. Mayor y Diario abren el
gasto (`DIRECTOS`, `DOCUMENTO_DE` con el concepto truncado).

### Qué mirar si algo falla

- *"El gasto no se registró: …"* al crear un gasto → el posteo falló y el gasto se deshizo. El
  motivo es el del RPC (período cerrado es el común). No hay nada que limpiar.
- *"Este gasto todavía no está registrado en el libro contable"* al pagar → gasto anterior al
  21/09: clasificar las líneas y apretar "Registrar en el libro contable" primero.
- *"Este gasto tiene N pago(s) registrado(s)"* al reversar → primero los pagos.
- `PGRST200` al leer una reversión → PostgREST no resuelve el self-join de `journal_entries` por
  nombre de FK; `getReversionDeGastoTramite` lee el original aparte a propósito.
- Un gasto viejo que no aparece en la antigüedad por pagar → no está en el libro (punto 5).

## SOP-034: Nota de crédito contable — por líneas, dos asientos distintos, documento interno

**Por qué existe:** desde el 22/09/2026 (Bloque 5, migraciones `051`–`053`, SOLO en staging) la
nota de crédito dejó de ser "la card de una factura anulada" y pasó a ser un documento contable
con líneas, asiento y pantalla. Cierra 2.5, 2.6 y 3.5 de la auditoría del 21/09 y la regla del
acta del 09/09 ("cerrado el mes, nota de crédito con fecha del día"). Hay cinco decisiones que
alguien podría deshacer creyendo que simplifica.

### 1. 🔴 Por líneas con cantidad, nunca por monto libre

Josuarth: "factura de mil, nota de crédito de doscientos". La tentación es un campo "monto". No:
la factura es líneas con cantidad, precio y tasa, y su asiento se arma POR LÍNEA (cuenta de
ingreso del servicio, 130003 en los `REIM-*`, ITBMS por tasa). Una NC por monto obligaría a
prorratear entre cuentas y tasas y el ITBMS saldría inexacto. Una NC por líneas da el asiento
exacto. `credit_note_lines` copia `unit_price`, `tax_rate`, `tax_code_id` de la línea de la
factura (una NC no inventa precios) y `invoice_line_id` la ata a la línea que acredita.

Dos capas puras en `validators/credit-note.ts`: la forma del request
(`validateCreateCreditNoteInput`) y la regla contable (`validarLineasDeNotaDeCredito`): cada
línea acredita como máximo lo facturado MENOS lo ya acreditado por NC anteriores de esa línea;
el total no supera `balance_due` (**D7: lo cobrado no se acredita — "reverse el cobro primero"**).
`totalDeLineaDeNc` es la única implementación del total (subtotal redondeado + impuesto
redondeado, como T8c) y el diálogo lo usa para la vista previa: si reimplementa, miente.
`acreditadoPorLineaDeFactura` es la única consulta de lo ya acreditado: la pantalla ofrece
exactamente lo que el servidor va a aceptar.

### 2. 🔴 Dos caminos, dos asientos — y la NC de una anulación NO tiene el suyo (D5)

| Camino | Cuándo | Documento | Libro |
|---|---|---|---|
| **Anular** | mes de la factura ABIERTO, sin pagos, sin NC | NC total automática (`createCreditNoteFromInvoice`, la MISMA `createCreditNote` con todas las líneas) | **reversión** del asiento de la factura (`construirAsientoDeReversion`, espejo verificado con EXCEPT ALL), fecha de HOY, `reverses_entry_id` |
| **Nota de crédito** | siempre que quede saldo; obligatorio con el mes cerrado | NC parcial o total por líneas | **asiento propio** `source_type = 'nota_credito'`, **`source_id = la NC`**, `reference = NC-…` (`asiento-nota-credito.ts`: la factura al revés) |

La anulación la hace el RPC `cancel_invoice_with_reversal` (052) en UNA transacción: verifica
mes, pagos, NC en el libro (053), espejo; postea la reversión; marca `anulada`. La app crea la NC
ANTES y, si el RPC falla, la deshace (§4). **Postear además el asiento de la NC sería contabilizar
dos veces**: por eso `cancelInvoice` no conoce `construirAsientoDeNotaDeCredito` y hay un test que
lo lee. El detalle de una NC de anulación muestra la reversión como "lo que corrige el libro".

**Corolario (053): una factura con una NC en el libro ya no se anula.** Factura de 1.000 con
asiento A, NC parcial de 200 con asiento B, anular espejaría A completo: ingreso revertido por
1.200. Lo que falta se acredita con otra NC. `cancelInvoice` mira `credited_total > 0`; el RPC mira
la EXISTENCIA de un asiento `nota_credito` de alguna NC de la factura — porque cuando corre, la
app ya creó la NC total de esa misma anulación (sin asiento) y `credited_total` ya es el total.

### 3. 🔴 El mes de la FACTURA, no el de hoy (D4)

`periodoDeLaFacturaCerrado(issue_date)` en la app (409 con el texto de Josuarth) y en el RPC. Es
otro control que el de `post_journal_entry`, que mira el mes de la fecha del asiento (hoy). Los
dos hacen falta: uno decide si se puede anular, el otro si se puede escribir. El detalle de la
factura reemplaza "Anular" por "Nota de crédito" con un aviso, y el diálogo lo repite.

El "GATE CONTABLE (02/09/2026)" que bloqueaba anular cualquier factura con asiento se eliminó:
era un tapón mientras no existía la reversión. Un test falla si vuelve.

### 4. La válvula de compensación (`finanzas.nc_compensar`, 052)

T6 rechaza el DELETE de `credit_notes` y el trigger de líneas también — correcto para una NC
emitida. Pero el creador inserta la NC ANTES de postear (número tomado, líneas insertadas) y si
el posteo falla hay que deshacerla, igual que el cobro y el pago (SOP-031). Sin válvula quedaría
una NC con número y sin libro. `finanzas_compensar_nota_de_credito(tenant, nc)` pone la llave y
borra líneas + cabecera **en la misma transacción**, y T6 la rechaza igual si la NC ya tiene
asiento `nota_credito` (con asiento no hay válvula: se reversa, cuando exista). Los huecos en
`NC-` que deja son los mismos huecos aceptados de SOP-031. `verificacion-052` lo prueba forzando
la falla después del posteo.

### 5. `credited_total`, `balance_due` y "Acreditada total" (051, D3)

`invoices.credited_total` es DERIVADA por trigger de las NC `emitida`, con guard (llaves
`finanzas.recalc` / `amount_paid_override`, mismo patrón que `amount_paid`). `balance_due` se
recreó como `grand_total − amount_paid − credited_total` (era GENERATED sin el crédito;
dependencias contadas en `pg_depend` antes del DROP: solo su `pg_attrdef`). T7a deriva el status
contra el total NETO: **acreditada al 100% sin pagos = `emitida` con saldo 0, NO `pagada`** —
no hubo cobro. "Acreditada total" es un badge derivado (`credited_total >= grand_total`), no un
status: no se agregó valor al CHECK. La antigüedad por cobrar filtra por `balance_due > 0`, así que
esa factura deja de ser una cuenta por cobrar sin tocar el reporte.

### 6. Documento INTERNO hasta que la DGI diga otra cosa (D1)

`credit_notes` tiene las 13 columnas fiscales de `invoices` (051) y nace `fe_estado =
'no_emitida'`. El envío al PAC (tipo 04) es otro bloque. Mientras tanto la NC vale en los libros
del bufete y NO como comprobante fiscal: la pantalla lleva la banda roja, el PDF una banda fija
"DOCUMENTO INTERNO — SIN AUTORIZACIÓN DE LA DGI" en cada página, y el badge dice "Sin emitir a
la DGI" en ámbar (a propósito distinto del "Sin enviar" gris de la factura: una factura sin enviar
es lo normal mientras se prepara; una NC contable sin DGI es una advertencia). No se le entrega
al cliente.

### 7. Quién, dónde, y qué NO existe

- Emiten y anulan: admin y abogada (`POST /api/finanzas/credit-notes`,
  `POST /api/finanzas/invoices/[id]/cancel`, con `createAdminClient()` como ledgerDb).
- Ven el detalle (`/finanzas/notas-credito/{id}`) y el PDF: admin, abogada, contador. El contador
  entra por patrón exacto en `route-access.ts` (sin listado); Mayor y Diario lo llevan ahí
  (`DIRECTOS.nota_credito` → `credit_notes`, `RUTA_DEL_DOCUMENTO.nota_credito`). La reversión de
  una factura (052) y de un gasto de trámite (050) también enlazan a su documento.
- **NO existe**: reversión de una NC, NC de compra (D6), envío de la NC a la DGI, NC sobre
  factura ya cobrada (saldo acreedor — pregunta a Josuarth en `task_plan.md`).

**Verificación:** `sql/tests/verificacion-051/052/053-*.sql` (ROLLBACK); tests
`credit-note.test.ts`, `nota-de-credito-un-solo-creador.test.ts`, `asiento-nota-credito.test.ts`,
`nota-de-credito-pantalla.test.ts`; `scripts/verificar-nota-de-credito.mts` contra el deploy
(prepara facturas por la API si no quedan candidatas).

## SOP-035: Asientos de diario — el tercero, el clon y la reversión

**Por qué existe:** desde el 22/09/2026 (Bloque 7, migraciones `054` y `055`, SOLO en staging) un
asiento de diario tiene tercero por línea, pantalla propia, botón de clonar y reversión. Son
cuatro decisiones que alguien podría deshacer creyendo que simplifica.

### 1. 🔴 El tercero son DOS FK reales, y `ON DELETE NO ACTION`

`journal_entry_lines.client_id` / `.supplier_id`, con `CHECK num_nonnulls(...) <= 1`. En el repo
conviven los dos patrones —arco exclusivo con FK (`expense_lines`, `supplier_payments`) y
discriminador suelto (`documents`, que **no tiene ninguna FK** a lo que nombra)— y para el libro
decide solo: una línea es inmutable y eterna, así que un puntero colgado ahí no se arregla nunca.

**`SET NULL` sería una bomba de tiempo**: los triggers `trg_jel_no_update` / `trg_jel_no_delete`
(023) rechazan todo UPDATE sobre esas líneas, así que el `SET NULL` fallaría *dentro* del DELETE
del cliente, con un error sobre el ledger disparado desde la pantalla de Clientes. Con NO ACTION
el rechazo es de la FK, claro y atrapable, y la app lo traduce (§2).

Consecuencia buscada y hay que decirla en voz alta: **un cliente o un proveedor nombrado en el
libro ya no se puede eliminar.** Nunca. Se desactiva.

El tercero se puede poner en CUALQUIER línea, no solo en las de control (D3): acotarlo sería una
regla contable que nadie pidió.

### 2. El borrado bloqueado se EXPLICA, no se filtra

`buildLedgerBlockMessage()` (clientes) y el conteo equivalente en `deleteSupplier` (proveedores).
El mensaje dice *"aparece en N línea(s) de asiento del libro contable… el libro es inmutable"* y
**no promete que se destrabe borrando otra cosa**, porque no se destraba. En clientes el conteo va
junto a los otros y **antes de borrar un solo documento**: el orden inverso fue un bug real que
`delete-guards.ts` documenta en su encabezado.

### 3. Clonar arrastra los montos; la fecha es la de HOY

Josuarth: «abrís un asiento viejo, le das copiar, y te queda uno igual donde solo cambiás los
montos». Si el clon llegara en cero habría que teclearlo entero y el botón no ahorraría nada.
`borradoresDesdeAsiento()` es puro y **ni siquiera recibe la fecha**: la pone la pantalla, y es la
de hoy. La del original puede caer en un mes cerrado, y entonces el rechazo del RPC parecería un
bug del botón; además es el criterio del acta del 09/09 para todo lo que se registra de nuevo. La
banda del clon lo dice en vez de dejarlo como sorpresa.

Solo se clonan asientos `manual`: clonar el de una factura fabricaría a mano un asiento que el
documento va a volver a generar.

### 4. 🔴 La reversión es genérica en la firma y `manual` adentro

`reverse_journal_entry(tenant, entry_id, motivo, fecha, descripción, líneas, autor)`.

Los otros tres reversores son específicos **porque cada uno toca su documento**: `reverse_payment`
borra las `payment_applications` y marca el cobro `anulado`; `reverse_supplier_payment` marca el
pago; `reverse_expense_tramite` marca el gasto. Un asiento manual no tiene documento, así que este
es el más chico de los cuatro — y por eso mismo **tiene que filtrar**: reversar desde ahí el
asiento de una factura se saltaría `cancelInvoice`, el gate de mes cerrado y toda la nota de
crédito del Bloque 5; el de un cobro dejaría la factura pagada con la plata devuelta (T7a cuelga
de `payment_applications`, no del asiento).

Tres capas: el RPC (que es el permiso, `EXECUTE` solo `service_role`), la ruta (admin y contador,
**los mismos que cargan**, no los que reversan cobros) y la pantalla. Y no hay cuarta puerta:
`POST /api/finanzas/asientos` fuerza `source_type: 'manual'` y nunca acepta `reverses_entry_id`.

`source_id` del espejo va **NULL**: el vínculo es `reverses_entry_id`, y con el id del original
ahí el Mayor lo abriría como si fuera un documento.

### 5. 🔒 Una sola reversión por asiento, en la BASE

`journal_entries_una_reversion_por_asiento (tenant_id, reverses_entry_id) WHERE ... IS NOT NULL`.
Hasta la `055` esa regla vivía **solo dentro de cada RPC**, repetida tres veces. Ahora cierra los
cuatro caminos, incluido el de alguien que postee un espejo directo con el motor.

📋 **Antes de aplicarla en producción** hay que contar asientos reversados dos veces (la consulta
está al pie de la `055`); tiene que dar cero. En staging dio 9 reversiones sobre 9 asientos.

### 6. El tope de 100 líneas es del FORMULARIO (D9)

`MAX_LINEAS_MANUALES` acota la pantalla, no el libro: el RPC solo exige dos líneas y el
importador de Excel —que carga asientos de 200— no pasa por ahí. Está dicho en los dos lados para
que nadie los "unifique"; hay un test que lee el comentario.

**Verificación:** `sql/tests/verificacion-054-*.sql` y `-055-*.sql` (ROLLBACK, con falla forzada
después de postear); tests `tercero-por-linea`, `tercero-en-el-formulario`,
`tercero-en-los-reportes`, `detalle-de-asiento`, `clonar-asiento`, `reversar-asiento-manual`.

---

## SOP-036: La cuenta contable por defecto de un proveedor (4.4) — y por qué NO se unifica

**Desde:** Bloque 8, 23/09/2026. Migración `057` (SOLO staging).

### La regla

`suppliers.default_chart_account_code` se precarga en cada línea de una **COMPRA** nueva de ese
proveedor (`business_expenses`). Se puede cambiar línea por línea y se puede cambiar en la
ficha. **En gastos de trámite (`expenses`) no se usa: ahí el default sigue siendo `130003`.**

### 🔴 Por qué no se unifica — tres razones, y la segunda es la fuerte

1. **`130003 Fondo Legales de Clientes` es un ACTIVO.** La regla que pidió Josuarth para esta
   columna —"tiene que ser de gasto o costo"— vuelve estructuralmente imposible que la cuenta
   de un proveedor sea `130003`. Un default de proveedor no podría reproducir el default
   correcto de trámite: sólo reemplazarlo por uno equivocado.

2. **Rompería el par `130003` / `REIM-*`.** Un gasto de trámite es plata que el bufete
   **adelanta por un cliente**: DEBE `130003` al incurrirlo, y la factura de reembolso
   (`REIM-*`) ACREDITA `130003` al recuperarla. `asiento-factura.ts` lo dice textual: *"si
   divergen, el saldo de 130003 deja de cerrar"*. Si la cuenta del proveedor pisara ese
   default, un adelanto recuperable se convertiría en silencio en un gasto propio del bufete,
   el activo nunca se debitaría, y la factura de reembolso acreditaría contra un saldo que no
   existe.

3. **El mismo proveedor cae de los dos lados.** Una mensajería puede ser un trámite adelantado
   por un cliente Y un gasto de oficina del bufete. Un solo default no puede servir para los dos.

Si algún día se quiere en trámite, la forma correcta es una **segunda columna**
(`default_chart_account_code_tramite`), nunca reusar ésta.

### 🔒 Dos predicados que DISCREPAN, a propósito

| | Permite `asset` | Para qué |
|---|---|---|
| `esTipoValidoParaGasto` | **sí** | Qué puede clasificar una LÍNEA ya cargada. Deja pasar `asset` para que `130003` clasifique un trámite |
| `esTipoValidoComoDefaultDeProveedor` | **no** | Qué puede ser el DEFAULT de un proveedor. Sólo gasto o costo |

Los dos viven en `contabilidad/cuentas-de-gasto.ts`, uno al lado del otro, y
`cuentas-de-gasto.test.ts` tiene un test cuyo nombre es *"los dos predicados DISCREPAN sobre
`asset`, y esa es la regla"*. **Unificarlos rompe una de las dos cosas**: si gana el laxo, un
proveedor puede quedar con `130003` y toda compra suya nace como un adelanto por un cliente; si
gana el estricto, el trámite deja de poder clasificarse contra `130003`.

### FK lógico, sin constraint

Mismo patrón que `business_expenses.chart_account_code`. El riesgo clásico —que renombren la
clave y el puntero quede huérfano— **no existe acá**: `updateChartAccount` rechaza cambiar el
`code` de cualquier cuenta. Lo que sí pasa es que la cuenta se desactive o la reclasifiquen, y
un FK real no mira ni `active` ni `account_type`; a cambio agregaría el modo de falla de no
poder borrar una cuenta.

### Degradar, no bloquear

Si la cuenta guardada deja de ser válida: la ficha del proveedor abre igual, el selector
arranca vacío y un aviso ámbar explica por qué; el alta de compra arranca sin cuenta y dice que
se corrige en la ficha. **La cuenta inválida no se vuelve a ofrecer en el selector.**

### El default precarga, nunca reescribe

Al elegir proveedor se completan sólo las líneas **sin** cuenta. Una línea ya elegida no se
toca. Las compras guardadas no se tocan nunca — y además no se podría: las líneas de un gasto
posteado son inmutables por los triggers de la `038`.

**Verificación:** `sql/tests/verificacion-057-proveedor-campos.sql` (ROLLBACK con falla
forzada, 11/11) y los cuatro tests de `cuentas-de-gasto.test.ts`.

---

## SOP-037: Alta de tasas de impuesto (2.4)

**Desde:** Bloque 8, 23/09/2026. Sin migración: `tax_codes` ya lo soportaba.

- **`POST /api/finanzas/configuracion/tax-codes`, roles admin y contador** — los mismos del
  `PATCH`, no los del `GET`. La abogada lee el catálogo pero no lo modifica: mismo criterio que
  la clasificación contable de una cuenta. Los tres lugares (la página, las dos rutas) se
  mueven juntos.
- **La pantalla pide el PORCENTAJE y guarda la FRACCIÓN**, mostrando las dos cosas mientras se
  escribe (`Se guarda como 0.1000 = 10%`). La columna es `NUMERIC(6,4)` con CHECK `0..1`:
  sin eso, "7" donde va `0.07` daría 700% y el error recién se vería en el total.
- 🔴 **Una tasa NO se borra: se desactiva.** Cinco FK apuntan a `tax_codes`
  (`invoice_lines`, `quote_lines`, `credit_note_lines`, `expense_lines` y el compuesto de
  `services_catalog`). Las líneas viejas conservan su snapshot de `tax_rate`.
- ⚠️ **`services_catalog_default_tax_code_fk` es compuesto sobre `(tenant_id, code)` con
  `ON UPDATE CASCADE`**: editar un código lo renombra también en `services_catalog`. Es el
  comportamiento actual y está bien; sólo no estaba escrito en ningún lado.
- **Una tasa nueva aparece sola** en los selectores de factura, compra y gasto de trámite:
  `listTaxCodesActive` lee todas las activas sin lista literal. Y **su ITBMS va a `200003`**
  porque `CUENTA_ITBMS` es una constante del asiento, no un campo por tasa. No hay nada que
  configurar por tasa.
- `TAX_CODE_RE` = `^[A-Z0-9_]{2,20}$`. No es cosmético: el código es la clave del FK compuesto
  y el orden de los selectores.


---

## SOP-038: Qué se puede hacer ante la DGI con una factura ya emitida

**Desde:** Bloque 9A, 23/09/2026. Sin migración: la decisión se calcula, no se guarda.
**Dónde:** `src/lib/finanzas/efactura/orchestration/decidir-accion-fiscal.ts`
(`decidirAccionFiscal()`), tests en `__tests__/decidir-accion-fiscal.test.ts`.

La matriz vivía en prosa, en `claude.md`, bajo "Estado futuro (Camino 2)". Una tabla en un
`.md` no se prueba, no falla cuando una pantalla la contradice y se copia mal. Ahora es una
función pura: sin I/O, sin base, **sin reloj propio** — `ahora` entra por parámetro.

### Decide lo FISCAL, no lo interno

Si la factura se puede anular **en el CRM** —que no tenga cobros aplicados, que el mes de
`issue_date` esté abierto, que no tenga ya una nota de crédito en el libro (053)— lo sigue
decidiendo `cancelInvoice`. Son dos preguntas distintas y se responden por separado: una
factura puede estar perfectamente anulable de nuestro lado y llevar 200 horas autorizada
ante la DGI, que es exactamente el caso que obliga a la nota de crédito.

### Las seis respuestas

| Estado en la base | Acción | Qué se manda |
|---|---|---|
| `fe_estado='canceled'` | `ya_anulada_en_dgi` | nada |
| `fe_estado='pending'` | `esperar_confirmacion` | nada, todavía |
| CUFE presente, ≤ 182 h | `anular_en_dgi` | `POST /api/v1/InvoiceEvents/CreateCancellation` |
| CUFE presente, > 182 h | `nc_04` | NC tipo `04` referenciando ese CUFE |
| Sin CUFE | `nc_04_requiere_cufe` | **se pide el CUFE**, no se decide |
| `authorized` sin CUFE | `inconsistente` | nada: hay que mirarlo |

Todas traen `mensaje` en claro, para que la pantalla **no vuelva a derivar la matriz** en el
JSX. Es la lección de `validarConsistenciaDeKind`: si el cliente reimplementa, algún día el
botón y el texto discrepan.

### 1. La ventana se cuenta desde la EMISIÓN, no desde la autorización

ideati confirmó el plazo el 22/09/2026 —**182 horas**— pero **no dijo desde cuándo se
cuenta**. Los dos candidatos son `issue_date` y `dgi_fecha_autorizacion`, y se toma **el que
cierra la ventana antes**. Si la ventana real resultara más larga, lo peor que pasa es que
ofrecemos una nota de crédito donde todavía se podía anular: inofensivo. Al revés
ofreceríamos un botón que la DGI va a rechazar, delante del cliente. El rechazo del PAC
queda como respaldo.

`issue_date` es una fecha **sin hora**, así que se toma **las 00:00 de Panamá** (UTC−5, sin
horario de verano) — el instante que hace vencer la ventana lo antes posible, mismo criterio.

Cuando ideati precise el dato se cambia `INSTANTE_DE_INICIO` y **ningún llamador**.

### 2. 🔴 "Sin CUFE" NO significa "nunca llegó a la DGI"

Las facturas del bufete **anteriores al 8 de julio de 2026** se emitieron **a mano en el
portal de ideati, por el punto de facturación `050`**: tienen CUFE ante la DGI, pero el CRM
nunca lo guardó. En la base se ven **idénticas** a una que jamás se envió — `fe_estado`
`'no_emitida'`, `dgi_cufe` nulo, `punto_facturacion` nulo — porque el portal es un camino que
el CRM no registra.

Por eso la respuesta es `nc_04_requiere_cufe`: una acción que **pide el CUFE** en lugar de
inventarlo. **No se usa una heurística por fecha.** Hay un test que pasa una factura de marzo
y una de septiembre y exige la MISMA respuesta. Una fecha de corte decidiendo una acción
fiscal es el tipo de supuesto que en seis meses nadie recuerda que era un supuesto, y el
error no se ve en pantalla: sale una nota de crédito genérica donde iba una `04` con
referencia, y eso aparece en una auditoría.

### 3. `'pending'` no es "todavía no se mandó"

Es "**se mandó y no sabemos cómo terminó**". Gana sobre todo lo demás, incluso si ya hay un
CUFE guardado. Decidir ahí es apostar: se anularía un documento que puede no existir, o se
dejaría vivo uno que sí.

### El plazo de 90 días advierte, no bloquea

ideati fue explícito: entre factura y NC **no hay validación técnica de plazo**. Los 90 días
son de la **declaración jurada de ITBMS**, no del PAC. Por eso viajan como `advertencia`
junto a la acción `nc_04` y quien decide es el contador.

### Lo que sigue sin confirmar

El **tipo de la nota de crédito genérica** (¿`06`?) para el caso de una factura que realmente
nunca pasó por la DGI. El swagger acepta `"01|02|03|04|05|06|07|08|09|10"` pero **no le pone
nombre a ninguno**. No se escribe una línea hasta que ideati lo confirme.

---

## SOP-039: Un JSON dorado y su refactor nunca van en el mismo commit

**Desde:** Bloque 9A, 23/09/2026.
**Lo hace cumplir:** `src/lib/finanzas/integridad/__tests__/golden-y-refactor-no-van-juntos.test.ts`

Un golden (`*-esperado.json`) sirve para **una sola cosa**: demostrar que un cambio en el
código no alteró lo que sale. Sirve mientras siga siendo un punto fijo. Si el mismo commit
que toca el mapper regenera el JSON esperado, **el test pasa porque se comparó contra sí
mismo** y no probó nada — y queda el registro de un congelamiento que nunca ocurrió, así que
el próximo que lea la historia va a creer que ese camino está cubierto.

**El modo de fallar no es malicioso, es cómodo.** Se corre la suite, falla el golden, y hay
un comando a mano (`ACTUALIZAR_PAYLOAD=1 npm test`) que lo "arregla" en dos segundos. Nadie
decidió saltarse la verificación: siguió el camino que el error sugería. Por eso la regla
necesita un test y no un párrafo.

**Cómo lo detecta:** recorre la historia de git y, para cada golden, busca los commits que lo
**MODIFICARON**; si en ese commit viene además un archivo de `src/` que no sea un test, falla
nombrando commit y archivos.

🔴 **Sólo las modificaciones, no el alta.** Un golden que NACE en un commit no puede tapar
nada: antes no existía, no había con qué comparar. Es la regeneración la que borra la
evidencia. (Por eso `3720e4f`, que creó `receptor-payload-esperado.json` junto a
`tercero-fiscal.ts`, no cuenta como violación.)

Pueden acompañar a un golden modificado: otros tests, otros goldens, `.md`, scripts y SQL de
verificación. No puede: código de producción.

**Si el test falla, no se arregla el test: se parte el commit en dos.** Primero el cambio de
código con el golden viejo —que debe fallar y mostrar el diff real—, después la actualización
del golden, explicada en su mensaje. Un commit que sólo toca un `-esperado.json` ya es una
alarma; uno que lo toca junto al código que verifica es la alarma que este test levanta.

Los goldens **se descubren solos** (barrido por `*-esperado.json`): uno nuevo queda cubierto
sin tocar nada. Hay un test que verifica que el barrido no devuelva vacío.


---

## SOP-040: Anular una factura ante la DGI — PAC primero, libro después

**Desde:** Bloque 9B, 23/09/2026. Migraciones `058` y `059`, SOLO en staging.
**Dónde:** `efactura/orchestration/anular-factura-ante-dgi.ts`, con
`clasificar-respuesta-de-anulacion.ts` y `transport/anulacion-en-pac.ts`.
**Quién:** admin y abogada. El contador NO anula.

### El orden no es una preferencia

Las dos mitades pueden fallar, así que la pregunta no es cómo evitarlo sino **cuál de los dos
estados a medias preferimos**:

| Orden | Qué queda si falla la segunda mitad | ¿Se arregla? |
|---|---|---|
| Libro primero | Factura anulada en NUESTROS libros y **viva ante la DGI** | 🔴 **No.** Habría que deshacer un asiento de reversión, y son inmutables por diseño (`023`) |
| **PAC primero** | Documento **muerto ante la DGI** y vivo en el libro | ✅ Sí: se ve, se explica y se termina con un botón |

Por eso va el PAC primero. Y por eso `fe_estado = 'canceled'` **se escribe ANTES de tocar el
libro**: sin ese UPDATE, morirse en la línea siguiente dejaría una factura anulada ante la DGI
**sin una sola marca en nuestra base**, indistinguible de una que nunca se tocó.

### Los tres caminos de falla

1. **La DGI rechaza.** No se escribe nada fuera del registro del intento. La factura queda
   igual. El rechazo por plazo trae su próximo paso: la nota de crédito.
2. **No sabemos si llegó** (red cortada, o respuesta que no se reconoce). Tampoco se escribe
   nada. El intento queda en `sin_respuesta` / `indeterminada` y **el caso escala a una
   persona**. No hay reintento automático (ver abajo).
3. **La DGI anuló y el libro falló.** Estado intermedio (D4). La ruta devuelve **409**, no 500:
   un 500 haría creer que no pasó nada cuando el documento ya está muerto ante la DGI.

### 🔴 Lo que el sandbox contestó, y lo que se cae con eso

Pruebas del 23/09/2026 (informe completo en `docs/efactura/prueba-anulacion-sandbox.txt`):

- ✅ **Repetir la anulación es estable.** Dos llamadas seguidas sobre el mismo CUFE devuelven
  `[{codigo:"0622", mensaje:"Ya existe un evento de anulación para esta FE"}]`. Para un
  reintento eso es un **éxito**. `0622` clasifica como `ya_anulada`; tratarlo como rechazo
  dejaría la factura trabada en el estado intermedio para siempre.
- ✅ 🔴 **`GET /Invoices/Authorization/{cufe}` NO refleja la anulación.** Devuelve el mismo
  payload antes y después —`autorizada: true`, `deletedDate: null`— con el evento ya existente.
  **La "consulta de estado antes de reintentar" que pedía D3 no se puede hacer con la API que
  existe.** `MARCADOR_DE_ANULACION_CONFIRMADO` se queda en `false` para siempre, y ahora por un
  motivo medido.

### 🔴 El reintento, rediseñado el 23/09/2026

Con esa evidencia, D3 se rehízo. **El reintento no consulta: vuelve a pedir la anulación.**

- «Completar anulación» **llama a `CreateCancellation` antes de tocar el libro.**
- `0622` (o una anulación exitosa) ⇒ **confirmado**: sigue a la mitad contable, igual que una
  respuesta exitosa normal.
- Cualquier otra cosa —rechazo, respuesta que no se reconoce, red cortada— ⇒ la factura **se
  queda en `fe_estado='canceled'` pendiente**, con su banda roja y su botón. El libro no se
  toca.

**Por qué se confirma en vez de avanzar directo:** `fe_estado = 'canceled'` lo escribimos
NOSOTROS antes de la mitad contable. Si el proceso murió justo ahí, esa marca es una
**intención, no un hecho**. Avanzar al libro sin volver a preguntar sería revertir un asiento
—inmutable— confiando en una marca propia. El `0622` es lo que la convierte en hecho, y es la
única confirmación disponible.

Pedirlo de nuevo es seguro: está medido que el endpoint es estable y no duplica nada del lado
de la DGI. Cada llamada queda registrada en `fe_anulaciones` con su propio `intento`.

⚠️ Una factura marcada `'canceled'` **sin CUFE guardado** completa el libro sin llamar al PAC:
no hay a quién preguntarle.
- ✅ 🔴 **El ÉXITO es `0600 — Evento registrado con éxito`**, y medirlo encontró un bug real:
  el clasificador lo llamaba **`rechazada`**. `0600` no estaba en la lista de códigos de éxito
  —que venía del endpoint de EMISIÓN— y el mensaje no dice "anulado" ni "cancelado".
  **La DGI anuló el documento y el CRM informó un rechazo.**

  Dos decisiones de diseño salvaron el caso, y conviene que queden escritas porque son el
  motivo de que esto no terminara en un descuadre:
  1. **El modo de fallar es NO ESCRIBIR.** Como lo leyó como rechazo, no tocó la factura ni el
     libro. Con un default optimista habría revertido un asiento inmutable contra una
     respuesta que no entendía.
  2. **El reintento lo arregló solo**, porque el segundo pedido devuelve `0622`.

  La lección: **los códigos de este endpoint no son los del de emisión**. Suponer que
  compartían numeración es lo que produjo el bug.

- La clase `indeterminada` se queda y sigue sin ser un error: es "no tocar el libro y escalar".
  Un HTTP 200 con array vacío cae ahí a propósito — ahora que sabemos que el éxito trae código,
  un array vacío es todavía más sospechoso.

### Cómo se consigue un documento autorizado en el sandbox

La DGI de pruebas rechaza con `1601` / `1602` **cualquier RUC de receptor que no exista en su
registro**, y los de staging son ficticios. Medido el 23/09/2026: rebota igual como
`tipoDocumento 01` que como `09`, así que **no es cuestión del tipo de documento**.

El procedimiento es apuntar el cliente al **RUC/DV del emisor** (emisor = receptor está
aceptado en sandbox) **en las tres columnas** —`tax_id`, `ruc` y `digito_verificador`, porque
`map-receptor.ts` lee `tax_id ?? ruc`— y restaurarlo al terminar.

Lo automatiza `scripts/efactura/prueba5-emitir-con-receptor-valido.ts`, **con la restauración
en un `finally`**: dejar un cliente de staging apuntando al RUC del bufete es el tipo de resto
que después aparece en un reporte y nadie sabe de dónde salió.

### El motivo son 15 caracteres, y son de la DGI

`cancellationReason` exige un mínimo de 15 (ideati, 22/09/2026). Tres capas: el validador
(`validators/cancel-invoice.ts`, el MISMO módulo que importa el diálogo), el botón que no se
habilita con el contador diciendo cuánto falta, y el CHECK de la `058` —que es la que no se
puede saltear, porque el RPC `cancel_invoice_with_reversal` escribe la columna directo.

⚠️ El mínimo de la **nota de crédito** sigue en 3: los 15 son del endpoint de anulación, y una
NC hoy es un documento interno. Cuando 9C la envíe al PAC habrá que revisarlo.

### `fe_anulaciones`

Espejo de `fe_emisiones`. Existe porque, con el proceso muerto a mitad de camino, es lo único
que distingue **"nunca preguntamos"** de **"preguntamos y no entendimos la respuesta"** — dos
situaciones que llevan a decisiones opuestas. Una columna booleana no las distingue.

El CUFE se guarda **en la fila**, no por join: es lo que realmente viajó, y tiene que seguir
siendo verdad aunque después se corrija la factura.

### En la pantalla

La banda **roja** del estado intermedio es la única roja del detalle, a propósito: no es un
aviso, es una factura que no está en ninguno de sus dos estados normales. Mientras esté así
**no se registran cobros ni notas de crédito** — pero **sí se reversan** los cobros que ya
estaban, porque eso es justamente lo que hay que hacer para poder completar la anulación.

«Completar anulación» es el MISMO diálogo con `variante="completar"`, no uno nuevo: dos
formularios para la misma llamada terminan discrepando. Precarga el motivo que ya viajó a la
DGI, porque el motivo que la DGI tiene y el que va a quedar en la nota de crédito tienen que
ser el mismo.

Y **la pantalla ya no decide**: `showCancel` sale de `decidirAccionFiscal` (SOP-038), la misma
función que usa el servidor.


---

### SOP-040 bis: anular una NOTA DE CRÉDITO ante la DGI (25/09/2026)

Mismo orden que la factura y por la misma razón: **PAC primero, libro después**. El botón es
«Reversar» del detalle de la NC; la ruta `POST /api/finanzas/credit-notes/[id]/reverse` llama
a `reversarNotaDeCredito`, que le pregunta a `decidirAccionSobreNotaDeCredito`:

| La matriz dice | Qué hace |
|---|---|
| `reversar_solo_en_el_libro` (NC interna, sin CUFE) | sólo el RPC `reverse_credit_note`; motivo de 3 |
| `anular_en_dgi_y_libro` (autorizada, dentro de 182 h) | intento en `fe_anulaciones` → `CreateCancellation` → `fe_estado = 'canceled'` → RPC; motivo de 15 |
| `reversar_solo_en_el_libro` con `fe_estado = 'canceled'` (quedó a medias) | **vuelve a pedirle la anulación al PAC** (`0622` = ya anulada) y recién después el RPC |
| cualquier otra | 409 con el mensaje de la matriz |

Códigos de la ruta: 200 · 409 (anulada en la DGI, falta el libro) · 422 (la DGI rechazó) ·
502 (no sabemos si llegó). Verificado con clics el 25/09 en `NC-000016`: anulada ante la DGI
(`fe_anulaciones.resultado = 'anulada'`, `i_amb = 2`) y reversada en el libro (asiento 67).

## SOP-041: Errores de la DGI — prevenirlos antes de enviar, y verlos después

**Desde:** 23/09/2026. Sin migración.
**Dónde:** `validators/controles-dgi.ts`, `efactura/mensajes-dgi.ts`,
`queries/fe-emisiones.ts`.

Dos rechazos reales, con la misma forma: **el error existía antes de enviar y nadie lo miró.**

### Antes de enviar

| Control | Rechazo que previene | Dónde |
|---|---|---|
| Descripción de línea 2–500 | `10105` (llegó con **545** caracteres) | validador de factura + contador en el campo |
| Descripción heredada por la NC | `10105` en facturas viejas | validador de nota de crédito |
| RUC del receptor con forma válida | `1601` | al **guardar el cliente** y al emitir |
| DV obligatorio para receptores 01/03 | `1601` | al guardar el cliente y al emitir |

🔒 **El contador y el validador cuentan IGUAL** (los dos trimean) y hay un test que lo fija. Si
contaran distinto, el campo diría 501 y el error 499, y la persona borraría caracteres sin
entender por qué no alcanza.

🔴 **Del RUC se valida la FORMA MÍNIMA, no un patrón cerrado.** Misma regla que en proveedores:
en Panamá conviven cédulas, prefijos `PE-`/`E-`/`N-`, jurídicos y folios viejos. Un validador
estricto rechaza RUC legítimos y deja a alguien **sin poder facturar**, que es un daño peor y
más silencioso que un rechazo de la DGI, porque no tiene mensaje.

⚠️ **ideati NO tiene endpoint para consultar un RUC.** Revisado el swagger completo el
23/09/2026: sus 17 rutas son catálogos, facturas y el evento de anulación. Así que el `1601`
(de formación) se previene y el `1602` (de existencia) no: eso sólo lo sabe la DGI.

### Después de un rechazo

La tarjeta fiscal muestra el motivo **traducido**: qué pasó, qué hacer y **dónde**, con el
cliente nombrado. *"Regla de formación del RUC invalida"* es correcto y no le sirve a nadie: no
dice de quién es el RUC ni en qué pantalla se arregla.

🔴 **El texto del PAC nunca se tira.** Va debajo, en monoespaciado, con su código: es lo único
que sirve para hablar con ideati. Traducir no es reemplazar.

🔴 **Un código que no está en el catálogo no se explica.** Misma regla que en los
clasificadores (SOP-040): se muestra el texto crudo y se dice que el sistema no lo tiene
traducido. El `1002` (duplicado) es el único que **no manda a reenviar**.

### 🔴 Por qué la alerta no se borra al editar

Es la mitad del caso real: el cliente se corrigió **después** del rechazo y la factura nunca se
reenvió — quedó rechazada ante la DGI con los datos ya arreglados en el CRM.

El aviso se lee de **`fe_emisiones`**, que es historia: nada de lo que se edite en la ficha del
cliente o en la factura lo cambia. Tres tests lo sostienen: que la fuente sea `fe_emisiones` y
no `clients`, que el gate sea `fe_estado`, y que **ninguna de las dos rutas de clientes
mencione `fe_estado`**.

Y el aviso **lo dice**: *"Este aviso queda hasta que la factura se envíe otra vez y la DGI la
acepte. Corregir los datos no lo borra."* No alcanza con que sea verdad — sin esa línea,
alguien corrige el RUC, ve que el aviso sigue, y cree que el sistema no guardó el cambio.

El botón dice **"Reenviar a la DGI"**, no "reintentar": reintentar suena a que falló el
sistema. Lo que falló fue el documento ante la DGI.

### El contador del listado

**"N facturas con error en la DGI"**, arriba de todo, con enlace a `?fe=error`. Se cuenta
**siempre**, con o sin filtros puestos: es una alarma, no una columna del resultado — si
dependiera de los filtros, desaparecería justo cuando alguien está mirando otra cosa.

### ⚠️ Una lección de forma que costó una tarde

El error del RUC se devolvía bajo la clave `tax_id`, y **el formulario de clientes no tiene
ningún campo con ese nombre**: el campo en pantalla se llama `ruc`. El error existía, bloqueaba
el wizard, y **no se renderizaba en ningún lado**. El botón "Siguiente" simplemente dejaba de
funcionar, sin mensaje y sin campo en rojo.

**Un error que bloquea y no se ve es peor que no validar.** Hay un test que exige que la clave
sea `ruc` y NO `tax_id`.

---

## SOP-042: Reversar una nota de crédito — se cambia un estado, no se resta un número

**Desde 2026-09-24 (Bloque 9C, migración `060`, SOLO staging).**

Era lo único que quedaba sin construir del Bloque 5: la nota de crédito se emitía y no había
forma de deshacerla.

### La regla

🔴 **La reversión no toca `credited_total`, ni `balance_due`, ni el `status` de la factura.**

`invoices.credited_total` es DERIVADA desde la `051`: el trigger `trg_recalc_invoice_credited`
hace `SUM(grand_total) WHERE status = 'emitida'` sobre las NC de esa factura, y en cascada
llama a `finanzas_recalc_one_invoice_amount_paid`, que rehace `balance_due` y el `status`
(T7a). Así que el RPC `reverse_credit_note` hace exactamente dos escrituras:

1. postear el asiento espejo, y
2. `UPDATE credit_notes SET status = 'anulada'`.

Y nada más. Los tres números se recalculan solos, **con la misma función que los calculó al
emitir la NC**.

### Por qué no se resta

Restar `grand_total` y listo funciona la primera vez y crea una **segunda fórmula**. El día
que discrepa de la primera, el síntoma no es un error: es el saldo equivocado de una factura.
Y con dos NC parciales sobre la misma factura el atajo ya está mal desde el principio —
restar el total deja el saldo mal sin que nada falle.

Corolario: `finanzas_guard_credited_total` **no necesita una válvula nueva**. El recalculador
ya abre `finanzas.recalc` por su cuenta.

🔒 **Dos guardianes, porque uno no alcanza:**
- `reversion-de-nc-no-resta-a-mano.test.ts` lee el código y falla si `reverseCreditNote`
  escribe los derivados, si reimplementa el espejo o si deja de cortar la NC sin asiento.
- El bloque de verificación de la propia `060` **aborta** si encuentra una escritura directa
  de `credited_total` dentro del reversor. Así la regla viaja con el `.sql` a cualquier base,
  no sólo al repo.

### Una NC sin asiento propio no se reversa

Hay dos clases de nota de crédito, y la diferencia es D5:

| Clase | Asiento propio | Se reversa |
|---|---|---|
| NC posterior o parcial | sí (`source_type = 'nota_credito'`) | ✅ |
| NC de una ANULACIÓN de factura | **no** — la anulación ya reversó el asiento de la factura | ❌ |

Reversar la segunda sería **des-anular una factura por la puerta de atrás**, sin pasar por
`cancelInvoice` ni por el gate de mes cerrado. Se corta en la app (409) y otra vez en el RPC,
por si alguien lo llama directo. Es el mismo criterio del filtro `source_type = 'manual'` de
la `055`.

### Lo que salió gratis

`acreditadoPorLineaDeFactura` ya filtraba `status = 'emitida'` desde la `051`, así que **las
cantidades acreditadas se liberan solas** al reversar: la línea vuelve a estar disponible para
otra NC sin tocar una sola consulta.

### Consecuencia conocida, no resuelta

Una factura cuya NC se reversó **sigue sin poder anularse**: la `053` rechaza por la existencia
de un asiento `nota_credito` en el libro, y los asientos no se borran. Contablemente ya no
haría daño —la reversión deshizo el débito parcial— pero la regla mira el asiento, no el
saldo. La salida sigue siendo emitir otra NC. Cambiarlo es una decisión aparte, no un arreglo.

### Anular la NC ante la DGI

Mismas **182 horas** que una factura, por el MISMO endpoint (`CreateCancellation` recibe un
CUFE sin preguntar de qué documento es). 🔴 **Contadas desde la emisión DE LA NC**, no de su
factura: son dos documentos y dos plazos, y una NC emitida hoy sobre una factura de hace un
mes tiene sus 182 horas completas. Y fuera de plazo **no hay "NC de la NC"** —
`decidirAccionSobreNotaDeCredito()` devuelve `sin_camino_fuera_de_plazo` y manda a hablar con
el contador, en vez de ofrecer un botón que la DGI va a rechazar.

---

## SOP-043: La nota de crédito ante la DGI — referenciar bien, o no mandar

**Desde 2026-09-24 (Bloque 9C, migraciones `061` y `062`, SOLO staging).**

### El bloque de referencia va DOBLEMENTE anidado

No se decidió leyendo el swagger —que no tiene un solo `required` ni un `enum`— sino mandando
**la misma NC con las dos formas** al sandbox:

| Forma | Resultado |
|---|---|
| anidada (`informacionReferencia.informacionReferencia.cufeReferenciado`) | ✅ `0260 Autorizado` |
| plana (`informacionReferencia.cufeReferenciado`) | ❌ `0100 … 'gDFRefNum' … incomplete content` |

El propio rechazo nombra los tres hermanos que el wrapper espera (`gDFRefFE`, `gDFRefFacPap`,
`gDFRefFacIE`). Lo arma `construirReferenciaFiscal()`, congelado contra
`referencia-fiscal-esperada.json`, con el contra-ejemplo plano guardado aparte **con su código
de rechazo** — un contra-ejemplo medido vale más que un comentario que diga "no lo aplanes".

Dos detalles que costaron un rechazo cada uno:
- 🔴 `fechaEmisionDocumentoReferenciado` **lleva huso**. Pelada rebota con `0100 … datatype
  'fechaTZ' … Pattern constraint failed`.
- ⚠️ **La DGI NO valida `nombreRazonSocialEmisor` contra el RUC**: la prueba autorizó con el
  nombre equivocado ahí. Un error en ese campo **no lo atrapa el PAC**. Va el del EMISOR —la
  factura referenciada la emitimos nosotros— y el único control es un test.

### Sin CUFE no se manda nada, y se corta antes del correlativo

Una NC que no se puede referenciar **no es un envío que falla: es un envío que no se hace**.
El gate está en T0, antes de tocar la secuencia.

| Caso | Qué pasó | Qué ofrece el sistema |
|---|---|---|
| **A** — factura emitida por el CRM | tiene CUFE | emitir la NC |
| **B** — factura del portal (antes del 8/7/2026, punto `050`) | **tiene CUFE ante la DGI**, el CRM no lo guardó | cargarlo a mano |
| **C** — nunca pasó por la DGI | no hay CUFE en ningún lado | **no hay camino**: «consulte con administración» |

🔴 **El caso B no se marca `authorized`.** `registrarCufeDelPortal` guarda el CUFE y
`dgi_cufe_origen = 'portal_050'`, y **no toca `fe_estado`**: este sistema no emitió esas
facturas, y decir que sí sería ensuciar el registro de envíos con un envío que nunca ocurrió.
Sin esa columna, un CUFE del PAC y uno tecleado son **idénticos** en la base, y la
combinación "con CUFE y `fe_estado = 'no_emitida'`" va a ser la normal en estas facturas.

🔴 **Todo camino que escribe `invoices.dgi_cufe` escribe también `dgi_cufe_origen`** (desde
el 25/09/2026, migración `064`). Son tres: el PAC al autorizar (`'crm'`), el caso B
(`'portal_050'`) y la tarjeta legacy (`'portal_050'`, salvo reguardar el mismo CUFE del PAC,
que conserva `'crm'`: `origenDelCufeManual`). El CHECK de la `061` **dejaba pasar un origen
NULL** —`NULL IN (…)` es NULL y un CHECK NULL se acepta— y dos facturas de staging quedaron
así. La `064` lo cierra con `IS NOT NULL` explícito, y `cufe-siempre-con-origen.test.ts`
lee el código y falla si un `.from('invoices').update({ dgi_cufe })` no trae el origen.
⚠️ Con el CHECK bueno, un camino que olvide el origen **falla DESPUÉS de que el PAC
autorizó**: factura viva ante la DGI y sin CUFE en la base. Por eso la `061`/`064` van en la
ventana del despliegue y no con la app vieja arriba.
**Lección general:** un CHECK del tipo `col IN (…)` sobre una columna nullable no prohíbe el
NULL. Si la regla es «tiene que haber valor», se escribe `IS NOT NULL`.

Del CUFE se valida la **forma mínima**, no un patrón cerrado — mismo criterio que el RUC. Las
facturas del caso B son de otro punto y otro año: un patrón calcado sobre los CUFE de hoy
rechazaría justo los que hacen falta cargar. Y los **saltos de línea del copiar-pegar se
limpian**, porque el portal muestra el CUFE partido en varias líneas y rechazarlo por eso
sería castigar a la persona por algo que el CRM puede arreglar solo.

### El caso C está bloqueado del lado de ideati

Referenciar por `informacionReferenciaFacturaPapel` hace que el PAC conteste `[0000] Object
reference not set to an instance of an object` — un `NullReferenceException` de .NET, no una
validación de negocio. **Pasa igual con `tipoDocumento` 04 que con 06**, así que lo que rompe
es el bloque de papel y no el tipo de documento; el `06` quedó **sin evaluar**, porque el
documento muere antes de llegar ahí.

La pregunta a ideati está redactada en `task_plan.md` y **en espera**: primero el bufete
confirma si existe alguna factura en papel que acreditar. Por la corrección del 23/09, las
anteriores al 8 de julio **tienen CUFE** y entran por el caso B, así que el caso C puede no
tener ningún documento real.

### ⚠️ La DGI lleva su propia cuenta de lo acreditado

Rechaza con `[1717] Monto de las notas de crédito o débito inconsistentes con el monto de la
FE original referenciada` cuando la suma de NC pasa el total de la factura referenciada.
**Su tope puede diferir del nuestro**: `credited_total` cuenta las NC de NUESTRA base, la DGI
cuenta las que ELLA autorizó. Se descubrió porque dos pruebas del mismo día acreditaron la
misma factura del sandbox.

### Lo que NO se reescribió

- `parsePacResponse` se **exporta**, no se copia. Es la lección del `0600`: un clasificador
  duplicado diverge y termina llamando rechazo a un éxito.
- El mapper es el mismo, con la NC ocupando el lugar de la factura en el bundle: el receptor
  sale del `map-receptor` congelado y el ITBMS proporcional de una NC parcial lo calcula el
  mismo `mapTotales`.
- `fe_emisiones` es la misma tabla, por **arco exclusivo** (`062`, igual que `supplier_payments`
  en la `049`). Una tabla aparte partiría en dos la alerta de rechazo de SOP-041 — o, más
  probable, alguien agregaría la NC a una sola y la alerta quedaría a medias sin que ningún
  test lo note.
- 🔴 `invoice_kind` **se hereda de la factura original**: de ahí sale el CPBS, y una NC sobre un
  reembolso tiene que llevar el del reembolso. Es un dato que la NC no tiene por su cuenta y
  que es fácil dejar en HONORARIOS sin que nada falle hasta que la DGI observa el anexo.


## SOP-044: NC de compra, resumen de ITBMS e importación de asientos (25/09/2026)

**NC de compra (066).** Se registra desde el detalle de la compra. Una transacción en la base
(`create_supplier_credit_note`). El asiento es el de la compra al revés y la base lo verifica.
El saldo de la compra es `balance_due` (derivado): nadie calcula `total − amount_paid` a mano.
Se anula con Reversar (fecha de hoy). Defaults de Josuarth en el encabezado de la `066`.

**Resumen de ITBMS.** La regla está en `reports/vat-calculo.ts`: facturas emitidas no anuladas
menos NC de venta autorizadas y vigentes (mes de la NC); compras menos NC de compra vigentes.
Las anuladas no cuentan.

**Importar asientos (067).** Vista previa obligatoria, todo o nada, deshacer completo con
reversiones fechadas hoy. Si un lote falla a mitad, no queda nada: no hay que limpiar.

**Emisión.** Las cuentas del asiento se validan antes de pedir el número de factura.
