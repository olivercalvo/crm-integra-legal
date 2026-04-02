# CHANGELOG.MD — CRM INTEGRA LEGAL

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
