# CHANGELOG.MD — CRM INTEGRA LEGAL

## [Formulario de alta con líneas + el gasto de demostración en staging] - 2026-09-03

Con esto el bloque de gastos de trámite queda **completo**, salvo el
`VALIDATE CONSTRAINT` que espera a que no queden líneas sin clasificar.

### El gasto de demostración: la cadena completa se puede recorrer

`scripts/seed-gasto-tramite-demo.mts` (idempotente, con candado anti-producción). Siembra el
gasto del fixture del 15/03 —el que motivó todo el modelo de líneas— con **tres líneas contra
tres cuentas distintas**, y lo postea usando el builder y el RPC reales.

Un asiento de una línea no demostraba nada. Con tres se ve el asiento compuesto, y sobre todo
se ve **"Varios"** en el mayor de `200001` — el caso ambiguo que `contrapartida.ts` resolvía
desde hace días y que hasta hoy no se podía mirar en pantalla.

    Asiento 13
      DEBE  130003  Fondo Legales de Clientes    Útiles y timbres fiscales       412,35
      DEBE  610002  Honorarios Profesionales     Honorario del gestor externo    900,00
      DEBE  500005  Costos trámites legales      Mensajería y traslados          185,50
      HABER 200001  Cuentas por pagar                                                  1.497,85

### ⚠️ Los totales del Balance de staging cambiaron

| | Antes | Después | Δ |
|---|---:|---:|---:|
| **Activo** | 262.717,46 | **263.129,81** | +412,35 |
| **Pasivo** | 17.334,80 | **18.832,65** | +1.497,85 |
| **Patrimonio** | 245.382,66 | **244.297,16** | −1.085,50 |
| **Descuadre** | 0,00 | **0,00** | — |

El patrimonio baja porque dos de las tres líneas van a cuentas de resultado (`610002` gasto y
`500005` costo, 1.085,50 juntas) y eso reduce la utilidad del ejercicio. El activo sube solo
por la línea que va a `130003`. **412,35 = 1.497,85 − 1.085,50**: cuadra por construcción, y el
descuadre sigue en 0,00.

### El formulario de alta

`section-expense-form.tsx` — proveedor, vencimiento y el editor de líneas que ya existía.

- **El vencimiento se precarga con `payment_terms_days` del proveedor** y queda editable. Se
  recalcula si se cambia la fecha del gasto: el plazo corre desde el gasto, no desde hoy.
  ⚠️ La suma de días usa `Date.UTC` a propósito — con la zona local, en Panamá (UTC−5) el
  resultado se corre un día para atrás, y un vencimiento corrido cambia el tramo de la
  antigüedad.
- 🔴 **Ya no hay campo de monto.** El monto del encabezado ES la suma de las líneas, y lo
  calcula el servidor: si viniera del request, el encabezado y el detalle podrían decir cosas
  distintas y el asiento se arma con una sola de las dos. El botón muestra el total calculado
  para que se vea de dónde sale.
- El monto sugerido del gasto administrativo (B/. 21,50) ahora precarga la **primera línea** en
  vez de un campo suelto.

### `POST /api/expenses` exige líneas

No es una restricción gratuita: **un gasto sin líneas no se puede postear** —el builder no
tiene contra qué cuenta armar el asiento— así que aceptarlo sería crear en silencio documentos
que nunca van a llegar a la contabilidad. Si el INSERT de líneas falla, el encabezado se borra:
un gasto huérfano es basura invisible.

### El botón de posteo

En `/finanzas/gastos-tramite/{id}`, y **solo cuando la acción se puede ejecutar**: el rol puede,
el gasto no está posteado, y no falta ninguna cuenta. Si falta clasificar, el aviso ámbar ya
explica qué hacer y un botón deshabilitado al lado sería ruido.

La confirmación dice el importe **y las dos consecuencias**: que un asiento no se borra, y que
desde ese momento el gasto queda inmutable salvo el comprobante.

### Hallazgo: `add-expense-form.tsx` es código muerto

No se monta en ningún lado — la pantalla del caso usa `SectionExpenseForm`. Se le aplicó igual
el renombrado "Pago" a "Cobro" esta mañana. **No se borró**: es una decisión aparte y conviene
confirmarla antes.

### Tests: 674 (+13)

`crear-con-lineas.route.test.ts` — que las líneas sean obligatorias, que **un `amount` del body
se ignore** y el monto salga de las líneas, que la cuenta sea obligatoria al crear, el
compensating delete, y que el tenant salga del perfil.

`tsc` limpio, 21 errores de ESLint (los de siempre). Producción intacta.

---

## [038 — el gasto de trámite llega al libro contable] - 2026-09-03

**Queda cerrado el camino documento → asiento para el primer tipo de documento del sistema.**
Hasta hoy ninguna ruta de `/api` posteaba al ledger: `postJournalEntry()` solo se llamaba desde
su propia definición y desde un script, y los asientos de staging los puso `seed-asientos.ts`.

### El asiento: N débitos contra un crédito único

    DEBE  610001  Útiles de oficina        412,35
    DEBE  500005  Honorario externo        900,00
    DEBE  610002  Mensajería               185,50
    HABER 200001  Cuentas por pagar              1.497,85

**Cuadra por construcción**: el crédito ES la suma de los débitos, calculada por la misma
función. Dos líneas con la misma cuenta NO se consolidan, a propósito — cada renglón conserva su
descripción, que es lo que Josuarth pidió ver en el mayor ("se abren las fracciones").

El ITBMS va al débito de su propia línea y **no** a una cuenta de crédito fiscal: en un gasto de
trámite el impuesto es pass-through. 🔑 Es lo que hace que este bloque **no dependa** de la
consulta pendiente al contador — esa pregunta es solo de compras.

### 🔴 El rechazo que le da sentido al NULL

Si cualquier línea tiene `chart_account_code` en NULL, **la ruta no postea**: 422 con
*"Este gasto tiene 2 líneas sin cuenta contable (las líneas 2, 3). Clasifíquelas antes de
registrarlo en el libro."*

Lo decide el builder devolviendo un resultado discriminado, no lanzando: el compilador obliga a
manejar el caso. **Sin este rechazo el NULL sería solo una columna vacía.** Con él, es lo que
impide que un gasto que nadie clasificó entre al libro contra una cuenta inventada — y el libro
no se corrige después.

### Idempotencia en tres capas, y un bug que encontró su propio test

1. `expenses.posted_entry_id` — corta temprano, sin tocar el ledger. Es un cache.
2. `SELECT` sobre `journal_entries` — la verdad, con el número de asiento en el mensaje. ⚠️ Si
   ese SELECT falla se **aborta**: postear de más es lo único que no se puede deshacer.
3. El UNIQUE parcial de la `034` — **la garantía**. Las dos primeras dejan una ventana que dos
   requests simultáneos pasan. El `23505` se traduce al mismo mensaje de la capa 2.

⚠️ **El código de Postgres viaja en `MutationError.detail`, no en `cause`.** La primera versión
del bloque miraba `cause` y contestaba 422 ("el asiento está mal armado") a un doble clic que ya
estaba posteado. Lo encontró el test de la capa 3 antes de que existiera la pantalla.

Y si el cache falla **después** del posteo, el request sigue siendo 201: el asiento ya está en el
libro y devolver un error haría que alguien reintente un posteo hecho.

### Inmutabilidad: el guard va en la BASE, no en la ruta

Dos triggers, sobre `expenses` y sobre `expense_lines`. El gate de la ruta da el mensaje; el
trigger es el permiso — toda la escritura del módulo va con el cliente de servicio, que saltea
RLS, así que un script o el SQL Editor editarían igual.

La lista de lo editable es **blanca y explícita**: con una lista negra, cada columna nueva de
`expenses` nacería editable sin que nadie lo decida.

| ✅ | ❌ |
|---|---|
| comprobante (escanear el recibo tarde no toca los libros), `posted_entry_id` | monto, fecha, concepto, caso, proveedor, vencimiento, cuenta de pago, las líneas, y borrar el gasto |

🔒 **Verificado contra staging con el RPC real y ROLLBACK**:
`sql/tests/verificacion-038-inmutabilidad.sql`, ocho casos, **8/8**, sin dejar asiento ni
consumir correlativo.

### El CHECK anónimo, otra vez

`'gasto_tramite'` es un valor NUEVO — `'gasto'` ya está tomado por `business_expenses` y es lo
que `destino-documento.ts` usa para el enlace del mayor. Compartirlo mandaría un gasto de trámite
a la pantalla de compras con un id que ahí no existe. Ventaja extra: **cero backfill**.

⚠️ Al ampliar el CHECK se filtró por **contenido** (`'%source_type%'` **y** `'%factura%'`), que es
la lección de la `029`: la primera versión de la `028` dropeó los dos CHECK que mencionan
`source_type` y se llevó puesto `je_reversion_requires_ref`. La `038` además **verifica al final
que ese constraint siga en pie** — la comprobación que le habría ahorrado la `029` a la `028`.
Staging: 1 constraint dropeado, el correcto.

Las tres fuentes se movieron juntas: el CHECK de la base, `SourceType` en `posting.ts` y
`RUTA_DEL_DOCUMENTO`.

### Tests: 661 (+35)

- `asiento-gasto-tramite.test.ts` (18) — el rechazo por NULL, la forma del asiento, que el ITBMS
  no toque `200003`, y que `source_type` no sea `gasto`.
- `post-to-ledger.route.test.ts` (17) — que un gasto sin clasificar **no llegue al RPC**, las
  tres capas de idempotencia, el tenant del perfil, "ante la duda no se postea", y que un cache
  fallido no voltee un posteo hecho.

`tsc` limpio, 21 errores de ESLint (los de siempre).

### Lo que falta del bloque

El **formulario de alta** con proveedor, vencimiento y líneas, y el botón que llama a esta ruta.
Después: `VALIDATE CONSTRAINT` cuando no queden líneas sin clasificar.

---

## [Limpieza de gastos sin clasificar — vista, masiva y el CHECK que cierra el hueco] - 2026-09-03

### 🔬 El experimento primero: qué hace de verdad `CHECK ... NOT VALID`

Oliver propuso `CHECK (chart_account_code IS NOT NULL) NOT VALID` para cerrar el hueco del
validador —columna nullable + validador de aplicación = un `curl` la saltea— y pidió
explícitamente **no darlo por cierto**: verificar antes qué pasa con un UPDATE sobre una fila
vieja que sigue en NULL.

Medido en staging (`sql/tests/experimento-check-not-valid.sql`, todo dentro de un ROLLBACK):

| Operación | Resultado |
|---|---|
| `ADD CONSTRAINT ... NOT VALID` con 20 filas en NULL | ✅ pasa, no escanea |
| INSERT nuevo **sin** cuenta | ✅ **RECHAZADO** — el objetivo |
| INSERT nuevo **con** cuenta | ✅ aceptado |
| UPDATE de la **descripción** de una fila vieja en NULL | ⚠️ **RECHAZADO** |
| UPDATE que **asigna** la cuenta a una fila vieja | ✅ aceptado |
| `VALIDATE CONSTRAINT` con NULLs presentes | ✅ rechazado |

**`NOT VALID` salta el scan inicial, pero el CHECK se hace cumplir en TODO UPDATE**, incluso
sobre una fila vieja y aunque el UPDATE no toque la columna del CHECK: Postgres evalúa la fila
nueva completa. La intuición de "las filas viejas quedan exentas" es falsa.

**Se adoptó igual**, porque el costo medido es acotado: lo único prohibido es modificar una
línea histórica *sin clasificarla en el mismo UPDATE*. Clasificarla, borrarla, el CASCADE y la
asignación masiva siguen funcionando, y hoy no existe ninguna pantalla que edite una línea. Va
en la migración `037`, que **debe correr después de la 036** — el backfill de la 036 inserta
NULL y con el CHECK puesto abortaría.

El comando `VALIDATE CONSTRAINT` es además el semáforo: mientras quede una línea en NULL falla,
así que **el día que corre limpio, la limpieza terminó**. No hay que llevar la cuenta a mano.

### La limpieza necesitaba una pantalla que no existía

`/legal/gastos` es un **balance por caso**; los gastos individuales solo viven dentro del
detalle del caso. Resolver los 128 habría significado entrar caso por caso, o sea no hacerlo
nunca.

Se agregó una **vista** a esa misma pantalla —toggle "Por caso" / "Gastos"— y no una pantalla
`/sin-clasificar` aparte: una pantalla dedicada a una limpieza es un arreglo temporal que se
vuelve deuda permanente, y una lista de gastos entre casos sirve igual después. El gate no
cambia: admin y abogada.

🎨 **Se presenta como un estado, no como una alarma.** Chip y no banner; ámbar y reloj, nunca
rojo y triángulo; el chip **desaparece al llegar a cero** en vez de quedar en "0 sin
clasificar" para siempre; muestra avance (`84 de 128`) en vez de deuda; y la explicación
aparece una sola vez, en gris chico y solo con el filtro activo. Se clasifica con un `<select>`
en la fila misma, sin abrir el gasto.

### 🔑 La masiva solo llena blancos

`POST /api/expenses/lines/bulk-classify` filtra por `chart_account_code IS NULL`. Sin eso, un
clic sobre 40 líneas destruye clasificaciones que alguien decidió una por una y que **nadie
recuerda cuáles eran**: no hay historial de la cuenta anterior.

⚠️ **Ese mismo filtro hace un segundo trabajo:** un gasto no se puede postear con líneas en
NULL, así que toda línea en NULL pertenece por definición a un gasto **no posteado**. El filtro
de clasificación y el de inmutabilidad son el mismo. 🚫 Por eso la ruta masiva **no** tiene un
guard aparte de "gasto posteado" — un segundo chequeo que siempre da lo mismo que el primero es
código que nadie puede probar que haga falta, y el día que alguien simplifique va a sacar el
equivocado. La ruta INDIVIDUAL sí lo lleva, porque ahí sí se puede cambiar una cuenta ya
asignada.

La confirmación dice el número y la cuenta antes de aplicar: *"Se va a asignar 130003 Fondo
Legales de Clientes a 12 gastos sin clasificar."*

### Tests: 626 (+13)

`bulk-classify.route.test.ts` usa un fake que **registra la cadena de filtros** en vez de
simular una base — un fake que filtrara de mentira pasaría igual si el `.is()` desapareciera,
porque el filtrado lo estaría haciendo el fake. Cubre además que el `tenant_id` sale del perfil
y **no del body** aunque el body lo mande (SOP-014), que una cuenta inexistente o inactiva no
escribe nada, los 403 de asistente y contador, y que las líneas ya clasificadas entre medio se
informan como `omitidas` sin fallar.

✅ **Verificado por mutación:** sacando el `.is("chart_account_code", null)` de la ruta, el test
falla. No es un test vacuo.

`tsc` limpio, 21 errores de ESLint (los de siempre).

---

## [Migración 036 — líneas de gasto, con los 128 gastos reales verificados] - 2026-09-03

`sql/pending/036_expense_lines.sql`. Aplicada a staging, idempotente. **Producción NO**: solo
por merge a `main`, con backup y con el pre-flight vuelto a correr el mismo día.

### El pre-flight decidió el esquema

Corrido por Oliver contra producción: **128 gastos**, 0 en cero o negativos, 0 sin concepto,
**97 con comprobante** (76%), montos entre 0,50 y 3.033,00.

Los dos números que mandan: `cero_o_negativos = 0` habilita el `CHECK amount > 0` (con un solo
gasto en 0 habría tenido que ser `>= 0`, **y la migración habría abortado a mitad el día del
deploy**); `sin_concepto = 0` deja al backfill sacar `description` de `concept` sin fallback,
porque la columna es `NOT NULL`.

El número está escrito en el encabezado de la migración porque cambia cómo hay que leerla: no
son filas de prueba, son 128 gastos cargados a mano por las licenciadas con 97 recibos
escaneados detrás.

### El comprobante no se toca, y además se afirma

`receipt_url` vive en el ENCABEZADO y ahí se queda: un recibo de 107 no se parte en tres. La
migración **no lee, no mueve y no re-referencia un solo objeto de Storage**. Aun así el número
queda afirmado en el log — 97 antes, 97 después — porque un número verificado vale más que una
promesa de diseño.

### Cinco verificaciones, en cantidad y no solo en cuadre

Dos errores distintos pueden dar la misma suma: un gasto que perdió su línea y otro que ganó
una de más suman igual y son dos bugs. Por eso se compara contra una foto de antes:

1. `COUNT(expenses)` antes = después — no se creó ni se borró un gasto.
2. `COUNT(expense_lines)` = `COUNT(expenses)` — uno a uno, exacto.
3. Ningún gasto sin línea. Redundante con (2) por aritmética, pero lo **nombra**: dice cuál de
   los dos problemas es.
4. `SUM(lines.amount)` = `SUM(expenses.amount)` al centavo, **y gasto por gasto** — el total
   podría dar bien con dos errores compensándose.
5. `COUNT(receipt_url IS NOT NULL)` sin cambios.

Cualquiera que falle: `RAISE EXCEPTION` y revierte todo. Es una sola transacción.

### Las líneas del backfill quedan sin cuenta, y se ve como lo que es

`chart_account_code` en NULL, no en `130003`. La decisión está explicada en el commit anterior;
lo que se agregó hoy es cómo se **presenta**: la pantalla lo muestra en **ámbar y con un ícono
de reloj, no en rojo con un triángulo**. Rojo dice "algo se rompió"; acá no se rompió nada, es
trabajo pendiente que hasta hoy era invisible.

El texto lo dice en los dos sentidos, que es lo que pidió Oliver: el gasto es **histórico** —se
cargó antes de que el sistema pidiera la cuenta— y **los nuevos ya no pueden quedar así**,
porque el formulario exige la cuenta de cada línea. El editor lo repite arriba de las líneas,
para que nadie vea un gasto viejo sin cuenta y suponga que el campo es opcional.

### Lo que la migración NO hace, y dónde va

- No dropea `expenses.amount` ni lo vuelve derivado. Conviven; es el patrón seguro de migración
  destructiva de CLAUDE.md.
- No amplía el CHECK de `journal_entries.source_type` con `'gasto_tramite'` ni crea el trigger
  de inmutabilidad: van en la `037` junto con la ruta que postea. Un trigger sin posteo es
  código muerto y sin probar. ⚠️ Al tocar ese CHECK, filtrar por su CONTENIDO — hay dos que
  mencionan `source_type` y la primera versión de la `028` dropeó los dos.

### Pendiente de decisión

**No existe ninguna pantalla que liste gastos individuales.** `/legal/gastos` es un balance por
caso y los gastos sueltos solo viven dentro del detalle del caso. El filtro "sin clasificar"
que pidió Oliver no tiene dónde colgarse todavía: hay que decidir la superficie primero.

613 tests, `tsc` limpio, 21 errores de ESLint (los de siempre).

---

## [Gastos de trámite — Paso 1: pantalla contable y editor de líneas] - 2026-09-03

Primer código del bloque de gastos de trámite. **No incluye la migración ni el asiento**: el
`CHECK` de `amount` espera el resultado del pre-flight contra producción, así que se hizo lo
que no depende de eso.

### El modelo de líneas, compartido por los dos módulos

`expense_lines` con **arco exclusivo**: dos FK nullables (`expense_id` /
`business_expense_id`) y un `CHECK` de exclusividad. Una sola tabla, un solo validador, un solo
editor y un solo builder — compras entra con cero esquema nuevo.

Lo que **no** se comparte es a dónde va el ITBMS: en un gasto de trámite es pass-through (va
entero al activo recuperable, porque el gasto no es del bufete) y en una compra es crédito
fiscal, cuya cuenta no existe en el plan. 🔑 **Por eso el gasto de trámite NO está bloqueado
por la pregunta del ITBMS al contador** — ese bloqueo es solo de compras.

`supplier_id` NO va en la línea: un documento tiene un proveedor, y si hay dos son dos
documentos. Una columna nullable que siempre es NULL confunde a quien la lea en seis meses.

### 🔴 `chart_account_code` es NULLABLE, y es una decisión

Las líneas que el backfill va a crear para los gastos históricos quedan en **NULL**, no en
`130003`. Esos gastos se cargaron cuando el campo no existía: **nadie los clasificó nunca**, y
algunos pudieron ser costo propio del bufete (`500005`) y no fondos de cliente. Escribirles el
default no sería aplicar un default: sería inventar un dato y darle la misma apariencia que a
uno cargado por una persona.

Por qué NULL y no un comentario en la migración: un comentario documenta la intención pero **no
viaja con la fila**. En seis meses alguien escribe un script para postear gastos históricos,
consulta la tabla, ve `130003` en todas y no tiene ningún motivo para leer el encabezado de una
migración. Es el mismo error que costó tiempo tres veces esta semana.

Por qué NULL y no un flag `clasificacion_verificada`: es una columna que hay que acordarse de
consultar. Con `string | null` **el builder del asiento no compila** si no maneja el caso, así
que una línea sin clasificar no se puede postear por accidente. Y la consulta de limpieza
(`WHERE chart_account_code IS NULL`) se vacía sola a medida que alguien clasifica.

Lo nuevo nunca nace en NULL: lo exige el validador, con un test que lo fija. El `NOT NULL` dejó
de estar en la base y pasó a estar ahí.

### Pantalla `/finanzas/gastos-tramite/{id}` — y su recorte de privacidad

Existe porque el contador no entra a `/legal/*` y sí entra al Libro Mayor: sin ella, el ícono
del mayor le prometería abrir el gasto y lo depositaría en otra parte. Mismo patrón que el
detalle de factura — **el detalle sí, el listado no**, y como patrón de ruta y no prefijo, para
que un listado futuro no se herede solo.

🔒 **Es una puerta al módulo Legal, así que su alcance es política del bufete.** Muestra monto,
líneas, cuentas, fecha, proveedor con RUC y DV en columnas separadas, vencimiento, comprobante
y **del caso solo el NÚMERO**. Nada de descripción, partes, documentos, notas ni historial.

**El recorte vive en el `select`, no en el JSX.** Si el query trajera el caso entero y la
pantalla eligiera qué renderizar, el dato confidencial ya estaría en el servidor y a un
`{caso.description}` de distancia. Así **nunca sale de la base**. Y el código del caso **no es
un enlace**: un `<Link>` a `/legal/casos/{id}` sería la puerta de atrás en una línea.

Detalle completo en `sop.md` SOP-022.

### El comprobante: el contador dejó de tener un 403

`/api/expenses/[id]/receipt/download` rechazaba al contador explícitamente. Era correcto
mientras no tuviera forma de llegar a un gasto de trámite; con la pantalla nueva, un 403 ahí
deja un botón de descarga que falla al apretarlo. Auditar un asiento es poder ver su
comprobante. ⚠️ Amplía el acceso a **un archivo** —material contable— no al expediente.

### `source_type = 'gasto_tramite'`, un valor nuevo

`'gasto'` ya está tomado por `business_expenses` y es lo que `destino-documento.ts` usa para
decidir a qué pantalla lleva el ícono del mayor. Compartirlo mandaría un gasto de trámite a
`/finanzas/gastos-bufete` con un id que ahí no existe — el bug del 01/09 otra vez. Un valor
nuevo tiene además cero backfill: `'gasto'` sigue significando lo mismo que hoy.

### Tests: 613 (+38)

- `expense-line.test.ts` (29) — la cuenta obligatoria al crear, los totales del caso real de
  tres cuentas que motivó el modelo, el redondeo al final y no línea por línea, y la línea
  vacía que se descarta en silencio.
- `gastos-tramite-privacidad.test.ts` (9) — el que pidió Oliver. Lista **blanca** de campos de
  `cases`, así que falla también con un campo que a nadie se le hubiera ocurrido prohibir.

⚠️ **La primera versión del test de privacidad se disparó con un falso positivo propio**:
miraba todos los `.select(...)` del archivo pegados y marcó `description`, que es
`expense_lines.description`. Se lo hizo **preciso** en vez de agregarle una excepción — un test
que grita cuando no hay nada roto se termina desactivando. Y al hacerlo quedó más fuerte, porque
pasó de lista negra a lista blanca.

### Lo que falta del bloque

La migración `036` (tabla + columnas del encabezado + backfill), el builder del asiento, la ruta
que postea, el trigger de inmutabilidad y el formulario de alta. **La migración está bloqueada
por el pre-flight de `expenses` en producción**: `amount` no tiene ningún `CHECK` de signo y no
se puede saber desde acá si hay algún gasto en 0 o negativo. Con ese dato se decide si el
`CHECK` de la línea va `> 0` o `>= 0`.

`tsc` limpio. 21 errores de ESLint, los mismos de siempre; cero en los archivos nuevos.

---

## [Auditoría del inventario + el reembolso apunta a 130003 + "Cobros"] - 2026-09-03

Tres cosas, en el orden en que se hicieron. Las dos últimas son el prólogo del bloque de
gastos de trámite: no tiene sentido construir un asiento que DEBE `130003` mientras el
catálogo de servicios apunta a otra cuenta para lo mismo, ni tocar los formularios de cobro
dejándolos diciendo "Pago".

### 1. El inventario de la reunión del 25/08 mentía en las dos direcciones

Se auditaron **fila por fila las ocho secciones** de
`Clientes/Integra/Temas Contables/REQUISITOS-REUNION-25-AGOSTO.md` contra el código real —no
contra el inventario, ni contra `task_plan.md`. **Once filas estaban mal marcadas**, y en
los dos sentidos, que es lo que lo hacía caro: filas en ⬜ que estaban terminadas, y una
fila en ✅ que no existía.

**Estaban hechas y decía que no:** tipo de documento en desplegable
(`invoice-form.tsx:250-267`), balance y ER a cualquier fecha (se hizo el 02/09), el saldo
inicial del mayor sí se ajusta al rango (`libro-mayor.ts:88-101`), importación masiva de
saldos (`bulk/route.ts:190-212`), estado de cuenta por cliente y proveedor (no es un
placeholder), subcategoría de depreciación acumulada, el guard de cuentas con movimientos
(`api/chart-of-accounts.ts:246-277`), el filtro de subcategorías por tipo
(`manager.tsx:531`), la tasa de ITBMS configurable, balance de comprobación, diario general
y la antigüedad detallada por documento.

**Y la que decía ✅ sin serlo:** el reembolso a `130003`. Estaba leído de un *fixture de
test* (`reports/__tests__/convergencia.test.ts:137-140`), no del sistema. Ver el punto 2.

**Además, la sospecha de "12 tests ocultos detrás de `skip`" es falsa:** `npm test` da 575
pass y **0 skipped**. No hay ningún renombrado `gastos_operativos` a medias — se completó
con la migración `025`.

**El arreglo estructural, que es el que importa.** El documento tenía DOS fuentes de verdad:
las tablas de las secciones 1 a 8 y un bloque narrativo "estado al cierre del día" que decía
"donde difieran, manda este bloque". Esa estructura es la que lo hizo mentir tres veces en
dos días. Ahora **hay una sola fuente —las tablas—**, cada fila lleva su prueba en
`archivo:línea`, y la regla para marcar ✅ es que se pueda señalar el código. El bloque
narrativo se eliminó.

### 2. Los seis servicios de reembolso apuntan a `130003`, no a `2201`

`sql/pending/035_reembolso_a_fondos_legales.sql`. Lo decidió el acta del 25/08 ("Reembolso al
facturar: HABER 130003, nunca ingreso") y hasta hoy el catálogo decía otra cosa.

**No es un detalle de nomenclatura: son dos lados del balance.** `2201` es un PASIVO y
`130003` un ACTIVO, y acreditar un pasivo lo aumenta mientras acreditar un activo lo
disminuye. El acta decidió dos asientos que forman un par y solo cierran del lado del activo:

    Al incurrir el gasto:      DEBE 130003  /  HABER Cuentas por Pagar
    Al facturar el reembolso:  DEBE CxC     /  HABER 130003

El bufete adelanta plata por el cliente (el activo sube) y al facturarle el reembolso el
adelanto se cancela contra la cuenta por cobrar: `130003` vuelve a cero y lo que el cliente
debe queda entero en CxC, sin pasar nunca por una cuenta de ingreso. Con `2201` en su lugar,
facturar el reembolso **inflaría un pasivo en vez de cancelar el adelanto** y el trust fund
quedaría contado dos veces.

**La inconsistencia ya estaba en el repo, en el otro sentido.** Los dos scripts que siembran
el ledger (`seed-asientos.ts:163,183` y `backfill-asientos-faltantes.mts:159-160`) ya
posteaban contra `130003`. O sea: **los asientos sembrados estaban bien y el catálogo estaba
mal.** Nadie lo notó porque ninguna ruta de `/api` postea al ledger todavía —
`revenue_account` se lee (`queries/catalogs.ts:80`) pero nadie lo usa para armar un asiento.

**No reescribe nada histórico:** `revenue_account` NO se snapshotea en `invoice_lines` (ahí
el snapshot es `tax_code`/`tax_rate`). Es configuración, no dato histórico.

**Lo que NO se tocó:** los `HON-*` siguen en `4101`. Qué cuenta de ingreso ACTIVA va en cada
servicio es una de las tres definiciones que faltan del contador, y postear contra una cuenta
inactiva del plan viejo es peor que no postear.

**El guard, y por qué:** `130003` no viene de ninguna migración — la crea
`npm run seed:staging` desde el Excel de las 62 cuentas de Josuar. Sin la cuenta, el FK
compuesto de `services_catalog` rechaza el UPDATE con un error que no dice nada. El paso 1 lo
chequea antes y aborta con un mensaje legible.

**Por eso 035 NO está en `BUNDLE_2`.** El bundle corre ANTES del seed, así que la migración
abortaría en toda base reseteada. La misma regla vive en dos lugares, uno por situación: la
migración arregla una base que ya existe, y `apuntarReembolsosAFondosLegales()` en
`seed-staging.ts` deja bien una recién armada. **Si cambia la cuenta, van los dos** — está
escrito en los dos archivos y en `staging-migration-order.mjs`.

**Aplicado a staging**, con los NOTICE leídos: los 6 servicios (`REIM-ADM`, `REIM-GOB`,
`REIM-NOT`, `REIM-OTH`, `REIM-REG`, `REIM-TIM`) pasaron de `2201` a `130003`. Segunda corrida:
0 filas, guard OK, verificación en 6. **Producción NO** — hay facturas de reembolso reales y
el cambio se revisa con RM antes.

### 3. `033` y `034` entraron al bundle de staging

Se habían aplicado a mano el 02/09 y quedaron fuera de la lista. Sin ellas un `--reset`
reconstruía una staging **sin proveedores** y **sin el UNIQUE que impide postear dos veces el
mismo documento** — o sea, peor que la base que reemplaza.

### 4. "Pago" → "Cobro" en los dos formularios que lo escriben

Estaba a medias desde el 02/09 y **así era peor que no haberlo empezado**: el mismo registro
se leía "Cobro" y se escribía "Pago", justo la confusión que Rose pidió eliminar ("desde
Integra, pago es dinero que sale"). La lectura ya estaba corregida en
`legal/casos/[id]/page.tsx`; faltaban los formularios.

- `add-expense-form.tsx` — los dos botones que abren el formulario, el título, el label de
  fecha, el botón de guardar y el mensaje de error de validación.
- `section-expense-form.tsx` — pestaña, título, label de fecha, botón y error.

Los identificadores internos (`payAmount`, `handleAddPayment`, `/api/payments`,
`payment_type`) quedan como están: son código, no interfaz, y renombrarlos es un refactor con
su propio riesgo. El requisito era el texto que ve la persona.

### Lo que NO se hizo, a propósito

El bloque de gastos de trámite quedó **solo en diseño**. Y sigue en pie el pendiente menor del
02/09: los badges del hub de reportes dicen "Sin corte por período" para `/pyl` y `/balance`
(`reportes/page.tsx:53,59`), que dejó de ser cierto.

---

## [Filtro de período en los tres estados financieros] - 2026-09-02

Es el renglón que Josuarth pidió el 18/08: *"Balance y estado de resultados a cualquier
fecha histórica, misma respuesta siempre"*. Hasta hoy los tres estados mostraban la
historia completa y no había forma de pedir un cierre mensual. Un Estado de Resultado sin
corte de período no es un cierre: es un acumulado desde el origen.

### La semántica, que no es la misma en los tres

- **Balance General — A UNA FECHA.** Un solo campo. No existe "el activo entre marzo y
  junio": es la foto del patrimonio en un instante.
- **Estado de Resultado — DE UN PERÍODO**, y **excluye la apertura de las cuentas de
  resultado**. Lo acumulado de ejercicios anteriores no es resultado de este trimestre.
- **Balance de Comprobación — DE UN PERÍODO**, con saldo inicial al comienzo del rango.

### El problema que podía romper el Balance, y cómo se resolvió

El renglón "Utilidad del Ejercicio" del patrimonio sale de un cálculo de resultado. Si ese
cálculo pasaba a ser el DEL PERÍODO mientras el Balance necesita el ACUMULADO a su fecha,
el estado dejaba de cuadrar. Y no por poco: medido en staging, **el descuadre habría sido
de 244.476,91**.

La regla que lo cierra: **el Balance nunca toma su número del Estado de Resultado que se
muestra en pantalla.** Son dos cargas con alcances distintos —el Balance con `{hasta}` y
la apertura incluida; `/pyl` con `{desde, hasta}` y la apertura excluida— y el Balance
calcula su utilidad **del mismo conjunto de cuentas que él mismo usa**. Cuadra por
construcción, no por coincidencia.

### Un parámetro en la fuente, cero cambios en los builders

El rango se resolvió en `loadReportAccounts`, no partiendo el cálculo. Que los tres
reportes no puedan divergir no es una coincidencia a mantener a mano: es que los tres leen
esa función. **Los tres builders quedaron sin tocar** — `buildBalanceComprobacion` ya leía
`saldoInicial` / `debitos` / `creditos` sin recalcular, así que alcanzó con que el loader
entregue el saldo al inicio del rango en vez de la apertura.

Cada cuenta vuelve ahora con el desglose completo: `saldoApertura`, `movimientoAnterior`,
`debitos`/`creditos` del rango, `saldoInicial` (= apertura + anterior) y `saldo`.

### El aviso dice el NÚMERO, no el hecho

Cuando el Estado de Resultado tiene período activo, la nota dice **"Se excluyeron
244.476,91 de saldos de apertura de cuentas de resultado, que corresponden a ejercicios
anteriores al corte"**. Con el número el contador puede verificarlo y ve la
inconsistencia; sin el número es una disculpa. El valor sale de sumar `aperturaExcluida`
de las cuentas —el mismo dato que el reporte no usó— y no de un cálculo paralelo que
podría desincronizarse.

### Verificación

**Con datos reales de staging**, corriendo el mismo código que las pantallas sobre cinco
cortes distintos: los cuatro invariantes dan bien en los cinco.

| Corte | Activo | Pasivo | Patrimonio | Descuadre |
|---|---|---|---|---|
| sin filtro | 262.717,46 | −17.334,80 | −245.382,66 | 0,00 |
| al 30/04/2026 | 258.972,46 | −17.089,80 | −241.882,66 | 0,00 |
| al 31/05/2026 | 260.577,46 | −17.194,80 | −243.382,66 | 0,00 |
| 10/04 → 30/06 | 262.717,46 | −17.334,80 | −245.382,66 | 0,00 |

Y el Estado de Resultado del período 01/05 → 30/06 da **−905,75**, con **244.476,91**
excluidos — que es exactamente el número de la nota.

**30 tests nuevos** (575 en total, todos en verde) sobre siete cortes distintos:

1. Sin filtro, los cuatro totales al centavo. El caso por defecto no se movió.
2. **Σ saldo inicial = 0,00 en cualquier corte.** Un ledger de partida doble está cuadrado
   en cualquier fecha; si un corte lo rompe, el corte está mal. Es la alarma más barata
   del bloque.
3. Σ débitos = Σ créditos dentro del rango.
4. **Con filtro activo, Activo = Pasivo + Patrimonio al centavo**, sobre un rango que
   corta ENTRE dos asientos para que lo anterior NO netee a cero cuenta por cuenta. Esa
   precaución no es teórica: verificando el Libro Mayor ese mismo día, el primer rango
   probado tenía los movimientos previos cancelándose (+1.070 +150 −1.070 −150) y el
   resultado se veía idéntico a no ajustar nada. Un rango así habría dado por buena una
   implementación rota.
5. **Los tres números de resultado son el mismo** —clásico, NIIF 18 y el renglón del
   Balance—. Hoy coinciden en −245.382,66 pero nada lo protegía: son dos builders
   distintos alimentados por la misma fuente, y si se separaran, la pantalla que lee el
   contador y el patrimonio del Balance dirían números distintos sin que nadie se entere.

### Lo que quedó afuera, a propósito

- **El Libro Mayor no se tocó.** Ya tenía su filtro y su saldo de arranque ajustado, ambos
  verificados contra datos reales. Unificar su `sumaMovimientosAnteriores()` con la versión
  general del loader es una simplificación posterior con su propio commit: hoy funciona y
  meterlo acá sería arriesgar lo único que ya sabemos que anda.
- **Antigüedad, Estado de cuenta y Ventas mensuales.** No son reportes de período: son
  fotos a hoy. "Filtrarlos" no es acotar un rango sino mover la fecha de referencia de los
  tramos, que es otro diseño con su propia pregunta contable (¿un documento pagado después
  del corte se muestra como pendiente?). Van en su propio bloque.
- **El resultado del ejercicio vs. el acumulado histórico.** El Balance a una fecha lleva
  al patrimonio el acumulado hasta esa fecha. Hoy coincide con el resultado del ejercicio
  porque el ledger tiene uno solo; cuando haya dos, hace falta el asiento de cierre que
  lleva el resultado a `300003`. Ya estaba previsto como Paso 3 y ya tiene su advertencia
  de doble conteo en `buildBalanceGeneral`.

### Un hallazgo que NO se arregló

Medir el peso de las aperturas destapó que **los saldos cargados contradicen la regla que
dio Rose**: 15 cuentas de resultado tienen 244.476,91 de apertura fechada **01/01/2026**,
y Rose escribió que *"al 1 de enero solo tienen saldo las cuentas del estado de situación
financiera"*. O la fecha está mal (y eso es el acumulado del año) o los saldos se cargaron
mal. **Ningún saldo se modificó.** Queda anotado con el número y las dos hipótesis en
`task_plan.md` **A-quinquies**, para ir al correo como pregunta.


## [Dos banners que decían que el portal no existe] - 2026-09-02

Oliver verificó que el correo de la cotización **sí** manda el enlace al portal y que
el portal está en uso. Aun así, dos avisos en pantalla seguían diciendo lo contrario, y
los leían las abogadas cada vez que enviaban una cotización.

### Lo que decían, y por qué era grave

`public-link-display.tsx` y `send-quote-dialog.tsx` afirmaban que *"el portal público
estará disponible en una próxima actualización"*. Quedó desactualizado cuando la Fase
2E.4 lo puso en marcha y nadie volvió a leerlo. Consecuencia práctica: alguien que lo
lea pega el enlace a mano en un WhatsApp creyendo que el correo no lo lleva.

El segundo era peor. Decía *"Cuando el cliente responda, marque la cotización como
aceptada o rechazada manualmente desde esta misma pantalla"* — **una instrucción que
invita a pisar un registro con firma electrónica.**

### Lo que el flujo hace de verdad (verificado leyéndolo entero)

- `POST /api/finanzas/quotes/[id]/send` arma `publicLink` y se lo pasa a
  `sendQuoteEmail` en **todos** los envíos: no hay rama condicional. La plantilla lo
  renderiza en el HTML (botón *Ver cotización en línea*) y en el texto plano.
  `/resend` hace lo mismo y **reutiliza el `public_token` original**.
- El portal funciona de punta a punta: `/api/public/cotizaciones/[token]/accept` y
  `/reject` registran la firma electrónica, cambian el status solos y disparan correos
  **al cliente y a las abogadas** (`email_lawyers_ok` en la respuesta de ambas rutas).

### Y la instrucción peligrosa ni siquiera era ejecutable

Buena noticia, y la única razón por la que esto se pudo cerrar como un cambio de texto:
`markAcceptedManual()` y `markRejectedManual()` exigen `status === 'enviada'` y
devuelven **400** en cualquier otro estado. El botón tampoco se renderiza:
`isQuoteDecidable()` es `status === "enviada"`. Y `quote_acceptances` /
`quote_rejections` solo las escriben las rutas públicas del portal, con UNIQUE por
cotización. **La evidencia de firma no se puede pisar ni desde la UI ni desde la API.**

### Cómo quedaron

El diálogo de envío **ya tenía** los dos mensajes correctos, condicionados a
`email_sent`: verde "email enviado con el PDF adjunto", ámbar "no se pudo enviar —
copie el enlace y compártalo manualmente". Lo falso era un **tercer** bloque permanente.
Ese bloque ahora dice lo que corresponde saber, y dejó de ser una advertencia ámbar para
ser una nota informativa gris: la señal de alarma es el bloque ámbar de arriba, y dos
avisos ámbar juntos le quitan peso al que sí importa.

En el detalle (`public-link-display`) solo va el mensaje permanente: esa pantalla **no
sabe** si el correo salió, porque `email_sent` es el resultado del POST y no una columna
de `quotes`. El texto está redactado para ser cierto en los dos casos.

### El hallazgo que NO se arregló hoy

Debajo del banner apareció un hueco de auditoría real: **aceptar o rechazar una
cotización a mano no registra quién lo hizo.** Los helpers reciben el `userId` y lo
descartan (`_userId`), y la ruta no escribe en `audit_log` — a diferencia de `duplicate`
y `resend`, del mismo módulo. Es código, no texto, y se dejó anotado con su análisis
completo en `task_plan.md` **A-quater**, incluida la pregunta que hay que responder
antes de tocarlo (respuesta ya verificada: `quotes` **no** tiene columna para el
usuario, así que el camino barato es `audit_log`).


## [Trato de usted en el portal público y los correos al cliente] - 2026-09-02

Cierre del barrido de tuteo. Este es el bloque que Oliver pidió revisar cadena por
cadena y aparte de todo lo demás, con un motivo explícito: **es la voz del bufete
hacia sus clientes.** Un toast de error interno lo ve una abogada tres segundos; el
correo de una cotización lo lee la persona que va a contratar al bufete.

**28 cadenas en 5 archivos:** el portal `/cotizacion/[token]`, las respuestas de
`quote-portal.ts` que el cliente ve en pantalla, el correo de la cotización y el de
confirmación de aceptación.

### No alcanzaba con conjugar

Cuatro se reescribieron enteras porque el problema no era la persona verbal:

- *"Verifica que hayas copiado el link completo del correo"* → **"El enlace de esta
  cotización no tiene un formato válido. Es posible que se haya copiado incompleto.
  Ábralo directamente desde el correo que recibió."** La versión anterior señalaba
  el error sin decir qué hacer.
- *"Cuéntanos por qué no procedes"* → **"por qué no desea continuar"**. "No procede"
  se lee como "no corresponde".
- *"queda en tu legajo"* → **"queda en su expediente"**. `Legajo` es rioplatense; en
  Panamá se dice expediente. Es exactamente el tipo de palabra que delata que el
  sistema no se escribió acá. (El `legajo` de `posting.ts:171` se dejó: ahí es el
  término contable correcto y vive en un comentario de código.)
- Sale **"(doble clic)"** de los dos mensajes de doble envío. Es jerga nuestra y le
  echa la culpa al cliente de una condición de carrera.

### Una sola forma: "en línea", nunca "online"

`online` no estaba en un solo lugar sino en tres, todos en el mismo correo: el botón
`Ver cotización online →` del HTML, el `Ver cotización online: {link}` del texto plano
y el `portal online` del cuerpo. Los otros nueve usos de la palabra en el repo son
código de la cola offline (`connectivityService.on("online")`) y no se tocaron.

### Seis que el barrido de imperativos no podía ver

El detector buscaba imperativos (`verifica`, `intenta`). Estas seis son tuteo **sin**
imperativo, y aparecieron al leer los archivos completos para redactar la propuesta:
`¿Tienes dudas?`, `no procedes`, `te contactará` y tres `Te enviamos la cotización`.

Se incluyeron porque dejarlas afuera producía el peor resultado posible: el correo
habría abierto con *"Te enviamos la cotización COT-001269"* y tres párrafos después
dicho *"Desde el portal en línea puede aceptar o rechazar…"*. **Tuteo y usted en el
mismo correo es peor que cualquiera de los dos solo.**

### Lo que NO se tocó

- **`buildConsentText()`** — el texto que el cliente firma electrónicamente. Está en
  primera persona (*"Yo, {nombre}, en mi calidad de…"*), así que no tenía tuteo, y
  además está versionado (`CONSENT_TEXT_VERSION`): cada aceptación guarda en la BD el
  texto exacto que se mostró. Lo único que se ajustó ahí son los **placeholders de la
  vista previa** (`[tu nombre]` → `[su nombre]`), que no forman parte del texto firmado.
- La referencia a la **Ley 51 de 2008** y el resto de las frases con peso legal.

Verificación final: una búsqueda de segunda persona (`tu`, `tus`, `te`, `estás`,
`tienes`, `puedes`, `prefieres`, `procedes`) sobre los cinco archivos vuelve **vacía**.
545/545 tests. `tsc` limpio.


## [Trato de usted en todo el CRM interno — grupos 1 a 7] - 2026-09-02

Cierre del barrido de tuteo. El inventario anterior (81 cadenas, casi todas de Finanzas)
había dejado afuera los imperativos en segunda persona sin tilde — `registra`, `verifica`,
`intenta` — que un detector de voseo no ve porque son **homógrafos de la tercera persona
del indicativo**: "registra" es tanto *vos registrá* como *él registra*. Hubo que listarlos
y clasificarlos a mano.

**115 coincidencias en bruto → 86 imperativos reales + 29 falsos positivos.** De los 86,
este commit corrige **77**: todo lo interno. Los 9 del portal público y los correos al
cliente quedan para un bloque aparte, a pedido de Oliver, porque son la voz del bufete
hacia sus clientes y se revisan uno por uno.

### Qué cambió

- **39 ocurrencias de tres frases repetidas** en 33 archivos: `"Intenta de nuevo"` →
  `"Intente de nuevo"`, `"Intenta recargar"` → `"Intente recargar"`,
  `"Verifica tu conexión a internet"` → `"Verifique su conexión a internet"`.
- **39 cadenas puntuales**: login, validaciones de formulario, estados vacíos,
  placeholders, conflictos de negocio, guía de errores del PAC e importación masiva.

### Doce resueltas en impersonal, no en usted

Donde el usted sonaba rígido se usó la forma impersonal, siguiendo el criterio de
redacción de Oliver ("no traduzcas mecánicamente"). Los siete **estados vacíos** son el
caso claro: *"Aún no hay facturas. La primera se crea con el botón de arriba"* dice lo
mismo que *"créela usted"* sin dar una orden a quien recién entra a una pantalla vacía.
Igual criterio en *"Primero hay que eliminar los casos"*, *"Para descartarla está el
botón Eliminar"*, *"Corresponde usar esa ficha…"* (×2) y el error del importador, que
ahora describe la columna en vez de mandar: *"la columna Tipo Fiscal (o Tipo) debe decir
'Natural' o 'Jurídica'"*.

### Dos faltas de ortografía, de paso

`delete-client-button.tsx` y `delete-document-button.tsx` decían **"Error de conexion"**
sin tilde. Estaban así desde que se escribieron; salieron a la luz porque el barrido
obligó a leer las 33 copias de la misma frase. Ver `task_plan.md` **A-ter**: la frase
debería estar centralizada, y ese es justamente el argumento.

### Tres tests actualizados

- `delete-financial-guard.route.test.ts` y `classify-pac-error.test.ts` afirmaban sobre
  el texto anterior.
- `classify-pac-error.test.ts` tenía además un test llamado *"La guía usa tuteo neutro
  panameño"* que **exigía** el tuteo. Se reescribió como *"La guía trata de usted (ni
  tuteo ni voseo)"*: ahora afirma las tres cosas, para que el trato correcto quede
  clavado en los dos sentidos y no solo contra el voseo.

545/545 tests en verde. `tsc` limpio. Los 21 errores de ESLint son los mismos de antes
del cambio (verificado con `git stash`): este commit no agrega ni quita ninguno.

### Lo que NO se tocó

- **Los 29 falsos positivos.** *"La tasa se aplica a los documentos…"*, *"Esta acción
  asigna el número definitivo"*, *"el resultado del ejercicio cierra en cero"* y
  compañía son tercera persona del indicativo, no imperativos.
- **`delete-confirmation-modal.tsx`**: se cambió la instrucción visible (*"Escriba …
  para confirmar"*) pero **no** el valor esperado ni la comparación `inputValue ===
  confirmCode`. Se verificó además, con una búsqueda de comparaciones contra literales
  en español, que ninguna otra cadena del barrido se compare en vez de mostrarse.
- **Portal público y correos al cliente** (grupo 8, 9 cadenas): bloque aparte.


## [Corrección: tres errores míos en el aviso de la antigüedad] - 2026-09-02

Los tres los introduje en el bloque de idempotencia del mismo día, y los tres se veían en la
pantalla renderizada.

### 1. Un texto que anticipaba código que no existe

Escribí *"Al emitir una factura o registrar un cobro se genera su asiento"*. **Es falso.** El
posteo automático quedó bloqueado por las tres preguntas al contador — lo dije yo mismo en el
diseño y después redacté el aviso como si ya estuviera hecho.

Ahora dice lo que pasa hoy: *"Los asientos todavía no se generan solos al emitir una factura o
registrar un cobro: hoy se cargan aparte, así que un documento nuevo aparece acá hasta que su
asiento se registre."*

### 2. Una frase vieja contradiciendo a la nueva en la misma pantalla

El cierre seguía diciendo *"el cableado de documento a asiento es desarrollo pendiente"* mientras
el párrafo de arriba afirmaba que el asiento se generaba solo. Cambié una y no la otra.

### 3. El bloque se mostraba con todo en cero

Dije que el desglose *"se adapta solo"* y **no lo verifiqué**. Se renderizaba igual, con
`Son 0 factura(s) por 0.00` y un `0.00` al lado: un renglón que le pide al contador descartar una
causa que no existe.

Ahora hay una condición explícita — `hayQueCablear`, con tolerancia de centavo y no `=== 0` — y
cuando la única causa es el saldo de apertura **no hay desglose**: una sola frase que la nombra y
dice cómo se resuelve.

### Verificado en la pantalla renderizada, no con grep

La extensión de Chrome sigue desconectada, así que me autentiqué contra Supabase por HTTP, armé la
cookie de `@supabase/ssr` y traje el HTML de las dos pantallas. **Por cobrar** (diferencia
191.947,55) y **por pagar** (3.400,48) muestran la versión de una sola causa, y las cinco cadenas
problemáticas están ausentes en las dos.

### Lo que NO pude verificar

**La rama de dos causas no tiene datos que la produzcan**: después del backfill, `porCablear` es
0,00 en las dos pantallas. Compila y la lógica del builder está cubierta por tests, pero **no la vi
renderizada**. Va a aparecer la primera vez que se registre una factura sin asiento.

545 tests. Typecheck limpio. Build compilando. Lint: 21 preexistentes.


## [Idempotencia del ledger, backfill de los 250,00 y gate de anulación] - 2026-09-02

Las tres piezas del cableado factura→asiento que **no dependían de ninguna respuesta del
contador**. El posteo automático queda para cuando lleguen: derivar la cuenta de ingreso hoy
obligaría a hardcodear el mapeo, que es exactamente el problema que se está eliminando.

### 1. UNIQUE parcial — un documento, un asiento

`sql/pending/034_asiento_unico_por_documento.sql`. Hasta hoy **nada impedía postear dos veces la
misma factura**: `idx_je_tenant_source` es un índice común, no UNIQUE. Y un asiento duplicado en un
libro inmutable **no se borra** — los triggers de la `023` rechazan el DELETE.

Va en la base y no en el código a propósito: un chequeo previo en la ruta deja una ventana entre el
SELECT y el INSERT, y dos requests concurrentes pasan los dos. El chequeo en la ruta se agrega
igual, pero para dar un mensaje entendible, no como la garantía.

Es **parcial** (`WHERE source_id IS NOT NULL`) porque los asientos manuales y el futuro asiento de
apertura no tienen documento.

**Verificado antes de escribirla:** staging tiene 9 asientos con `source_id` y 9 combinaciones
únicas — cero duplicados. **En producción NO se verificó ni se aplicó**; la query está en el paso 1
del archivo y en `task_plan.md`.

⚠️ **Para producción:** la versión del paso 2 toma un lock de escritura. Con las decenas de filas
de hoy es instantáneo, pero si la tabla creció hay una versión `CONCURRENTLY` comentada — que **no
puede correr dentro de una transacción** y deja un índice inválido si falla a mitad. Las dos cosas
están escritas en el archivo.

### 2. Backfill de los 250,00 — solo staging

La antigüedad de CxC difería del mayor en 191.697,55 contra una apertura de 191.947,55. Los 250,00
de sobra tenían **dos causas nuestras**: `FAC-REI-000002` (400,00) emitida sin postear, y el cobro
de `FAC-REI-000001` (150,00) sembrado sin asiento a propósito para preservar la línea base de
2.895,00. Esa línea base ya cumplió.

Los dos asientos siguen patrones ya decididos, ninguno es nuevo:

```
FAC-REI-000002   D 100004 Cuentas por Cobrar   400,00
                 H 130003 Fondo Legales        400,00   ← acta del 25/08: reembolso nunca es ingreso
cobro 4471915    D 100001 Banco                150,00
                 H 100004 Cuentas por Cobrar   150,00
```

**Los saldos reales coincidieron con la proyección del diseño al centavo:**

| Cuenta | Antes | Después | Movió | Proyectado |
|---|---|---|---|---|
| 100001 Banco | 62.770,91 | **62.920,91** | +150,00 | 62.920,91 ✅ |
| 100004 Cuentas por Cobrar | 194.842,55 | **195.092,55** | +250,00 | 195.092,55 ✅ |
| 130003 Fondo Legales | 2.369,11 | **1.969,11** | −400,00 | 1.969,11 ✅ |

Los dos asientos mueven activos entre sí, así que **ningún total del Balance cambió**: Activo
262.717,46 · Pasivo −17.334,80 · Patrimonio −245.382,66 · descuadre 0,00.

**Y la diferencia del auxiliar quedó con UNA sola causa:** 191.947,55, exactamente el saldo de
apertura. `porCablear` en 0,00, cero documentos sin asiento, cero cobros sin asiento.

El script (`scripts/backfill-asientos-faltantes.mts`) es **idempotente y se verificó corriéndolo
dos veces**: la segunda saltea los dos. Usa `postJournalEntry()`, nunca INSERT directo. Tiene
`--dry-run` y aborta si la URL no es la de staging.

### 3. Gate de anulación

Hoy se podía anular una factura ya posteada: el status cambiaba, se generaba la nota de crédito, y
**el asiento seguía vivo en el libro**. La factura desaparecía de la antigüedad y su débito quedaba
en el mayor — divergencia silenciosa, que es el único resultado inaceptable.

`cancelInvoice()` ahora rechaza con 409 si la factura tiene asiento, con un mensaje para la abogada
y no un error técnico. Afecta a las 5 facturas con asiento de staging.

**Por qué bloquear y no revertir:** revertir no es postear el asiento espejo. Hay que decidir con
qué fecha se revierte —la del asiento original, que puede caer en un período cerrado, o la de la
anulación— y eso es criterio contable. Bloquear es feo pero **visible**.

### 4. El texto de la antigüedad

De *"el cableado de documento a asiento aún no está construido"* a *"su asiento falló o quedó
pendiente, y hay que revisarlo"*. Hoy el bloque no se muestra —no hay documentos sin asiento— pero
cuando vuelva a aparecer va a significar eso.

### Lo que queda esperando al contador

Tres preguntas que **bloquean el posteo automático**, y ninguna es decisión de desarrollo:

1. **Qué cuenta de ingreso** le corresponde a cada servicio del catálogo. Hoy
   `services_catalog.revenue_account` apunta a `4101` y `2201`, **las dos inactivas** — es el plan
   viejo. Por eso el seed hardcodeó la cuenta factura por factura.
2. **Qué cuenta bancaria** por defecto para los cobros: `payments` tiene `method` pero no cuenta, y
   hay tres bancos activos.
3. **El ITBMS de compras**, que es crédito fiscal y no `200003`.

Diseño registrado y **no decidido**: postear antes de emitir. Hay que revisar si el correlativo de
la factura se asigna al emitir — en ese caso el asiento no tendría número que citar.

545 tests. Typecheck limpio. Lint: 21 preexistentes.


## [El DV en la exportación, y el payload del receptor congelado] - 2026-09-02

Los dos puntos que habían quedado abiertos del diagnóstico.

### 1. La exportación ya saca el DV de los clientes

`tercero-fiscal.ts` lee `clients.digito_verificador` en vez del `""` hardcodeado. Se corrigieron
también el test y los tres comentarios escritos sobre la premisa falsa.

Exportación real del mayor de `100004 Cuentas por Cobrar`, leída de vuelta del archivo:

```
 7 | Fecha      | Tipo          | Núm | Nombre                         | RUC              | DV
 8 | «vacía»    | Saldo inicial | «vac»| «vacía»                       | «vacía»          | «vacía»
 9 | 05/04/2026 | Factura       | 5   | FERRETERÍA VALLARINO, S.A.     | 1554821-1-741203 | 08
11 | 20/04/2026 | Pago          | 7   | FERRETERÍA VALLARINO, S.A.     | 1554821-1-741203 | 08
12 | 20/05/2026 | Factura       | 8   | INVERSIONES TOCUMEN REAL, S.A. | 1588210-1-713366 | 00
13 | 01/06/2026 | Factura       | 9   | PANAMÁ COSTA VERDE, S.A.       | 1602933-1-802514 | 02
```

Los tres DV salen como **texto** con sus ceros: `08`, `00`, `02`. El `00` es el caso extremo del
argumento contra el CSV — se abriría como `0`, o directamente vacío.

**⚠️ El caso del tipo 02 no se pudo mostrar en una exportación real.** El único cliente tipo 02 con
factura en staging (CLI-012, Nidia Espinosa Caballero) la tiene en `cancelada_pre_emision` y sin
asiento, así que no aparece ni en el mayor ni en la antigüedad. Emitirle una factura habría
generado un asiento y movido los números de control con los que quedó staging para la revisión de
Josuarth (SOP-019), así que **no se hizo**. El caso quedó cubierto por test: un cliente con RUC y
sin DV deja vacía **solo** la columna DV, no el RUC.

### 2. Payload del receptor congelado

`receptor-payload-congelado.test.ts` + `receptor-payload-esperado.json`. Congela el bloque
`informacionReceptor` para los cuatro tipos de receptor (01/02/03/04), un DV con cero adelante, un
receptor con ubicación completa, y **los dos casos sucios** del backfill `022`.

El caso sucio queda documentado con el payload exacto que produce:

```
SUCIO-ruc-con-dv-pegado-y-columna-cargada
  datosRucReceptor = { ruc: "25046169-3-2021  DV 40", dv: "40", tipoContribuyente: 2 }
```

El DV viaja **dos veces**: adentro del RUC y en su campo. Es incorrecto aunque el sistema hoy lo
produzca, y el test lo afirma para que nadie lo descubra desde un rechazo de la DGI. El otro caso
sucio —el real en producción— corta antes de armar nada.

El JSON lleva un campo `porque` por caso, explicando qué se está mirando, y el encabezado del test
explica **cómo leer un fallo**: si el cambio no es intencional hay una regresión y se arregla el
mapper, no el JSON; si lo es, se regenera con `ACTUALIZAR_PAYLOAD=1 npm test` y se commitea junto
con el cambio. Un commit que solo toca el JSON esperado es una alarma.

**Se verificó que la red funciona:** se alteró el DV esperado de `00` a `0` y el test falló
nombrando el caso correcto y mostrando el diff del campo.

### Dos bugs míos que aparecieron escribiendo esto

1. **`cliente()` no hacía spread de `over`**, así que los siete fixtures eran el mismo cliente y el
   congelado no probaba nada. Lo delató el caso que tenía que cortar y no cortaba.
2. **El congelado fallaba incluso sin cambios.** `mapReceptor` devuelve claves opcionales valiendo
   `undefined`, `JSON.stringify` las descarta al escribir y `deepStrictEqual` distingue "clave
   ausente" de "clave en undefined". Se resolvió normalizando por JSON antes de comparar, que
   además es más correcto: compara **lo que se serializa y viaja**, no lo que el objeto tiene en
   memoria.

Los dos estaban ocultos detrás de un test en verde. El primero solo salió porque una aserción
independiente lo contradijo; el segundo, porque el modo de regeneración salía antes de comparar.

**529 tests** (+9). Typecheck limpio. Lint: 21 preexistentes, 0 nuevos.


## [Diagnóstico: dónde vive el DV, y corrección de una afirmación falsa] - 2026-09-02

Corrida de diagnóstico, sin escribir código ni tocar datos. Salió de una preocupación de Oliver
—si separar el DV del RUC podía romper la facturación electrónica— y de una contradicción entre
las notas del proyecto y algo que yo había afirmado.

### 🔴 La afirmación falsa era mía

Escribí que **`clients` no tenía columna de DV**. Es falso. Se llama **`digito_verificador`**,
existe en producción desde la migración `019` (30/05/2026) y está poblada en 11 de los 15
clientes de staging.

El error fue de método: busqué columnas con `column_name ILIKE '%dv%'` y ese nombre no contiene
"dv", así que la consulta no podía encontrarla y tomé el vacío como respuesta. La de proveedores,
que creé yo, sí se llama `dv` — por eso esa sí apareció.

**La nota del proyecto era correcta:** el refinamiento del DV que pidió Josuarth se hizo sobre los
CLIENTES y está desplegado. Lo que faltaba era el lado de proveedores, que se construyó el 02/09.

### Dónde vive el DV, de verdad

| Entidad | RUC | DV |
|---|---|---|
| Clientes | `clients.ruc` **y** `clients.tax_id` (espejados por `ruc-sync.ts`) | `clients.digito_verificador` |
| Proveedores | `suppliers.ruc` | `suppliers.dv` |
| Emisor (Integra) | env `EFACTURA_EMISOR_RUC` | env `EFACTURA_EMISOR_DV` |

⚠️ Dos nombres distintos para el mismo concepto (`digito_verificador` en clientes, `dv` en
proveedores). No es un bug, pero es exactamente lo que provocó el error de arriba.

### Qué se le manda a la DGI: ya van separados

`map-receptor.ts` arma `rucReceptor` = `tax_id ?? ruc` y `digitoVerificador` = la columna,
**los dos verbatim**. No hay separación implícita ni parseo: se grepeó `split`/`slice`/
`substring`/`match` sobre `ruc` en todo `src/` y hay **cero** resultados. El emisor va igual, desde
dos variables de entorno.

### Qué NO hay que hacer

**No agregar una columna `dv` a `clients`.** Sería un segundo campo para el mismo dato, y el
mapper seguiría leyendo `digito_verificador` — lo que se cargara en la nueva no llegaría nunca a
la factura. Ese sí habría sido el error caro.

### 🔴 Bug abierto: la exportación manda el DV de clientes vacío

La exportación a Excel del 02/09 escribe `dv: ""` para clientes (`tercero-fiscal.ts:221` y `:265`)
porque se construyó sobre la premisa falsa. **Hay que leer `digito_verificador`.** Es un arreglo
de dos líneas, sin riesgo sobre la facturación —el exportador es solo lectura y no toca ningún
archivo del camino a la DGI— y está anotado en `task_plan.md` pendiente de agendar.

### El backfill `022`, con datos de producción

Oliver corrió la consulta de diagnóstico en producción: **2 clientes afectados (CLI-026 INTEGRA
LEGAL y CLI-081 SERVICARE), los dos "bloqueados por el gate", cero en peligro.**

- **No hay riesgo de mandar un RUC sucio a la DGI.** El gate fiscal exige `digito_verificador`
  para receptores 01/03 y corta con un 400 antes de tocar la red. La combinación peligrosa —DV
  pegado al texto **y** columna poblada— no existe en producción.
- **Lo que sí pasa:** esos dos clientes no pueden recibir factura electrónica, y nadie lo sabe
  hasta que alguien intente facturarles.

Quedó anotado como **bloque propio en `task_plan.md`**, con las dos decisiones que NO son
mecánicas: el DV de CLI-081 dice `"DV 9"` y hay que confirmar contra un documento si son dos
posiciones (`09`) o le falta un dígito —un DV inventado en un anexo de la DGI es peor que uno
faltante—, y los dos tienen `tipo_receptor_fe` en NULL, que es una decisión del bufete y no del
backfill.

Orden acordado cuando se retome: **test de payload congelado → sandbox → producción con aprobación
explícita.**

### Un hueco de cobertura que este diagnóstico encontró

`map-invoice.test.ts` tiene 11 tests, pero **ninguno congela el bloque completo del receptor** y
solo uno mira `rucReceptor`. Un test de payload congelado sobre `mapReceptor()` —los cuatro tipos
de receptor más los casos sucios— es la red que hoy no existe, y sirve para siempre, no solo para
el `022`.

### Sobre cómo probar un cambio en este camino

Se descartó **comparar el PDF antes/después**: el PDF de factura imprime solo `tax_id` y **nunca
muestra el DV** (`InvoiceDocument.tsx:535`), así que saldría idéntico y no probaría nada sobre el
camino que importa. Sirve para otros cambios, no para este.


## [Exportación a Excel del Mayor y de la Antigüedad] - 2026-09-02

Lo que cierra el pedido de proveedores. Josuarth: *"si yo entro a la cuenta de gastos de
combustible, yo debo poder extraer eso en Excel y ese Excel debe venir con DV, nombre, cantidad de
gastos"*. Separar el RUC del DV en la ficha solo demuestra su valor cuando salen así en el archivo
con el que él arma los anexos de la renta.

### Por qué xlsx y no CSV

La razón que decide **no** es el encoding —un CSV con BOM abre bien— sino esta:

🔴 **Un CSV destruye el DV.** El `05` es texto, pero Excel lo lee como número y lo abre como `5`.
Justo la columna por la que se pidió todo esto quedaría mal en la mitad de los casos, y en
silencio: el archivo se ve bien hasta que alguien compara contra el formulario de la DGI.

Los demás motivos, en orden:

- **El separador.** Excel en español usa `;` según la configuración regional de la máquina, no del
  archivo. Un CSV con comas se abre en una sola columna en la compu de Josuarth, o al revés en la
  de otro. La línea `sep=;` lo arregla en Excel y rompe en todo lo demás.
- **Un RUC como `1554821-1-741203`** entra en el terreno donde Excel adivina formatos.
- **Las tildes** no dependen de que nadie acierte el encoding.
- **No suma una dependencia:** `xlsx` ya estaba en el repo y ya lo usaba el export del VAT Summary.

Costo asumido: un xlsx no se lee con `cat`. Vale la pena.

### Qué trae el archivo

**Mayor:** fecha · tipo de transacción · número de documento · nombre · **RUC** · **DV** ·
descripción · contrapartida · importe · saldo.

**Antigüedad:** tercero · **RUC** · **DV** · documento · vence · días vencido · tramo · las cinco
columnas de tramo · total. Una fila por documento, que es la forma en que una planilla sirve para
algo; agrupada se ve mejor en pantalla y es inútil en Excel.

Las fechas van como fecha de Excel (ordenables y filtrables por rango), los importes como número
con formato de moneda, los días vencidos como entero —"183.00 días" hace frenar a quien lee— y el
RUC y el DV como **texto explícito**, que es lo que salva al `05`.

### La antigüedad salió con el mismo motor

Sin nada especial: el reporte ya estaba detallado por documento y las columnas de tercero son las
mismas. Se agregó a las dos pantallas (cobrar y pagar).

### 🔒 La exportación no es una puerta lateral

Tres candados en cada ruta, y **dos tests nuevos que los verifican leyendo el código**:

1. **El rol se verifica en la ruta**, con la misma lista que la pantalla.
2. **El `tenant_id` sale del perfil autenticado, nunca del request.**
3. **Se exporta lo que la pantalla arma**, con los mismos loaders y el mismo builder — no hay una
   consulta paralela que pueda traer de más.

`nav-guard.test.ts` ahora cruza los roles declarados en cada ruta de export contra el middleware,
**en los dos sentidos**: un rol que puede exportar algo que la pantalla le rebota es un agujero, y
uno que ve la pantalla pero no puede exportar es un botón que le va a fallar. Cubre también el
export del VAT Summary, que ya existía y no tenía esta verificación.

### Celdas vacías, de verdad vacías

Un movimiento sin tercero —un asiento de diario, la fila de saldo inicial— deja Nombre, RUC y DV
**sin celda**. No "—", no "N/A". Excel tiene que poder filtrar por "vacías", y cualquier relleno
rompe ese filtro. Verificado leyendo el archivo generado: las celdas no existen.

### ⚠️ Los clientes todavía no tienen DV

~~`clients` tiene `ruc` y `tax_id`, pero **no una columna `dv`**.~~
🔴 **ESTO ES FALSO. Corregido el 02/09/2026 — ver la entrada de más abajo.** `clients` SÍ
tiene la columna, se llama `digito_verificador`, y por eso la exportación manda el DV de clientes
vacío cuando no debería. Es un bug pendiente de corregir, no una limitación del sistema.

### Verificación: archivos reales, leídos de vuelta

Candado confirmado: staging. Se generaron tres archivos y se leyeron con la misma librería, así que
lo que sigue es lo que quedó EN EL ARCHIVO, no lo que el código quiso escribir.

**1) Mayor de `610009 Combustible` — el ejemplo textual de Josuarth** (18.129 bytes)

```
 7 | Fecha      | Tipo de transacción | Número | Nombre                    | RUC        | DV | Descripción                            | Contrapartida     | Importe | Saldo
 8 | «vacía»    | Saldo inicial       | «vacía»| «vacía»                   | «vacía»    |«vacía»| Saldo inicial                       | «vacía»           | «vacía» | 1,100.56
 9 | 22/02/2026 | Gasto / compra      | 2      | ESTACIÓN DELTA VÍA ESPAÑA | 8-712-1904 | 48 | Combustible de la flota — febrero 2026  | Cuentas por pagar | 246.40  | 1,346.96
```

**2) Mayor de `100004 Cuentas por Cobrar`** — el caso cliente, con la columna DV vacía:

```
 9 | 05/04/2026 | Factura | 5 | FERRETERÍA VALLARINO, S.A.  | 1554821-1-741203 | «vacía» | Factura FAC-HON-000001 … | Varios | 1,070.00 | 193,017.55
11 | 20/04/2026 | Pago    | 7 | FERRETERÍA VALLARINO, S.A.  | 1554821-1-741203 | «vacía» | Cobro de la factura …    | Banco  | -1,070.00| 192,097.55
```

**3) Antigüedad de Cuentas por Pagar:**

```
 8 | Tercero                           | RUC              | DV | Documento                              | Vence      | Días | Tramo     | … | Más de 91 | Total
 9 | INMOBILIARIA COSTA DEL ESTE, S.A. | 1550231-1-702455 | 05 | Alquiler de oficina — febrero 2026     | 03/03/2026 | 183  | Más de 91 |   | 1,850.00  | 1,850.00
10 | DISTRIBUIDORA OFIPLUS, S.A.       | 1620884-1-819377 | 7  | Compra consolidada de insumos…         | 29/04/2026 | 126  | Más de 91 |   | 1,497.85  | 1,497.85
11 | ESTACIÓN DELTA VÍA ESPAÑA         | 8-712-1904       | 48 | Combustible de la flota — febrero 2026 | 22/02/2026 | 192  | Más de 91 |   | 246.40    | 246.40
```

Chequeos sobre el archivo ya escrito:

| | |
|---|---|
| DV en el mayor | `"48"`, tipo `s` — **texto** |
| RUC en el mayor | `"8-712-1904"`, tipo `s` — **texto** |
| DV `"05"` en la antigüedad | **conserva el cero** |
| Saldo inicial: Nombre / RUC / DV | **celda ausente** en las tres |
| Tilde | `"ESTACIÓN DELTA VÍA ESPAÑA"` intacta |
| Importe | `246.4`, tipo `n` — **número sumable** |

Los RUC y DV de staging se cargaron con `sql/verificacion/staging_ruc_dv_proveedores.sql`, que
**no es parte de ninguna migración**: los proveedores creados automáticamente quedan sin RUC a
propósito.

### Tests

**520 en verde** (+34). 16 del motor de exportación —que leen el buffer de vuelta, no confían en la
intención del código— y 16 del armado de las hojas, más los 2 de permisos. Typecheck limpio, build
de producción compilando. Lint: 21 preexistentes, 0 nuevos.

**⚠️ Sin verificar en pantalla:** la extensión de Chrome sigue desconectada. Los archivos se
generaron y se verificaron llamando a los mismos builders que usan las rutas, pero **falta apretar
el botón con sesión de contador**.


## [Proveedores como entidad] - 2026-09-02

Lo que Josuarth especificó al detalle el 25/08 y no dependía de ninguna respuesta pendiente. De
paso arregla algo que este mismo módulo había detectado: la antigüedad de cuentas por pagar
agrupaba por texto libre, así que dos gastos del mismo proveedor escritos distinto salían como dos
proveedores.

### La ficha — `/finanzas/proveedores`

Número correlativo (`PRV-001`, por la misma secuencia atómica que clientes y facturas), razón
social, razón comercial, **RUC y DV en columnas separadas**, dirección, teléfono, correo, términos
de pago, activo/inactivo y notas. Listado con búsqueda, alta, ficha y edición. Roles: admin,
abogada y contador.

### 🔴 RUC y DV nunca se concatenan

Es el requisito literal: los anexos de la declaración de renta van *"con el RUC en una columna y el
DV en otra columna porque así está en el formulario de la DGI"*. Son dos columnas en la base, dos
campos en el formulario, dos celdas en el listado y dos celdas en la ficha.

**Hay un test que lo hace cumplir.** `ruc-dv-separados.test.ts` lee todo el código buscando la
*operación* de unirlos (`+`, template string, `.join`, `.concat`) y falla explicando por qué. Es
una regla que un tipo de TypeScript no puede sostener: `ruc + dv` compila perfecto.

### ⚠️ El RUC se valida POCO, a propósito

En Panamá conviven cédulas (`8-123-456`), prefijos (`PE-`, `E-`, `N-`), jurídicos
(`155123456-2-2015`) y folios viejos. **No se valida la estructura**: solo el largo y que los
caracteres puedan pertenecer a un RUC. Un campo que rechaza un RUC legítimo deja a alguien sin
poder cargar y sin forma de saltearlo; uno permisivo acepta un tipeo que después se corrige.

Lo que sí hace es **avisar**: si el RUC parece traer el DV pegado, si falta el DV, si el DV no
tiene dos dígitos. Salen en ámbar, debajo del campo, y **no impiden guardar** — la pantalla lo
dice con esas palabras. Hay 21 tests, y el más importante recorre diez RUC panameños reales y falla
si alguno se rechaza.

El DV sí se acota a dígitos (1 a 3), porque un dígito verificador es un número. Se aceptan tres
para no rechazar un `5` escrito sin el cero delante.

### El punto que cierra el círculo: plazo → vencimiento → tramo

Era el motivo por el que Josuarth pidió los términos de pago. `business_expenses` ganó
**`due_date`**, que antes no existía y por eso la antigüedad se contaba desde la fecha del gasto —
una lectura más pesimista que la real.

Ahora: el **plazo del proveedor** (contado, 30, 60, 90… cualquier valor de 0 a 365) propone el
**vencimiento del gasto**, que es **editable** porque manda el comprobante, y del vencimiento salen
los **tramos** de la antigüedad. El formulario de gastos recalcula el vencimiento al cambiar la
fecha o el proveedor, y deja de recalcular en cuanto alguien lo toca a mano.

Cambiar el plazo de un proveedor **no reescribe** los vencimientos ya cargados: sería reescribir
historia. Aplica a los gastos nuevos.

### La migración `033`, escrita para producción desde el primer momento

`business_expenses` **tiene datos reales en producción** que no podemos ver. La migración está
escrita para eso: **idempotente** (se corrió dos veces contra staging sin efecto adicional),
**transaccional**, **no borra nada** y trae un **ROLLBACK comentado** que la revierte entera.

- `supplier_name` y `supplier_ruc` **quedan intactas** como respaldo. Eliminarlas es un commit
  posterior, después de verificar.
- `supplier_id` es **NULLABLE**: obligatorio rompería los gastos que ya existen sin proveedor.
- **No hay UNIQUE sobre el RUC.** Si en producción dos nombres compartieran RUC, un UNIQUE haría
  fallar la migración entera. Se indexa para buscar y **se avisa en pantalla** cuando dos fichas
  comparten RUC; unirlas es decisión de una persona.

**La deduplicación es conservadora:** agrupa por `lower(btrim(supplier_name))` — mismo texto
ignorando mayúsculas y espacios. NO normaliza tildes ni sufijos societarios, porque fusionar de más
no tiene vuelta atrás: "FARMACIA ARROCHA" y "FARMACIA ARROCHA CHITRÉ" pueden ser dos proveedores
distintos.

### Inventario de staging antes de tocar nada

**3 gastos, 3 nombres distintos, 0 duplicados** por cualquier criterio (ni RUC compartido ni nombre
normalizado igual), **0 RUC cargados**. La deduplicación acá fue 1 a 1 y no hizo falta revisarla a
mano. En producción no se puede saber sin verla, y por eso la migración es conservadora.

### Verificación contra staging (nunca contra producción)

Candado confirmado antes de cada corrida: `xtyenhakplrkyifbcaow`.

| Lo que se pidió verificar | Resultado |
|---|---|
| Ningún gasto perdió su proveedor | **3 de 3** con el nombre nuevo idéntico al viejo |
| Gastos sin enlazar | **0** |
| Gastos sin vencimiento | **0** |
| El auxiliar de CxP suma lo mismo que antes | **3.594,25 → 3.594,25** |
| Idempotencia | 2ª corrida: 3 proveedores, secuencia 3, auxiliar 3.594,25 — sin cambios |
| RUC y DV como columnas separadas | `ruc text`, `dv text`, y el test de concatenación en verde |

**Cómo se movió cada documento** (con plazos de demostración cargados en staging):

| Proveedor | Plazo | Días antes | Días ahora | Se movió | ¿Lo explica el plazo? |
|---|---|---|---|---|---|
| INMOBILIARIA COSTA DEL ESTE | 30 | 213 | 183 | 30 | ✅ |
| ESTACIÓN DELTA VÍA ESPAÑA | contado | 192 | 192 | 0 | ✅ |
| DISTRIBUIDORA OFIPLUS | 45 | 171 | 126 | 45 | ✅ |

**⚠️ Ningún documento cambió de TRAMO**, y es esperable: los tres tienen entre 171 y 213 días, así
que 30 o 45 días de plazo los mueve pero no los saca de "más de 91". El salto de tramo está cubierto
por tests con fechas elegidas para provocarlo — un gasto de 40 días pasa de "31 a 60" a "1 a 30" con
plazo 30, y a "corriente" con plazo 60.

Los plazos de staging se cargaron con `sql/verificacion/staging_plazos_proveedores.sql`, que **NO es
parte de la migración**: la 033 deja a todos los proveedores creados automáticamente en **contado**,
porque no sabemos su plazo real y suponerlo movería la antigüedad sin que nadie lo decidiera.

### Tests

**486 en verde** (+28). Typecheck limpio, **build de producción completo sin errores nuevos**.
Lint: 21 preexistentes, 0 nuevos. `nav-guard.test.ts` cubre `/finanzas/proveedores` para el
contador.

**⚠️ Sin verificar en pantalla:** la extensión de Chrome sigue desconectada desde el bloque
anterior. El build compila las cuatro pantallas nuevas y la lógica está cubierta por tests, pero
falta abrirlas con sesión de contador.

### Fuera de alcance, por decisión

El módulo de compras completo, el formulario compartido con gastos de trámite, y el flujo contable
del gasto — que sigue esperando la respuesta sobre la tarjeta de crédito.


## [Antigüedad: la diferencia se desglosa en sus dos causas] - 2026-09-02

Corrección de **texto y de una cifra que faltaba partir**, no de números. Ningún saldo cambió y el
fixture de staging no se tocó.

### Qué estaba mal

La pantalla decía que la diferencia entre el auxiliar y su cuenta control **era el saldo de
apertura**. No es exacto: en Cuentas por Cobrar la diferencia es 191.697,55 y la apertura
191.947,55. Hay **250,00 de diferencia con dos orígenes distintos**, y afirmar uno solo le hace
creer al contador que todo viene de la migración.

### Qué muestra ahora

Debajo de las tres cifras de control, el desglose:

| | monto |
|---|---|
| Saldo de apertura cargado sin detalle de documentos | 191.947,55 |
| Documentos del sistema que todavía no producen asiento | −250,00 |
| **Diferencia total** | **191.697,55** |

Y nombra los documentos: **1 factura por 400,00** que está en el auxiliar y no en el mayor, y
**1 cobro por 150,00** ya descontado del auxiliar y todavía no del mayor.

La pantalla también dice que **las dos se arreglan distinto**: la apertura necesita un dato que
tiene el contador y no está en el sistema; el cableado de documento a asiento es desarrollo
pendiente. Un contador que ve una diferencia con dos causas necesita saber cuánto es cada una,
porque si no no sabe a quién reclamarle.

### Cómo se garantiza que el desglose no mienta

- **`porCablear` es aritmética pura** (`diferencia − saldoApertura`), así que las dos partes suman
  la diferencia exacta siempre, sin importar qué tan bien sepamos atribuirlas.
- **Los documentos se MIDEN en la base**, no se deducen del residuo: `antiguedad-source.ts` cruza
  facturas y cobros contra `journal_entries` por `source_type` + `source_id`.
- **`porCablearExplicado` es el control del control.** Si algún día apareciera una tercera causa,
  los documentos medidos no reconstruirían el residuo y la pantalla lo diría con esas palabras, en
  vez de atribuirle todo a las dos conocidas.

### Lo que NO se hizo, a propósito

**No se emparejó el fixture.** Que haya facturas con asiento y facturas sin asiento es el estado
real del sistema hoy —el cableado de factura a asiento no está construido— y declararlo es más
útil que esconderlo detrás de datos de prueba prolijos.

### Verificado contra staging

Candado confirmado antes de correr (`xtyenhakplrkyifbcaow`). Se ejecutaron `loadAntiguedad` y
`buildAntiguedad` **reales** contra la base:

- **CxC:** apertura 191.947,55 + por cablear −250,00 = **191.697,55**, la diferencia exacta.
  Desglose explicado ✅ (1 documento por 400,00, 1 cobro por 150,00).
- **CxP:** apertura 3.400,48 + por cablear 0,00 = **3.400,48**. Cero documentos sin asiento, que es
  coherente con que su diferencia siempre fue exactamente la apertura.

**⚠️ Sin verificar en pantalla:** la extensión de Chrome se desconectó a mitad de la corrida. El
cálculo está verificado end-to-end contra staging y por 458 tests, pero **falta ver el bloque
renderizado con sesión de contador**. Hacerlo antes de mandarle el acceso a Josuarth.

### Tests

**458 en verde** (+4). Cubren que las dos partes sumen la diferencia exacta, los signos de cada
causa (una factura sin asiento la BAJA, un cobro sin asiento la SUBE), el caso de CxP donde la
apertura sí explica todo, y que una tercera causa hipotética se declare en vez de atribuirse.

Typecheck limpio. Lint: 21 errores preexistentes, 0 nuevos.


## [Antigüedad de Saldos y Estado de Cuenta] - 2026-09-02

Los dos auxiliares que faltaban del bloque de reportes. Con esto el hub queda con **ocho reportes
construidos y uno solo planificado** (Ventas Mensuales).

### Antigüedad de Saldos — `/finanzas/reportes/aging`

Por cobrar y por pagar, en un solo reporte con selector. Tramos **Corriente · 1 a 30 · 31 a 60 ·
61 a 90 · Más de 91**, y —lo que Josuarth pidió expresamente en la reunión del 25/08— **detallada
por documento**: se hace clic en un tercero y se abren las facturas o gastos que componen su
saldo, cada uno con su fecha, sus días y su tramo.

**Las tres cifras de control se muestran, y la diferencia no se maquilla.** La guía de RM marca
como no negociable que el auxiliar cuadre con su cuenta control. Hoy no cuadra, así que la
pantalla muestra juntos **total del auxiliar · saldo de la cuenta control · diferencia**, y
explica de dónde sale. Un contador que ve la diferencia declarada entiende el estado del sistema;
uno que la descubre solo deja de confiar en el reporte.

Los tramos vacíos **se muestran igual**: la estructura del reporte no cambia según los datos que
haya ese día.

### Estado de Cuenta — `/finanzas/reportes/estado-cuenta`

Por cliente o por proveedor. Deliberadamente igual al Libro Mayor —saldo inicial, movimientos con
saldo corrido, totales al pie— porque es el mismo reporte mirado por tercero en vez de por cuenta.
El tercero viaja en la URL, así que el estado de cuenta de un cliente es un enlace que se comparte.

**El saldo inicial arranca en cero y la pantalla dice por qué:** la apertura de QuickBooks está en
la cuenta control sin repartir por tercero. Un cero sin explicación se lee como "no debía nada".

### Dos límites del modelo, dichos en la pantalla y no escondidos

- **El proveedor todavía no es una entidad.** En `business_expenses` es `supplier_name`, texto
  libre. No hay tabla de proveedores. La antigüedad de CxP agrupa por ese texto, así que dos
  gastos escritos distinto salen como dos proveedores. Se resuelve con el módulo de compras.
- **Los gastos del bufete no tienen fecha de vencimiento.** Solo `expense_date` y `payment_date`.
  Así que la antigüedad de CxP **se cuenta desde la fecha del gasto**, que es una antigüedad
  distinta y más pesimista que la real. También queda para el módulo de compras.

Las dos cosas están escritas en la pantalla de "Por pagar", no solo en el código.

### Un filtro que parece un detalle y no lo es

Las facturas pendientes se filtran **por `status`, no por `balance_due > 0`**. Una factura anulada,
en borrador o cancelada antes de emitirse tiene `balance_due` mayor que cero —esa columna es
`grand_total − amount_paid` y no mira el estado— pero no es deuda de nadie. En staging eso habría
inflado el auxiliar en **5.350,00** con tres documentos que nadie debe.

### Corregido: el "Volver a Reportes" duplicado

`StatementHeader` ya renderiza el enlace de volver, y cuatro pantallas lo repetían encima:
**Comprobación, Diario, Antigüedad y Estado de Cuenta**. Se veía dos veces seguidas. El de
Comprobación y Diario venía del bloque anterior y no se había notado. Queda uno solo, el del
header.

### Verificado contra staging (nunca contra producción)

Candado verificado antes de correr: la connection string apunta a `xtyenhakplrkyifbcaow`
(staging), no a `uqmmkklbhzxqybljiecs`.

- **CxC:** auxiliar **3.145,00** (3 facturas) · control 100004 **194.842,55** · diferencia
  **191.697,55**. Documento por documento contra la base, con los mismos tramos.
- **CxP:** auxiliar **3.594,25** (3 gastos) · control 200001 **6.994,73** · diferencia
  **3.400,48**, que es **exactamente** su saldo de apertura.
- **Conciliación estado de cuenta ↔ antigüedad:** delta 0,00 en los 4 clientes y los 3 proveedores.
- Verificado en pantalla con la sesión del **contador** (rol real, no admin), incluido el enlace
  de un documento del auxiliar al detalle de su factura.

Las consultas quedaron en `sql/verificacion/antiguedad_estado_cuenta.sql`, solo lectura, para que
se puedan repetir.

### ⚠️ La diferencia de CxC NO es solo el saldo de apertura

La apertura es **191.947,55** y la diferencia es **191.697,55**: sobran **250,00** que no explica
la apertura. La causa está identificada y medida con SQL, no deducida:

| | monto | por qué |
|---|---|---|
| Factura sin asiento en el ledger | −400,00 | `FAC-REI-000002` está pendiente pero solo 4 de las 8 facturas del fixture tienen asiento |
| Cobro sin asiento en el ledger | +150,00 | el pago de `FAC-REI-000001` se sembró sin asiento, por la decisión de Bloque 0 de preservar la línea base de 2.895,00 |
| **neto** | **−250,00** | |

Las dos son **del fixture de staging, no del reporte**: los contadores del SQL de verificación dan
exactamente 1 factura por 400,00 y 1 pago por 150,00. En una base con todos los asientos posteados,
la diferencia sería la apertura exacta.

### Tramos sin cubrir en el fixture

**Corriente** y **1 a 30** no tienen ningún documento, ni en cobrar ni en pagar. **31 a 60** y
**61 a 90** solo los cubre cobrar; **Más de 91** solo pagar (213, 192 y 171 días). Las columnas se
muestran igual, y la pantalla nombra los tramos vacíos.

### Un detalle de husos horarios, para que no sorprenda

La app cuenta los días en hora de Panamá (UTC−5) y `CURRENT_DATE` de Postgres corre en UTC. Después
de las 19:00 locales el SQL da **un día más** que la pantalla. No cambia el tramo salvo justo en el
borde. Está anotado en el encabezado del SQL de verificación.

### Tests

**454 en verde** (+18 nuevos). `antiguedad.test.ts` cubre los bordes de cada tramo uno por uno
—día 0, 1, 30, 31, 60, 61, 90, 91— y que la diferencia contra la cuenta control se exponga en vez
de esconderse. `estado-cuenta.test.ts` cubre el saldo corrido, el invariante
`inicial + débitos − créditos` y que 0,1 + 0,2 no salga 0,30000000000000004.

`nav-guard.test.ts` ahora incluye **aging** y **estado-cuenta** entre los reportes que enlazan
documentos: si un enlace de esos auxiliares apuntara a algo que el contador no puede abrir, el test
falla.

Typecheck limpio. Lint: **21 errores preexistentes**, ninguno en los archivos nuevos.

### Pendiente para consultar con Josuarth

Para que el auxiliar cuadre con su cuenta control hace falta **el detalle de los documentos
pendientes a la fecha de apertura** (qué facturas y qué cuentas por pagar componían los 191.947,55
y los 3.400,48). Eso no está en el sistema y no se puede inferir: lo tiene el contador.


## [Balance de Comprobación y Diario General] - 2026-09-02

Los dos reportes que la guía de RM lista como obligatorios y que no existían ni como marcador.
Ninguno inventa una regla de negocio: salen del mismo ledger y los mismos saldos que ya usan el
Libro Mayor y el Balance.

### Balance de Comprobación — el reporte puente

Rotulado también **"Balance de sumas y saldos"**, que es como lo conocen en QuickBooks, para que
Josuarth lo reconozca sin preguntarlo.

Una fila por cuenta con **saldo inicial · débitos · créditos · saldo final**. Los totales al pie
cuadran, y si no cuadraran el reporte lo dice **en rojo, con el monto de la diferencia** — no lo
esconde.

**Cómo se garantiza que sus saldos sean los mismos que los de los estados financieros:** no
comparándolos después, sino no teniendo dos fuentes. `buildBalanceComprobacion` recibe los MISMOS
`ReportAccount` que `buildAccountingReports`, del mismo `loadReportAccounts`. Y `saldoFinal` no se
recalcula: es `a.saldo`, el número que ya muestran los otros dos. No es que coincidan; es que es
el mismo número.

Para eso `accounting-source.ts` pasó a traer **débitos y créditos por separado** además del neto,
en la misma lectura. Un reporte que sumara las líneas por su cuenta habría podido divergir.

### Diario General

Los asientos en orden cronológico, cada uno con su cabecera —correlativo, fecha, tipo, documento
y descripción— y sus líneas con cuenta, glosa, débito y crédito, más el total del asiento.

- **El mismo vocabulario que el mayor:** "Factura", "Pago", "Asiento de diario", "Gasto / compra".
  Sale de `tipoTransaccionLabel`, la función que ya usa el mayor, no de una copia.
- **Los enlaces al documento salen de `destino-documento.ts`**, el mismo resolvedor que el mayor,
  así que respetan el permiso del rol que los abre. Y `nav-guard.test.ts` ahora cubre también el
  diario: si un enlace del diario apuntara a algo que el contador no puede abrir, el test falla.
- **Filtro por rango de fechas** en la URL, igual que el mayor, para que un diario acotado sea un
  enlace que se pueda compartir.
- Una línea sin glosa propia hereda la descripción del asiento: un renglón sin texto no le dice
  nada a quien audita.

### Verificado contra staging real

**El balance de comprobación cuadra:**

| | |
|---|---|
| Σ débitos | 11.089,25 |
| Σ créditos | 11.089,25 |
| **Diferencia** | **0,00** |

**Sus saldos finales contra los estados financieros — 64 cuentas comparadas, 0 diferencias.** Las
13 con movimiento, impresas una por una:

| código | cuenta | comprobación | estado financiero |
|---|---|---|---|
| 100001 | Banco General Operativa | 62.770,91 | 62.770,91 |
| 100004 | Cuentas por Cobrar Clientes | **194.842,55** | **194.842,55** |
| 130003 | Fondo Legales de Clientes | 2.369,11 | 2.369,11 |
| 200001 | Cuentas por pagar | −6.994,73 | −6.994,73 |
| 200003 | ITBMS por Pagar | −10.340,07 | −10.340,07 |
| 400001 | Derecho Corporativo | −292.300,31 | −292.300,31 |
| 400006 | Derecho Administrativo | −2.000,00 | −2.000,00 |
| 500003 | Mensajeria Especializada | 4.023,48 | 4.023,48 |
| 500005 | Costos tramites legales | 6.500,40 | 6.500,40 |
| 610001 | Alquiler | 13.322,78 | 13.322,78 |
| 610002 | Honorarios Profesionales | 14.119,25 | 14.119,25 |
| 610008 | Utiles de Oficina | 4.183,33 | 4.183,33 |
| 610009 | Combustible | 1.346,96 | 1.346,96 |

**El diario:** 10 asientos y 27 líneas, los mismos que hay sembrados. **Cada asiento cuadra por
separado** — los diez impresos con sus débitos y créditos. Y el total del diario (11.089,25 de
cada lado) **coincide con el del balance de comprobación**, que es la comprobación cruzada entre
los dos reportes nuevos.

**En pantalla, con sesión de contador:** los dos responden 200, el hub los muestra sin chip de
"no construido" (siguen siendo 3 los marcadores, no 5), y **los enlaces del diario abren de
verdad**: se probaron los 6 destinos distintos, los 6 dieron 200.

**Con el ledger vacío** —probado con un rango sin asientos, que es el equivalente— el diario
muestra "No hay asientos en este período" y dice qué hacer, en vez de una tabla vacía. Ni NaN ni
undefined en ninguna de las dos pantallas. Y el filtro parcial funciona: febrero devuelve 2
asientos y ninguna factura de abril.

### Chequeos

`tsc` 0 errores · **`npm test`: 436 tests, 436 pass, 0 fail, 0 skipped** (eran 419) · lint sin
hallazgos nuevos (21 preexistentes).

### Decisiones

- **Sin exportación.** Ningún otro reporte contable la tiene hoy —el único export es el del VAT
  Summary, que existe porque se presenta a la DGI— así que agregarla acá habría sido inventar un
  patrón para dos pantallas.
- Iconos propios en el hub (`CheckSquare` y `CalendarDays`): `Scale` y `BookOpen` ya son del
  Balance General y del Libro Mayor, y repetirlos hace que las tarjetas se confundan.

## [Convergencia de reportes — el Balance y el Mayor dicen lo mismo] - 2026-09-02

### El problema

Con diez asientos sembrados, el Balance mostraba Cuentas por Cobrar en **191.947,55** y el Libro
Mayor cerraba en **194.842,55**. El Balance leía solo `saldo_inicial`; el mayor ya leía el ledger.

Comparar el balance contra el mayor de una cuenta de control es lo primero que hace un contador.
Dos números distintos para la misma cuenta no se leen como "falta una fase": se leen como que el
sistema no es confiable.

### El cambio

`saldo = saldo_inicial + Σ (débitos − créditos) del ledger`, en `accounting-source.ts`. El saldo
inicial **sigue en `chart_of_accounts`**: no se convirtió en asiento de apertura, que depende de
la fecha de corte y sigue pendiente del contador.

### Los tres guards que iban en el mismo commit

**1. El filtro `active` dejó de esconder saldos.** Existía por una razón buena —las 34 cuentas
viejas de QuickBooks ensuciaban el reporte— pero al sumar el ledger se volvía peligroso: una
cuenta desactivada CON movimientos habría desaparecido llevándose su saldo, y el balance quedaría
descuadrado sin decir por qué. Ahora entran las activas **más** las inactivas que tengan
movimiento, y estas últimas vienen marcadas: la pantalla avisa cuáles son y por qué están.

**2. El doble conteo de `300003` lo denuncia el builder.** El Balance suma las cuentas de
patrimonio Y agrega un renglón calculado con la utilidad. Si `300003 Utilidad del Ejercicio`
tiene saldo, el resultado se cuenta dos veces. Antes eso se miraba en la página; ahora lo reporta
`buildBalanceGeneral` en `patrimonioConSaldo`, porque desde que el Balance suma el ledger **un
asiento de cierre puede acreditar esa cuenta sin que nadie cargue nada a mano**.

**3. El saldo inicial del Mayor ajustado al rango** ya estaba, del bloque del 01/09.

**Fecha de corte: NO se parametrizó**, por decisión. Lo que sí cambió es que el aviso en pantalla
dice la verdad: que el reporte suma **todos los movimientos registrados**, que **no hay corte por
período**, y que el corte está pendiente de definir con el contador. Antes decía "cuando entre el
motor de asientos, pasará a incluir los movimientos", que ya era falso.

### 🔴 DOS DE LOS NÚMEROS PREDICHOS CAMBIARON — y la causa es una sola

| | predicho el 01/09 | real | |
|---|---|---|---|
| Total Activo | 262.867,46 | **262.717,46** | −150,00 |
| Total Patrimonio | −245.532,66 | **−245.382,66** | +150,00 |
| Total Pasivo | −17.334,80 | −17.334,80 | = |
| Cuentas por Cobrar | 194.842,55 | 194.842,55 | = |
| Banco | 62.770,91 | 62.770,91 | = |
| Descuadre | 0,00 | 0,00 | = |

**No es un error de cálculo.** La predicción se hizo el 01/09 por la mañana; el **Bloque 0** cambió
esa tarde el asiento del reembolso para que acredite `130003 Fondos Legales de Clientes` —un
ACTIVO— en vez de `500005 Costos trámites legales`. Lo pide textual el acta de RM del 25/08:
*"Reembolso al facturar: HABER 130003, nunca ingreso"*.

Los 150,00 dejaron de ser un costo recuperado y pasaron a bajar el fondo del cliente: salen del
activo y entran al resultado. Hay un test que lo demuestra — rehace el escenario viejo y obtiene
exactamente los números predichos.

### La verificación

**Reconciliación cuenta por cuenta contra staging real**, que es la prueba que vale porque el
descuadre da cero aunque el movimiento se sume a la cuenta equivocada:

| | |
|---|---|
| Cuentas en el reporte | 64 (de 98 en el plan) |
| Con movimiento, reconciliadas una por una | 13 |
| **Sin movimiento, delta impreso** | **51 cuentas, 0,00 en todas** |
| Descuadradas | **0** |

Las 13 con movimiento, con su inicial, su neto del mayor y su saldo en el Balance, están en el
detalle de la corrida. Ejemplo: `100004` = 191.947,55 + 2.895,00 = 194.842,55.

**No regresión con el ledger vacío:** 257.902,46 de activo y −244.476,91 de utilidad, los
totales del Excel de Josuar. Es lo que demuestra que desplegar esto no movería un centavo en
producción, donde nada postea todavía.

**En pantalla, con sesión de contador:** el Balance muestra CxC en 194.842,55 y el Mayor cierra
en 194.842,55. El mismo número en los dos reportes.

**Y un test que prueba que cuadrar no alcanza:** mueve 5.000 de una cuenta de activo a otra, el
descuadre sigue en 0,00 —la partida doble se mantiene— y la reconciliación por cuenta caza las
dos. Es la razón por la que ese es el test que importa.

### Chequeos

`tsc` 0 errores · **`npm test`: 419 tests, 419 pass, 0 fail, 0 skipped** (eran 409) · lint sin
hallazgos nuevos (21 preexistentes).

### No tocado, a propósito

La divergencia entre el Balance y `/pyl` —dos estados de resultado distintos alimentando dos
pantallas— sigue igual: es la pregunta que Josuarth todavía no respondió.

## [HOTFIX — las descargas pasan por el dominio de la app] - 2026-09-01 (incidente)

### El incidente

Una de las licenciadas no podía descargar una factura desde producción: el navegador le daba
`DNS_PROBE_FINISHED_NXDOMAIN` sobre `uqmmkklbhzxqybljiecs.supabase.co`. El dominio existe y el
proyecto estaba sano — lo que fallaba era la resolución DNS **en su red**.

El resto del sistema le funcionaba porque esas peticiones las hace el servidor. La descarga no,
porque le entregábamos al navegador un enlace firmado que apuntaba **directo** al almacenamiento
de Supabase: el navegador tenía que resolver un dominio que en su red no resolvía.

El mismo día falló la resolución de `supabase.co` desde Node en la máquina de desarrollo, con la
conexión a la base funcionando. **Dos máquinas distintas en Panamá con el mismo síntoma**, así
que no es la anécdota de una red.

### El arreglo

`serveStorageFile()` firma la URL, hace `fetch` **desde el servidor** y pasa el `body` —un
ReadableStream— a la respuesta. El navegador solo habla con el dominio del CRM.

**Se transmite, no se carga en memoria.** Por acá van a pasar también los adjuntos de casos;
`storage.download()` habría materializado un Blob entero por cada descarga concurrente. La URL
firmada vive 60 segundos y nunca sale del servidor.

### Seis lugares, no solo la factura

| Ruta | |
|---|---|
| `/api/documents/[id]/download` | nueva — documentos de casos, clientes, tareas, comentarios |
| `/api/expenses/[id]/receipt/download` | nueva — comprobante de gasto de trámite |
| `/api/payments/[id]/receipt/download` | nueva — comprobante de cobro |
| `/api/finanzas/business-expenses/[id]/receipt/download` | nueva — comprobante de gasto del bufete |
| `/api/finanzas/invoices/[id]/pdf` | devolvía `{url}`, ahora el archivo |
| `/api/finanzas/quotes/[id]/pdf` | ídem |

El de gastos del bufete era distinto de los otros: la URL firmada no se generaba en una ruta de
API sino en el **server component** de la pantalla, y viajaba al navegador como prop.

**Las tres rutas viejas `/url` se ELIMINARON.** Nadie las llamaba ya, y dejarlas era dejar
abierta la puerta por la que el bug vuelve.

Como el cuerpo ahora es el archivo, el dato `regenerated` que la UI usa para avisar "se
regeneró el PDF" viaja en la cabecera `X-Pdf-Regenerated`.

### Permisos: se verifican en el endpoint

Sesión, tenant y rol. Se agregó lo que **no estaba**: el contador no baja documentos del módulo
legal (caso, cliente, tarea, comentario), ni comprobantes de gastos de trámite, ni de cobros. Sí
los del bufete, que son suyos.

Verificado en staging con un documento de tipo `case`: **200 a la abogada, 403 al contador**.

### Verificado en staging

| | |
|---|---|
| PDF de factura | 200 · `application/pdf` · 57.226 bytes · empieza en `%PDF-` |
| Nombre del archivo | `FAC-HON-000004.pdf`, en las dos formas de `Content-Disposition` |
| **`supabase.co` en la respuesta** | **cero apariciones** |
| PDF de cotización | 200 · `COT-000007.pdf` · 56.590 bytes |
| Sin sesión | 401 |
| Documento inexistente | 404 |
| `Cache-Control` | `private, no-store` |

### Los cuatro endpoints nuevos, con archivos REALES del storage

Los dos PDFs de arriba se generan al vuelo; los otros cuatro traen un archivo del
almacenamiento. **No es el mismo camino**, así que se probaron aparte: subir → descargar por el
endpoint → verificar → borrar todo.

El nombre de prueba lleva **tilde y espacio** a propósito (`Cotización de prueba ñandú.pdf`),
que es lo que ejercita el `Content-Disposition` con `filename*=UTF-8''`.

| Endpoint | status | tipo | tamaño | nombre |
|---|---|---|---|---|
| `/api/documents/[id]/download` | 200 | `application/pdf` | 125 = 125 | ✅ con tilde |
| `/api/expenses/[id]/receipt/download` | 200 | `application/pdf` | 125 = 125 | ✅ con tilde |
| `/api/payments/[id]/receipt/download` | 200 | `application/pdf` | 125 = 125 | ✅ con tilde |
| `/api/finanzas/business-expenses/[id]/receipt/download` | 200 | `application/pdf` | **10.485.796 = 10.485.796** | ✅ `Escritura pública grande.pdf` |

Los cuatro empiezan en `%PDF-` y ninguno trae `supabase.co` en la respuesta.

### El streaming, demostrado sobre 30 MB

Es la razón por la que se eligió `fetch` + `res.body` en vez de `storage.download()`. Medido
leyendo el stream trozo por trozo:

| | |
|---|---|
| Bytes recibidos | 31.457.296 — idéntico al original |
| Trozos del stream | **1.388** |
| Cabeceras | 2.279 ms |
| **Primer byte del cuerpo** | **2.280 ms** |
| Último byte | 9.047 ms |

El cuerpo empezó a llegar al **25 % del tiempo total**: el servidor fue pasando lo que le
llegaba. Si el archivo se materializara en memoria, el primer byte saldría junto con el último.

Todo lo creado para estas pruebas se borró: 5 objetos del storage, el documento y el cobro de
prueba, y los `receipt_url` restaurados a su valor previo. Quedaron en `documents` los dos PDFs
que el sistema genera y cachea al pedirlos (factura y cotización) — producto del uso normal, no
de las pruebas.

`next build` limpio en la rama de hotfix, con las cinco rutas nuevas presentes. `tsc` 0 errores.
Lint sin hallazgos nuevos (21 preexistentes). Suite en `develop`: 409/409.

### ⚠️ Queda UN punto donde el navegador habla con supabase.co: el login

`src/lib/supabase/client.ts` (`createBrowserClient`) lo usan **solo** `login-form.tsx` y
`new-password-form.tsx`. Una vez iniciada la sesión, todo pasa por el servidor.

O sea: **si a la licenciada le falla el DNS en el momento de iniciar sesión, no puede entrar**, y
este hotfix no lo cubre. Mover la autenticación al servidor es un cambio de otro tamaño y no
entra en un hotfix. Queda anotado: si mañana reporta que no puede *entrar* —no descargar— es
esto.

### Cómo llega a producción

Rama `hotfix/descarga-por-dominio-app`, desde `main`, solo este cambio. **No se mergeó**: espera
la aprobación de Oliver. El mismo commit ya está en `develop` (cherry-pick `2771411`) para que no
se pierda en el próximo merge; los dos conflictos fueron con el renombrado `publicUrl → signedUrl`
de `fb6735c`, sobre la misma prop que este cambio elimina.

**No necesita las tres variables de Vercel pendientes:** todas las `EFACTURA_*` se leen dentro de
funciones, ninguna en build.

## [El enlace roto del Libro Mayor — enlaces de contenido auditados] - 2026-09-01 (cierre)

### El enlace que prometía un documento y no lo abría

En el Libro Mayor, el ícono "Abrir el documento que originó este movimiento" de una Factura
apunta a `/finanzas/facturas/{id}`, y el middleware le rebota esa ruta al contador. Josuarth
habría hecho clic esperando la factura y habría aterrizado en `/finanzas/reportes`, sin
explicación.

**Afectaba a SEIS de los diez asientos sembrados:** los cuatro de factura y los dos de pago, que
enlazan a la factura que cancelaron. De los cuatro tipos de documento del mayor, solo los gastos
funcionaban.

La auditoría del menú contra el middleware ya existía y no lo agarró: **miraba el sidebar**.
Este era el mismo error una capa más adentro, en los enlaces de CONTENIDO.

### El contador ahora abre el detalle de factura, en solo lectura

Auditar el mayor ES llegar al documento — la guía de RM lo pide en su lista de validación
("cada reporte permite llegar al documento origen").

Se abre exactamente el detalle y nada más:

| | |
|---|---|
| ✅ | `/finanzas/facturas/{id}` |
| ❌ | `/finanzas/facturas` (el listado sigue siendo del módulo de ventas) |
| ❌ | `/finanzas/facturas/nuevo` |
| ❌ | `/finanzas/facturas/{id}/editar` |

El `(?!nuevo$)` del patrón no es adorno: sin él, "nuevo" entra como si fuera un id.

**Y apareció un segundo problema al abrirla:** `editable`, `emittable` y `deletable` dependían
SOLO del status, sin gate de rol. Mientras el contador no podía entrar, no se notaba; al darle
acceso habría visto "Editar", "Emitir" y "Eliminar". Las rutas de API le responden 403 igual,
pero un botón que falla al apretarlo es la misma clase de error que este cambio vino a resolver.
Las tres pasan por `puedeAccionar`, igual que "Anular" y "Registrar pago", que ya lo tenían.

También el "Volver": `BackButton` usa el historial cuando lo hay, así que en la navegación
normal devuelve al mayor. El fallback importa cuando se abre el enlace en una pestaña nueva —
que es justo lo que hace alguien auditando— y llevaba al listado que le rebota. Ahora dice
"Volver a reportes" para quien no entra a facturas.

### La auditoría completa de enlaces, con el rol contador

| Reporte | Enlaces que salen | Estado |
|---|---|---|
| Libro Mayor | documento origen: factura, nota de crédito, pago → `/finanzas/facturas/{id}` | 🔴 **rebotaban** → arreglado |
| Libro Mayor | documento origen: gasto → `/finanzas/gastos-bufete/{id}` | ✅ |
| Balance General | cada cuenta → `/finanzas/reportes/mayor?cuenta=X` | ✅ |
| Estado de Resultado | cada cuenta → `/finanzas/reportes/mayor?cuenta=X` | ✅ |
| ITBMS (VAT) | "Volver a Reportes" + export por API | ✅ (la API ya permitía contador) |
| Gastos del bufete | listado, detalle, nuevo, editar | ✅ (tiene CRUD completo) |
| Plan de cuentas / Impuestos | sin enlaces salientes | ✅ |

Y el test encontró **cuatro más** que la auditoría del menú no veía, todos del asistente:
`/legal/clientes/{id}` → `/legal/clientes`, y tres del dashboard → `/legal/clientes/nuevo` y
`/legal/seguimiento`. **Los cuatro resultaron ser falsos positivos**: el primero ya vive dentro
de `{canManageClient ? <Link> : <texto>}` y los otros tres están en un JSX al que el asistente
no llega, porque el dashboard hace `if (rol === "asistente") return <AsistenteHome />`.

### El test, extendido — y con una válvula declarada

`nav-guard.test.ts` pasó de 8 a 11 tests. Los tres nuevos:

1. **Enlaces a documentos:** las rutas salieron de una constante local de `libro-mayor-source.ts`
   a `destino-documento.ts`, exportadas. Por eso nadie las podía verificar. Ahora el test cruza
   cada `source_type` contra `puedeAccederA()` para cada rol que ve el reporte.
2. **Enlaces literales en el JSX:** escanea los `.tsx` de `src/app`, deriva la ruta de cada
   pantalla del App Router y verifica que todo `href` literal lo pueda abrir quien ve esa
   pantalla.
3. El caso concreto del contador: detalle sí, listado / nuevo / editar no.

El segundo lee TEXTO y no entiende JSX, así que marcó los cuatro falsos positivos. **Un test que
grita cuando no hay nada roto se termina desactivando**, así que tiene una salida — pero
declarada EN EL LUGAR, no en una lista central que se pudre lejos del código:

```tsx
{/* nav-guard-ok: el asistente no llega acá, ve <AsistenteHome /> */}
<Link href="/legal/clientes/nuevo">
```

Obliga a escribir el motivo, se encuentra con un grep, y un enlace nuevo sin gate lo sigue
cazando.

### Y el middleware dejó de tener su propia copia de las reglas

Había DOS implementaciones de la misma decisión: los tres `if` encadenados del middleware y
`puedeAccederA()`, que es la que consume el test. Podían separarse, y se separaron: al abrirle
el detalle de factura al contador hubo que tocar las dos. Ahora el middleware llama a
`puedeAccederA()` y se queda solo con los DESTINOS de rebote, que sí son de esa capa.

### Chequeos

`tsc --noEmit` 0 errores · **`npm test`: 409 tests, 409 pass, 0 fail, 0 skipped** · lint sin
hallazgos nuevos (21 preexistentes).

### ⚠️ Lo que NO se pudo verificar, y una corrección

**La verificación en pantalla quedó pendiente.** Se cayó la conexión a internet de la máquina en
medio de la corrida: `EAI_AGAIN` / `ENOTFOUND` resolviendo `supabase.co`, y tampoco resolvió
forzando DNS público (1.1.1.1 / 8.8.8.8). La conexión `pg` a la base sigue funcionando porque ya
tenía la IP resuelta. El gating está cubierto por los 11 tests, que son determinísticos, pero
**no se llegó a abrir el detalle de factura con sesión de contador para ver los botones**.

**Corrección al changelog de esta misma mañana:** ahí se anotó que "Supabase staging devolvió 530
de forma intermitente" y se recomendó sondearlo antes del correo. Con la evidencia de ahora —
fallo de DNS local, la base respondiendo bien por otra ruta— **lo más probable es que aquellos
530 fueran la misma red local, no Supabase**. No hay motivo para postergar el correo por el
estado de staging; sí conviene reconfirmar el acceso desde otra red antes de mandarlo.

## [NIIF 18 — Estado de Resultado al modelo de Josuarth] - 2026-09-01 (tarde)

### Lo que ya estaba hecho, y no se rehízo

Antes de migrar nada se verificó el estado real, y dos de los tres puntos de schema ya estaban:

- **El sexto tipo `cost` YA EXISTE** en el CHECK de `account_type`, y las seis cuentas
  `500001`–`500006` ya están clasificadas como `cost` + `costos_operativos`. Lo hizo
  `sql/pending/025_niif18_tipo_costo_y_subcategorias.sql`. **Cero cuentas por reclasificar**, y
  por lo tanto cero riesgo de mover la utilidad bruta.
- **Las nueve subcategorías de Josuarth** ya están, con sus nombres textuales, en un CHECK que
  además valida la combinación tipo×subcategoría.
- **El renombrado de Rose ya estaba**: `ACCOUNT_TYPE_LABEL_ES.expense` dice "Gasto", no "Gasto
  operativo".

### 🔴 Los 12 tests que el skip escondía: eran DOS migraciones, no un renombrado

La sospecha anotada era que se trataba del renombrado "gasto operativo"→"gasto" a medias. No
era eso. Eran tests que quedaron atrás de dos migraciones y **nunca corrieron para avisarlo**:

| Migración | Qué cambió | Qué esperaba el test |
|---|---|---|
| 025 | subcategoría OBLIGATORIA en cuentas de resultado | crear `expense` sin subcategoría |
| 025 | `gasto_operativo` → `gastos_operativos` | el valor viejo |
| 025 | el costo tiene TIPO propio (`cost`) | `Costo` → `expense` + subcategoría `"costo"` |
| 027 | `saldo_inicial_fecha` obligatoria junto al saldo | mandar el saldo sin fecha |

Uno más era del propio fixture: al estado existente del test de "cambio fantasma" le faltaba
`cuenta_control`, así que el diff comparaba `undefined` contra el `null` que normaliza el
validador y registraba justo el cambio que ese test vigila.

**El skip no era deliberado:** `skipNoMocks` se activa cuando `mock.module` no existe, y sin el
flag experimental no existe. Pero el efecto fue idéntico a esconderlos. Por eso el arreglo de
fondo es **`npm test`**, que corre siempre con el flag: hasta hoy no había comando canónico y
cada corrida decidía por su cuenta si 72 tests existían.

### La categoría NIIF 18, aislada detrás de una función

`categoriaNiif18De(cuenta)` es ahora el único lugar que sabe de dónde sale la categoría. Hoy la
deriva de `subcategoria`; cuando entre la columna `categoria_niif18` se cambia **ese cuerpo y
nada más**. Recibe la CUENTA y no la subcategoría justamente para que el día que la fuente
cambie, la firma no cambie con ella. El Estado de Resultado agrupa por lo que ella devuelve y no
sabe de dónde salió.

Es lo que permite invertir el orden: primero el reporte que Josuarth va a mirar, después la
migración que no ve.

### El Estado de Resultado, al modelo

Los cuatro subtotales obligatorios **ya los emitía el builder** y los bloques sin cuentas ya se
omitían. Lo que faltaba era lo que hacía que la pantalla no se pareciera al modelo:

**Las 30 cuentas en cero.** De las 45 cuentas de resultado del plan de Integra, 30 están en
0.00. Sin filtro, lo que abre el contador son treinta y pico de renglones vacíos con los números
reales perdidos en el medio. El toggle "solo cuentas con saldo" existía y ya estaba conectado
con el default correcto, pero el criterio estaba **escrito dos veces**: una en
`report-visibility.ts` (para el Balance, sobre secciones) y otra a mano dentro del componente
del ER (sobre la lista plana). Se unificó en `filterFilasER`, en el módulo compartido.

Y **un grupo sin ninguna cuenta con saldo ahora desaparece entero**, con su subtotal, en vez de
mostrarse con el aviso "Todas las cuentas de esta sección están en 0". Es la regla contable: un
renglón sin saldo no se presenta.

La garantía está en tests: **ocultar filas no puede mover un subtotal**. Los cuatro son
idénticos en las dos vistas.

### El reporte, renglón por renglón contra `image005.png`

| Modelo de Josuarth | Lo que muestra el sistema |
|---|---|
| Actividad de operación | ACTIVIDAD DE OPERACIÓN |
| ingresos operativos | Ingresos operativos |
| Ingresos por servicios legales · 182,160 | Derecho Corporativo · 289,800.31 · Descuentos otorgados · (663.25) |
| — | *(Total ingresos operativos · 289,137.06)* ← agregado, ver abajo |
| Costos Operativos | Costos operativos |
| Honorarios de abogados y prof. externos · (42,000) | Mensajeria Especializada · (3,697.98) · Costos tramites legales · (6,180.40) |
| — | *(Total costos operativos · (9,878.38))* |
| **Utilidad Bruta operativa · 140,160** | **► Utilidad Bruta operativa · 279,258.68** |
| Gastos operativos | Gastos operativos |
| Salarios · (8,640) · Mantenimiento de oficina · (533) | 11 cuentas, de Alquiler (11,472.78) a Gastos Bancarios (1,110.24) |
| — | *(Total gastos operativos · (34,781.77))* |
| **Utilidad Operativa · 130,987** | **► Utilidad Operativa · 244,476.91** |
| Actividad de Financiamiento | *(no se muestra: Integra no tiene cuentas de financiamiento)* |
| **Utilidad antes de impuesto · 128,664** | **► Utilidad antes de impuesto sobre la renta · 244,476.91** |
| Impuesto sobre la renta · (4,459) | Impuesto sobre la renta · 0.00 *(sociedad civil)* |
| **Utilidad Neta · 124,205** | **► Utilidad Neta · 244,476.91** |
| — | DISTRIBUCIÓN A SOCIAS · (244,476.91) |
| — | **► Resultado del ejercicio · 0.00** |

**Dos diferencias deliberadas, las dos anotadas para consultarle:**

1. **Los subtotales por rubro** ("Total ingresos operativos", etc.) **no están en su modelo** —
   ahí cada rubro tiene una o dos cuentas y el salto al subtotal se sigue a ojo. Integra tiene
   11 cuentas de gastos visibles: sin el total del rubro, pasar de 279,258.68 a 244,476.91 es
   imposible de verificar. Se mantuvieron. **Si él los quiere fuera, es una línea.**
2. **El bloque de Financiamiento no aparece** porque Integra no tiene ninguna cuenta ahí. Es lo
   correcto —un bloque vacío se lee como error— y se decidió NO reclasificar ninguna cuenta para
   llenarlo: mover una cuenta a financiamiento cambiaría la utilidad operativa, que es el número
   que él va a comparar.

### Depreciación acumulada

Nueva subcategoría `depreciacion_acumulada`, solo para cuentas de activo, ubicada
inmediatamente debajo de "Propiedad, planta y equipo" porque es su contracuenta y el activo fijo
neto es la resta de las dos. **No necesitó migración**: las subcategorías de balance no tienen
CHECK de lista en la base, se validan en la app.

Tocó **una línea del Balance General** —agregar el grupo a `ACTIVO_GROUPS`— y no mueve ningún
número: hoy no hay ninguna cuenta con esa subcategoría. Sin esa línea, el campo nuevo nacería
roto: se podría asignar en el Plan de Cuentas y la cuenta caería en "sin clasificar". No toca la
divergencia Balance vs `/pyl`, que sigue esperando respuesta de Josuarth.

El **gasto de depreciación** se dejó afuera a propósito: no es una categoría NIIF 18 sino un
rubro dentro de gastos operativos, y eso depende del nivel de agrupación por rubro que Rose
mencionó y que todavía no está definido. Queda como consulta, no se inventó.

### Verificado

Números de control, con el ledger vacío:

| | real | esperado | |
|---|---|---|---|
| Total de Ingresos | −289,137.06 | −289,137.06 | ✅ |
| Utilidad Operativa | −244,476.91 | −244,476.91 | ✅ |
| Utilidad antes de impuesto | −244,476.91 | −244,476.91 | ✅ |
| Utilidad Neta | −244,476.91 | −244,476.91 | ✅ |
| Resultado del ejercicio | 0.00 | 0.00 | ✅ |

La estructura nueva **no movió ningún número**. Verificado además en la pantalla real, con
sesión de contador: 15 cuentas visibles de 45, los cuatro subtotales presentes, bloques de
inversión y financiamiento ausentes.

Reset + doble siembra: ledger 10/27 con cadena íntegra, 64 cuentas activas (6 de tipo `cost`),
mayor de CxC en 194,842.55 sin cambios.

### Chequeos

`tsc --noEmit` 0 errores · **`npm test`: 406 tests, 406 pass, 0 fail, 0 skipped** · sin el flag:
406 tests, 334 pass, 72 skipped, 0 fail · lint sin hallazgos nuevos (21 preexistentes).

### Anotado, no tocado

- **La migración a `categoria_niif18` NO se hizo.** El aislamiento que la habilita sí
  (`categoriaNiif18De`), así que mañana toca esa función y no el builder. Se dejó afuera por el
  criterio acordado: es invisible para Josuarth y a medias sería peor que mañana.
- 🔴 **Supabase staging devolvió 530 de forma intermitente** durante la verificación: 8 de 10
  sondeos a `/auth/v1/health` respondieron OK, dos dieron 530. La base por conexión directa
  responde perfecto. **Si a Josuarth le toca un 530 no puede iniciar sesión.** Conviene sondearlo
  otra vez antes de mandar el correo.
- El bloque "Actividad de Financiamiento" del modelo no tiene equivalente en los datos de
  Integra. No es un bug del reporte: es que no hay cuentas de esa actividad.

## [Bloque 0 — lo que pidieron cara a cara + staging listo para RM] - 2026-09-01

Cambio de estrategia del cliente. Rose lo escribió en el correo que acompaña su guía: *"lo que
esperamos es que avances por módulo, lo probemos, corrijas o apruebes y sigas al siguiente
paso."* Así que esto no es un sprint más: es una entrega corta que termina con Josuarth (el
contador de RM) entrando a staging a revisar.

### 🔴 Antes de abrir la puerta: un correo real podía salir desde staging

`EMAIL_FROM` es `notificaciones@integra-panama.com` — dominio REAL y verificado en Resend. Un
correo mandado desde staging llega **a nombre del bufete**, indistinguible de uno auténtico. Y
el diálogo "Enviar cotización" deja escribir **cualquier** dirección: alcanzaba con que alguien
probando escribiera su propio correo, o el de una licenciada.

La única defensa era que `RESEND_API_KEY` estuviera ausente — y en Vercel está en *All
Environments*, así que los deploys de Preview SÍ la tienen. `.env.local` la tiene comentada,
pero eso solo protege a `localhost`, no al link que se le pasa a alguien.

**Se cerró en el código, no en un panel:** `getResend()` corta si el entorno no es producción, y
cubre los cuatro puntos de envío de una vez porque todos pasan por ahí. Falla **fuerte** en vez
de simular el envío — un "modo sandbox" que dice "enviado" sin enviar es el bug del banner verde
mentiroso que ya se pagó en 2E.3. El mensaje aclara que el documento quedó registrado y el
enlace público sirve igual. Válvula documentada: `ALLOW_REAL_EMAILS=1` (SOP-018).

**eFactura, mismo criterio:** `loadEmisorConfig()` rechaza `EFACTURA_I_AMB=1` fuera de
producción. `iAmb=1` emite un documento fiscal REAL ante la DGI y no se deshace con un DELETE.
El sandbox (`iAmb=2`) sigue abierto, que es para lo que existe.

Revisadas las demás salidas: el cron `daily-summary` solo corre en Production y pasa por el
mismo candado; los emails del fixture son todos `.test` (RFC 2606, no resuelven); el resto de
los `fetch` son rutas internas.

### 🔴 El hallazgo que no buscábamos: el menú y el middleware no coincidían

Empezó como un caso puntual —el sidebar le ofrecía "Plan de Cuentas" al contador y el middleware
lo rebotaba— y resultó ser una clase de error: **dos listas de permisos, en dos archivos, sin
nada que las obligara a coincidir.** La auditoría con los cuatro roles encontró cuatro
desajustes:

| Rol | Ruta | Qué pasaba |
|---|---|---|
| contador | `/finanzas/configuracion/cuentas` | El menú lo ofrecía, el middleware lo rebotaba |
| asistente | `/legal/seguimiento` | Fuera del menú y **sin ningún gate**: entraba escribiendo la URL |
| asistente | `/legal/prospectos` | ídem |
| asistente | **`/legal/importar`** | ídem — y es la **importación masiva**, que CLAUDE.md reserva a admin y abogada |
| abogada | `/finanzas/cotizaciones/configuracion` | Gateada dentro de la página, no en el middleware: desde afuera no se distingue de "sin gate" |

Los tres del asistente **no** eran una decisión que hubiera que tomar: CLAUDE.md ya dice que ve
solo Dashboard, Casos y Mis Pendientes. El código no cumplía su propia política escrita, y
esconder el ítem del menú nunca cerró nada.

**Qué se hizo:**
- Las reglas de ruta salieron del middleware a **`src/lib/auth/route-access.ts`**, fuente única.
- El contador entra a `/finanzas/configuracion/*` (Plan de Cuentas e Impuestos), **con permiso de
  edición**. No fue una ampliación caprichosa: `ROLES_CLASIFICACION` en la API ya era
  `["admin","contador"]`, siguiendo la guía de RM ("quien modifica la clasificación contable debe
  ser el contador"). El permiso existía y era correcto; estaba **inalcanzable**.
- Se cerraron las tres rutas del asistente.
- Plantilla T&C subió al middleware (`ADMIN_ONLY_ROUTES`); el redirect de la página se queda como
  defensa en profundidad.
- Un rol desconocido en el JWT ahora se trata como sesión inválida, en vez de caer a un `?? "/"`.

**Y una máquina lo vigila:** `nav-guard.test.ts` cruza el sidebar contra las reglas y falla en
los dos sentidos — un ítem que rebota, o una pantalla accesible que el menú no muestra. El
segundo es el peligroso: no se ve nunca. Mismo criterio que el guard de `amount_paid`.

### Bloque 0 — lo que pidieron en la reunión del 25/08

1. **"Pagos" → "Cobros"** en gastos del caso (Rose: desde Integra, pago es dinero que sale). 14
   cadenas visibles en cuatro archivos. La tabla sigue siendo `client_payments`.
2. **ITBMS configurable.** Pantalla nueva `/finanzas/configuracion/impuestos` (ver: los tres
   roles de finanzas; editar: admin y contador). El seed dejó de tener su copia del 7%: ahora
   **reconcilia** `tax_codes` contra el fixture, así el catálogo y el cálculo de las líneas no
   pueden divergir. La pantalla avisa que cambiar la tasa **no reescribe documentos ya emitidos**
   — cada línea guarda la suya, y así debe ser.
3. **Tipo de documento a lista desplegable**, no control segmentado. Vienen nota de crédito, de
   débito, factura local y de exportación, y cuatro opciones no entran en botones.
4. **Reembolso al facturar → HABER `130003 Fondos Legales de Clientes`**, no `500005`. No era
   consulta pendiente: el acta lo responde textual. Se corrigió el fixture y se sacó el comentario
   que lo daba por decisión nuestra.

### El Libro Mayor, al formato de Josuarth

Su captura (`Temas Contables/image001.png`, correo del 26/08) **resolvió dos de las tres
consultas** que el módulo tenía aisladas esperando respuesta:

- **Consulta 5 → una sola columna "Importe" con signo**, negativo para créditos. Ya estaba
  implementado así; lo que cambió es que dejó de ser una apuesta.
- **Consulta 4 → el pie es el NETO de movimientos, no el saldo final.** Se verifica con su propio
  ejemplo: Banco Pichincha abre en 14,381.27, cierra en 21,121.28 y el pie dice 6,740.01. Ahora la
  tabla muestra solo el neto, en recuadro; el saldo final se lee en la última fila de Saldo, como
  él lo lee. Hay un test con ese ejemplo exacto.
- La **consulta 3** (contrapartida ambigua) sigue abierta.

Además: se agregó la columna **"Cuenta de distribución"**, que faltaba, y los encabezados quedaron
con el nombre y el orden exactos de su modelo.

**Y el saldo inicial ahora se ajusta al rango de fechas.** Antes mostraba siempre el de apertura:
filtrando desde junio, la cuenta arrancaba en su saldo de enero y el saldo corrido quedaba
desplazado de punta a punta. Es el error más visible que puede tener un mayor y el primero que un
contador nota. Cuando el filtro lo ajusta, la fila se rotula "Saldo al DD/MM/AAAA" en vez de
"Saldo inicial" — decirle lo mismo a dos cosas distintas es lo que haría dudar del reporte entero.

### El hub de Reportes distingue lo construido de lo que no

Las nueve tarjetas se veían iguales y tres no tienen nada detrás. Ahora los marcadores de lugar
llevan borde punteado, chip ámbar "No construido" y una línea que lo dice **antes** del clic. Se
sacó la jerga interna del placeholder ("Sprint 2F" no significa nada para el contador) y
"Aging por Cliente" pasó a **"Antigüedad de Saldos"**, que es como lo nombra él.

### Verificado con sesión real de contador

No con el navegador —la extensión de Chrome no conectaba y Playwright MCP no está expuesto en
esta sesión— sino armando la cookie de sesión de Supabase y recorriendo las rutas por HTTP. Cubre
lo que importaba: el gating real y que ninguna pantalla reviente.

**13 rutas dan 200** (las que debe ver, incluidas las tres nuevas) y **6 rebotan limpio** a
`/finanzas/reportes`. Cero 500. Banner de entorno presente en las seis pantallas revisadas. El
mayor muestra las nueve columnas del modelo, el saldo inicial 191,947.55, el final 194,842.55 y el
pie en 2,895.00.

### Reset + doble siembra: estado de referencia

| | |
|---|---|
| Clientes / casos / facturas | 15 / 30 / 8 |
| Pagos y aplicaciones | 3 / 3 |
| Ledger | 10 asientos, 27 líneas, cadena íntegra, correlativo 10 |
| **Mayor de CxC (100004)** | inicial 191,947.55 · neto 2,895.00 · **final 194,842.55** ✅ sin cambios |
| Asiento 6 (FAC-REI-000001) | DEBE 100004 150.00 · **HABER 130003 150.00** ✅ |
| `130003` tras el cambio | 2,519.11 − 150.00 = 2,369.11 |
| Desfases de `amount_paid` | 0 |

El baseline de CxC no se movió, que era la condición: el cambio del reembolso toca `130003` y
`500005`, no la cuenta por cobrar.

### Chequeos

`tsc --noEmit` 0 errores · suite **399 tests, 327 pass, 0 fail, 72 skipped** (eran 379; los 20
nuevos son de este bloque) · lint sin hallazgos nuevos sobre los 21 preexistentes.

### Anotado, no tocado

- **No hay URL de staging documentada.** `crm-integra-legal.vercel.app` es PRODUCCIÓN. Los deploys
  de Preview de Vercel tienen URL autogenerada por rama y, por defecto, **piden login de Vercel**
  (Deployment Protection) — Josuarth no tiene cuenta. Hay que resolverlo antes de mandar el correo;
  no se puede sacar desde el repo.
- **`/finanzas/cotizaciones/configuracion` rebota en dos saltos** para el contador (→ cotizaciones
  → reportes). Termina bien; se podría mandar directo a su home. No es de este bloque.
- El comentario de `contarMovimientos()` decía que `journal_entry_lines` estaba siempre vacía. Dejó
  de ser cierto en staging con la Fase 2. Corregido.

## [`amount_paid` derivado y garantizado] - 2026-09-01

### El problema: un número derivado que además se podía escribir a mano

`invoices.amount_paid` lo mantiene el trigger T7a como `SUM(payment_applications)` desde el día
uno. O sea: es un número **derivado**. Pero T4 (`finanzas_invoice_immutability`) autorizaba
EXPLÍCITAMENTE escribirlo a mano en una factura emitida, y ningún grant lo restringía. La
derivación estaba acostumbrada, no garantizada.

Se cobró el 28/08: `seed-staging.ts` creaba FAC-REI-000001 con `amount_paid = 150.00` y cero
pagos. Quedó anotado ese día y se resolvió hoy.

**Lo que hacía peor al bug:** `balance_due` es `GENERATED ALWAYS AS (grand_total - amount_paid)`,
así que el saldo falso en 0.00 **escondía el botón "Registrar pago"** — un dato falso que encima
desactivaba la función que lo habría corregido.

### Lo que se decidió, y lo que se descartó

- ❌ **Columna generada:** imposible. Postgres exige que la expresión de un `GENERATED` sea
  inmutable y referencie solo columnas de la misma fila; no admite un `SUM` sobre otra tabla.
  Y `balance_due` ya depende de `amount_paid`, así que sacarla de la tabla se la lleva puesta.
- ❌ **Vista / cálculo en la capa de consulta:** obligaba a reescribir los dos SELECT de
  `queries/invoices.ts`, el cap de `createPayment`, el listado y el detalle — para resolver la
  mitad del problema, porque `status` seguiría siendo columna real igual.
- ❌ **Permisos por columna:** revocar `UPDATE(amount_paid)` obliga a enumerar todas las demás
  columnas en el `GRANT`. Cada columna nueva de `invoices` nacería sin permiso y rompería algo
  lejos del sitio del cambio. Trampa de mantenimiento.
- ✅ **Guard por trigger (A2):** T7a marca su paso con un flag local a la transacción; el guard
  rechaza todo lo demás. Veinte líneas, sin tocar grants.

**`status` se dejó como estaba, a propósito.** No es derivado: T7a solo opina sobre tres de sus
seis estados. `borrador`, `cancelada_pre_emision` y `anulada` son estados de máquina que no
salen de los pagos. Perseguir la simetría con `amount_paid` habría roto `emitInvoice()` y
`cancelInvoice()`.

### Migración `032_amount_paid_derivado.sql`

- **T7a** ahora hace `set_config('finanzas.recalc','on',true)` antes de escribir y lo apaga
  apenas termina. Lo segundo importa: sin eso el flag quedaría encendido el resto de la
  transacción y cualquier escritura posterior pasaría por la puerta que T7a dejó abierta detrás.
- **T4b `finanzas_guard_amount_paid`** — rechaza toda escritura de `amount_paid` que no venga de
  T7a, en UPDATE **y en INSERT** (por el INSERT entraba el seed). El mensaje dice qué hacer
  —crear el pago—, no solo que está prohibido.
- **Válvula de escape** con un flag DISTINTO (`finanzas.amount_paid_override`), para que en el
  log de Postgres una corrección humana se distinga de la operación normal. Documentada en
  SOP-017 con la lista de cuándo NO usarla. Un candado sin llave documentada se abre con un
  `DROP TRIGGER` a las once de la noche.
- **El comentario de T4 se corrigió.** Decía "solo se permiten cambios a status, amount_paid o
  updated_at", cierto para cualquiera hasta ayer y desde hoy cierto solo para T7a.

### Los pagos se mudaron de script

`seed:staging` sembraba facturas ya "cobradas"; `seed:asientos` creaba después los pagos y los
hacía calzar con ese número. La dependencia estaba **al revés**: el número escrito a mano
mandaba y el pago real se acomodaba.

- `SEED_PAYMENTS` (3 pagos) vive ahora en `staging-fixtures.ts`. `seed:staging` los siembra y
  T7a deriva `amount_paid` y el status.
- `seed:asientos` los **consume**, buscándolos por `reference` igual que ya buscaba las facturas
  por `invoice_number`. Si nombra un pago que no existe, aborta pidiendo correr `seed:staging`.
  Fecha y monto del asiento salen del pago, no del fixture.
- `SeedInvoice.amount_paid` **dejó de existir**. `SeedInvoice.status` pasó a ser el estado
  ESPERADO: `ESTADO_BASE` empuja solo hasta `emitida` y T7a completa el resto.
- El comentario de `seed-asientos.ts` que documentaba el acoplamiento invertido se dio vuelta y
  ahora dice explícitamente dónde se agrega un cobro nuevo (`SEED_PAYMENTS`, no `COBROS`).

**El pago de FAC-REI-000001 (B/. 150) se sembró SIN asiento, a propósito.** La regla es "todo
asiento tiene documento", no "todo documento tiene asiento" — lo segundo no aplica todavía
porque factura→asiento no está cableado y solo 4 de las 8 facturas tienen asiento. Además
sostiene el baseline de 2,895.00 entre el mayor de CxC y el Balance, que es el número con el que
se va a validar la convergencia de reportes. El porqué quedó escrito al lado del pago.

### Chequeo permanente, en dos lugares

- Al cierre de **los dos seeds**: `verificarAmountPaidDerivado()` aborta si alguna factura no
  cuadra. `seed:staging` además verifica que las 8 facturas hayan alcanzado el estado que el
  fixture declara — el hueco que deja el otro chequeo, porque borrar una aplicación baja
  `amount_paid` y el status juntos y el resultado quedaría "coherente".
- En **la suite**: 10 tests del núcleo puro, incluido el caso literal del 28/08.
- **NO se metió en `verify_accounting_chain()`**: esa función verifica el ledger, y esto es
  facturación. Mezclarlas haría que un problema de facturación se reporte como cadena rota.

### Verificado de verdad, no solo escrito

Contra staging, dentro de una transacción con ROLLBACK:

| Prueba | Resultado |
|---|---|
| `UPDATE invoices SET amount_paid = 999` | ✅ rechazado (23514) con el mensaje accionable |
| `INSERT` de factura con `amount_paid = 150` | ✅ rechazado |
| Aplicar un pago parcial (500 de 2140) | ✅ T7a → `amount_paid` 500, status `parcialmente_pagada` |
| Completar el saldo | ✅ T7a → 2140, `pagada`, `balance_due` 0.00 |
| Borrar la aplicación | ✅ T7a revierte a 500 / `parcialmente_pagada` |
| Válvula con la llave puesta | ✅ pasa, y deja el WARNING en el log |
| …y con la llave apagada | ✅ vuelve a rechazar |

Y el chequeo del seed se probó plantando un desfase real (con la válvula, `amount_paid` a 100
contra 150 aplicados): `seed:staging` **abortó con exit 1** nombrando la factura. Se restauró
sin usar la válvula —tocando la aplicación, que es el camino que el guard obliga a tomar— y T7a
reparó la columna solo.

### Reset + siembra completa: el estado final se produce solo

Ninguna de las 8 facturas tiene un número escrito a mano.

| | |
|---|---|
| Desfases de `amount_paid` | **0 filas** |
| Estados alcanzados | 8/8 coinciden con el fixture |
| Ledger | 10 asientos, 27 líneas, correlativo 10, cadena íntegra |
| Pagos / aplicaciones | 3 / 3 |
| **Mayor de Cuentas por Cobrar** | **194,842.55** (191,947.55 + 4,965.00 − 2,070.00) ✅ sin cambios |
| Segunda corrida de los dos seeds | 0 nuevos, todo "ya existía" |

FAC-REI-000001 pasó de "PAGADO $150.00 / Aún no hay pagos registrados" a tener su pago real
detrás.

### Chequeos

`tsc --noEmit` 0 errores · suite **379 tests, 307 pass, 0 fail, 72 skipped** (eran 369 el 28/08;
los 10 nuevos son los de este bloque) · lint sin hallazgos nuevos.

### Anotado, no tocado

- **Lint: 21 errores preexistentes, ninguno en archivos de este bloque.** El changelog del
  28/08 anotó "2 errores preexistentes"; ese número salía de mirar el final de la salida, no la
  salida entera — y acá se repitió el mismo error antes de contarlos bien. Son 21: casi todos
  imports y variables sin usar en pantallas de `/legal` y componentes, más tres `prefer-const`.
  Los dos que sí estaban anotados (`queries/business-expenses.ts:111`,
  `utils/import-parser.ts:259`) son los dos últimos de la lista, que es exactamente por qué se
  vieron solo ellos. Listado completo con archivo:
  `npx next lint 2>&1 | awk '/^\.\//{f=$0} /Error:/{print f" :: "$0}'`.
  No se tocó ninguno: son ajenos a este bloque.
- **12 tests fallan con `--experimental-test-module-mocks`**, y son los que la corrida normal
  reporta como *skipped*. Todos en `chart-of-accounts` (POST/PATCH y bulk import); ninguno toca
  este bloque. Uno es un desalineamiento visible de nomenclatura: el código dice
  `gastos_operativos` y el test espera `gasto_operativo`. Con la suite como se corre en el
  proyecto (sin esa flag) el resultado es 0 fail, así que estaban ocultos detrás del skip.
- **Producción sin verificar todavía.** La consulta de diagnóstico contra la base real no se
  pudo correr desde acá (sin acceso a credenciales de producción, por política del proyecto).
  Queda pendiente de Oliver antes de decidir el merge: el guard impide desfases nuevos pero no
  corrige viejos.


## [Libro Mayor + siembra con documentos reales] - 2026-08-28

### Contexto: diagnóstico tras el reinicio del 27/08

La laptop se reinició mientras se construía el bloque del Libro Mayor. El diagnóstico dio
**el motor sano**: 8 asientos, 23 líneas, cero cabeceras sin líneas, cadena de hash íntegra,
cero huecos en el correlativo, los 8 cuadrados. El posteo atómico del RPC aguantó su primera
corrida real fuera de un test con ROLLBACK. Migraciones 023→031 completas en staging, ninguna
a medias; la 022 sigue sin aplicar, como corresponde.

### 🔴 EL HALLAZGO: el script se editó DESPUÉS de correr

Los asientos se postearon 16:54:07; `seed-asientos.ts` quedó con mtime 17:06:27. En esos doce
minutos se le agregó la trazabilidad nivel 2 — el `source_id` pasó de un UUIDv5 sintético al
id de la factura real. **La clave de idempotencia cambió bajo los pies.**

Consecuencias, las tres verificadas contra la base:

1. Los 3 asientos de factura apuntaban a la nada (`LEFT JOIN invoices` → NULL en los tres).
   Confirmado recalculando los UUIDv5: los 8 `source_id` eran `id('asiento:<clave>')`.
2. Las descripciones citaban `FE-0001`, numeración que no existe: staging factura `FAC-HON-*`.
3. **Re-correr el seed habría duplicado los 3 asientos de factura** — doble ingreso, doble
   ITBMS, doble CxC, imborrable (los triggers de 023 rechazan DELETE) y sin un error.

Se reseteó staging y se volvió a sembrar. El motivo del reset no fue "siembra incompleta"
—estaba completa— sino que apuntaba al vacío justo donde se iba a desarrollar el enlace.

### Regla nueva del seed: ningún asiento sin documento que exista

Se extendió la siembra para que **todo `source_type` tenga su documento real**:

| tipo | documento | quién lo crea |
|---|---|---|
| `factura` | `invoices` | `seed:staging` (ya existían) |
| `gasto` | `business_expenses` | `seed:asientos` — 3 filas nuevas |
| `pago` | `payments` + `payment_applications` | `seed:asientos` — 2 pagos |
| `manual` | ninguno, y `source_id` va **NULL** | — |

El asiento de diario es el único sin documento porque un asiento manual no tiene documento de
origen: su origen es él mismo. Ponerle un id sintético sería repetir el error del 27/08.

**Y los montos salen del documento, no al revés.** Las facturas ya existen, así que el asiento
se arma desde `subtotal_total` / `tax_total` / `grand_total`. Antes el fixture hardcodeaba
4815 contra una factura de 1070: un descuadre que después nadie sabe si es bug o dato de
prueba. Los gastos y cobros los crea el script, así que ahí el documento se deriva del
asiento. En los dos casos hay **una sola fuente de verdad por operación**, y la contrapartida
de los gastos se genera por la suma del desglose para que no pueda descuadrar.

Idempotencia: por `source_id` cuando hay documento; por (tipo, descripción, fecha) para el
asiento de diario. Verificado — segunda corrida: 0 nuevos, 10 ya existían, ledger intacto.

### 🛡️ Blindaje contra lo que pasó: `verificarOrigenesHuerfanos()`

Antes de escribir nada, el seed revisa si hay asientos de un tipo con documento cuyo
`source_id` no resuelve. Si aparece alguno, **aborta** y pide un reset en vez de sembrar
encima. No se puede evitar que la clave cambie; sí detectarlo antes de duplicar.

**Probado de verdad, no solo escrito:** se borró un `business_expense`, el seed abortó
nombrando el asiento huérfano, y no escribió nada (10 asientos / 27 líneas intactos). La fila
se restauró con su id determinístico.

### Libro Mayor — el bloque

- `libro-mayor.ts` — armado puro. Fila de saldo inicial siempre, saldo corrido, pie con neto
  del período **y** saldo final rotulados. Las tres decisiones pendientes de Josuar
  (contrapartida ambigua, qué va en el pie, signo del importe) aisladas a una función cada una.
- `libro-mayor-source.ts` — la lectura. Dos consultas y no un join: filtrar por cuenta se
  llevaría puestas las líneas hermanas que hacen falta para resolver la contrapartida.
- `/finanzas/reportes/mayor` — página con selector de cuenta y filtro de fechas.
- **Trazabilidad nivel 1:** código y nombre de cada cuenta del Balance y del Estado de
  Resultado enlazan a su mayor. Los renglones `estructural` del ER (distribución a socias) no
  llevan enlace: no vienen del plan de cuentas.
- **Trazabilidad nivel 2:** cada renglón del mayor enlaza al documento que lo originó.

`loadOrigenesExistentes()` (devolvía un Set de "existe") pasó a `loadDestinosDeOrigen()`, que
devuelve `Map<source_id, ruta>`. El motivo es concreto: **el destino de un pago no se deduce de
su `source_id`** — los pagos no tienen pantalla propia, viven en el detalle de la factura, así
que hay que preguntar a qué factura se aplicaron. Eso es una consulta y va en la capa de datos.
Un pago aplicado a varias facturas no tiene destino único y se queda sin enlace.

### Verificado en el navegador (staging, `localhost:3001`)

Mayor de `100004 Cuentas por Cobrar Clientes`: saldo inicial 191,947.55 → seis movimientos de
los dos lados → saldo final 194,842.55. Débitos 4,965.00, créditos 2,070.00, neto 2,895.00.
Coincide dígito por dígito con el mismo mayor calculado en SQL con una window function.

- Balance General → clic en la cuenta → su mayor. ✅ (14 enlaces, código y nombre)
- Mayor → clic en el renglón → factura / gasto. ✅
- **Pago → la factura que canceló.** ✅ El asiento 7 lleva a FAC-HON-000001, y ahí se ve el
  pago sembrado (20/04/2026, B/. 1,070.00, transferencia) en una sección que nunca había
  tenido datos.
- Asiento de diario → **sin enlace**, correcto. En el mayor de `610008` se ven juntos: el
  gasto con enlace y contrapartida inequívoca, y el manual sin enlace y con "Varios*".
- La factura de REEMBOLSO deja el asiento de dos líneas, así que muestra contrapartida
  inequívoca donde las de tres muestran "Varios*". Las dos ramas de `contrapartidaDe()`
  visibles sobre datos reales.

El Balance muestra la CxC en 191,947.55, exactamente la fila "Saldo inicial" del mayor — que
es lo que el aviso azul de la pantalla promete, porque los reportes todavía se arman solo con
saldos de apertura.

### Chequeos

typecheck 0 errores · 369 tests, 297 pass, 0 fail, 72 skipped (los skipped son `skipNoMocks`
preexistentes) · lint sin hallazgos nuevos.

### Anotado, no tocado

- `lint` tiene 2 errores preexistentes en archivos ajenos a este bloque:
  `queries/business-expenses.ts:111` (`prefer-const`) y `utils/import-parser.ts:259`
  (`no-unused-vars`).
- Las facturas del fixture de staging traen `amount_paid` puesto a mano sin `payment` detrás.
  En FAC-REI-000001 se ve "PAGADO $150.00" junto a "Aún no hay pagos registrados". Preexistente
  del `seed-staging`; solo quedó más visible al lado de las dos que ahora sí tienen pago real.
- El dev server de Next se colgó una vez a mitad de la verificación (dejó de responder incluso
  `/api/health`). Se mató y se levantó de nuevo; no era del código, la ruta responde en 19 ms.
- El puerto 3000 lo ocupa otro proyecto (`node scripts/servir.mjs`), así que el dev server
  quedó en **3001**.

### El tratamiento del reembolso es una elección del fixture

El crédito de una factura de REEMBOLSO va contra `500005 Costos tramites legales`, para que
staging tenga el caso "factura sin ITBMS". **No es una regla contable confirmada**: cuando se
cablee factura→asiento de verdad, el criterio lo define el contador.


## [Fix — hidratacion en el detalle de caso + limpieza del correo] - 2026-08-27

### El bug de hidratacion, arreglado

`Badge` renderiza un `<div>` y estaba metido dentro de un `<p>` en cuatro puntos del detalle
de caso (fechas de inicio, tope y ultimo seguimiento). HTML invalido: React lo detecta y
reemplaza el arbol entero ("The server HTML was replaced with client content").

Los cuatro `<p className="font-medium">` que contienen un Badge pasaron a `<div>`, con las
mismas clases. El resto de los `<p>` del archivo se dejo intacto: llevan solo texto y ahi
`<p>` es correcto.

**Se reviso TODO el repo** buscando el patron copiado — no solo Badge, sino los 9 componentes
de `ui/` que renderizan un `<div>` (Badge, Card, CardContent, CardHeader, CardTitle,
CardDescription, CardFooter, SheetHeader, SheetFooter), en bloques multilinea y de una sola
linea, mas `<div>` literal. **Las cuatro ocurrencias estaban todas en el mismo archivo**: no se
habia copiado a otras pantallas.

Verificado con la consola limpia: **cero errores**, y el badge rojo "1 error" del overlay de
Next desaparecio.

### ⚠️ CORRECCION: la hipotesis sobre los clics era MIA Y ERA ERRONEA

Se habia reportado que el error de hidratacion probablemente se comia los clics. **No era
eso.** Con el bug arreglado y la consola en cero, el clic sintetico de la extension SIGUE sin
disparar peticion.

Un `btn.click()` programatico en la misma pagina funciona perfecto y completa el ciclo. O sea
que el problema es de la automatizacion del navegador, no de la app, y **el asistente nunca
estuvo afectado**. El bug de hidratacion era real y valia arreglarlo; la consecuencia que se
le atribuyo, no.

### El ciclo de storage, ahora SI verificado por la app

Lo que la vez pasada quedo pendiente:

| Paso | Resultado |
|---|---|
| `GET /api/storage/prepare` | 200 |
| Subida directa con el JWT del usuario | ok |
| `POST /api/documents/register` | 201 |
| Objeto fisico en el bucket privado | 81 bytes, `application/pdf` |
| Key guardada | `{tenant}/case/{caseId}/{ts}_archivo.pdf` — el primer nivel es el tenant, como exigen las politicas |
| `GET /api/documents/[id]/url` | 200, devuelve URL **firmada** (`token=`, NO `/object/public/`) |
| Descarga de esa URL | 200, 81 bytes |

Todo con el bucket PRIVADO. Los artefactos de prueba se borraron: bucket y tabla `documents`
quedaron en cero.

### `pdf_download_link` eliminado

Estaba documentado como "URL publica para descargar el PDF directamente", **nadie lo seteaba**,
y era justo el comentario que podia hacer que alguien concluyera que el bucket tiene que ser
publico. Se saco la prop, su variable derivada y las dos ramas condicionales (HTML y texto
plano), que ahora dicen siempre "El PDF tambien va adjunto a este correo".

### Higiene detectada, no tocada

El navegador de Oliver tiene TRES cookies de sesion de Supabase, una de ellas del proyecto de
**produccion** (`sb-uqmmkklbhzxqybljiecs-auth-token`) — resto de cuando localhost apuntaba a
la base real, antes de la Fase 0. No molesta, pero es una credencial de produccion viva en el
navegador. Conviene borrarla.

## [Seguridad — bucket `documents` privado] - 2026-08-27

En produccion el bucket esta marcado como PUBLICO: cualquiera con la URL exacta descarga un
expediente sin autenticarse. Confidencialidad de cliente y Ley 81.

**Produccion NO se toco.** Staging verificado; el cambio en produccion es un toggle que hace
Oliver (ver `sop.md` SOP-015).

### Verificacion del codigo — la lectura de Oliver se confirmo

- **CERO** usos de `getPublicUrl()` en todo el repo.
- **CERO** URLs de storage armadas a mano con `/object/public/`.
- Los 11 puntos que leen del bucket usan `createSignedUrl` con vencimiento.
- Aparecieron 3 usos de URLs de storage armadas a mano, y los 3 estan bien:
  `backup-supabase.mjs` (dos) usa la **service key**, y `direct-upload.ts` el **JWT del
  usuario**. Ninguno depende de que el bucket sea publico. El respaldo nocturno sigue
  funcionando.
- El correo de cotizacion adjunta un **buffer** que sale de `db.storage.download()`, no de una
  URL: **no puede romperse con este cambio**.
- `pdf_download_link` en la plantilla de correo esta documentado como "URL publica" pero
  **nadie lo setea**: es una prop muerta con un comentario que engaña.

### Las politicas de storage SI aislan por tenant

Cuatro politicas (SELECT/INSERT/UPDATE/DELETE), todas para `authenticated`, comparando
`(storage.foldername(name))[1]` contra `jwt -> app_metadata ->> 'tenant_id'`. Calza con la ruta
que arma `direct-upload.ts`. Sin politica para `anon`, y con RLS activo, el anonimo no ve nada.

**No era el mismo agujero que el del ledger**: aca la base ya estaba bien cerrada.

### ⚠️ HALLAZGO: en staging el bucket NO EXISTIA

`storage.buckets` y `storage.objects` en CERO. Las politicas de la Fase 0 si se habian
aplicado, pero el bucket nunca se creo — o sea que ninguna subida podia funcionar y ese camino
jamas se probo en staging.

Migracion `031`: crea el bucket si falta y lo deja privado. Va en BUNDLE_2 despues de las
politicas.

### Verificacion contra la API (8 pruebas, staging)

| Prueba | Resultado |
|---|---|
| Subir con el JWT del usuario a su propia carpeta | 200 ✓ |
| Leer su propio archivo con su JWT | 200 ✓ |
| URL firmada con service key (lo que hace la app) | 200, 193 bytes ✓ |
| `/object/public/...` anonimo | **400** ✓ |
| `/object/...` sin token | **400** ✓ |
| Leer carpeta de OTRO tenant con el mismo JWT | **400** ✓ |
| Subir a carpeta de OTRO tenant | **400** ✓ |
| `app_metadata.tenant_id` presente en el JWT | ✓ |

Se verifico contra la API y no por la UI a proposito: aisla exactamente la propiedad de
seguridad, sin depender de que un clic funcione.

### ❌ Lo que NO se pudo verificar por la UI

El ciclo por pantalla quedo **sin completar**. Ni la subida de documento ni la descarga de PDF
llegaron a disparar una peticion — confirmado en el log del server de desarrollo, que no
registra ni el POST ni el GET. Fallaron en la capa de automatizacion del navegador, no en la
app.

De paso aparecio un **bug de hidratacion preexistente** en el detalle de caso: un `Badge`
(`<div>`) dentro de un `<p>` en `ExpedienteDetailPage`. React reemplaza el arbol entero
("The server HTML was replaced with client content"), lo que probablemente se come los
clics. **No tiene relacion con storage** y no se toco.

### Higiene

`publicUrl` y `receiptPublicUrl` renombradas a `signedUrl` / `receiptSignedUrl`. El nombre
mentia —siempre llevaron URLs firmadas— y es justo lo que hace que alguien piense "esto es
publico, puedo usar getPublicUrl".

### Para produccion

`docs/runbooks/consulta-produccion-storage-keys.sql`: consulta de SOLO LECTURA para el SQL
Editor. Staging tiene las 20 columnas candidatas VACIAS, asi que **staging no puede responder
si produccion guarda URLs completas** — solo produccion puede.

## [Fase 2 — cierre de la escritura directa al ledger] - 2026-08-27

Aplica el hallazgo de seguridad del bloque anterior, mas la auto-creacion acotada de periodos.
Migracion `030`, en **BUNDLE_2** — fuera del bundle no serviria de nada: el
`ALTER DEFAULT PRIVILEGES` del RESET_SQL volveria a abrir los permisos en cada `--reset`.

### Permisos

| | anon | authenticated | service_role |
|---|---|---|---|
| INSERT / UPDATE / DELETE / TRUNCATE | ✗ | ✗ | ✗ |
| SELECT | ✓ | ✓ | ✓ |
| EXECUTE del RPC | ✗ | ✗ | ✓ |

**TRUNCATE incluido**: era el unico camino que vaciaba una tabla diseñada para ser imborrable
sin disparar un solo trigger de fila y sin pasar por RLS.

`accounting_periods` conserva UPDATE para `service_role` (cerrar y reabrir un periodo es
administracion legitima). `SELECT` se queda en todos lados: los reportes leen.

### El orden de los tres pasos, escrito en el encabezado de la migracion

Revoke de escritura → EXECUTE solo a `service_role` → **recien ahi** SECURITY DEFINER.

Invertirlo abriria algo peor que lo que cierra: con SECURITY DEFINER la funcion deja de correr
bajo RLS y confia en el `p_tenant_id` que recibe, asi que con EXECUTE en PUBLIC se pasaria de
*"puede falsificar la cadena de su propio tenant"* a *"puede escribir en el de cualquiera"*.

Solo las dos funciones que ESCRIBEN son DEFINER. `verify_accounting_chain` sigue INVOKER
porque solo lee — menos privilegio por defecto.

### 🔴 Consecuencia para la Fase 3, escrita ANTES de la primera linea que postea

El RPC deja de ser llamable desde la sesion del usuario. Todo el posteo va por rutas de API
server-side, y **el `tenant_id` lo valida la ruta, no la base**: lo saca del perfil del usuario
autenticado y NUNCA del cuerpo del request. Es la unica garantia de aislamiento que se mudo de
la base al codigo. Queda en `CLAUDE.md` §5, en `task_plan.md` y en el encabezado de
`posting.ts`.

### Periodos: el precipicio de enero, resuelto

El motor auto-crea los periodos del **año en curso y del siguiente**, y nada mas. Los años
pasados no se abren solos: crearlos dejaria postear dentro de un ejercicio ya certificado. Un
2029 por error sigue fallando fuerte.

### La prueba del motor ahora vive en el repo

Estaba solo en un scratchpad temporal y se habria perdido. Ahora:

```bash
node scripts/run-sql.mjs sql/tests/motor-posteo.test.sql
```

14 comprobaciones, dentro de una transaccion que revierte — se puede correr contra una staging
con datos sin miedo. `scripts/run-sql.mjs` sirve ademas para aplicar una migracion suelta sin
`--reset` y lleva el mismo candado anti-produccion que el aplicador.

### Backlog anotado

Enganchar `verify_accounting_chain()` al respaldo nocturno. Es lo unico que ya corre todos los
dias contra produccion, asi que una ruptura se detectaria en menos de 24 horas en vez de cuando
a alguien se le ocurra mirar. Va despues de la validacion de RM.

## [Fase 2 — verificaciones de cierre] - 2026-08-27

Tres verificaciones antes de dar la Fase 2 por cerrada. No hay features nuevas.

### 1. La 029 ahora comprueba antes de crear

Hacia `DROP CONSTRAINT IF EXISTS` + `ADD`. No fallaba, pero contra produccion —donde la
constraint esta sana— habria dropeado y recreado algo correcto sin motivo, y un ADD sobre una
tabla con asientos dispara revalidacion completa con lock.

Ahora comprueba y **solo crea si falta**, y dice por NOTICE cual de los dos casos fue.
Verificado corriendola contra staging ya reparada: *"je_reversion_requires_ref ya existe: base
sana, no se toca."*

### 2. 🔴 EL MISMO BUG ESTABA REPETIDO EN LA 025 — corregido

La 025 descubre el CHECK anonimo de `account_type` con `ILIKE '%account_type%'`. Ese filtro
matchea **dos** constraints: el enum que quiere ampliar y `coa_resultado_subcategoria_niif18`,
que la propia 025 agrega en su paso G.

Se salvaba **de casualidad**: como el paso G lo vuelve a crear, una segunda corrida lo dropea y
lo restaura. Pero es la misma tecnica que en la 028 si causo daño real, y ahi no habia nada que
lo recreara. Si mañana alguien agrega otro CHECK que mencione `account_type` y no lo recree la
propia 025, se pierde en silencio.

Corregido igual que la 028: el filtro pide ademas `'%asset%'`, que solo aparece en el CHECK del
enum. Verificado re-corriendo la 025 contra staging — ahora elimina **una sola** constraint, y
las 4 de `chart_of_accounts` siguen presentes.

Revisadas TODAS las migraciones: las unicas que descubren objetos dinamicamente para dropearlos
son la 025 y la 028, las dos mias, las dos ya corregidas. La 023 tambien usa `EXECUTE format`,
pero para dropear una policy por nombre FIJO sobre una lista de tablas — no hay descubrimiento
y no tiene el problema.

### 3. ⚠️ HALLAZGO DE SEGURIDAD — propuesto, NO aplicado

**Hoy un usuario logueado puede escribir un asiento forjado sin pasar por el motor.**
`authenticated` tiene INSERT sobre `journal_entries` y la politica RLS `tenant_isolation` deja
pasar cualquier fila de su propio tenant. `service_role` bypasea RLS del todo. Y las tres
funciones son SECURITY INVOKER con EXECUTE a PUBLIC.

Ademas: **TRUNCATE no lo frena nada.** Los triggers de inmutabilidad son `FOR EACH ROW` sobre
UPDATE y DELETE, y TRUNCATE no dispara triggers de fila ni pasa por RLS.

`anon` si esta cubierto: sin claim de tenant, el WITH CHECK da NULL y RLS lo frena.

La propuesta completa (revoke + EXECUTE solo a service_role + SECURITY DEFINER, **en ese
orden**) esta en `task_plan.md`, con el detalle de por que el orden importa: con SECURITY
DEFINER y EXECUTE en PUBLIC se abriria un agujero MULTI-TENANT, peor que el que se cierra.

**No se aplico nada.** Qué se rompe hoy: nada — verificado que la app no escribe directo en
ninguna tabla del ledger.

### 4. Periodos contables — no se extienden solos

Sembrados 2026 y 2027 (24 meses, todos abiertos). En **enero de 2028** el primer posteo falla
con un mensaje claro y no corrompe nada, pero **alguien tiene que acordarse**. Tres opciones
anotadas en `task_plan.md`; la recomendada es auto-crear acotado al año actual y el siguiente,
que elimina el precipicio sin perder la proteccion contra el dedazo de fecha.

### Documentado

La desviacion del hash-chain quedo en **`CLAUDE.md` y en `sop.md` SOP-014**, no solo en el
commit: la 023 sigue diciendo "se computa en la app" y ese archivo ya esta aplicado, asi que su
comentario no se puede corregir en su lugar.

## [Fase 2 contable — motor de posteo del ledger] - 2026-08-27

El bloque que NO depende de ninguna respuesta del contador. **No incluye el asiento de
apertura**, que espera la fecha de corte, ni el Libro Mayor ni compras.

### El motor es una FUNCION DE POSTGRES, y no es una preferencia de estilo

Postear un asiento son DOS escrituras (cabecera + lineas) y supabase-js no tiene
transacciones multi-statement. Si la segunda fallara, la cabecera ya estaria escrita **y no se
podria borrar**: los triggers de la migracion 023 rechazan el DELETE. Quedaria un asiento sin
lineas, descuadrado y permanente, en los libros que el contador certifica ante la DGI.

Dentro de una funcion todo corre en una transaccion: si algo falla, no queda nada. Es lo que
ya anticipaba el encabezado de 023 ("la regla de partida doble se valida en el RPC de posteo").

### Desvio deliberado de 023: el hash se calcula en la BD, no en la app

023 decia "hash-chain SHA-256; se computa en la app". Se hace al reves: `prev_hash` es el hash
del asiento anterior, y calcularlo en la app obliga a un read-then-write. **Dos posteos
concurrentes leerian el mismo `prev_hash` y bifurcarian la cadena en silencio** — justo lo que
una cadena de hash existe para impedir. El `SELECT ... FOR UPDATE` de la secuencia serializa
las dos cosas con un solo candado: correlativo sin huecos y cadena. `sha256()` es nativo desde
PG11 y la base corre 17.6, asi que no hace falta pgcrypto.

### Lo que entra

- **`apertura` en el CHECK de `source_type`**, para poder EXCLUIR el asiento de apertura de los
  reportes de movimiento del periodo.
- **`ensure_accounting_periods(tenant, año)`** — los 12 periodos mensuales, idempotente. Se
  provisionaron 2026 y 2027 (24 filas).
- **La fila de `accounting_sequences`.** El formato del numero de asiento esta pendiente
  (consulta 8); mientras tanto, correlativo unico por tenant, que es lo que exige la ley y el
  caso mas restrictivo: de un correlativo unico se deriva cualquier presentacion, al reves no.
- **`post_journal_entry(...)`** — valida partida doble, resuelve el periodo por la fecha, toma
  el correlativo y encadena el hash.
- **`verify_accounting_chain(tenant)`** — una cadena de hash que nadie verifica es decoracion.
- **`src/lib/finanzas/contabilidad/posting.ts`** — envoltorio tipado. NO replica ninguna
  validacion del RPC: dos copias que se desincronizan dan la ilusion de que algo esta validado
  cuando ya no lo esta.

### El periodo NO se crea solo

Si la fecha cae en un año sin provisionar, el motor **falla**. Es deliberado: un 2029 por un
2026 es un dedazo, y crear doce periodos en silencio lo esconderia.

### La CONTRAPARTIDA, aislada a proposito

`src/lib/finanzas/contabilidad/contrapartida.ts` es el punto UNICO donde se decide que va en
esa columna del Libro Mayor. La respuesta de Josuar (consulta 3) cae ahi y es un cambio de una
funcion, no una caceria.

Del modelo salieron dos cosas: lo que escribe es una **categoria corta** ("Proveedores",
"cobrar clientes"), no un codigo ni el nombre exacto de una cuenta; y **todos sus ejemplos son
asientos simples**, asi que el caso ambiguo no esta resuelto por el modelo.

Se resuelven ya los casos SIN ambiguedad, que no van a cambiar con ninguna respuesta posible:
dos lineas, y varias lineas contra una sola cuenta del otro lado. Para el ambiguo se usa
"Varios", que es la que no miente. `contrapartidaEsAmbigua()` se expone aparte para que la UI
no tenga que comparar contra el texto de la etiqueta — comparar contra una etiqueta es
exactamente lo que se rompe cuando pidan cambiarla.

### 🔴 BUG PROPIO, DETECTADO Y REPARADO EN EL MISMO BLOQUE

La primera version de la 028 tenia que ampliar el CHECK de `source_type`. Como en 023 se
declaro inline y sin nombre, lo buscaba con `pg_get_constraintdef(...) ILIKE '%source_type%'`.

**Ese filtro dropeo DOS constraints.** La otra era `je_reversion_requires_ref`, que obliga a
que una reversion apunte al asiento que corrige y traiga un motivo (Art. 5.7). Sin ella se
podia escribir una reversion huerfana y sin explicacion — y como los asientos son inmutables,
quedaria asi para siempre.

Se detecto leyendo los NOTICE de la aplicacion: la migracion aviso que habia eliminado dos
constraints donde debia eliminar una.

- **028 corregida**: el filtro pide ademas `'%factura%'`, que solo matchea el CHECK del enum.
- **029 nueva**: restaura el constraint donde la 028 vieja ya corrio (solo staging; produccion
  nunca la vio).
- Hay un test de punta a punta que postea una reversion sin motivo y verifica que la rechaza.

### Verificacion

**352 tests, 0 fallos** (72 skips preexistentes), mas una prueba de punta a punta del motor
contra staging, **dentro de una transaccion que se revierte** — los asientos son inmutables y
unos de prueba no se podrian borrar despues. Cubre: posteo valido, correlativo, encadenado del
hash desde el genesis, verificador, y **nueve rechazos** (descuadre, una linea, debito y
credito juntos, cuenta inexistente, cuenta inactiva, sin descripcion, año sin periodos,
periodo cerrado, reversion sin motivo).

Se verifico ademas que **los nueve rechazos NO consumen numero de asiento**: el correlativo
quedo en 2 despues de los dos posteos validos.

## [Fase 1 contable — fecha del saldo inicial] - 2026-08-27

Tarea 5, con el alcance recortado que acordamos: **SOLO el campo fecha. Nada de ledger.**
Con esto la Fase 1 queda COMPLETA.

### El campo

- Columna `chart_of_accounts.saldo_inicial_fecha` (**DATE**, no timestamptz: un saldo de
  apertura es de un DIA, no de un instante — con timestamptz "2026-01-01" en Panama se
  guardaria como 2026-01-01T05:00:00Z y en otro huso podria mostrar el 31/12).
- **Obligatoria en cuanto el saldo no es 0**, con CHECK `coa_saldo_inicial_requiere_fecha`.
  Un saldo sin fecha no dice nada: "191,947.55 por cobrar" es un dato distinto al 1 de enero
  que al 14 de agosto.
- Con el saldo en 0 la fecha se descarta (null), para no dejar una fecha colgada de un saldo
  que ya no existe.
- En el form el campo se habilita solo cuando hay saldo, y la etiqueta pasa de "(opcional)" a
  "*". En el listado la fecha va DEBAJO del monto, no en columna propia: sin fecha el saldo no
  se puede interpretar, asi que se leen juntos.

### Modulo nuevo: reglas del periodo fiscal

`src/lib/finanzas/contabilidad/periodo-fiscal.ts`, con la regla textual de Rose: el periodo va
del **1 de enero al 31 de diciembre**, y el 1 de enero solo arrancan con saldo las cuentas del
estado de situacion financiera. **La Fase 2 lo reusa** para sembrar `accounting_periods`, por
eso vive en un modulo propio y no suelto en un componente.

El cierre se DERIVA del inicio en vez de hardcodear "12-31": si el periodo fiscal se desfasara,
cambiar dos constantes alcanza.

### Disenado para el asiento de apertura de la Fase 2

Cuando llegue el motor de posteo, las filas con `saldo_inicial <> 0` se agrupan por
`saldo_inicial_fecha` y **cada grupo se convierte en UN asiento de apertura** con esa fecha.
Por eso la fecha es por cuenta y no una sola global: soporta tanto la carga inicial completa
como una cuenta que se abra despues con saldo a otra fecha.

### ⚠️ HALLAZGO — lo cargado NO es una apertura al 1 de enero

Los saldos suman cero EN TOTAL, pero repartidos asi:

| | suma |
|---|---|
| cuentas de BALANCE | 244,476.91 |
| cuentas de RESULTADO | -244,476.91 |
| patrimonio | 0.00 |

Un asiento de apertura al 1 de enero necesita que el resultado del año anterior YA este
cerrado contra el patrimonio: las cuentas de resultado arrancarian en 0 y las de balance
cuadrarian solas. Aca pasa lo contrario — las de resultado traen el movimiento de enero a
agosto de 2026 y el patrimonio esta en cero.

O sea: es una **FOTO DE MITAD DE AÑO**, no una apertura. **Bloquea el asiento de apertura de
la Fase 2** y va al correo del contador.

Por eso la migracion NO prohibe que una cuenta de resultado tenga saldo, aunque la regla de
Rose lo sugiera: hoy es exactamente lo que hay, y prohibirlo vaciaria el Estado de Resultado
que RM tiene que validar.

### Backfill y carga masiva

- Las 22 cuentas con saldo quedaron con `2026-01-01`, el inicio del periodo fiscal que indico
  Rose. Es la UNICA fecha que el cliente especifico — se carga como tal, no como una fecha de
  corte verificada.
- El Excel de Josuar no trae columna de fecha, asi que el import usa el inicio del periodo
  fiscal en curso y en los UPDATE **preserva** la fecha que ya tenga la cuenta, para no pisar
  una correccion hecha a mano.

### Tests

**345 tests, 0 fallos** (72 skips preexistentes). 7 nuevos del periodo fiscal (incluidos año
bisiesto y fechas que no existen, como el 30 de febrero) y 6 nuevos de la regla saldo/fecha.

### Corregido de paso

El encabezado de `chart-of-accounts-mapping.ts` seguia diciendo que "Costo y Gasto colapsan al
MISMO account_type porque el CHECK de BD solo admite 5 valores". Es falso desde la migracion
025. Quedo actualizado.

## [Fase 1 contable — Estado de Resultado NIIF 18 y sociedad civil] - 2026-08-27

Tareas 3 y 4. Se adelantaron ANTES de la revision de RM a pedido de Oliver: con la
estructura vieja, Josuar habria comentado sobre la FORMA del reporte en vez del contenido.
Ahora ve SU modelo con SUS numeros y puede aprobar de verdad — una vuelta de revision en vez
de dos.

### Tarea 3 — Estado de Resultado con la estructura de Josuar

Modulo nuevo `src/lib/finanzas/reports/estado-resultado-niif18.ts`. El reporte queda:

```
ACTIVIDAD DE OPERACION
  Ingresos operativos ............ 289,137.06
  Costos operativos .............. (9,878.38)
  ► Utilidad Bruta operativa ..... 279,258.68
  Gastos operativos .............. (34,781.77)
  ► Utilidad Operativa ........... 244,476.91
► Utilidad antes de impuesto ..... 244,476.91
  Impuesto sobre la renta .............. 0.00
► Utilidad Neta .................. 244,476.91
DISTRIBUCION A SOCIAS
  300004 Distribucion a Socias .. (244,476.91)
► Resultado del ejercicio ............. 0.00
```

- **Bloques por actividad**: OPERACION, INVERSION y FINANCIAMIENTO. Los bloques sin cuentas
  NO se muestran, y un grupo vacio dentro de un bloque tampoco imprime su subtotal. Hoy
  Integra solo tiene cuentas operativas, asi que se ve un unico bloque.
- **El vuelco de signos va SOLO en presentacion.** El motor (`accounting-reports.ts`) se
  queda en convencion de balanza, y por eso los tests contra el Excel de Josuar siguen
  sirviendo de red. Si se invirtiera el motor, el Balance General dejaria de cuadrar: su
  cuadre es `Activo + (Pasivo + Patrimonio) = 0`, que solo se cumple en balanza.
- **La regla de presentacion es una sola linea**, sin casos especiales:
  `monto = |balanza|` y va entre parentesis `⟺ balanza > 0`. Funciona para ingresos, costos,
  gastos, utilidades e impuesto porque en balanza un debito siempre reduce el resultado y un
  credito siempre lo aumenta. Se ve bien en `430001 Descuentos otorgados`, que es un DEBITO
  dentro de INGRESOS y sale `(663.25)` — restando, que es lo correcto.
- El reporte se expone como una **lista plana de filas** ya ordenadas, no como un arbol: el
  Estado de Resultado se lee de arriba abajo, y asi "los bloques vacios no se muestran" es
  simplemente no emitir filas.
- El Estado de Resultado dejo de usar los componentes compartidos de
  `financial-statement.tsx`, que imprimen en balanza. **El Balance General se quedo con
  ellos, sin tocar**: son dos reportes con dos convenciones y esa diferencia es real.

### Tarea 4 — Sociedad civil

- **`DEFAULT_ISR_RATE` pasa de 0.25 a 0.** Integra no paga ISR a nivel de empresa: reparte a
  las socias y cada una paga su renta personal. **El parametro se queda**, como pidio Rose,
  para vender el sistema despues a sociedades anonimas: se pasa `isrRate` y el renglon
  aparece solo.
- **Seccion de distribucion a socias** al final, y el ejercicio **cierra en cero por
  construccion**: la distribucion es exactamente el opuesto de la utilidad neta.
- Cuenta **`300004 Distribucion a Socias`** (patrimonio) creada — migracion `026`.
  **PROVISIONAL**: el codigo y el nombre son parametros de `buildEstadoResultadoNiif18()`,
  asi que si Josuar pide otro (o un pasivo "Por pagar a socias") se cambia en un lugar.
- `distribucionASocias: false` desactiva la seccion entera para una S.A.

### Verificado

- **333 tests, 0 fallos** (72 skips preexistentes). 20 nuevos en
  `estado-resultado-niif18.test.ts`, incluido **EL ORACULO**: un test que ata la Utilidad
  Operativa del reporte nuevo a la del motor viejo, para que las dos vistas no puedan
  divergir sin que salte.
- Los cinco totales siguen dando lo mismo que el Excel de Josuar. **La estructura cambio, la
  plata no.**
- En pantalla con `admin@staging.test`: reporte completo con la estructura nueva, y el
  **Balance General intacto y cuadrando** (Activo 257,902.46 vs Pasivo+Patrimonio
  -257,902.46). Consola sin errores.

### ⚠️ Inconsistencia conocida, pendiente de decision

El Estado de Resultado ahora dice **"Resultado del ejercicio 0.00"** (todo repartido) pero el
Balance General sigue mostrando **"Utilidad del Ejercicio -244,476.91"** en el patrimonio.

Los dos son defendibles por separado y juntos se contradicen. La Tarea 4 pedia la seccion
solo en el Estado de Resultado, asi que el Balance NO se toco. Resolverlo es una decision
contable de Josuar: si el resultado se reparte, el patrimonio deberia mostrar la contraparte
(una cuenta de distribucion, o un pasivo "Por pagar a socias" si no se paga de inmediato).

### `.env.local` — banda violeta recuperada

`NEXT_PUBLIC_APP_ENV` paso de `staging` a `local` en la maquina de Oliver. Ahora localhost
muestra la banda **VIOLETA "LOCAL — DATOS DE PRUEBA · Desarrollo en tu maquina, contra la
base de staging"** en vez de la ambar de staging, que es lo que describe el CLAUDE.md §9.
El archivo no se commitea (esta en .gitignore).

## [Fase 1 contable — NIIF 18: tipo costo, nueve subcategorias, cuenta control] - 2026-08-27

Tareas 0, 6, 1 y 2 de la Fase 1. Se entrega para que RM Consultores lo pruebe en STAGING
antes de seguir (metodologia acordada con Rose: "avances por modulo, lo probemos, corrijas o
apruebes y sigas al siguiente paso").

**El criterio de aceptacion se cumplio: los reportes siguen cuadrando.** Los cinco totales
del Estado de Resultado y los del Balance dan EXACTAMENTE lo mismo que antes de reclasificar,
verificado contra el Excel de Josuar y tambien contra la base:

| Concepto | Valor | Excel Josuar |
|---|---|---|
| Total de Ingresos | -289,137.06 | -289,137.06 |
| Total de Costos | 9,878.38 | 9,878.38 |
| Ganancia Bruta | -279,258.68 | -279,258.68 |
| Total de Gastos | 34,781.77 | 34,781.77 |
| Utilidad Operativa | -244,476.91 | -244,476.91 |
| Descuadre del Balance | 0.00 | 0.00 |

### Paso 0 — Staging con saldos contables REALES

`npm run seed:staging` ahora carga los saldos de apertura reales del bufete por defecto
(antes hacia falta `SEED_SALDOS_REALES=1`; el escape hatch pasa a ser `SEED_SALDOS_CERO=1`).

Staging queda **hibrido a proposito**: operacion inventada, saldos contables reales.

- **Por que se puede:** los saldos del plan de cuentas son cifras agregadas (bancos, por
  cobrar, totales de ingreso). No hay nombres, cedulas ni expedientes, asi que no son datos
  personales de la Ley 81. Ademas ya estaban commiteados desde el 14/08 como fixture de tests.
- **Por que hace falta:** si el contador abre staging y ve numeros que no reconoce, no puede
  aprobar nada. Con los suyos, dice "esta bien" o "esta mal" en dos minutos.
- **Clientes, casos, tareas y gastos SIGUEN siendo ficticios**: ahi si hay datos personales.

### Tarea 1 — Sexto tipo de cuenta: COSTO

- `account_type` acepta seis valores: `asset, liability, equity, income, cost, expense`.
  En **ingles**, como los otros cinco; label "Costo" en la UI.
- Las 6 cuentas 500001-500006 migradas de `expense`+`costo` a `account_type='cost'`.
- **`buildEstadoResultado()` ahora deriva las tres secciones del TIPO, no de la
  subcategoria.** Con eso desaparecio el grupo "Sin clasificar" del Estado de Resultado:
  existia porque un `expense` que no fuera ni costo ni gasto se caia del reporte, y con la
  seccion decidida por tipo eso ya no puede pasar.
- **Nada se movio en los totales**, como muestra la tabla de arriba.

### Tarea 2 — Las nueve subcategorias NIIF 18

- Guardadas en snake_case, mostradas con los labels textuales que mando Josuar
  ("Ingresos Operativos", "Ingresos por financiamiento", ...).
- Migradas: 9 `ingreso`->`ingresos_operativos`, 30 `gasto_operativo`->`gastos_operativos`,
  6 `costo`->`costos_operativos`. Vocabulario viejo: 0 filas restantes.
- `costo` **eliminada de SUBCATEGORIAS**: paso a ser un tipo y no podian coexistir.
- **Selector filtrado por tipo** (requisito textual de Rose). Cambiar el tipo LIMPIA la
  subcategoria si dejo de corresponder, si no el guardado falla con un error inexplicable.
- **Obligatoria en cuentas de resultado ACTIVAS**, con CHECK en BD *por tipo*: una cuenta de
  ingreso con `gastos_operativos` rompe el reporte igual que un NULL, asi que una lista plana
  de los nueve valores no alcanzaba.

### Tarea 6 — Campos, cuentas y permisos

- Columna **`cuenta_control`** (`clientes` | `proveedores` | NULL), con badge dorado en el
  listado y buscable.
- Marcadas `100004 Cuentas por Cobrar Clientes` y `200001 Cuentas por pagar`.
- Cuenta **`200004 Anticipo de Clientes`** (pasivo corriente) creada — pedida por correo en
  agosto y nunca hecha. Staging pasa de 62 a **63 cuentas activas**.
- **Depreciacion: NO hizo falta crear nada.** Ya existian `112001 Depr. de Mobiliario y
  equipo` (activo, contra-cuenta) y `620001 Depreciacion` (gasto), ambas activas.
- **Permisos**: reclasificar (`account_type`/`subcategoria`) es solo admin+contador (403 para
  la abogada, que conserva crear y renombrar). Y una cuenta **con movimientos** no cambia de
  naturaleza ni se desactiva (409), la toque quien la toque — protege los reportes historicos.
  La regla no dispara todavia porque `journal_entry_lines` esta vacia hasta la Fase 2; se
  implemento igual para que ya este cuando entren los asientos.

### Migracion `sql/pending/025_niif18_tipo_costo_y_subcategorias.sql`

Aplicada a staging. Los 8 post-checks dieron exacto. **Produccion NO se toco.**

Revierte una decision de `024`: aquella dejo `subcategoria` sin CHECK porque la carga masiva
del Excel podia necesitar valores nuevos en plena ventana de deadline. Esa ventana paso y
NIIF 18 fija el vocabulario, asi que ahora el CHECK protege mas de lo que estorba.

**Trampa que casi rompe `--reset`:** en una base recreada las migraciones corren ANTES del
seed, cuando las ~34 cuentas de las migraciones base estan ACTIVAS y sin subcategoria — el
CHECK las habria rechazado. Se agrego un backfill (paso F-bis) que clasifica cualquier cuenta
de resultado activa sin subcategoria valida en la actividad de operacion de su tipo. Contra
la staging ya sembrada afecta 0 filas.

### Tests

- **311 tests, 0 fallos** (72 skips preexistentes, sin cambios).
- 9 tests nuevos de permisos en `chart-of-accounts-permisos.test.ts`.
- 5 tests nuevos de vocabulario NIIF 18 en el validador.
- Reescritos los tests que codificaban el comportamiento VIEJO: "Costo y Gasto se separan por
  subcategoria" paso a "se separan por account_type", y el del grupo "Sin clasificar" paso a
  garantizar que ninguna cuenta de resultado se evapore.

### Verificado en el navegador (admin@staging.test, localhost)

Plan de Cuentas con seccion COSTO propia (6), badges de cuenta control, selector filtrado por
tipo con las 3 subcategorias correctas y label que pasa a "Subcategoria *" en cuentas de
resultado. Estado de Resultado y Balance General renderizando los saldos reales y cuadrando.
Consola sin errores.

### Pendiente de esta fase

Tareas 3 (estructura NIIF 18 del Estado de Resultado + vuelco de signos en presentacion),
4 (sociedad civil / distribucion a socias) y 5 (campo fecha en el saldo inicial).

## [Fase 0 — Variables de entorno en Vercel] - 2026-08-27

Cierre del pendiente 1 de Fase 0: las 4 variables cargadas en el panel de Vercel, con las
tres de Supabase **duplicadas a proposito** — una acotada a Production apuntando a la base
real, otra en "All Pre-Production Environments" (Preview + Development) apuntando a staging.
Con esto, ningun deploy que no sea el de `main` puede tocar la base del bufete.

- `sop.md` SOP-012, subseccion nueva **"Como se cargan en el panel (el orden importa)"**:
  Vercel rechaza dos variables con la misma clave si sus entornos se solapan, asi que hay que
  **acotar primero** la existente de "All Environments" a solo Production (sin tocarle el
  valor) y **despues** crear la de staging. Al reves no deja. El selector de entornos solo es
  editable en `/settings/environment-variables`; en la vista por entorno aparece bloqueado.
- Queda anotado que **cargar las variables no alcanza**: Vercel no las aplica a deploys ya
  construidos, hace falta disparar uno nuevo.
- Verificacion del alcance sin esperar un build, con `vercel env pull --environment=preview`:
  devuelve `NEXT_PUBLIC_APP_ENV="staging"` y el ref de staging (`xtyenhakplrkyifbcaow`). El
  pull equivalente de `production` queda explicitamente prohibido en el SOP — baja las
  credenciales reales a la maquina.

## [Fase 0 — Ambiente de pruebas] - 2026-08-25 - CERRADA (tareas 1 a 7)

Fase 0 es bloqueante: no arranca nada de contabilidad hasta que exista una base de staging
separada. Los asientos del ledger son inmutables por diseño (`023_contabilidad_fase1_ledger.sql`
crea 6 triggers que rechazan UPDATE y DELETE), así que un error de prueba contra la base real
no se borra: queda en los libros que el contador tiene que certificar ante la DGI.

Proyecto Supabase de staging: `xtyenhakplrkyifbcaow`. Producción: `uqmmkklbhzxqybljiecs`.

**Las 7 tareas cerradas.** Staging tiene el esquema completo, datos ficticios y aislamiento
verificado.

### Tarea 1 — Inventario de migraciones

Nuevo `docs/staging/inventario-migraciones.md`: las 32 migraciones de `supabase/migrations/`
y los 33 archivos de `sql/pending/`, cada uno con su estado en producción y qué hace.

- `sql/pending/` **no es una cola**: conviven migraciones aplicadas hace meses (018, 019, 020,
  023, 024) con una que nunca se corrió (022). El nombre del directorio engaña.
- **Solo 3 archivos quedan en "incierto"**, y los tres son cambios de dato, no de esquema,
  así que el repo no puede resolverlos: `backfill_client_type_null.sql`,
  `hotfix_cli116_client_type.sql`, `cleanup-test-users-2026-05-02.sql`. El documento trae la
  consulta exacta para verificar cada uno contra la base.
- **Hallazgo con impacto en la Tarea 3**: `supabase/migrations/20260402000003_seed_clients_cases.sql`
  contiene **23 clientes y 46 casos REALES** del bufete, sacados del Excel, con los nombres de
  las licenciadas. Aplicar las migraciones "todas de corrido" en staging habría copiado datos
  personales protegidos por la Ley 81 — exactamente lo que Fase 0 viene a evitar. El documento
  lista el orden de aplicación con ese archivo y otros ocho explícitamente excluidos.
- Faltan los números 003 y 017 en `sql/pending/`. No existen ni aparecen en el historial de git.

### Tarea 2 — Script de seed de staging

- `scripts/seed-staging.ts` + `scripts/seed-data/staging-fixtures.ts`, corriendo con
  `npm run seed:staging`.
- **Dos candados anti-producción independientes**, ambos verificados: el project ref de la URL
  de Supabase contra una lista negra, y `NEXT_PUBLIC_APP_ENV ∈ {staging, local}`. Con el
  `.env.local` actual (que apunta a prod) el script aborta antes de crear el cliente Supabase.
- **Idempotencia por UUID determinístico (UUIDv5)** sobre la clave natural de cada fila. El
  estado "En trámite" siempre es el mismo UUID, corras el seed una vez o veinte. Ataca de raíz
  el bug de `cat_statuses` con 7 filas donde debía haber 2
  (`fix-duplicate-statuses-2026-08-23.sql`), que salió de correr un script de carga tres veces.
- Excepción documentada: **cotizaciones y facturas se crean solo si no existen**. Los triggers
  T1/T2/T4/T5b/T5c prohíben tocar líneas y campos de un documento que salió de `borrador`, así
  que un upsert ciego reventaría en la segunda corrida. El seed las crea en `borrador`, inserta
  las líneas (los triggers de recálculo llenan los totales) y recién ahí avanza el estado por
  transiciones whitelisteadas.
- **Cero datos de producción.** 15 clientes ficticios con nombres panameños, RUC/cédula bien
  formados y DV determinístico de 2 dígitos; 30 casos en las 9 clasificaciones; 20 gastos de
  trámite; 7 cotizaciones y 8 facturas cubriendo todos los estados alcanzables; 6 tareas y
  4 pendientes personales. Emails en dominios `.test` (RFC 2606) para que nada salga por Resend.
- **Montos redondos a propósito** (500 / 1.000 / 1.500 / 2.500) para que el ITBMS 7% dé
  35 / 70 / 105 / 175 y un Estado de Resultado se pueda validar a mano.
- **El plan de cuentas sí se replica idéntico**: las 62 cuentas de Josuar, importadas del
  fixture que ya vive en el repo (`josuar-accounts.fixture.ts`) en vez de transcribirlas. No es
  dato personal y se necesita igual para que los reportes se comporten como en prod. El seed
  además desactiva las 34 cuentas legacy de QuickBooks, que es el estado real de producción
  (62 activas + 34 inactivas = 96).
- **Los saldos de apertura reales NO se cargan por defecto** (`saldo_inicial = 0`). Con los
  saldos reales, cada total de reporte arrastra números como 191.947,55 y se pierde el objetivo
  de validar a mano. Se cargan con `SEED_SALDOS_REALES=1` cuando haga falta reproducir los
  totales de producción.
- 5 usuarios de prueba con nombres inventados (NO los de las licenciadas) cubriendo los 4 roles.
  El script imprime usuario y contraseña al terminar.

### Tarea 3 — Aplicar el esquema en staging

**48 archivos aplicados**, en orden, sobre una base limpia. Resultado verificado:

| | Staging |
|---|---|
| Tablas en `public` | 45 |
| Políticas RLS | 51 |
| Triggers (no internos) | 44 |
| Triggers de inmutabilidad del ledger | **6/6** |
| Plan de cuentas | 62 activas + 34 legacy inactivas = 96 |
| Secuencias | `client`, `quote`, `invoice_hon`, `invoice_reim`, `credit_note` |

`scripts/apply-staging-sql.mjs` los aplica por conexión directa (`pg`, session pooler puerto
5432) con el mismo candado anti-producción del seed. `--reset` dropea `public` y recrea todo
de cero sin tocar `auth`, así que los usuarios de prueba sobreviven. `--check` solo reporta.

**Con la `service_role` key no alcanza:** PostgREST no ejecuta DDL, `/pg/query` da 404 y no
hay RPC `exec_sql`. Eso significa además que **`scripts/run-migration.mjs` nunca funcionó**,
porque apunta justo a ese endpoint. Lo reemplazan el runner y
`scripts/build-staging-bundle.mjs`, que genera el mismo SQL pegable a mano.

#### El esquema `auth` está cerrado en los proyectos Supabase nuevos

Las funciones de RLS del proyecto viven en `auth.tenant_id()` / `auth.user_role()`. En
staging **no se pueden crear ahí**, ni por conexión directa ni desde el SQL Editor:

```
has_schema_privilege('postgres','auth','CREATE')  → false
set role supabase_admin / supabase_auth_admin     → permission denied
roles con CREATE en auth: supabase_admin, supabase_auth_admin, dashboard_user
```

Producción no tiene el problema porque se creó en abril de 2026, cuando `postgres` todavía
tenía ese permiso. Por decisión de Oliver, en staging las dos funciones viven en `public` y
el runner reescribe las referencias al vuelo (`auth.tenant_id` → `public.tenant_id`). Es
cambio de nombre, no de lógica: el cuerpo lee `request.jwt.claims`, que es un setting de
sesión y no depende del esquema. `auth.users` (la FK) queda intacta.

Convergir producción a `public.*` queda anotado en `task_plan.md` como sprint propio:
implica recrear las 51 políticas de RLS.

#### Deuda que apareció al aplicar el repo de corrido por primera vez

Nunca se había hecho — las migraciones se venían aplicando a mano, de a una. Las tres son
silenciosas y ninguna se podía resolver sin mirar producción. Detalle en `task_plan.md`.

1. **La sección 5 de `20260508000002` nunca se aplicó en producción, y el archivo dice que
   sí.** Su encabezado afirma "YA APLICADO EN PRODUCCION 2026-05-08" — cierto para 7 de sus
   8 secciones. La 5, la que dropea las columnas generadas de `quote_lines`, no corrió:
   tiene un bug de sintaxis adentro (una variable PL/pgSQL `is_generated` que choca con la
   columna homónima de `information_schema.columns`). Quien la aplicó a mano se comió ese
   error y siguió de largo con el resto.

   Verificado contra producción:
   ```
   subtotal   → ALWAYS  (quantity * unit_price)
   tax_amount → ALWAYS  ((quantity * unit_price) * tax_rate)
   line_total → ALWAYS  ((quantity * unit_price) * (1 + tax_rate))
   ```
   Y las otras secciones sí están: `quotes.public_token / subtotal_hon / subtotal_rei /
   converted_at`, `quote_lines.invoice_kind` con datos, y `quote_terms_template`.

   El "trigger T8b-quote" que esa sección promete **no existe en ningún lado**, y nunca hizo
   falta: las columnas nunca dejaron de ser GENERATED. Los tres triggers reales de
   `quote_lines` en producción son `finanzas_quote_lines_immutability`, `update_updated_at`
   y `finanzas_trg_recalc_quote_totals`, y el último solo recalcula la cabecera.

   **Staging ahora saltea la sección 5** (`scripts/staging-fixups.mjs`, FIXUP 2) y el seed
   dejó de escribir esas tres columnas. Las dos bases calculan igual. Queda pendiente
   corregir el encabezado del archivo en el repo: hoy miente por omisión.

   Cómo se llegó acá vale la pena registrarlo. La primera lectura fue "falta un trigger en
   el repo" y la conclusión estaba al revés: el repo tenía de más, no de menos. Lo destrabó
   Oliver al mirar los triggers reales de producción y notar que ninguno llenaba esas
   columnas, con los totales igual perfectos. La única explicación posible era que las
   columnas siguieran siendo generadas. Y sobre esa lectura hubo una segunda corrección:
   excluir el archivo entero —la propuesta inicial— habría quitado 19 columnas que
   producción sí tiene. La solución correcta era quirúrgica, una sección de ocho.

2. **`idx_payments_tenant` está definido dos veces**, sobre `client_payments` y sobre
   `payments`. Los nombres de índice son globales por esquema, así que el segundo no pudo
   correr limpio. Verificado en producción por Oliver, **y salió al revés de lo que se
   había supuesto acá**: `payments` sí tiene el índice y **`client_payments` se quedó sin
   ninguno sobre `tenant_id`**. Al aplicar `b3d_payments` a mano se borró o renombró el
   viejo para que el nuevo pasara, y nadie recreó el de `client_payments`. Queda como
   arreglo pendiente **del lado de producción**; impacto bajo hoy (25 filas). En staging
   las dos tablas quedan indexadas, porque acá las migraciones corrieron de corrido.
3. **Las migraciones marcadas como "retro-documentación" nunca se ejecutaron.** El caso 1 es
   la prueba: se escribieron después de aplicar el cambio a mano, así que nadie las corrió
   nunca y pueden arrastrar bugs latentes. Vale revisar las demás con esa etiqueta.

Los casos 1 y 2 se sortean con `scripts/staging-fixups.mjs`, una lista explícita de parches
donde cada entrada dice qué rompe, qué se verificó en producción y qué queda pendiente.

### Tarea 6 — Verificación del aislamiento

- Se escribió un caso `ZZZ-999` ("PRUEBA DE AISLAMIENTO FASE 0") **en staging**. Los casos
  de staging pasaron de 30 a 31.
- **Producción: 207 casos, 134 clientes, ref `uqmmkklbhzxqybljiecs`.** Oliver corrió el
  conteo en el SQL Editor **antes y después** de toda la sesión: idéntico las dos veces.
  Nada de esta sesión tocó producción, ni para leer — la regla es que las credenciales de
  producción no se comparten con ninguna herramienta.
- Staging quedó en **31 casos y 15 clientes**. Si `.env.local` estuviera apuntando a
  producción, el listado de Casos mostraría 207 y los nombres reales del bufete. Muestra 31
  y clientes inventados.
- El caso `ZZZ-999` queda como rastro. Se borra con un `DELETE` cuando estorbe.

### Tarea 4 — Configuración de entornos

- `.env.local` **reapuntado a staging**, con un encabezado que explica por qué no vuelve a
  producción. El anterior quedó respaldado en `.env.backup-produccion-2026-08-25.local`
  (ignorado por git, y no es un nombre que Next.js cargue) para no perder las credenciales
  de eFactura y Resend.
- Variable nueva `NEXT_PUBLIC_APP_ENV` (`local` | `staging` | `production`).
- **`RESEND_API_KEY` comentada en staging.** La cuenta tiene `integra-panama.com` verificado
  y manda correo real: si alguien prueba "Enviar cotización" y escribe una dirección de
  verdad, el cliente la recibe. Sin la variable el flujo corta con un error claro. Es una
  línea descomentarla para probar el envío a propósito.
- `.env.example` y `.env.local.example` actualizados con el bloque de entornos.
- La tabla de qué cargar en Vercel está en `sop.md` SOP-012 (lo hace Oliver).

### Tarea 5 — Salvaguarda visual

- `src/lib/env/app-env.ts` (módulo puro) + `src/components/env-banner.tsx`, montado en el
  root layout: sale en **toda** pantalla, incluidos el login y el portal público.
- Ámbar "STAGING — DATOS DE PRUEBA", violeta "LOCAL", rojo "⚠ ENTORNO SIN DEFINIR".
  En producción **no renderiza nada**, y esa ausencia es la señal.
- Rayas diagonales: ningún otro elemento del CRM las tiene, se reconoce sin leer. Los tres
  colores están lejos del navy y el dorado de la paleta Integra. Sin botón de cerrar.
- **Fail-safe:** si falta `NEXT_PUBLIC_APP_ENV`, se cae al project ref de Supabase. Resuelve
  "producción" solo cuando la base ES la de producción; ante la duda muestra la banda roja.
  Así, olvidarse de cargar la variable en Vercel no le pone una alerta enfrente a las
  licenciadas.
- La lista de refs de producción es **una sola**: `PROD_PROJECT_REFS` en `app-env.ts`, que
  ahora también importa el seed. No se pueden desincronizar.
- Los offsets del header sticky y del sidebar fixed pasaron a sumar `--env-band-h` (0 en
  producción), así que la banda no tapa nada.

### Tarea 7 — Documentación

- `sop.md` → **SOP-012: Entornos — staging vs. producción**. Cómo levantar el entorno,
  regenerar los datos, por qué no hay que "cambiar de entorno", los usuarios de prueba, la
  tabla de variables de Vercel, y la regla de que producción solo se toca por deploy.
- `CLAUDE.md` → §9 reescrita. Decía *"localhost = dev; URL de Vercel = prod"*, que era falso
  y es exactamente la confusión que causó el problema. Ahora hay tabla de tres entornos.
  También se reforzó **DB Safety**.
- `task_plan.md` → sección de Fase 0 con el estado de las 7 tareas.

### ⚠️ Efecto colateral: `scripts/backup-supabase.mjs` quedó apuntando a staging

Ese script (untracked en el repo, del 2026-08-25 15:30) **lee las credenciales parseando
`.env.local` a mano**:

```js
const URL_BASE   = leer("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE_KEY = leer("SUPABASE_SERVICE_ROLE_KEY");
```

Al reapuntar `.env.local` a staging, el respaldo pasó a copiar **staging** — pero sigue
escribiendo `"proyecto": "crm-integra-legal (PRODUCCION)"` en el `_MANIFIESTO.json` y sigue
guardando en la misma carpeta de OneDrive. Es la peor forma de fallar: un respaldo que se
declara de producción, con datos de prueba adentro, y con la retención de 14 días borrando
los respaldos buenos de los días anteriores.

**ARREGLADO por Oliver el mismo día**, antes de que corriera el respaldo automático de las
20:30. El script ya no lee `.env.local`: lee `.env.produccion.local` (o lo que indique
`BACKUP_ENV_FILE`), **aborta si el project ref no está en `PROD_PROJECT_REFS`** —el candado
del seed, al revés— y el `_MANIFIESTO.json` ahora graba `project_ref`, así que deja de
depender de una etiqueta escrita a mano. Probado en los dos sentidos.

Nota menor: `PROD_PROJECT_REFS` queda ahora en dos lugares (`src/lib/env/app-env.ts` y
`scripts/backup-supabase.mjs`, que corre con `node` y no puede importar el módulo TS). Si
alguna vez cambia el proyecto de producción, hay que tocar los dos.

`scripts/backup-supabase.mjs` sigue **untracked**. Vale la pena versionarlo: es la única
defensa ante un borrado en producción y hoy vive solo en la máquina de Oliver.

### Verificado

- `npx tsc --noEmit` limpio en todo el proyecto (exit 0).
- `npx eslint` limpio en todos los archivos tocados.
- Candado 1 del seed probado: con el `.env.local` de producción aborta con "el proyecto
  Supabase … es PRODUCCIÓN".
- Candado 2 probado: con una URL de staging y sin `NEXT_PUBLIC_APP_ENV` aborta igual.
- Banda de entorno verificada en el navegador sobre `/login` (`localhost:3001`, porque el
  3000 estaba ocupado por otro proyecto): ámbar con rayas, arriba de todo, sin tapar nada.
- Credenciales de staging verificadas: PostgREST responde 200, `auth/v1/admin/users`
  devuelve 0 usuarios y `public.tenants` no existe — la base está vacía, como se esperaba.
- **Nada se ejecutó contra producción** en toda la tarea.

### Verificado en el navegador, con sesión real en staging

Login como `admin@staging.test`, sobre el esquema y los datos recién cargados:

| Check | Resultado |
|---|---|
| Login completo (no rebota a `?error=no-role`) | ✅ "Buenas noches, Rodrigo" |
| Banda de entorno en el login | ✅ ámbar con rayas |
| Banda **dentro** de la app, sin tapar el header ni el sidebar | ✅ los tres offsets correctos |
| Listado de Casos | ✅ 31 casos, clientes ficticios, abogadas "(STAGING)" |
| Listado de Cotizaciones | ✅ 7, con totales correctos ($1.605 / $3.340 / $2.140) y los 7 estados |

**Bug encontrado y corregido en el camino:** el seed creaba los usuarios sin
`app_metadata.user_role` / `app_metadata.tenant_id`. El middleware autoriza leyendo de ahí,
así que el login entraba y rebotaba al instante a `/login?error=no-role`. Ahora el seed usa
el mismo shape que `/api/admin/users` al crear un usuario real.

**Totales de cotización, verificados después de saltear la sección 5:** las seis columnas de
`quote_lines` e `invoice_lines` quedaron `GENERATED ALWAYS` con la misma expresión que
producción, y los totales de cabecera los llena el trigger de recálculo. Una línea de
staging (`HON / 2500 / 175 / 2675`) tiene la misma mecánica que la de producción que pasó
Oliver (`HON / 900 / 63 / 963`). `quotes.subtotal_hon` y `subtotal_rei` los sigue escribiendo
el seed, porque en la app real los calcula el código
(`src/lib/finanzas/api/quotes.ts:601, 796, 928`), no la base.

### Pendiente de esta fase

- **Tarea 4, mitad de Oliver** — cargar las 4 variables en el panel de Vercel.
- Re-correr el conteo de casos en producción para confirmar que sigue en 207 después de esta
  sesión.
- Los tres puntos de deuda de la tarea 3, cada uno con su consulta de verificación.
- Oliver va a pasar la definición del trigger de totales de cotización, exportada de
  producción, para versionarla.
- Recrear en **producción** el índice de `client_payments(tenant_id)`.
- `sql/pending/022_backfill_dv_embebido.sql` **ya quedó versionado** (sigue sin aplicar en
  producción, que es lo correcto: es un backfill que va con el refinamiento del DV).


## [DEPLOY] - 2026-08-24 14:49 UTC - develop → main (3 commits)

**Merge:** `0de75ca` · **Punto de rollback:** `fd0bf88` · **Aprobado por:** Oliver

### Contenido

| SHA | Qué |
|---|---|
| `f1b322b` | Panel del asistente "Casos del Bufete" + selectores de responsable filtrados por rol + retiro de `assistant_id` de la UI |
| `aab5b9d` | Alcance reducido del asistente: sin Gastos (menú, ruta y tab del caso), sin cambio de estado, con guards 403 en `/api/expenses` y `/api/cases/[id]` |
| `3f678b4` | El asistente no crea tareas, guard de propiedad al cumplirlas y cierre del hueco equivalente en `/api/todos` |
| `3dd9d43` | Log del deploy anterior (arrastrado) |

**Migraciones: NINGUNA. Env vars nuevas: NINGUNA. Cambios de RLS: NINGUNO.**

### Checklist SOP-006

| # | Paso | Resultado |
|---|---|---|
| 1 | Tests | **287/287 verde**, 0 fail |
| 2 | Linting | ⚠️ **EXCEPCIÓN APROBADA** — ver abajo |
| 3 | Build local | `next build` **exit 0**, 26 rutas, middleware 80.4 kB |
| 4 | Env vars de producción | Ninguna nueva: el diff no agrega un solo `process.env`. **No se auditó el estado de las env vars ya cargadas en Vercel** — no hay acceso a la cuenta del cliente. Como no cambian, no aplica |
| 5 | Migraciones en prod | Ninguna. `supabase/migrations/` sin cambios |
| 6 | RLS policies | Sin cambios de schema → cero `policy`/`rls`/`grant`/`revoke` en el diff |
| 7 | Funcionalidad crítica (Playwright) | Las dos sesiones, en los 3 commits, incluidos los 403 llamados directo a la API |
| 8 | Changelog | Actualizado |
| 9 | Diff review | 26 archivos, +1.013 / −485. Sin dependencias nuevas, sin cambios en `package.json` |
| 10 | Pausa / aprobación | Dada explícitamente por Oliver |
| 11 | Merge a main | `--no-ff` → `0de75ca` |
| 12 | Deploy en Vercel | Auto-deploy disparado por el push. Producción responde HTTP 200 |
| 13 | Verificación post-deploy | Parcial — ver abajo |

### Excepción del paso 2 (linting) — aprobada por Oliver

El proyecto arrastra **21 errores de ESLint**, así que el paso "linting sin errores" **no pasa
literalmente**. Se aprobó la excepción con este fundamento:

- **Los 21 ya existen en `main`.** 15 están en archivos que este deploy ni toca. Los otros 6
  están en dos archivos compartidos (`casos/[id]/page.tsx` y `casos/page.tsx`); se verificó
  extrayendo **de `main`** esas dos versiones y linteándolas por separado: dan exactamente los
  mismos errores (`Upload`, `Button`, `backUrl` sin usar; un `prefer-const`).
- **Este merge no introduce ninguno nuevo.**
- `next build` pasa igual (exit 0).

Criterio de Oliver: bloquear un arreglo de permisos por lint preexistente sería priorizar mal.
Queda registrado para que el rastro exista y no se lea como que el checklist salió limpio.
La limpieza quedó agendada como sprint propio en `task_plan.md` → "Sprint de limpieza de lint".

### Verificación post-deploy — QUÉ SE VERIFICÓ EN PRODUCCIÓN

Con sesión real de Harry Boyd (asistente) en `crm-integra-legal.vercel.app`:

| Check | Resultado |
|---|---|
| El deploy entró (código nuevo sirviéndose) | ✅ Confirmado |
| Menú del asistente | ✅ Solo **Dashboard, Casos y Mis Pendientes** — sin Gastos |
| Tarjeta principal del panel | ✅ **"Casos del Bufete" = 207** |

### QUÉ **NO** SE VERIFICÓ EN PRODUCCIÓN

Se corta acá con honestidad: lo de abajo **no se probó contra producción** y no debe leerse
como verificado. La sesión de prod se abrió en una ventana de incógnito, a la que la
automatización del navegador no llega, y no se repitió el login.

| Sin verificar en prod | Sí verificado en localhost, con el MISMO código |
|---|---|
| `/legal/gastos` escrito a mano rebota a `/legal` | ✅ |
| Detalle de caso sin tab "Gastos", sin "Cambiar Estado", sin "+ Nueva Tarea para Asistente" | ✅ |
| `?tab=gastos` a mano cae en Información, sin montos | ✅ |
| El asistente puede comentar | ✅ |
| El asistente puede adjuntar documentos | ✅ |
| El asistente puede cumplir una tarea desde Mis Pendientes | ✅ (flujo completo sobre CORP-002, `PATCH` 200) |
| Guards 403 de la API (`/api/expenses`, `/api/cases/[id]`, `/api/tasks`, `/api/todos`) | ✅ llamados directo con sesión de asistente |
| **Regresión con sesión de admin** | ✅ en localhost — **NO se corrió en prod** |

**Riesgo asumido:** es el mismo commit que corrió en localhost, sin migraciones, sin env vars
nuevas y sin cambios de RLS, así que la diferencia entre los dos entornos es mínima. Aun así,
los dos checks que sí se hicieron en prod (menú y tarjeta) tocan justamente `nav-config.ts` y
`asistente-home.tsx`, que son el corazón de dos de los tres commits. **La regresión de admin en
producción queda pendiente** y conviene hacerla en la próxima sesión antes de tocar nada más.

### Limpieza de la sesión anterior — HECHA

Oliver corrió el DELETE de la tarea de prueba el 24/08/2026 y lo verificó: **no queda ninguna
tarea de prueba en la base.** Ver entrada `[FEAT] 2026-08-24 (2)`.

## [FEAT] - 2026-08-24 (2) - El asistente tampoco crea tareas + guard de propiedad al cumplirlas

Branch `develop`. Cierra el pendiente que había quedado abierto en la entrada anterior de hoy.
Decisión de Oliver: **Harry solo CUMPLE las tareas que le asignan.** Si necesita dejar un
recordatorio en un caso, usa un comentario.

**El motivo de fondo no era de coherencia sino de permisos:** el selector "Asignar a" del
formulario de tareas lista a TODOS los usuarios activos (Contador Test, Daveiva, Legal Integra,
Milena, Oliver). Un asistente podía repartirle trabajo a las socias.

### 1. UI — se retira el formulario de crear tarea

| Archivo | Cambio |
|---|---|
| `src/app/legal/casos/[id]/page.tsx` | `<AddTaskForm>` solo para admin/abogada (`canCreateTasks`, mismo patrón que `CaseStatusChanger`). El grid de acciones del tab Seguimiento colapsa a una columna cuando el botón no va, así que "+ Agregar Comentario/Seguimiento" ocupa el ancho completo en vez de dejar un hueco |

`<AddCommentForm>` y `<CompleteTaskButton>` quedan **intactos**: comentar y cumplir tareas
siguen siendo del asistente. No había ningún otro control de creación de tareas en el tab.

### 2. Guards en la API

| Endpoint | Estado previo | Ahora |
|---|---|---|
| `POST /api/tasks` | **NO validaba rol en absoluto** — tercera aparición del mismo patrón (hallazgo #3 de la revisión OWASP; ya cerrado en `/api/expenses` y `/api/cases/[id]`) | `requireRole(["admin","abogada"])` → 403 |
| `PATCH /api/tasks/[id]` | Sin gate de rol y **sin gate de propiedad**: el asistente podía cerrar CUALQUIER tarea del bufete, incluidas las de las abogadas | Sigue SIN gate de rol —cumplir tareas es su flujo diario— pero ahora va por **PROPIEDAD**: si el rol es `asistente`, `assigned_to` tiene que ser él. admin/abogada cierran cualquiera |
| `POST /api/todos` | Aceptaba `assigned_to` de cualquiera | El asistente no puede asignarle un pendiente personal a otra persona → 403 |

**Sobre los campos que el PATCH puede tocar** (lo que preguntaste): resultó que ya estaba
acotado y no hizo falta trabajo extra. El handler **solo acepta `status: "cumplida"`** y
descarta el resto del body — `description`, `deadline` y `assigned_to` ni se leen — además de
filtrar por `tenant_id`. Lo único que faltaba era la propiedad, que es lo que se agregó. Se
documentó con un comentario en el código para que no se pierda.

**`/api/todos/*` revisado**: es la agenda personal (`personal_todos`), con permisos por
PROPIEDAD y no por rol — `PATCH` y `DELETE` ya exigen ser creador o asignado. El asistente ni
siquiera ve esa UI (`/legal/pendientes` le renderiza `<AsistentePendientes>`), pero el `POST`
era alcanzable a mano, y ese hueco es el que se tapó. No lleva `requireRole` a propósito: no
es un recurso gobernado por rol.

### 3. Test nuevo

`src/app/api/tasks/__tests__/patch-task-ownership.test.ts` — **4/4 pasan**:
asistente + tarea propia → 200; asistente + tarea ajena → 403 sin tocarla; abogada + tarea
ajena → 200; y body con `assigned_to`/`description` → 400 sin reasignar.

### Verificación

| Check | Resultado |
|---|---|
| `tsc --noEmit` | limpio (exit 0) |
| Lint de los archivos tocados | 0 errores nuevos (siguen los 3 preexistentes de `casos/[id]/page.tsx`) |
| `patch-task-ownership.test.ts` | 4/4 |
| `patch-role-by-action.test.ts` | 4/4 (sin regresión) |

### Verificación en navegador (24/08/2026, `localhost:3000`)

**Flujo completo de punta a punta con una tarea real**, sobre `CORP-002` — caso CERRADO, abierto
en 2021, sin movimiento desde abril y sin tareas previas, elegido para no meterle ruido a
Daveiva ni a Milena en un expediente en uso.

| Paso | Resultado |
|---|---|
| Admin crea la tarea "PRUEBA VERIFICACION PERMISOS 24/08 - IGNORAR - CEC" asignada a Harry Boyd | **`POST /api/tasks` 201** — sin regresión para admin |
| La tarea aparece en el hilo del caso | "Pendiente · Harry Boyd" |
| Asistente abre el caso | **Sin "+ Nueva Tarea para Asistente"**. Sigue "+ Agregar Comentario/Seguimiento", ahora a ancho completo |
| Asistente en Mis Pendientes | Ve la tarea agrupada bajo CORP-002, "1 pendiente" |
| Asistente marca cumplida | **`PATCH /api/tasks/{id}` 200** → "0 pendientes · 1 cumplida" |

**Guards probados llamando la API directo con la sesión del asistente:**

| Llamada | Resultado |
|---|---|
| `POST /api/tasks` (con `assigned_to` = Daveiva) | **403 `Sin permiso`** |
| `POST /api/todos` con `assigned_to` = Daveiva | **403 "No puedes asignar pendientes a otras personas"** |
| `POST /api/todos` para sí mismo (body vacío) | **400 "Descripción requerida"** → pasó el gate |

**Lo que NO se probó contra producción y por qué.** El 403 del asistente sobre una tarea AJENA
se cubrió con el test unitario, no en el navegador: todas las tareas ajenas del tenant están
`pendiente`, así que si el guard fallara habría cerrado una tarea real de las licenciadas y
**no existe endpoint `DELETE` ni forma de revertir un "cumplida"** desde la app. El riesgo no
valía la pena teniendo cobertura equivalente con mocks.

### Limpieza de la tarea de prueba — HECHA el 24/08/2026

La tarea de prueba quedó **cumplida** en `CORP-002` y, como no hay `DELETE` de tareas en la API,
la baja fue por SQL. **Oliver corrió la sentencia y verificó el resultado el mismo día: no queda
ninguna tarea de prueba en la base.**

```sql
DELETE FROM tasks WHERE id = '2f0f31f8-cda6-4243-bb93-5f9ede5e5697';
```

Solo esa fila. **`audit_log` NO se tocó**: es la bitácora y sus registros quedan aunque
mencionen la tarea de prueba.

**Migraciones: NINGUNA.**

## [FEAT] - 2026-08-24 - Alcance del rol asistente: solo lectura + documentos y comentarios

Branch `develop`. **Decisión de negocio del cliente**, no un arreglo técnico. El rol asistente
pasa a ser de consulta y constancia: mira todo el bufete, cambia casi nada.

| Puede | No puede |
|---|---|
| Ver Dashboard, Casos (todos, solo lectura) y Mis Pendientes | Ver o registrar gastos |
| **Subir documentos** a un caso | Cambiar el estado de un caso |
| **Comentar** en un caso | Editar, crear o borrar casos y clientes |
| Cumplir tareas desde Mis Pendientes | Entrar a Finanzas |

### 1. Gastos sale del alcance del asistente

| Archivo | Cambio |
|---|---|
| `src/lib/nav-config.ts` | El ítem "Gastos" pasa a `["admin", "abogada"]` |
| `src/middleware.ts` | `/legal/gastos` sumado a `ASISTENTE_BLOCKED_PATTERNS`, por PREFIJO (no hay sub-ruta de gastos que deba ver). **No estaba cubierto**: el array solo tenía patrones de `/legal/clientes`, así que escribir la URL a mano renderizaba la pantalla igual |
| `src/components/dashboards/asistente-gastos.tsx` | **Borrado** |
| `src/components/dashboards/asistente-gastos-form.tsx` | **Borrado** (solo lo usaba el anterior) |
| `src/app/legal/gastos/page.tsx` | Fuera la rama `if (userRole === "asistente")` que devolvía `<AsistenteGastos />`, y su import |

### 2. Detalle de caso: se va lo que ya no puede hacer

| Elemento | Antes | Ahora |
|---|---|---|
| `<CaseStatusChanger>` | Se renderizaba a TODOS los roles | admin/abogada |
| Tab "Gastos" | Visible para el asistente | Solo admin/abogada — **y `?tab=gastos` se normaliza a `info`**, para que escribir la URL a mano tampoco muestre montos |
| `<SectionExpenseForm>` (botón de registrar gasto) | **Ya estaba** gateado a admin/abogada | Sin cambios — verificado |
| Editor inline | **Ya estaba** gateado a admin/abogada | Sin cambios — verificado |

El tab entero era el agujero real: el botón de *registrar* gasto ya estaba oculto, pero el
asistente podía **ver** todos los montos, pagos y balances del caso.

### 3. Guards en el backend — la parte que importa

Ocultar el menú no es un permiso. Se usó el helper que ya existía (`requireRole` en
`src/lib/supabase/server-query.ts`), sin crear uno nuevo.

| Endpoint | Estado previo | Ahora |
|---|---|---|
| `POST /api/expenses` | **NO validaba rol en absoluto** — cualquier rol autenticado podía crear un gasto llamando la API directa | `requireRole(["admin","abogada"])` → 403 |
| `PATCH /api/expenses/[id]` | Ya rechazaba al asistente con un `if` a mano | Mismo efecto, ahora vía `requireRole` |
| `DELETE /api/expenses/[id]` | Ídem | Ídem |
| `PATCH /api/cases/[id]` | Gate DEPENDIENTE DE LA ACCIÓN: `change-status` admitía `asistente` | `requireRole(["admin","abogada"])` para TODA acción |
| `POST /api/documents/register` | admin/abogada/asistente | **Sin tocar** — el asistente sigue subiendo documentos |
| `POST /api/comments` | admin/abogada/asistente | **Sin tocar** — el asistente sigue comentando |

`POST /api/expenses` era el **hallazgo #3 de la revisión OWASP** del proyecto (autorización por
rol inconsistente en `/api`). Queda cerrado para gastos.

**Test actualizado, no borrado.** `src/app/api/cases/__tests__/patch-role-by-action.test.ts`
cubría el gate por acción; ahora afirma lo contrario (asistente + `change-status` → 403) y
sigue siendo la red que evita que el permiso vuelva por accidente. **4/4 pasan.**

### 4. Documentación

- **`CLAUDE.md` §4 reescrito.** Su tabla decía que el asistente "registra gastos" y "actualiza
  estado" — contradecía el alcance nuevo, y el archivo se lee al inicio de cada sesión: sin
  esto, el permiso volvía solo. Se agregó además una nota de que los permisos se hacen cumplir
  en middleware + `requireRole`, no en `nav-config.ts`.
- `sop.md`: alcance nuevo + tabla de en qué capa vive cada restricción (UI / ruta / API).
- `productdesign.md`: F-002, F-003, F-007 y el perfil de usuario "Asistentes".

### 5. SQL incluido como registro

`sql/pending/fix-duplicate-statuses-2026-08-23.sql` entra en este commit **solo como registro
histórico**. Documenta la limpieza de `cat_statuses` (7 filas activas donde debían ser 2)
**que Oliver ya aplicó en producción el 23/08/2026**. NO se ejecutó nada desde acá.

**Migraciones: NINGUNA.**

### Verificación

| Check | Resultado |
|---|---|
| `tsc --noEmit` | limpio (exit 0) |
| Lint de los 8 archivos tocados | 0 errores nuevos. Quedan 3 preexistentes en `casos/[id]/page.tsx` (`Upload`, `Button`, `backUrl` sin usar) |
| Test `patch-role-by-action` | **4/4 pasan** |

### Verificación en navegador (24/08/2026, `localhost:3000`, Chrome)

**Sesión ASISTENTE (Harry Boyd)**

| Check | Resultado |
|---|---|
| Menú lateral | Solo 3 destinos: `/legal`, `/legal/casos`, `/legal/pendientes` |
| `/legal/gastos` a mano | Rebota a `/legal` |
| Tabs del detalle de caso | Información · Seguimiento · Documentos (sin "Gastos") |
| Botones del detalle | Volver, Imprimir Tarjeta, Etiqueta Simple. Sin "Cambiar Estado", sin "Editar Información", sin "Eliminar caso" |
| `?tab=gastos` a mano | Cae en Información. Cero menciones a "Gastos" y cero montos `B/.` |
| Comentar / subir documentos | Ambos presentes y operativos |
| `/legal/pendientes` | Carga sin rebote |

**Guards de API probados en vivo con la sesión del asistente** (no solo UI):

| Llamada | Resultado |
|---|---|
| `POST /api/expenses` (gasto válido) | **403 `Sin permiso`** |
| `PATCH /api/cases/{id}` con `action:"change-status"` | **403 `Sin permiso`** |
| `PATCH /api/cases/{id}` edición normal | **403 `Sin permiso`** |
| `PATCH /api/expenses/{id}` | **403 `Sin permiso`** |
| `DELETE /api/expenses/{id}` | **403 `Sin permiso`** |
| `POST /api/comments` | **400** "Faltan campos requeridos" → pasó el gate de rol |
| `POST /api/documents/register` | **400** "Faltan campos requeridos" → pasó el gate de rol |

Los dos últimos se mandaron con body vacío A PROPÓSITO: un 400 prueba que el gate de rol los
dejó pasar SIN escribir nada en la base de producción (dev y prod comparten Supabase).

**Sesión ADMIN (Oliver Calvo) — regresión**

| Check | Resultado |
|---|---|
| Menú lateral | Los 9 destinos, `/legal/gastos` incluido |
| `/legal/gastos` | Carga el Balance General completo (207 de 207 casos) |
| Tabs del detalle | Información · **Gastos** · Seguimiento · Documentos |
| Botones del detalle | "Cambiar Estado", "Eliminar caso", "Editar Información" y los 4 de gasto/pago |
| `PATCH` con `action:"change-status"` | **200**, y el caso quedó en "En trámite" tras recargar |
| Consola | Sin errores en ninguna de las dos sesiones |

El PATCH de admin se hizo reasignando el MISMO estado que el caso ya tenía, para probar el
camino 200 sin alterar datos reales.

### Pendiente de decisión — CERRADO el mismo día

En el tab Seguimiento el asistente seguía viendo **"+ Nueva Tarea para Asistente"**. Oliver
decidió retirárselo: ver la entrada `[FEAT] 2026-08-24 (2)` al inicio de este archivo.

## [FIX] - 2026-08-22 - Panel del asistente, selector de abogada por rol y retiro de `assistant_id` de la UI

Branch `develop`. Tres cambios encadenados alrededor del rol asistente. Los dos primeros son
arreglos; el tercero es una decisión de negocio que llegó después y que borra el campo de la
interfaz.

### 1. El panel del asistente mentía

**Síntoma:** el asistente entraba a `/legal` y veía `0 / 0 / 0`, y concluía que el sistema
no le mostraba nada.

**Causa:** la tarjeta principal era "Casos Asignados" y contaba `cases.assistant_id = usuario`.
Ninguno de los 206 casos tiene asistente asignado, así que daba 0. Pero el alcance de lectura
del asistente es TODO el bufete (CLAUDE.md §4) y `/legal/casos` nunca filtró por `assistant_id`:
el listado le mostraba los 206. El panel y el listado se contradecían.

**Arreglo** (`src/components/dashboards/asistente-home.tsx`): la tarjeta "Casos Asignados" pasa a
ser **"Casos del Bufete"** y cuenta todo el tenant, sin filtrar. Subtítulo "Tus casos y tareas
asignadas" → "Casos del bufete y tus tareas". "Tareas Pendientes" y "Tareas Cumplidas" no cambian:
siguen filtrando por `tasks.assigned_to`. De paso el componente pasó de `createClient()` +
`auth.getUser()` a `getAuthenticatedContext()`, que es el patrón del resto de las pantallas
(cliente admin + filtro explícito por `tenant_id`), con las consultas en un solo `Promise.all`.

### 2. El selector de "Abogada Responsable" listaba roles equivocados

**Síntoma:** el select ofrecía los 6 usuarios activos, incluidos el admin y el contador.

| Archivo | Qué pasaba | Qué se hizo |
|---|---|---|
| `src/app/legal/casos/[id]/page.tsx` | El select del editor inline recibía `users={allUsers}` (todos los roles) | Se deriva `abogadaOptions` desde `allTeam` (que ya traía `role`) y se pasa como prop `responsibleOptions` |
| `src/components/cases/inline-case-editor.tsx` | El select mapeaba `users` | Prop nueva `responsibleOptions`; con lista vacía la opción "Sin responsable" se muestra igual |
| `src/app/legal/casos/[id]/editar/page.tsx` | La query de `users` **no traía `role`** | Se agregó `role` al `select` y al `.map()` |
| `src/components/cases/case-form.tsx` | `abogadas = team.filter(t => t.role === "abogada" \|\| !t.role)` | Se quitó el fallback `!t.role` |

**El bug de verdad estaba en editar caso.** Sin `role` en la query, el fallback `!t.role` metía a
TODO el equipo en el selector de abogadas. En crear caso (`/legal/casos/nuevo`) la query sí traía
`role`, así que ahí ya funcionaba bien.

**NO se tocó** `users={allUsers}` de `AddTaskForm`: una tarea sí puede asignarse a cualquier usuario.

### 3. `cases.assistant_id` sale de la interfaz

**Decisión de negocio.** Si el asistente ve todos los casos del bufete, asignar un asistente por
caso no aporta. Los 206 casos tenían el campo vacío, así que no había datos que perder.

**La columna SIGUE en la BD.** Regla aditiva del proyecto: nada de dropear columnas. **Migraciones:
NINGUNA.** El cambio es enteramente de UI y de consultas de lectura, y por lo tanto reversible: si
mañana lo quieren de vuelta, no hay migración que correr.

| Archivo | Qué se quitó |
|---|---|
| `src/components/cases/inline-case-editor.tsx` | Select "Asistente Responsable de Seguimiento", estado `assistantId`, `assistant_id` del payload, prop `assistantOptions` |
| `src/components/cases/case-form.tsx` | Campo "Asistente Responsable" (crear y editar), estado, payload, y la derivada `asistentes` |
| `src/app/legal/casos/[id]/page.tsx` | Bloque de display "Asistente Responsable de Seguimiento", el fetch del usuario asistente, `assistant_id` del `select`, `asistenteOptions`, y el icono `Users` que quedaba sin uso |
| `src/app/legal/casos/[id]/editar/page.tsx` | `assistant_id` de `initialData` |
| `src/app/legal/casos/page.tsx` | Columna "Asistente" de la tabla desktop (`<th>`, `<td>`, `colSpan` 8 → 7) y de las tarjetas móviles. `userMap` ahora solo resuelve `responsible_id` |
| `src/components/dashboards/asistente-gastos.tsx` | El `.or()` con `assistant_id.eq.{user}` + casos con tareas suyas. Ahora ofrece **todos los casos del tenant**, coherente con su alcance de lectura |
| `src/lib/utils/search-server.ts` | `pushByRelation("assistant_id", ...)` de la búsqueda universal |
| `src/app/api/cases/[id]/route.ts` | `assistant_id` del destructuring del body y del `updatePayload`: el PATCH deja de aceptarlo |

**Se conserva `assistant_id` en `trackedFields`** del PATCH — decisión explícita. Esa lista es de
campos **auditables**, no de campos aceptados. Como el handler ya no lo lee del body, nunca entra
en `updatePayload` y el filtro `!== undefined` no lo dispara: cero costo. Pero si el campo vuelve a
la UI, o alguien lo toca por SQL o por un script, el historial lo registra sin que haya que
acordarse de volver a agregarlo. Mismo criterio para `src/types/database.ts`, que sigue declarando
la columna porque sigue existiendo en el schema.

**NO se tocó `src/app/legal/seguimiento/page.tsx`.** Se verificó: su prop `assistants` es la lista
de usuarios con rol `asistente` para poblar un filtro, y el filtro compara contra
`task.assignedTo` (`tasks.assigned_to`), no contra `cases.assistant_id`. No depende del campo
retirado.

### Verificación

| Check | Resultado |
|---|---|
| `tsc --noEmit` | limpio (exit 0) |
| Lint de los 9 archivos tocados | **0 errores nuevos**. Quedan 4 preexistentes (`Upload`, `Button`, `backUrl` sin usar en el detalle; un `prefer-const` en el listado), idénticos antes y después del cambio — verificado con `git stash`. Sí se arregló uno preexistente en `inline-case-editor.tsx` (destructuring muerto de `team`), por estar en una línea que se estaba editando |
| Búsqueda de huérfanos | `grep -rn "assistant_id\|assistantId\|assistantOptions\|assistantName" src/` → solo los 3 usos intencionales (comentario del PATCH + `trackedFields`, comentario en gastos, `types/database.ts`) |

### Verificación en navegador (23/08/2026, `localhost:3000`, Chrome)

Dos tandas con sesiones reales, no simuladas. Oliver hizo los logins.

**Sesión ASISTENTE (Harry Boyd)**

| Pantalla | Check | Resultado |
|---|---|---|
| `/legal` | Tarjeta principal | **"Casos del Bufete" = 207** (antes "Casos Asignados" = 0) |
| `/legal` | 3 tarjetas con hints | "Todos los casos" / "Asignadas a mí" / "Asignadas a mí" |
| `/legal` | Subtítulo | "Casos del bufete y tus tareas" |
| `/legal/casos` | Total | "207 casos encontrados" — **panel y listado por fin coinciden**, que era el bug de fondo |
| `/legal/casos` | Tabla desktop | 7 columnas: Código, Cliente, Descripción, Estado, Abogada, Clasificación, Apertura. Sin "Asistente" |
| `/legal/casos` | Tarjetas móviles | Por DOM: `Abogada:` ×20, `Asistente:` ×0 |
| `/legal/gastos` | Copy | "Gastos que has registrado en los casos del bufete" |
| `/legal/gastos` | Selector de caso | **207 opciones** en `gasto-case-select` (`ADM-001` … `REG-010`), idéntico al total del listado |

**Sesión ADMIN (Oliver Calvo)**

| Pantalla | Check | Resultado |
|---|---|---|
| `/legal/casos/{id}` (detalle CIV-020) | Display de asistente | **0 ocurrencias** de "Asistente" en todo el HTML |
| `/legal/casos/{id}` editor inline | "Abogada Responsable" | 4 opciones: Sin responsable + **Daveiva Chapman, Legal Integra, Milena Batista**. Sin admin ni contador |
| `/legal/casos/{id}` editor inline | Campo de asistente | No existe. Labels: Descripción, Observaciones, Clasificación, Institución, Abogada Responsable, Tipo de trámite, 4 fechas, 2 N° institución, Ubicación, Expediente digital |
| `/legal/casos/{id}/editar` (paso 2 de 4) | "Abogada Responsable" | Mismas 4 opciones. **Acá estaba el bug del `role` faltante — confirmado corregido** |
| `/legal/casos/nuevo` (paso 2 de 4) | "Abogada Responsable" | Mismas 4 opciones. Pasos 1, 3 y 4 recorridos: ningún campo de asistente |
| **Guardado (el check que importa)** | PATCH + persistencia | Editor inline de CIV-020, campo Observaciones: **`PATCH /api/cases/{id} 200 in 2787ms`**, dato persistido tras recargar. Revertido a vacío con un segundo **`PATCH 200 in 1765ms`**, confirmado que el marcador desapareció |
| Consola del navegador | Errores | Ninguno |
| Efectos colaterales | Casos creados/borrados | Ninguno: el listado seguía en 207 al terminar. El wizard de `/legal/casos/nuevo` se abandonó sin guardar |

**Nota sobre datos:** son **207** casos, no 206 — se cargó `CIV-020` el 22/08/2026. Y como dev y
prod comparten Supabase, el test de guardado escribió en datos reales: se usó un campo libre
(Observaciones) de un solo caso y se dejó como estaba.

**Observaciones menores, sin acción:** (1) las queries de `/legal/casos/nuevo` y
`/legal/casos/[id]/editar` siguen trayendo usuarios con rol `asistente` en `team` aunque ahora
solo se usan los `abogada` — no molesta, pero es peso muerto. (2) El select "Estado" muestra
"En trámite"/"Cerrado" por triplicado: son filas duplicadas en `cat_statuses`, preexistente y
ajeno a este cambio.

**Migraciones: NINGUNA.**


## [DEPLOY] - 2026-08-15 19:52 UTC - develop → main (2 commits)

**Merge:** `fd0bf88` · **Punto de rollback:** `9f8f243` · **Aprobado por:** Oliver

### Qué salió

| Commit | Qué |
|---|---|
| `f7f978c` | Recuperación de contraseña por `token_hash` en vez de PKCE (cross-device) |
| `d194f75` | Log del deploy de las 18:43 UTC (docs) |

**Salieron 2 commits, no 1.** `d194f75` es el deploy log del release anterior, que quedó en
`develop` después de aquel merge — el mismo patrón que `9aab6ca` en el deploy del 14/08. Es solo
`changelog.md`, sin código.

**Migraciones: NINGUNA.** Verificado con
`git diff --name-only origin/main origin/develop | grep -iE "\.sql$|migration|supabase/"` → vacío.

**Acompaña un cambio de configuración ya hecho por Oliver:** la plantilla de email "Reset Password"
en Supabase pasó a `{{ .SiteURL }}/auth/recuperar?token_hash={{ .TokenHash }}&type=recovery`. El
código de este deploy es la otra mitad del arreglo; sin la plantilla no sirve, y sin el código la
plantilla tampoco.

### Pre-deploy (SOP-006)

| Check | Resultado |
|---|---|
| Suite completa | **292/292 verde** (283 + 9 del archivo suelto), 0 fail |
| `tsc --noEmit` | limpio (exit 0) |
| `next build` local | **exitoso**. `/api/auth/reset-password` y `/auth/recuperar` compilan como route handlers dinámicos (ƒ) |
| Lint | 22 errores + 5 warnings, **todos preexistentes**, **0 en los archivos del release** |
| Diff review | 5 archivos, +303/-25. Sin SQL, sin scratch, sin secretos. Los 2 `console.warn` nuevos loguean `error.message` y un booleano de diagnóstico — sin tokens ni correos |
| Migraciones en prod | ninguna que aplicar |
| Changelog | actualizado |

**Verificación previa al merge:** `main` no era ancestro de `develop` (11 merge commits solo en
main, todos merge commits, ningún hotfix suelto) → `--no-ff`. `merge-tree` sin conflictos, y el
**árbol del merge idéntico al de `develop`** (`da076224…`).

### Deploy

- Push a `origin/main` **19:52:28 UTC**.
- Código nuevo en vivo **19:53:42 UTC** (~1 min).
- **Marcador usado:** `/auth/recuperar?token_hash=falso&type=recovery` daba `?error=recovery` con el
  código viejo (que solo miraba `code`) y pasa a `?error=recovery_expired` con el nuevo (verifyOtp
  rechaza el token). Solo lo puede producir el código nuevo.
- El "Ready" se verificó contra la URL de producción, no en el dashboard de Vercel (cuenta del
  cliente, sin acceso).

### Post-deploy smoke (producción)

| Check | Resultado |
|---|---|
| `/auth/recuperar` sin parámetros | **307 → `/login?error=recovery`** |
| `/auth/recuperar?token_hash=falso&type=recovery` | **307 → `/login?error=recovery_expired`** |
| `/nueva-contrasena` sin sesión | **307 → `/login`** |
| `/auth/recuperar?code=FAKE` | 307 → `/login?error=recovery_otro_navegador` (rama heredada viva) |
| `/login` | 200 |
| `POST /api/auth/reset-password` con email inválido | 400 |
| `/finanzas/reportes/balance` | 307 al login (el release anterior sigue sano) |
| Avisos del login | los tres textos salen server-rendered, incluido el nuevo `recovery_otro_navegador` |

Sin un solo 500.

**Pendiente de Oliver (cierra el caso):** el round-trip real — pedir el reset en la computadora y
abrir el correo en el celular. Es el escenario que estaba roto y que no se puede verificar sin una
casilla de correo real.

---

## [Fix] - 2026-08-15 - Recuperación de contraseña: pasar de PKCE a token_hash (cross-device)

El deploy de esta mañana dejó el flujo llegando a `/auth/recuperar`, pero el canje fallaba y la
persona terminaba en `/login?error=recovery`. Enlace real del correo (token ya gastado):

```
https://<proyecto>.supabase.co/auth/v1/verify?token=pkce_8fc1f1ea…&type=recovery
  &redirect_to=https://crm-integra-legal.vercel.app/auth/recuperar
```

### La causa, y por qué la plantilla sola NO alcanzaba

El prefijo **`pkce_`** lo pone **quien PIDE el reset**, no la plantilla de email. El login llamaba
`resetPasswordForEmail` con el **browser client**, que usa flujo PKCE: supabase-js guarda un
`code_verifier` local y GoTrue almacena el token prefijado. Al hacer clic, `/auth/v1/verify`
redirige con `?code=…`, y ese code **solo se puede canjear con el verifier del navegador que
inició el reset**. Correo abierto en el celular = imposible.

Confirmado con dos pruebas:

1. `admin.auth.admin.generateLink({ type: "recovery" })` (server-side, sin PKCE) devuelve
   `hashed_token = b058b1cf…` — **token plano, sin prefijo**. El del correo traía `pkce_8fc1…`.
   La diferencia está en el cliente que lo pide.
2. El log del servidor ante un `?code=` sin verifier lo dice con las palabras de Supabase:
   *"PKCE code verifier not found in storage. This can happen if the auth flow was initiated in a
   different browser or device."*

**Conclusión operativa:** cambiar la plantilla a `{{ .TokenHash }}` sin sacar el PKCE del pedido
habría renderizado `pkce_8fc1…` dentro del `token_hash`, y `verifyOtp` habría seguido fallando.
Hacían falta las dos mitades.

### Qué se cambió

| Archivo | Qué |
|---|---|
| `src/app/api/auth/reset-password/route.ts` (nuevo) | Pide el correo desde el SERVIDOR con `flowType: "implicit"` → el token del email sale plano. Responde `{ ok: true }` exista o no el usuario (no permite enumerar cuentas) |
| `src/app/auth/recuperar/route.ts` | Ahora acepta `?token_hash=…&type=recovery` y lo verifica con `verifyOtp` — **sin `code_verifier`, sin continuidad de navegador**. Mantiene la rama `?code=` para los correos ya enviados |
| `src/components/auth/login-form.tsx` | El botón hace `POST /api/auth/reset-password` en vez de llamar a Supabase directo |
| `src/app/(auth)/login/page.tsx` | Aviso nuevo `recovery_otro_navegador` para el caso PKCE heredado |

**Efecto lateral bueno:** pedir el reset por un endpoint propio crea el chokepoint que faltaba para
el rate limiting de Seguridad Fase 0 punto A. Antes la llamada iba del browser directo a Supabase y
no había dónde contar.

La rama `?code=` se puede borrar cuando no queden correos viejos circulando (el token de
recuperación caduca a las 24 h por defecto).

### ⚠️ REQUIERE cambio en el dashboard de Supabase (lo hace Oliver)

**Authentication → Emails → Templates → "Reset Password"**, reemplazar el `href` del botón por:

```html
<a href="{{ .SiteURL }}/auth/recuperar?token_hash={{ .TokenHash }}&type=recovery">
  Restablecer contraseña
</a>
```

Lo que importa es que el enlace deje de usar `{{ .ConfirmationURL }}` y pase a
`token_hash` + `type=recovery` apuntando a `/auth/recuperar`.

Verificar además **Authentication → URL Configuration → Site URL** =
`https://crm-integra-legal.vercel.app`. Con esta plantilla el enlace se arma con el Site URL y ya
NO pasa por `/auth/v1/verify?redirect_to=…`, así que la allowlist de Redirect URLs deja de
intervenir en este flujo (las entradas que ya cargó siguen sirviendo para los correos viejos que
todavía usan la rama `?code=`).

**Alternativa** si alguna vez se quiere que los correos de localhost apunten a localhost: usar
`{{ .RedirectTo }}` en lugar de `{{ .SiteURL }}`. Funciona porque el endpoint siempre manda el
`redirectTo`, pero un correo disparado desde el dashboard (que no manda ninguno) generaría un
enlace roto. Para probar en local sin correos conviene `generateLink`, como se hizo acá.

### Verificación — 15/08/2026

Prueba de punta a punta con un `token_hash` REAL de la cuenta `contador.test@integra-panama.com`,
generado con `generateLink` (sin enviar correo) y consumido **desde `curl`** — es decir, sin
`code_verifier`, sin cookies previas y sin ningún estado del navegador que lo pidió: exactamente el
escenario "otro dispositivo" que estaba roto.

| Caso | Resultado |
|---|---|
| `?token_hash=<real>&type=recovery` | **307 → `/nueva-contrasena`** + cookie de sesión. El JWT decodifica al usuario correcto (`contador.test`, `user_role: contador`) |
| `/nueva-contrasena` con esa sesión | **HTTP 200** — la pantalla carga y la excepción del gating por rol funciona también para `contador` |
| Reusar el mismo token | 307 → `/login?error=recovery_expired` (un solo uso, confirmado) |
| `?token_hash=novale` / `?token_hash=pkce_…` | 307 → `/login?error=recovery_expired` |
| `?code=FAKE123` | 307 → `/login?error=recovery_otro_navegador` |
| sin parámetros | 307 → `/login?error=recovery` |
| `?error=…&error_code=otp_expired` | 307 → `/login?error=recovery_expired` |
| `POST /api/auth/reset-password` email inválido / sin body | 400 |
| `POST` con email inexistente | 200 `{"ok":true}` — sin filtrar si la cuenta existe |

**NO se cambió ninguna contraseña** y **no se envió ningún correo**: la cuenta de prueba solo quedó
con el `last_sign_in_at` actualizado. El clic real en el botón del login tampoco se ejecutó (habría
mandado un correo de verdad); el endpoint que consume está verificado por separado.

`tsc --noEmit` limpio · suite **292/292 verde** · `next build` exitoso (`/api/auth/reset-password` y
`/auth/recuperar` compilan como route handlers dinámicos) · lint sin cambios (22 preexistentes, 0 en
estos archivos).

**Pendiente de Oliver:** cambiar la plantilla y después probar el round-trip real — pedir el reset
en la computadora y abrir el correo en el celular, que es el caso que hoy falla.

---

## [DEPLOY] - 2026-08-15 18:43 UTC - develop → main (4 commits)

**Merge:** `9f8f243` · **Punto de rollback:** `060fed7` · **Aprobado por:** Oliver

### Qué salió

| Commit | Qué |
|---|---|
| `8a084bf` | Filtro "solo cuentas con saldo" en Balance General y Estado de Resultado |
| `198013e` | DV en su propio renglón, separado del RUC, en la ficha de cliente |
| `5203c24` | Recuperación de contraseña arreglada (Seguridad Fase 0 B): `/auth/recuperar` + `/nueva-contrasena`, fix del `redirectTo` y del gating del middleware, avisos del login |
| `9aab6ca` | Log del deploy anterior (docs) |

**Migraciones: NINGUNA.** Deploy 100% de código — verificado con
`git diff --name-only origin/main origin/develop | grep -iE "\.sql$|migration|supabase/"` → vacío.
No se tocó nada en Supabase.

### Pre-deploy (SOP-006)

| Check | Resultado |
|---|---|
| Suite completa de tests | **292/292 verde**, 0 fail (283 + 9 del archivo suelto de cancel-invoice-dialog) |
| `tsc --noEmit` | limpio (exit 0) |
| `next build` local | **exitoso** (`✓ Compiled successfully`, exit 0). `/auth/recuperar` compila como route handler dinámico (ƒ) y `/nueva-contrasena` como estática (○) — correcto: el gate lo pone el middleware |
| Lint | 22 errores + 5 warnings, **todos preexistentes**; **0 en los archivos de este release**. `next.config` tiene `eslint.ignoreDuringBuilds` → no bloquean |
| Diff review | limpio: sin secretos, sin claves, sin endpoints de debug, sin scripts scratch. El único `console` nuevo loguea `error.message` de Supabase (sin token ni code) |
| Migraciones en prod | ninguna que aplicar |
| Config de Supabase | Redirect URLs de `/auth/recuperar` (localhost + prod) ya cargadas por Oliver |
| Changelog | actualizado |

**Verificación previa al merge:** `main` NO era ancestro de `develop` (10 merge commits viven solo
en main, patrón normal del repo) → merge `--no-ff`, que además es la palanca de rollback. Se
comprobó con `merge-tree` que no había conflictos, que los 10 commits únicos de main son TODOS
merge commits (ningún hotfix suelto que se perdiera), y que **el árbol del merge es idéntico al de
`develop`** (`991012af…` en ambos): producción quedó exactamente con el código probado.

### Deploy

- Push a `origin/main` **18:43:40 UTC** → auto-deploy disparado.
- Código nuevo detectado en vivo en producción a las **18:45:49 UTC** (~2 min).
- Marcador usado para detectar el deploy: antes `/auth/recuperar` redirigía a `/login` pelado
  (ruta inexistente, la agarraba el gate de rutas protegidas); después redirige a
  `/login?error=recovery`, que solo puede producir el código nuevo.
- **Nota:** el "Ready" se verificó contra la URL de producción, no en el dashboard de Vercel (es
  la cuenta del cliente y no tengo acceso). El ID del deployment y el target de rollback en
  Vercel los tiene que sacar Oliver del dashboard si alguna vez hace falta.

### Post-deploy smoke (producción, `crm-integra-legal.vercel.app`)

Sin sesión: `/login` 200 · `/api/health` 401 (el gate, no un 500) · `/finanzas/reportes/balance`,
`/finanzas/reportes/pyl`, `/legal/clientes` y `/nueva-contrasena` → 307 al login · sin un solo 500.

| Check | Resultado |
|---|---|
| (a) `/finanzas/reportes/balance` | **OK — EL BALANCE CUADRA.** Activo 257,902.46 y Pasivo+Patrimonio -257,902.46. El descuadre de 10,000.00 del 15/08 desapareció al borrar Oliver la cuenta de prueba `100006 PRUEBA` |
| (a) Toggle en el Balance | **OK** — default "solo con saldo" con "10 cuenta(s) en 0 ocultas"; al pasar a "todas" aparecen las 10 y los grupos "Propiedad, planta y equipo" y "Pasivo no corriente". **Los 5 totales IDÉNTICOS entre vistas** |
| (b) `/finanzas/reportes/pyl` | **OK** — "30 cuenta(s) en 0 ocultas"; los **7 totales IDÉNTICOS** entre vistas: Ingresos -289,137.06 · Costos 9,878.38 · Bruta -279,258.68 · Gastos 34,781.77 · Operativa -244,476.91 · ISR 61,119.23 · Neta -183,357.68. Coinciden exactamente con los del deploy del 14/08 |
| (c) Ficha de cliente (CLI-001) | **OK** — "RUC / CÉDULA 2676824-1-844561" y debajo "DÍGITO VERIFICADOR (DV) 85", en renglones separados |
| (d) `/auth/recuperar` | **OK** — sin code → `/login?error=recovery`; con `error_code=otp_expired` → `/login?error=recovery_expired` |
| (d) `/nueva-contrasena` | **OK** — renderiza con sesión (confirma la excepción del gating por rol) y redirige al login sin ella |
| (d) Avisos del login | **OK** — los tres textos salen server-rendered en prod con `?error=recovery_expired`, `?error=recovery` y `?expired=true` |

Sin errores de consola en ninguna de las páginas verificadas.

**Nota de alcance del smoke:** NO se ejecutó el round-trip completo de recuperación con un correo
real, ni se envió el formulario con una contraseña válida — habría cambiado la contraseña real de
Oliver. Eso lo cierra él. Todo lo demás se verificó directo contra la URL de producción.

---

## [Fix/Seguridad] - 2026-08-15 - Recuperar contraseña: el flujo ahora existe (Fase 0, punto B)

Diagnóstico previo: el botón "¿Olvidaste tu contraseña?" mandaba un correo real que **no
servía para nada**. Dos fallas encadenadas:

1. **El link apuntaba a una ruta inexistente.** `redirectTo` era `/auth/callback`; la ruta real
   del proyecto es `/api/auth/callback`. Sin página ni rewrite, el middleware lo trataba como
   ruta protegida, veía que no había sesión y lo mandaba al login. Verificado:
   `/auth/callback?code=FAKE` → 307 a `/login?code=FAKE123`.
2. **No existía dónde escribir la contraseña nueva.** Cero ocurrencias de `auth.updateUser()`
   en todo `src/`, y cero de `PASSWORD_RECOVERY`. Aunque el link hubiera llegado bien,
   `/api/auth/callback` canjea el código y redirige a `/`: **el correo de recuperación
   simplemente logueaba a la persona sin pedirle contraseña nueva**.

### Qué se construyó

| Archivo | Qué hace |
|---|---|
| `src/app/auth/recuperar/route.ts` (nuevo) | Aterrizaje del link. Canjea el `code` por sesión y manda a `/nueva-contrasena`. Distingue el link vencido (`?error=...&error_code=otp_expired`, que es lo que manda Supabase) del código inválido |
| `src/app/(auth)/nueva-contrasena/page.tsx` (nuevo) | Pantalla con la identidad navy/gold del login |
| `src/components/auth/new-password-form.tsx` (nuevo) | Dos campos (nueva + repetir), `updateUser({ password })`, mínimo 8 caracteres — la misma regla que el alta de usuarios. Mensaje específico si la sesión de recuperación venció mientras completaba el form |
| `src/middleware.ts` | Dos excepciones nuevas (ver abajo) |
| `src/components/auth/login-form.tsx` | `redirectTo` → `/auth/recuperar`, con el comentario de por qué NO es `/auth/callback` |
| `src/app/(auth)/login/page.tsx` | Muestra los avisos que llegan por query string |

**La pantalla sirve para los dos caminos:** recuperación por email y cambio voluntario de la
propia contraseña estando logueado. Antes no había ninguna forma de cambiarse la contraseña
sin pedirle al admin que la resetee.

### Las dos trampas del middleware (documentadas en SOP-011)

1. **`/auth/recuperar` va exceptuada ANTES del bloque de rutas públicas.** Ese bloque rebota a
   `/` a cualquier usuario **con** sesión: alguien con la sesión viva que pide recuperar su
   contraseña nunca llegaría a canjear el código. Por eso es ruta propia y no `/api/auth/*`.
2. **`/nueva-contrasena` va exceptuada ANTES de resolver el rol.** `ROLE_ROUTES` solo permite
   `/`, `/legal` y `/finanzas`, y `"/"` matchea EXACTO — una ruta nueva de primer nivel no
   matchea ningún prefijo y el usuario sale rebotado a su home sin ver nada. Además, un usuario
   sin rol en el JWT tiene que poder arreglar su contraseña igual.

Se agregó **SOP-011** en `sop.md` para que la próxima ruta de primer nivel no repita el error.

### De paso: los avisos del login que nunca se mostraban

El middleware ya mandaba `?expired=true` y `?error=no-role`, y el callback `?error=auth`, pero
la pantalla de login los ignoraba: el usuario volvía al login sin ninguna explicación. Ahora se
muestran, incluidos los dos nuevos de recuperación. Se leen en el server component y se pasan
como prop (en vez de `useSearchParams`), para no necesitar un `Suspense` boundary.

### Verificación — 15/08/2026

Ruteo (`curl`, sin sesión):

| URL | Resultado |
|---|---|
| `/auth/recuperar` (sin code) | 307 → `/login?error=recovery` |
| `/auth/recuperar?code=FAKE123` | 307 → `/login?error=recovery` (el canje falla) |
| `/auth/recuperar?error=access_denied&error_code=otp_expired` | 307 → `/login?error=recovery_expired` |
| `/nueva-contrasena` sin sesión | 307 → `/login` |

Avisos server-rendered en `/login`: los tres textos salen en el HTML con
`?error=recovery_expired`, `?error=recovery` y `?expired=true`; sin parámetro no aparece nada.

Navegador (localhost:3000, admin): `/nueva-contrasena` **renderiza con sesión** (confirma que la
excepción del gating por rol funciona), contraseña de 6 caracteres → "La contraseña debe tener al
menos 8 caracteres", contraseñas distintas → "Las dos contraseñas no coinciden". Consola limpia.

**Lo que NO se probó y por qué:** el canje de un código REAL de email. Exige dispararle un correo
de recuperación a un usuario real y leer su bandeja. Queda para Oliver, después de cargar la
Redirect URL en Supabase. `tsc --noEmit` limpio, suite **292/292 verde**, lint sin cambios (22
errores preexistentes, ninguno en los archivos de este cambio).

### ⚠️ Requiere acción en el dashboard de Supabase (sin esto NO funciona)

Authentication → URL Configuration → **Redirect URLs**:

```
http://localhost:3000/auth/recuperar
https://crm-integra-legal.vercel.app/auth/recuperar
```

Si la URL no está en la allowlist, Supabase **ignora el `redirectTo` y usa el Site URL**, y el
correo vuelve a no servir. La ruta se eligió sin query string justamente para que la entrada de
la allowlist sea exacta, que es lo que Supabase recomienda para producción.

### Pendiente de esta fase (no entra acá)

- Rate limiting (punto A del diagnóstico): login por endpoint propio + límite en `/api/public/*`.
- Rotación de contraseñas (punto C): ahora es viable, porque ya existe la pantalla de cambio.
- `updateUser` **no cierra las otras sesiones** del usuario. Si la contraseña se cambió porque se
  sospecha de un acceso indebido, hay que revocar las sesiones aparte (`auth.admin.signOut`).
- Sin test unitario del middleware: probar sus ramas exige mockear toda la cadena de
  `@supabase/ssr`. Hoy la garantía son las pruebas de ruteo de arriba, más SOP-011. Si el flujo
  se vuelve a romper, va a ser por acá.

---

## [Feature] - 2026-08-15 - Ficha de cliente: el DV en su propio renglón, separado del RUC

Pedido de Josuar: que el dígito verificador se vea como un campo aparte, debajo del RUC.

### Estado que había (revisado antes de tocar nada)

- **Formulario (`client-form.tsx`): ya estaba bien.** `ruc` y `digito_verificador` son dos
  inputs distintos desde los campos fiscales FE. El de RUC hasta avisa en su placeholder
  ("RUC completo, sin el DV") y en el hint que "el DV va aparte, en su propio campo". El
  input de DV aparece cuando `tipo_receptor_fe` es 01 o 03, que es donde la DGI lo exige
  (`tipoRequiresDV`). **No hizo falta cambiar nada acá.**
- **Ficha de detalle (`legal/clientes/[id]/page.tsx`): el DV NO se mostraba.** Había un solo
  renglón, "RUC / Cédula", con el valor de `ruc`. Lo que se veía "junto" era otra cosa: en
  los clientes que todavía tienen el DV embebido en el texto del RUC, el renglón mostraba
  `25046169-3-2021  DV 40` como si fuera el número. La columna `digito_verificador` no
  aparecía en ninguna parte de la ficha.

### Qué se cambió

Un renglón nuevo **"Dígito verificador (DV)"** justo debajo de "RUC / Cédula" en la tarjeta
Información del Cliente. Los tres estados posibles:

| Situación | Qué muestra |
|---|---|
| DV cargado | El dígito (ej. `85`) |
| `tipo_receptor_fe` = 02 o 04 | `No aplica` — la DGI no lo pide para consumidor final ni extranjero |
| DV vacío con tipo 01/03 **o con tipo NULL** | `—` (falta el dato) |

El tercer caso es el que importa: con `tipo_receptor_fe` en NULL el DV es **desconocido, no
inaplicable**. La primera versión de este cambio usaba `tipoRequiresDV()` y mostraba "No
aplica" cuando el tipo era NULL — lo cual escondía justo los clientes a los que les falta el
DV (CLI-026 aparecía como "No aplica" teniendo el 40 metido dentro del RUC). Se corrigió
antes de commitear: "No aplica" solo con 02/04 explícito.

Cero cambios en emisión eFactura, en el mapeo `ruc`/`tax_id` y en el formulario.

### Verificación en navegador (localhost:3000, rol admin) — 15/08/2026

| Cliente | Caso | Resultado |
|---|---|---|
| CLI-001 JUMBO CAPITAL (tipo 01, DV 85) | DV cargado | **OK** — "RUC / CÉDULA 2676824-1-844561" y debajo "DÍGITO VERIFICADOR (DV) 85", renglones separados |
| CLI-026 INTEGRA LEGAL (tipo NULL, DV NULL) | DV embebido en el RUC | **OK** — RUC muestra `25046169-3-2021 DV 40` y el DV muestra `—`. Es exactamente el cliente que arregla el backfill 022 |
| CLI-110 (tipo 02, pasaporte AW745657) | DV no aplica | **OK** — "No aplica" |
| Formulario de editar (CLI-001) | Campos separados | **OK** — input "RUC / Cédula" con el hint del DV aparte, y más abajo input "Dígito verificador (DV) *" con 85 |

Consola limpia. `tsc --noEmit` limpio, suite 292/292 verde, lint sin cambios (los mismos 22
errores preexistentes; ninguno en la ficha de cliente).

### Conteo de DV vacíos (para decidir el backfill 022) — 15/08/2026

Consulta de SOLO LECTURA contra Supabase. **No se aplicó ningún cambio de datos.**

| Métrica | Valor |
|---|---|
| Clientes en la tabla | 131 (129 sin contar 2 de prueba `0TEST`) |
| **Sin `digito_verificador`** | **114** de 129 |
| Con `digito_verificador` | 15 (todos `tipo_receptor_fe = 01`) |
| De los 114 sin DV, con tipo 01/03 (donde la DGI lo exige) | **0** |
| Desglose de los 114 por tipo | 112 con `tipo_receptor_fe` NULL · 2 con `02` |
| Desglose de los 114 por estado | 83 activos · 30 prospectos · 1 inactivo |

**Lectura:** los 114 suenan a mucho, pero **ninguno está bloqueado para facturar hoy**: el
gate fiscal solo exige DV cuando el receptor es 01 o 03, y ahí no falta ninguno. Los 112 con
tipo NULL van a necesitar DV recién cuando alguien los clasifique como contribuyentes.

**Universo real del backfill `022`: 2 clientes, no 4.**

| Cliente | `ruc` hoy | `tax_id` hoy | DV en columna |
|---|---|---|---|
| CLI-026 INTEGRA LEGAL | `25046169-3-2021  DV 40` | `25046169-3-2021  DV 40` | NULL |
| CLI-081 SERVICARE, S.A | `155701991-2-2021 DV 9` | (vacío) | NULL |

Los otros dos que el script esperaba (CLI-096 RED VERDE con DV 00 y CLI-107 LABORATORIOS
HERMANI con DV 21) **ya fueron corregidos a mano**: tienen el DV en su columna y el número
limpio, así que los `WHERE ... ~* 'DV'` del script ya no los alcanzan. Correr el `022` no los
tocaría.

**Dos observaciones para cuando Oliver lo corra:**

1. CLI-026 tiene el DV embebido en **las dos** columnas (`ruc` y `tax_id`), cosa que el
   encabezado del script no contemplaba (lo daba solo en `tax_id`; la sincronización
   `ruc`↔`tax_id` es posterior). Funciona igual **si se corre en orden**: el UPDATE A limpia
   `tax_id` y, como el guard del UPDATE B mira `tax_id` ya limpio, B entra después y limpia
   `ruc` con el mismo DV 40. Si se corre B primero, el guard lo bloquea y el `ruc` queda
   sucio. **Correr A y después B, como están escritos.**
2. El script también pobla `tipo_receptor_fe` (con COALESCE, sin pisar) — a los dos les
   pondría `01` por formato de RUC. Es lo correcto y además los desbloquea para FE.

**No se aplicó: es data de producción y la corre Oliver.**

---

## [Feature] - 2026-08-15 - Filtro "solo cuentas con saldo" en los reportes contables

Pedido de Josuar en la reunión: los reportes mostraban las 62 cuentas del plan, incluidas las
que están en 0, y él quería poder ver solo las que tienen saldo — pero sin perder la vista
completa.

### Qué se agregó

Un toggle de dos opciones en el **Balance General** (`/finanzas/reportes/balance`) y en el
**Estado de Resultado** (`/finanzas/reportes/pyl`):

| Opción | Qué hace |
|---|---|
| **Solo cuentas con saldo** (default) | Oculta las filas de cuenta cuyo saldo es 0 |
| **Todas las cuentas** | Muestra el plan completo, como hasta ahora |

Al lado del toggle se indica cuántas cuentas en 0 hay ocultas, para que quede claro que el
reporte no está incompleto: faltan filas a propósito.

### Reglas de la vista filtrada

- **Los totales y subtotales NO cambian.** Una cuenta en 0 no aporta al total, así que
  ocultarla no puede moverlo. El filtro copia los números, nunca los recalcula.
- Si un **grupo entero** queda sin cuentas con saldo, desaparece completo: encabezado y
  subtotal incluidos (ej. "Propiedad, planta y equipo" y "Pasivo no corriente", que hoy
  están en 0).
- Los **encabezados y totales de sección** se muestran siempre, aunque no quede ninguna
  cuenta visible (es el caso de PATRIMONIO, con sus 3 cuentas en 0).
- Los **renglones calculados** del Estado de Resultado (Ganancia Bruta, Utilidad Operativa,
  ISR, Utilidad Neta) y la Utilidad del Ejercicio del Balance se muestran en las dos vistas:
  no son cuentas, son la estructura del estado financiero.
- El aviso de cuadre, el de doble conteo y el de "sin clasificar" quedan intactos: cuentan
  sobre los datos completos, no sobre lo que se ve.

### Implementación

- Helper puro compartido `src/lib/finanzas/reports/report-visibility.ts` (`filterSection`,
  `filterGroups`, `hasBalance`, `countZeroRows`). Un solo lugar decide qué es "saldo cero",
  con la misma tolerancia de medio centavo que usa `accounting-reports.ts`.
- Toggle `src/app/finanzas/reportes/_components/account-visibility-toggle.tsx` (client),
  botones de 48px con icono + texto, `role="radiogroup"`.
- Las tablas pasaron a client component (`balance/_components/balance-statement.tsx` y
  `pyl/_components/estado-resultado-statement.tsx`) **solo por el toggle**: el reporte se
  sigue armando en el server y llega calculado. **No hay refetch** al alternar.
- `StatementSection` acepta `emptyLabel` para distinguir "sin cuentas registradas" de
  "todas las cuentas de esta sección están en 0".
- Cero cambios en `accounting-reports.ts`: la lógica contable no se tocó.

### Tests

`src/lib/finanzas/reports/__tests__/report-visibility.test.ts` — **11 tests**, sobre el
fixture real de las 62 cuentas de Josuar:

```
npx tsx --test src/lib/finanzas/reports/__tests__/report-visibility.test.ts
```

Cubren: los totales de la vista filtrada son idénticos a los de la completa (sección por
sección, y subtotal por subtotal de los grupos que sobreviven); ninguna fila visible está
en 0; un grupo entero en 0 desaparece; una sección entera en 0 conserva su total;
"todas las cuentas" devuelve la misma referencia sin perder filas (las 62 visibles); y el
contador de ocultas cierra contra `totales - visibles`.

**Suite completa: 292/292 verde** (283 + 9 del archivo suelto de cancel-invoice-dialog),
`tsc --noEmit` limpio. Lint sin cambios: 22 errores + 5 warnings, **los mismos 22 antes y
después** (verificado stasheando los cambios y volviendo a correr); ninguno en archivos de
este cambio.

### Verificación en navegador (localhost, rol admin) — 15/08/2026

| Check | Resultado |
|---|---|
| Balance: toggle visible, default "Solo cuentas con saldo" | **OK** — "10 cuenta(s) en 0 ocultas" |
| Balance: grupos enteros en 0 | **OK** — "Propiedad, planta y equipo" y "Pasivo no corriente" desaparecen con encabezado y subtotal |
| Balance: PATRIMONIO sin cuentas visibles | **OK** — quedan el renglón calculado y "Total de Patrimonio" |
| Balance: totales entre vistas | **IDÉNTICOS** — Activos corrientes 252,967.57 · Total de Activo 257,902.46 · Pasivos -13,425.55 · Patrimonio -234,476.91 · Pasivo+Patrimonio -247,902.46 |
| P&L: default filtrado | **OK** — "30 cuenta(s) en 0 ocultas" |
| P&L: renglones calculados en las dos vistas | **OK** — Bruta, Operativa, ISR y Neta siempre presentes |
| P&L: totales entre vistas | **IDÉNTICOS** — Ingresos -279,137.06 · Costos 9,878.38 · Bruta -269,258.68 · Gastos 34,781.77 · Operativa -234,476.91 · ISR 58,619.23 · Neta -175,857.68 |
| Consola | Limpia — sin errores ni warnings de hidratación |

### ⚠️ Hallazgo de DATOS (no es de este cambio)

Al verificar apareció una cuenta **`100006 PRUEBA` con saldo 10,000.00 y `account_type =
income`**, que no estaba en el deploy del 14/08. Sale listada bajo INGRESOS (código de
activo, tipo de ingreso) y es exactamente el origen del **descuadre de 10,000.00** que hoy
muestra el Balance ("El balance NO cuadra"). Los totales del 14/08 eran Activo 257,902.46 /
Pasivo+Patrimonio **-257,902.46**; hoy el segundo da -247,902.46.

El aviso de descuadre funcionó como se esperaba: no lo escondió. **Es dato, no código** —
hay que borrar o corregir esa cuenta de prueba en el Plan de Cuentas. Recordar que dev y
prod comparten el mismo Supabase, así que la cuenta está también en producción.

### Limpieza de paso

- Borrados los scripts scratch untracked `scripts/tmp-coa.mjs`, `tmp-coa2.mjs`,
  `tmp-testacc.mjs`, `tmp-users-check.mjs`.
- `docs/finanzas/roadmap-contable.md`: el `023` (ledger Fase 1) figuraba como "pendiente de
  aplicar en Supabase" en 4 lugares; se aplicó el 04/08/2026. Corregido, aclarando que el
  schema está en la BD pero todavía sin uso en código.
- `task_plan.md` Fase 11 (Testing & Deploy): los 4 ítems pasaron a ✅, cubiertos por el
  deploy del 14/08/2026, con la nota de que ahora son parte del ciclo de cada release.
- `sql/pending/022_backfill_dv_embebido.sql` se dejó como está (va con el refinamiento del DV).

---

## [DEPLOY] - 2026-08-14 18:03 UTC - develop → main (11 commits)

**Merge:** `060fed7` · **Punto de rollback:** `f149735` · **Aprobado por:** Oliver

### Qué salió
Ledger Fase 1 (schema, sin uso en código todavía) · plan de cuentas con `saldo_inicial` +
`subcategoria` · importador de cuentas por Excel · reportes Balance General y Estado de Resultado ·
rol asistente (ve todos los casos + ficha de cliente en solo lectura, sin directorio) · fix del
borrado de cliente con registros financieros.

**Migraciones:** ninguna en este deploy. `sql/pending/023` y `024` ya habían sido aplicadas por
Oliver en el Supabase de producción; código y BD ya estaban en sync.

### Pre-deploy (SOP-006)

| Check | Resultado |
|---|---|
| Suite completa de tests | **281/281 verde**, 0 fail (22 archivos) |
| `tsc --noEmit` | limpio |
| `next build` local | **exitoso** (`✓ Compiled successfully`, exit 0) |
| Lint | 5 errores **preexistentes**, todos en archivos que este release NO toca; `next.config` tiene `eslint.ignoreDuringBuilds` → no bloquean el build |
| Diff review `origin/main..origin/develop` | limpio: sin secretos, sin endpoints de debug, sin scripts de scratch; `build` es `next build` a secas (ningún hook que corra migraciones) |
| Migraciones en prod | ya aplicadas (023, 024) |
| Changelog | actualizado |

**Verificación extra antes de mergear:** `main` NO era ancestro de `develop` (9 merge commits viven
solo en main, patrón normal del repo), así que el fast-forward era imposible y se usó merge commit
`--no-ff` — que además es la palanca de rollback. Se comprobó con `merge-tree` que el merge no tenía
conflictos y que **el árbol resultante es idéntico al de `develop`**, o sea que producción quedó
exactamente con el código probado. También se verificó que main no tuviera ningún hotfix ausente en
develop (lo único "único de main" era el 023 viejo, que develop reescribió).

### Deploy

- Push a `origin/main` 18:03:24 UTC → auto-deploy disparado.
- Vercel: `crm-integra-legal-28gehse9m` · **Ready** · build **1m** · creado 18:03:25 UTC.
- Deploy anterior (rollback en Vercel): `crm-integra-legal-qb1fnqhga`.

### Post-deploy smoke (producción, `crm-integra-legal.vercel.app`)

Sin sesión: `/api/health` → 401 (el gate, no un 500) y las 4 rutas nuevas → 307 al login
(middleware corriendo, sin crash).

Con sesión de admin:

| Check | Resultado |
|---|---|
| (a) `/finanzas/reportes/balance` | **OK** — los 5 totales exactos (Activos corrientes 252,967.57 · Activo 257,902.46 · Pasivos -13,425.55 · Patrimonio -244,476.91 · Pasivo+Patrimonio -257,902.46) y "El balance cuadra" |
| (a) `/finanzas/reportes/pyl` | **OK** — los 5 totales exactos (Ingresos -289,137.06 · Costos 9,878.38 · Bruta -279,258.68 · Gastos 34,781.77 · Utilidad Operativa -244,476.91) + ISR 61,119.23 y Neta -183,357.68 |
| (b) `/finanzas/configuracion/cuentas` | **OK** — "62 activa(s) · 97 total", con las columnas Subcategoría y Saldo inicial y el botón Importar cuentas |
| (c) Ficha de cliente (CLI-001) | **OK** — carga sin error, con las acciones de admin |
| (d) Asistente ve todos los casos | **Verificado PRE-DEPLOY en localhost**, no re-verificado en producción — decisión de Oliver: es el mismo código que quedó en prod (commits `bb8bc16` y `547c312`, con el gate del middleware cubierto por los tests de la suite). No se re-probó en prod porque exige iniciar sesión con el usuario asistente y Claude no ingresa contraseñas. |

Sin errores de consola en las páginas verificadas.

**Nota de alcance del smoke:** (a), (b) y (c) se verificaron directamente contra la URL de
producción. (d) descansa en la verificación previa en localhost sobre el mismo commit. Si alguna vez
hay que auditar este deploy, esa es la distinción que importa.

---

## [Feature] - 2026-08-14 - Balance General y Estado de Resultado (Paso 2 contable)

Los dos reportes que pidió Josuar, reemplazando los placeholders de
`/finanzas/reportes/balance` y `/finanzas/reportes/pyl`. **Sin migración**: se arman con el
`saldo_inicial` y la `subcategoria` de las 62 cuentas cargadas en los Pasos 1a/1b.

**Los 10 totales dan exactamente los mismos números que el Excel de Josuar** (ver §4).

### 1. Convención de signos — la de Josuar, sin invertir

Los saldos se suman TAL CUAL vienen de la balanza de comprobación: débitos (activos, costos,
gastos) positivos, créditos (pasivos, patrimonio, ingresos) negativos. Consecuencias que son
correctas y NO bugs, documentadas en el código y en una nota al pie de los dos reportes:

- "Total de Ingresos" sale **negativo** (-289,137.06).
- Una **ganancia aparece en negativo**; una pérdida, positiva. De ahí que el guard del ISR sea
  `utilidadOperativa < 0`, no `> 0`.
- "Total Pasivo + Patrimonio" queda **igual y opuesto** al "Total de Activo". El balance cuadra
  cuando la SUMA de los dos da cero, no cuando son iguales.

### 2. Capa de datos aislada — `src/lib/finanzas/reports/accounting-source.ts`

Único archivo a cambiar en el Paso 3. Hoy el saldo de cada cuenta ES su `saldo_inicial`; cuando
entre el motor de posteo pasa a ser `saldo_inicial + Σ movimientos del ledger`. `ReportAccount` no
cambia de forma, así que el armado puro y la UI quedan intactos. Filtra `active = true` (las 35
cuentas viejas de QB están desactivadas y ensuciarían el reporte con renglones en 0).

### 3. Armado PURO — `src/lib/finanzas/reports/accounting-reports.ts`

Sin BD: recibe `ReportAccount[]` y devuelve las estructuras que renderiza la UI.

**Estado de Resultado:** INGRESOS → Total de Ingresos · COSTOS → Total de Costos · GANANCIA O
PÉRDIDA BRUTA · GASTOS OPERATIVOS → Total de Gastos · UTILIDAD OPERATIVA · ISR · UTILIDAD NETA.
COSTOS y GASTOS parten `account_type='expense'` en dos por `subcategoria` — que es exactamente para
lo que se agregó el campo en el Paso 1a: en BD ambos son el mismo tipo.

**Balance General:** ACTIVOS agrupado en el orden de Josuar (corriente → propiedad, planta y equipo
→ no corriente, que **no** es el orden de `SUBCATEGORIAS`), PASIVOS (corriente / no corriente) y
PATRIMONIO (cuentas + renglón calculado "Utilidad del Ejercicio"). Renglones ordenados por código,
numeric-aware.

**Nada se cae del reporte en silencio.** Una cuenta con `subcategoria` NULL o inesperada entra en un
grupo **"Sin clasificar"** al final de su tipo, suma al total, y la UI avisa cuántas hay. Sin eso,
un `expense` mal clasificado desaparecía del P&L y el total mentía sin que nadie lo notara. Con las
62 cuentas actuales no hay ninguna (hay test que lo verifica).

**ISR como parámetro, no regla fiscal:** tasa plana configurable (default 25%) sobre la utilidad
operativa, aplicada solo si hubo ganancia. La tasa y el método (base gravable, ajustes, tarifa
alternativa) están pendientes de Josuar; la UI lo dice explícitamente ("tasa provisional 25% — a
confirmar").

`buildAccountingReports()` arma los dos juntos para que la "Utilidad del Ejercicio" del Balance sea
**literalmente** la utilidad operativa del Estado de Resultado y no puedan divergir.

### 4. Totales verificados contra el Excel de Josuar

| Estado de Resultado | Valor | Balance General | Valor |
|---|---|---|---|
| Total de Ingresos | -289,137.06 | Total Activos corrientes | 252,967.57 |
| Total de Costos | 9,878.38 | Total de Activo | 257,902.46 |
| Ganancia o Pérdida Bruta | -279,258.68 | Total de Pasivos | -13,425.55 |
| Total de Gastos | 34,781.77 | Total de Patrimonio | -244,476.91 |
| Utilidad Operativa | -244,476.91 | Total Pasivo + Patrimonio | -257,902.46 |

ISR (25% provisional) 61,119.23 · Utilidad Neta -183,357.68 · **el balance cuadra** (descuadre 0.00).

### 5. ⚠️ Riesgo de doble conteo detectado y mitigado

El plan de Josuar **ya tiene una cuenta `300003 Utilidad del Ejercicio`** (equity/patrimonio) y este
reporte además agrega el renglón calculado con el mismo nombre, tal como pide su modelo. Hoy `300003`
está en 0 y los totales dan bien, pero si alguien le carga un saldo **el resultado se contaría dos
veces** y el balance se descuadraría.

Mitigaciones: el descuadre se **calcula y se muestra** (banner rojo con la diferencia y qué revisar)
en vez de esconderse; y si las cuentas de patrimonio tienen cualquier saldo distinto de cero aparece
un aviso ámbar pidiendo confirmar que no se está duplicando. El chequeo mira el **saldo**, no el
nombre de la cuenta, así que no es frágil. Cuando llegue el cierre de ejercicio con asientos, el
resultado se postea a la cuenta y el renglón calculado desaparece.

### 6. UI

Formato de los modelos de Josuar: encabezado centrado con razón social + título + fecha de
generación, secciones en mayúsculas, subgrupos con subtotal, totales en negrita con reglas, montos
`font-mono tabular-nums` con separador de miles `es-PA` y **negativos en rojo**. Piezas compartidas
en `_components/financial-statement.tsx`; la razón social sale de
`EFACTURA_EMISOR_RAZON_SOCIAL` (el nombre legal ante la DGI) leyendo `process.env` directo —
**no** vía `loadEmisorConfig()`, que lanza si falta cualquier variable del emisor y tiraría abajo un
reporte contable por una config de facturación incompleta.

Los badges del índice pasaron de "Mensual / Anual" y "Fecha de corte" a **"Saldos de apertura"**:
todavía no hay selector de período y el badge anterior prometía algo que el reporte no hace.

### 7. Tests — 22 nuevos (`accounting-reports.test.ts`), 0 fail

Fixture `josuar-accounts.fixture.ts` con las **62 cuentas reales** exportadas de la BD (generado, no
escrito a mano). Cubre: los 10 totales contra el Excel de Josuar, el cuadre del balance, que la
Utilidad del Ejercicio del Balance sea la utilidad operativa del ER, el orden de los grupos de
activo, el orden por código, la separación costo/gasto_operativo, que nada caiga en "Sin clasificar"
con los datos reales, que un `expense` huérfano SÍ aparezca en "Sin clasificar" y sume, el descuadre
reportado, el ISR (ganancia / pérdida / cero / tasa parametrizada / número real), y que los centavos
no arrastren error binario.

```
npx tsx --test src/lib/finanzas/reports/__tests__/accounting-reports.test.ts
```

### 8. Verificación en navegador (localhost:3000, rol admin) — 14/08/2026

Ambos reportes abiertos y leídos renglón por renglón. **Los 10 totales coinciden exactamente** con
la tabla de §4. El Balance muestra el banner verde "El balance cuadra. Total de Activo 257,902.46 y
Total Pasivo + Patrimonio -257,902.46 son iguales y opuestos". El aviso de doble conteo NO se
dispara (las 3 cuentas de patrimonio están en 0), que es el comportamiento correcto. El renglón
calculado se distingue visualmente del de la cuenta `300003` por la nota gris al lado ("del Estado
de Resultado (operativa)").

### 9. Pendiente de Josuar (marcado en la UI, no asumido)

- **Tasa y método del ISR.**
- Si el patrimonio debe llevar la utilidad **operativa o la neta** (hoy: operativa).
- **Fecha de corte** de los saldos de apertura.

---

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
