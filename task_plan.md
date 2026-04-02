# TASK_PLAN.MD — CRM INTEGRA LEGAL

## FASE 1: Setup & Infraestructura
| # | Tarea | Feature | Estado | Notas |
|---|-------|---------|--------|-------|
| 1.1 | Crear repo con `gh repo create` | — | ✅ Completo | github.com/olivercalvo/crm-integra-legal — branch develop + main |
| 1.2 | Inicializar Next.js 14 + TypeScript + Tailwind + shadcn/ui | — | ✅ Completo | App Router, Next 14.2.35 |
| 1.3 | Configurar Supabase proyecto + env vars | — | 🔶 Parcial | Placeholders en .env.local — FALTA: credenciales reales del cliente |
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
| 3.1 | Listado de clientes con búsqueda y paginación | F-001 | ⬜ Pendiente | Buscar por nombre, RUC, N° |
| 3.2 | Formulario crear/editar cliente (wizard) | F-001 | ⬜ Pendiente | Max 5 campos/pantalla |
| 3.3 | Detalle de cliente con expedientes vinculados | F-001 | ⬜ Pendiente | |
| 3.4 | Desactivar cliente (soft delete) | F-001 | ⬜ Pendiente | |
| 3.5 | Documentos adjuntos en cliente | F-008 | ⬜ Pendiente | Upload a Supabase Storage |

## FASE 4: Gestión de Expedientes
| # | Tarea | Feature | Estado | Notas |
|---|-------|---------|--------|-------|
| 4.1 | Listado de expedientes con filtros y paginación | F-002 | ⬜ Pendiente | Filtrar por estado, clasificación, responsable, cliente, institución |
| 4.2 | Formulario crear/editar expediente (wizard) | F-002 | ⬜ Pendiente | Código auto con prefijo |
| 4.3 | Detalle de expediente (tabs: info, gastos, tareas, comentarios, docs) | F-002 | ⬜ Pendiente | |
| 4.4 | Cambio de estado con historial | F-002 | ⬜ Pendiente | Log automático |
| 4.5 | Documentos adjuntos en expediente | F-008 | ⬜ Pendiente | |

## FASE 5: Gastos, Tareas, Comentarios
| # | Tarea | Feature | Estado | Notas |
|---|-------|---------|--------|-------|
| 5.1 | Registrar pago del cliente | F-003 | ⬜ Pendiente | |
| 5.2 | Registrar gasto ejecutado | F-003 | ⬜ Pendiente | |
| 5.3 | Balance en tiempo real (pagado vs ejecutado) | F-003 | ⬜ Pendiente | Rojo si saldo en contra |
| 5.4 | Crear y asignar tarea a asistente | F-004 | ⬜ Pendiente | |
| 5.5 | Vista de tareas del asistente | F-004 | ⬜ Pendiente | |
| 5.6 | Marcar tarea como cumplida | F-004 | ⬜ Pendiente | |
| 5.7 | Comentarios / Bitácora (crear, listar) | F-005 | ⬜ Pendiente | No editar, no eliminar |

## FASE 6: Dashboards
| # | Tarea | Feature | Estado | Notas |
|---|-------|---------|--------|-------|
| 6.1 | Dashboard Abogada: KPIs + expedientes recientes + gastos en rojo | F-006 | ✅ Completo | 4 KPIs, expedientes recientes, saldo en rojo |
| 6.2 | Dashboard Asistente: casos asignados + tareas pendientes | F-007 | ✅ Completo | 3 KPIs, lista de tareas con deadline |

## FASE 7: Catálogos & Admin
| # | Tarea | Feature | Estado | Notas |
|---|-------|---------|--------|-------|
| 7.1 | CRUD Clasificaciones | F-010 | ⬜ Pendiente | Con prefijo y descripción |
| 7.2 | CRUD Estados | F-010 | ⬜ Pendiente | |
| 7.3 | CRUD Instituciones | F-010 | ⬜ Pendiente | |
| 7.4 | CRUD Equipo/Responsables | F-010 | ⬜ Pendiente | |
| 7.5 | Gestión de usuarios (admin) | F-012 | ⬜ Pendiente | Crear usuario, asignar rol |

## FASE 8: Importación & Migración
| # | Tarea | Feature | Estado | Notas |
|---|-------|---------|--------|-------|
| 8.1 | Importación masiva desde Excel/CSV | F-009 | ⬜ Pendiente | Validación + preview |
| 8.2 | Migración de datos actuales (23 clientes + 46 expedientes) | F-009 | ⬜ Pendiente | Limpieza automática |
| 8.3 | Plantilla descargable de importación | F-009 | ⬜ Pendiente | |

## FASE 9: Offline-First
| # | Tarea | Feature | Estado | Notas |
|---|-------|---------|--------|-------|
| 9.1 | Cola persistente en IndexedDB | F-013 | ⬜ Pendiente | Cero pérdida de datos |
| 9.2 | Detector de conectividad | F-013 | ⬜ Pendiente | |
| 9.3 | Sync automática con retry y resolución de conflictos | F-013 | ⬜ Pendiente | Last-write-wins |
| 9.4 | Indicador visual online/offline/sincronizando | F-013 | ⬜ Pendiente | |

## FASE 10: Audit Log & Exportación
| # | Tarea | Feature | Estado | Notas |
|---|-------|---------|--------|-------|
| 10.1 | Triggers de audit log en todas las tablas | F-011 | ⬜ Pendiente | Automático vía DB triggers |
| 10.2 | Vista de consulta de audit log (admin) | F-011 | ⬜ Pendiente | Filtros por entidad, usuario, fecha |
| 10.3 | Infraestructura de exportación PDF/Excel | F-014 | ⬜ Pendiente | Reportes específicos TBD |

## FASE 11: Testing & Deploy
| # | Tarea | Feature | Estado | Notas |
|---|-------|---------|--------|-------|
| 11.1 | Testing completo con Playwright MCP | — | ⬜ Pendiente | Todos los flujos |
| 11.2 | Pre-deploy checklist (13 pasos) | — | ⬜ Pendiente | SOP-006 |
| 11.3 | Deploy a producción | — | ⬜ Pendiente | Requiere aprobación de Oliver |
| 11.4 | Verificación post-deploy | — | ⬜ Pendiente | |
