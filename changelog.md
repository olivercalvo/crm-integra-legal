# CHANGELOG.MD — CRM INTEGRA LEGAL

## [Feature] - 2026-08-14 - Plan de cuentas: carga masiva por Excel (Paso 1b contable)

Segunda mitad del **Paso 1** del plan contable con Josuar (ver
`docs/finanzas/roadmap-contable.md` §10). Botón **"Importar cuentas"** en
`/finanzas/configuracion/cuentas`: plantilla descargable, subida de .xlsx/.csv, preview con
crear/actualizar/error por fila, y upsert por `(tenant, código)` al confirmar.

**Sin migración**: usa las columnas `saldo_inicial` y `subcategoria` del Paso 1a.

### 1. Módulo PURO de mapeo — `src/lib/finanzas/import/chart-of-accounts-mapping.ts`

Separado a propósito de la capa XLSX: recibe una matriz `unknown[][]` y devuelve filas tipadas,
así que se testea sin fixtures binarios ni mocks.

- **Lectura tolerante de encabezados**, case/acento-insensible vía NFD + borrado de marcas
  combinantes (`Código` y `Codigo` caen en la misma clave, sin enumerar variantes). Alias por
  campo: código/codigo/número/numero/cuenta · nombre/nombre de cuenta/descripción ·
  tipo/tipo de cuenta · subcategoría · saldo inicial/saldo_inicial/balance inicial.
- Match por **igualdad exacta** de la clave normalizada, no por `includes()`: así `Saldo final` no
  se confunde con `Saldo inicial` ni `Tipo de cuenta` con el alias `cuenta` del código. Hay test
  para ambos.
- **Detección de la fila de encabezado** (no se asume la fila 1): recorre hasta 30 filas y toma la
  primera que identifique código Y nombre. Las filas de título del balance de comprobación de
  Josuar ("INTEGRA LEGAL, S.A.", "Al 31/12/2025") se saltan solas.
- **Mapeo de tipo** → `account_type` + subcategoría default, singular y plural, más los 5 valores
  crudos en inglés: Activo→asset · Pasivo→liability · Patrimonio→equity · Ingreso→income ·
  Costo→expense+`costo` · Gasto→expense+`gasto_operativo`.
- **Subcategoría explícita del archivo gana** sobre el default del tipo. Acepta el value snake_case
  o el label en español; el label necesita un **lookup inverso real**, no un `replace(" ", "_")`
  ("Propiedad, planta y equipo" → `propiedad_planta_equipo` no sale de ninguna transformación
  mecánica). Bug encontrado por el test.
- **Parseo de saldo** tolerante: vacío→0, negativos con signo o entre paréntesis contables
  (`(1,234.00)` = -1234), símbolo `B/.`/`$`, y separadores de miles/decimales US o europeos. La
  regla de desambiguación está documentada en el código (si hay `,` y `.`, el último es el decimal).
- **Filas sin código válido se descartan EN SILENCIO** (títulos, subtotales "TOTAL ACTIVOS",
  vacías). Una fila **con** código pero con tipo/nombre inválido sí es error: el usuario claramente
  quiso importarla.
- `classifyRows()` decide crear/actualizar/error y detecta **códigos repetidos dentro del archivo**
  (la 1ra se procesa, las siguientes quedan en error). Sin ese guard dos filas con el mismo código
  se escribirían una sobre la otra y el resumen mentiría.

### 2. Capa XLSX — `src/lib/finanzas/import/chart-of-accounts-workbook.ts`

Solo convierte el archivo a matriz (`sheet_to_json` con `raw: true` para que los saldos lleguen
como number) y delega. Genera además la plantilla `.xlsx` con 2 hojas: **Cuentas** (5 ejemplos que
cubren un costo, un gasto y un saldo negativo) e **Instrucciones** (qué es obligatorio + tabla de
subcategorías válidas con su valor interno).

### 3. Endpoint — `POST /api/finanzas/configuracion/chart-of-accounts/bulk`

`multipart/form-data` con `mode=preview|commit`, mismos roles que la creación de cuentas
(admin/abogada/contador). Topes: 5 MB y 1000 filas.

- **El commit re-parsea el archivo** en vez de confiar en el JSON del cliente: si el navegador
  posteara las filas ya clasificadas, un cliente modificado podría inyectar filas que nunca pasaron
  por la validación del preview.
- Reusa `createChartAccount` / `updateChartAccount`, así que el **`audit_log` por fila** y los
  guards de unicidad salen gratis y son los mismos que en el alta manual.
- **Una fila que falla no aborta el resto**: se reporta y se sigue. Rehacer una carga de 62 cuentas
  por un typo en la fila 40 es peor que un resumen con 1 error.
- **En el update PRESERVA `description` y `active`.** El PATCH es reemplazo total y ninguno de los
  dos viene en el Excel: sin esto, importar borraba las notas del contador y podía reactivar
  cuentas desactivadas. Mismo tipo de bug que el del toggle en el Paso 1a. Hay test dedicado.

### 4. UI — `import-accounts-panel.tsx` + botón en el manager

Panel inline de 3 pasos (subir → preview → resumen). Preview con badges Crear/Actualizar/Error,
motivo por fila, aviso ámbar si el archivo no trae columna de saldo, y contador de filas ignoradas.
Descarga con anchor programático, **no `window.open`** (bug ya visto en el PDF de cotizaciones).

**Bug preexistente corregido de paso:** el conteo del encabezado ("N cuentas contables") lo
renderiza el server component, así que quedaba viejo después de cualquier mutación desde el
cliente — se veía "36 cuentas contables" con "41 total" en el pie. Se agregó `router.refresh()`
tras la carga masiva y tras crear/editar una cuenta.

### 5. Fuera de alcance (a propósito)

- **NO genera asientos de apertura**: el saldo vive en la columna; el asiento formal es el Paso 3.
- **NO desactiva las 34 cuentas viejas de QB** (lo hace Oliver aparte).
- Activo/Pasivo/Patrimonio/Ingreso **no reciben subcategoría por defecto**: para el Balance General
  hay que distinguir corriente de no corriente y eso no se puede inferir del tipo. Quedan sin
  clasificar y se completan con la columna Subcategoría o editando la cuenta.

### 6. Tests — 45 nuevos (72 en total en el módulo, 0 fail)

- `src/lib/finanzas/import/__tests__/chart-of-accounts-mapping.test.ts` — **34 tests** del módulo
  puro: encabezados (plantilla, balance de comprobación, `Saldo final` que no matchea), mapeo de
  tipo, saldos (vacío→0, negativos, paréntesis, miles US/EU, moneda, fuera de rango), filas basura,
  subcategoría explícita gana, snake_case vs label, y `classifyRows` (update por código existente,
  duplicado en archivo, isSystem).
- `src/app/api/.../bulk/__tests__/bulk.route.test.ts` — **11 tests** del endpoint, armando un
  `.xlsx` real en memoria con SheetJS: preview no escribe nada, commit crea con `is_system=false` y
  audita, update preserva description/active, fila inválida no aborta el resto, duplicado se
  escribe una sola vez, formato de Josuar, 400 sin encabezados, 403 asistente.

```
npx tsx --test src/lib/finanzas/import/__tests__/chart-of-accounts-mapping.test.ts
npx tsx --test --experimental-test-module-mocks \
  src/app/api/finanzas/configuracion/chart-of-accounts/bulk/__tests__/bulk.route.test.ts
```

### 7. Verificación en navegador (localhost:3000, rol admin) — 14/08/2026

| Paso | Resultado |
|---|---|
| Descargar plantilla | `plantilla-plan-de-cuentas.xlsx`, 2 hojas, 5 filas de ejemplo (verificado leyendo el archivo bajado) |
| Subir Excel con formato de Josuar (títulos arriba, `Nombre de cuenta`/`Tipo de Cuenta`/`Balance Inicial`, columnas Débito/Crédito/Saldo final, fila TOTALES) | Preview **5 a crear · 0 a actualizar · 1 fila ignorada** |
| Mapeo en el preview | `Costos`→Gasto+**Costo**; `Gastos`→Gasto+**Gasto operativo**; `"1,200.50"`→1,200.50; `"B/. 3,400.00"`→3,400.00; `-15000`→**-15,000.00** en rojo |
| Confirmar | **5 creadas · 0 actualizadas · 0 con error · 1 ignorada** |
| Listado | Las 5 agrupadas por tipo, con su saldo y subcategoría; total 36 → 41 |
| Volver a subir el MISMO archivo | Preview **0 a crear · 5 a actualizar** → confirmado: **0 creadas · 5 actualizadas**, total sigue en 41 (sin duplicados) |

En BD: los 5 códigos con `account_type`/`subcategoria`/`saldo_inicial` correctos, `is_system=false`,
y `saldo_inicial` de tipo `number`. El `audit_log` tiene **5 create y 0 update**: el segundo import
mandó valores idénticos y el diff no registró cambios fantasma — la comparación numérica del Paso 1a
funcionando sobre datos reales.

Quedan las 5 cuentas de prueba `910001`–`910005` en la BD del cliente; el `DELETE` para limpiarlas
está en `task_plan.md`.

---

## [Feature] - 2026-08-14 - Plan de cuentas: saldo inicial + subcategoría (Paso 1a contable)

Primera mitad del **Paso 1** del plan contable acordado con Josuar (ver
`docs/finanzas/roadmap-contable.md` §10). El `chart_of_accounts` y su UI ya existían; faltaba
poder cargar cada cuenta con su **saldo de apertura** y una **subcategoría** que agrupe los
reportes. La carga masiva por Excel (Paso 1b) va en un cambio aparte.

### 1. Migración — `sql/pending/024_chart_of_accounts_saldo_subcategoria.sql`

Aditiva e idempotente (`ADD COLUMN IF NOT EXISTS`), **pendiente de aplicar** por Oliver en el SQL
Editor de Supabase:

| Columna | Tipo | Notas |
|---|---|---|
| `saldo_inicial` | `numeric(14,2) NOT NULL DEFAULT 0` | Admite negativos (patrimonio con pérdida acumulada, contra-cuentas). Las 34 cuentas existentes quedan en 0. |
| `subcategoria` | `text NULL` | Sin CHECK a propósito: el vocabulario se valida en la app y puede crecer con el import del Paso 1b. NULL = sin clasificar. |

Incluye `COMMENT ON COLUMN` en ambas, un `DO $$` que aborta si no quedaron las 2 columnas, y
`SELECT` de verificación sobre `information_schema.columns` + conteo de cuentas en 0.

**Decisión de diseño (puente deliberado):** `saldo_inicial` vive como columna porque calza con el
modelo mental de Josuar y con el import por Excel. Cuando exista el motor de posteo del ledger
(Paso 3), ese saldo se convierte en un **asiento de apertura** (`source_type='manual'`) y los
reportes pasan a leer del ledger. La columna no se borra sin migrar los saldos primero.

### 2. Tipos — `src/lib/finanzas/types/chart-of-account.ts`

Nuevo tipo `Subcategoria` con sus 10 valores, `SUBCATEGORIAS` (orden del dropdown),
`SUBCATEGORIA_LABEL_ES`, `isSubcategoria()` y `subcategoriaLabel()` (fallback `—` para NULL).
Se guarda el value en **snake_case**, se muestra el label en español:

`activo_corriente` · `activo_no_corriente` · `propiedad_planta_equipo` · `pasivo_corriente` ·
`pasivo_no_corriente` · `patrimonio` · `ingreso` · `costo` · `gasto_operativo` · `otro`

`ChartAccountRow`, `CreateChartAccountInput` y `UpdateChartAccountInput` suman
`subcategoria: Subcategoria | null` y `saldo_inicial: number`.

### 3. Validadores — `src/lib/finanzas/validators/chart-of-account.ts`

- `subcategoria`: opcional (`null` / `""` / ausente → `null`). Si llega un valor tiene que estar en
  `SUBCATEGORIAS`; este validador es la **única barrera** contra vocabulario inventado, porque la
  columna no tiene CHECK.
- `saldo_inicial`: opcional → **default 0**. Acepta number o string numérico, redondea a 2 decimales
  con `round2()` (mismo patrón que `validators/business-expense.ts`), **permite negativos**, y corta
  en `1e12` para dar un error accionable en vez de un `22003 numeric field overflow` de Postgres.

### 4. Backend — API y queries

- `createChartAccount` / `updateChartAccount` escriben ambos campos y **los mandan al `audit_log`**
  como el resto: en `create` dentro del `new_value`, en `update` dentro del diff `old → new`.
- El diff de `saldo_inicial` compara por **valor numérico**, no por identidad: PostgREST puede
  devolver un `numeric` como string (`"8300.40"`), y comparar con `!==` registraba un cambio
  fantasma `8300.40 → 8300.4` en cada guardado.
- `SELECT_COLS` de `api/` y `queries/` incluyen las 2 columnas nuevas. Ambos módulos normalizan
  `saldo_inicial` con `Number()` al devolver la fila, para que la UI no reciba un string.

### 5. UI — `chart-of-accounts-manager.tsx`

- Form de crear/editar: **"Saldo inicial (B/.)"** (`type=number`, `step=0.01`, alineado a la
  derecha, default `0`, admite negativos) y **"Subcategoría (opcional)"** (dropdown con
  `— Sin clasificar —` + los 10 labels en español).
- Listado: 2 columnas nuevas. Subcategoría como badge gris (`—` si es NULL); saldo inicial en
  `font-mono tabular-nums` alineado a la derecha con separador de miles `es-PA`, en **rojo si es
  negativo** y gris claro si es 0.
- El buscador ahora también matchea por label de subcategoría.
- El estado del form guarda `saldo_inicial` como **string** para no pelear con el input mientras se
  tipea (`-`, `1500.`, vacío al borrar todo); se convierte al guardar.

**Bug evitado en el toggle activar/desactivar:** el `PATCH` es **reemplazo total**, no parche
parcial — el validador defaultea los campos ausentes. `toggleActive()` mandaba solo
`name/account_type/description/active`, así que con los campos nuevos habría **puesto el saldo en 0
y la subcategoría en NULL** cada vez que alguien activaba o desactivaba una cuenta. Ahora reenvía la
fila completa, y el contrato quedó documentado en el header de `api/chart-of-accounts.ts`.

### 6. Sin cambios (a propósito)

- El CHECK de `account_type` sigue con sus **5 valores en inglés** (`asset/liability/equity/income/
  expense`). La distinción **costos vs gastos** se resuelve con `subcategoria` (`costo` vs
  `gasto_operativo`), no abriendo el CHECK.
- El código de cuenta sigue **inmutable**; `is_system` sin cambios.

### 7. Tests — `chart-of-accounts.route.test.ts` (27 pass, 0 fail)

12 tests nuevos: validador (saldo con default 0, negativos, redondeo a 2 decimales, no numérico,
fuera de rango; subcategoría válida / vacía / inválida / ausente) y handlers (POST y PATCH
persisten **y auditan** ambos campos, POST sin `saldo_inicial` → 0, subcategoría inválida → 400 con
`fieldErrors`, y el caso del cambio fantasma `"8300.40"` vs `8300.4` que no debe auditarse).

```
npx tsx --test --experimental-test-module-mocks \
  src/app/api/finanzas/configuracion/chart-of-accounts/__tests__/chart-of-accounts.route.test.ts
```

### 8. Verificación en navegador (localhost:3000, rol admin) — 14/08/2026

Migración 024 aplicada en Supabase por Oliver antes de verificar. Recorrido completo:

| Paso | Resultado |
|---|---|
| Listado inicial | Columnas **SUBCATEGORÍA** y **SALDO INICIAL** presentes; las 34 cuentas viejas en `—` y `0.00` |
| Dropdown de subcategoría | Los 10 valores con label español y `value` en snake_case, más `— Sin clasificar —` |
| Crear `999001` (saldo `12500.75`, *Activo corriente*) | Fila nueva con badge gris y `12,500.75` (separador de miles `es-PA`) |
| Editar → *Activo no corriente*, saldo `-8400.25` | Form pre-cargado con ambos campos; persiste y el negativo sale **en rojo** |
| Buscar "Activo no corriente" | Filtra a 1 fila → el buscador matchea por label de subcategoría |
| Desactivar la cuenta | `Inactiva`, y **saldo + subcategoría intactos** → confirma el fix del toggle |

`audit_log` de la cuenta (leído directo de la BD) — 3 entradas, exactamente las esperadas:

```
[create] new: {...,"subcategoria":"activo_corriente","saldo_inicial":12500.75,...}
[update] field=subcategoria,saldo_inicial
         old: {"subcategoria":"activo_corriente","saldo_inicial":12500.75}
         new: {"subcategoria":"activo_no_corriente","saldo_inicial":-8400.25}
[update] field=active   old: {"active":true}   new: {"active":false}
```

La tercera entrada es la prueba dura del fix: el toggle auditó **solo `active`** — antes habría
registrado también `saldo_inicial: -8400.25 → 0` y `subcategoria: activo_no_corriente → null`.
`saldo_inicial` vuelve de PostgREST como `number` (verificado con `typeof`).

Queda la cuenta de prueba `999001` **inactiva** en la BD del cliente; el `DELETE` para limpiarla
está en `task_plan.md` (no se ejecuta acá: borrar datos es pausa obligatoria).

### 9. Doc

`docs/finanzas/roadmap-contable.md` §10 (plan de 5 pasos de la reunión del 10/08/2026 con Josuar)
se editó fuera de AG y entra en este commit.

---

## [Cambio de rol] - 2026-08-06 - Clientes para el asistente: ficha sí, directorio no

Complemento del cambio anterior (asistente ve todos los casos). Al abrir un caso, el link al
cliente llevaba a `/legal/clientes/{id}`, que estaba accesible pero con los botones de gestión
visibles; y el directorio `/legal/clientes` era alcanzable por URL directa aunque no figurara en
el menú. Decisión: **el asistente ve la ficha de un cliente puntual en solo lectura, y nada más**.

### 1. Gate de ruta (`src/middleware.ts`)

Nuevo `ASISTENTE_BLOCKED_PATTERNS` — gate por ruta **exacta**, no por prefijo, porque
`/legal/clientes/{id}` tiene que seguir pasando:

| Ruta | Asistente |
|---|---|
| `/legal/clientes` | redirect → `/legal` |
| `/legal/clientes/nuevo` | redirect → `/legal` |
| `/legal/clientes/{id}/editar` | redirect → `/legal` |
| `/legal/clientes/{id}` | **permitida** |

El check corre después del gate admin-only y del gate del contador, y antes del gating genérico
por prefijo. No toca a admin/abogada (condicionado a `userRole === "asistente"`).

### 2. Ficha de cliente en solo lectura (`src/app/legal/clientes/[id]/page.tsx`)

Nuevo `canManageClient = admin || abogada`. Se ocultan al asistente las acciones que la API ya le
rechaza — verificado uno por uno contra el gate real, no por analogía:

| Botón | Endpoint | Roles | ¿Se oculta? |
|---|---|---|---|
| Crear Caso / + Nuevo Caso | `POST /api/cases` | admin, abogada | Sí |
| Editar | `PATCH /api/clients/[id]` | admin, abogada | Sí |
| Desactivar | `PATCH /api/clients/[id]` | admin, abogada | Sí |
| Eliminar | `DELETE /api/clients/[id]` | admin, abogada | Sí (ya lo estaba) |
| Adjuntar Documento | `POST /api/documents/register` | admin, abogada, **asistente** | **No** — se mantiene |

Nota: los dos botones de crear caso NO estaban en el pedido original (que nombraba Editar,
Desactivar y Eliminar), pero `POST /api/cases` es admin+abogada, así que al asistente le daban 403
igual — y el listado de Casos ya se los escondía. Se ocultan por consistencia con el gate real.

El breadcrumb "Clientes" se renderiza como texto plano para el asistente: como link apuntaría a un
directorio que el middleware le rebota, y un link muerto es peor que ninguno.

### 3. Limpieza en el detalle de caso (`src/app/legal/casos/[id]/page.tsx`)

`<InlineCaseInfoEditor>` (botón "Editar Información") solo se renderiza para admin/abogada. El
`PATCH /api/cases/[id]` sin `action` ya le respondía 403 al asistente; el botón era ruido. El botón
"Cambiar Estado" del header NO se toca — esa acción sí la tiene permitida.

### Verificación en navegador (localhost:3000, sesión real de Harry Boyd / Asistente)

| Qué | Resultado |
|---|---|
| `/legal/clientes` por URL | Redirige a `/legal` (Mi Panel). El server log no registra ningún `GET /legal/clientes`, solo el `GET /legal` del destino. |
| `/legal/clientes/nuevo` por URL | Redirige a `/legal`. |
| `/legal/clientes/{id}/editar` por URL | Redirige a `/legal`. |
| `/legal/clientes/{id}` por URL | Carga (`200`). Ficha completa de MI CONDADO, S.A: datos, 20+ casos vinculados y documentos. El árbol de accesibilidad de la página entera devuelve **un solo botón: "Adjuntar Documento"** — sin Crear Caso, Editar, Desactivar ni Eliminar. Breadcrumb "Clientes" sin `href`. |
| Link al cliente desde el detalle del caso | Click en "MI CONDADO, S.A" (Datos del Cliente) → navega a la ficha correctamente. |
| Detalle de caso | Ya NO aparece "Editar Información". El header conserva Imprimir Tarjeta · Etiqueta Simple · Cambiar Estado. |

Admin/abogada: sin cambios verificados por código (ambos gates condicionan sobre el rol y
`canManageClient` es true para los dos; el `DeleteClientButton` conserva su condición previa). No
se re-verificó en navegador con esos roles.

Tests: `npx tsc --noEmit` limpio. Lint sin errores nuevos.

### Deuda detectada, NO tocada (pre-existente, confirmada por bisección)

El detalle de caso emite un **error de hidratación** en dev: `<div> cannot be a descendant of <p>`
→ `Badge` dentro de un `<p>` en la card "Datos del Caso" (los bloques de `case_start_date`,
`procedure_start_date`, `deadline` y `last_followup_at` que muestran un Badge de "N días" dentro
del `<p>` de la fecha). React descarta el HTML del server y re-renderiza todo el root en cliente.
Se confirmó pre-existente stasheando los cambios de este commit y recargando: el error sigue.
Fix ≈ 4 líneas (`<p>` → `<div>`), pendiente de decisión — no entra acá para no mezclarlo con un
commit de roles.

---

## [Cambio de rol] - 2026-08-06 - El asistente ve TODOS los casos del bufete

Decisión de negocio: el rol `asistente` pasa a tener el **mismo alcance de LECTURA de casos que
`abogada`**. Antes solo veía (y podía abrir) los casos donde figuraba como `assistant_id` o donde
tenía una tarea asignada; en la práctica eso le impedía dar seguimiento a expedientes del bufete
que no estuvieran formalmente asignados a él. Afecta a todos los asistentes (hoy el único activo
es `asistente@integra-panama.com` / Harry Boyd).

### Cambios de código

1. **`src/app/legal/casos/page.tsx`** — eliminado el pre-cálculo de `asistenteCaseIds` (2 queries:
   `tasks` por `assigned_to` + `cases` por `assistant_id`) y el `query.in("id", asistenteCaseIds)`
   que intersectaba el listado. El único filtro de lectura que queda es `tenant_id`. Efecto
   colateral positivo: se ahorran 2 roundtrips a la DB por render del listado para ese rol.
2. **`src/app/legal/casos/[id]/page.tsx`** — eliminado el gate de acceso (`if (userRole ===
   "asistente")` → `notFound()` cuando no era `assistant_id` ni tenía tarea en el caso).
3. **`src/app/legal/casos/[id]/page.tsx`** — al quitar ese gate se agregó `.eq("tenant_id",
   tenantId)` al fetch del caso. `getAuthenticatedContext()` devuelve el **admin client, que
   bypassea RLS**, y la query filtraba solo por `id`: el aislamiento multi-tenant queda ahora
   explícito en vez de depender del gate de rol. Un caso de otro bufete → `notFound()`.

### Lo que NO cambió (verificado, no tocado)

- **Borrar casos/clientes:** sigue admin/abogada (`DeleteCaseButton` gateado por rol).
- **Editar expediente completo:** sigue admin/abogada. `PATCH /api/cases/[id]` gatea por acción —
  `change-status` permite asistente, la edición general no (403).
- **Finanzas:** el asistente sigue sin acceso; `/finanzas` redirige a `/legal` por middleware.
- **Menú Clientes:** sigue oculto para el rol en `nav-config.ts`.
- **Comentar y adjuntar documentos:** sigue permitido (`LEGAL_CONTRIB`).
- **Dashboard del asistente y "Mis Pendientes":** siguen siendo vistas **personales** (solo lo
  asignado a él). Es intencional: el listado de Casos es la vista del bufete, el dashboard es la
  vista propia.

### Verificación en navegador (localhost:3000, sesión real de Harry Boyd / Asistente)

| # | Qué | Resultado |
|---|-----|-----------|
| a | `/legal/casos` | **188 casos encontrados**; las filas visibles (ADM-045, ADM-044, ADM-043, ADM-042 de MI CONDADO, S.A) tienen columna Asistente en `—`, o sea NO asignados a él. Antes ese listado le daba 0. |
| b | Detalle de caso no asignado | Abre ADM-045 (`Asistente Responsable de Seguimiento: —`) con las 4 pestañas completas. Antes → 404. |
| c | Finanzas | El sidebar solo muestra Dashboard / Casos / Gastos / Mis Pendientes. `/finanzas` por URL directa → redirige a `/legal`. |
| c | Botón borrar | El header del detalle solo tiene Imprimir Tarjeta · Etiqueta Simple · Cambiar Estado. Sin Eliminar. |

Tests: `npx tsc --noEmit` limpio; `patch-role-by-action.test.ts` 4/4 (incluye "asistente + edición
completa (sin action) → 403 y NO actualiza") y `authz-guards.test.ts` 31/31.

### Deuda detectada, NO tocada en este cambio (fuera de alcance)

- `/legal/clientes` es alcanzable por **URL directa** para el asistente (el rol solo está excluido
  del menú, no del route). Muestra el listado y hasta el botón "Nuevo Cliente" — el POST sí
  responde 403. Es **pre-existente**, no lo introduce este cambio, pero conviene decidir si el
  gate debe ser real (redirect en middleware) o si alcanza con esconderlo del menú.
- El botón "Editar Información" del detalle se le renderiza al asistente aunque el PATCH le
  responda 403. También pre-existente; ahora se ve en más casos, porque puede abrir más casos.

### Documentación actualizada
`CLAUDE.md` §4 (tabla de roles), `docs/USUARIOS.md` §1, `sop.md` (nota de routing),
comentarios en `casos/page.tsx`, `casos/[id]/page.tsx`, `api/cases/[id]/route.ts` y
`authz-guards.test.ts`.

---

## [Fix] - 2026-08-04 - Borrado de cliente con registros financieros: error crudo y borrado parcial

Al intentar eliminar un cliente con facturas, el CRM mostraba en un `alert()` del navegador:

> update or delete on table "clients" violates foreign key constraint
> "invoices_client_id_fkey" on table "invoices"

Y —lo grave— **los documentos del cliente ya se habían borrado** para cuando aparecía ese mensaje.

### Diagnóstico — dos bugs, uno cosmético y uno de pérdida de datos

1. **Chequeos incompletos.** El handler solo miraba `cases`. Pero `invoices`, `quotes`,
   `credit_notes` y `payments` también referencian `clients(id)` **sin `ON DELETE`**, o sea
   NO ACTION / RESTRICT. Sin chequeo previo, el `.delete()` explotaba y el
   `deleteError.message` de Postgres se devolvía como 500 y llegaba tal cual al `alert()`.
2. **Orden de operaciones.** Los documentos (storage + filas en `documents`) se borraban en el
   paso 1 y el cliente en el paso 2. Al fallar la FK del paso 2, el paso 1 ya era irreversible:
   **cliente vivo, documentos perdidos**. No hay transacción que los cubra: son dos sistemas
   distintos (Storage y Postgres).

Sobre la base real: **45 de 126 clientes** del tenant caían en este camino.

### Cambio
- **Nuevo** `src/lib/clients/delete-guards.ts` — núcleo PURO (sin Supabase):
  `FINANCIAL_DEPENDENCIES`, `buildFinancialBlockMessage()`, `isForeignKeyViolation()`.
- **Chequeo previo** de las 4 tablas (`count exact`, `head: true`, por `client_id` + `tenant_id`,
  en paralelo) **antes de tocar nada**. Si hay alguno → **400** y cero borrados.
- **Mensaje específico**, enumerando solo los tipos presentes:
  *"Este cliente tiene registros financieros y no se puede eliminar: 3 factura(s), 1 pago(s).
  Desactívalo en su lugar."*
- **Orden corregido**: el bloque que borra documentos ahora está después de TODAS las
  validaciones, con un comentario marcando la frontera (`---- No blocking check remains ----`).
- **Defensa en profundidad**: si el `.delete()` final igual falla con `23503`, se devuelve **400**
  con mensaje genérico amigable en vez del error crudo con 500. Esto cubre
  `prospects.converted_client_id`, que también es RESTRICT y no está en la lista de conteos.
- **Front**: `DeleteClientButton` recibe los conteos y **deshabilita el botón proactivamente**
  (mismo patrón que `caseCount`), reusando `buildFinancialBlockMessage()` — UI y API dicen
  literalmente lo mismo. El `alert()` se reemplazó por **error inline dentro del modal**
  (`role="alert"`), que ya no borra el contexto de la pantalla.
- El chequeo de `cases` quedó **intacto** y sigue teniendo precedencia, en el handler y en la UI.

### Tests (17/17 pass)
`src/app/api/clients/__tests__/delete-financial-guard.route.test.ts` — 5 unitarios del núcleo puro
+ 12 sobre el **handler real** con fake de Supabase. El aserto que importa no es el 400 sino
`assertNadaBorrado()`: ni documentos, ni storage, ni cliente. Cubre los 4 tipos por separado,
conteos mixtos, camino feliz (borra + audita), `23503` inesperado → 400, error no-FK → sigue 500,
y 401/403/404 sin borrar.

```
npx tsx --test --experimental-test-module-mocks \
  src/app/api/clients/__tests__/delete-financial-guard.route.test.ts
```

Regresión en verde: `ruc-taxid-sync` + `ruc-unique` + `client-type` (37/37). `tsc --noEmit` limpio,
`eslint` limpio.

### Verificación en navegador (localhost:3000, sesión real, SOP-009)
| Caso | Resultado |
|---|---|
| `CLI-001` JUMBO CAPITAL (6 casos + 1 factura) | Gana el mensaje de **casos**, precedencia intacta |
| `0TEST-FE-001` (0 casos, 2 facturas) | Modal: *"…: 2 factura(s). Desactívalo en su lugar."*, sin input de confirmación, solo **Cerrar** |
| `POST /api/clients/0TEST-FE-001/delete` saltando el botón | **400** con el mismo texto (antes: 500 con el error de Postgres) |
| Cliente descartable `CLI-131` (creado y borrado en la prueba) | **200**, redirige al listado, `audit_log` registrado |

Post-verificación en BD: `0TEST-FE-001` **sigue existiendo con sus 2 facturas** (nada se borró en el
intento bloqueado) y `CLI-131` ya no existe. Log del server sin 500 ni excepciones.

**Nota:** el escenario "bloquea sin borrar documentos" no se pudo reproducir contra datos reales
porque **ningún cliente del tenant tiene facturas Y documentos a la vez**. Esa combinación queda
cubierta por el test del handler (`assertNadaBorrado()`), no por la prueba de navegador.

`CLI-131` quemó un número de la secuencia de clientes — gap esperado de smoke test, **no rebobinar**.

### Sin migración
Las FKs ya estaban bien: el problema era que el código no las respetaba. **Sin cambios de schema,
sin deploy pendiente de SQL.**

## [Feature] - 2026-08-04 - Contable Fase 1: schema del motor de asientos (DE 34/1998)

Reescritura completa de `sql/pending/023_contabilidad_fase1_ledger.sql`. **Solo el archivo SQL: NO se
aplicó en Supabase** (lo aplica Oliver, pausa obligatoria por cambio de schema en producción).

### Por qué se reescribió
El borrador anterior estaba **⛔ EN ESPERA** porque **recreaba `chart_of_accounts`** con otra
estructura (`account_type` en español, seed propio de cuentas). Choca de frente con el
`chart_of_accounts` que **ya existe en producción** — creado en
`20260505000002_finanzas_catalogos.sql`, con `account_type` en inglés
(`asset/liability/equity/income/expense`), `is_system`/`active`, 34 cuentas extraídas de QuickBooks
y una UI de gestión ya desplegada (`/finanzas/configuracion/cuentas`, 01/08).

### Qué cambió
- **Eliminada** la recreación de `chart_of_accounts` y **eliminado** el seed del plan de cuentas.
  El plan definitivo de Josuar se carga aparte (UI o migración de datos) **después** de que lo
  confirme — el ledger es *chart-agnostic*.
- `journal_entry_lines.account_id` ahora es **FK al `chart_of_accounts` existente**.
- La migración queda **puramente aditiva**: 5 tablas nuevas y vacías, no toca data existente.

### Qué crea (Fase 1 = solo schema)
| Tabla | Rol |
|---|---|
| `accounting_periods` | cierre mensual (`abierto`/`cerrado`), UNIQUE por (tenant, año, mes) |
| `accounting_sequences` | correlativo **sin huecos** por tenant (Art. 22.2), distinto del folio fiscal FE |
| `journal_entries` | asientos append-only, hash-chain (`prev_hash`/`content_hash`/`hash`), doble fecha `transaction_date` + `record_date` |
| `journal_entry_lines` | líneas débito/crédito, FK al COA existente |
| `accounting_legajos` | legajos anuales sellados (Art. 14, conservación 5 años) |

Más: 7 índices, **6 triggers de inmutabilidad** (rechazan UPDATE/DELETE en asientos, líneas y
legajos **incluso al service-role** — la corrección es siempre un asiento de reversión) y RLS
`tenant_isolation` en las 5 tablas. La RLS lee el claim JWT `app_metadata.tenant_id` **inline**,
porque `auth.tenant_id()` NO existe en esta base (hallazgo del 13/07).

Constraints de negocio en la BD: `jel_debit_xor_credit` (débito O crédito, no ambos),
`jel_not_zero` (sin líneas en cero) y `je_reversion_requires_ref` (una reversión exige apuntar al
asiento original **y** un motivo ≥3 chars, Art. 5.7).

### Qué NO entra en esta fase
- **RPC de posteo** (correlativo sin huecos + hash-chain + validación Σdébitos = Σcréditos +
  período abierto) → Fase 2.
- **Función verificadora** de la cadena de hashes → Fase 2.
- **Enganche factura→asiento** → Fase 2.
- **Tipos TypeScript** → van con la lógica que los consuma (Fase 2), no antes.

La partida doble (Σdébitos = Σcréditos) **no se puede expresar como CHECK** porque abarca varias
filas; se valida en el RPC de posteo. Hasta que exista ese RPC, las tablas quedan creadas pero sin
camino de escritura desde la app.

### Aplicación — el archivo ES re-ejecutable (idempotente)
Correrlo dos veces **no falla**. Postgres no soporta `CREATE TRIGGER IF NOT EXISTS` ni
`CREATE POLICY IF NOT EXISTS`, así que cada uno va precedido de su `DROP ... IF EXISTS`:
los 6 triggers explícitamente, y la política `tenant_isolation` vía
`EXECUTE format('DROP POLICY IF EXISTS ...')` dentro del loop del bloque `DO`. Lo demás ya era
idempotente y se dejó igual: `CREATE EXTENSION`/`CREATE TABLE`/`CREATE INDEX` con `IF NOT EXISTS`,
`CREATE OR REPLACE FUNCTION`, y `ENABLE ROW LEVEL SECURITY` (no-op si ya está activo).

**El schema resultante es idéntico** — solo se agregó tolerancia a re-ejecución. Re-correrlo no
borra datos: recrea objetos de schema iguales. Igual conviene aplicar el archivo **completo de una
pasada** (no sentencia por sentencia): así el DROP+CREATE de cada trigger ocurre dentro de la misma
transacción y no queda una ventana en la que `journal_entries` esté sin su trigger de inmutabilidad.

Verificación al final del archivo, 4 queries: 5 tablas / 6 triggers / 5 políticas / FK al COA.

**Sin cambios de código, sin deploy, sin migración aplicada.** Tenant Integra:
`a0000000-0000-0000-0000-000000000001`.

## [Fix] - 2026-08-01 - Emisión FE: no mostrar "duplicado/autorizado" cuando hay códigos de rechazo

Al emitir con un RUC inválido, el diálogo mostraba **dos cosas contradictorias a la vez**:

> El PAC indicó que el documento ya existe. Posiblemente ya fue autorizado — revisá en el portal…
> · 1601: Regla de formación del RUC inválida
> · 1602: RUC inexistente en el Registro Único de Contribuyentes

La licenciada leyó "ya fue autorizado" y creyó que debía **ANULAR**, cuando era un rechazo por RUC
y bastaba corregir la ficha y reintentar.

### Diagnóstico — dos bugs sumados

1. **Substring.** `detectsDuplicate` hacía `msg.includes("existente")`, y `"RUC in`**`existente`**`"`
   contiene esa subcadena. Un código que dice **exactamente lo contrario** (el RUC *no* existe) se
   leía como "el documento ya existe". Este es el bug que disparó el caso real.
2. **Precedencia.** Usaba `.some(...)`: con UN match dudoso entre varios códigos, todo el rechazo se
   reclasificaba a `pac_duplicate` y el motivo real quedaba tapado. El mensaje se elegía con un
   ternario sobre `parsed.isDuplicate` en la orquestación, así que el texto de duplicado **sustituía**
   al resumen de códigos — pero la lista `codRes[]` se seguía renderizando aparte en el diálogo. De
   ahí que aparecieran las dos cosas juntas.

### Cambio
- **Nuevo** `src/lib/finanzas/efactura/orchestration/classify-pac-error.ts` — módulo PURO con la
  clasificación, la heurística y las guías. Fuente única: el `errorKind` que se **persiste** en
  `fe_emisiones.response_payload._meta` ya no puede divergir del que se le muestra a la usuaria.
- **Regla de precedencia**: si hay ≥1 código de rechazo duro → `pac_rejected`, y el mensaje enumera
  **solo esos** códigos (los duplicate-ish se descartan del texto). `pac_duplicate` únicamente cuando
  el PAC señala duplicado y **no** hay ningún código de rechazo.
- **Heurística arreglada**: `\bexistente\b` con límite de palabra (ya no matchea "inexistente") más
  una guarda explícita de negaciones — `inexistente`, `no existe`, `no se encuentra` nunca son
  duplicado, aunque otra subcadena matchee.
- **Códigos no-rechazo**: `0260` ("Autorizado el uso de la FE", Ficha Técnica DGI v1.00) y las
  variantes de cero no cuentan como rechazo, así que un `0260` suelto no bloquea la detección de
  duplicado legítimo.
- **Guía accionable** para 1601/1602: *"El RUC del cliente parece inválido o incompleto. Verifica el
  RUC en la ficha del cliente y reintenta."* Viaja en un campo nuevo `errorHint` de
  `EmitToEfacturaResult` y se pinta **arriba** del detalle técnico. Los códigos del PAC se siguen
  mostrando como referencia.
- **Diálogo**: renderiza `errorHint`; el bloque de "posiblemente autorizado" queda condicionado a
  `errorKind === 'pac_duplicate'`, que con el fix ya no se activa ante un rechazo.

### Nota de estilo
La guía usa **tuteo** ("Verifica… reintenta"), no el voseo del pedido original: CLAUDE.md marca el
voseo como anti-patrón y el resto del diálogo ya usa tuteo ("Verifica antes de enviar", "Revisa el
portal"). Hay un test que lo asserta. Los mensajes viejos de la orquestación siguen en voseo
("Reintentá en unos minutos") — deuda pre-existente, no se tocó en este fix.

### Sin cambios de contrato
`errorHint` es aditivo y opcional del lado del diálogo; la ruta
`/api/finanzas/invoices/[id]/emit-efactura` devuelve el result completo sin transformarlo, así que no
necesitó tocarse. **Sin migraciones, sin deploy, sin borrar data.**

### Tests (20/20 pass)
- `src/lib/finanzas/efactura/__tests__/classify-pac-error.test.ts` (16) — unitarios del clasificador:
  caso real 1601/1602, regresión del substring `inexistente`, precedencia, variantes de duplicado que
  deben seguir funcionando, `0260`, bordes sin códigos.
- `src/lib/finanzas/efactura/__tests__/emit-invoice-rechazo-vs-duplicado.test.ts` (4) — **end-to-end**
  por `emitInvoiceToEfactura` completo (fake de Supabase + stub de fetch): valida el
  `EmitToEfacturaResult` real que consume el diálogo **y** el `errorKind` persistido en `fe_emisiones`.

```
npx tsx --test src/lib/finanzas/efactura/__tests__/classify-pac-error.test.ts
npx tsx --test src/lib/finanzas/efactura/__tests__/emit-invoice-rechazo-vs-duplicado.test.ts
```

Regresión en verde: `emit-invoice-reuso-correlativo` + `map-invoice` + `validate-client-fiscal-gate`
(32/32). `tsc --noEmit` limpio.

## [Fix] - 2026-08-01 - Sincronizar `ruc` → `tax_id` (la ficha edita uno, la emisión lee el otro)

Bug estructural confirmado en prod (CLI-057 MI CONDADO): el RUC del cliente vive en **DOS columnas**
y cada mitad del sistema usa una distinta.

- La ficha (`client-form.tsx`) edita **solo `ruc`** y nunca manda `tax_id`.
- La emisión eFactura lee `client.tax_id ?? client.ruc` — o sea **PREFIERE `tax_id`**
  (`map-receptor.ts:102`, `buildRucReceptor`).

Al corregir el RUC desde la ficha, `tax_id` se quedaba con el valor viejo/incompleto y la factura
se emitía con el RUC equivocado **mostrando el correcto en pantalla**. Falla silenciosa: la única
señal era el rechazo de la DGI.

### Cambio
- **Nuevo** `src/lib/clients/ruc-sync.ts` — helper PURO (`normalizeRucInput`, `mirroredTaxId`,
  `rucFieldWrites`) para que POST y PATCH no puedan divergir. Mismo criterio que `ruc-lookup.ts`.
- **`POST /api/clients`** — el insert pasa de `ruc: ruc?.trim() || null` a `...rucFieldWrites(ruc)`:
  con RUC no vacío escribe **`ruc` Y `tax_id` con el mismo valor trimmeado**.
- **`PATCH /api/clients/[id]`** — la asignación de `ruc` se **movió DESPUÉS de la de `tax_id`** y
  ahora usa `Object.assign(updates, rucFieldWrites(ruc))`. El orden es la implementación de la
  regla de precedencia.

### Decisión: body con `ruc` y `tax_id` distintos → **gana `ruc`** (no 400)
Opción de menor riesgo, y por qué:
- **Nadie en la app manda hoy `tax_id` a estos endpoints** (único caller: `client-form.tsx`, cuyo
  payload no incluye el campo). Un 400 sería un rechazo nuevo para un escenario que solo se alcanza
  por curl/replay de la cola offline — introduce un modo de falla sin cubrir ningún caso real.
- El conflicto tiene resolución inequívoca: `ruc` es el campo que gestiona la abogada en la ficha,
  y hacerlo ganar es exactamente la invariante que arregla el bug.
- En el POST, `tax_id` del body **se sigue ignorando** (nunca se leyó ahí); comportamiento sin cambio.

### No rompe (verificado con tests)
- **Unicidad de RUC** (`findActiveClientByRuc`, compara `ruc` OR `tax_id`): con ambas columnas
  iguales el cotejo da el mismo resultado. El 409 sigue disparando antes del insert.
- **Gate fiscal FE** (valida `tax_id`): ahora `tax_id` está poblado en todo cliente creado/editado
  con RUC, así que el gate ve más data, no menos.
- **Promoción prospect→active** (exige `tax_id`): comportamiento **sin cambios**. Ojo — el gate lee
  `body.tax_id` y corre ANTES del espejo, así que mandar solo `ruc` NO lo satisface. Es la conducta
  previa, no una regresión; queda documentada en un test.

### Sin backfill (a propósito)
0 clientes divergentes hoy (CLI-057 ya se limpió a mano). Los que tienen una sola columna poblada
los resuelve `tax_id ?? ruc` sin ambigüedad. **Sin migraciones, sin deploy, sin borrar data.**

### Residual conocido (NO cubierto por este fix)
- **Vaciar el RUC en la ficha no borra `tax_id`.** `rucFieldWrites("")` devuelve `{ ruc: null }` y
  omite `tax_id` deliberadamente: destruir un `tax_id` que la pantalla nunca mostró violaría la regla
  de no borrar data. Si alguien vacía el campo, la divergencia reaparece en ese caso puntual.
- **No hay espejo inverso `tax_id` → `ruc`.** Ningún flujo de la app manda `tax_id` a estos endpoints,
  pero si mañana lo hace (ej. promoción de prospecto desde cotizaciones), la ficha mostraría el `ruc`
  viejo. La emisión sería correcta; lo que quedaría desactualizado es la pantalla.
- **Importación masiva** (`/api/import`) escribe solo `ruc`, con `tax_id` en null → `tax_id ?? ruc`
  resuelve a `ruc`. Consistente, no requiere cambio.

### Tests — `src/app/api/clients/__tests__/ruc-taxid-sync.route.test.ts` (16/16 pass)
Corre los **handlers reales** con el fake de Supabase de `ruc-unique.route.test.ts`, y para el
aserto clave llama al **mapper real** (`mapReceptor`) en vez de replicar `tax_id ?? ruc` a mano:

```
npx tsx --test --experimental-test-module-mocks \
  src/app/api/clients/__tests__/ruc-taxid-sync.route.test.ts
```

Cubre: crear con `ruc` → `tax_id` igual; editar el `ruc` → `tax_id` se actualiza; regresión CLI-057
(el RUC que emitiría el mapper es el nuevo, no el viejo); precedencia de `ruc` sobre `tax_id`;
`ruc` vacío no borra `tax_id`; PATCH ajeno no toca ninguna de las dos; gate de promoción y 409 de
unicidad intactos. Suites de regresión también en verde: `ruc-unique.route` (13/13),
`validate-client-fiscal-gate` + `map-invoice` + `import-ruc-unique` (33/33). `tsc --noEmit` limpio.

## [UX] - 2026-08-01 - Formulario de cliente: guía en el campo RUC / Cédula

Un cliente quedó cargado con el RUC **incompleto** (solo el último segmento, `691335`, en vez del
completo `1725894-1-691335`) y la DGI lo rechazó al momento de emitir. El campo era texto libre, sin
ejemplo ni ayuda: nada indicaba que se esperaban **todos** los segmentos.

### Cambio (`src/components/clients/client-form.tsx`)
- **Placeholder** del input `ruc`: `Ej. 12-345-6789` → `Ej. 1725894-1-691335 (RUC completo, sin el DV)`.
- **Texto de ayuda** nuevo debajo del campo (`text-xs text-gray-500`, mismo patrón que Tipo de persona
  y Tipo de receptor FE): aclara que se ingresa el RUC completo tal como aparece en la ficha de la DGI,
  con todos sus segmentos y guiones, y que el **dígito verificador (DV) va aparte en su propio campo**.

### Explícitamente NO se hizo
- **Sin validación de formato rígida.** Los RUCs varían según el caso (empresa, cédula, pasaporte,
  extranjero); un regex estricto rompería fichas válidas. El fix es de **guía**, no de bloqueo.
- Sin migraciones, sin cambios de backend, sin deploy. Solo `develop`.

`tsc --noEmit` limpio.

## [Feature] - 2026-07-25 - Plan de Cuentas: gestión (CRUD) de chart_of_accounts desde el CRM

El contador ya puede administrar las cuentas contables desde el CRM. Hasta ahora `chart_of_accounts`
era una tabla semilla de **solo lectura** (sin UI ni endpoints de escritura). Se agrega una pantalla
de gestión + endpoints POST/PATCH. Todo en `develop`, **sin deploy, sin migraciones, sin borrar data**
(la tabla ya existe con las columnas necesarias: `is_system`, `account_name_qb`, `description`). La
tabla se mantiene **PLANA** (sin jerarquía/`parent_id`) por ahora.

### Pantalla — `/finanzas/configuracion/cuentas`
- Server component gateado a **admin / abogada / contador** (mismo set que el resto de /finanzas);
  otros roles → redirect a `/finanzas`.
- Lista las cuentas **AGRUPADAS por tipo** en orden contable (Activo → Pasivo → Patrimonio → Ingreso →
  Gasto). Labels en **español** mapeando el valor inglés de BD (`asset|liability|equity|income|expense`).
- Cada fila muestra código, nombre, nombre QB (`account_name_qb`) y estado activo. Buscador
  client-side (código/nombre/QB/estado) con normalización sin acentos.
- Componente cliente `chart-of-accounts-manager.tsx`: crear/editar en un formulario inline y
  activar/desactivar desde la fila. Las cuentas `is_system` llevan badge **"Sistema"** con candado.

### Reglas de negocio
- **Crear**: código (único por tenant), nombre, tipo (selector español→inglés), descripción opcional,
  activa. Código duplicado → **400 accionable** (guard app-level + UNIQUE de BD como red final).
- **Editar**: nombre, tipo, descripción, activa. El **código es INMUTABLE para TODAS las cuentas**
  (no solo `is_system`): intentar cambiarlo → **400 accionable** ("El código de una cuenta no se
  puede modificar. Si está mal, desactivala y creá una nueva."). Razón: `business_expenses.chart_account_code`
  es un **FK LÓGICO sin constraint ni `ON UPDATE CASCADE`** (010_create_business_expenses.sql) →
  renombrar orfanaría en silencio los gastos que la referencian. En la UI el campo Código se muestra
  solo-lectura al editar.
- **Desactivar** (nunca hard delete): `active=false`. **Bloqueado** para cuentas `is_system=true`
  (1201, 1202, 2301, 4101, 4102 — las que usan los reportes) → **409**. Reactivar sí se permite.
- Toda mutación graba en `audit_log` (`entity='chart_of_accounts'`, action create/update con diff).

### Backend
- `types/chart-of-account.ts` — `AccountType`, labels ES, orden de tipos, `ChartAccountRow`, inputs.
- `validators/chart-of-account.ts` — `validateCreate/UpdateChartAccount` (código opcional en update).
- `queries/chart-of-accounts.ts` — `listChartAccounts` (activas + inactivas), `getChartAccountById`,
  `findChartAccountByCode` (unicidad). Independiente de `queries/catalogs.ts:listAccountsActive`
  (que sigue sirviendo los comboboxes de facturas/cotizaciones, solo activas).
- `api/chart-of-accounts.ts` — `createChartAccount` / `updateChartAccount` (MutationError + audit).
- Endpoints: `GET|POST /api/finanzas/configuracion/chart-of-accounts` y
  `PATCH /api/finanzas/configuracion/chart-of-accounts/[id]`, con `getAuthenticatedContext` +
  `requireRole(['admin','abogada','contador'])` y filtro por tenant.
- Sidebar: nueva entrada **"Plan de Cuentas"** en el tab Finanzas (admin/abogada/contador).

### Tests (node:test + tsx) — `chart-of-accounts.route.test.ts`, 12 pasan
- Validadores puros: crear válida normaliza; sin código → error; tipo en español crudo → error;
  código con caracteres inválidos → error; update sin código → ok.
- Handlers (requieren `--experimental-test-module-mocks`): crear código duplicado → 400 (no inserta);
  crear válida → 201 (`is_system=false` + audit); editar → 200; desactivar `is_system` → 409 (no
  actualiza); cambiar el código de una cuenta **normal** → 400 (código inmutable, no actualiza); rol
  asistente en POST/PATCH → 403.
- `npx tsc --noEmit` → exit 0. `eslint` sobre los archivos nuevos → exit 0.

## [Feature] - 2026-07-18 - RUC único: no permitir clientes con RUC duplicado (todas las vías)

CLI-116 (INMOBILIARIA CAMAY) se creó con el mismo RUC que CLI-104 ya existente, sin ninguna
alerta → duplicado que confundió a la licenciada y hubo que limpiar a mano. El `POST /api/clients`
solo validaba unicidad de `client_number`, **nunca del RUC**. Regla nueva: un RUC ya usado por un
cliente **ACTIVO** no puede volver a ingresarse. El RUC vive en `ruc` (legacy) o `tax_id` (nuevos)
→ se chequea contra AMBAS. Todo en `develop`, sin deploy, sin migraciones, sin índice único en BD.

### Helper único — `src/lib/clients/ruc-lookup.ts`
- `findActiveClientByRuc(admin, tenantId, ruc, excludeClientId?)` → devuelve `{id, client_number, name}`
  del cliente ACTIVO que ya usa ese RUC (contra `ruc` OR `tax_id`, trim), excluyendo inactivos y el
  `excludeClientId` opcional. Núcleo PURO (`findActiveClientMatch` / `normalizeRucKey` / `clientMatchesRuc`)
  testeable sin BD; el wrapper hace el I/O. Fuente única para las 3 vías.
- `rucConflictMessage(existing)` → mensaje accionable en tuteo neutro que NOMBRA la ficha.

### `POST /api/clients`
- Si el body trae RUC no vacío y el helper encuentra un cliente activo → **409** con `error`,
  `fieldErrors.ruc` y `existingClient: {id, client_number, name}`. No inserta.

### `PATCH /api/clients/[id]`
- Si el edit cambia el RUC a uno que ya usa OTRO cliente activo (`excludeClientId = id` propio) →
  mismo **409** accionable. Reguardar sin cambiar el RUC no se auto-bloquea.

### Importación masiva (`validateImport` + `/api/import`)
- El fetch de existentes ahora trae `id, tax_id, client_status`. Una fila cuyo RUC ya está en un
  cliente ACTIVO de la BD (contra `ruc` OR `tax_id`) → **NO se importa**, error accionable
  "RUC ya registrado en CLI-XXX (NOMBRE)". Antes era una señal blanda (bucket `duplicateClients`).
- Dos filas con el **mismo RUC dentro del archivo** → la 2da (y siguientes) NO se importan
  (antes era solo warning). La 1ra se conserva.
- **Bug latente corregido**: la plantilla oficial usa el header acentuado `RUC/Cédula`, que NO
  matcheaba el mapa de columnas (solo tenía `ruc/cedula` sin acento) → el RUC nunca se parseaba en
  importación real. Agregados los alias `ruc/cédula` y `cédula`. Sin esto la unicidad de RUC en
  importación estaría muerta con la plantilla oficial.

### UI — `client-form.tsx`
- Ante el 409, el mensaje se muestra bajo el campo RUC (salta al paso 0) con un botón
  **"Abrir CLI-XXX"** que navega a la ficha existente (`existingClient.id`). Sin flujo de override:
  el objetivo es frenar el duplicado. Al editar el RUC se limpia el conflicto.

### Tests (node:test + tsx)
- `src/app/api/clients/__tests__/ruc-unique.route.test.ts` (13; los de handler requieren
  `--experimental-test-module-mocks`): núcleo puro (match por `ruc`/`tax_id`, trim, inactivo libre,
  `excludeClientId`); POST con RUC activo → 409 nombrando la ficha (no inserta); POST RUC nuevo → 201;
  POST RUC de inactivo → 201; PATCH con RUC de otro activo → 409 (no actualiza); PATCH sin cambiar RUC
  → 200.
- `src/lib/utils/__tests__/import-ruc-unique.test.ts` (5): RUC ya registrado (por `ruc` y por
  `tax_id`) → fuera de `validClients` + error; RUC de inactivo → permitido; RUC nuevo → permitido;
  dos filas con mismo RUC → 2da fuera con error.
- Regresión verde: `import-client-type` (4) y `client-type.route` (8). `tsc --noEmit`: exit 0.
- Lint: sin errores nuevos (2 preexistentes en `import-parser.ts:254` y `client-form.tsx:51`, ya en HEAD).

## [Fix] - 2026-07-16 - Regresión Fase 1: asistente bloqueado al cambiar estado de caso (gate de rol por acción)

La Fase 1 de seguridad restringió TODO `PATCH /api/cases/[id]` a [admin, abogada]. Pero
`<CaseStatusChanger>` se le renderiza al ASISTENTE sin gate (a diferencia de `DeleteCaseButton`)
y hace `PATCH` con `action="change-status"`. CLAUDE.md permite al asistente "actualizar estado" de
sus casos asignados → con la Fase 1 recibía **403** y se le rompía el flujo diario. NO se desplegó;
corregido antes del merge. Todo en `develop`, sin deploy, sin migraciones.

### Fix — `PATCH /api/cases/[id]` gatea por ACCIÓN
- El body se parsea ANTES del check de rol (seguro: ya autenticado, solo se lee el JSON).
- `action === "change-status"` → [admin, abogada, **asistente**]; cualquier otra edición → [admin, abogada].

### Revisión amplia (matriz Fase 1 vs. UI real)
Se cruzó cada endpoint restringido con los componentes que lo llaman y su gating de render. Único
rol *legítimo* bloqueado: el asistente en change-status (este fix). Hallazgo secundario (NO tocado,
reportado a Oliver): `<InlineCaseInfoEditor>` muestra "Editar Información" al asistente sin gate →
al guardar da 403 (edición completa NO es acción legítima del asistente; es UX, no regresión de
permiso). El resto de controles restringidos ya están ocultos por `nav-config.ts` (Clientes,
Prospectos, Importar fuera del asistente) y/o gates `userRole` en las páginas.

### Tests (node:test + tsx)
- `src/app/api/cases/__tests__/patch-role-by-action.test.ts` (4, requieren
  `--experimental-test-module-mocks`; sin flag se skipean): asistente + change-status → 200
  (persiste status_id); asistente + edición completa → 403 (no actualiza); contador + change-status
  → 403; abogada + change-status → 200.
- `authz-guards.test.ts`: la entrada `PATCH /api/cases/[id]` se dividió en "(edición general)" =
  [admin, abogada] y "(change-status)" = [admin, abogada, asistente] para reflejar el gate por acción.
- Suite completo con flag: **116 tests, 116 pass, 0 fail**. `tsc --noEmit`: exit 0.

## [Fix] - 2026-07-16 - Cerradas las 2 vías restantes que dejaban client_type NULL (conversión de prospecto + importación masiva)

El fix anterior cerró `/clientes/nuevo`, pero quedaban DOS vías que seguían creando clientes con
`client_type` NULL (y rompían la emisión de FE con "Error interno"): la conversión de prospecto a
cliente y la importación masiva. Todo en `develop`, sin deploy, sin migraciones.

### Verificación de schema (previa)
- La tabla legal `prospects` (Kanban, migración `20260403000012`) **NO tiene `client_type`** —
  es OTRA cosa que el "prospecto" del flujo de cotizaciones (ese es un `clients` con
  `client_status='prospect'` y ya setea `client_type`). `client_type` vive solo en `clients`
  (`20260508000001`). → La conversión debe **capturar** el tipo, no arrastrarlo. Sin cambio de schema.

### Conversión de prospecto (`POST /api/prospects/[id]/convert`)
- El handler ya no ignora el body (`_request` → `request`): ahora **exige `client_type`** en el
  body y lo valida con `validateClientType()` (400 accionable si falta/es inválido). Lo persiste
  en el `clients` insert.
- UI `prospect-pipeline.tsx`: "Crear como Cliente" ahora abre un selector inline
  **Persona natural / Persona jurídica** (requerido) que dispara la conversión con el tipo elegido.

### Importación masiva (`import-parser.ts` + `POST /api/import`)
- Nueva columna **"Tipo Fiscal"** (Natural/Jurídica) en la plantilla descargable, obligatoria para FE.
- `ImportClientRow.client_type` se deriva de "Tipo Fiscal" y, en su defecto, de la legacy "Tipo"
  (vía `normalizeClientType()`, nuevo helper puro en `fiscal-fields.ts`). "Retainer" NO es tipo de
  persona → no deriva.
- `validateImport()` marca error accionable por fila si no se pudo determinar el tipo; esas filas
  quedan fuera de `validClients` (no se insertan).
- **Cambio de comportamiento (flag):** el path que auto-creaba un cliente cuando un caso
  referenciaba un cliente inexistente **ya no auto-crea** (no había forma de darle un `client_type`
  válido). Ahora ese caso **falla con mensaje accionable** pidiendo agregar el cliente a la hoja
  "Clientes" con su tipo. Reversible si se decide otra política.
- Helper puro nuevo `normalizeClientType()` en `src/lib/clients/fiscal-fields.ts`.

### Tests (node:test + tsx)
- `src/lib/utils/__tests__/import-client-type.test.ts` (4, siempre corren): deriva de "Tipo Fiscal",
  fallback a "Tipo", fila sin tipo → error accionable (fuera de validClients), fila válida → con tipo.
- `src/app/api/prospects/__tests__/convert-client-type.test.ts` (4, requieren
  `--experimental-test-module-mocks`; sin el flag se skipean): convertir sin `client_type` → 400
  (no inserta); inválido → 400; cada valor válido → 201 con el cliente creado CON `client_type`.
- Suite completo con flag: **110 tests, 110 pass, 0 fail**. Sin flag: 101 pass, 9 skipped, 0 fail.
  `tsc --noEmit`: exit 0. Lint de archivos tocados limpio (queda 1 error preexistente ajeno:
  `sheetName` sin usar en la firma de `parseImportFile`).

### Limpieza incidental
- Removidos 2 imports de tipo muertos (`ImportClientRow`, `ImportCaseRow`) en `import/route.ts`.

## [Fix] - 2026-07-16 - client_type OBLIGATORIO en el form/API de cliente (causa raíz del "Error interno" al facturar)

Dos facturas fallaron con "Error interno" en dos días (CLI-116 el 13/07, CLI-121 el 16/07)
porque el cliente receptor tenía `client_type` NULL. `buildRucReceptor` (map-receptor.ts:91)
lanza cuando `client_type` es NULL para receptor 01/03, y la emisión de FE muere.

**Causa raíz:** el form de cliente (`client-form.tsx`) NUNCA seteaba `client_type` — solo lo
LEÍA para sugerir `tipo_receptor_fe`. Y el `POST /api/clients` ni siquiera lo aceptaba en el
body. Resultado: TODO cliente creado desde `/clientes/nuevo` entraba con `client_type` NULL.
El flujo de cotizaciones sí lo exigía (quote-form / quotes.ts); este cambio lleva esa misma
regla al alta/edición de clientes. Todo en `develop`, sin deploy, sin migraciones.

### Cambios
- **`src/lib/clients/fiscal-fields.ts`** — nuevo validador puro `validateClientType(value)`
  (+ `CLIENT_TYPE_VALUES`, tipo `ClientType`). Fuente única usada por POST y PATCH. Retorna
  mensaje accionable si falta / es inválido, o `null` si ok.
- **`src/components/clients/client-form.tsx`** — selector `Tipo de persona` OBLIGATORIO
  (persona_natural | persona_juridica) en el paso 0, en crear Y editar. Al cambiarlo alimenta
  el default de `tipo_receptor_fe` vía `suggestTipoReceptorFe()` (juridica→01, sin pisar una
  selección explícita). Validación en `validateStep(0)` + `client_type` en el payload.
- **`POST /api/clients`** — acepta, valida (presencia + dominio) y persiste `client_type`.
  Falta/invalid → 400 con `fieldErrors.client_type`.
- **`PATCH /api/clients/[id]`** — se endureció el check existente: si se envía `client_type`,
  ya no puede ser null/vacío/inválido (un edit que lo borrara reintroduciría el bug). El único
  caller del PATCH es el propio form, que ahora siempre manda un valor válido.
- NO se tocó la columna legacy `type` ni su lógica (cambio aditivo).

### Tests — `src/app/api/clients/__tests__/client-type.route.test.ts` (node:test + tsx)
- 3 unit del validador puro (falta → error, inválido → error, cada valor válido → ok).
- 5 sobre los handlers reales POST/PATCH con fake de Supabase vía `mock.module`:
  crear sin client_type → 400 (no inserta); crear con cada valor válido → 201 (persiste);
  editar cambiando client_type → 200 (persiste); editar borrándolo (null) → 400 (no actualiza).
- Los 5 de handlers requieren `--experimental-test-module-mocks`; sin el flag se **skipean**
  (no fallan) y quedan los 3 puros. Suite completo: 102 tests, 97 pass, 0 fail, 5 skipped.
  Con flag sobre el archivo: 8/8 pass. `tsc --noEmit`: exit 0.

### Pendiente (no técnico)
- Backfill de `client_type` para los ~5 clientes legacy con NULL (CLI-068, 093, 094, 120, y el
  ya corregido 121). Cuando se editen desde la UI, el form ahora los fuerza a completarlo.

## [Security] - 2026-07-14 - Autorización por rol + anti-IDOR en endpoints legales /api

El middleware protege páginas pero NO gatea `/api/**`; el rol se valida dentro de cada
handler. Los endpoints de finanzas ya validaban rol; los legales en su mayoría NO → un
`asistente` o `contador` podía mutar recursos legales por API directa. Además había 2 IDOR
de escritura. Este cambio aplica la matriz de roles y cierra los IDOR. Todo en `develop`,
sin deploy, sin migraciones.

### Helpers nuevos — `src/lib/supabase/server-query.ts`
- `requireRole(role, allowed)` → devuelve un 403 estandarizado (`{ error: "Sin permiso" }`,
  status 403) cuando el rol no está en `allowed`, o `null` cuando pasa. Forma de menor riesgo:
  puramente aditiva (`const denied = requireRole(...); if (denied) return denied;`), no altera
  el flujo de los roles permitidos. Falla CERRADO ante rol null/desconocido. Reusable por el
  patrón finanzas (`getAuthenticatedContext`) y el patrón legal inline.
- `requireEntityInTenant(db, table, id, tenantId, notFoundMessage?)` → guard anti-IDOR:
  verifica pertenencia al tenant con un `SELECT id ... eq(id).eq(tenant_id).maybeSingle()` y
  devuelve 404 si la fila no existe o es de otro tenant. Espeja el patrón correcto ya presente
  en `cases/[id]/comments/route.ts`.

### Matriz de roles aplicada (agregado el check de rol; varios ya seleccionaban `role` sin usarlo)
- `POST /api/clients` → [admin, abogada]
- `PATCH` + `DELETE /api/clients/[id]` → [admin, abogada]
- `POST /api/cases` → [admin, abogada]
- `PATCH /api/cases/[id]` → [admin, abogada]
- `POST /api/prospects` → [admin, abogada]
- `PATCH` + `DELETE /api/prospects/[id]` → [admin, abogada]
- `POST /api/prospects/[id]/convert` → [admin, abogada]
- `POST /api/comments` → [admin, abogada, asistente] (contador queda fuera)
- `POST /api/documents/register` → [admin, abogada, asistente] (contador queda fuera)

### IDOR de escritura cerrados
- `POST /api/comments`: antes insertaba con el `case_id` del body SIN verificar pertenencia →
  un usuario podía comentar en el caso de otro tenant. Ahora verifica el caso por
  (id=case_id, tenant_id) antes del insert; si no existe → 404.
- `POST /api/documents/register`: solo validaba que `storage_path` empezara con el tenant_id,
  pero NO que `entity_id` perteneciera al tenant. Ahora mapea `entity_type` → tabla
  (client→clients, case→cases, task→tasks, comment→comments, quote→quotes, invoice→invoices;
  `entity_type` desconocido → 400) y verifica (id=entity_id, tenant_id) antes del insert; si no
  existe → 404.

### NO tocado (anotado, sin cambios)
- No se modificó el middleware ni los endpoints de finanzas (ya validaban rol).
- Los `GET` de listado no se tocaron (fuera del alcance; la tarea es sobre mutaciones legales).

### Tests — `src/lib/supabase/__tests__/authz-guards.test.ts` (nuevo, 29 tests)
- Por cada endpoint tocado: caso rol-no-permitido → 403 y caso rol-permitido → OK, con su lista
  `allowed` exacta. Más: falla-cerrado ante rol null/desconocido; `contador` bloqueado en todos
  los endpoints legales.
- IDOR: entidad/caso de OTRO tenant → 404; mismo tenant → OK; inexistente → 404 (con fake del
  builder de Supabase).
- Nota de alcance: los route handlers de Next no se drivean end-to-end (`next/headers`
  `cookies()` lanza fuera de un request scope, y el runner no soporta module-mocks que compongan
  con tsx). La lógica de autorización agregada vive 100% en los dos helpers, que sí son
  deterministas; cada handler delega su decisión a ellos.
- Suite repo-wide: **94/94 pass**. `tsc --noEmit`: limpio (exit 0).

## [Fix] - 2026-07-14 - eFactura: REUSO del correlativo — el número no autorizado ya no se quema por reintento

El PAC (Ideati) confirmó las reglas de numeración del `numeroDocumento` FE por punto de
facturación: (a) no tiene que ser estrictamente consecutivo, pero (b) debe ir ascendente,
(c) los saltos no deben ser amplios, y (d) **los números que nunca recibieron CUFE SE PUEDEN
REUTILIZAR**. Este cambio hace que el asignador reuse el número reservado en los reintentos,
para que los saltos queden en ~0.

### Root cause del salto 3-4-5 en el punto 051 (FAC-REI-000039)
- La orquestación ya tenía la lógica de reuso D-3 (`emit-invoice-to-efactura.ts`): si la
  factura queda en `fe_estado='error'` con `punto_facturacion`/`numero_documento`
  persistidos, el reintento REUSA ese número en vez de allocar uno nuevo.
- **Pero nunca era alcanzable ante el bug de `client_type`.** El orden era: T1 `allocateFeNumero`
  (quema el número, commit del RPC) → mapper (`mapInvoiceToEfacturaRequest`, PURE) → T2 UPDATE
  `invoices` que reservaba el número y marcaba `pending`. El mapper (`buildRucReceptor`,
  `map-receptor.ts:91`) lanzaba **antes de T2**, así que el número asignado NO se persistía en
  la factura y `fe_estado` quedaba en `no_emitida`. En el reintento, la condición de reuso D-3
  (`fe_estado === 'error'` + número persistido) era falsa → allocaba OTRO número.
- Efecto real: los 3 reintentos fallidos de FAC-REI-000039 quemaron 3, 4 y 5; la emisión
  exitosa (tras corregir `client_type` en CLI-116) quedó en el 6. Autorizadas: 1, 2, 6.

### Changed — `src/lib/finanzas/efactura/orchestration/emit-invoice-to-efactura.ts`
- Se **mueve la reserva del correlativo (UPDATE `invoices` → `pending` + `punto`/`numero`) a
  ANTES del mapper** (nuevo paso T1.5). El número queda guardado en la factura apenas se
  asigna, antes del primer punto que puede lanzar.
- El mapper se envuelve en `try/catch`: si lanza, se deja la factura en `fe_estado='error'`
  (best-effort) con el número ya reservado y se re-lanza como `MutationError(500)`. El
  reintento entra por la rama de reuso D-3 y reusa ESE mismo número, sin volver a llamar al
  allocator.
- Resultado: **cada factura quema como máximo UN correlativo**, reusado en todos sus
  reintentos hasta autorizar → saltos ~0 aun ante rachas de fallos. Nunca se reusa un número
  ya autorizado con CUFE (la factura autorizada queda fuera del gate T0 y el allocator sólo
  incrementa).

### NO cambiado (decisión) — la RPC `allocate_fe_numero` queda igual
- No se modificó la numeración fiscal en BD. La RPC sigue siendo el UPSERT atómico ascendente
  de `sql/pending/020_efactura_allocator.sql`. El reuso se resuelve enteramente en la
  orquestación (a nivel factura), que es el caso reportado ("el siguiente intento lo reusa").
- Reuso **entre facturas distintas** (reclamar el número de una factura definitivamente
  abandonada para otra factura nueva) NO es seguro sin una señal explícita de descarte: el
  número reservado de una factura en `error` está reclamado por su propio reintento (D-3), así
  que un allocator que lo "libere" colisionaría con ese reintento. Queda como trabajo futuro
  (requiere estado `descartada`/void). El residuo actual —una factura abandonada deja UN hueco—
  cae dentro de la tolerancia DGI (1-4).

### Tests — `src/lib/finanzas/efactura/__tests__/emit-invoice-reuso-correlativo.test.ts` (nuevo, 4 tests)
- Intento fallido por el mapper deja el número RESERVADO (no lo quema) y `fe_estado='error'`.
- El siguiente intento REUSA el mismo número sin volver a allocar (D-3).
- Un número ya autorizado (con CUFE) nunca se re-emite ni se re-allocatea (gate T0).
- Atomicidad: el guard de la reserva rechaza (409) al proceso que perdió la carrera.
- Suite eFactura completa: **32/32 pass**. `tsc --noEmit`: limpio (exit 0).

### Pendiente (Oliver, cambio fiscal — pausa obligatoria)
- Ninguno para producción en este cambio: es code-only en `develop`, sin migración. Si en el
  futuro se quiere reuso entre facturas, hay que diseñar el estado de descarte + revisar la RPC.

## [Fix] - 2026-07-13 - Gate fiscal eFactura valida `client_type` (receptor 01/03)

Fix del incidente reportado por la licenciada al intentar emitir al PAC la factura
`FAC-REI-000039` (receptor CLI-116 "INMOBILIARIA CAMAY, S.A."): el diálogo devolvía
un genérico **"Error interno"** 500 en vez de un mensaje accionable.

### Root cause
- El receptor CLI-116 es tipo `01` (contribuyente RUC) pero tenía `client_type = NULL`
  (uno de ~30 clientes legacy sin `client_type` poblado tras las importaciones).
- `validateClientFiscalGate` (`src/lib/finanzas/efactura/data/fetch-invoice-efactura-bundle.ts`)
  **no** validaba `client_type`, así que el cliente pasaba el gate.
- Luego el mapper puro `buildRucReceptor` (`src/lib/finanzas/efactura/mapper/map-receptor.ts:90-96`)
  usa `client_type` para derivar el `tipoContribuyente` del receptor y lanza un `Error`
  PLANO (no `MutationError`) cuando falta. El route (`emit-efactura/route.ts:42-55`) degrada
  cualquier throw no-`MutationError` a "Error interno" 500. Verificado en prod: 0 filas en
  `fe_emisiones` para esa factura (el throw ocurre en el mapper, antes de T2).
- La correlación aparente "REI falla / HON funciona" era **coincidental**: todas las
  emisiones HON exitosas fueron a clientes con `client_type` poblado. Cualquier factura
  (HON o REI) a un receptor 01/03 con `client_type` NULL fallaba igual.

### Changed
- `validateClientFiscalGate` ahora exige `client_type` **solo** para `tipo_receptor_fe`
  `01` (contribuyente) y `03` (gobierno) — los únicos que llaman `buildRucReceptor`. Si
  falta, suma `"tipo de contribuyente (persona natural/jurídica)"` al array `missing` y sale
  como `MutationError(400)` accionable ANTES de llegar al mapper. Los tipos `02` (consumidor
  final) y `04` (extranjero) NO lo requieren y no se ven afectados.
- El throw del mapper (`map-receptor.ts:91`) se deja intacto como defensa en profundidad.

### Tests
- `src/lib/finanzas/efactura/__tests__/validate-client-fiscal-gate.test.ts`:
  - Fixture base `receptor01SinUbicacion()` ahora incluye `client_type: "persona_juridica"`.
  - Nuevo caso negativo: receptor `01` con `client_type` NULL → `MutationError 400` mencionando "tipo de contribuyente" (caso FAC-REI-000039).
  - Nuevo caso negativo: receptor `03` con `client_type` NULL → `MutationError 400`.
  - Nuevo caso de control: receptor `02` con `client_type` NULL → NO falla.
  - `17/17` verde. `tsc --noEmit` limpio (exit 0).

### Pendiente operativo (NO incluido en este cambio)
- Backfill de `client_type` para los ~30 clientes legacy con NULL (dato, no código). El
  fix solo cambia el mensaje de error; la abogada aún debe completar `client_type` en el
  cliente para poder emitir. Hay un `sql/pending/hotfix_cli116_client_type.sql` sin revisar.

## [Hotfix] - 2026-06-04 - Allocator atómico de `client_number` (numbering_sequences)

Hotfix del incidente reportado por Daveiva al crear una cotización con prospecto nuevo:
`duplicate key value violates unique constraint idx_clients_number_tenant`.

### Root cause
- Algoritmo `ORDER BY client_number DESC LIMIT 1` + `regex /CLI-(\d+)/` + `max+1` con sort lexicográfico sobre TEXT. Filas con prefijo lex-mayor que `CLI-` (fixtures `TEST-FE-001/002` de la integración eFactura) ganaban el ORDER BY; el regex no matcheaba; fallback `nextNum=1` → colisión con el `CLI-001` ya existente.
- Bug latente adicional: `CLI-1000` queda lex-menor que `CLI-999` (rompe en el primer cliente que cruce el milar). Race condition entre requests concurrentes ya documentada en el código viejo.

### Added
- `src/lib/clients/numbering.ts` — módulo centralizado:
  - `allocateClientNumber(db, tenantId)` — consume secuencia atómicamente vía RPC `get_next_sequence_number` (SELECT FOR UPDATE + UPDATE server-side; misma RPC que facturas y cotizaciones).
  - `previewNextClientNumber(db, tenantId)` — lee `last_number + 1` sin consumir (sugerencia visual para el form).
  - `formatClientNumber(n)` — `CLI-{padStart 3}`. Comparación INT, sin overflow lex en `CLI-1000`.

### Changed
- Reemplazo de las **5 copias** del algoritmo viejo por el allocator (cero referencias a `order("client_number")` o `match(/CLI-/)` en `src/` post-cambio):
  - `src/app/api/clients/route.ts` — GET (sugerencia) + POST (auto-generate, branch custom-number sin cambios).
  - `src/lib/finanzas/api/quotes.ts` — `insertProspectClient` (helper `generateNextClientNumber` eliminado).
  - `src/app/api/prospects/[id]/convert/route.ts` — convert prospect → cliente.
  - `src/app/api/import/route.ts` — loop principal de clientes **y** auto-create dentro del loop de cases.

### Migración requerida (NO ejecutada en este commit)
- `sql/pending/021_client_numbering_sequence.sql`:
  - `ALTER TABLE numbering_sequences DROP/ADD CONSTRAINT numbering_sequences_sequence_type_check` → agrega `'client'` a la lista existente (`'quote'`, `'invoice_hon'`, `'invoice_reim'`, `'credit_note'`).
  - `INSERT … ON CONFLICT DO NOTHING` por tenant con `last_number = COALESCE(MAX((regexp_match(client_number, '^CLI-(\d+)$'))[1]::INT), 0)` filtrando `client_number ~ '^CLI-\d+$'` para excluir `TEST-FE-*` y prefijos no canónicos.
  - Idempotente; BEGIN/COMMIT explícito; bloque ROLLBACK comentado al final.

### ⚠️ DEPLOY ORDER (no negociable)
1. **Ejecutar la migración 021 en Supabase prod PRIMERO** (manual, SQL Editor).
2. Verificar con los SELECTs del bloque VERIFICACIÓN: `'client'` en el CHECK, fila seedeada con `last_number ≈ 75` para el tenant de Integra Legal, cross-check vs MAX real.
3. **Después** mergear `develop → main` para gatillar el auto-deploy de Vercel.

Si el código entra vivo antes de seedear la fila, `get_next_sequence_number(tenant, 'client')` lanza `no_data_found` y rompe TODO flujo de creación de cliente (Clientes, Cotizaciones prospect-inline, Prospectos convert, Import masivo).

### Mitigación previa recomendada (opcional, NO incluida en el script)
- Renombrar las filas `TEST-FE-001` / `TEST-FE-002` a un prefijo lex-bajo (ej. `0TEST-FE-001`). Cosmético — el filtro del seed ya las excluye, pero limpia reportes que ordenen por `client_number`. UPDATE de 2 filas, FKs intactas.

### Verified
- `npx tsc --noEmit` limpio (0 errores).
- Grep en `src/`: 0 matches de `order("client_number"` y 0 matches de `match(/CLI-`. La única referencia textual al patrón viejo es el comentario explicativo dentro de `numbering.ts`.

## [Sprint 2E.3.2] - 2026-05-14 - Campo `title` obligatorio en cotizaciones

### Added
- Columna `quotes.title TEXT NOT NULL` con CHECK `quotes_title_length` (3-100 chars). Migración `sql/pending/007_quotes_title_required.sql` (ya ejecutada por Oliver en Supabase). Backfill: 4 cotizaciones legacy reciben título auto-generado `'Cotización {cliente} {DD/MM/YYYY}'`.
- Constantes `QUOTE_TITLE_MIN` (3) y `QUOTE_TITLE_MAX` (100) en `src/lib/finanzas/types/quote.ts`, compartidas client + server para mantener client-side y CHECK en lock-step.
- Validación `validateTitle()` en `src/lib/finanzas/api/quotes.ts` aplicada en `validateCreateQuote` y `validateUpdateQuote` (trim antes de validar; vacío == requerido).
- Input visible en `quote-form.tsx` con counter `N/100`, error inline, placeholder en tuteo neutro panameño ("Ej: Naturalización Adrian Fu - 1ra cotización").

### Changed
- Listado `quotes-list.tsx`: columna Cliente ahora muestra 3 líneas — nombre (font-medium), título (text-sm gris, ellipsis + tooltip nativo), client_number (10px mono). Mobile cards: título como tercera línea entre cliente y "Vence …".
- Detalle `/finanzas/cotizaciones/[id]`: título como subtítulo prominente `text-lg font-semibold text-gray-700 line-clamp-2` debajo del `COT-XXXXXX`.
- PDF `QuoteDocument.tsx`: banda full-width con título en `Helvetica-Oblique 11pt navy` debajo del header navy/gold. El título entra al hash SHA-256 del PDF, así que si cambia, el PDF se regenera (vía `quote-pdf-hash.ts`).
- Email subject: `Cotización COT-XXXXXX: {título} · Integra Legal` cuando hay título; fallback al subject anterior si no.
- Email HTML: párrafo italic semibold con el título debajo del saludo "Estimado/a …".
- Email texto plano: línea "Referencia: {título}" antes del cuerpo principal.
- Portal público `/cotizacion/[token]/page.tsx`: SELECT trae `title`; aparece como `italic text-base text-gray-600` debajo del `COTIZACIÓN COT-XXXXXX` del header centrado.
- Helpers de query `listQuotes`, `getQuoteById`, `getQuoteByPublicToken` incluyen `title` en el SELECT.
- Rutas `/api/finanzas/quotes/[id]/send` y `/api/finanzas/quotes/[id]/resend` propagan `bundle.quote.title` al `QuoteEmailProps`.

### Verified
- `npx tsc --noEmit` limpio (0 errores).
- `npx next lint` limpio en los 8 archivos del sprint.
- `npx next build` limpio (production).
- Voseo audit (regex completa CLAUDE.md): 0 hits en `src/`.
- Smoke visual aprobado por Oliver: 6/6 tests OK (listado desktop, listado mobile, detalle, PDF, email, portal público).
- Vercel preview deploy success (sha `31b5995`).

### SHAs
- `a5ef205` chore - remove endpoint debug test-resend post-hotfix
- `ff80542` feat - migración SQL agregar columna title obligatoria
- `25cf13d` feat - backend campo title obligatorio + input en form
- `31b5995` feat - UI título en listado/detalle/PDF/email/portal

### Pendiente operativo (no técnico)
- Confirmar con licenciadas el email de contacto del portal público. Hoy está hardcoded `contacto@integra-panama.com` en `src/app/cotizacion/[token]/page.tsx`, que probablemente no existe. Cambio de una sola línea cuando lo confirmen.

## [Sprint 2E.3 — Fase F] - 2026-05-14 - PDF Cotizaciones (polish + voseo + smoke)

### Changed
- src/lib/finanzas/email/quote-email-template.ts: "Si tenés" → "Si tienes" (voseo argentino → tuteo neutro panameño). 2 ocurrencias (HTML + texto plano).

### Verified (smoke trace mental)
- Crear quote borrador → "Descargar PDF" → regenerated=true. PDF abre en pestaña.
- Editar quote → "Descargar PDF" → regenerated=true (hash cambió).
- Click "Descargar PDF" sin editar → regenerated=false (cache hit).
- "Enviar" → email con PDF adjunto + transición a 'enviada'. Si Resend falla, banner ámbar en el dialog con link público copiable como fallback.
- /legal/clientes/[id] muestra el PDF de la cotización con pill violeta "PDF Cotización COT-XXXXXX". No tiene botón eliminar.
- /api/documents/[id]/delete rechaza con 403 si source != 'manual'.
- Borrar quote en borrador limpia documents row + storage blob.

### Verified (técnico)
- tsc --noEmit limpio (0 errores).
- next lint limpio en los 17 archivos del Sprint 2E.3.
- next build limpio (production, sin warnings nuevos).
- Voseo audit (regex completa del CLAUDE.md): 0 hits.

## [Sprint 2E.3 — Fase E] - 2026-05-14 - PDF Cotizaciones (visibilidad doble + bloqueo delete manual)

### Changed
- /legal/clientes/[id]: la sección Documentos ahora trae también los PDFs auto-generados de cotizaciones del cliente. Dos queries (entity_type='client' + entity_type='quote' IN quotes_of_client) mergeadas y ordenadas por fecha.
- document-row.tsx: prop opcional `badge` (string). Cuando viene, se muestra una pill violeta arriba del filename y el row cambia de paleta (border-violet-200, FileText icon). Indica documentos auto-generados.
- /api/documents/[id]/delete: rechaza con 403 si el row tiene source != 'manual'. Mensaje explica que se gestionan automáticamente.
- src/lib/finanzas/api/quotes.ts → deleteQuote(): antes de borrar el quote, limpia documents rows con source='auto_quote_pdf' (DB + storage blob). Evita filas huérfanas y archivos olvidados.

## [Sprint 2E.3 — Fase D] - 2026-05-14 - PDF Cotizaciones (UI descarga + SendDialog actualizado)

### Added
- download-pdf-button.tsx — botón "Descargar PDF" disponible en todos los estados del detalle. Loading state, toast verde si regenerated=true, toast rojo si falla. Abre en pestaña nueva.

### Changed
- /finanzas/cotizaciones/[id]: DownloadPdfButton agregado al header de acciones.
- send-quote-dialog.tsx: step 1 actualizado para reflejar que envía email + PDF; step 2 (success) muestra banner verde si email_sent=true (con email destinatario + indicador "PDF adjunto"), o banner ámbar si falló con fallback al link público copiable. La cotización queda enviada en BD en ambos casos.
- quote-success-toast.tsx: mensaje del query param ?sent=1 actualizado a "Cotización enviada por email".

## [Sprint 2E.3 — Fase C] - 2026-05-14 - PDF Cotizaciones (email Resend + integración /send)

### Added
- src/lib/finanzas/pdf/ensure-quote-pdf.ts — ensureQuotePdfRow (compartido /pdf y /send) + downloadQuotePdfBuffer
- src/lib/finanzas/email/quote-email-template.ts — renderQuoteEmailHtml + renderQuoteEmailText (HTML para Resend con paleta Integra, CTA al portal público, tuteo neutro panameño)
- src/lib/finanzas/email/send-quote-email.ts — sendQuoteEmail wrapper sobre Resend con PDF adjunto en base64

### Changed
- /api/finanzas/quotes/[id]/send: ahora genera/recupera el PDF actual (via ensureQuotePdfRow), aplica la transición de estado y envía el email vía Resend. Email es best-effort: si falla, el quote queda enviado y la response retorna { email_sent: false, email_error }. Permite al operador reenviar o compartir el link público manualmente.
- /api/finanzas/quotes/[id]/pdf: refactor para usar ensureQuotePdfRow (mismo comportamiento user-facing).

### Notes
- DNS de Resend para integra-panama.com pendiente de Edwin. El código queda code-complete; el envío real fallará silenciosamente hasta que se verifique DNS (la cotización igual queda marcada como 'enviada' y la abogada puede compartir el link público).
- APP_BASE_URL se lee de NEXT_PUBLIC_APP_URL (mismo patrón que daily-summary cron).

## [Sprint 2E.3 — Fase B] - 2026-05-14 - PDF Cotizaciones (plantilla + endpoint on-demand)

### Added
- Dependencia @react-pdf/renderer ^4.5.1
- src/lib/finanzas/pdf/QuoteDocument.tsx — plantilla React-PDF con paleta Integra (navy/gold), header con número y status, info cliente + cotización en dos columnas, tabla de líneas con badges HON/REI, totales card y bloque T&C completo. Footer con paginación + sello de generación.
- src/lib/finanzas/pdf/generate-quote-pdf.ts — generateQuotePdfBuffer wrapper sobre pdf().toBuffer() de react-pdf.
- src/lib/finanzas/pdf/quote-pdf-data.ts — fetchQuotePdfBundle + buildQuotePdfPayload + buildQuoteDocumentProps (reutilizables por /pdf y por /send en Fase C).
- src/app/api/finanzas/quotes/[id]/pdf/route.ts — GET on-demand con cache por hash. Reglas: admin/abogada/contador; cualquier estado (incluso borrador para preview); upsert blob en {tenant}/quote_pdf/{quote_id}/current.pdf; insert/update fila en documents con source='auto_quote_pdf' y source_version+1 al regenerar. Cache hit devuelve signed URL sin regenerar.

### Notes
- runtime='nodejs' + maxDuration=30 explícitos en el route para react-pdf serverless.
- Helvetica como fuente (default react-pdf, sin red).

## [Sprint 2E.3 — Fase A] - 2026-05-14 - PDF Cotizaciones (migración + hash)

### Added
- sql/pending/006_extend_documents_for_auto_pdfs.sql — migración manual para extender la tabla documents:
  - CHECK entity_type ampliado a ('client','case','task','comment','quote','invoice')
  - Columnas nuevas: source (DEFAULT 'manual'), source_version, source_generated_at, source_content_hash
  - CHECK documents_source_check ∈ ('manual','auto_quote_pdf','auto_invoice_pdf')
  - Índices parciales: idx_documents_source (WHERE source <> 'manual'), idx_documents_quote_entity (WHERE entity_type='quote')
  - Comments in-DB para documentación de las nuevas columnas
- src/lib/finanzas/api/quote-pdf-hash.ts — helper computeQuoteContentHash (SHA-256 sobre JSON canónico)
- types DocumentEntityType y DocumentSource exportados desde src/types/database.ts

### Changed
- Document interface: agrega 4 propiedades nuevas (source, source_version, source_generated_at, source_content_hash) y migra entity_type a la union DocumentEntityType

### Notes
- Migration SQL queda en sql/pending/ para ejecución manual de Oliver en Supabase SQL Editor (convención del repo desde 2026-04-05).
- Fase A pausa el sprint: las fases B–F dependen del schema aplicado.

## [Sprint 2E.2] - 2026-05-13 - UI Cotizaciones

### Added
- Módulo Cotizaciones UI completo (5 pantallas en /finanzas/cotizaciones/*)
- 18 componentes nuevos para crear, editar, listar, ver detalle y configurar cotizaciones
- Toggle cliente existente vs crear prospecto inline en el form de creación
- Editor de líneas mixtas HON/REI con totales agrupados por kind
- Modal de conversión cotización aceptada → 1-2 facturas con preview
- Botón Enviar con dialog en 2 pasos (compose email + link público copiable)
- Editor de plantilla Términos y Condiciones (admin only)
- Toast cross-módulo ?converted=N que muestra mensaje violeta al llegar a Facturas desde conversión

### Changed
- Sidebar: agregadas entradas "Cotizaciones" (3 roles) y "Plantilla T&C" (admin only) en sección FINANZAS
- invoice-success-toast.tsx: agregado handler ?converted=N con paleta violeta y mensaje cross-módulo

## [Sprint 2E.1] - 2026-05-13 - Cotizaciones backend

### Added
- Módulo Cotizaciones backend completo (8 endpoints REST en /api/finanzas/quotes/* y /api/finanzas/configuracion/terms-template)
- Columnas client_status (prospect|active|inactive) y client_type (persona_natural|persona_juridica) en tabla clients
- Soporte para prospects (clientes con datos mínimos, no facturables)
- Gate de facturas que rechaza prospects
- Validación de promoción prospect→active (requiere tax_id, tax_id_type, email)
- Plantilla de Términos y Condiciones por tenant (admin-editable)
- convertToInvoices: cotización aceptada → 1-2 facturas según líneas HON/REI

### Changed
- Refactor clients.active boolean → client_status enum (3 estados)
- 14 referencias en código actualizadas (queries, listados, forms, soft-delete, audit log)
- MutationError refactorizado a módulo compartido (api/errors.ts)

### Removed
- Columna clients.active (legacy boolean)

Migrations aplicadas en prod:
- 20260508000001_clients_add_status_and_type.sql
- 20260508000002_quotes_extension_and_terms_template.sql
- 20260508000003_clients_drop_active_legacy.sql

### 2026-05-07 — Sprint Camino 1 Extendido (Fase 1B parte 3)

**UI Facturas — Pre-integración eFactura + Anulación desde UI**

Commits incluidos:
- c83a01e — feat(finanzas): schema prep DGI (4 columnas)
- 1c67e52 — feat(finanzas): backend captura datos DGI
- a912aa1 — feat(finanzas): UI captura datos DGI + banner pre-integración
- f87fc36 — feat(finanzas): polish toast variantes
- 6d5bd3a — fix(finanzas): reemplazar voseo argentino por tuteo neutro panameño
- 21d78a1 — feat(finanzas): schema para anulación de facturas con razón
- 9ddabe2 — feat(finanzas): backend para anular factura desde UI
- 0904bd7 — feat(finanzas): UI para anular facturas con captura de razón
- 5ff7dbb — feat(finanzas): polish y smoke trace anular factura

Cambios funcionales:
- Las abogadas pueden anular facturas desde UI con razón obligatoria (ya no requiere acceso a SQL)
- Pantalla de detalle muestra "Información de anulación" cuando status='anulada'
- Toast rojo "Factura anulada correctamente" diferenciado de toasts verdes (acciones positivas)
- Convención permanente: tuteo neutro panameño en todo texto UI
- Schema preparado para Camino 2 (integración eFactura): 6 columnas nuevas en invoices

Migrations aplicadas en prod:
- 20260506000001_finanzas_b4_schema_prep_dgi.sql
- 20260507000001_finanzas_b4_anular_factura.sql

## [1.11.0] — 2026-05-04

### Feature — Fase 1A: Selector de módulo + reestructura de rutas bajo `/legal/*`

- **Pantalla selector en `/`**: nueva home post-login con saludo según hora Panamá ("Buenos días/tardes/noches, {nombre}") y tarjetas de módulos. Hoy hay dos: **Gestión Legal** (icono Scale) → `/legal`, y **Finanzas** (icono Wallet) → `/finanzas`. Branding Integra (navy `#1B2A4A`, gold `#C5A55A`, blanco). Botón "Entrar" mínimo 48 px, tarjetas apiladas en mobile y lado-a-lado en desktop. Header propio sin sidebar (logo Integra Legal + avatar). El selector se renderiza siempre — incluso si solo hay una tarjeta visible — para mantener consistencia entre roles y dejar margen a expansión futura.
- **Rol nuevo `contador`**: agregado al CHECK constraint de `public.users.role`. Migration en `supabase/migrations/20260504000001_add_contador_role.sql` — aplicar manualmente en Supabase SQL Editor (convención del proyecto desde 2026-04-05). El rol queda **válido en DB pero no expuesto** todavía: la API (`/api/admin/users`) y la UI (`UserForm`) siguen aceptando solo los 3 roles existentes. La habilitación completa se hace en Fase 1B con el módulo Finanzas. Verificación post-aplicación incluida en el SQL.
- **Reestructura de rutas — todo el CRM ahora vive bajo `/legal/*`**:
  - `/abogada/*`, `/asistente/*`, `/admin/*` → eliminados como rutas activas. Reemplazados por:
    - `/legal` (dashboard del módulo, contenido por rol: abogada/admin → dashboard completo, asistente → "Mi Panel" con casos+tareas asignadas)
    - `/legal/clientes`, `/legal/casos`, `/legal/gastos`, `/legal/seguimiento`, `/legal/pendientes`, `/legal/prospectos`, `/legal/importar`
    - `/legal/admin` (subset transversal admin-only) y subrutas `/legal/admin/usuarios`, `/legal/admin/auditoria`, `/legal/admin/configuracion`
  - **Unificación `/asistente/tareas` + `/abogada/pendientes` → `/legal/pendientes`**: una sola URL, contenido por rol (abogada/admin ven `personal_todos`, asistente ve sus `tasks` agrupadas por caso).
  - **Unificación `/abogada/gastos` + `/asistente/gastos` → `/legal/gastos`**: balance global para abogada/admin, "Mis Gastos" para asistente.
  - **Unificación `/abogada/casos/[id]` + `/asistente/casos/[id]` → `/legal/casos/[id]`**: misma página con role-based gating de botones de edición y access check para asistente (acceso solo a casos donde es `assistant_id` o tiene una tarea asignada). Idéntico patrón en `/legal/casos` (lista filtrada para asistente).
  - **Eliminada ruta `/dashboard`**: el dispatcher por rol ya no aplica con el selector. Reemplazada por redirect 301 a `/`.
- **Legacy redirects 301 (vigentes ~4 semanas)**: el middleware mapea automáticamente toda ruta antigua al nuevo destino. Mantiene bookmarks vivos y los emails diarios ya enviados con URLs `/abogada/*`. Reglas en `src/middleware.ts` (constante `LEGACY_REDIRECTS`).
  - Ejemplos: `/abogada` → `/legal`, `/abogada/casos/{id}` → `/legal/casos/{id}`, `/admin/usuarios` → `/legal/admin/usuarios`, `/asistente/tareas` → `/legal/pendientes`, `/dashboard` → `/`.
  - Verificado con `curl` durante la build: redirects 301 correctos en todos los casos. Auth-aware (los redirects se aplican antes del auth check, para que bookmarks viejos lleguen al destino aunque la sesión esté caducada).
- **Gating por rol en middleware**: nuevo `ROLE_ROUTES` con prefijos: admin/abogada/asistente acceden `/`, `/legal`, `/finanzas`; contador solo accede `/`, `/finanzas`. `/legal/admin/*` es admin-only (subset transversal). Los redirects de un usuario sin acceso van a `/finanzas` (contador) o `/` (resto).
- **Login y auth callback**: `router.push("/")` post-login (antes `/dashboard`). Default `next` del callback OAuth: `/` (antes `/dashboard`).
- **Sidebar y bottom-nav reescritos**: items con hrefs `/legal/*`, primera entrada "Inicio" → `/` (selector). Asistente ahora ve Dashboard, Casos, Gastos, Mis Pendientes (antes solo Dashboard + Mis Tareas) — el gating real lo hacen los componentes y los queries por rol, no la ruta.
- **Cron BASE_URL**: `src/app/api/cron/daily-summary/route.ts` ahora lee `process.env.NEXT_PUBLIC_APP_URL` con fallback al hardcoded actual. **Importante para deploy**: configurar `NEXT_PUBLIC_APP_URL` en Vercel (production y preview) antes del merge a main para evitar comportamiento inconsistente entre entornos.
- **Email template (`src/lib/email/daily-summary-template.ts`)**: URLs actualizadas a `/legal/casos/{id}`, `/legal/pendientes`, `/legal/seguimiento`. Los emails ya enviados con URLs `/abogada/*` siguen funcionando vía los redirects 301 del middleware.
- **Helper `getGreetingPanama()`**: nuevo en `src/lib/utils/greeting.ts`. UTC-5 fijo (Panamá no usa DST). Rangos: 05–11h "Buenos días", 12–18h "Buenas tardes", 19–04h "Buenas noches". Calculado en SSR (no se actualiza dinámicamente — refresh para recalcular).
- **Componentes nuevos**:
  - `src/components/home/home-header.tsx` — header slim para selector y placeholder de Finanzas (sin sidebar/búsqueda global).
  - `src/components/dashboards/asistente-home.tsx`, `asistente-pendientes.tsx`, `asistente-gastos.tsx`, `asistente-gastos-form.tsx` — extraídas de las antiguas páginas `(dashboard)/asistente/*` para que las páginas unificadas en `/legal/*` puedan despachar por rol sin duplicar lógica.
- **Archivos eliminados**: toda la carpeta `src/app/(dashboard)/`. Las páginas se movieron a `/legal/*` con `Move-Item` para preservar git rename detection.
- **Verificación**:
  - `npm run build`: ✓ 41 rutas generadas, sin errores de tipos.
  - `npm run lint`: errores pre-existentes (unused-vars, etc.) — `next.config.mjs` tiene `ignoreDuringBuilds: true`. No introducimos errores nuevos.
  - Smoke test con `curl` en dev server: `/login` 200, `/` y `/legal` y `/finanzas` 307 → `/login` (sin sesión), legacy redirects (`/abogada`, `/abogada/casos`, `/dashboard`, `/admin/usuarios`, `/asistente/tareas`) → 301 al nuevo destino. ✓
  - **Pendiente** (post-merge a main): validación visual en preview de Vercel por Oliver — flujos de las 5 verificaciones post-deploy.
- **Archivos clave**:
  - Nuevos: `src/app/page.tsx` (selector), `src/app/finanzas/layout.tsx`, `src/app/finanzas/page.tsx`, `src/app/legal/layout.tsx`, `src/components/home/home-header.tsx`, `src/components/dashboards/asistente-*.tsx` (4 archivos), `src/lib/utils/greeting.ts`, `supabase/migrations/20260504000001_add_contador_role.sql`.
  - Movidos: todo `src/app/(dashboard)/*` → `src/app/legal/*` con renames y merges.
  - Modificados: `src/middleware.ts` (rewrite completo), `src/components/layout/sidebar.tsx` y `bottom-nav.tsx` (rewrite de navItems), `src/components/auth/login-form.tsx`, `src/app/api/auth/callback/route.ts`, `src/app/api/cron/daily-summary/route.ts`, `src/lib/email/daily-summary-template.ts`, y ~25 componentes/páginas con `<Link href>`/`router.push` actualizados a `/legal/*`.

## [1.10.4] — 2026-05-02

### Fix — Flujo de creación de usuarios desde frontend ahora sincroniza `app_metadata` (resuelve loop `?error=no-role`)

- **Problema**: usuarios creados desde `/admin/usuarios` no podían entrar al CRM. Login exitoso, pero al navegar a `/dashboard` el middleware redirigía a `/login?error=no-role` y el ciclo entraba en `ERR_TOO_MANY_REDIRECTS`. Reportado para `legal@integra-panama.com`.
- **Causa raíz**: el endpoint `POST /api/admin/users` seteaba `user_metadata` (informativo) pero **no** `app_metadata`. El middleware (`src/middleware.ts:117`) lee `session.user.app_metadata.user_role` para autorizar, así que sin esa clave el JWT del usuario no tiene rol y el middleware lo rebota. Los usuarios viejos (Daveiva/Milena/Harry/Oliver) sí tenían `app_metadata.user_role` por haber sido creados en flujos anteriores; el bug solo afectaba a usuarios creados desde la UI actual. El `custom_access_token_hook` definido en migraciones no está activo en el dashboard de Supabase, por lo que no compensaba el faltante.
- **Fix en POST `/api/admin/users`**: ahora pasa `app_metadata: { user_role, tenant_id }` al `auth.admin.createUser`, además de `user_metadata`. Verificación defensiva post-creación: si `app_metadata` no quedó persistido, hace rollback (`deleteUser`) y devuelve 500. Logs por paso (sin secrets) para facilitar debugging futuro.
- **Fix en PATCH `/api/admin/users/[id]`**: cuando `body.role` cambia, además de actualizar `public.users.role`, ahora llama `auth.admin.updateUserById` para sincronizar `app_metadata.user_role`. Sin esto, cambiar el rol desde la UI dejaba el JWT inconsistente con el perfil.
- **Endpoint nuevo `POST /api/admin/users/[id]/sync-metadata`** (admin-only, idempotente): lee `role` y `tenant_id` desde `public.users` y los copia a `auth.users.app_metadata`. Sirve para reparar usuarios pre-existentes con metadata desincronizado (caso del usuario Legal). Inserta entrada en `audit_log` solo si hubo cambio efectivo.
- **Documentación nueva**: `docs/USUARIOS.md` cubre roles, flujo de creación correcto, diagnóstico cuando un usuario reporta no poder entrar, uso del endpoint de sync-metadata y hardening futuro (activar el JWT hook como defensa en profundidad).
- **Sin cambios** en migraciones SQL ni en `auth.users` de los 4 usuarios existentes.
- **Archivos**: `src/app/api/admin/users/route.ts`, `src/app/api/admin/users/[id]/route.ts`, `src/app/api/admin/users/[id]/sync-metadata/route.ts` (nuevo), `docs/USUARIOS.md` (nuevo).

## [1.10.3] — 2026-04-28

### Feature — Nueva clasificación FAMILIA
- Agrega la clasificación `FAMILIA` (prefijo `FAM`, color `#00838F` turquesa oscuro, badge con texto blanco) al catálogo del tenant Integra Legal.
- **Catálogo (DB)**: `sql/pending/005_add_familia_classification.sql` — INSERT idempotente en `cat_classifications` + entrada en `audit_log` siguiendo el patrón de `src/app/api/admin/catalogs/route.ts` (entity = nombre de tabla, new_value = JSON del payload). Ejecutado manualmente en Supabase el 2026-04-28.
- **Verificación previa**: `sql/pending/004_verify_familia_classification.sql`.
- **Frontend**: agregado `FAMILIA: "#00838F"` al fallback `DEFAULT_CLASSIFICATION_COLORS` en `src/lib/utils/classification-colors.ts`. La lógica de color de texto del badge no requiere cambios — `getClassificationTextColor` ya retorna `#FFFFFF` para cualquier color distinto del amarillo de REGULATORIO.
- **Sin cambios** en formularios de caso, dropdowns, filtros ni en `src/lib/utils/case-code.ts`: las clasificaciones se cargan 100% desde DB y la auto-numeración resuelve el prefijo dinámicamente. Al crear el primer caso con FAMILIA, el código será `FAM-001`.

## [1.10.2] — 2026-04-28

### Fix — Email diario consulta `personal_todos` (no `tasks`)
- **Problema**: el email diario "Seguimientos y Pendientes" mostraba conteos incorrectos vs el dashboard. Milena: dashboard 15 pendientes propios / 3 asignados, email 0 / 0. Daveiva: dashboard 9 / 10, email 2 / 0.
- **Causa raíz**: `buildSummaryForUser` en `src/app/api/cron/daily-summary/route.ts` consultaba la tabla `tasks` (tareas de caso) cuando el dashboard consulta `personal_todos` (pendientes personales). Decisión errada del commit `c335c8a` (introducción del email): usaba `created_by`, joins a `cases!inner` y `clients!inner` que no aplican a pendientes personales.
- **Fix**: `buildSummaryForUser` ahora consulta `personal_todos` con la misma lógica que el dashboard (`src/app/(dashboard)/abogada/page.tsx`):
  - Mis Pendientes: `tenant_id = ?` AND `user_id = userId`, orden `deadline ASC nullsFirst:false`, filtro `status === 'pendiente'` en JS, slice 15.
  - Asignados por Otros: `tenant_id = ?` AND `assigned_to = userId` AND `user_id != userId`, mismo orden y slice.
  - Aislamiento por usuario garantizado por construcción: cada query se scopea con `userId` específico de cada destinataria dentro del loop `for (const abogada of abogadas)`. Sin fugas cruzadas.
- **Template** (`src/lib/email/daily-summary-template.ts`): tipo `SummaryTask` simplificado (sin `case_id`/`caseCode`/`clientName`, agrega `assigneeName`). Tablas HTML de las dos primeras secciones reducidas a columnas `Tarea | Asignada a / Asignado por | Vence`. La sección "Seguimientos Recientes" no se modificó (sí debe seguir mostrando actividad de casos).
- **Schedule**: el horario del cron se cambió a 8 AM Panamá (`0 13 * * 1-6` UTC) en commit anterior `66f8aff`.
- **Archivos modificados**: `src/app/api/cron/daily-summary/route.ts`, `src/lib/email/daily-summary-template.ts`.

## [1.10.0] — 2026-04-21

### Feature — Búsqueda universal unificada en TODOS los buscadores del CRM
- **Problema reportado**: buscadores inconsistentes. En `/abogada/casos` buscar "extrajudicial" devolvía 0 resultados aunque existía el caso EXT-001; en otros listados no se podía buscar por cliente, abogada, institución, etc. Cada buscador cubría un subconjunto distinto de campos.
- **Estándar único** aplicado a los 10 buscadores del sistema:
  1. **Multi-campo + JOIN**: en casos busca en `case_code`, `description`, `observations`, `physical_location`, `entity`, `procedure_type`, `institution_procedure_number`, `institution_case_number` + relación con cliente (`name`, `client_number`, `ruc`, `email`, `phone`, `type`, `address`, `contact`) + clasificación (`name`, `prefix`) + institución (`name`) + estado (`name`) + abogada/asistente (`full_name`, `email`). En clientes, prospectos, gastos, seguimiento, pendientes, usuarios, catálogos: conjunto de campos equivalente.
  2. **Case-insensitive**: `EXTRAJUDICIAL`, `extrajudicial`, `Extrajudicial` → mismo resultado.
  3. **Coincidencia parcial** con wildcards: `extra` encuentra `EXTRAJUDICIAL`.
  4. **Tolerante a acentos (unaccent)**: `migracion` encuentra `MIGRACIÓN`, `panama` encuentra `Panamá`. Client-side via `String.normalize("NFD")`; server-side requiere ejecutar el SQL pendiente (ver más abajo).
  5. **Números**: `002` encuentra `CIV-002`, `EXT-002`, `CLI-002`, etc.
  6. **Mensaje "sin resultados"** uniforme: `No se encontraron resultados para: "X"` en lugar del `No se encontraron casos` / `Sin resultados para "X"` / mensajes distintos por listado.
- **Arquitectura**:
  - Helper JS `src/lib/utils/search.ts` con `normalizeSearch`, `matchesSearchQuery`, `escapeLikePattern`, `buildIlikeOrClause` — único punto de verdad para filtrado client-side.
  - Helper server `src/lib/utils/search-server.ts` con `tryUniversalSearchIds` (invoca RPC) + `fallbackCaseSearchIds`/`fallbackClientSearchIds`/`fallbackProspectSearchIds` que hacen búsqueda SDK con `.or()` ampliado cuando la RPC no está aún aplicada.
  - Nuevo endpoint `GET /api/search?q=` que el buscador global del header consulta. Resuelve `tenant_id` del usuario autenticado y delega en las RPCs.
  - Componente reutilizable `src/components/ui/empty-search-result.tsx` para el mensaje "sin resultados" estandarizado.
- **SQL aplicado** en `/sql/pending/002_enable_unaccent_and_search_rpcs.sql`:
  - `CREATE EXTENSION IF NOT EXISTS unaccent` (idempotente).
  - `public.f_unaccent(text)` IMMUTABLE + `public.f_search_contains(h, n)` como predicado case/accent-insensitive.
  - `public.search_cases_ids(uuid, text)`, `public.search_clients_ids(uuid, text)`, `public.search_prospects_ids(uuid, text)` — RPCs que devuelven `SETOF uuid` con búsqueda multi-campo + JOINs.
  - `GRANT EXECUTE` a `authenticated` y `service_role`.
  - **Ejecutado manualmente en Supabase el 2026-04-21**: las RPCs están activas y el código ya las usa (el fallback SDK queda solo como red de seguridad).
- **Buscadores migrados**:
  - `/abogada/casos` (server): usa RPC `search_cases_ids` o fallback.
  - `/abogada/clientes` (server): usa RPC `search_clients_ids` o fallback.
  - Buscador global del header (cliente → `/api/search`): usa ambas RPCs o fallback.
  - `/abogada/gastos` (GastosTable, client): `matchesSearchQuery` sobre `caseCode`, `clientName`, `description`, `statusName`, `totalPayments`, `totalExpenses`, `balance`.
  - `/abogada/seguimiento` (SeguimientoView, client): `matchesSearchQuery` sobre código, cliente, descripción, comentario, asignada, estado, deadline.
  - `/abogada/pendientes` (TodoList, client): `matchesSearchQuery` sobre `description`, `assignee_name`, `creator_name`, `status`, `deadline`.
  - `/abogada/prospectos` (ProspectPipeline, client): **nuevo** input de búsqueda (antes no tenía). Filtra sobre `name`, `phone`, `email`, `service_interest`, `notes`, `status`.
  - `/admin/usuarios` (UserTable, client): `matchesSearchQuery` sobre `full_name`, `email`, `role`, label de rol, activo/inactivo.
  - Catálogos (ClassificationsManager, InstitutionsManager, StatusesManager en `/admin/configuracion`): `matchesSearchQuery` sobre todas las columnas configuradas + activo/inactivo.
  - Buscador de cliente en el wizard de casos (`CaseForm`, client): `matchesSearchQuery` sobre `name`, `client_number`.
- **Debounce**: los buscadores con query server-side (casos, clientes, header) ya tienen 300 ms. Los client-side no lo necesitan porque filtran datos ya cargados.
- **Placeholders** actualizados para reflejar el alcance ampliado: "Buscar en todo: código, cliente, clasificación, abogada, institución..." (casos), "Buscar en todo: nombre, RUC, número, email, abogada, casos..." (clientes).
- **Archivos**:
  - Nuevos: `src/lib/utils/search.ts`, `src/lib/utils/search-server.ts`, `src/components/ui/empty-search-result.tsx`, `src/app/api/search/route.ts`, `sql/pending/002_enable_unaccent_and_search_rpcs.sql`.
  - Modificados: `src/app/(dashboard)/abogada/casos/page.tsx`, `src/app/(dashboard)/abogada/clientes/page.tsx`, `src/components/layout/global-search.tsx`, `src/components/cases/case-filters.tsx`, `src/components/cases/case-form.tsx`, `src/components/clients/client-filters.tsx`, `src/components/expenses/gastos-table.tsx`, `src/components/seguimiento/seguimiento-view.tsx`, `src/components/admin/user-table.tsx`, `src/components/admin/catalog-manager.tsx`, `src/components/todos/todo-list.tsx`, `src/components/prospects/prospect-pipeline.tsx`.

## [1.9.3] — 2026-04-21

### Feature — Recálculo automático del código del expediente al cambiar clasificación
- **Escenario**: hasta ahora, al editar un caso y cambiar su clasificación (ej. CIVIL → EXTRAJUDICIAL), el `case_code` quedaba fosilizado en el prefijo original (ej. CIV-002 aunque el caso ya fuera EXTRAJUDICIAL). Esto rompía las numeraciones por prefijo.
- **Comportamiento nuevo**: al guardar un cambio de clasificación desde el wizard de edición (`/abogada/casos/[id]/editar`) o desde el editor inline de la vista de detalle, el frontend muestra un modal de confirmación con:
  - Clasificación anterior → nueva.
  - Código actual (CIV-002).
  - Código nuevo calculado (ej. EXT-002), obtenido de `GET /api/cases?classification_id=<nuevo>`.
  - Botones "Cancelar" (revierte la selección) y "Confirmar cambio" (azul navy).
- **Reglas**: el nuevo código es el siguiente correlativo libre del nuevo prefijo (no se reutilizan huecos). El código anterior queda como hueco en su secuencia original. Al crear un caso nuevo el comportamiento no cambia; al eliminar tampoco.
- **Atomicidad**: el handler `PATCH /api/cases/[id]` recalcula el código con hasta 3 reintentos ante colisiones del `UNIQUE INDEX idx_cases_code_tenant`. La query de UPDATE condiciona por `(id, tenant_id, case_code=antiguo)` como doble seguro contra escrituras concurrentes. Si tras 3 intentos sigue habiendo conflicto, responde 409 y el frontend muestra el mensaje.
- **Auditoría**: el cambio queda en `audit_log` como dos entradas (`field=classification_id` con nombres legibles, y `field=case_code` con códigos viejo/nuevo), sin duplicar las entradas genéricas preexistentes.
- **Refactor**: extraído `src/lib/utils/case-code.ts` como única fuente de verdad para calcular el siguiente correlativo por prefijo. `GET /api/cases` y `POST /api/cases` migrados al helper.
- **Nuevo componente UI reutilizable**: `src/components/ui/confirmation-modal.tsx` (versión genérica, sin input de typed-confirmation, usada para confirmaciones simples).
- **SQL de corrección del caso actual mal grabado** (CIV-002 → EXT-NNN de PRODUCTOS ALIMENTICIOS PASCUAL, S.A.): dejado en `/sql/pending/001_fix_case_code_civ_002_to_ext.sql` con verificación previa, cálculo atómico del siguiente EXT libre, UPDATE condicionado por `tenant_id + case_code='CIV-002' + classification EXT`, verificación post-update, entrada de auditoría y rollback comentado. **SQL ya ejecutado manualmente en Supabase el 2026-04-21**: CIV-002 migrado a EXT-001 con audit log registrado.
- **Archivos**: `src/lib/utils/case-code.ts` (nuevo), `src/components/ui/confirmation-modal.tsx` (nuevo), `src/app/api/cases/route.ts`, `src/app/api/cases/[id]/route.ts`, `src/components/cases/case-form.tsx`, `src/components/cases/inline-case-editor.tsx`, `src/app/(dashboard)/abogada/casos/[id]/page.tsx`, `sql/pending/001_fix_case_code_civ_002_to_ext.sql` (nuevo).

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
