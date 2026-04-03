# TASK_PLAN.MD — CRM INTEGRA LEGAL

## FASE 1: Setup & Infraestructura
| # | Tarea | Feature | Estado | Notas |
|---|-------|---------|--------|-------|
| 1.1 | Crear repo con `gh repo create` | — | ✅ Completo | github.com/olivercalvo/crm-integra-legal — branch develop + main |
| 1.2 | Inicializar Next.js 14 + TypeScript + Tailwind + shadcn/ui | — | ✅ Completo | App Router, Next 14.2.35 |
| 1.3 | Configurar Supabase proyecto + env vars | — | ✅ Completo | .env.local con credenciales reales del cliente |
| 1.4 | Crear schema completo de DB (todas las tablas) | F-001 a F-012 | ✅ Completo | 14 tablas, migraciones SQL listas |
| 1.5 | Aplicar RLS policies (tenant_id) en todas las tablas | Multi-tenant | ✅ Completo | Policies en todas las tablas + helper functions |
| 1.6 | Configurar Supabase Auth + middleware | F-012 | ✅ Completo | Email+password, 8h timeout, role-based |
| 1.7 | Seed de catálogos iniciales | F-010 | ✅ Completo | 7 clasificaciones, 3 estados, 5 instituciones |
| 1.8 | Estructura de carpetas del proyecto | — | ✅ Completo | Según SOP-001 |
| 1.9 | Configurar layout principal con branding | — | ✅ Completo | Colores, logo, tipografía, mobile-first |

## FASE 2: Auth & Layout
| # | Tarea | Feature | Estado | Notas |
|---|-------|---------|--------|-------|
| 2.1 | Pantalla de login (email + password) | F-012 | ✅ Completo | Recordarme = solo email, branding Integra |
| 2.2 | Middleware de sesión (8h timeout) | F-012 | ✅ Completo | Verificación por last_sign_in_at |
| 2.3 | Layout dashboard Abogada (sidebar/nav + header) | F-006 | ✅ Completo | Mobile-first, sidebar desktop + bottom nav mobile |
| 2.4 | Layout dashboard Asistente | F-007 | ✅ Completo | Mismo layout, filtrado por rol |
| 2.5 | Layout Admin | — | ✅ Completo | Mismo layout, nav items completo |
| 2.6 | Protección de rutas por rol | F-012 | ✅ Completo | Middleware con ROLE_ROUTES |

## FASE 3: Gestión de Clientes
| # | Tarea | Feature | Estado | Notas |
|---|-------|---------|--------|-------|
| 3.1 | Listado de clientes con búsqueda y paginación | F-001 | ✅ Completo | Búsqueda por nombre/RUC/N°, paginación 10/pág, cards mobile + tabla desktop |
| 3.2 | Formulario crear/editar cliente (wizard) | F-001 | ✅ Completo | 3 pasos, auto-genera CLI-NNN, validación |
| 3.3 | Detalle de cliente con expedientes vinculados | F-001 | ✅ Completo | Info card + expedientes vinculados + status badges |
| 3.4 | Desactivar cliente (soft delete) | F-001 | ✅ Completo | Confirmación 2 pasos, audit log |
| 3.5 | Documentos adjuntos en cliente | F-008 | 🔶 Parcial | Sección visible, upload pendiente (necesita Storage config) |

## FASE 4: Gestión de Expedientes
| # | Tarea | Feature | Estado | Notas |
|---|-------|---------|--------|-------|
| 4.1 | Listado de expedientes con filtros y paginación | F-002 | ✅ Completo | 4 filtros + búsqueda, paginación, status badges con colores |
| 4.2 | Formulario crear/editar expediente (wizard) | F-002 | ✅ Completo | 3 pasos, auto-genera código (CORP-001), selects para catálogos |
| 4.3 | Detalle de expediente (tabs: info, gastos, tareas, comentarios, docs) | F-002 | ✅ Completo | 5 tabs completos con datos en tiempo real |
| 4.4 | Cambio de estado con historial | F-002 | ✅ Completo | Inline status changer + audit log |
| 4.5 | Documentos adjuntos en expediente | F-008 | 🔶 Parcial | Tab visible, upload pendiente (necesita Storage config) |

## FASE 5: Gastos, Tareas, Comentarios
| # | Tarea | Feature | Estado | Notas |
|---|-------|---------|--------|-------|
| 5.1 | Registrar pago del cliente | F-003 | ✅ Completo | Formulario inline en tab Gastos |
| 5.2 | Registrar gasto ejecutado | F-003 | ✅ Completo | Formulario inline en tab Gastos |
| 5.3 | Balance en tiempo real (pagado vs ejecutado) | F-003 | ✅ Completo | 3 cards resumen, ROJO si saldo en contra |
| 5.4 | Crear y asignar tarea a asistente | F-004 | ✅ Completo | Select de asistentes, deadline opcional |
| 5.5 | Vista de tareas del asistente | F-004 | ✅ Completo | Separadas pendientes/cumplidas, alerta overdue |
| 5.6 | Marcar tarea como cumplida | F-004 | ✅ Completo | Botón con confirmación, auto-sets completed_at |
| 5.7 | Comentarios / Bitácora (crear, listar) | F-005 | ✅ Completo | Hilo cronológico, inmutable, avatar con iniciales |

## FASE 6: Dashboards
| # | Tarea | Feature | Estado | Notas |
|---|-------|---------|--------|-------|
| 6.1 | Dashboard Abogada: KPIs + expedientes recientes + gastos en rojo | F-006 | ✅ Completo | 4 KPIs, expedientes recientes, saldo en rojo |
| 6.2 | Dashboard Asistente: casos asignados + tareas pendientes | F-007 | ✅ Completo | 3 KPIs, lista de tareas con deadline |

## FASE 7: Catálogos & Admin
| # | Tarea | Feature | Estado | Notas |
|---|-------|---------|--------|-------|
| 7.1 | CRUD Clasificaciones | F-010 | ✅ Completo | Inline edit, toggle active, bloqueo si referenciado |
| 7.2 | CRUD Estados | F-010 | ✅ Completo | Mismo componente reusable CatalogManager |
| 7.3 | CRUD Instituciones | F-010 | ✅ Completo | Mismo componente reusable |
| 7.4 | CRUD Equipo/Responsables | F-010 | ✅ Completo | Vinculación con users |
| 7.5 | Gestión de usuarios (admin) | F-012 | ✅ Completo | Crear via Supabase Auth admin, asignar rol, activar/desactivar |

## FASE 8: Importación & Migración
| # | Tarea | Feature | Estado | Notas |
|---|-------|---------|--------|-------|
| 8.1 | Importación masiva desde Excel/CSV | F-009 | ✅ Completo | Upload, parseo XLSX/CSV, validación, preview, confirmación, ejecución |
| 8.2 | Migración de datos actuales (23 clientes + 46 expedientes) | F-009 | ✅ Completo | SQL seed con limpieza: alias normalizados, fechas ISO, espacios trim, filas vacías eliminadas |
| 8.3 | Plantilla descargable de importación | F-009 | ✅ Completo | Generada client-side con SheetJS, hojas Clientes + Expedientes |

## FASE 9: Offline-First
| # | Tarea | Feature | Estado | Notas |
|---|-------|---------|--------|-------|
| 9.1 | Cola persistente en IndexedDB | F-013 | ✅ Completo | idb v8, FIFO, persiste al cerrar browser |
| 9.2 | Detector de conectividad | F-013 | ✅ Completo | navigator.onLine + ping /api/health cada 30s |
| 9.3 | Sync automática con retry y resolución de conflictos | F-013 | ✅ Completo | Last-write-wins, backoff exponencial, max 5 retries |
| 9.4 | Indicador visual online/offline/sincronizando | F-013 | ✅ Completo | 3 estados en header, badge pending count |

## FASE 10: Audit Log & Exportación
| # | Tarea | Feature | Estado | Notas |
|---|-------|---------|--------|-------|
| 10.1 | Triggers de audit log en todas las tablas | F-011 | 🔶 Parcial | Audit log via API routes (app-level), DB triggers pendiente |
| 10.2 | Vista de consulta de audit log (admin) | F-011 | ✅ Completo | Filtros por entidad/usuario/acción/fecha, paginación, export CSV |
| 10.3 | Infraestructura de exportación PDF/Excel | F-014 | ✅ Completo | exportToCSV, exportToExcel, ExportButton reusable |

## FASE 10.5: Rediseño UI + Campos + Renombrado
| # | Tarea | Feature | Estado | Notas |
|---|-------|---------|--------|-------|
| 10.5.1 | Rediseño UI estilo QuickBooks | — | ✅ Completo | Header blanco, sidebar colapsable navy, botones redondeados, sans-serif |
| 10.5.2 | Renombrar "Expedientes" → "Casos" | — | ✅ Completo | 22+ archivos, rutas conservadas |
| 10.5.3 | Nuevos campos en Casos (8 campos DB + 6 calculados) | F-002 | ✅ Completo | Wizard 4 pasos, detalle con fechas+días, deadline con alerta |
| 10.5.4 | Comentarios con fecha de seguimiento | F-005 | ✅ Completo | Date picker, orden desc, inmutables, auto-update last_followup |
| 10.5.5 | Formato DD/MM/AAAA en toda la app | — | ✅ Completo | Utilidad centralizada, 11+ archivos actualizados |
| 10.5.6 | Fix RLS + hydration + server-query helper | — | ✅ Completo | Admin client para bypass RLS, fix JWT claims |
| 10.5.7 | Migración SQL nuevos campos | — | 🔶 Pendiente | SQL listo, pendiente ejecutar en Dashboard Supabase |

## FASE 10.7: UX Improvements & Data
| # | Tarea | Feature | Estado | Notas |
|---|-------|---------|--------|-------|
| 10.7.1 | Dashboard clickable cards (3 dashboards) | F-006/F-007 | ✅ Completo | KPI cards navegan a sección correspondiente |
| 10.7.2 | Listado clientes — sorteo + indicador casos activos | F-001 | ✅ Completo | SortableHeader reusable, badge con count |
| 10.7.3 | Listado casos — sorteo por columnas | F-002 | ✅ Completo | Código, Descripción, Estado, Responsable, Clasificación, Apertura |
| 10.7.4 | Detalle caso — edición independiente por tab | F-002 | ✅ Completo | Info: InlineCaseInfoEditor. Gastos: AddExpenseForm. Tareas: AddTaskForm + CompleteTaskButton |
| 10.7.5 | Documentos — botón Adjuntar estilo QuickBooks | F-008 | ✅ Completo | Botón grande dorado, lista de docs existentes |
| 10.7.6 | Asignación Abogado + Asistente responsable | F-002 | ✅ Completo | 2 dropdowns en editor inline, assistant_id |
| 10.7.7 | Fix error de conexión en middleware | — | ✅ Completo | /api/* excluido de role routing |
| 10.7.8 | Datos ficticios completos para demo | — | ✅ Completo | 10 clientes, 12 casos, gastos/pagos en TODOS, tareas en TODOS, comentarios en TODOS, docs en TODOS |
| 10.7.9 | Migración assistant_id | — | 🔶 Pendiente | SQL listo en scripts/add-assistant-id.sql |

## FASE 11: Testing & Deploy
| # | Tarea | Feature | Estado | Notas |
|---|-------|---------|--------|-------|
| 11.1 | Testing completo con Playwright MCP | — | ⬜ Pendiente | Todos los flujos |
| 11.2 | Pre-deploy checklist (13 pasos) | — | ⬜ Pendiente | SOP-006 |
| 11.3 | Deploy a producción | — | ⬜ Pendiente | Requiere aprobación de Oliver |
| 11.4 | Verificación post-deploy | — | ⬜ Pendiente | |
