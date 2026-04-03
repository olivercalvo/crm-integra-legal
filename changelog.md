# CHANGELOG.MD — CRM INTEGRA LEGAL

## [0.8.1] — 2026-04-03
### Renombrar rutas expedientes → casos
- **Rutas renombradas:** `/abogada/expedientes/*` → `/abogada/casos/*` en toda la app
- **Links actualizados:** sidebar, bottom-nav, dashboards (admin + abogada), gastos, clientes, case-form, import-wizard
- **Redirect automático:** middleware redirige `/abogada/expedientes/*` → `/abogada/casos/*` para URLs viejas

## [0.8.0] — 2026-04-03
### Correcciones y mejoras mayores (18 ajustes)

#### Errores corregidos
- **assistant_id migration:** Columna assistant_id ahora referencia users(id) en vez de cat_team(id)
- **Auditoría error:** Separado export columns en client component para evitar pasar funciones a Client Components
- **Asignar asistente:** Dropdown de asistente usa tabla users directamente
- **Gastos 404:** Creada ruta /abogada/gastos con dashboard de balance general por caso
- **Error de conexión:** Resuelto al agregar columna assistant_id (causa raíz)
- **Botón adjuntar:** Habilitado con componente DocumentUpload funcional + API /api/documents/upload

#### Mejoras de UI
- **Dashboard clickeable:** KPI cards enlazan a secciones correctas por rol
- **Listado clientes:** Paginación numérica, "Clasificación" renombrado a "Tipo de Cliente"
- **Listado casos:** Columnas "Abogada Responsable" y "Asistente Responsable" agregadas, paginación numérica
- **Vista cliente:** Campos "Dirección Física" y "Cliente Desde", DocumentUpload, badges de estado con colores
- **Vista caso:** "Ubicación Física" → "Ubicación del Expediente", botón atrás inteligente (vuelve al cliente si vino de ahí)
- **Seguimiento unificado:** Tareas y Comentarios combinados en tab "Seguimiento" cronológico con badges de tipo
- **Moneda:** Todos los montos en Balboas (B/.) en vez de USD
- **Mobile:** Gastos agregado a bottom nav de abogada

#### Arquitectura
- **Equipo Legal eliminado:** Usuarios con rol abogada/asistente se usan directamente para asignación de casos
- **responsible_id:** Migración para referenciar users en vez de cat_team
- **Datos demo:** Direcciones, fechas "Cliente Desde", gastos variados, tareas y comentarios realistas

#### Migraciones SQL requeridas
1. `ALTER TABLE cases ADD COLUMN IF NOT EXISTS assistant_id UUID REFERENCES users(id);`
2. `ALTER TABLE clients ADD COLUMN IF NOT EXISTS address TEXT;`
3. `ALTER TABLE clients ADD COLUMN IF NOT EXISTS client_since DATE;`
4. `ALTER TABLE cases DROP CONSTRAINT IF EXISTS cases_responsible_id_fkey;`
5. `ALTER TABLE cases ADD CONSTRAINT cases_responsible_id_fkey FOREIGN KEY (responsible_id) REFERENCES users(id);`
6. Seed demo data (supabase/migrations/20260403000006_seed_complete_demo.sql)

## [0.7.1] — 2026-04-03
### Mejoras de UX y datos

#### Listado de casos — más columnas sorteables
- Estado, Responsable y Clasificación ahora son columnas sorteables (además de Código, Descripción y Apertura)

#### Detalle de caso — edición independiente por tab
- **Tab Gastos:** nuevos botones "Registrar Gasto" y "Registrar Pago" con formularios inline (colores rojo/verde)
- **Tab Tareas:** nuevo botón "Nueva Tarea" con formulario inline (descripción, deadline, asignar a)
- **Tab Tareas:** botón para marcar tarea como "Cumplida" directamente desde la vista del caso

#### Fix: error handling mejorado
- AddCommentForm: error handling robusto — muestra error real del servidor en vez de genérico "Error de conexión"
- InlineCaseInfoEditor: mismo fix de error handling
- JSON parse errors manejados correctamente con `.catch(() => ({}))`

#### Datos ficticios ampliados
- Gastos y pagos añadidos para TODOS los 12 casos (antes solo 6 tenían datos)
- Tareas añadidas para todos los casos (incluyendo casos 4, 6, 9, 10, 11, 12)
- Comentarios/avances añadidos para todos los casos (incluyendo casos 4, 6, 8, 10, 11, 12)
- Documentos ficticios para todos los casos y más clientes
- Asistentes asignados a todos los casos via assistant_id
- Saldos variados: positivos, negativos y en cero distribuidos entre todos los casos

### Nuevos componentes
- `src/components/cases/add-expense-form.tsx` — formulario inline para gastos y pagos
- `src/components/cases/add-task-form.tsx` — formulario inline para tareas + botón completar

## [0.7.0] — 2026-04-03
### UX: Dashboard, listados y detalle de caso
- **Dashboard clickable cards:** las tarjetas KPI (Clientes, Casos, Tareas, Saldo en Contra) ahora navegan a la sección correspondiente en los 3 dashboards (abogada, admin, asistente)
- **Listado de clientes — columnas sorteables:** clic en el título de columna ordena asc/desc (N° Cliente, Nombre, RUC, Teléfono, Clasificación). Nueva columna "Casos" con badge verde indicando cantidad de casos activos por cliente
- **Listado de casos — columnas sorteables:** Código, Descripción, Apertura son sorteables. Se añadió columna Fecha Apertura
- **Componente reusable SortableHeader** creado en src/components/ui/sortable-header.tsx

### Detalle de caso — edición independiente por tab
- Eliminado botón "Editar" global del header del caso
- Nuevo componente InlineCaseInfoEditor: botón "Editar Información" dentro del tab Info, abre formulario inline con todos los campos editables sin salir de la vista
- Cada tab opera de forma independiente (info, gastos, tareas, comentarios, documentos)

### Asignación de responsables en caso
- Nuevos dropdowns en el editor inline de Info: "Abogado Responsable" y "Asistente Responsable de Seguimiento"
- Campo assistant_id añadido al tipo Case y al API PATCH
- Migración SQL: scripts/add-assistant-id.sql (ejecutar en Supabase)

### Documentos — botón Adjuntar
- Tab de Documentos rediseñado: botón grande "Adjuntar Documento" estilo QuickBooks (dorado, con ícono Upload)
- Lista de documentos existentes con ícono Paperclip y fecha
- Funcionalidad de upload pendiente hasta configurar Supabase Storage del cliente

### Fix: Error de conexión al guardar
- **Causa raíz:** el middleware aplicaba protección de rutas por rol a los endpoints /api/*, redirigiendo las llamadas fetch de usuarios con rol "abogada" lejos de /api/cases/*/comments
- **Fix:** se excluyen rutas /api/ del control de roles en middleware.ts; solo se verifica autenticación y se retorna 401 JSON si no hay sesión

### Datos ficticios completos para demo
- Script SQL: scripts/seed-demo-data.sql con datos ficticios realistas panameños
- 10 clientes completos (corporativos, personas naturales, ONG) con todos los campos
- 12 casos variados (7 clasificaciones, 3 estados diferentes, responsables asignados)
- Gastos y pagos: saldos positivos (CORP-001), negativos (MIG-001), en cero (LAB-001), y mixtos
- Tareas: pendientes y cumplidas con deadlines variados
- Comentarios/avances con fechas de seguimiento en múltiples casos
- Documentos ficticios registrados (nombres de archivo realistas)
- Catálogos completos: 7 clasificaciones, 3 estados, 5 instituciones, 4 miembros de equipo

### Técnico
- Nuevo componente: src/components/ui/sortable-header.tsx
- Nuevo componente: src/components/cases/inline-case-editor.tsx
- Middleware fix: /api/* excluido de role-based routing
- API PATCH cases: soporta assistant_id
- TypeScript: Case type actualizado con assistant_id
- Scripts: scripts/seed-demo-data.sql, scripts/add-assistant-id.sql

## [0.6.0] — 2026-04-03
### Rediseño UI — Estilo QuickBooks con paleta Integra
- Header rediseñado: fondo blanco, barra de búsqueda global al centro, menú de usuario a la derecha
- Sidebar colapsable estilo QuickBooks: fondo navy (#1B2A4A), íconos + texto expandido / solo íconos colapsado
- Toggle de colapso con estado persistido en localStorage
- Botones redondeados (rounded-full) al estilo QuickBooks
- Cards con sombra sutil (shadow-sm) y esquinas redondeadas (rounded-xl)
- Tipografía cambiada de serif (Playfair Display) a sans-serif (Inter) en toda la app
- Bottom nav mobile actualizado con nuevos labels

### Renombrar "Expedientes" → "Casos"
- Todas las referencias UI renombradas: títulos, menú, botones, labels, estados vacíos, placeholders
- 22+ archivos actualizados (pages, components, API routes, constantes de auditoría)
- Rutas URL conservadas (/abogada/expedientes/) para no romper bookmarks

### Nuevos campos en Casos
- 8 nuevos campos en tabla cases: entity, procedure_type, institution_procedure_number, institution_case_number, case_start_date, procedure_start_date, deadline, last_followup_at
- Campo follow_up_date en tabla comments
- Trigger DB: auto-actualización de last_followup_at al insertar comentario
- Wizard de caso expandido de 3 a 4 pasos con todos los nuevos campos
- Detalle del caso muestra campos calculados: días transcurridos, fechas tope con alerta roja si vencida
- APIs POST y PATCH actualizadas con nuevos campos + audit logging

### Sección de Comentarios / Avances
- Date picker para fecha de seguimiento en formulario de comentarios (default: hoy)
- Comentarios ordenados cronológicamente (más reciente arriba)
- Cada comentario muestra: fecha DD/MM/AAAA, hora, usuario, texto
- Comentarios inmutables (no editar/eliminar) para trazabilidad

### Formato de fechas DD/MM/AAAA
- Utilidad centralizada: src/lib/utils/format-date.ts (formatDate, formatDateTime, daysSince)
- Reemplazadas 11+ funciones locales de formateo de fecha
- Todas las fechas de display usan DD/MM/YYYY consistentemente

### Técnico
- Migración SQL: supabase/migrations/20260403000002_add_case_fields.sql
- Nueva utilidad: src/lib/utils/format-date.ts
- Nuevo helper server: src/lib/supabase/server-query.ts (getAuthenticatedContext)
- Todos los server components y API routes usan admin client para bypass de RLS
- Fix hydration: use-offline.ts inicializa isOnline con true en SSR
- Fix RLS: migración SQL para auth.tenant_id() y auth.user_role() (pendiente de aplicar en Dashboard)
- Build exitoso, 0 errores TypeScript

---

## [0.5.0] — 2026-04-02
### Importación Masiva (Fase 8)
- Importación masiva desde Excel/CSV: upload, parseo, validación, preview pre-importación, confirmación y ejecución
- Parseo inteligente: mapeo flexible de columnas (soporta nombres en español/inglés), detección automática de hojas
- Validación completa: campos obligatorios, duplicados por nombre/RUC, duplicados intra-archivo, formato de email
- Normalización automática: fechas (DD/MM/YYYY, YYYY-MM-DD, serial Excel), trim espacios, aliases (Dave→Daveiva, Mile→Milena)
- Detección de duplicados contra DB existente + dentro del archivo
- Pantalla de resumen pre-importación con estadísticas, errores, advertencias y opción de omitir duplicados
- Plantilla descargable generada client-side (SheetJS): hojas Clientes + Expedientes con columnas correctas y ejemplo
- Auto-creación de clientes faltantes al importar expedientes que referencian clientes inexistentes
- Audit log completo: cada registro importado se registra con source="bulk_import"
- Migración seed: 23 clientes + 46 expedientes con datos limpios, 3 team members, 7 instituciones adicionales

### Técnico
- Dependencia: xlsx (SheetJS) para parseo de Excel/CSV
- Nuevos archivos: src/lib/utils/import-parser.ts, src/app/api/import/route.ts, src/components/import/import-wizard.tsx, src/app/(dashboard)/abogada/importar/page.tsx
- Migración SQL: supabase/migrations/20260402000003_seed_clients_cases.sql
- Build exitoso, 0 errores TypeScript
- Sidebar ya tenía link "Importar" pre-configurado para admin y abogada

---

## [0.4.0] — 2026-04-02
### Admin Panel (Fase 7)
- CRUD Catálogos: componente CatalogManager reusable para clasificaciones, estados, instituciones, equipo
- Inline edit, toggle active/inactive, bloqueo de eliminación si hay registros vinculados
- Gestión de usuarios: crear via Supabase Auth admin API, asignar rol, activar/desactivar
- Página de configuración con 4 secciones de catálogos
- 5 API routes admin (/api/admin/catalogs, /api/admin/users)

### Offline-First (Fase 9)
- Cola persistente en IndexedDB (idb v8) — operaciones FIFO, persisten al cerrar browser
- SyncService: procesamiento por lotes (max 10), retry con backoff exponencial (1s→30s)
- Resolución de conflictos: last-write-wins por timestamp
- ConnectivityService: navigator.onLine + ping /api/health cada 30s
- Hook useOffline(): isOnline, isSyncing, pendingCount, queueOperation, syncNow
- Indicador visual en header: verde (en línea) / rojo (sin conexión) / ámbar (sincronizando)
- Garantía: CERO pérdida de datos — nunca elimina de cola hasta confirmación del servidor

### Audit Log & Exportación (Fase 10)
- Vista de auditoría con filtros: entidad, usuario, acción, rango de fechas
- Paginación (20/pág), badges de acción con colores, layout responsive
- Infraestructura de exportación: exportToCSV, exportToExcel, ExportButton reusable
- API route /api/admin/audit con joins a users para nombres

### Vistas Asistente (Fase completa)
- Mis Casos: listado de casos asignados con búsqueda, detalle completo
- Mis Tareas: todas las tareas del asistente, agrupadas pendientes/cumplidas, alerta overdue
- Mis Gastos: historial de gastos, resumen mensual, registrar gasto inline
- Detalle de caso: secciones stacked (mobile-first) — estado, info, gastos, tareas, comentarios
- Botón MarkTaskButton reutilizable con spinner

### Técnico
- 34 rutas de página + 17 API routes
- Build exitoso, 0 errores TypeScript
- Fix: ENTITY_OPTIONS movido a shared constants para evitar server/client boundary error

---

## [0.3.0] — 2026-04-02
### CRUD Completo (Fase 3-5)

#### Clientes (F-001)
- Listado con búsqueda (nombre, RUC, N° cliente) y paginación (10/pág)
- Cards responsive en mobile, tabla en desktop
- Formulario wizard 3 pasos: datos principales → contacto → observaciones
- Auto-generación de client_number (CLI-001, CLI-002, etc.)
- Detalle con info card + expedientes vinculados + documentos
- Desactivar cliente (soft delete) con confirmación 2 pasos + audit log
- API: POST/PATCH/DELETE en /api/clients

#### Expedientes (F-002)
- Listado con 4 filtros (estado, clasificación, responsable, institución) + búsqueda
- Status badges con colores: Activo=verde, En trámite=ámbar, Cerrado=gris
- Formulario wizard 3 pasos: cliente+descripción → institución+responsable → observaciones
- Auto-generación de case_code (CORP-001, MIG-002, etc.)
- Detalle con 5 tabs: Información, Gastos, Tareas, Comentarios, Documentos
- Cambio de estado inline con audit log automático
- API: POST/PATCH en /api/cases

#### Gastos (F-003)
- Registrar pagos del cliente y gastos ejecutados
- Balance en tiempo real: Total Pagado vs Total Gastos
- Saldo en contra (gastos > pagos) se muestra en ROJO
- Formularios inline embebidos en tab Gastos del expediente
- API: POST /api/expenses, POST /api/payments

#### Tareas (F-004)
- Crear tarea con descripción, deadline, asignación a asistente
- Lista separada: pendientes vs cumplidas
- Detección de tareas vencidas (deadline pasado) con alerta visual roja
- Marcar como cumplida con auto-set de completed_at
- API: POST /api/tasks, PATCH /api/tasks/[id]

#### Comentarios (F-005)
- Hilo cronológico inmutable (no edit, no delete)
- Avatar con iniciales del usuario, nombre, timestamp
- Formulario de agregar comentario al fondo
- API: POST /api/comments

### Migración SQL corregida
- Regenerada sin tocar schema auth (permission denied fix)
- users.id sin FK a auth.users — relación a nivel de app
- Helper functions en public schema: get_tenant_id(), get_user_role()
- Todo en un solo archivo: migration_completa.sql

### Técnico
- .env.local configurado con credenciales reales de Supabase
- Build exitoso: 22 rutas, 12 API routes, 0 errores TypeScript
- 30+ archivos nuevos (pages, components, API routes)

---

## [0.2.0] — 2026-04-02
### Git & GitHub
- Repositorio creado: github.com/olivercalvo/crm-integra-legal (público)
- Branches: develop (trabajo) + main (producción)
- Git configurado con usuario olivercalvo

### Correcciones y mejoras
- Migraciones SQL renombradas con timestamp correcto (20260402000001, 20260402000002)
- Custom JWT claims hook para inyectar tenant_id y user_role en tokens
- Triggers de updated_at en users, clients, cases
- Dashboard Abogada: 4 KPIs (clientes, expedientes, tareas, saldos en rojo), expedientes recientes
- Dashboard Asistente: 3 KPIs (casos, tareas pendientes, cumplidas), lista de tareas con deadline
- Dashboard Admin: 3 KPIs, acceso rápido a configuración/auditoría
- Limpieza de archivos conflicto de OneDrive
- Fix tipo TypeScript en dashboard asistente
- .claude/ añadido a .gitignore

---

## [0.1.0] — 2026-04-02
### Setup & Infraestructura (Fase 1 completa)
- Inicializado Next.js 14.2.35 con App Router, TypeScript, Tailwind CSS, ESLint
- Instalado shadcn/ui (button, input, label, card, separator, sheet, avatar, badge, dropdown-menu)
- Instalado @supabase/supabase-js, @supabase/ssr, idb, lucide-react
- Estructura de carpetas según SOP-001: (auth), (dashboard), components, lib, types, hooks
- Schema completo de DB: 14 tablas (tenants, users, clients, cases, expenses, client_payments, tasks, comments, documents, audit_log, cat_classifications, cat_statuses, cat_institutions, cat_team)
- RLS policies aplicadas en TODAS las tablas con tenant_id isolation
- Índices en: client_number, ruc, case_code, tenant_id, status, classification, etc.
- Custom JWT claims hook para tenant_id y user_role en tokens
- Triggers de updated_at automático en users, clients, cases
- Seed data: tenant "Integra Legal", 7 clasificaciones (CORP, MIG, LAB, PEN, CIV, ADM, REG), 3 estados, 5 instituciones

### Auth & Layout (Fase 2 completa)
- Pantalla de login con branding Integra (#1B2A4A, #C5A55A, #FFFFFF, Playfair Display + Inter)
- "Recordarme" guarda solo email en localStorage, siempre pide password
- Supabase Auth con email + password
- Middleware de sesión con timeout de 8 horas
- Protección de rutas por rol (admin, abogada, asistente)
- Layout principal: header con logo, sidebar desktop, bottom nav mobile
- Navegación filtrada por rol del usuario
- Dashboard con KPI cards placeholder (expedientes, clientes, tareas, saldos)
- API routes: auth callback y signout
- Tipos TypeScript estrictos para todas las entidades de DB

### Técnico
- Branch: develop (main protegido)
- Build exitoso sin errores ni warnings
- .env.local con placeholders — PENDIENTE: credenciales reales del cliente Supabase

---

## [0.0.0] — 2026-04-02
### Inicialización
- Generación de archivos BLAST (.md) del proyecto
- Análisis de archivo Excel fuente (23 clientes, 46 expedientes)
- Definición de requerimientos funcionales y no funcionales
- Definición de schema de base de datos
- Definición de arquitectura multi-tenant con RLS
- Definición de estrategia offline-first

### Decisiones de diseño
- Multi-tenant desde día 1 (RLS por tenant_id) para venta futura a otros bufetes
- Offline-first con IndexedDB + sync automática (cero pérdida de datos)
- Sesión de 8 horas (optimizado para asistentes en campo)
- Sin notificaciones para MVP (solo visual en dashboard)
- Exportación: infraestructura lista, reportes específicos TBD
- Branding Integra: #1B2A4A, #C5A55A, #FFFFFF, serif
