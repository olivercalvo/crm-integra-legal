# CHANGELOG.MD — CRM INTEGRA LEGAL

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
