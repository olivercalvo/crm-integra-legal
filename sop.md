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
