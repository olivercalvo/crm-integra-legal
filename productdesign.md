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

### PLAN DE CUENTAS — NIIF 18 (Fase 1 contable)

NIIF 18 es obligatoria desde el **1 de enero de 2027** y reemplaza a NIC 1. Clasifica
ingresos **y** gastos por ACTIVIDAD. Como el modulo contable se esta construyendo ahora, se
construye ya con la norma nueva en vez de rehacerlo en diciembre.

**Seis tipos de cuenta** (antes cinco): Activo, Pasivo, Patrimonio, Ingreso, **Costo**,
Gasto. `costo` era una subcategoria dentro de gasto y paso a ser un tipo propio.

**Nueve subcategorias de resultado** = 3 naturalezas x 3 actividades:

| | Operacion | Inversion | Financiamiento |
|---|---|---|---|
| **Ingresos** | Ingresos Operativos | Ingresos de Inversion | Ingresos por financiamiento |
| **Costos** | Costos Operativos | Costos de Inversion | Costos por financiamiento |
| **Gastos** | Gastos Operativos | Gastos por Inversion | Gastos por financiamiento |

- **El selector se filtra por tipo.** Las nueve aparecen solo cuando la cuenta es Ingreso,
  Costo o Gasto. En cuentas de balance siguen las de siempre (activo corriente, no
  corriente, propiedad planta y equipo, pasivo corriente, no corriente, patrimonio, otro).
- **Obligatoria en cuentas de resultado activas.** Sin subcategoria el Estado de Resultado
  no puede ubicar la cuenta en su bloque de actividad.
- Las cuentas inactivas quedan exentas (las 34 viejas de QuickBooks la tienen en NULL).

**Cuenta control:** marca opcional (`clientes` / `proveedores`) que indica que el saldo de la
cuenta debe cuadrar contra el detalle del auxiliar correspondiente.

**Permisos del plan de cuentas:**

| Accion | Admin | Contador | Abogada |
|---|---|---|---|
| Crear cuenta | SI | SI | SI |
| Renombrar / describir / cargar saldo | SI | SI | SI |
| Cambiar tipo o subcategoria | SI | SI | **NO (403)** |
| Cambiar tipo/subcategoria de cuenta CON movimientos | **NO (409)** | **NO (409)** | NO |
| Desactivar cuenta CON movimientos | **NO (409)** | **NO (409)** | NO |

La ultima regla no distingue rol a proposito: reclasificar o apagar una cuenta que ya tiene
asientos reescribe retroactivamente reportes de periodos que el contador ya certifico.

---

### ESTADO DE RESULTADO — estructura NIIF 18

Reemplaza al formato viejo (INGRESOS / COSTOS / GASTOS planos). Es el modelo textual que
mando Josuar:

```
ACTIVIDAD DE OPERACION
  Ingresos operativos ............ (subtotal)
  Costos operativos .............. (subtotal)
  ► Utilidad Bruta operativa
  Gastos operativos .............. (subtotal)
  ► Utilidad Operativa
ACTIVIDAD DE INVERSION           (bloque, solo si hay cuentas)
ACTIVIDAD DE FINANCIAMIENTO      (bloque, solo si hay cuentas)
► Utilidad antes de impuesto sobre la renta
  Impuesto sobre la renta
► Utilidad Neta
DISTRIBUCION A SOCIAS            (sociedad civil)
► Resultado del ejercicio = 0
```

- **Los bloques sin cuentas no se muestran.** Un grupo vacio dentro de un bloque tampoco
  imprime su subtotal.
- **Convencion de signos del reporte**: ingresos en positivo, costos y gastos entre
  parentesis. Es la INVERSA de la balanza de comprobacion y del Balance General, donde los
  saldos van tal cual y los creditos salen negativos. Los dos reportes lo aclaran al pie.
- El toggle "solo cuentas con saldo" esconde unicamente renglones de cuenta en 0; los
  encabezados, subtotales y resultados se quedan siempre y los totales son identicos en las
  dos vistas.

**Sociedad civil.** Integra no paga impuesto sobre la renta a nivel de empresa: reparte el
resultado a las socias y cada una paga su renta personal (15%). Por eso el impuesto va en 0
y el ejercicio cierra en cero. La tasa de ISR y la distribucion son PARAMETROS del reporte,
pensados para poder vender el sistema a sociedades anonimas, que si lo pagan.

Cuenta de destino: **`300004 Distribucion a Socias`** (patrimonio), PROVISIONAL hasta que
la confirme el contador.

**Fecha del saldo inicial.** Cada cuenta guarda a que DIA corresponde su saldo de apertura.
Es obligatoria en cuanto el saldo no es 0 y se descarta cuando la cuenta abre en cero. Periodo
fiscal: 1 de enero a 31 de diciembre.

### LIBRO MAYOR — trazabilidad del saldo al documento

El requisito que Josuar repitió tres veces: desde un saldo de un reporte hay que poder llegar
al documento que lo originó. Se resolvió en dos saltos, cada uno un clic.

**Nivel 1 — del reporte al mayor.** El código y el nombre de cada cuenta del Balance General y
del Estado de Resultado enlazan al mayor de esa cuenta. El enlace va en el código y el nombre,
**no en el monto**: el monto se lee y se compara, y volverlo clickeable invita a seleccionarlo
sin querer. Los renglones estructurales del ER (la distribución a socias) no llevan enlace
porque no vienen del plan de cuentas.

**Nivel 2 — del mayor al documento.** Cada renglón enlaza a lo que lo originó:

| Origen del asiento | Lleva a |
|---|---|
| Factura / nota de crédito | el detalle de la factura |
| Gasto del bufete | el detalle del gasto |
| Pago | **la factura que canceló** (los pagos no tienen pantalla propia: viven en el detalle) |
| Reversión de un cobro | **la misma factura** — el espejo comparte `source_id` con el asiento del cobro y se resuelve por `payment_reversals` (17/09/2026) |
| Asiento de diario, apertura, otras reversiones | nada — no tienen documento de origen |

Un pago aplicado a varias facturas no tiene destino único, así que se queda sin enlace. Y
antes de ofrecer un enlace se verifica que el documento **exista**: el asiento es inmutable y
su `source_id` puede haber quedado apuntando a algo que se borró. **Un enlace que lleva a una
pantalla vacía es peor que no tener enlace: hace dudar del reporte entero.** Lo que no se
puede resolver se muestra como número de asiento sin enlace.

**La pantalla.** Columnas y orden del modelo de Josuar: fecha · tipo de transacción · número ·
nombre · descripción · cuenta de contrapartida · importe · saldo. Cada cuenta abre con una fila
**Saldo inicial** —siempre, aunque sea 0, porque su ausencia haría parecer que la cuenta abrió
en cero cuando quizá abrió sin cargar— y cierra con el neto del período **y** el saldo final,
rotulados por separado.

**Tres decisiones abiertas del contador**, cada una aislada a una sola función para que
contestarlas sea cambiar un lugar y no rastrear el criterio por media pantalla:

1. **Contrapartida ambigua.** Cuando el asiento tiene más de una cuenta del lado opuesto hoy
   se muestra "Varios" con un asterisco y su explicación al pie.
2. **Qué va en el recuadro del pie.** En el modelo de Josuar es el NETO de movimientos, no el
   saldo final; el requisito escrito decía solo "cierra con su total". Se muestran los dos.
3. **Signo del importe.** Hoy es convención de balanza (débito positivo, crédito negativo),
   igual que el Balance General. La alternativa es mostrarlo según la naturaleza de la cuenta.

**Los tres reportes leen la MISMA fuente** (convergencia, 02/09/2026): el Libro Mayor, el Balance
General y el Estado de Resultado se arman con `saldo_inicial + Σ movimientos del ledger`. El saldo
final de una cuenta en el mayor es el mismo que muestra esa cuenta en el Balance — comparar los
dos es lo primero que hace un contador, y dos números distintos no se leen como "falta una fase"
sino como que el sistema no es confiable.

> Hasta el 02/09/2026 esto decía lo contrario —que el Balance se armaba solo con saldos de
> apertura— y la pantalla del mayor llevaba un aviso diciéndolo. Las dos cosas quedaron viejas el
> mismo día que convergían los reportes, y el aviso sobrevivió tres bloques.

Lo que SÍ sigue pendiente es el **corte por período**: hoy se suma todo lo registrado sin importar
la fecha, y eso la pantalla lo dice.

---

### F-017: Proveedores

**Prioridad:** P0 del cierre contable — pedido al detalle por Josuarth el 25/08/2026.

Ficha con: **número correlativo** (PRV-NNN), **razón social**, **razón comercial**, **RUC**,
**DV**, dirección, teléfono, correo, **términos de pago**, estado activo/inactivo y notas.

**RUC y DV son dos campos, y esa es la feature.** No es un detalle de implementación: es el
motivo por el que se pidió el módulo. Los anexos de la declaración de renta se arman —en palabras
de Josuarth— "con el RUC en una columna y el DV en otra columna porque así está en el formulario de
la DGI". Se guardan separados, se muestran separados y hay un test que impide que alguien los
concatene más adelante.

**La validación del RUC es deliberadamente débil.** Panamá tiene varias familias de RUC
conviviendo, y ninguna lista es exhaustiva. Se valida el largo y que los caracteres sean
plausibles; el formato se **comenta** en pantalla en ámbar, sin bloquear el guardado. El criterio:
un campo que rechaza un dato bueno deja a la persona sin salida, y uno permisivo acepta un tipeo
que se corrige después. El DV sí se acota a dígitos.

**Los términos de pago son el eslabón que faltaba.** El plazo del proveedor (contado, 30, 60, 90 o
el que sea) propone el **vencimiento del gasto**, editable porque manda el comprobante, y del
vencimiento salen los **tramos** de la antigüedad de cuentas por pagar. Antes no existía el campo
de vencimiento y la antigüedad se contaba desde la fecha del gasto, que daba una lectura más
pesimista que la real.

**El proveedor en el gasto es opcional.** Obligatorio rompería los gastos que ya existen sin uno, y
va contra la regla de Rose de default editable y nada cerrado. Un gasto suelto se puede cargar con
el nombre a mano; la pantalla avisa que para los anexos de renta hace falta la ficha.

**Duplicados: se avisan, no se fusionan.** Dos fichas que comparten RUC se marcan en el listado y
en la ficha. El sistema no las une solo porque fusionar de más no tiene vuelta atrás, y quién es
quién lo sabe una persona.

---

### ANTIGÜEDAD DE SALDOS — el auxiliar contra su cuenta control

Un solo reporte con selector **por cobrar / por pagar**. Tramos **Corriente · 1 a 30 · 31 a 60 ·
61 a 90 · Más de 91**, contados en días desde la fecha de vencimiento.

**Detallada por documento, no solo resumida por tercero.** Es lo que Josuarth pidió expresamente
en la reunión del 25/08: dijo que vio versiones que solo dan el total por cliente y que prefiere
la que abre y muestra qué facturas lo componen y en qué tramo cae cada una. Cada fila de tercero
se expande y muestra sus documentos, ordenados del más vencido al menos — que es el orden en que
se reclama.

**Las tres cifras de control siempre visibles.** La guía de RM marca como no negociable que la
suma del auxiliar cuadre con su cuenta control (`100004` en cobrar, `200001` en pagar). Hoy no
cuadra. La decisión de diseño es **declararlo, no corregirlo ni esconderlo**: la pantalla muestra
juntos *total del auxiliar*, *saldo de la cuenta control* y *diferencia*. Un contador que ve la
diferencia declarada entiende el estado del sistema; uno que la descubre solo deja de confiar en
el reporte entero.

**Y la diferencia se muestra partida en sus DOS causas, porque tiene dos.** Decir que "es el saldo
de apertura" sería inexacto:

1. **El saldo de apertura cargado sin detalle de documentos.** Es el grueso. Se arregla con un dato
   que tiene el contador y no está en el sistema: qué documentos estaban pendientes a esa fecha.
2. **Documentos del sistema que todavía no producen asiento**, porque el cableado de documento a
   asiento no está construido. Una factura pendiente sin asiento está en el auxiliar y no en el
   mayor (baja la diferencia); un cobro sin asiento ya se descontó del auxiliar y no del mayor (la
   sube). Se arregla con desarrollo.

Las dos se muestran con su monto y con los documentos que las componen. La segunda **se mide en la
base**, no se deduce restando: si apareciera una tercera causa, el reporte lo declara en vez de
atribuirle todo a estas dos.

**Los tramos vacíos se muestran igual.** La estructura del reporte no cambia según los datos que
haya ese día; si un tramo no tiene documentos, la columna sigue ahí y una nota los nombra.

**Qué NO entra al auxiliar.** El filtro es por `status` (`emitida`, `parcialmente_pagada`), no por
`balance_due > 0`. Una factura anulada, en borrador o cancelada antes de emitirse tiene saldo
mayor que cero —esa columna es `grand_total − amount_paid` y no mira el estado— pero no es deuda
de nadie.

**Dos límites del modelo, dichos en la pantalla:**

1. **El proveedor todavía no es una entidad.** Es `supplier_name`, texto libre en cada gasto. La
   antigüedad de CxP agrupa por ese texto, así que dos gastos escritos distinto salen como dos
   proveedores. Crear la entidad es del módulo de compras.
2. **Los gastos del bufete no tienen fecha de vencimiento.** Solo fecha del gasto y fecha de pago.
   Así que su antigüedad se cuenta **desde la fecha del gasto**, que es una medida distinta y más
   pesimista que la real.

### ESTADO DE CUENTA — el mayor, mirado por tercero

Por **cliente** o por **proveedor**. Deliberadamente idéntico al Libro Mayor —saldo inicial,
movimientos con fecha, tipo, documento, descripción, débito, crédito y saldo corrido, totales al
pie— porque es el mismo reporte visto por otro eje, y tiene que sentirse así. Usa el mismo
vocabulario y el mismo resolvedor de enlaces al documento.

El tercero viaja en la URL, así que el estado de cuenta de un cliente es un enlace que se comparte.

**El saldo inicial arranca en cero, y la pantalla dice por qué.** No hay apertura por tercero: la
que vino de QuickBooks está en la cuenta control sin repartir. No es un cero de "no debía nada",
es un cero de "acá empieza lo que sabemos", y la diferencia entre las dos lecturas le importa a
quien audita.

### GASTOS DEL BUFETE — la compra se carga por LÍNEAS

Una compra del bufete tiene **una o más líneas**, y cada línea dice contra qué cuenta se imputa
su parte y cuánto ITBMS paga. No hay una cuenta única en el encabezado: la factura del internet
puede traer un renglón gravado y uno exento, y una sola cuenta obligaría a partir el comprobante
en dos gastos que no existen.

**Los importes del encabezado son un RESUMEN, no un campo.** Subtotal, ITBMS y total se calculan
sumando las líneas y se muestran en solo lectura. Para corregir un redondeo, se edita la línea que
lo tiene. Antes eran tres campos editables al lado de las líneas, y cargar dos renglones exentos
dejando la tasa en su valor por defecto **no guardaba**.

El encabezado sí guarda lo que describe al documento entero:

- **Proveedor** — la ficha, de donde salen el RUC, el DV y el plazo de pago
- **N.º de factura del proveedor** — opcional, porque hay recibos y vales sin numeración. Es lo
  que se busca al conciliar contra el estado de cuenta del proveedor y lo que pide el anexo de
  compras de la DGI
- **Vence** — se propone desde el plazo del proveedor y se puede cambiar: **la fecha que vale es
  la del comprobante**. En cuanto se toca a mano, deja de recalcularse solo. De acá salen los
  tramos de la antigüedad de cuentas por pagar

🔴 **Una compra que no se puede contabilizar no queda registrada.** Se registra, se postea el
asiento y, si el posteo falla, se deshace el registro. El nombre del módulo se queda como está:
*Gastos del Bufete*.

---

---

### REVERSAR UN COBRO — el libro no se borra, se refleja

**Cuándo.** Un cheque rebota, el cobro se cargó a la factura equivocada, el monto estaba mal.
Antes del 17/09/2026 la única respuesta era "avisale a Oliver": el cobro ya tenía asiento y los
asientos no se borran.

**Qué ve quien lo hace.** En el detalle de la factura, sección "Pagos registrados", la fila del
cobro ofrece **Eliminar** si el cobro NO está en el libro, o **Reversar** si sí. Nunca los dos.
El modal pide el motivo (obligatorio, mínimo 3 caracteres: es la ley, DE 34/1998 Art. 5.7) y
muestra **el asiento que se va a postear**, línea por línea, con la fecha de hoy. Esa vista
previa la calcula la misma función que el servidor postea: lo que se ve es lo que entra al
libro.

**Qué pasa al confirmar.** Se postea el espejo del asiento del cobro (mismas cuentas, débito y
crédito intercambiados, fecha de hoy, apuntando al original), la factura vuelve a mostrar su
saldo pendiente y el cobro queda anulado — los tres a la vez o ninguno. Después, la fila del
cobro sigue en la pantalla **tachada**, con *"Reversado · asiento N"* y el motivo: la historia
no se borra.

**Quién.** Admin, abogada y **contador**. Es el único botón de mutación que el contador ve en
una factura, por el mismo criterio que le da los asientos manuales: corregir el libro es su
trabajo. Registrar y eliminar cobros siguen siendo de admin y abogada.

**La fecha.** Siempre la de la reversión (acta del 09/09/2026). El mes del error queda como se
reportó; la corrección aparece en el mes en que se hizo.

**Desde el 21/09/2026 también se reversa desde `/finanzas/cobros`**, con el mismo modal. Y el
recibo en PDF de un cobro reversado se regenera solo, con la banda roja y el asiento espejo.

---

### RECIBO DE CAJA — el cobro tiene documento propio

**Qué es.** Cada cobro registrado es un recibo de caja numerado `REC-000001`, `REC-000002`… Es
un correlativo interno del bufete: un recibo de caja **no es documento fiscal en Panamá**, no
pasa por la DGI ni lleva CUFE. La factura fiscal sigue siendo la factura.

**Dónde se ve.** Módulo Finanzas → **Cobros** (`/finanzas/cobros`): el listado de todos los
recibos, más nuevos primero, con cliente, factura, monto, método, si tiene asiento, quién lo
registró; filtros por número, cliente, rango de fechas y vigentes/reversados. Cada fila ofrece
**Recibo** (el PDF) y **Reversar** (si tiene asiento). Y en el detalle de la factura, la
columna "Recibo" de "Pagos registrados" muestra el número y ofrece el PDF.

**Cómo se registra.** Dos puertas, un solo formulario:
- Desde la factura, como siempre: botón "Registrar pago".
- Desde **Cobros → Registrar cobro**, en dos pasos: 1) el cliente (solo aparecen los que
  tienen facturas con saldo) y la factura (con su saldo a la vista); 2) fecha, monto, método,
  banco, referencia, notas — exactamente los mismos campos del diálogo. El encabezado dice
  cuál va a ser el próximo número.

Al terminar, "Recibo REC-000012 registrado". El cobro sigue generando su asiento como hoy.

**El PDF.** Mismo diseño que la factura (navy/gold): "RECIBO DE CAJA" + número, el cliente con
**RUC y DV en líneas separadas**, fecha, método, banco, referencia, asiento, quién lo registró,
la tabla "Aplicado a" con la factura (una hoy; el modelo admite varias), el total cobrado y el
pie *"Documento interno de control. No es factura ni documento fiscal"*. Se genera al pedirlo
y se guarda; si el cobro cambia (se reversa), se regenera con la banda **REVERSADO**, la fecha,
el motivo y el asiento espejo. Se descarga sin cambiar de pestaña.

**Los cobros de antes.** Todos los cobros existentes recibieron su número en orden
cronológico (`payment_date`), de una vez, para que el listado no tenga unos con recibo y otros
sin. Un cobro reversado conserva su número: existió, y el número no se reusa.

**Huecos en la numeración.** Si un alta falla después de tomar el número (por ejemplo, el
período contable está cerrado), el cobro se deshace pero el número ya se consumió y queda un
hueco. Es una decisión consciente, la misma que en facturas (`sop.md` SOP-031): un hueco se
explica; un cobro contabilizado sin recibo no se podría corregir porque el asiento es inmutable.

**Quién.** Admin y abogada ven Cobros y registran. El **contador** también ve el listado
—Josuarth, 21/09/2026: "el contador SÍ debe ver la pantalla de Cobros"; es material de
conciliación— pero en **solo lectura**: baja el recibo y reversa, no registra ("Registrar
cobro" no se le muestra y `/finanzas/cobros/nuevo` le rebota). Registrar un cobro es del lado
de la abogada: es quien recibe la plata del cliente y quien responde por la factura. El
asistente no llega a nada de esto.

**Fuera de alcance, a propósito.** Un recibo aplicado a varias facturas (el modelo lo soporta
desde el día uno; la pantalla se hace cuando el bufete lo pida). Un detalle de cobro propio:
el Libro Mayor sigue llevando al detalle de la factura, que es donde vive el cobro. Los cobros
del caso (`client_payments`, módulo Legal) son otra cosa y no se cruzan con esto.

## REQUERIMIENTOS NO FUNCIONALES

- **Mobile-first:** diseñado primero para celular, funciona en desktop
- **Foolproof UI:** botones 48px+, iconos+texto, max 3 taps/tarea, wizard max 5 campos/pantalla
- **Acceso web:** sin instalar app, funciona en navegador
- **Multi-tenant:** aislamiento por RLS desde día 1
- **Branding:** azul marino #1B2A4A, dorado #C5A55A, blanco #FFFFFF, serif profesional, logo Integra
- **Performance:** paginación y búsqueda indexada (crecimiento a cientos de registros en el próximo año)
