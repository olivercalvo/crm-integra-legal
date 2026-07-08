# TASK_PLAN.MD — CRM INTEGRA LEGAL

## Estado eFactura (cerrado 2026-07-07 — LISTO PARA MERGE)

- **Vercel Production: 18/19 variables `EFACTURA_*` cargadas.** Falta solo `EFACTURA_EMISOR_CPBS_REI` (confirmar con contador, candidato `8012`; **NO bloquea** primera emisión sin retención).
- `EFACTURA_EMISOR_PUNTO_FACTURACION=051` (Eduardo/Ideati confirmó; QuickBooks usa `050`). Punto nuevo **NO requiere alta en DGI**, basta enviarlo en la API. Folios se consumen del plan del RUC.
- **Merge `develop → main` VERIFICADO con dry-run**: FF posible, CERO conflictos, 34 commits (fase eFactura sandbox-validada + Cotizaciones + fixes numbering). **NO ejecutado aún.**
- `main` intacto en `bdd1229`. `develop` es base autoritativa (`5f0a991` + commits posteriores).

### Próxima sesión (secuencia go-live)
1. Ejecutar merge `develop → main` (recomendado `--no-ff` para punto de merge explícito del go-live) → push → auto-deploy Vercel.
2. Primera emisión REAL de prueba: factura chica, receptor conocido, **SIN retención de ITBMS**. Validar CUFE contra DGI prod (https://dgi-fep.mef.gob.pa/Consultas/FacturasPorCUFE).
3. Post-go-live backlog: soportar retención ITBMS en emisión; cargar `EFACTURA_EMISOR_CPBS_REI` cuando el contador confirme.

## Estado actual (cerrado 2026-07-01)

### Producción (`main` @ `bdd1229`)
3 fixes de la familia numeración/prospectos, verificados en prod:
- `983f3ec` — allocator atómico de `client_number` vía RPC `get_next_sequence_number` sobre `numbering_sequences`.
- `e7231b3` — fix bug Milena: "crear prospecto nuevo" al editar/duplicar cotización.
- `bdd1229` — número de cliente siempre automático en creación manual (`/clientes/nuevo` ya no envía `client_number` en create; el POST cae siempre en `allocateClientNumber`).
- `numbering_sequences.client.last_number = 97` (gaps aceptados de smokes; NUNCA rebobinar).
- Herramienta de diagnóstico en `scripts/diag-numbering.ts` (`NODE_OPTIONS="--use-system-ca" npx tsx scripts/diag-numbering.ts`).

### Git reunificado (`develop` @ `5f0a991`)
- Back-merge `main → develop` completado. **`develop` es ahora la base autoritativa**: todo `main` + toda la fase eFactura + los 3 fixes. Conflictos resueltos con la versión de develop (EfacturaCard supersede DgiDataCard legacy).
- **`main` intacto** en `bdd1229`. El merge eventual `develop → main` para eFactura será fast-forward limpio.
- Rama `hotfix/client-numbering` **BORRADA** (local + remota) — cumplió su función.

### eFactura go-live — estado del checklist
- [OK] Certificado configurado en Ideati (confirmado por Eduardo).
- [OK] Migraciones FE 019/020/021 ya aplicadas en Supabase prod (verificado 12/12 OK con query de introspección — clients +8 col, invoices +9 col, tablas `fe_emisiones`/`fe_secuencias`, RPC `allocate_fe_numero`, CHECK `numbering_sequences.sequence_type='client'`).
- [OK] API key de producción generada en `admin.efacturapty.com` → Integración (nombre "CRM Integra Legal"). Oliver la tiene guardada.
- [OK] Vercel Production: **16/19 variables** `EFACTURA_*` cargadas vía CLI (14 emisor + `EFACTURA_I_AMB=1` + `EFACTURA_API_BASE_URL=https://api.efacturapty.com`). UTF-8 verificado en tildes (`Panamá`, `Bella Vista`).
- [PENDIENTE] **3 variables faltan en Vercel Production**:
  - `EFACTURA_API_KEY` → Oliver la carga manual en el dashboard (sensible, no por CLI).
  - `EFACTURA_EMISOR_PUNTO_FACTURACION` → **espera respuesta de Eduardo** (QuickBooks usa `050`; el CRM necesita otro, ≠ 050, ≠ 000, ≠ 001). Correo ya enviado.
  - `EFACTURA_EMISOR_CPBS_REI` → **confirmar con contador** (candidato `8012`, igual que HON).
- [PENDIENTE] Merge `develop → main` (release eFactura) — SOLO cuando las 3 variables estén cargadas.
- [PENDIENTE] Primera emisión real de prueba (documento fiscal real, con cuidado — factura pequeña a receptor conocido).

## Backlog próxima sesión (orden de prioridad)

### A. eFactura go-live (prioridad de Oliver)
Desbloqueo = respuesta de Eduardo (punto de facturación + confirmación de folios) + `CPBS_REI` del contador. Luego, en ese orden:
1. Cargar las 3 variables pendientes en Vercel Production.
2. Merge `develop → main` (fast-forward, disparará auto-deploy).
3. Primera emisión real de prueba con factura pequeña a receptor conocido.

### B. Bug buscador de clientes en form de cotización (alta, rápido)
El toggle "cliente existente" en el form de cotización **no lista prospectos**, aunque la nota de UI dice "activo o prospecto". Causa: `listClientsActive` filtra solo `client_status='active'`. Detectado en el smoke del 2026-06-23 (no encontraba `ZZZ-SMOKE-BASE-CLIENT` que era prospect). Es parte de por qué Milena terminaba duplicando. Fix puntual rápido o se absorbe en **C (PROSPECTOS-UNIFY)**.

### C. PROSPECTOS-UNIFY (Camino X) — sprint grande, desbloqueado
Corta la raíz de la familia de bugs de esta sesión. **Ahora sobre historia git ya reunificada.** Decisión ya tomada: fuente única = tabla `prospects`. Alcance:
- Crear prospecto desde cotización escribe en `prospects` (etapa `propuesta_enviada`).
- `quotes.client_id` nullable + `prospect_id` + CHECK XOR.
- Cotizar para prospecto existente (3er modo en el toggle).
- Dedup: `UNIQUE(tenant_id, lower(email))` en `prospects`.
- Convertir cotización → factura auto-convierte prospecto → cliente vía `/convert`.
- Cableado en API, **no en triggers**.
- El bug del buscador (B) se absorbe acá si no se hizo antes.

### D. Backlog eFactura post-go-live
Soportar **retención de ITBMS** en emisión (algunos clientes son agentes de retención). Detectado en facturas reales del 2026-07-01. Sprint propio, después de que la emisión básica esté viva en prod.

### E. Pendientes menores
- **ROLANDO MCLEAN (CLI-086)**: prospecto válido creado en pruebas del 2026-06-23. Decidir si se deja o se conecta a COT-001303.
- **COT-001303**: quedó apuntando al cliente equivocado (MIGUEL VALDES) por el bug ya arreglado. Milena iba a rehacerla; confirmar si lo hizo o si hay que limpiarla.

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

## FASE 10.8: Seguimiento & Route Cleanup
| # | Tarea | Feature | Estado | Notas |
|---|-------|---------|--------|-------|
| 10.8.1 | Renombrar rutas /expedientes → /casos | — | ✅ Completo | Todos los links, redirects en middleware |
| 10.8.2 | Crear sección Seguimiento (antes Tareas) | F-004/F-005 | ✅ Completo | /abogada/seguimiento — vista global de tareas+comentarios por caso |
| 10.8.3 | Renombrar "Tareas" → "Seguimiento" en navegación | — | ✅ Completo | sidebar, bottom-nav, dashboards |

## FASE 10.9: UX Asistente (v0.9.3)
| # | Tarea | Feature | Estado | Notas |
|---|-------|---------|--------|-------|
| 10.9.1 | Dashboard asistente — solo KPIs | F-007 | ✅ Completo | Eliminada lista de tareas, solo 3 cards |
| 10.9.2 | Menú asistente simplificado | F-007 | ✅ Completo | Solo Dashboard + Mis Tareas, eliminado Mis Casos |
| 10.9.3 | Mis Tareas — agrupar por caso | F-004 | ✅ Completo | Header por caso, pendientes primero, botones acción |
| 10.9.4 | Documentos en detalle caso asistente | F-008 | ✅ Completo | DocumentUpload funcional (antes placeholder) |
| 10.9.5 | Datos ficticios completos (SQL) | — | ✅ Completo | Clientes + documentos ficticios. SQL pendiente ejecutar |

## FASE 12: Nuevas Funcionalidades (v1.0.0)
| # | Tarea | Feature | Estado | Notas |
|---|-------|---------|--------|-------|
| 12.1 | Login — Recuperar contraseña | F-012 | ✅ Completo | Supabase Auth resetPasswordForEmail |
| 12.2 | Login — Cambiar título | — | ✅ Completo | "Gestión Legal Integral" |
| 12.3 | Mis Pendientes (to-do personal abogadas) | F-015 | ✅ Completo | CRUD + comentarios, privado por usuario |
| 12.4 | Pipeline de Prospectos | F-016 | ✅ Completo | Kanban 5 etapas, comentarios, convertir a cliente |
| 12.5 | Importación separada clientes/casos | F-009 | ✅ Completo | 2 secciones independientes con plantillas propias |
| 12.6 | Adjuntos en tareas y comentarios | F-008 | ✅ Completo | Clip en tareas, adjuntar en comentarios |
| 12.7 | SQL: tablas todos + prospectos | — | 🔶 Pendiente | 20260403000012_todos_and_prospects.sql |
| 12.8 | SQL: extend document entity_type | — | 🔶 Pendiente | 20260403000013_extend_document_entity_types.sql |

## FASE 1A — UX Foundation (v1.11.0) — selector + reestructura `/legal/*`
| # | Tarea | Feature | Estado | Notas |
|---|-------|---------|--------|-------|
| 1A.1 | Migración SQL: rol `contador` válido en CHECK constraint | — | ✅ Completo | `supabase/migrations/20260504000001_add_contador_role.sql` — aplicar manual en SQL Editor. NO crea usuarios contadores; solo abre el rol. |
| 1A.2 | Helper `getGreetingPanama()` (UTC-5) | — | ✅ Completo | `src/lib/utils/greeting.ts` |
| 1A.3 | Reestructura: todo el CRM bajo `/legal/*` | — | ✅ Completo | Aplanado, sin subárboles por rol. Permisos por componente. |
| 1A.4 | Unificación `/asistente/tareas` + `/abogada/pendientes` → `/legal/pendientes` | — | ✅ Completo | Una URL, contenido por rol. |
| 1A.5 | Unificación gastos y caso-detail bajo `/legal/*` con role-gating | — | ✅ Completo | Asistente con access check (assistant_id o tarea asignada). |
| 1A.6 | Middleware: nuevo `ROLE_ROUTES` + redirects 301 legacy `/abogada/* /asistente/* /admin/* /dashboard` → nuevas rutas | — | ✅ Completo | Vigentes ~4 semanas. Verificados con curl. |
| 1A.7 | Pantalla selector en `/` con saludo Panamá + tarjetas Legal/Finanzas | — | ✅ Completo | Branding Integra, mobile-first, 48px touch target. |
| 1A.8 | Placeholder `/finanzas` "Próximamente" | — | ✅ Completo | Mismo branding. Layout slim sin sidebar. Phase 1B construirá el módulo. |
| 1A.9 | Cron BASE_URL via `process.env.NEXT_PUBLIC_APP_URL` con fallback | — | ✅ Completo | **Configurar la env var en Vercel (production + preview) antes del merge a main**. |
| 1A.10 | Email template URLs: `/abogada/*` → `/legal/*` | — | ✅ Completo | Emails antiguos siguen funcionando vía 301. |
| 1A.11 | Sidebar y bottom-nav reescritos con "Inicio" → `/` | — | ✅ Completo | Asistente expandido (Casos, Gastos, Pendientes). |
| 1A.12 | Login + auth callback: redirect a `/` (era `/dashboard`) | — | ✅ Completo | `/dashboard` redirige 301 a `/`. |
| 1A.13 | Build + smoke test (curl en dev) | — | ✅ Completo | 41 rutas, sin errores de tipos. Lint con errores pre-existentes (ignoreDuringBuilds). |
| 1A.14 | Validación visual en preview de Vercel | — | ⬜ Pendiente | Oliver valida antes de merge a main. |

## INTEGRACIÓN eFACTURA PTY (PAC DGI Panamá) — Sprint propio

Sprint independiente: emisión electrónica de facturas via API del PAC eFactura PTY. Reemplaza el flujo "Camino 1" (captura manual del CUFE desde portal eFactura) por integración API directa.

### ESTADO (cierre 2026-06-04)

- **HITO: emisión de FE VALIDADA end-to-end desde la UI**, sandbox `i_amb=2`. La abogada ya emite y ve el estado fiscal sin tocar consola.
  - `FAC-HON-000461`, `numero_documento=3`, autorizada vía botón "Enviar al PAC" desde el detalle (tipo `01` contribuyente, sandbox 2026-06-04).
  - Acumulado de pruebas autorizadas: 459 (nro 1) + 460 (nro 2) + 461 (nro 3) — todos punto `001`, `i_amb=2`.
- **UI de emisión COMMITEADA** (`7538d9e` en develop):
  - Card "Facturación Electrónica" en el detalle con badge `fe_estado` (no_emitida / pending / authorized / error / canceled) y render por estado.
  - Botón "Enviar al PAC" con modal de confirmación (preview número/total/RUC + advertencia fiscal). Reintento desde estado `error`. Manejo inline de `errorMessage` + `codRes[]` + nota especial para `pac_duplicate`.
  - Columna "Fiscal" en el listado de facturas (escritorio + mobile).
  - Toast `?fe=sent|pending|error` integrado a `InvoiceSuccessToast` (verde / ámbar warning / rojo).
  - `DgiDataCard` legacy ahora condicional: solo aparece para facturas con datos manuales capturados que nunca entraron al flujo automático (fallback de transición).
  - Texto en tuteo neutro panameño (estándar del proyecto).
- `develop = 7538d9e`; `main` intacto en `6bf3c07`. Cadena eFactura completa en `develop` (Fase 1A→4 + fix `formaPago=08` + fix país/classifier + UI de emisión).
- **Config emisor en `.env.local`** (NO en git): RUC `25046169-3-2021`, DV `40`, `INTEGRA LEGAL`, ubicación `8-8-7` (Bella Vista / Panamá / Panamá), dir `Calle 54 Obarrio Atrium Tower P20 Of 20-08`, tel `393-9496`, email `info@integra-panama.com`, punto `001`, `formaPago` default `08` (transferencia), CPBS HON/REI `8012`, `i_amb=2`.
- **Decisiones validadas contra el PAC real:**
  - El PAC asigna `CUFE` (no lo enviamos en el request).
  - Respuesta **SÍNCRONA** (`cufe` + `autorizada=true` en la misma llamada al `POST /api/v1/Invoices`).
  - Classifier lee `rRetEnviFe.xProtFe.rProtFe.gInfProt.gResProc[]` (no `rRetEnviFe.rProtFe...` como sugería el swagger).
  - `cPaisRec="PA"` REQUERIDO para receptores domésticos (`01`/`02`/`03`) — XSD DGI rechaza con cod `0100` si falta.
  - `emisor == receptor` aceptado en sandbox.
  - Certificado de firma electrónica **NO** requerido en sandbox.
- **Fixtures de prueba en BD (LIMPIAR luego):** clientes `TEST-FE-001` (`e5c201d9`, tipo `02`) y `TEST-FE-002` (`d3a203b9`, tipo `01`); facturas `FAC-HON-000459`, `FAC-HON-000460`, `FAC-HON-000461`.

### AL RETOMAR (orden de valor)

1. **Re-verificación visual rápida de la UI** (pre-cierre del sprint UI): (a) confirmar que una factura nueva `no_emitida` muestra SOLO la card "Facturación Electrónica" (sin la legacy DGI duplicada); (b) confirmar tuteo neutro en todos los strings nuevos. Si OK → UI cerrada.
2. **Tests del clasificador de respuesta**: extraer `authorized` / `rejected` / `pending` / `duplicate` como función pura + tests unitarios. Ya tenemos la forma real del response (ver intento 2 de invoice `45f53069`).
3. **Entrega del CAFE al cliente**: `GET /api/v1/Invoices/{cufeId}/cafe-file` + persistencia en Supabase Storage (`cafe_storage_key`).
4. **Reconciliador del estado `pending`**; notas de crédito y anulación PAC (`POST /InvoiceEvents/CreateCancellation`).
5. **Limpieza de la data de prueba** (fixtures listados arriba).
6. **Producción**: certificado A+F (licenciadas) + credenciales prod (proveedor) + registrar punto/sucursal en prod + merge `develop → main` + env vars en Vercel.

### EN ESPERA (terceros)

- **Licenciadas (Daveiva, Integra Legal):**
  - Certificado `.zip` A+F + PIN (para producción — sandbox no lo requirió).
  - Confirmación CPBS de reembolsos (hoy `8012` igual a honorarios — candidato a confirmar).
- **Proveedor (ideati):**
  - Credenciales de producción (URL + API key prod).
  - Confirmar registro de punto / sucursal en prod (sandbox usa `001`).

---

### Fase 1A — Modelo de datos · ✅ CERRADA (2026-05-30)
| # | Tarea | Estado | Notas |
|---|-------|--------|-------|
| eF.1A.1 | Migración SQL fundacional (ALTERs clients/invoices + tablas fe_emisiones, fe_secuencias) | ✅ Ejecutada en Supabase 2026-05-30 | `sql/pending/019_efactura_fase_1a_modelo_datos.sql` — commit **798d1c2** en develop+main |
| eF.1A.2 | Decisiones de modelado consolidadas (reutilizar dgi_cufe / dgi_fecha_autorizacion / dgi_protocolo_autorizacion; derivar tipoContribuyente desde client_type; numero_documento BIGINT autoritativo del API) | ✅ Documentadas en el header del archivo SQL | — |

Resultado en BD prod (verificado vía SELECT POST-CHECK del propio migration):
- `clients` +8 columnas (digito_verificador, tipo_receptor_fe, codigo_ubicacion, corregimiento, distrito, provincia, id_extranjero, pais_receptor) + 1 CHECK.
- `invoices` +9 columnas (fe_estado, dgi_protocolo_autorizacion, i_amb, punto_facturacion, numero_documento, qr_content, cafe_storage_key, xml_storage_key, ef_invoice_uuid) + 2 CHECK + 2 índices parciales.
- Tablas nuevas `fe_emisiones` (log de intentos) y `fe_secuencias` (correlativo por punto de facturación) con RLS por tenant_id.

### Fase 2 — Mapper (lógica pura) · ✅ COMMITEADA (2026-05-30)
| # | Tarea | Estado | Notas |
|---|-------|--------|-------|
| eF.2.1 | Swagger oficial guardado como fuente de verdad | ✅ | `docs/efactura/swagger-v1.json` (126 KB, OpenAPI 3.0.1, 101 schemas) |
| eF.2.2 | Tipos TS InvoiceRequest + sub-tipos generados desde swagger | ✅ | `src/lib/finanzas/efactura/types/invoice-request.ts`, nombres español-camelCase |
| eF.2.3 | Catálogos (ITBMS_RATE_TO_CODE, TIPO_RECEPTOR_FE, TIEMPO_PAGO, etc.) | ✅ | `src/lib/finanzas/efactura/types/catalogs.ts` |
| eF.2.4 | EmisorConfig + loadEmisorConfig() con validación de env vars | ✅ | `src/lib/finanzas/efactura/config/emisor-config.ts` — falla si CPBS=0 |
| eF.2.5 | Tipo standalone InvoiceEfacturaBundle (contrato de entrada del mapper) | ✅ | `src/lib/finanzas/efactura/data/invoice-efactura-bundle.ts` — NO toca invoice-pdf-data.ts |
| eF.2.6 | Sub-mappers (item, receptor, emisor, totales, utils) | ✅ | `src/lib/finanzas/efactura/mapper/*.ts` |
| eF.2.7 | Mapper público mapInvoiceToEfacturaRequest() | ✅ | `src/lib/finanzas/efactura/mapper/map-invoice.ts` — función pura, sin I/O |
| eF.2.8 | Unit tests (10 casos: 8 reglas + 2 smoke) — node:test + tsx, sin agregar tooling nuevo | ✅ 10/10 verde | Correr: `npx tsx --test src/lib/finanzas/efactura/__tests__/map-invoice.test.ts` |

**SHA del commit de la Fase 2:** `1e340c7` (develop). 14 archivos, +5778 líneas.

### Punto de retoma (próxima sesión / otra máquina)
1. **Verificar antes de tocar nada:**
   - `npx tsc --noEmit` → debe pasar sin errores.
   - `npx tsx --test src/lib/finanzas/efactura/__tests__/map-invoice.test.ts` → debe reportar 10/10 verde.
2. **Revisar decisiones de implementación pendientes** (documentadas en el código pero sin validar con DGI/PAC):
   - `numeroSecuenciaItem` 1-indexed (CRM usa line_order 0-indexed → mapper hace `+1`). Confirmar con la doc del PAC que el primer item es 1, no 0.
   - `totalGravado` = suma de subtotales de líneas con `tax_rate > 0` (no incluye exentas). Confirmar con la doc del PAC si la convención esperada es esa o si debe incluir exentas.
   - `toPanamaIso()` interpreta `'YYYY-MM-DD'` como medianoche local Panamá (00:00 -05:00). Si el PAC requiere otra hora del día (ej. hora de emisión real), ajustar y agregar test.
   - `tipoContribuyente=1` (natural) vs `=2` (jurídica): el swagger marca el campo como integer no nullable pero no documenta los códigos. Validar con el PAC.

### Fase 3 — Transport + validación de catálogos · ✅ CERRADA (2026-06-03)

| # | Tarea | Estado | Notas |
|---|-------|--------|-------|
| eF.3.1 | Dev API Key obtenido (ambiente pruebas, base `eic-api.ideati.net`) | ✅ | Cargado en `.env.local` (no commiteado). Plantilla en `.env.example`. |
| eF.3.2 | Cliente HTTP server-only con Bearer auth | ✅ | `src/lib/finanzas/efactura/transport/efactura-client.ts`. Lee `EFACTURA_API_BASE_URL` y `EFACTURA_API_KEY` de forma lazy. NO incluye el key en mensajes de error. |
| eF.3.3 | Auth contra el PAC VALIDADA | ✅ | `npx tsx scripts/efactura/fetch-catalogs.ts` retorna 200 en 5 catálogos (CPBSsegs, CPBSfams, locations, countries, currencies). |
| eF.3.4 | CPBS servicios legales — código identificado | 🟡 Parcial | **HON = 8012** confirmado (segmento legal services). REI por confirmar con el contador (candidato `8012`). Actualizar `cpbsServiciosLegalesHon` / `cpbsServiciosLegalesRei` en `emisor-config.ts` cuando se confirme REI. |
| eF.3.5 | Catálogo formaPago + código transferencia | ✅ Confirmado por proveedor | El PAC NO expone catálogo descargable (es enumeración cerrada DGI). Código oficial **`08` = "Transf./Depósito a cta. Bancaria"** confirmado por el proveedor; cargado como `defaultFormaPago` en `emisor-config.ts` (commit **d5ecdf2**). |

**Nota operativa (Windows / Node 24):** este equipo requiere `NODE_OPTIONS=--use-system-ca` para que `fetch` confíe en la cadena TLS local al llamar al PAC. Ejemplo PowerShell:
```
$env:NODE_OPTIONS = "--use-system-ca"; npx tsx scripts/efactura/inspect-catalogs.ts
```
Los scripts `scripts/efactura/{fetch-catalogs,inspect-catalogs}.ts` son utilitarios dev read-only — no requieren certificado de firma.

### Bloqueadores históricos (todos superados — ver bloque "ESTADO (cierre 2026-06-03)" al inicio)
- ~~Certificado de firma electrónica~~ → sandbox NO lo requirió. Sí necesario para producción (pendiente con licenciadas).
- ~~Código `formaPago` oficial DGI~~ → confirmado `08` (transferencia) por el proveedor.
- ~~Datos fiscales del emisor~~ → cargados en `.env.local` (RUC, DV, ubicación, punto, etc.).
- **Confirmación REI CPBS:** sigue pendiente — candidato `8012` (mismo que HON), por confirmar con contador/licenciadas.

### Decisiones de implementación pendientes (heredadas de Fase 2, sin validar con PAC todavía)
- `numeroSecuenciaItem` 1-indexed (CRM usa `line_order` 0-indexed → mapper hace `+1`).
- `totalGravado` = suma de subtotales de líneas con `tax_rate > 0` (no incluye exentas).
- `toPanamaIso()` interpreta `'YYYY-MM-DD'` como medianoche local Panamá (00:00 -05:00).
- `tipoContribuyente=1` (natural) vs `=2` (jurídica): swagger lo marca integer no nullable sin documentar códigos.

### Fase 4 — Flujo de emisión · ✅ CERRADA (2026-06-02) — primera FE autorizada en sandbox 2026-06-03

| # | Tarea | Estado | Notas |
|---|-------|--------|-------|
| eF.4.1 | Allocator de `fe_secuencias` — RPC `allocate_fe_numero(uuid, varchar(3))` | ✅ Aplicado en Supabase + commit | `sql/pending/020_efactura_allocator.sql` + wrapper TS `src/lib/finanzas/efactura/secuencias/allocate-fe-numero.ts`. Commit **fb7647d**. Política A (gaps tolerados). |
| eF.4.2 | `loadEmisorConfig()` extendido con `puntoFacturacion` (req, 3 dígitos, ≠ '000') e `iAmb` (req, 1\|2) | ✅ | `src/lib/finanzas/efactura/config/emisor-config.ts`. Variables nuevas en `.env.example`. |
| eF.4.3 | Fetcher real `fetchInvoiceEfacturaBundle()` + gate fiscal del cliente | ✅ | `src/lib/finanzas/efactura/data/fetch-invoice-efactura-bundle.ts`. Falla con `MutationError(400)` y lista accionable si falta `tax_id`/`ruc`, `tipo_receptor_fe`, o (según tipo) `id_extranjero`+`pais_receptor` ó `codigo_ubicacion`+`corregimiento`+`distrito`+`provincia`. |
| eF.4.4 | Orquestación T0-T4 `emitInvoiceToEfactura()` | ✅ | `src/lib/finanzas/efactura/orchestration/emit-invoice-to-efactura.ts`. T0 pre-check, T1 allocate-o-reuso (D-3), T2 mark pending + log fe_emisiones, T3 POST sin lock, T4 clasifica respuesta (`authorized` \| `pending_async` \| `rejected`) y persiste. Heurística de duplicado por sustring en `dMsgRes`. |
| eF.4.5 | Route handler `POST /api/finanzas/invoices/[id]/emit-efactura` (admin + abogada, 403 al resto) | ✅ | `src/app/api/finanzas/invoices/[id]/emit-efactura/route.ts`. Mismo allowlist que `/emit` y `/dgi`. |
| eF.4.6 | `.env.example` actualizado con 14 variables `EFACTURA_EMISOR_*` (placeholders comentados para `FORMA_PAGO_DEFAULT` y `CPBS_REI`) | ✅ | — |
| eF.4.7 | Typecheck `tsc --noEmit` limpio | ✅ | — |

**SHA del commit de la Fase 4:** `7336824` (develop). 6 archivos, +1072 líneas. Push a `origin/develop` realizado. `main` intacto en `6bf3c07`.

### Estado actual del andamiaje de emisión

Toda la pipeline está commiteada y funcional contra el PAC. Cadena de commits:
- Fase 1A modelo de datos — **798d1c2**
- Fase 2 mapper puro — **1e340c7**
- Fase 3 transport + validación catálogos — **561f4ca** / **5ea986b**
- Allocator RPC `allocate_fe_numero` — **fb7647d** (aplicado en Supabase)
- Fase 4 flujo de emisión (orquestación + fetcher + route) — **7336824**

**Datos confirmados:**
- Punto de facturación del CRM = `001` (QuickBooks histórico usa `050`, se mantiene separado).
- CPBS honorarios = `8012`.
- Ambiente sandbox `i_amb=2`.
- Base API = `eic-api.ideati.net`, auth Bearer API Key (no OAuth).
- El PAC asigna el CUFE (no lo enviamos en el `InvoiceRequest`).

### En espera / Al retomar
Las listas autoritativas están en el bloque **"ESTADO (cierre 2026-06-03)"** al inicio de esta sección. Acá quedaba documentado el camino corto a la primera emisión de prueba — ya realizado el 2026-06-03.

### Pendientes técnicos posteriores (orden sugerido)

- **Reconciliador del estado `pending`** — cron + endpoint que pollea `/Invoices/Authorization/{cufe}` o `/Invoices/id/{cufeId}`. Su construcción depende de qué responde el PAC en la primera emisión real.
- **Tests del clasificador de respuesta** — extraer `parsePacResponse` como función pura exportada y cubrir con node:test los caminos `authorized` / `pending_async` / `rejected` / `pac_duplicate`. Mejor armarlo **después** de la primera emisión real, con una respuesta auténtica como fixture.
- ~~**UI** — botón "Enviar al PAC" en el detalle de factura, badge de `fe_estado`~~ ✅ COMMITEADA (`7538d9e`, 2026-06-04). Falta solo modal de auditoría de intentos contra `fe_emisiones` (opcional, scope futuro).
- **Notas de crédito / anulación** — POST `/api/v1/InvoiceEvents/CreateCancellation` (cuando hay CUFE y < 182h) y NC obligatoria (≥ 182h). Sprint propio cada uno.
- **Descarga y persistencia del CAFE/XML** en Supabase Storage (`cafe_storage_key`, `xml_storage_key` ya existen en el schema, falta la mecánica de bajada).

## FASE 11: Testing & Deploy
| # | Tarea | Feature | Estado | Notas |
|---|-------|---------|--------|-------|
| 11.1 | Testing completo con Playwright MCP | — | ⬜ Pendiente | Todos los flujos |
| 11.2 | Pre-deploy checklist (13 pasos) | — | ⬜ Pendiente | SOP-006 |
| 11.3 | Deploy a producción | — | ⬜ Pendiente | Requiere aprobación de Oliver |
| 11.4 | Verificación post-deploy | — | ⬜ Pendiente | |
