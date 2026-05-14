# CLAUDE.MD — CRM INTEGRA LEGAL

## 1. PROYECTO
**Nombre:** CRM Integra Legal
**Descripción:** CRM web multi-tenant, mobile-first, para bufetes de abogados. MVP para Integra Legal (Panamá). Gestión de clientes, expedientes, gastos, tareas y documentos con acceso por roles y soporte offline-first.
**Repositorio:** https://github.com/olivercalvo/crm-integra-legal
**Hosting:** Vercel (producción)
**Fecha inicio:** 2026-04-02

## 2. STACK TECNOLÓGICO
- **Frontend:** Next.js 14 (App Router), TypeScript, Tailwind CSS, shadcn/ui
- **Backend/DB:** Supabase (PostgreSQL + Auth + Storage + RLS + Realtime)
- **Deploy:** Vercel
- **Offline:** IndexedDB (cola persistente) + sync automática con resolución de conflictos
- **Testing visual:** Playwright MCP

## 3. ARQUITECTURA
- **Multi-tenant:** Row Level Security (RLS) con `tenant_id` en todas las tablas desde día 1
- **Offline-first:** Toda operación de escritura pasa por cola local (IndexedDB) → sync al reconectar → resolución de conflictos por timestamp → CERO pérdida de datos garantizada
- **Auth:** Supabase Auth (email + password), sesión de 8 horas, "Recordarme" guarda solo usuario
- **Storage:** Supabase Storage para documentos adjuntos (PDF, Word, imágenes, escaneos)
- **Audit log:** Tabla `audit_log` registra TODA operación CRUD en todas las entidades (usuario, timestamp, entidad, campo, valor anterior, valor nuevo)

## 4. ROLES Y PERMISOS
| Rol | Permisos |
|-----|----------|
| **Administrador** | Todo + gestión de usuarios y catálogos + importación masiva |
| **Abogada** | CRUD clientes, expedientes, tareas, gastos, documentos, comentarios, importación masiva |
| **Asistente** | Ver sus casos asignados, actualizar estado, registrar gastos, cumplir tareas, comentar, subir documentos |

## 5. REGLAS DE DESARROLLO (NON-NEGOTIABLE)

### Git
- Siempre trabajar en branch `develop`; `main` es producción con auto-deploy
- **NUNCA** push/merge a `main` sin aprobación explícita de Oliver
- Auto-commit a GitHub después de cada cambio de código
- Linting antes de commits; diff review antes de merge a main
- `.env` NUNCA se commitea; lock files SIEMPRE se commitean

### Archivos .md
- Actualizar después de cada cambio de código:
  - `changelog.md` → SIEMPRE
  - `sop.md` → si cambió lógica
  - `productdesign.md` → si cambió feature
  - `task_plan.md` → progreso

### Pausa obligatoria antes de:
- Merge a main
- Cambios de schema en DB producción
- Cambios de env vars en producción
- Eliminación de datos

### Self-Annealing (ciclo de reparación)
Analyze → Document en `findings.md` → Patch → Test → Update SOP → Commit

### Playwright MCP
- ANTES y DESPUÉS de cada cambio: abrir navegador, navegar a localhost:3000, verificar que la app funciona
- Si hay errores, corregir ANTES de reportar
- Integrar con ciclo Self-Annealing

### DB Safety
- Verificar entorno antes de ejecutar migraciones
- Backup de producción antes de migraciones
- localhost = dev; URL de Vercel = prod

### Deploy
- Checklist de 13 pasos pre-deploy (ver `sop.md`)
- Verificación post-deploy obligatoria
- Deploy log en `changelog.md`
- Rollback-first ante cualquier problema en producción

## 6. DATA-FIRST RULE
- Definir JSON schema / DB schema ANTES de codificar cualquier feature
- Toda API response tiene tipado TypeScript estricto

## 7. DISEÑO Y UX

### Branding Integra Panamá
- **Azul marino oscuro:** #1B2A4A (backgrounds, headers, textos principales)
- **Dorado:** #C5A55A (acentos, CTAs, badges, highlights)
- **Blanco:** #FFFFFF (fondos de cards, textos sobre oscuro)
- **Tipografía:** Serif profesional (ej. Playfair Display para headings, Inter para body)
- **Logo:** Integra en header
- **Estilo:** Limpio, corporativo, profesional

### Mobile-First / Foolproof
- Botones mínimo 48px touch target
- Iconos + texto en TODAS las acciones
- Máximo 3 taps por tarea
- Formularios tipo wizard, máximo 5 campos por pantalla
- Responsive — diseñado primero para móvil, funciona en desktop
- Dark mode NO — paleta corporativa clara

## 8. CUENTAS Y PROPIEDAD
- **GitHub:** cuenta de Oliver (el desarrollador). El repo es propiedad de Oliver.
- **Supabase:** cuenta del CLIENTE (Integra Legal). El proyecto Supabase se crea en la cuenta del cliente. Oliver NO debe usar su propia cuenta de Supabase para este proyecto.
- **Vercel:** cuenta del CLIENTE (Integra Legal). El deploy se hace desde la cuenta del cliente. Oliver NO debe usar su propia cuenta de Vercel para este proyecto.
- **Implicación:** las env vars de Supabase (URL, ANON_KEY, SERVICE_ROLE_KEY) y el proyecto de Vercel serán proporcionadas por el cliente. No asumir valores propios. Solicitar credenciales antes de configurar.

## 9. ENTORNO
- **Dev:** localhost:3000
- **Prod:** URL de Vercel del cliente (auto-deploy desde main)
- **Supabase:** proyecto del cliente, RLS por tenant_id

## 10. CONVENCIONES DE CÓDIGO
- TypeScript strict mode
- Nombres de componentes en PascalCase
- Nombres de archivos en kebab-case
- Server Components por defecto, Client Components solo cuando necesario
- Imports absolutos con `@/`
- Supabase client: server-side con `createServerComponentClient`, client-side con `createClientComponentClient`

## Módulo Finanzas — Anulación de facturas

### Estado actual (Camino 1, MVP transitorio)

Las abogadas y admins pueden anular facturas emitidas desde la UI:
- Botón "Anular factura" visible en detalle cuando status ∈ {emitida, parcialmente_pagada, pagada}
- Modal con textarea obligatoria (mínimo 3 caracteres, máximo 1000)
- Permisos: admin + abogada + contador (NO asistente)
- La anulación es UN solo UPDATE atómico: status='anulada' + cancellation_reason + cancelled_at = NOW()
- T2 (status transition validator) permite emitida→anulada y parcialmente_pagada→anulada
- T2 NO permite pagada→anulada hoy. Cuando llegue Fase 2C (pagos) habrá que revisar el trigger junto con la lógica de reverso de payments.

Schema relevante:
- invoices.cancellation_reason TEXT NULL — obligatorio al anular
- invoices.cancelled_at TIMESTAMPTZ NULL — timestamp UTC interno
- Migration: 20260507000001_finanzas_b4_anular_factura.sql

### Estado futuro (Camino 2, post-integración eFactura)

Cuando se complete la integración con la API de eFactura, el helper cancelInvoice() debe extenderse con la siguiente lógica de bifurcación:

| Escenario | Acción | Endpoint DGI |
|---|---|---|
| Factura sin dgi_cufe (pre-integración o falla) | Anular solo en BD interna | — |
| dgi_cufe registrado, < 182h desde dgi_fecha_autorizacion | Anular en DGI + BD | POST /api/v1/InvoiceEvents/CreateCancellation con cancellationReason |
| dgi_cufe registrado, ≥ 182h | NC obligatoria (no anular) | POST /api/v1/Invoices con tipoDocumento=04 (módulo NC, sprint propio) |
| Anulada manualmente en portal eFactura | Detectar via polling, sync BD | GET /Invoices/{id} |

Activos ya preparados para Camino 2:
- cancellation_reason → mapea 1:1 a cancellationReason del payload DGI
- cancelled_at → auditoría interna
- dgi_fecha_autorizacion → cálculo de ventana 182h
- dgi_cufe → identificador único para el endpoint de cancelación
- cancelInvoice() helper en src/lib/finanzas/api/invoices.ts → punto único donde se intercepta para agregar la llamada DGI

Items pendientes Camino 2:
- Cliente API eFactura server-side
- Helper canCancel() que retorna 'anular' | 'nc-obligatoria' según horas transcurridas
- UI condicional en CancelInvoiceDialog (≥182h bloquea botón y sugiere NC)
- Módulo Nota de Crédito (sprint propio)
- Polling sync portal eFactura (no hay webhook documentado)
- Manejo idempotencia: cola de retry o flag pending_sync si DGI cae después del UPDATE local

## Sprint 2E.1 Cotizaciones — Backend (Cerrado 2026-05-13)

### Implementado en producción
- Módulo Cotizaciones backend completo (8 endpoints REST)
- Endpoints: /api/finanzas/quotes/{POST,GET}, /api/finanzas/quotes/[id]/{GET,PATCH,DELETE},
  /cancel, /send, /mark-accepted, /mark-rejected, /convert, /api/finanzas/configuracion/terms-template/{GET,PUT}
- Schema: tabla quotes 35 columnas, quote_lines 18 columnas, quote_terms_template con seed T&C panameña
- Sequence quote: last_number=1268, próxima COT-001269
- Refactor clients: columna active eliminada, reemplazada por client_status (prospect|active|inactive) + client_type (persona_natural|persona_juridica)
- Backfill client_type desde type legacy: 31 persona_natural, 28 persona_juridica, 5 NULL
- Gate facturas: createInvoice rechaza si client_status != 'active'
- Validación promoción prospect→active: requiere tax_id, tax_id_type, email
- Creación inline de prospect desde createQuote
- convertToInvoices: cotización aceptada → 1 o 2 facturas (HON/REI) según líneas mixtas

### NO implementado (queda para sprints futuros)
- UI de Cotizaciones (Fase 2E.2 — listado, crear, editar, detalle)
- PDF generation + envío email Resend (Fase 2E.3)
- Portal público con token único (Fase 2E.4)
- Cron de expiración automática (Fase 2E.4)

### Lecciones aprendidas
- **Schema y código DEBEN moverse en lock-step**. NUNCA dropear columnas antes de refactorizar y verificar código en producción.
- **Patrón seguro de migración destructiva**: agregar columna nueva → backfill → refactor código → deploy + verificar prod → drop columna vieja en migración separada.
- **El hotfix GENERATED ALWAYS AS** sirve como puente temporal seguro cuando se dropea una columna que aún tiene referencias en código.
- **Voseo argentino** es un anti-patrón en el proyecto (tuteo neutro panameño obligatorio en UI).

## Sprint 2E.2 UI Cotizaciones — Cerrado 2026-05-13

### Implementado en producción
- 5 pantallas nuevas en /finanzas/cotizaciones/* (listado, nueva, detalle, editar, configuracion)
- 18 componentes UI nuevos en src/app/finanzas/cotizaciones/_components y src/components/finanzas/cotizaciones/
- Sidebar actualizado con entradas Cotizaciones (admin/abogada/contador) y Plantilla T&C (solo admin)
- Toast cross-módulo: invoice-success-toast lee ?converted=N para mostrar mensaje violeta cuando se llega desde conversión de cotización
- Loading + Error boundaries en /finanzas/cotizaciones/*

### Decisiones de UX implementadas (D1-D7)
- D1: Toggle visible siempre con 2 secciones radio (cliente existente vs prospecto nuevo)
- D2: Una tabla con dropdown HON/REI por línea + indicador visual + totales agrupados por kind
- D3: Conversión con modal preview "1-2 facturas" → redirect al detalle de la 1ra con toast
- D4: Botón Enviar cambia status + muestra link público copiable (NO email, NO mailto)
- D5: Botones de acción en header del detalle según status (Marcar Aceptada/Rechazada/Cancelar)
- D6: Editor T&C en /finanzas/cotizaciones/configuracion, admin-only, 403 redirect para otros roles
- D7: Badges de status con paleta completa (gris/azul/verde/rojo/ámbar/violeta)

### NO implementado (queda para sprints futuros)
- Envío real de email vía Resend (Fase 2E.3)
- Portal público /cotizacion/[token] para que el cliente apruebe/rechace (Fase 2E.4)
- Generación de PDF descargable (Fase 2E.3)
- Cron de expiración automática (Fase 2E.4)

### Lecciones aprendidas
- Reordenamiento por dependencia de compilación: ConvertToInvoicesDialog se entregó en Fase C
  (no D) porque el detalle ya lo importa para el estado aceptada. Mantenido en su fase nominal
  conceptualmente pero implementado donde la compilación lo requería.

## Sprint 2E.3 + 2E.3.2 — Cerrado 2026-05-14

### Implementado
- PDF generation on-demand con cache por hash SHA-256 (regenera solo si el contenido cambia)
- Email Resend con PDF adjunto (DNS verified para `integra-panama.com`)
- Tabla `documents` extendida polimórfica: `source`, `source_version`, `source_generated_at`, `source_content_hash`, `entity_type='quote'`
- CHECK `documents_source_check` future-proof preparado para `'invoice'` y `'auto_invoice_pdf'` (Fase 2F)
- Botón "Descargar PDF" disponible en todos los estados del detalle de cotización
- Botón "Reenviar" para estados `enviada`/`aceptada`/`rechazada`: status NO cambia, refresca `sent_at` + `sent_to_email` + `sent_by` y reutiliza el `public_token` original
- Visibilidad doble: PDF auto-generado aparece en la sección Documentos del cliente con badge violeta "PDF Cotización COT-XXXXXX"
- Bloqueo de delete manual para documentos con `source != 'manual'` (gestionados automáticamente)
- Portal público placeholder `/cotizacion/[token]` (paleta navy/gold, mobile-first, sin sidebar CRM)
- Middleware actualizado para permitir acceso público sin auth a `/cotizacion/[token]`
- **Campo `title` OBLIGATORIO (3-100 chars)** en `quotes`, con CHECK `quotes_title_length`
- Backfill aplicado: 4 cotizaciones legacy con título auto-generado `'Cotización {cliente} {DD/MM/YYYY}'`
- Hash del PDF incluye `title` (regenera el PDF si el título cambia)
- Listado de cotizaciones: 3 líneas en columna Cliente (nombre + título + client_number)
- Detalle con título prominente debajo del `COT-XXXXXX` (`text-lg font-semibold text-gray-700`)
- PDF con banda de título `Helvetica-Oblique 11pt navy` debajo del header navy/gold
- Email subject: `Cotización COT-XXXXXX: {título} · Integra Legal`
- Email cuerpo HTML/texto plano con título descriptivo (italic semibold en HTML, "Referencia: …" en texto plano)

### Bugs corregidos en este sprint
- **PDF download redirigía la pestaña actual** (causa: `window.open` con noopener fallback). Fix: anchor programático con `document.createElement('a')`.
- **Banner verde mentiroso en envío de email**: la validación de Resend solo chequeaba `!error`, no validaba `data.id` presente. Resultado: cotizaciones que NO llegaban al inbox aparecían como "enviadas" en la UI. Fix: requiere `data.id` Y `error null`, con log estructurado en todos los casos.

### SHAs Sprint 2E.3.2
- `a5ef205` chore - remove endpoint debug test-resend post-hotfix
- `ff80542` feat - migración SQL agregar columna title obligatoria
- `25cf13d` feat - backend campo title obligatorio + input en form
- `31b5995` feat - UI título en listado/detalle/PDF/email/portal

### Pendiente Sprint 2E.4
- Portal público FUNCIONAL (cliente acepta/rechaza desde link con log de IP/UA)
- Cron de expiración automática (`enviada` → `expirada` cuando pasa `valid_until`)
- Notificación a abogada cuando el cliente responde

### Pendiente operativo (no técnico)
- Confirmar con las licenciadas qué email de contacto mostrar en el portal público. Hoy está hardcoded `contacto@integra-panama.com` en `src/app/cotizacion/[token]/page.tsx`, dirección que probablemente no existe. Es un cambio de una sola línea cuando lo confirmen.
