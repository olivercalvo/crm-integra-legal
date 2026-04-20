# CHANGELOG.MD — CRM INTEGRA LEGAL

## [1.9.2] — 2026-04-20

### Feature — Nueva clasificación EXTRAJUDICIAL (prefijo EXT, color #00695C)
- **SQL pendiente** en `/sql/pending/add_extrajudicial_classification.sql`: INSERT con verificación previa, idempotente (NOT EXISTS) y rollback comentado. Tenant `a0000000-0000-0000-0000-000000000001`. **No ejecutado** — Oliver lo corre manualmente en Supabase SQL Editor.
- **Fallback de color** agregado en `/src/lib/utils/classification-colors.ts` (`EXTRAJUDICIAL: "#00695C"`) para que el badge se renderice con el color correcto incluso en entornos donde la migración aún no se haya ejecutado.
- **Texto del badge**: `getClassificationTextColor` ya devuelve `#FFFFFF` para todos los colores excepto REGULATORIO — EXT obtiene texto blanco con contraste WCAG AA sobre #00695C automáticamente.
- **Auto-numeración**: el endpoint `GET /api/cases?classification_id=` lee el `prefix` de `cat_classifications` y calcula el siguiente correlativo escaneando casos existentes con ese prefijo. EXT-001, EXT-002, ... funcionarán automáticamente sin más cambios.
- **Sin cambios de código en formularios/listados/dashboard/print card**: el dropdown del wizard, el editor inline y los badges leen `cat_classifications` desde BD; aparecerán solos al insertar la fila.
- **Archivos**: `/sql/pending/add_extrajudicial_classification.sql` (nuevo), `/src/lib/utils/classification-colors.ts`.

## [1.9.1] — 2026-04-20

### Fix — Migrar el editor inline (vista de detalle del caso) al nuevo InstitutionSelect
- En la implementación inicial del CRUD de instituciones se migró sólo el wizard `case-form.tsx`. El editor inline `inline-case-editor.tsx` (botón "Editar Información" en `/abogada/casos/[id]`) seguía usando un `<select>` HTML nativo, donde no se pueden renderizar íconos por opción — por eso los íconos de editar/eliminar no aparecían cuando el usuario editaba desde la vista de detalle.
- Reemplazado el `<select>` nativo en `inline-case-editor.tsx` por `<InstitutionSelect>`. Plumbed `userRole` desde la página de detalle (`abogada/casos/[id]/page.tsx`).
- **Archivos**: `/src/components/cases/inline-case-editor.tsx`, `/src/app/(dashboard)/abogada/casos/[id]/page.tsx`.

## [1.9.0] — 2026-04-20

### Feature — CRUD completo de instituciones desde el dropdown de casos
- Reemplazado el `<select>` nativo de "Institución" en el formulario de casos por un dropdown personalizado (`InstitutionSelect`) que permite editar y eliminar instituciones sin salir del contexto.
- **Edición inline**: ícono lápiz por fila → fila se vuelve input editable con ✓ guardar / ✗ cancelar (Enter/Esc también funcionan). Validación: nombre no vacío, no duplicado (case insensitive) en el mismo tenant. Toast "Institución actualizada".
- **Eliminación con pre-check de uso**: ícono basurero → llama a nuevo endpoint `GET /api/admin/catalogs/[id]/usage`. Si la institución no está en uso, modal "Eliminar institución" con botones Cancelar/Eliminar. Si está asignada a casos, modal informativo "No se puede eliminar" con conteo de casos y único botón "Entendido".
- **Permisos**: `admin` y `abogada` ven y usan los íconos. `asistente` no los ve (no se renderizan).
- **UX mobile**: íconos siempre visibles en móvil; en desktop aparecen solo en hover de la fila. Área clickeable de 32px.
- **Backend**: actualizado `PATCH/DELETE /api/admin/catalogs/[id]` para permitir rol `abogada` exclusivamente sobre `cat_institutions`. Validación de nombre duplicado movida al backend (case insensitive, mismo tenant). Soft-delete reusa el chequeo de referencias existente.
- **Sin cambios de BD**: las RLS y schema actuales soportan UPDATE/DELETE por tenant. El soft-delete (`active=false`) reutiliza la convención del proyecto.
- El flujo "+ Agregar nueva institución" se mantiene idéntico (sigue usando `new_institution_name` en `/api/cases`).
- **Archivos**: `/src/components/cases/institution-select.tsx` (nuevo), `/src/components/cases/case-form.tsx`, `/src/app/api/admin/catalogs/[id]/route.ts`, `/src/app/api/admin/catalogs/[id]/usage/route.ts` (nuevo), `/src/app/(dashboard)/abogada/casos/[id]/editar/page.tsx`, `/src/app/(dashboard)/abogada/casos/nuevo/page.tsx`.

## [1.8.0] — 2026-04-13

### Feature — Email Diario Automático para Abogadas
- **Cron diario** a las 9:00 AM Panam (UTC-5), lunes a sbado. Domingos no se enva.
- **Template con branding Integra Legal**: header azul marino con "DESPACHO JURDICO  INTEGRA LEGAL / Panam", lnea dorada decorativa, saludo "Buenos das, Licda. [Nombre]", fecha en espaol con da de la semana.
- **Seccin 1: Tus Pendientes** tabla con Caso | Cliente | Tarea | Vence. Casos son links clickeables al CRM. Badges: rojo "Vencido" y amarillo "Vence hoy".
- **Seccin 2: Pendientes Asignados por Otros** tabla con Caso | Cliente | Tarea | Asignado por | Vence. Mismos badges y links.
- **Seccin 3: Seguimientos Recientes** ltimos 15 seguimientos (tareas + comentarios) de toda la oficina con Fecha | Caso | Cliente | Descripcin | Registrado por.
- **Footer** azul marino: "INTEGRA LEGAL  Gestin Legal Integral", aviso de mensaje automtico.
- **Botn "Ver en el CRM"** al final de cada seccin.
- **Modo test** con `?test=true` enva solo a oliver@clienteenelcentro.com.
- **Proteccin** con CRON_SECRET en header Authorization.
- **Queries**: usa tabla `tasks` con joins a `cases` y `clients` (no personal_todos).
- **vercel.json** configurado: `0 14 * * 1-6`.
- **Archivos**: `/src/lib/email/resend.ts`, `/src/lib/email/daily-summary-template.ts`, `/src/app/api/cron/daily-summary/route.ts`, `vercel.json`, `/sql/pending/ENVIRONMENT_VARIABLES.md`.

## [1.7.2] — 2026-04-12

### Bugfix — Dashboard: conteos de Mis Pendientes no coincidían con página de Pendientes
- Dashboard ahora carga todos los `personal_todos` sin filtrar `status` en DB (igual que `/abogada/pendientes`) y filtra a `status === "pendiente"` en JavaScript.
- Garantiza que los conteos del dashboard coinciden exactamente con la página de Pendientes.
- Se agrega campo `status` al select de ambas queries del dashboard para poder filtrar en JS.

### Bugfix — Tarjeta imprimible: contenido se cortaba al imprimir
- Eliminado `overflow: hidden` del body; reemplazado con `min-height` + `max-height` y flexbox para distribuir contenido.
- Agregado `@media print` explícito con dimensiones exactas para ambos formatos.
- Tarjeta completa: header + código + descripción del trámite + nombre del cliente + datos del caso.
- Etiqueta simple: código grande + nombre del cliente, centrado.
- Ambos formatos caben sin cortarse en impresión.

### Bugfix — Buscador de casos: debounce y consistencia (reportado 2x)
- `CaseFilters` ahora tiene debounce de 300ms en el input de búsqueda (antes disparaba `router.push` en cada keystroke).
- Input controlado con estado local para evitar pérdida de foco/valor durante transiciones.

### Mejora — Buscador de clientes: más campos de búsqueda
- La búsqueda de clientes ahora incluye `email` y `phone` además de `name`, `ruc` y `client_number`.

### Bugfix — Buscador global del header
- Ahora busca casos por nombre de cliente (antes solo buscaba `case_code` y `description`).
- Rutas corregidas: `/clientes/` → `/abogada/clientes/`, `/casos/` → `/abogada/casos/`.
- Implementación: query adicional para encontrar clientes que coincidan, luego busca sus casos y combina sin duplicados.

## [1.7.1] — 2026-04-11
### Bugfix — Dashboard Abogada: Mis Pendientes usaba tabla equivocada
- El dashboard consultaba `tasks` (tareas vinculadas a casos) en vez de `personal_todos` (Mis Pendientes). Resultado: Daveiva veía 1 pendiente en vez de los 5 reales.
- Queries de "Mis Pendientes" y "Pendientes Asignados por Otros" ahora usan `personal_todos` con exactamente la misma lógica que `/abogada/pendientes`:
  - Mis Pendientes: `user_id = userId AND status = 'pendiente'`
  - Asignados por Otros: `assigned_to = userId AND user_id != userId AND status = 'pendiente'`
- Cada fila linkea a `/abogada/pendientes` (ya no a un caso, porque los personal_todos no tienen case_id).
- "Mis Pendientes" muestra "Asignado a: [nombre]" cuando el todo está asignado a otra persona.
- El endpoint del email diario (`/api/cron/daily-summary`) y el template HTML también se corrigieron para usar `personal_todos`.

### Feature — Tarjeta imprimible de expediente rediseñada
- Fix del recorte al imprimir: `@page margin: 0` + `html,body margin:0` + body con dimensiones fijas `5.5in × 4.25in` y padding interior. El borde queda al ras del papel.
- La tarjeta completa ahora incluye: código (grande) + descripción del trámite (itálica, 2 líneas máx) + nombre del cliente + código cliente + clasificación + responsable + fecha apertura.
- Descripción y cliente usan line-clamp (máx 2 líneas) + overflow hidden para evitar corte por contenido largo.
- Nuevo botón **Etiqueta Simple** (icono `Tag`): imprime etiqueta compacta 4in × 2in con solo código + nombre del cliente, centrado, con el color de clasificación como borde superior.
- Ambos formatos conservan el borde superior del color de la clasificación (10px).
- HTML del template ahora escapa correctamente caracteres especiales del cliente/descripción.

### Bugfix — Búsqueda en lista de casos no encontraba por nombre de cliente
- El filtro usaba `.or('case_code.ilike.X,description.ilike.X,client_id.in.(uuid1,uuid2)')` pero PostgREST/supabase-js no parsea confiablemente el `in.(...)` anidado dentro de un `.or()` compuesto — los commas internos confundían al tokenizer.
- Nueva implementación: tres queries en paralelo para obtener IDs candidatos y unión en JS, luego `.in('id', allIds)` sobre la query principal.
  - Query 1: clientes cuyo `name` o `client_number` matchea
  - Query 2: casos cuyo `case_code` o `description` matchea
  - Query 3: casos cuyo `client_id` está en los clientes matcheados
- Ahora `"alejandra"` encuentra todos los casos de clientes con ese nombre (ilike es case-insensitive por defecto).
- La búsqueda sigue respetando los otros filtros (status, clasificación, responsable, institución) y la paginación.

## [1.7.0] — 2026-04-11
### Feature — Dashboard Abogada: Pendientes, Asignados y Seguimientos
- Nueva sección "Mis Pendientes": tareas pendientes donde la abogada logueada es creadora/responsable, ordenadas por fecha límite ascendente, con badge de urgencia (vencido/urgente/normal)
- Nueva sección "Pendientes Asignados por Otros": tareas donde la abogada es `assigned_to` pero el `created_by` es otra persona; muestra quién asignó
- Nueva sección "Seguimientos Recientes": merge cronológico (desc) de tareas + comentarios de TODOS los casos del tenant (últimos 20), con link "Ver todos" a `/abogada/seguimiento`
- Visibilidad por rol: abogada solo ve lo propio; admin ve todos los pendientes de la oficina
- Cada fila es clickeable y navega al caso correspondiente

### Feature — Email Diario Automático (8:00 AM Panamá, L-S)
- Nuevo endpoint `GET /api/cron/daily-summary` protegido con `CRON_SECRET` (header `Authorization: Bearer <secret>` o `?secret=`)
- Query param `?test=true` envía solo un correo de prueba a `oliver@clienteenelcentro.com`
- Configuración de Vercel Cron en `vercel.json` con schedule `0 13 * * 1-6` (13:00 UTC = 8:00 AM Panamá, lunes a sábado, sin domingos)
- Envío via Resend (`notificaciones@integra-panama.com`) — a cada abogada activa del tenant
- Template HTML responsive con branding Integra (azul #1B2A4A, dorado #C5A55A), tablas con indicadores de urgencia, links directos al CRM
- Destinatarios en producción: todas las abogadas activas del tenant; admin y asistente NO reciben
- Nuevas dependencias: `resend`
- Nuevos archivos:
  - `src/app/api/cron/daily-summary/route.ts`
  - `src/lib/email/resend.ts`
  - `src/lib/email/daily-summary-template.ts`
  - `vercel.json`
- Variables de entorno nuevas: `RESEND_API_KEY`, `CRON_SECRET` (configurar en Vercel y `.env.local`)

## [1.6.3] — 2026-04-09
### Feature — Documentos clickeables: abrir y descargar
- Clic en cualquier documento adjunto lo abre en nueva pestaña (signed URL de Supabase, 5 min)
- Botón de descarga (ícono) al lado de cada documento
- Hover sutil y cursor pointer en cada fila de documento
- Spinner de carga mientras se obtiene la URL
- Nuevo componente reutilizable: `DocumentRow` (unifica vista de documento en casos y clientes)
- Nuevo endpoint: `GET /api/documents/[id]/url` — genera signed URL temporal
- Aplica en: documentos de casos y documentos de clientes

## [1.6.2] — 2026-04-09
### Feature — Eliminar documentos adjuntos en Casos y Clientes
- Nuevo botón de eliminar (ícono basura) en cada fila de documento adjunto
- Modal de confirmación muestra nombre del archivo y fecha de subida
- Al confirmar: elimina archivo de Supabase Storage + registro de BD
- Auditoría: registra quién eliminó, qué archivo, de qué caso/cliente
- Permisos: solo admin y abogada pueden eliminar; asistente NO ve el botón
- Aplica en: documentos de casos y documentos de clientes
- Nuevo endpoint: `POST /api/documents/[id]/delete`
- Nuevo componente: `DeleteDocumentButton`

## [1.6.1] — 2026-04-09
### Bugfix — Error 413 al subir archivos grandes (Vercel body limit)
- Todos los uploads de archivos ahora van DIRECTO a Supabase Storage desde el frontend
- Ya no pasan por API routes de Next.js (límite de Vercel 4.5MB)
- Componentes migrados: document-upload, comment-form, expense-actions, payment-actions, add-expense-form, section-expense-form, todo-list
- Nuevo utility: `src/lib/storage/direct-upload.ts` con XMLHttpRequest para barra de progreso
- Nuevo endpoint: `GET /api/storage/prepare` — retorna tenantId para construir paths
- Nuevos endpoints: `POST /api/documents/register`, `POST /api/todos/[id]/documents/register` — guardan metadata sin archivo
- Barra de progreso visible durante upload de documentos
- Validación de tamaño (10MB) y tipo de archivo en frontend antes de subir
- Import wizard (Excel/CSV) NO se migró — requiere procesamiento server-side y archivos pequeños
- SQL pendiente: `sql/pending/storage_rls_policies.sql` — políticas RLS para bucket "documents"

## [1.6.0] — 2026-04-09
### Bugfix — Búsqueda de casos por nombre de cliente
- La búsqueda en la lista de casos ahora busca en: código del caso, descripción, nombre del cliente, y código del cliente
- Búsqueda case-insensitive: buscar "carlos" encuentra "CARLOS ENRIQUE PULIDO"

### Feature — Rediseño del layout de gastos del caso
- Nueva organización en 2 secciones verticales: Trámite y Administrativo
- Cada sección agrupa sus gastos y pagos lado a lado con subtotales propios
- Subtítulos descriptivos en cada sección explican qué tipo de gastos corresponden
- Botones de "+ Gasto" y "+ Pago" dentro de cada sección (ya no en la parte superior)
- Tabla de Balance General al final con resumen por concepto (Trámite, Administrativo, Total)
- Balances positivos en verde, negativos en rojo
- Borde lateral de color para identificar cada sección visualmente
- Responsive: en móvil los gastos y pagos van uno debajo del otro

### Feature — Editar y Eliminar Pagos del Cliente
- Botón de editar (lápiz) en cada fila de pago: permite cambiar monto, descripción y fecha
- Botón de eliminar (basura) con confirmación: muestra descripción, monto y fecha antes de confirmar
- Adjuntar recibo a pagos: misma funcionalidad que gastos (JPG/PNG/PDF, máx 10MB)
- Ver recibo adjunto con URL firmada
- API endpoints: PATCH/DELETE /api/payments/[id], POST/DELETE /api/payments/[id]/receipt, GET /api/payments/[id]/receipt/url
- Permisos: solo admin y abogada pueden editar/eliminar pagos (asistente no)
- Auditoría: todos los cambios y eliminaciones se registran en audit_log
- Campo description agregado a pagos (nullable, opcional)
- SQL pendiente: sql/pending/add_payment_description_receipt.sql

## [1.5.0] — 2026-04-09
### Feature — Sort y Filtros en todos los listados

#### Balance General de Gastos (/abogada/gastos)
- Barra de búsqueda por caso, cliente o descripción
- Filtro por estado del caso
- Sort clickeable en todas las columnas (caso, cliente, estado, pagado, gastos, balance)
- Indicadores visuales de dirección (flechas)
- Totales se recalculan según filtros activos

#### Clientes (/abogada/clientes)
- Nuevo filtro por abogada responsable (dropdown)
- Componente ClientFilters reemplaza ClientListSearch con búsqueda + filtro combinados
- Botón "Limpiar" para resetear todos los filtros

#### Usuarios (/admin/usuarios)
- Barra de búsqueda por nombre o correo
- Filtro por rol (Administrador, Abogada, Asistente)
- Sort clickeable en columnas: Nombre, Correo, Rol, Estado
- Contador de resultados filtrados

#### Auditoría (/admin/auditoria)
- Sort clickeable en columnas: Fecha, Acción, Entidad (via SortableHeader)
- Se mantienen los filtros existentes (entity, user, action, dates)

#### Seguimiento (/abogada/seguimiento)
- Nuevo selector de ordenamiento: Más reciente, Por código, Más pendientes
- Ya tenía filtros por estado, asistente, y rango de fechas

#### Mis Pendientes (/abogada/pendientes)
- Barra de búsqueda por descripción
- Filtro por estado: Todos, Pendientes, Cumplidos
- Selector de ordenamiento: Más reciente, Por vencimiento, Alfabético
- Botón "Limpiar" filtros

#### Archivos nuevos
- `src/components/expenses/gastos-table.tsx` — Tabla de gastos con sort/filter/search
- `src/components/clients/client-filters.tsx` — Filtros de clientes (búsqueda + abogada)

#### Archivos modificados
- `src/app/(dashboard)/abogada/gastos/page.tsx` — Usa GastosTable con sort/filter
- `src/app/(dashboard)/abogada/clientes/page.tsx` — Usa ClientFilters, filtro por abogada
- `src/app/(dashboard)/admin/auditoria/page.tsx` — SortableHeader en columnas
- `src/app/(dashboard)/admin/usuarios/page.tsx` — (sin cambios, UserTable actualizado)
- `src/components/admin/user-table.tsx` — Búsqueda, filtro por rol, sort por columna
- `src/components/seguimiento/seguimiento-view.tsx` — Sort por reciente/código/pendientes
- `src/components/todos/todo-list.tsx` — Búsqueda, filtro estado, sort

#### Nota: Casos y Auditoría ya tenían sort/filtros completos. No se duplicó funcionalidad.

## [1.4.0] — 2026-04-09
### Feature — Editar/Eliminar Gastos + Adjuntar Recibos + Navegación Balance General

#### Editar Gastos
- Botón de editar (ícono lápiz) en cada fila de gasto (trámite y administrativo)
- Modal inline con campos precargados: monto, concepto, fecha
- Validación de campos antes de guardar
- Auditoría registra cada campo modificado (valor anterior → nuevo)
- Solo admin y abogada pueden editar (asistente NO)

#### Eliminar Gastos
- Botón de eliminar (ícono basura) en cada fila de gasto
- Modal de confirmación mostrando concepto, monto y fecha del gasto
- Si el gasto tiene recibo adjunto, se elimina también del storage
- Auditoría registra la eliminación completa
- Totales y balance se recalculan automáticamente
- Solo admin y abogada pueden eliminar

#### Adjuntar Recibo a Gastos
- Al crear gasto: campo opcional "Adjuntar recibo" (JPG, PNG, PDF, máx 10MB)
- En gastos existentes: ícono de clip para adjuntar/cambiar/ver recibo
- Recibos se almacenan en Supabase Storage: `{tenant_id}/gastos/{caso_id}/{gasto_id}/`
- Click en recibo adjunto abre el archivo en nueva pestaña (URL firmada)
- En edición: opción de eliminar recibo existente
- Columnas nuevas en tabla expenses: receipt_url, receipt_filename (SQL pendiente)

#### Navegación Balance General
- Toda la fila del Balance General de Gastos es clickeable (desktop y mobile)
- Click navega al detalle del caso, pestaña Gastos
- Cursor pointer y highlight al hover

#### Archivos nuevos
- `src/app/api/expenses/[id]/route.ts` — API PATCH/DELETE gastos
- `src/app/api/expenses/[id]/receipt/route.ts` — API POST/DELETE recibos
- `src/app/api/expenses/[id]/receipt/url/route.ts` — API GET URL firmada recibo
- `src/components/expenses/expense-actions.tsx` — Componente ExpenseRow con edit/delete/receipt
- `src/components/expenses/clickable-row.tsx` — Fila clickeable para tabla
- `sql/pending/add-receipt-to-expenses.sql` — SQL pendiente para columnas receipt

#### Archivos modificados
- `src/types/database.ts` — Agregado receipt_url, receipt_filename a Expense
- `src/app/(dashboard)/abogada/casos/[id]/page.tsx` — Usa ExpenseRow, incluye receipt fields en query
- `src/app/(dashboard)/abogada/gastos/page.tsx` — Filas clickeables con ClickableRow
- `src/components/cases/add-expense-form.tsx` — Campo de adjuntar recibo al crear gasto

## [1.3.0] — 2026-04-09
### Feature — Eliminar Casos y Clientes

#### Eliminar Caso
- Boton "Eliminar caso" (rojo, icono basura) en detalle del caso
- Solo visible para roles admin y abogada (asistente NO lo ve)
- Modal de confirmacion con doble seguridad: debe escribir el codigo exacto del caso
- Muestra detalles: codigo, cliente, descripcion
- Advertencia clara: se eliminan gastos, tareas, comentarios, documentos y pagos
- Eliminacion en cascada: storage + documents, comments, tasks, expenses, payments, case
- Registro en audit_log con datos del caso eliminado
- Redirige a lista de casos con toast de confirmacion

#### Eliminar Cliente
- Boton "Eliminar cliente" (rojo, icono basura) en detalle del cliente
- Solo visible para roles admin y abogada
- Si tiene casos asociados: modal informativo, boton deshabilitado, NO se puede eliminar
- Si NO tiene casos: requiere escribir codigo del cliente para confirmar
- Elimina documentos (storage + BD) y el cliente
- Registro en audit_log
- Redirige a lista de clientes con toast de confirmacion

#### Archivos nuevos
- `src/components/ui/delete-confirmation-modal.tsx` — Modal reutilizable con confirmacion por codigo
- `src/components/ui/delete-success-toast.tsx` — Toast de exito post-eliminacion
- `src/components/cases/delete-case-button.tsx` — Boton + modal para eliminar caso
- `src/components/clients/delete-client-button.tsx` — Boton + modal para eliminar cliente
- `src/app/api/cases/[id]/delete/route.ts` — API endpoint eliminacion de caso
- `src/app/api/clients/[id]/delete/route.ts` — API endpoint eliminacion de cliente

#### Archivos modificados
- `src/app/(dashboard)/abogada/casos/[id]/page.tsx` — Agrego DeleteCaseButton
- `src/app/(dashboard)/abogada/clientes/[id]/page.tsx` — Agrego DeleteClientButton
- `src/app/(dashboard)/abogada/casos/page.tsx` — Toast de eliminacion exitosa
- `src/app/(dashboard)/abogada/clientes/page.tsx` — Toast de eliminacion exitosa

## [1.2.1] — 2026-04-09
### Bugfix correctivo — 4 bugs de producción

#### Bug 0: Badge "Sin conexión" permanente
- El indicador de conexión mostraba "Sin conexión" permanentemente incluso con internet
- **Causa:** El ping inicial a `/api/health` fallaba durante la hidratación, marcando offline inmediatamente
- **Fix:** Se requieren 2 fallos consecutivos antes de mostrar offline. Cuando hay conexión, no se muestra badge (UX más limpia)

#### Bug 1: Clasificaciones duplicadas/triplicadas en dropdown
- El dropdown de clasificación mostraba hasta 3 entradas por clasificación
- **Fix frontend:** Deduplicación por prefijo en el componente CaseForm como red de seguridad
- **SQL pendiente:** `/sql/pending/fix-duplicate-classifications.sql` — limpia duplicados en BD, mantiene el más antiguo por prefijo, reasigna casos

#### Bug 2: Auto-numeración de código de expediente
- El campo mostraba "EXP-001" como placeholder sin importar la clasificación
- **Fix:** Sin clasificación seleccionada, el campo muestra "Selecciona clasificación primero". Al elegir clasificación, calcula el siguiente número correcto (ej: CORP-004)
- NO se modificaron códigos de casos existentes

#### Bug 3: Colores de clasificación
- Colores actualizados al Excel oficial del despacho
- **SQL pendiente:** `/sql/pending/update-classification-colors.sql`
- Frontend ya tiene los colores correctos en `classification-colors.ts`
- REGULATORIO usa texto oscuro (#1B2A4A), todas las demás texto blanco

#### Archivos SQL pendientes de ejecución manual:
1. `sql/pending/fix-duplicate-classifications.sql`
2. `sql/pending/update-classification-colors.sql`

---

## [1.2.0] — 2026-04-04
### Tres ajustes urgentes post-carga de datos reales

#### Numeración Editable
1. **N° Cliente editable:** Al crear un cliente, el sistema sugiere CLI-NNN pero la abogada puede cambiarlo. Validación de unicidad.
2. **Código de expediente editable:** Al crear un caso, el sistema sugiere PREFIX-NNN pero es editable. Validación de unicidad.

#### Gastos — Pagos clasificados
3. **Pagos del cliente por tipo:** Ahora se clasifican como "Pago para Trámite" o "Pago Administrativo". Balance calculado por separado: Balance Trámite, Balance Administrativo, Balance Total.
4. **Nueva migración:** `20260404000002_payment_type.sql` — agrega `payment_type` a `client_payments`.

#### Mis Pendientes — Funcionalidad completa
5. **Adjuntar documentos:** Botón "Adjuntar" en cada pendiente para subir archivos via Supabase Storage.
6. **Asignar a equipo:** Dropdown opcional "Asignar a" al crear un pendiente. El asignado ve el pendiente en su propia lista con badge "Asignado por [nombre]". El creador ve "Asignado a [nombre]".

---

## [1.1.0] — 2026-04-04
### Correcciones y mejoras basadas en feedback de abogadas

#### Correcciones Criticas
1. **Estados de caso simplificados:** Solo "En trámite" y "Cerrado". Eliminado "Activo" con migración automática.
2. **Fix timezone en fechas:** Fechas de apertura ya no muestran un día antes (fix de conversión UTC vs Panama).
3. **Formato de fecha global:** DD/MM/AAAA en toda la aplicación sin excepción.
4. **Eliminar duplicidad Entidad/Institución:** Removido campo "Entidad", solo se usa "Institución" con opción "+ Agregar nueva" inline.

#### Diseño Visual
5. **Colores por clasificación:** CORPORATIVO=Azul, REGULATORIO=Verde, MIGRACIÓN=Naranja, LABORAL=Morado, PENAL=Rojo, CIVIL=Teal, ADMINISTRATIVO=Gris. Badges con color en listados.
6. **Dashboard rediseñado:** Solo gráficas y tarjetas KPI (5 tarjetas grandes), donut de clasificaciones con colores, barras de progreso, alertas de deadlines en rojo/naranja, saldos en contra, tareas vencidas.
7. **Transiciones suaves:** Cards y nav items con transiciones hover/active.

#### Gastos — Rediseño
8. **Dos tipos de gastos:** "Gastos del Trámite" y "Gastos Administrativos" (default B/.21.50 editable). Balance visible con 4 tarjetas: trámite, administrativo, pagado por cliente, diferencia. Rojo si negativo, verde si positivo.

#### Casos — Mejoras
9. **Responsables separados:** "Abogada Responsable" y "Asistente Responsable" como dropdowns separados.
10. **Botones de seguimiento intuitivos:** Dos botones grandes: checklist + "Nueva Tarea para Asistente", mensaje + "Agregar Comentario/Seguimiento". Expandibles con formularios inline.
11. **Tarjeta de expediente imprimible:** Botón "Imprimir Tarjeta" genera etiqueta media carta con branding Integra, color de clasificación, datos del caso.

#### Clientes — Mejoras
12. **Listado simplificado:** Sin teléfono. Carpetitas con colores: total, en trámite, cerrados por cliente.
13. **Crear caso desde cliente:** Pre-selecciona el cliente automáticamente.
14. **Tipo "Retainer":** Nuevo tipo de cliente con badge dorado para contratos continuos.

#### Asistente — Simplificado
15. **Solo ver, comentar y cumplir:** Removidos botones de gastos y adjuntar documentos. Comentario inline. Modal para "Marcar Cumplida" con comentario opcional y fecha auto. Botón "Info del Caso".

#### Seguimiento
16. **Filtros avanzados:** Filtro por asistente, por estado (pendientes/cumplidas/todas/comentarios), por rango de fechas (desde-hasta). Aplicación inmediata.

#### Mis Pendientes
17. **Mejoras:** Fecha de vencimiento opcional con label claro. Muestra "Creado:" y "Vence:" o "Sin fecha límite". Completados siempre visibles abajo con tachado (no colapsados).

#### Admin
18. **Acceso completo:** Admin ve Mis Pendientes y Prospectos en sidebar.

#### Performance
19. **Optimizaciones:** Tree-shaking de lucide-react, formatos AVIF/WebP.

#### Datos
20. **SQL para datos reales:** Script generado para cargar 23 clientes y 46 casos reales del Excel. Limpieza de datos ficticios. Archivo: `scripts/load_real_data.sql`.

#### Migraciones SQL pendientes
- `supabase/migrations/20260404000001_v1_1_feedback_changes.sql`: Requiere ejecución en Supabase para: simplificar estados, agregar expense_type, agregar color a clasificaciones, agregar assigned_to a personal_todos, limpiar datos ficticios.
- `scripts/load_real_data.sql`: Requiere reemplazar TENANT_ID_HERE y ejecutar después de la migración.

---

## [1.0.0] — 2026-04-03
### Nuevas funcionalidades mayores (6 features)

#### 1. Login — Mejoras
- **Recuperar contraseña:** nuevo enlace "¿Olvidaste tu contraseña?" que envía email vía Supabase Auth
- **Título actualizado:** "Sistema de Gestión de Casos" → "Gestión Legal Integral"

#### 2. Mis Pendientes — To-Do personal para abogadas
- **Nueva sección** en sidebar: "Mis Pendientes" (solo rol abogada)
- Crear tareas personales con descripción y fecha límite opcional
- Marcar como pendiente/cumplida (toggle)
- Eliminar pendientes
- Agregar comentarios expandibles a cada pendiente
- Detección de vencidas con resaltado rojo
- Sección colapsable de cumplidas
- **Privacidad:** cada abogada solo ve sus propios pendientes
- API: `/api/todos` (GET, POST), `/api/todos/[id]` (PATCH, DELETE), `/api/todos/[id]/comments` (GET, POST)

#### 3. Pipeline de Prospectos
- **Nueva sección** en sidebar: "Prospectos" (solo rol abogada)
- Crear prospectos con: nombre, teléfono, email, servicio de interés, notas, fecha de contacto
- **5 etapas del pipeline:** Contacto Inicial → Propuesta Enviada → En Negociación → Ganado → Perdido
- **Vista Kanban** con columnas scrolleables por etapa
- **Vista Lista** como alternativa
- Mover prospectos entre etapas con botones de acción
- Agregar notas de seguimiento (comentarios) por prospecto
- **"Crear como Cliente"**: al ganar un prospecto, bot��n que auto-crea registro en `clients` y redirige al detalle del cliente
- API: `/api/prospects` (GET, POST), `/api/prospects/[id]` (PATCH, DELETE), `/api/prospects/[id]/comments` (GET, POST), `/api/prospects/[id]/convert` (POST)

#### 4. Importación Masiva — Separar clientes y casos
- Página dividida en dos secciones independientes: "Importar Clientes" + "Importar Casos"
- Indicador visual de flujo recomendado: "Paso 1: Clientes → Paso 2: Casos"
- Cada sección con su propia plantilla descargable
- API acepta parámetro `importType` para filtrar filas
- Casos requieren que el cliente exista previamente

#### 5. Adjuntos en tareas y comentarios
- **Tareas:** bot��n de clip (📎) en cada tarea pendiente para adjuntar documentos
- **Comentarios:** link "Adjuntar archivo" en el formulario de comentarios — archivos se suben vinculados al comentario
- Funciona para ambos roles: abogadas y asistentes
- `documents.entity_type` extendido a: client, case, task, comment

#### 6. Migraciones SQL requeridas
- `supabase/migrations/20260403000012_todos_and_prospects.sql` — 6 tablas nuevas (personal_todos, todo_comments, todo_documents, prospects, prospect_comments, prospect_documents)
- `supabase/migrations/20260403000013_extend_document_entity_types.sql` — extiende CHECK constraint de documents

### Técnico
- 12 nuevos API routes
- 3 nuevos componentes: TodoList, ProspectPipeline, templates separadas
- TypeScript types: PersonalTodo, TodoComment, TodoDocument, Prospect, ProspectComment, ProspectDocument, ProspectStatus
- Sidebar: 2 nuevos items (Mis Pendientes, Prospectos) para rol abogada

## [0.9.3] — 2026-04-03
### Ajustes de testing — UX del asistente (5 cambios)

#### Adjuntos en seguimiento y tareas
- **Asistente — Documentos:** sección de documentos en detalle de caso ahora funcional (antes era placeholder "Próximamente")
- **DocumentUpload** habilitado para asistentes en sus casos asignados
- **Lista de documentos** muestra nombre de archivo y timestamp en detalle del caso

#### Datos ficticios completos
- **SQL:** `supabase/migrations/20260403000011_fill_clients_and_documents.sql`
- Completa TODOS los clientes (CLI-001 a CLI-023) con teléfono, email, RUC, tipo, dirección, fecha de cliente y observaciones
- Inserta 4-6 documentos ficticios por caso (contratos, poderes, recibos, identificaciones)
- Inserta 1 documento por cliente (cédula, RUC, cartas de autorización)
- **Pendiente:** ejecutar SQL en Supabase SQL Editor

#### Dashboard asistente simplificado
- Eliminada lista de tareas pendientes del dashboard
- Dashboard ahora muestra SOLO las 3 tarjetas KPI: Casos Asignados, Tareas Pendientes, Tareas Cumplidas

#### Menú asistente simplificado
- Eliminado "Mis Casos" del sidebar y bottom-nav
- Asistente ahora solo tiene: Dashboard + Mis Tareas
- Bottom-nav reducido a 2 botones (Inicio, Tareas)

#### Mis Tareas — agrupado por caso
- Tareas reorganizadas y agrupadas por caso (header con código + cliente)
- Dentro de cada caso: pendientes primero (por deadline), cumplidas después
- Cada tarea pendiente tiene botones: Marcar Cumplida, Comentar, Adjuntar
- Casos con tareas pendientes aparecen primero en la lista

## [0.9.2] — 2026-04-03
### Ajustes de testing (8 correcciones)

#### Bugs corregidos
- **Casos vacíos (crítico):** queries usaban `cat_team` JOIN pero FK ya apunta a `users` — reemplazado en 8 archivos
- **Asistente tareas error:** `onClick` pasado a Server Component — removido, migrado a `getAuthenticatedContext`
- **Navegación atrás:** botón atrás hardcodeado — creado `BackButton` con `router.back()` + fallback en 5 páginas

#### Mejoras
- **Seguimiento:** buscador, filtros (todos/pendientes/cumplidas/comentarios), casos colapsados por defecto con contadores
- **Dashboard asistente:** tareas clickeables que llevan al caso con tab seguimiento
- **Datos ficticios:** SQL para completar todos los campos de clientes y casos + 7 clientes nuevos sin expedientes

#### SQL pendiente de ejecutar
- `supabase/migrations/20260403000010_complete_demo_data.sql`

## [0.9.1] — 2026-04-03
### Fix crítico: reemplazar cat_team por users en todas las queries
- **Bug:** "0 casos encontrados" causado por queries que usaban `cat_team` JOIN cuando el FK ya apunta a `users`
- **Fix:** Reemplazado `cat_team(id, name)` → lookup directo a `users` en: lista de casos, detalle de caso, nuevo caso, editar caso, asistente casos, asistente dashboard, asistente gastos
- **Filtros:** Dropdown de "Responsable" ahora usa tabla `users` (rol abogada/asistente)
- **Asistente:** Access check usa `assistant_id` en vez de `cat_team.user_id`

## [0.9.0] — 2026-04-03
### Sección Seguimiento (antes Tareas)
- **Nueva página `/abogada/seguimiento`:** vista global de tareas y comentarios de todos los casos, agrupados por caso
- **Renombrado:** "Tareas" → "Seguimiento" en sidebar, bottom-nav, y dashboards
- **Hilo cronológico:** muestra tareas (pendientes/cumplidas/vencidas) y comentarios con fechas de seguimiento
- **Redirect:** `/abogada/tareas` redirige automáticamente a `/abogada/seguimiento`

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
