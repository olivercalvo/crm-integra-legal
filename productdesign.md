# PRODUCTDESIGN.MD — CRM INTEGRA LEGAL

## VISIÓN
CRM web multi-tenant para bufetes de abogados en Panamá. MVP para Integra Legal. Profesionaliza la gestión de clientes, expedientes, gastos, tareas y documentos. Reemplaza archivo Excel actual. Diseñado para uso en campo (asistentes) y oficina (abogadas).

## USUARIOS TARGET
- **Abogadas/Socias:** Daveiva y Milena — gestionan clientes y expedientes desde oficina
- **Asistentes:** trabajan en campo, consultan casos y dejan constancia desde el celular — comentarios y documentos adjuntos. Registrar gastos dejó de ser suyo el 24/08/2026 (ver F-003 y F-007)
- **Admin:** gestión de usuarios, catálogos y configuración del tenant

---

## FEATURES

### F-001: Gestión de Clientes
**Prioridad:** P0 (MVP)
**Roles:** Admin, Abogada

**Campos:**
- N° Cliente (auto-generado, formato `CLI-NNN`)
- Nombre / Razón Social (obligatorio)
- RUC / Cédula
- Tipo (del catálogo de clasificaciones)
- Contacto Principal
- Teléfono
- Correo
- Observaciones
- Documentos adjuntos (multi-archivo)

**Funcionalidad:**
- Crear, editar, desactivar clientes (soft delete)
- Vincular múltiples expedientes a un cliente
- Búsqueda rápida por nombre, RUC o N° Cliente
- Adjuntar documentos de cualquier tipo (PDF, Word, imágenes, escaneos)
- Vista de todos los expedientes del cliente desde su perfil

---

### F-002: Gestión de Casos
**Prioridad:** P0 (MVP)
**Roles:** Admin, Abogada (CRUD completo), Asistente (ve TODOS los casos del bufete en SOLO LECTURA; dentro de un caso únicamente comenta y sube documentos)

**Campos:**
- N° Caso (auto-generado secuencial)
- Código Caso (prefijo de clasificación + secuencial, ej. `CORP-001`, `MIG-002`)
- Cliente vinculado (obligatorio)
- Descripción del Asunto
- Clasificación (del catálogo)
- Institución donde se tramita (del catálogo)
- Responsable (del catálogo de equipo)
- Entidad (texto libre)
- Tipo de trámite (texto libre)
- N° trámite en la institución
- N° caso en la institución
- Fecha Apertura (date picker, DD/MM/AAAA)
- Fecha inicio del caso (date picker, DD/MM/AAAA) + días transcurridos (calculado)
- Fecha inicio del trámite (date picker, DD/MM/AAAA) + días transcurridos (calculado)
- Fecha tope (date picker, DD/MM/AAAA) — alerta roja si vencida
- Estado (del catálogo: Activo / En trámite / Cerrado)
- Ubicación Física (texto libre)
- Observaciones
- Archivo Digital (flag sí/no)
- Documentos adjuntos (multi-archivo)
- Último seguimiento (auto — se actualiza al agregar comentario) + días transcurridos
- Gastos cobrados al cliente (calculado, suma de pagos)
- Gastos incurridos (calculado, suma de gastos)
- Diferencia (calculado, ROJO si negativo)

**Funcionalidad:**
- Crear, editar, cerrar casos vinculados a un cliente
- Wizard de 4 pasos para crear/editar
- Historial completo de cambios de estado (fecha, usuario, estado anterior → nuevo)
- Filtrar por: estado, clasificación, responsable, cliente, institución
- Búsqueda por código, descripción, cliente
- Adjuntar documentos al caso
- Sección de comentarios/avances con fecha de seguimiento (ver F-005)

---

### F-003: Control de Gastos por Expediente
**Prioridad:** P0 (MVP)
**Roles:** Admin, Abogada (todo). **El Asistente quedó fuera de Gastos el 24/08/2026** — no los ve ni los registra

**Campos gasto:**
- Fecha
- Monto
- Concepto / descripción
- Registrado por (auto — usuario logueado)
- Expediente vinculado

**Campos monto cliente:**
- Monto pagado por el cliente para el expediente
- Fecha de pago

**Funcionalidad:**
- Registrar monto pagado por el cliente
- Registrar gastos ejecutados uno a uno
- Balance en tiempo real: pagado vs. ejecutado = saldo
- **Visual:** saldo en contra (gastos > pagado) se muestra en ROJO en dashboard y detalle
- ~~Asistentes registran gastos desde campo~~ — retirado el 24/08/2026 por decisión del cliente. Gastos es admin/abogada

---

### F-004: Tareas por Expediente
**Prioridad:** P0 (MVP)
**Roles:** Admin, Abogada (crear/asignar), Asistente (ver/cumplir asignadas)

**Campos:**
- Descripción
- Fecha límite
- Asistente asignado
- Estado (Pendiente / Cumplida)
- Expediente vinculado
- Creada por (auto)
- Fecha cumplimiento (auto al marcar cumplida)

**Funcionalidad:**
- Abogadas crean tareas dentro de un expediente y asignan a asistente
- Asistente ve sus tareas pendientes en su dashboard (no las crea: desde el 24/08/2026 crear y asignar tareas es admin/abogada)
- Asistente marca tareas como cumplidas
- Abogadas ven estado de cumplimiento de todas las tareas que asignaron
- Sin notificaciones para MVP — solo visual en dashboard

---

### F-005: Comentarios / Bitácora
**Prioridad:** P0 (MVP)
**Roles:** Admin, Abogada, Asistente

**Campos:**
- Texto del comentario
- Fecha y hora (auto)
- Usuario (auto)
- Expediente vinculado

**Funcionalidad:**
- Agregar comentarios a un expediente
- Hilo cronológico visible para todos los roles
- **Comentarios NO se pueden eliminar ni editar** (trazabilidad legal)

---

### F-006: Dashboard Abogada
**Prioridad:** P0 (MVP)
**Roles:** Admin, Abogada

**Contenido:**
- Total expedientes activos / en trámite / cerrados
- Tareas pendientes asignadas (resumen)
- Expedientes con saldo en contra (ROJO)
- Expedientes recientes (últimos modificados)
- Acceso rápido a crear cliente / expediente

---

### F-007: Dashboard Asistente
**Prioridad:** P0 (MVP)
**Roles:** Asistente

**Contenido:** 3 tarjetas

| Tarjeta | Qué cuenta | Enlaza a |
|---|---|---|
| **Casos del Bufete** | TODOS los casos del tenant, sin filtrar por asistente | `/legal/casos` |
| **Tareas Pendientes** | Tareas con `assigned_to` = usuario y estado `pendiente` | `/legal/pendientes` |
| **Tareas Cumplidas** | Tareas con `assigned_to` = usuario y estado `cumplida` | `/legal/pendientes` |

**Por qué "Casos del Bufete" es la tarjeta principal:** el alcance de lectura del asistente
es todo el bufete (igual que la abogada) y `/legal/casos` nunca filtró por asistente. El
panel antiguo mostraba solo "Casos Asignados", y como ningún caso tenía asistente asignado
el asistente veía 0 y concluía que el sistema no le mostraba nada. Era un problema de UI,
no de permisos. Lo único personal del panel son sus TAREAS.

- Acceso directo a cada caso para: actualizar estado, registrar gastos, cumplir tareas, agregar comentarios, subir documentos
- Información completa del caso y cliente asociado visible

**Selector de "Abogada Responsable" filtrado por rol** (aplica a detalle de caso, crear y
editar): solo lista usuarios con rol `abogada`, no todos los usuarios activos. Si la lista
queda vacía, el selector igual ofrece "Sin responsable". La asignación de **tareas** sigue
aceptando cualquier usuario activo (no se filtra por rol).

**El campo "Asistente Responsable de Seguimiento" ya no existe en la interfaz** (22/08/2026).
Si el asistente ve todos los casos del bufete, asignar uno por caso no aporta. Se retiró de
crear/editar caso, del editor inline, del display del detalle, de la columna "Asistente" del
listado y de `PATCH /api/cases/[id]`. La columna `cases.assistant_id` **se conserva en la BD**
(regla aditiva): el cambio es solo de UI y por lo tanto reversible sin migración. Como
consecuencia, `/legal/gastos` del asistente ofrecía TODOS los casos del tenant en su selector
— pantalla que dejó de existir para él dos días después (ver abajo).

#### Alcance del rol asistente — recorte del 24/08/2026

Decisión de negocio del cliente. El asistente pasa a ser un rol de **consulta y constancia**:
mira todo, cambia poco.

| Puede | No puede |
|---|---|
| Ver Dashboard, Casos (todos, solo lectura) y Mis Pendientes | Ver o registrar gastos |
| **Subir documentos** a un caso | Cambiar el estado de un caso |
| **Comentar** en un caso | Editar, crear o borrar casos y clientes |
| Cumplir tareas asignadas a él | **Crear o asignar tareas** |
| — | Entrar a Finanzas |

**Por qué tampoco crea tareas** (ampliación del 24/08/2026): el selector "Asignar a" del
formulario lista a TODOS los usuarios activos, así que un asistente podía asignarle trabajo a
las socias. Se le retira el botón "+ Nueva Tarea para Asistente" del tab Seguimiento. Cumplir
tareas sigue siendo suyo — es su flujo diario — pero **solo las asignadas a él**: el handler
va por propiedad, no por rol. Para dejarse un recordatorio en un caso, usa un comentario.

Lo que se retiró de su UI: el ítem "Gastos" del menú, la pantalla `/legal/gastos` completa
(le rebota a `/legal` desde el middleware), el tab "Gastos" del detalle de caso — con
`?tab=gastos` normalizado a `info` para que la URL a mano tampoco sirva — y el botón de
cambiar estado.

**Esto NO es cosmético.** Cada restricción tiene un guard server-side: `/api/expenses`
(POST, PATCH, DELETE) y `PATCH /api/cases/[id]` responden **403** al rol asistente. Antes del
cambio, `POST /api/expenses` no validaba rol en absoluto — un asistente podía crear un gasto
llamando la API directamente aunque el menú no se lo ofreciera. Era el hallazgo #3 de la
revisión OWASP del proyecto (autorización por rol inconsistente en `/api`), y este sprint lo
cierra para gastos.

---

### F-008: Documentos Adjuntos
**Prioridad:** P0 (MVP)
**Roles:** Admin, Abogada, Asistente

**Funcionalidad:**
- Subir archivos de cualquier tipo vinculados a cliente o expediente
- Metadatos: nombre archivo, fecha carga, usuario que subió
- Visualizar y descargar desde detalle de cliente o expediente
- Storage: Supabase Storage
- Límites: los que Supabase Storage permita, ajustable después

---

### F-009: Carga Masiva (Batch Import)
**Prioridad:** P0 (MVP)
**Roles:** Admin, Abogada

**Funcionalidad:**
- Importar clientes y expedientes desde Excel/CSV
- Formato compatible con estructura actual (hojas CLIENTES y REGISTRO MAESTRO)
- Validación previa: campos obligatorios, duplicados por N° Cliente o RUC, códigos repetidos
- Resumen pre-importación: registros OK, con errores, duplicados
- Confirmar antes de ejecutar la carga
- Descargar plantilla de importación con formato correcto

**Migración inicial:**
- 23 clientes + 46 expedientes del Excel actual
- Limpieza automática: normalizar fechas (4 formatos), trim espacios, unificar aliases (Dave→Daveiva, Mile→Milena), eliminar filas vacías placeholder

---

### F-010: Catálogos Editables
**Prioridad:** P0 (MVP)
**Roles:** Admin

**Catálogos:**
- Clasificaciones (CORPORATIVO/CORP, MIGRACIÓN/MIG, LABORAL/LAB, PENAL/PEN, CIVIL/CIV, ADMINISTRATIVO/ADM, REGULATORIO/REG) — con prefijo y descripción
- Estados (Activo, En trámite, Cerrado)
- Instituciones (Registro Público, MICI, MINSA, Migración, Municipio, etc.)
- Responsables / Equipo

**Funcionalidad:**
- CRUD en cada catálogo
- No permitir eliminar si hay registros vinculados (soft delete o bloqueo)
- Cada catálogo es por tenant (multi-tenant)

---

### F-011: Audit Log
**Prioridad:** P0 (MVP)
**Roles:** Admin (consulta)

**Funcionalidad:**
- Registrar TODA operación CRUD en todas las entidades
- Campos: timestamp, usuario, tenant, entidad, registro_id, acción (create/update/delete), campo modificado, valor anterior, valor nuevo
- Inmutable — no se puede editar ni eliminar
- Consultable con filtros por entidad, usuario, fecha

---

### F-012: Autenticación y Sesiones
**Prioridad:** P0 (MVP)

**Funcionalidad:**
- Login con email + password (Supabase Auth)
- "Recordarme" guarda solo el email, SIEMPRE pide password
- Timeout de sesión: 8 horas de inactividad
- Asignación de rol por usuario
- Multi-tenant: usuario pertenece a un tenant

---

### F-013: Offline-First / Sincronización
**Prioridad:** P0 (MVP)

**Funcionalidad:**
- Cola persistente en IndexedDB para toda operación de escritura
- Detección automática de conectividad
- Sync automática al reconectar
- Resolución de conflictos por timestamp (last-write-wins con merge inteligente)
- Indicador visual de estado: online / offline / sincronizando
- **GARANTÍA: cero pérdida de datos bajo cualquier circunstancia**
- Retry con backoff exponencial
- Los datos se persisten localmente hasta confirmación del servidor

---

### F-014: Infraestructura de Exportación
**Prioridad:** P1 (estructura lista, reportes específicos TBD)

**Funcionalidad:**
- Capacidad de exportar a PDF y Excel
- Reportes específicos se definen después con feedback de las socias
- Arquitectura lista para agregar reportes sin refactorizar

---

### F-015: Mis Pendientes (To-Do Personal)
**Prioridad:** P1
**Roles:** Abogada

**Funcionalidad:**
- Tareas personales (to-dos) privadas por abogada
- Cada pendiente tiene: descripción, fecha límite, estado (pendiente/cumplida), comentarios
- Marcar como completado registra fecha de cierre automáticamente
- Eliminar pendientes
- Una abogada NO puede ver los pendientes de la otra
- API: /api/todos (CRUD), /api/todos/[id]/comments

---

### F-016: Pipeline de Prospectos
**Prioridad:** P1
**Roles:** Abogada

**Campos:**
- Nombre (obligatorio)
- Teléfono
- Correo electrónico
- Servicio de interés
- Notas
- Fecha de contacto

**Pipeline (5 etapas):**
1. Contacto Inicial
2. Propuesta Enviada
3. En Negociación
4. Ganado
5. Perdido

**Funcionalidad:**
- Vista Kanban con columnas por etapa
- Vista lista como alternativa
- Mover prospectos entre etapas
- Comentarios de seguimiento por prospecto
- Adjuntar documentos a prospectos
- Botón "Crear como Cliente" al ganar: crea registro en clients y redirige al detalle
- Todo filtrado por tenant_id
- API: /api/prospects (CRUD), /api/prospects/[id]/comments, /api/prospects/[id]/convert

---

## REQUERIMIENTOS NO FUNCIONALES

- **Mobile-first:** diseñado primero para celular, funciona en desktop
- **Foolproof UI:** botones 48px+, iconos+texto, max 3 taps/tarea, wizard max 5 campos/pantalla
- **Acceso web:** sin instalar app, funciona en navegador
- **Multi-tenant:** aislamiento por RLS desde día 1
- **Branding:** azul marino #1B2A4A, dorado #C5A55A, blanco #FFFFFF, serif profesional, logo Integra
- **Performance:** paginación y búsqueda indexada (crecimiento a cientos de registros en el próximo año)
