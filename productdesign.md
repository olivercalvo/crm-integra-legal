# PRODUCTDESIGN.MD — CRM INTEGRA LEGAL

## VISIÓN
CRM web multi-tenant para bufetes de abogados en Panamá. MVP para Integra Legal. Profesionaliza la gestión de clientes, expedientes, gastos, tareas y documentos. Reemplaza archivo Excel actual. Diseñado para uso en campo (asistentes) y oficina (abogadas).

## USUARIOS TARGET
- **Abogadas/Socias:** Daveiva y Milena — gestionan clientes y expedientes desde oficina
- **Asistentes:** trabajan en campo, consultan casos, registran gastos y avances desde celular
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
**Roles:** Admin, Abogada (CRUD completo), Asistente (ver asignados, actualizar estado)

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
**Roles:** Admin, Abogada (todo), Asistente (registrar gastos ejecutados en sus casos)

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
- Asistentes registran gastos desde campo (funciona offline)

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
- Asistente ve sus tareas pendientes en su dashboard
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

**Contenido:**
- Casos asignados al asistente logueado
- Tareas pendientes con fecha límite
- Acceso directo a cada caso para: actualizar estado, registrar gastos, cumplir tareas, agregar comentarios, subir documentos
- Información completa del caso y cliente asociado visible

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

## REQUERIMIENTOS NO FUNCIONALES

- **Mobile-first:** diseñado primero para celular, funciona en desktop
- **Foolproof UI:** botones 48px+, iconos+texto, max 3 taps/tarea, wizard max 5 campos/pantalla
- **Acceso web:** sin instalar app, funciona en navegador
- **Multi-tenant:** aislamiento por RLS desde día 1
- **Branding:** azul marino #1B2A4A, dorado #C5A55A, blanco #FFFFFF, serif profesional, logo Integra
- **Performance:** paginación y búsqueda indexada (crecimiento a cientos de registros en el próximo año)
