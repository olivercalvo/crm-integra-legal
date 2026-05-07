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
