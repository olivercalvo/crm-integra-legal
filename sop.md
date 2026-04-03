# SOP.MD — CRM INTEGRA LEGAL

## SOP-001: Configuración Inicial del Proyecto
1. Crear repositorio con `gh repo create crm-integra-legal --public --clone`
2. Inicializar Next.js 14 con App Router, TypeScript, Tailwind, ESLint
3. Instalar dependencias: `shadcn/ui`, `@supabase/supabase-js`, `@supabase/ssr`, `idb` (IndexedDB wrapper)
4. Configurar estructura de carpetas:
   ```
   src/
     app/
       (auth)/login/
       (dashboard)/
         abogada/
         asistente/
         admin/
       api/
     components/
       ui/          (shadcn)
       layout/
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
       utils/
     types/
     hooks/
   ```
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
