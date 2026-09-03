# TASK_PLAN.MD — CRM INTEGRA LEGAL

## >>> RETOMAR ACA — STAGING LISTO PARA JOSUARTH — 01/09/2026 <<<

**Lo que sigue:** mandarle el correo a Josuarth con el acceso, y **esperar su feedback antes de
tocar nada más**. Cambió la forma de trabajar: Rose pidió entregas por módulo con validación
entre una y otra, no un sistema terminado para revisar de una vez.

### Último arreglo antes del correo (01/09, cierre)

El enlace del Libro Mayor a la factura le rebotaba al contador — seis de los diez asientos. Se
le abrió el DETALLE de factura en solo lectura, se gatearon por rol los botones de Editar,
Emitir y Eliminar (dependían solo del status), y `nav-guard.test.ts` pasó a cubrir los enlaces
de CONTENIDO además del menú. 409 tests, 409 pass.

**✅ Verificado en pantalla el 02/09** con la sesión de `contador@staging.test` (rol contador,
no admin): desde la Antigüedad se abrió `FAC-HON-000003` y el detalle cargó completo. Queda
cerrado el "sin verificar" que dejó la caída de internet del 01/09.

**Corrección:** los "530 de Supabase" anotados esta mañana eran, casi con seguridad, esta misma
red local. No hay motivo para postergar el correo por el estado de staging.

### 🔴 PENDIENTE DE OLIVER — antes de aplicar la migración `034` en producción

`sql/pending/034_asiento_unico_por_documento.sql` está aplicada en **staging** y **NO en
producción**. Antes de aplicarla allá hay que correr este chequeo. **Si devuelve una sola fila, NO
aplicar**: el índice fallaría a mitad, y el asiento duplicado no se puede borrar porque el trigger
de la `023` rechaza el DELETE.

```sql
SELECT tenant_id, source_type, source_id, COUNT(*) AS asientos,
       string_agg(entry_number::text, ', ' ORDER BY entry_number) AS numeros
  FROM public.journal_entries
 WHERE source_id IS NOT NULL
 GROUP BY tenant_id, source_type, source_id
HAVING COUNT(*) > 1;
```

Staging al 02/09/2026: **0 duplicados** (9 asientos con `source_id`, 9 combinaciones únicas).

### 🔴 CAMBIA EL DISEÑO DEL BLOQUE DE COMPRAS — el gasto necesita LÍNEAS

Hoy `business_expenses` tiene **una sola** `chart_account_code`. El asiento, en cambio, ya soporta
el desglose: el gasto del 15/03 se muestra en pantalla como *"610002 Honorarios Profesionales
$1.497,85"* y su asiento (N.º 3 del Diario) lo parte en tres —útiles 412,35 / honorarios 900,00 /
mensajería 185,50—, que es lo correcto.

**La pantalla muestra una clasificación falsa de algo que el libro tiene bien.** Y no es un bug de
la pantalla: es que el modelo no puede representarlo. La columna única obliga a elegir una cuenta
para una compra que toca tres.

**Consecuencia para el bloque de compras, que está bloqueado esperando al contador:** cuando se
retome, el gasto necesita una tabla `business_expense_lines` (cuenta + descripción + monto), no una
columna. Eso cambia:

- el formulario (pasa de un `<select>` a un editor de líneas, como el de facturas),
- el cableado al asiento (una línea del asiento por línea del gasto, en vez de una sola),
- y una migración con backfill: cada gasto actual pasa a tener una línea con su cuenta y su total.

**No se arregló acá** porque es el bloque de compras y sigue bloqueado por las tres preguntas al
contador. Anotado para que el diseño de ese bloque no arranque asumiendo la columna única.

### 📋 BLOQUE PARA DESPUÉS — cableado factura/pago → asiento

**Bloqueado por tres preguntas al contador.** Ninguna es decisión de desarrollo:

1. **Qué cuenta de ingreso** por servicio del catálogo. `services_catalog.revenue_account` apunta
   hoy a `4101` y `2201`, **las dos inactivas**: es el plan anterior al de Josuarth. Sin esto, el
   asiento de una factura no se puede derivar sin hardcodear — que es el problema que se está
   eliminando.
2. **Qué cuenta bancaria** por defecto para los cobros. `payments` tiene `method` y `reference`,
   pero no cuenta; hay tres bancos activos.
3. **El ITBMS de compras** (crédito fiscal, no `200003`). También bloquea el módulo de compras.

**Diseño registrado, NO decidido:** postear el asiento ANTES de emitir la factura. Un asiento
huérfano es detectable y reversible; una factura sin asiento es una divergencia silenciosa.
⚠️ **Antes de implementarlo hay que revisar si el correlativo de la factura se asigna al emitir**:
si es así, el asiento posteado antes no tendría número que citar, y el diseño se cae.

**Ya hecho y desbloqueado (02/09):** el UNIQUE de idempotencia, el backfill de los 250,00 y el gate
de anulación.

**Lo que sigue abierto del gate de anulación:** hoy una factura con asiento NO se puede anular. El
asiento de reversión es su propio bloque, y necesita decidir con qué FECHA se revierte.

### 📋 BLOQUE PARA DESPUÉS — Backfill `022`: el DV embebido en el texto del RUC

**Estado: diagnosticado el 02/09/2026, sin urgencia, sin fecha.** No arrancar sin aprobación
explícita de Oliver.

#### Qué pasa

`sql/pending/022_backfill_dv_embebido.sql` extrae el DV que algunas licenciadas cargaron como
texto al final del número fiscal (`"25046169-3-2021  DV 40"`), lo pasa a `digito_verificador` y
limpia el número. **Nunca se aplicó.**

#### Lo que dijo producción (consulta corrida por Oliver el 02/09/2026)

**2 clientes afectados, los dos en estado "bloqueado por el gate". Cero en peligro.**

| Cliente | Situación |
|---|---|
| CLI-026 INTEGRA LEGAL | DV embebido en el texto, `digito_verificador` vacío |
| CLI-081 SERVICARE | DV embebido como `"DV 9"`, `digito_verificador` vacío |

**No hay riesgo de mandarle un RUC sucio a la DGI.** El gate fiscal
(`fetch-invoice-efactura-bundle.ts:225`) exige `digito_verificador` para receptores 01/03 y corta
con un 400 accionable antes de tocar la red. La combinación peligrosa —DV pegado al texto **y**
columna poblada, que sí dejaría pasar un `rucReceptor` sucio— **no existe en producción**.

**Lo que sí pasa:** esos dos clientes **no pueden recibir factura electrónica**, y nadie lo sabe
hasta que alguien intente facturarles.

#### ⚠️ Dos cosas que NO son mecánicas y hay que resolver ANTES de correr el script

1. **El DV de CLI-081 dice `"DV 9"`.** Los dígitos verificadores de la DGI son de dos posiciones,
   así que *probablemente* sea `09` — pero podría faltarle un dígito. **No normalizarlo por
   cuenta propia: hay que confirmarlo contra un documento del cliente.** Un DV inventado en un
   anexo de la DGI es peor que uno faltante. El script hoy extrae `9` tal cual con
   `regexp_match(..., 'DV\s*([0-9]+)')`, sin rellenar el cero.
2. **Los dos tienen `tipo_receptor_fe` en NULL.** Aunque se les separe el DV, **siguen sin poder
   emitir**: el gate también exige el tipo de receptor. Definirlo (01 contribuyente / 03 gobierno
   / 02 consumidor final) es **una decisión del bufete, no del backfill**. El script intenta
   inferirlo por el formato del número; para estos dos casos esa inferencia no reemplaza a que
   alguien lo confirme.

#### Orden de trabajo cuando se retome

1. **Test de payload congelado** de `mapReceptor()`: los cuatro tipos de receptor (01/02/03/04)
   más los dos casos sucios (DV pegado con y sin columna), comparados contra un JSON versionado.
   Hoy `map-invoice.test.ts` tiene 11 tests pero **ninguno congela el bloque completo del
   receptor**, y solo uno mira `rucReceptor`. Ese test es la red que no existe.
2. **Sandbox de la DGI** (`EFACTURA_I_AMB`), nunca el ambiente real.
3. **Producción, con aprobación explícita de Oliver**, y con el ROLLBACK-CHECK del propio script
   guardado antes de correr.

⚠️ **Ojo con el orden interno del script:** correr el UPDATE A (tax_id) antes que el B (ruc). El
guard del B depende de que el A ya haya limpiado `tax_id`.

#### Lo que este bloque NO es

**No hay que agregar ninguna columna.** `clients.digito_verificador` ya existe y ya está
desplegada; el payload de la DGI ya manda `rucReceptor` y `digitoVerificador` **separados y sin
partir ningún texto** (`map-receptor.ts:114-118`). Lo único que falta es limpiar el texto de esos
dos clientes.

### Bloque cerrado el 02/09 — Exportación a Excel del Mayor y la Antigüedad

| # | Entregable | Estado |
|---|---|---|
| EXP.1 | Export del Libro Mayor por cuenta, con RUC y DV en columnas separadas | ✅ |
| EXP.2 | Export de la Antigüedad (cobrar y pagar) con el mismo motor | ✅ |
| EXP.3 | Formato xlsx — un CSV destruye el DV `05` | ✅ decidido y documentado |
| EXP.4 | Permisos: el export exige los mismos roles que la pantalla | ✅ 2 tests que lo verifican |
| EXP.5 | Celdas sin tercero VACÍAS, no "—" ni "N/A" | ✅ verificado en el archivo |
| EXP.6 | Verificación con archivos reales, leídos de vuelta | ✅ 3 archivos |

**Lo que queda:**

1. ✅ **CORREGIDO el 02/09** — la exportación lee `clients.digito_verificador`. Salía vacía por
   haberse escrito sobre una premisa falsa. Verificado con una exportación real: DV `08`, `00` y
   `02`, los tres como texto y con sus ceros.
   🔒 **Y quedó la red que no existía:** `receptor-payload-congelado.test.ts` congela el bloque
   `informacionReceptor` que se le manda a la DGI, para los cuatro tipos de receptor más los dos
   casos sucios del backfill `022`.
2. **Verificar el botón en pantalla con sesión de contador** — la extensión de Chrome sigue
   desconectada.
3. Los RUC y DV reales de los proveedores los tienen las licenciadas; en staging hay valores de
   demostración.

### Bloque cerrado el 02/09 — Proveedores como entidad

| # | Entregable | Estado |
|---|---|---|
| PRV.1 | Migración `033`: tabla `suppliers`, secuencia PRV-NNN, `supplier_id` y `due_date` en gastos | ✅ idempotente + rollback |
| PRV.2 | RUC y DV en columnas separadas, con test que impide concatenarlos | ✅ |
| PRV.3 | Validación permisiva del RUC + avisos que no bloquean | ✅ 21 tests |
| PRV.4 | Términos de pago → vencimiento del gasto → tramos de la antigüedad | ✅ |
| PRV.5 | Pantallas: listado, alta, ficha, edición | ✅ build limpio |
| PRV.6 | Antigüedad y estado de cuenta agrupan por ficha, no por texto | ✅ |
| PRV.7 | Selector de proveedor + vencimiento en el formulario de gastos | ✅ |

**Verificado contra staging:** 3 de 3 gastos conservan su proveedor, 0 sin enlazar, 0 sin
vencimiento, el auxiliar de CxP sigue en 3.594,25 y cada documento se movió exactamente el plazo
de su proveedor (30 / 0 / 45 días).

**Lo que queda de este bloque:**

1. **Eliminar `supplier_name` y `supplier_ruc`** de `business_expenses`. Quedaron como respaldo a
   propósito; es un commit posterior, cuando se confirme que nada se perdió.
2. **Cargar los RUC, los DV y los plazos reales.** Los tres proveedores de staging se crearon
   automáticamente y quedaron sin RUC y en contado. Los datos reales los tienen las licenciadas.
3. **Verificar las cuatro pantallas nuevas con sesión de contador** — la extensión de Chrome está
   desconectada desde ayer.
4. **La migración `033` NO está aplicada en producción.** Está escrita para poder correr allá
   (idempotente, transaccional, sin borrar, con rollback), pero eso es un merge a `main`.

### Bloque cerrado el 02/09 — Antigüedad de Saldos y Estado de Cuenta

| # | Entregable | Estado |
|---|---|---|
| AG.1 | Antigüedad por cobrar y por pagar, en tramos y **detallada por documento** | ✅ |
| AG.2 | Las **tres cifras de control** (auxiliar · cuenta control · diferencia) en pantalla | ✅ |
| AG.3 | Estado de cuenta por cliente y por proveedor, con saldo corrido | ✅ |
| AG.4 | Enlaces al documento por el mismo resolvedor — cubiertos por `nav-guard.test.ts` | ✅ 18 tests nuevos |
| AG.5 | Hub sin el chip "no construido" en los dos | ✅ |
| AG.6 | Quitado el "Volver a Reportes" duplicado en 4 pantallas | ✅ |

Con esto el hub queda con **8 reportes construidos y 1 planificado** (Ventas Mensuales).

**Lo que este bloque descubrió y hay que llevarle a Josuarth:**

1. **El auxiliar de CxC no cuadra con su cuenta control, y NO es solo la apertura.** Diferencia
   191.697,55 contra una apertura de 191.947,55: sobran **250,00** de documentos que existen en el
   sistema y todavía no producen asiento (una factura de 400,00, un cobro de 150,00). En CxP la
   diferencia SÍ es exactamente la apertura (3.400,48).
   ✅ **La pantalla ya muestra las dos causas por separado** (02/09): decir que la diferencia "era"
   la apertura era inexacto y se corrigió. Falta verlo renderizado con sesión de contador — se
   cayó la extensión de Chrome a mitad de la corrida.
2. **Consulta nueva para él:** para que el auxiliar cuadre hace falta **el detalle de los
   documentos pendientes a la fecha de apertura**. No está en el sistema y no se puede inferir.
3. **El proveedor no es una entidad** (`supplier_name` es texto libre) y **los gastos del bufete
   no tienen fecha de vencimiento**. Las dos limitan la antigüedad de CxP y las dos se resuelven
   con el módulo de compras, que sigue detrás del gate de su validación.

### ⚠️ VENTANA DE REVISIÓN ABIERTA — leer `sop.md` SOP-019 antes de tocar staging

Mientras Josuarth revisa: **no resetear, no migrar, no sembrar**. El trabajo sigue en `develop`;
lo que se detiene es tocar ese ambiente. Los números de referencia con los que quedó están en
SOP-019 y en el `changelog.md` del 01/09.

### 🔴 PENDIENTE DE OLIVER — bloquea el correo

1. **La URL de staging.** No existe documentada: `crm-integra-legal.vercel.app` es PRODUCCIÓN.
   Los deploys de Preview de Vercel tienen URL autogenerada por rama y por defecto **piden login
   de Vercel** (Deployment Protection). Josuarth no tiene cuenta. Hay que resolver las dos cosas
   —qué URL y cómo entra sin cuenta de Vercel— antes de mandar nada. No se puede sacar del repo.
2. **Confirmar que `RESEND_API_KEY` puede quedarse donde está.** Ya no hace falta moverla: el
   candado de SOP-018 corta el envío por código en cualquier entorno que no sea producción. Pero
   conviene saber que está en *All Environments* y que ahora es inofensiva.
3. **`ALLOW_REAL_EMAILS` NO debe existir en Vercel.** Si alguien la carga, el candado se abre.

### Bloque NIIF 18 — 01/09/2026 (tarde)

| # | Tarea | Estado |
|---|-------|--------|
| N18.1 | Sexto tipo `cost` | ✅ **ya existía** (migración 025). Cero cuentas por reclasificar |
| N18.2 | Renombrar "gasto operativo" → "gasto" | ✅ **ya existía** (`ACCOUNT_TYPE_LABEL_ES`) |
| N18.3 | Los 12 tests ocultos tras el skip | ✅ arreglados + `npm test` canónico (406/406, 0 skipped) |
| N18.4 | `categoriaNiif18De()` — la categoría aislada en UNA función | ✅ habilita la migración sin reescribir el ER |
| N18.5 | ER con los cuatro subtotales, al modelo `image005.png` | ✅ verificado en pantalla |
| N18.6 | Cuentas en 0 fuera del reporte (30 de 45) — criterio unificado | ✅ 7 tests |
| N18.7 | Subcategoría `depreciacion_acumulada` | ✅ sin migración: las de balance se validan en la app |
| N18.8 | Migración a `categoria_niif18` | ⬜ **NO se hizo** — ver abajo |

**Por qué N18.8 quedó afuera:** criterio acordado con Oliver. Es invisible para Josuarth, no
bloquea su revisión, y a medias sería peor que mañana. El aislamiento (N18.4) ya está, así que
la migración toca `categoriaNiif18De()` y el mapper, no el builder del reporte.

### Consultas nuevas para RM (no inventar, preguntar)

1. **¿Van los subtotales por rubro?** Su modelo no los tiene (ahí cada rubro tiene 1-2 cuentas).
   Integra tiene 11 cuentas de gastos visibles y sin el total del rubro el salto al subtotal no
   se puede verificar. Hoy están; sacarlos es una línea.
2. **El "gasto de depreciación"** no es una categoría NIIF 18 sino un rubro dentro de gastos
   operativos, y depende del nivel de agrupación por rubro que mencionó Rose ("los gastos del
   mismo rubro van juntos") y que no está definido. No se inventó.
3. **El versionado por fecha de la parametrización** que pide la guía: se decide con la columna
   `categoria_niif18` ya definida, no antes.

### Lo que quedó entregado en este bloque

| # | Tarea | Estado |
|---|-------|--------|
| B0.1 | Candado de correo fuera de producción + eFactura `iAmb` | ✅ SOP-018, 8 tests |
| B0.2 | "Pagos" → "Cobros" en gastos del caso | 🟡 **A MEDIAS** — ver A-0 punto 2. La pantalla del caso ya dice Cobros; los DOS formularios que crean el registro siguen diciendo Pago. Estaba marcado ✅ por error hasta el 02/09/2026 |
| B0.3 | ITBMS configurable: pantalla nueva + seed reconciliando el catálogo | ✅ |
| B0.4 | Tipo de documento a lista desplegable | ✅ |
| B0.5 | Reembolso al facturar → HABER `130003` | ✅ verificado en el asiento 6 |
| B0.6 | Libro Mayor al formato de Josuarth (9 columnas, pie = neto, importe con signo) | ✅ |
| B0.7 | Saldo inicial del mayor ajustado al rango de fechas | ✅ 4 tests |
| B0.8 | Auditoría sidebar vs middleware + `nav-guard.test.ts` | ✅ 4 desajustes cerrados |
| B0.9 | Contador entra a `/finanzas/configuracion` con permiso de edición | ✅ |
| B0.10 | Hub de reportes distingue lo construido de los marcadores | ✅ |
| B0.11 | Reset + doble siembra, verificado con sesión real de contador | ✅ 13 rutas 200, 6 rebotan |

### Consultas a RM que este bloque CERRÓ

- **Consulta 4** (qué va en el pie del mayor) → el NETO de movimientos. Su modelo lo contesta.
- **Consulta 5** (signo del importe) → una sola columna con signo, negativo = crédito.
- **Reembolso al facturar** → `130003`, nunca ingreso. Estaba en el acta desde el 25/08.

### Lo que sigue abierto de RM

1. **Consulta 3** — contrapartida ambigua (más de una cuenta del otro lado). Sigue aislada en
   `contrapartidaDe()`.
2. **La fecha exacta de los saldos cargados.** Rose dio la regla contable, falta el dato. Se
   resuelve mirando a qué fecha se generó el reporte de QuickBooks del que salieron — lo tenemos
   nosotros, no RM. Hoy 42 de 64 cuentas tienen `saldo_inicial_fecha` en NULL.
3. **La captura del reporte de antigüedad detallado.** Es el único de sus tres entregables que
   falta.
4. **A las licenciadas:** confirmar que la firma paga TODOS los gastos de trámite, y si usan
   tarjeta de crédito.

### Fuera del alcance de este bloque, por decisión

Van después de que Josuarth valide: módulo de compras, gastos de trámite, cobros y pagos,
cableado factura→asiento, antigüedades, balance de comprobación, diario general y la convergencia
de reportes (analizada el 01/09, no implementada — ver el análisis en la conversación y el gate en
el bloque de más abajo).

---

## Bloque anterior — `amount_paid` DERIVADO Y GARANTIZADO — 01/09/2026

**Lo que sigue NO cambió:** el correo con las NUEVE consultas y la llamada de validación con
RM. El módulo de compras y el cableado factura→asiento siguen congelados detrás de ese gate.
Este bloque no lo tocó.

### Por qué existe este bloque, si no figuraba en el plan

Nació del hallazgo del 28/08, anotado ese día en `changelog.md` bajo "Anotado, no tocado":
las facturas del fixture traían `amount_paid` escrito a mano sin un `payment` detrás. El
diagnóstico del 01/09 mostró que el agujero no era del seed sino de la base — T4
(`finanzas_invoice_immutability`) autorizaba explícitamente escribir esa columna en una factura
emitida — así que arreglar solo el fixture lo habría escondido hasta la Fase 4.

### Estado: CERRADO

| # | Tarea | Estado |
|---|-------|--------|
| aP.1 | Migración `032_amount_paid_derivado.sql` — guard T4b + T7a anunciándose | ✅ aplicada en staging |
| aP.2 | Válvula de escape documentada (`finanzas.amount_paid_override`) | ✅ SOP-017 |
| aP.3 | `SEED_PAYMENTS` movido a `seed:staging`; `seed:asientos` los consume | ✅ |
| aP.4 | `SeedInvoice.amount_paid` eliminado; el status lo produce T7a | ✅ |
| aP.5 | Verificación al cierre de los dos seeds + 10 tests en la suite | ✅ |
| aP.6 | Guard probado disparando (rechazo, T7a, reversión, válvula) | ✅ |
| aP.7 | Reset + doble siembra; baseline de CxC intacto en 194,842.55 | ✅ |
| aP.8 | Docs: `changelog.md`, `sop.md` (SOP-016 y SOP-017 nuevo), este archivo | ✅ |

Detalle completo en `changelog.md` del 01/09 y en `sop.md` SOP-017.

### ⚠️ PENDIENTE DE OLIVER — bloquea el merge a `main`

**Correr la consulta de diagnóstico contra PRODUCCIÓN** (solo lectura, está al pie de
`sql/pending/032_amount_paid_derivado.sql` y en SOP-017). El guard impide desfases nuevos pero
**no corrige los viejos**, y en producción un desfase no es un bug de fixture: es una factura
que dice estar cobrada por un monto que ningún pago respalda.

- **0 filas** → la 032 se puede mergear tal cual.
- **≥ 1 fila** → hay que resolver esas facturas con el contador ANTES de aplicar la migración.
  El guard no las toca, pero congela el número mal en su lugar.

### Lo que este bloque deliberadamente NO hizo

- **No tocó `status`.** No es una columna derivada: T7a solo opina sobre tres de sus seis
  estados. Cerrarle la escritura habría roto `emitInvoice()` y `cancelInvoice()`.
- **No le puso asiento al pago de FAC-REI-000001.** Decisión del 01/09: sostiene el baseline de
  2,895.00 entre el mayor de CxC (194,842.55) y el Balance (191,947.55), que es el número con el
  que se va a validar la convergencia de reportes. Entra al ledger cuando se cablee
  factura→asiento.
- **No tocó los otros pendientes abiertos**: índice de `client_payments` en producción, las 3
  variables de Vercel, las cuentas de prueba `999001`, ni los fixes de eFactura sin desplegar.

---

## Bloque anterior — LIBRO MAYOR ENTREGADO — 28/08/2026

**Lo que sigue:** el correo con las NUEVE consultas y la llamada de validacion con RM. **El
modulo de compras sigue sin arrancar** hasta esa validacion.

### El Libro Mayor SÍ se construyó, por decisión explícita del 28/08

El gate de abajo decía "no se arranca el Libro Mayor hasta la validacion". Se levantó a
propósito, y con una razón: las tres decisiones pendientes de Josuar que lo afectan están
**aisladas a una función cada una** (`contrapartidaDe`, `totalesDePie`, `importeDeLinea`), con
las dos alternativas escritas en el comentario y tests que marcan qué asserts cambian según la
respuesta. Cuando conteste, se toca eso y nada más. Lo que sigue congelado es el cableado
factura→asiento, que es lo que de verdad seria caro corregir.

### Estado del Libro Mayor

Entregado y verificado contra staging: mayor por cuenta con saldo inicial, movimientos de los
dos lados y saldo corrido; trazabilidad nivel 1 (reporte → mayor) y nivel 2 (mayor →
factura / gasto / la factura que cancelo un pago). Detalle en `changelog.md` del 28/08 y en
`sop.md` SOP-016.

**Lo que el mayor NO hace todavía, y está dicho en pantalla:** el Balance General y el Estado
de Resultado siguen armandose solo con saldos de apertura, así que no incluyen estos
movimientos. La fila "Saldo inicial" de cada cuenta es exactamente el número que muestran esos
reportes. Cambiar `accounting-source.ts` haría que staging deje de coincidir con el Excel de
Josuar, que es el baseline contra el que RM va a validar — va en el mismo bloque que el
cableado, después de la validacion.

### Lección del reinicio del 27/08 — ya incorporada al código

El seed se editó DESPUÉS de haber corrido y la clave de idempotencia cambió bajo los pies:
re-correrlo habría duplicado contabilidad imborrable en silencio. Hoy `seed-asientos.ts`
verifica antes de escribir si hay asientos cuyo `source_id` no resuelve y aborta pidiendo un
reset. **Tocar cómo se calcula el `source_id` obliga a resetear staging, no a re-correr.**

### El gate original, para que quede el registro

**ACA PARAMOS.** Se manda el correo con las NUEVE consultas (abajo) y se pide la llamada de
validacion con RM. **NO se arranca el modulo de compras ni el Libro Mayor** hasta esa
validacion: es donde ya seria caro corregir.

### Lo que quedo funcionando

**Fase 1 completa** (tipo costo, nueve subcategorias NIIF 18, cuenta control, Estado de
Resultado con la estructura de Josuar, sociedad civil, fecha del saldo inicial).

**Fase 2 — motor de posteo**, el bloque que no depende de ninguna respuesta:

- `post_journal_entry(...)` — partida doble, periodo por fecha, correlativo sin huecos,
  cadena de hash. Es una FUNCION DE POSTGRES porque los triggers de inmutabilidad hacen que un
  posteo a medias desde la app deje una cabecera sin lineas imposible de limpiar.
- `ensure_accounting_periods()` + los 24 periodos de 2026 y 2027.
- La secuencia del correlativo.
- `apertura` en el CHECK de `source_type`.
- `verify_accounting_chain()` — verificador de la cadena.
- `contrapartida.ts` — el punto UNICO de esa decision, esperando la consulta 3.

352 tests, 0 fallos, mas 9 rechazos verificados de punta a punta contra staging.

### ✅ ESCRITURA DIRECTA AL LEDGER — CERRADA (migración 030)

Antes, `authenticated` tenía INSERT sobre `journal_entries` y la RLS dejaba pasar cualquier
fila de su propio tenant: podía forjar una cabecera con el `prev_hash` que quisiera. Y TRUNCATE
no lo frenaba nada, porque los triggers de inmutabilidad son `FOR EACH ROW` sobre UPDATE y
DELETE. Ahora:

| | anon | authenticated | service_role |
|---|---|---|---|
| INSERT / UPDATE / DELETE / TRUNCATE | ✗ | ✗ | ✗ |
| SELECT | ✓ | ✓ | ✓ |
| EXECUTE del RPC | ✗ | ✗ | ✓ |

`accounting_periods` conserva UPDATE para `service_role`: cerrar y reabrir un período es
administración legítima y todavía no hay función que la encapsule.

Aplicada en **BUNDLE_2**, que es lo que la hace sobrevivir al `ALTER DEFAULT PRIVILEGES` del
RESET_SQL. Fuera del bundle, la primera base recreada volvería a nacer abierta.

### 🔴 CONSECUENCIA OBLIGATORIA PARA LA FASE 3 — leer antes de escribir la primera línea

Con `EXECUTE` restringido a `service_role`, **el RPC deja de ser llamable desde la sesión del
usuario**. De ahí salen tres reglas que no son negociables:

1. **Todo el posteo va por rutas de API server-side** con el cliente de servicio. Un
   `postJournalEntry()` desde un client component da 403.
2. **El `tenant_id` lo valida la RUTA, ya no la base.** `SECURITY DEFINER` significa que el
   RPC no corre bajo RLS: confía en el `p_tenant_id` que recibe.
3. **La ruta lo saca del perfil del usuario autenticado, NUNCA del cuerpo del request.** Un
   `tenant_id` que llegue en el body es un intento de escribir en el ledger de otro bufete.

Es la única garantía de aislamiento que se mudó de la base al código. Escrita también en
`CLAUDE.md` §5 y en el encabezado de `posting.ts`.

### ✅ PERÍODOS — el precipicio de enero, resuelto

El motor ahora **auto-crea los períodos del año en curso y del siguiente**, y nada más.

Resuelve el problema donde dolía —el 1 de enero el primer asiento fallaba hasta que alguien se
acordara, justo cuando el contador cierra un ejercicio y abre el otro— sin perder el freno: un
2029 por error sigue fallando fuerte. Los años pasados tampoco se abren solos, porque crearlos
dejaría postear dentro de un ejercicio ya certificado.

### 📋 BACKLOG — enganchar el verificador de la cadena al respaldo nocturno

`verify_accounting_chain()` hoy solo corre si alguien se acuerda de correrlo, que es la peor
garantía posible para un control de integridad.

**El respaldo nocturno (`scripts/backup-supabase.mjs`) es lo único que ya corre todos los días
contra producción.** Colgarle la verificación ahí significa que una ruptura de la cadena se
detecta en **menos de 24 horas**, en vez de cuando a alguien se le ocurra mirar. No hay que
construir infraestructura nueva: el trabajo es agregar la llamada y decidir a dónde avisa
cuando devuelve filas.

Va DESPUÉS de la validación de RM, con el resto de la Fase 3.

### LO QUE NO SE HIZO Y POR QUE### LO QUE NO SE HIZO Y POR QUE

- **El ASIENTO DE APERTURA.** Espera la consulta 1 (fecha de corte). Lo cargado es una foto de
  mitad de año, no una apertura al 1 de enero, asi que un asiento de apertura hoy seria
  incorrecto se lo arme como se lo arme.
- **El LIBRO MAYOR.** Espera las consultas 3, 4 y 5, y la validacion de RM.
- **COMPRAS.** Despues de la validacion.

### PARA CUANDO SE RETOME EL LIBRO MAYOR

Columnas del modelo (`Temas Contables/image001.png`): cuenta de distribucion, fecha de la
transaccion, tipo de transaccion, numero, nombre del tercero, descripcion, cuenta de
contrapartida, importe y saldo corrido. Cada cuenta arranca con una fila "Saldo inicial" y
cierra con su total — que **es la suma de los movimientos, no el saldo final** (ver consulta 4).

**El requisito que Josuar repitio tres veces, dos niveles de profundidad:**
1. Desde un saldo del Balance o del Estado de Resultado → abrir el mayor de esa cuenta.
2. Desde una linea del mayor → llegar al documento que la origino.

Es lo que convierte el reporte en algo auditable.

---

## >>> Cierre anterior — FASE 1 COMPLETA — 27/08/2026 <<<

**Las seis tareas cerradas (0, 1, 2, 3, 4, 5).** 345 tests, 0 fallos.

Detalle en `changelog.md`; el como-tocarlo, en `sop.md` SOP-013.

### LO QUE SIGUE — el plan hasta el proximo alto

1. ~~Tarea 5~~ **HECHA.**
2. **FASE 2 — motor de posteo del ledger.**
3. **Libro Mayor.**

Ahi paramos, se manda el correo con TODAS las consultas acumuladas y se pide la llamada de
validacion. **NO se arranca el modulo de compras antes de esa validacion**: es donde ya seria
caro corregir.

### ⚠️ CONSULTAS ACUMULADAS PARA EL CORREO A JOSUAR — son NUEVE

Van TODAS juntas en un solo correo, con la llamada de validacion despues.

**BLOQUEANTES de la Fase 2 (sin respuesta no se puede escribir el asiento de apertura):**

1. **¿Cual es la fecha de corte de los saldos cargados, y que debe mostrar el patrimonio?**

   Es UNA sola pregunta, aunque se manifieste en dos pantallas. Lo cargado no es una apertura
   al 1 de enero: las cuentas de balance suman 244,476.91, las de resultado -244,476.91 y el
   patrimonio esta en cero. En una apertura de verdad las de resultado darian 0 y el resultado
   del año anterior ya estaria cerrado contra el patrimonio.

   El Balance muestra "Utilidad del Ejercicio -244,476.91" **porque el activo excede al pasivo
   mas patrimonio exactamente en ese monto**: sin esa linea no cuadraria. No es un problema de
   presentacion — es que los datos son un corte de mitad de año y el patrimonio no tiene nada
   que absorba el resultado.

   Si la respuesta es "1 de enero de 2026", hacen falta ademas los saldos de apertura reales de
   las cuentas de balance y las utilidades retenidas.

2. **¿Por que el Capital Social esta en 0.00?**

   Que las utilidades retenidas esten en cero se entiende si la sociedad distribuye todo cada
   año. Que el CAPITAL SOCIAL tambien lo este, no: las socias aportaron algo al constituir la
   firma. ¿Falta cargarlo, o esta en otra cuenta?

**Del LIBRO MAYOR (del modelo `Temas Contables/image001.png`):**

3. **La columna "cuenta de contrapartida" trae una CATEGORIA, no una cuenta** ("Proveedores",
   "cobrar clientes"). ¿Que va ahi cuando un asiento tiene mas de dos lineas y no hay una
   contrapartida unica? ¿"Varios", la de mayor importe, o una lista?

4. **El total del pie NO es el saldo final: es la suma de los MOVIMIENTOS.** En su ejemplo,
   Banco Pichincha cierra en `$6,740.01` mientras el saldo corrido va en `21,121.28`
   (12,412.00 − 1,712.00 − 351.25 − 3,608.74 = 6,740.01). ¿Quiere el movimiento neto del
   periodo, o ademas el saldo final?

5. **La columna "Importe" viene con signo, no en columnas Debe/Haber.** Nuestro ledger guarda
   debito y credito separados. Para una cuenta de pasivo o de ingreso, ¿el mayor muestra el
   signo natural de la cuenta o el de la balanza?

**De la DISTRIBUCION A SOCIAS:**

6. **¿Confirmamos el codigo `300004` y que sea de patrimonio** para la cuenta de distribucion?
   Hoy esta creada como provisional.

7. **¿Hace falta ademas un PASIVO "Por pagar a socias"** para cuando el reparto se declara pero
   no se paga de inmediato? Una cosa es asignar el resultado y otra es deberlo.

**Del MOTOR DE ASIENTOS:**

8. **¿Que formato quiere para el numero de asiento?** ¿Correlativo unico, o uno por tipo de
   transaccion? ¿Se reinicia cada periodo fiscal?

9. **¿Quien cierra un periodo contable y que bloquea el cierre?** La tabla `accounting_periods`
   ya tiene estado abierto/cerrado; falta la regla de negocio.

### PIEZAS QUE FALTAN PARA LA FASE 2 (ya identificadas)

- Sembrar `accounting_periods` (hoy 0 filas). `journal_entries.period_id` es NOT NULL.
- Sembrar `accounting_sequences` (hoy 0 filas) — ver consulta 7.
- Agregar `'apertura'` al CHECK de `source_type`, para poder EXCLUIR el asiento de apertura de
  los reportes de movimiento del periodo.
- El saldo inicial de la Tarea 5 es el que genera ese asiento: las filas con `saldo_inicial <> 0`
  se agrupan por `saldo_inicial_fecha` y cada grupo es UN asiento.
- **Los asientos son INMUTABLES** (6 triggers en `023`). Una vez posteado el saldo inicial, no
  se corrige editando: hay que revertir. Por eso creacion de cuenta y carga de saldo van
  separadas.

### EL REQUISITO QUE JOSUAR REPITIO TRES VECES

**Dos niveles de profundidad, y los dos hacen falta:**
1. Desde un saldo del Balance o del Estado de Resultado → abrir el mayor de esa cuenta.
2. Desde una linea del mayor → llegar al documento que la origino.

Es lo que convierte el reporte en algo auditable.

### PENDIENTES DE OLIVER

1. **`NEXT_PUBLIC_APP_URL` vacia en el entorno Preview de Vercel.** Previo a Fase 0.
2. **Recrear en PRODUCCION el indice de `client_payments(tenant_id)`.** Impacto bajo.

---

## >>> Cierre anterior — 27/08/2026 (tarde) <<<

**FASE 1 CONTABLE (NIIF 18) — Tareas 0, 6, 1, 2, 3 y 4 CERRADAS. Falta solo la 5.**

Listo para que RM Consultores lo pruebe en STAGING. Detalle en `changelog.md`; el
como-tocarlo, en `sop.md` SOP-013.

### Por que se adelantaron la 3 y la 4

Decision de Oliver: con la estructura vieja, Josuar habria comentado sobre la FORMA del
reporte en vez del contenido. Con la 3 hecha ve SU modelo con SUS numeros y puede aprobar de
verdad. Una vuelta de revision en vez de dos.

### Lo que quedo funcionando

- **Estado de Resultado con la estructura de Josuar**: bloques por actividad, ► Utilidad
  Bruta operativa, ► Utilidad Operativa, ► Utilidad antes de impuesto, ► Utilidad Neta.
  Bloques sin cuentas no se muestran.
- **Vuelco de signos SOLO en presentacion.** El motor sigue en balanza y los tests contra el
  Excel siguen siendo la red. Regla unica: `monto = |balanza|`, parentesis si `balanza > 0`.
- **Sociedad civil**: ISR en 0 (parametro conservado), seccion de distribucion a socias y el
  ejercicio cierra en cero por construccion.
- Cuenta `300004 Distribucion a Socias` (migracion 026). Codigo PARAMETRIZABLE.
- **333 tests, 0 fallos.** Los 5 totales siguen dando lo mismo que el Excel.
- `.env.local` ahora dice `NEXT_PUBLIC_APP_ENV=local` → banda VIOLETA en localhost.

### ⚠️ DECISION PENDIENTE DE JOSUAR — la mas importante

**El Estado de Resultado dice "Resultado del ejercicio 0.00" pero el Balance General sigue
mostrando "Utilidad del Ejercicio -244,476.91" en el patrimonio.** Se contradicen.

La Tarea 4 pedia la seccion solo en el Estado de Resultado, asi que el Balance no se toco.
Si el resultado se reparte, el patrimonio deberia mostrar la contraparte: una cuenta de
distribucion, o un pasivo "Por pagar a socias" si el reparto no se paga de inmediato. Es la
misma pregunta que la del codigo de la 300004 — conviene mandarlas juntas en el correo.

### LO QUE SIGUE

**Tarea 5 — saldos iniciales: SOLO el campo `fecha`.** Nada de ledger. El asiento de
apertura, los periodos, la secuencia, el `source_type='apertura'` y el Libro Mayor se van
completos a la FASE 2 con el motor de posteo.

Regla de Rose que hay que respetar: el periodo fiscal va del 1 de enero al 31 de diciembre y
"el 1 de enero de cada año las unicas cuentas que inician con saldos son las que pertenecen
al estado de situacion financiera". Las de resultado arrancan en cero cada año.

### PENDIENTES DE OLIVER

1. **Correo a Josuar** con las dos preguntas juntas: (a) codigo y naturaleza de la cuenta de
   distribucion (`300004` patrimonio, o ademas un pasivo "Por pagar a socias"), y (b) que
   debe mostrar el patrimonio del Balance cuando el resultado se reparte.
2. **`NEXT_PUBLIC_APP_URL` vacia en el entorno Preview de Vercel.** Es la que arma el link
   publico de cotizaciones. Previo a Fase 0.
3. **Recrear en PRODUCCION el indice de `client_payments(tenant_id)`.** Impacto bajo.

---

## >>> Cierre del 27/08/2026 (mañana) <<<

**FASE 1 CONTABLE (NIIF 18) — EN CURSO. Tareas 0, 6, 1 y 2 CERRADAS.**

Entregado para que RM Consultores lo pruebe en STAGING antes de seguir. Detalle completo en
`changelog.md`; el como-tocarlo, en `sop.md` SOP-013.

### Lo que quedo funcionando

- **Seis tipos de cuenta**: `cost` es tipo propio. Las 6 cuentas 500001-500006 migradas.
- **Nueve subcategorias NIIF 18**, obligatorias en cuentas de resultado activas, con selector
  filtrado por tipo y CHECK en BD *por tipo*.
- **`cuenta_control`** + cuenta `200004 Anticipo de Clientes`. Staging: 63 cuentas activas.
- **Permisos**: reclasificar es admin+contador; cuentas con movimientos no se reclasifican ni
  se desactivan (409, para todos).
- **Staging con saldos contables REALES** (`npm run seed:staging`, sin flags). Operacion
  ficticia, saldos reales. Clientes y casos siguen inventados.
- **Los reportes cuadran**: los 5 totales del Estado de Resultado y el Balance dan igual que
  antes de reclasificar. Utilidad Operativa -244,476.91, descuadre 0.00.

### LO QUE SIGUE — el resto de la Fase 1, en este orden

3. **Tarea 3 — Estado de Resultado con la estructura de Josuar.** Bloques por ACTIVIDAD
   (operacion / inversion / financiamiento), bloques vacios no se muestran, y **vuelco de
   signos SOLO en la capa de presentacion** (ingresos positivos, costos y gastos entre
   parentesis). El motor se queda en convencion de balanza: si se invierte ahi, el Balance
   General deja de cuadrar y se pierden los 22 tests que sirven de red.
4. **Tarea 4 — Sociedad civil.** Seccion de distribucion a socias, el ejercicio cierra en
   cero. `DEFAULT_ISR_RATE` pasa a 0 (hoy 0.25) pero el parametro se queda, pensando en
   vender el sistema a sociedades anonimas. Cuenta provisional `300004 Distribucion a Socias`
   (patrimonio) **con el codigo parametrizable** — Oliver se lo confirma a Josuar por correo,
   puede que quiera ademas un pasivo "Por pagar a socias".
5. **Tarea 5 — Saldos iniciales: SOLO el campo `fecha`.** El asiento de apertura, los
   periodos, la secuencia, el `source_type='apertura'` y el Libro Mayor se fueron completos a
   la **FASE 2** con el motor de posteo. La Fase 1 existe para que RM valide el plan de
   cuentas y los reportes; meterle el ledger la vuelve un proyecto de semanas.

### PENDIENTES DE OLIVER

1. **Confirmarle a Josuar por correo** la cuenta `300004 Distribucion a Socias` y si ademas
   quiere un pasivo "Por pagar a socias" para cuando la distribucion no se paga de inmediato.
2. **`NEXT_PUBLIC_APP_URL` esta VACIA en el entorno Preview de Vercel** (figura scopeada a
   Preview+Production, 115d). Es la que arma el link publico de cotizaciones, asi que en
   preview el boton "copiar link" probablemente genere una URL rota. Previo a Fase 0.
3. **`.env.local` dice `NEXT_PUBLIC_APP_ENV=staging`**, no `local`. Por eso en localhost sale
   la banda AMBAR "STAGING" y nunca la VIOLETA "LOCAL" que describe el CLAUDE.md §9. No es
   peligroso (las dos dicen "no es produccion") pero la distincion local-vs-staging que el
   banner fue disenado para hacer hoy no existe. Decidir: cambiar el .env o corregir el §9.
4. **Recrear en PRODUCCION el indice de `client_payments(tenant_id)`.** Sigue pendiente de
   Fase 0. Impacto bajo (25 filas).

---

## >>> Cierre anterior — 25/08/2026 <<<

**Fase 0 (ambiente de pruebas) CERRADA.** Staging (`xtyenhakplrkyifbcaow`) tiene el esquema
completo, datos ficticios y aislamiento verificado; `.env.local` apunta ahi, la app muestra
banda de entorno cuando no corre contra produccion, y produccion se toca solo por merge a
main. Detalle abajo y en `sop.md` SOP-012.

### Levantar staging desde cero — dos comandos

```bash
node scripts/apply-staging-sql.mjs --reset    # esquema (48 archivos, en orden)
npm run seed:staging                           # datos ficticios (idempotente)
```

Necesita `.env.staging-db.local` con la connection string del **session pooler** (puerto
5432, no 6543). Ya esta en la maquina de Oliver, ignorado por git. Sin ese archivo el script
dice exactamente que falta.

Usuarios de prueba: `admin@staging.test` / `Staging2026$Admin`. Los otros cuatro roles y sus
claves, en `sop.md` SOP-012.

### PENDIENTES DE OLIVER — los tres, ninguno bloquea

1. ~~**Cargar las 4 variables en el panel de Vercel.**~~ **HECHO el 27/08/2026 por Oliver.**
   `vercel env pull --environment=preview` devuelve `NEXT_PUBLIC_APP_ENV="staging"` y el ref
   de staging, asi que el alcance quedo bien. El procedimiento (Vercel rechaza claves
   duplicadas si los entornos se solapan; hay que acotar la vieja a Production ANTES de crear
   la de staging) quedo documentado en `sop.md` SOP-012. Falta la verificacion en el preview
   ya construido — Vercel no aplica variables a deploys viejos.
2. **Recrear en PRODUCCION el indice de `client_payments(tenant_id)`.** No existe: al
   aplicar `b3d_payments` a mano se borro o renombro el viejo para que el nuevo pasara.
   Impacto bajo (25 filas). En staging las dos tablas quedan indexadas.
3. **Corregir el encabezado de `20260508000002`.** Dice "YA APLICADO EN PRODUCCION
   2026-05-08" y su **seccion 5 no lo esta**. O se corrige el encabezado, o se parte el
   archivo en dos migraciones. Hoy miente por omision.

### LA REVISION QUE PUEDE DESTAPAR MAS SORPRESAS

**Las migraciones marcadas como "retro-documentacion" nunca se ejecutaron.** Se escribieron
DESPUES de aplicar el cambio a mano en produccion, asi que nadie las corrio nunca y el .sql
puede no reflejar lo que realmente quedo en la base.

`20260508000002` es la prueba: arrastro un bug de sintaxis dos meses y media seccion sin
aplicar, y nadie lo supo hasta que se aplico el repo de corrido sobre una base limpia por
primera vez. Las candidatas conocidas son las tres que llevan el aviso en el encabezado:

- `20260508000001_clients_add_status_and_type.sql`
- `20260508000002_quotes_extension_and_terms_template.sql`  ← ya sabemos que tiene el problema
- `20260508000003_clients_drop_active_legacy.sql`

Como revisarlas, sin tocar produccion: correr `node scripts/apply-staging-sql.mjs --reset`
sobre staging y comparar el esquema resultante contra produccion columna por columna
(`information_schema.columns`). Lo que difiera es una seccion que no se aplico, o que se
aplico distinto de como dice el archivo.

### LO QUE SIGUE — modulo contable, Fase 1

Plan de cuentas con **subcategorias NIIF 18** y el **sexto tipo de cuenta (costo)**.

**BLOQUEADO esperando respuestas del contador (Josuar). NO arrancar.** Queda anotado solo
para saber cual es el proximo bloque. Ahora que existe staging, se puede desarrollar y
probar sin escribir asientos en los libros del bufete — que era justamente el motivo de que
Fase 0 fuera bloqueante.

---

## === FASE 0 — AMBIENTE DE PRUEBAS (25/08/2026) — CERRADA ===

Staging: `xtyenhakplrkyifbcaow`. Produccion: `uqmmkklbhzxqybljiecs`.

| # | Tarea | Estado |
|---|---|---|
| 1 | Inventario de migraciones | CERRADA — `docs/staging/inventario-migraciones.md` |
| 2 | Script de datos ficticios | CERRADA — `npm run seed:staging`, idempotente verificado en 3 corridas |
| 3 | Aplicar el esquema en staging | CERRADA — 48 archivos, 45 tablas, 51 politicas RLS, 6/6 triggers del ledger |
| 4 | Configuracion de entornos | CERRADA en local — falta cargar las 4 vars en Vercel (lo hace Oliver) |
| 5 | Salvaguarda visual | CERRADA — banda verificada en login y dentro de la app |
| 6 | Verificar el aislamiento | CERRADA — ZZZ-999 en staging; prod re-verificada DESPUES de la sesion: 207 casos, 134 clientes, intacta |
| 7 | Documentar | CERRADA — SOP-012, CLAUDE.md §9 y DB Safety, changelog |

### Pendiente de Oliver (no tecnico)

- Cargar las 4 variables en el panel de Vercel (tabla en `sop.md` SOP-012).
- Recrear en PRODUCCION el indice de `client_payments(tenant_id)`, que no existe.
- Corregir el encabezado de `20260508000002`: dice "YA APLICADO" y su seccion 5 no lo esta.
- Revisar las demas migraciones marcadas como "retro-documentacion": ninguna se ejecuto
  nunca, asi que pueden tener el mismo tipo de bug latente.

### Deuda descubierta al aplicar las migraciones — CADA UNA NECESITA MIRAR PRODUCCION

Las tres salieron de aplicar el repo de corrido sobre una base limpia, que **nunca se habia
hecho**. Ninguna es urgente; las tres son silenciosas.

1. **La seccion 5 de `20260508000002` NUNCA se aplico en produccion, y el archivo no lo
   dice.** RESUELTO el 25/08. El encabezado afirma "YA APLICADO EN PRODUCCION 2026-05-08" y
   es cierto para 7 de sus 8 secciones. La 5 —la que dropea las columnas generadas de
   `quote_lines`— nunca corrio, porque tiene un bug de sintaxis adentro (una variable
   PL/pgSQL `is_generated` que choca con la columna homonima de `information_schema`).
   Quien lo aplico a mano se comio ese error y siguio de largo.

   Verificado en produccion por Oliver:
   ```
   subtotal   -> ALWAYS  (quantity * unit_price)
   tax_amount -> ALWAYS  ((quantity * unit_price) * tax_rate)
   line_total -> ALWAYS  ((quantity * unit_price) * (1 + tax_rate))
   ```
   El "trigger T8b-quote" que la seccion promete **no existe en ningun lado**, y nunca hizo
   falta: las columnas nunca dejaron de ser GENERATED.

   Accion tomada: staging saltea la seccion 5 (`scripts/staging-fixups.mjs`, FIXUP 2). Las
   dos bases calculan igual. **Pendiente en el REPO:** corregir el encabezado del archivo
   para que diga que la seccion 5 no esta aplicada, o partirla en dos migraciones. Hoy el
   archivo miente por omision y la proxima persona va a tropezar con lo mismo.

   Y la leccion mas general: **hay que revisar las otras migraciones marcadas como
   "retro-documentacion"**, porque ninguna se ejecuto nunca y pueden arrastrar el mismo tipo
   de bug sin que nadie lo sepa.

2. **`idx_payments_tenant` esta definido dos veces**, sobre `client_payments` y sobre
   `payments`. Los nombres de indice son globales por esquema, asi que el segundo no pudo
   correr limpio. **VERIFICADO en produccion (Oliver, 25/08) y salio al reves de lo supuesto:**
   ```
   payments        -> SI tiene idx_payments_tenant
   client_payments -> NO tiene indice sobre tenant_id (solo idx_payments_case)
   ```
   Al aplicar b3d_payments a mano se borro o renombro el indice viejo para que el nuevo
   pasara, y nadie recreo el de `client_payments`. **Pendiente en PRODUCCION:** recrear ese
   indice. Impacto bajo hoy (25 filas). En staging las dos tablas quedan indexadas, o sea
   que aca esta mejor que en produccion.

3. **`20260508000002` tiene un bug de sintaxis y nunca se ejecuto.** Declara una variable
   PL/pgSQL `is_generated` que choca con la columna homonima de `information_schema.columns`.
   Su encabezado dice "retro-documentacion del cambio aplicado manualmente": el cambio se
   hizo a mano y el .sql se escribio despues, sin correrlo. Vale revisar si otras migraciones
   marcadas como retro-documentacion tienen el mismo problema.

### Convergir produccion a public.* — SPRINT PROPIO, NO AHORA

Staging usa `public.tenant_id()` / `public.user_role()`; produccion usa `auth.*`. Supabase
desaconseja poner objetos propios en `auth`, y los proyectos nuevos directamente lo prohiben,
asi que a futuro conviene que produccion tambien use `public`. Implica **recrear todas las
politicas de RLS** (51) y merece su propia migracion, su propio deploy y su propia
verificacion. No es un cambio al pasar.

### Respaldo de produccion — CERRADO el 25/08

`scripts/backup-supabase.mjs` parseaba `.env.local`, asi que al reapuntarlo a staging el
respaldo iba a copiar staging rotulandolo "PRODUCCION" y a borrar los respaldos buenos por
retencion. Oliver lo arreglo el mismo dia, antes de la corrida automatica de las 20:30: ahora
lee `.env.produccion.local`, ABORTA si el project ref no esta en `PROD_PROJECT_REFS`, y el
manifiesto graba `project_ref`. Ya esta versionado.

## === CAMBIO 24/08/2026 — ALCANCE DEL ROL ASISTENTE (fuera de fase) ===

Decisión de negocio del cliente. Detalle en `changelog.md` → `[FEAT] 2026-08-24`.

- [x] El asistente queda como rol de consulta y constancia: ve Dashboard, Casos (todos, solo
      lectura) y Mis Pendientes; dentro de un caso SOLO sube documentos y comenta.
- [x] Gastos fuera de su alcance: ítem del menú, pantalla `/legal/gastos` (bloqueada por
      middleware) y tab "Gastos" del detalle, con `?tab=gastos` normalizado a `info`.
- [x] Cambio de estado fuera de su alcance: `<CaseStatusChanger>` gateado a admin/abogada.
- [x] **Guards server-side** con el helper `requireRole`: `POST /api/expenses` (que no validaba
      rol en absoluto — hallazgo #3 de la revisión OWASP), `PATCH`/`DELETE /api/expenses/[id]`
      y `PATCH /api/cases/[id]` para toda acción. Documentos y comentarios sin tocar.
- [x] `CLAUDE.md` §4 reescrito: su tabla contradecía el alcance nuevo y lo habría revertido
      en la próxima sesión que leyera el archivo.
- [x] Verificado en navegador el 24/08/2026 en las dos sesiones, incluidos los 403 pedidos
      directo a la API con sesión de asistente. Test `patch-role-by-action` 4/4.
- [x] **CERRADO el 24/08/2026** (decisión de Oliver): el asistente tampoco crea tareas. Se le
      retiró `<AddTaskForm>` del tab Seguimiento, `POST /api/tasks` le responde 403 y
      `POST /api/todos` rechaza asignarle un pendiente a otra persona. `PATCH /api/tasks/[id]`
      NO lleva gate de rol —cumplir tareas es su flujo diario— pero ahora va por PROPIEDAD:
      solo cierra las asignadas a él. Cubierto por `patch-task-ownership.test.ts` (4/4).
- **Migraciones: NINGUNA.**

## === FIX 22-23/08/2026 — ROL ASISTENTE (fuera de fase) ===

Trabajo de arreglo, no un hito del plan. Se deja registrado acá para que no quede solo en el
changelog. Detalle completo en `changelog.md` → `[FIX] 2026-08-22`.

- [x] **Panel del asistente decía la verdad equivocada.** `/legal` mostraba "Casos Asignados"
      contando `cases.assistant_id` (siempre 0) mientras `/legal/casos` le listaba los 207 del
      bufete. Pasa a **"Casos del Bufete"** y cuenta el tenant completo. Las tarjetas de tareas
      siguen siendo personales (`tasks.assigned_to`).
- [x] **Selector "Abogada Responsable" filtrado por rol** en detalle, crear y editar. El bug de
      fondo estaba en `/legal/casos/[id]/editar`: la query de `users` no traía `role`, y el
      fallback `|| !t.role` metía admin y contador en la lista de abogadas.
- [x] **`cases.assistant_id` retirado de la UI** (decisión de negocio). Fuera de los formularios,
      del display del detalle, de la columna del listado y del body del PATCH. **La columna sigue
      en la BD** (regla aditiva) — reversible sin migración. Se conserva en `trackedFields` para
      que la auditoría lo siga registrando.
- [x] Verificado en navegador el 23/08/2026 con sesiones reales de asistente (Harry Boyd) y admin
      (Oliver Calvo), incluido guardado con `PATCH 200` y persistencia confirmada. Tablas de
      verificación en `changelog.md`.
- [x] `tsc --noEmit` limpio; lint sin errores nuevos (quedan 4 preexistentes).
- **Migraciones: NINGUNA.**

## === ESTADO 14/08/2026 — PLAN DE TRABAJO CON JOSUAR (5 PASOS) ===

Josuar bajó el requerimiento contable a **5 pasos secuenciales** en la reunión del 10/08/2026.
Detalle completo en `docs/finanzas/roadmap-contable.md` §10.

### Paso 1a — Plan de cuentas: saldo inicial + subcategoría — CERRADO 14/08/2026
- [x] Migración `sql/pending/024_chart_of_accounts_saldo_subcategoria.sql` **aplicada en Supabase**
      por Oliver (aditiva e idempotente: `saldo_inicial numeric(14,2) NOT NULL DEFAULT 0` +
      `subcategoria text NULL`).
- [x] Backend (tipos, validadores, create/update + audit_log, route handlers) y UI (form + 2
      columnas nuevas en el listado). Tests 27/27 verde, `tsc --noEmit` limpio, lint sin hallazgos
      nuevos. Detalle en `changelog.md`.
- [x] **Verificado en navegador** (localhost:3000, admin): crear `999001` con saldo `12500.75` +
      subcategoría *Activo corriente* → editar a *Activo no corriente* / `-8400.25` (rojo) →
      desactivar. `audit_log` con 3 entradas correctas; el toggle auditó **solo `active`**,
      confirmando que ya no pisa saldo ni subcategoría.
- [ ] **Limpieza pendiente (Oliver):** la cuenta de prueba `999001` quedó en la BD del cliente,
      **inactiva**. No hay hard delete desde la UI. El `DELETE` está consolidado en el Paso 1b junto
      con las de esa verificación. No colisiona con las 62 cuentas de Josuar (códigos distintos).

### Paso 1b — Carga masiva por Excel — CERRADO 14/08/2026
- [x] Sin migración (usa las columnas del 1a). Módulo puro de mapeo + capa XLSX + endpoint
      `POST /api/finanzas/configuracion/chart-of-accounts/bulk` (preview/commit) + panel de UI.
- [x] Lectura tolerante: traga la plantilla propia Y el balance de comprobación de Josuar (filas de
      título arriba, encabezados alternativos, columnas extra, fila TOTALES).
- [x] Upsert por `(tenant, código)`; el update **preserva `description` y `active`** (no vienen en
      el Excel y el PATCH es reemplazo total).
- [x] Tests 45 nuevos (34 del módulo puro + 11 del endpoint), `tsc` limpio, lint sin hallazgos.
- [x] **Verificado en navegador**: plantilla descargada, Excel formato Josuar subido → 5 creadas;
      mismo archivo de nuevo → 5 actualizadas sin duplicados; `audit_log` con 5 create y 0 update.
      Detalle en `changelog.md`.
- [ ] **Limpieza pendiente (Oliver):** cuentas de prueba en la BD del cliente. Para borrarlas:
      `DELETE FROM chart_of_accounts WHERE code IN ('999001','910001','910002','910003','910004','910005') AND tenant_id='a0000000-0000-0000-0000-000000000001';`
- [x] **Las 62 cuentas de Josuar ya están cargadas** con el importador ("62 creada(s) · 0
      actualizada(s) · 0 con error") y las 35 viejas de QB quedaron desactivadas. Total en BD: 97
      filas, 62 activas.

### Paso 2 — Balance General y Estado de Resultado — CERRADO 14/08/2026
- [x] Sin migración. Capa de datos aislada (`accounting-source.ts`, único archivo a cambiar en el
      Paso 3) + armado puro (`accounting-reports.ts`) + UI que reemplaza los placeholders de
      `/finanzas/reportes/{balance,pyl}`.
- [x] Convención de signos de Josuar (balanza, sin invertir): ganancia en negativo, Total Pasivo +
      Patrimonio igual y opuesto al Total de Activo.
- [x] **Los 10 totales coinciden exactamente con el Excel de Josuar** y el balance cuadra
      (descuadre 0.00). Verificado en tests (fixture con las 62 cuentas reales) y en navegador.
- [x] ISR como parámetro (default 25%, solo si hay utilidad), marcado como provisional en la UI.
- [x] Cuentas sin subcategoría caen en un grupo "Sin clasificar" que suma al total y se avisa, en
      vez de desaparecer del reporte.
- [ ] **Pendiente de Josuar** (marcado en la UI, no asumido): tasa y método del ISR · si el
      patrimonio lleva la utilidad operativa o la neta · fecha de corte de los saldos de apertura.
- [ ] **Riesgo abierto:** la cuenta `300003 Utilidad del Ejercicio` existe en el plan Y el reporte
      agrega el renglón calculado. Hoy da bien porque está en 0; si le cargan saldo se contaría dos
      veces. Hay aviso ámbar automático (mira el saldo, no el nombre) y el descuadre se muestra. Se
      resuelve cuando el cierre de ejercicio postee el resultado a la cuenta (Paso 3+).

### Pasos 3 a 5 — NO ARRANCADOS
3) enganche factura→asiento (centro de costo) · 4) módulo de compra · 5) asientos manuales +
auxiliares de antigüedad.

## === ESTADO 04/08/2026 — MÓDULO CONTABLE ===

### Fase 1 (schema del ledger) — LISTA EN CÓDIGO, PENDIENTE DE APLICAR
`sql/pending/023_contabilidad_fase1_ledger.sql` **reescrito y commiteado a `develop`**. Sale del
estado ⛔ EN ESPERA: ya no recrea `chart_of_accounts` (choque con el de producción,
`20260505000002_finanzas_catalogos.sql`, `account_type` en inglés + 34 cuentas + UI desplegada).
Ahora crea **solo el motor**: `accounting_periods`, `accounting_sequences`, `journal_entries`,
`journal_entry_lines`, `accounting_legajos` + 7 índices + 6 triggers de inmutabilidad + RLS por
tenant, con `journal_entry_lines.account_id` por **FK al COA existente**. Aditivo, 5 tablas nuevas
y vacías. Detalle completo en `changelog.md`.

- [ ] **Aplicar en Supabase prod** (Oliver — **pausa obligatoria**, cambio de schema). El archivo
      es **idempotente**: se puede re-ejecutar sin error (`DROP ... IF EXISTS` antes de los 6
      triggers y de la política, porque Postgres no admite `IF NOT EXISTS` en ninguno de los dos).
      Aplicarlo **completo de una pasada**, no sentencia por sentencia, para que el DROP+CREATE de
      cada trigger caiga en la misma transacción. Correr las 4 queries de verificación del pie:
      5 tablas / 6 triggers / 5 políticas / FK al COA.
- Sin código, sin deploy. **Tipos TypeScript a propósito NO creados** — van en la Fase 2, con la
  lógica que los use.

### Fase 2 (posteo + verificador + factura→asiento) — BLOQUEADA POR EL CONTADOR
No arranca hasta que **Josuar confirme el plan de cuentas definitivo**. Los modelos que mandó el
01/08 usan una codificación **distinta** a las 34 cuentas de QB (ingresos `4xxxxx`, costos `5xxxxx`,
gastos `6xxx`, activos `1xxxxx`, pasivos `2xxxxx`, patrimonio `3xxxxx`) → la Fase 1 contable de
negocio es un **mapeo**, no una validación directa. El ledger en sí es chart-agnostic, así que el
schema no se bloquea; sí se bloquea la lógica que decide **qué cuenta** se afecta.

Alcance de la Fase 2 cuando se desbloquee:
- RPC de posteo: correlativo sin huecos + hash-chain + validación **Σdébitos = Σcréditos** (no es
  expresable como CHECK, abarca varias filas) + período abierto.
- Función verificadora de la cadena de hashes (auditoría / aval CPA).
- Enganche **factura→asiento** (DEBE cuentas por cobrar / HABER ingreso + HABER ITBMS por pagar).
- Tipos TypeScript del ledger.
- Asientos manuales para **saldos de apertura** (esperan fecha de corte de Josuar).

### Sigue esperando de Josuar
Plan de cuentas final · saldos de apertura + fecha de corte · respuestas a las 4 preguntas de
tratamiento contable (reembolsos, devengado vs caja, ITBMS en reembolsos, anticipos en custodia,
enviadas 01/08) · modelos de los informes restantes. Ver `docs/finanzas/roadmap-contable.md`.

### No commiteado
`sql/pending/022_backfill_dv_embebido.sql` sigue **untracked** — fuera del alcance de este cambio.

## === ESTADO 13/07/2026 ===

### Cerrado hoy
- **Bug eFactura "Error interno" (FAC-REI-000039)** → causa raíz: el receptor CLI-116 tenía `client_type` NULL; el gate no lo validaba y el mapper (`buildRucReceptor`) lanzaba Error plano → 500 genérico. No era REI-específico. Verificado en prod (0 filas en `fe_emisiones`).
- **Fix del gate** (`validateClientFiscalGate` valida `client_type` para tipo 01/03) → en `develop` (**b735408**), tests 17/17 verde, tsc limpio. **SIN desplegar** (pendiente decisión de merge a main).
- **Backfill `client_type`**: 26 clientes legacy con NULL corregidos en prod (7 jurídicas / 19 naturales). Quedan 3 dudosos esperando confirmación de licenciadas: CLI-068, CLI-093, CLI-094. SQL en `sql/pending/backfill_client_type_null.sql`.
- **Seguridad — Storage aislado por tenant (APLICADO en prod)**: se reemplazaron las 7 políticas abiertas del bucket `documents` por 4 `tenant_scoped_*` (RLS por primer folder = tenant_id). Verificado + smoke test OK. `sql/pending/storage_rls_tenant_scoped.sql`. **OJO**: `auth.tenant_id()` NO existe en prod (migración `20260403000001` nunca se aplicó); las políticas leen el claim JWT `app_metadata.tenant_id` inline. Implicación: la RLS de tablas que dependa de esa función probablemente tampoco está operativa (la app bypassa RLS con service-role de todos modos — ver roadmap de seguridad).
- **Docs de cumplimiento/seguridad** (fuera del repo, en carpeta Ciberseguridad del cliente): revisión OWASP del código real, roadmap de cumplimiento legal Panamá (DE 34/1998, Ley 81, Ley 23, Ley 52), gap analysis. Decisiones tomadas: el CRM **reemplazará a QuickBooks** (implica núcleo contable inmutable + aval CPA) y **SaaS a futuro** (priorizar aislamiento multi-tenant real, hoy dependiente de filtro manual).

### Esperando a las licenciadas
- Reintento de emisión de FAC-REI-000039 (client_type ya corregido). **Riesgo latente**: es una factura REEMBOLSO con una línea gravada al 7% + reembolsos exentos; el mapper manda el CPBS de reembolso (`8012`, provisional) a las 3 líneas → posible rechazo del PAC. El modelo es "una factura = un solo tipo"; una factura mixta puede ser error de armado. Confirmar con licenciadas si esa línea gravada debía ir en una FAC-HON aparte.
- Confirmar los 3 clientes dudosos (naturaleza jurídica/natural).

### Backlog — Features solicitadas por licenciadas (13/07)
1. **T&C por defecto (XS)** — La infra YA existe (`terms-template-editor.tsx`, `quote-terms.ts`, admin-only, quote-scoped; `InvoiceDocument.tsx`/`CreditNoteDocument.tsx` ya referencian términos). Solo falta cargar el texto final aprobado como default. Decisión: ¿solo cotizaciones o también en el PDF de facturas/recibos? Solo-cotizaciones = cero código.
2. **Recibo de venta no fiscal (M)** — No existe (invoice_kind solo HON/REI, todo va al PAC). Nuevo tipo de documento que NO toca el PAC, sin CUFE/QR, numeración propia (REC-NNN). Reusar infra de facturas (líneas/PDF/pagos). **Diseñar como ingreso de primera clase que alimente reportes y el futuro núcleo contable; evitar doble conteo si luego se factura.**
3. **Agenda / calendario (M el MVP, L completo)** — Greenfield (no hay tabla events ni vista calendario). MVP: tabla eventos + vista mensual + evento opcional ligado a cliente/caso. v2 (lo que lo hace L): traer deadlines de casos + tareas al calendario + recordatorios por correo (Resend ya integrado). Menor prioridad de cumplimiento.

> Prioridad honesta: ninguna de las 3 compite con MFA (Fase 0 seguridad) ni con el núcleo contable (obligatorio por reemplazo de QuickBooks). T&C es gratis; el recibo se diseña de la mano del trabajo contable.

### Regla fiscal confirmada — numeración FE (PAC / Ideati, 14/07)
Daniel Tarqui (Ideati) confirmó por correo, sobre el `numeroDocumento` por punto de facturación:
- Las secuencias **no son estrictas**, pero **deben ir en orden ascendente**.
- Se permiten **saltos** (números no autorizados entre autorizados), pero **no muy amplios**: recomendado que la diferencia sea de **1 a 4** (no saltar de la 1 a la 100).
- **Los números NO autorizados se pueden reutilizar** (solo los que nunca recibieron CUFE).
- Estado actual punto 051: autorizadas 1, 2, 6 → ascendente OK, salto 2→6 = diferencia 4 (borde del rango, DENTRO de tolerancia). Sin problema fiscal hoy.

**Backlog (no urgente): ajustar el asignador `fe_secuencias` / `allocate_fe_numero` para REUSAR números no autorizados** en vez de quemarlos (hoy "Política A: quema y no reusa"). Así los saltos quedan en ~0 y nunca se acercan al límite aunque haya rachas de intentos fallidos. Existe ya lógica "allocate-o-reuso (D-3)" en T1 de la orquestación — revisar por qué no reusó en FAC-REI-000039 (quemó 3,4,5).

### DV auto-resolución — respuesta de Ideati (Daniel Tarqui, 10/07)
Ideati expone endpoint `/QueryRucDvPac/{tipo}/{ruc}` (tipo: 1=natural, 2=jurídica; ej. `/QueryRucDvPac/2/1-1-1`). Resuelve el pendiente "esperando Ideati" del bloque 09/07. **Pendiente confirmar el formato de respuesta**: ¿devuelve el DV + tipo, o solo verifica existencia? Requiere enviar el tipo de contribuyente ya conocido. Backlog: auto-completar DV desde el RUC en el form de cliente (ahorra la captura manual a las licenciadas).

### ⏳ PENDIENTE DE DEPLOY (develop → main, requiere OK de Oliver + smoke test)
En `develop` hay **2 fixes de la ruta de emisión eFactura SIN desplegar**, para ir juntos en el próximo deploy:
1. **Gate valida `client_type`** para receptor 01/03 (b735408) → convierte "Error interno" en mensaje accionable.
2. **Reuso del correlativo FE** → una factura quema como máximo UN número, reusado en sus reintentos (antes cada reintento quemaba otro). **Code-only, SIN migración** (AG decidió, con razón, no tocar la RPC fiscal `allocate_fe_numero`; el reuso entre facturas distintas sería inseguro).
- Al mergear develop→main (**pausa obligatoria**): smoke test post-deploy = emitir una factura normal y confirmar CUFE limpio. Los dos tocan la misma ruta, así que se prueban de una.

## === ESTADO 09/07/2026 ===

eFactura PRODUCTION-READY y en uso real por las licenciadas.
- Primera factura a cliente REAL autorizada: FAC-HON-000464 (LABORATORIOS HERMANI, $80.25) — ES REAL, NO ANULAR.
- FAC-HON-000463 (prueba Integra-a-Integra $1.07) — dejar como está o anular por el portal del PAC (NO por el botón del CRM).
- Escenario probado: solo tipo 01 (contribuyente jurídico con RUC+DV). FALTA PROBAR tipo 02 (consumidor final, cédula sin DV) cuando surja un cliente natural.
- Disclaimer de anulación FE desplegado (merge 27f01af): el botón Anular del CRM avisa que la anulación real se hace en el portal del PAC + checkbox obligatorio para facturas con CUFE.

### === BACKLOG PRÓXIMA SESIÓN (en orden) ===
1. Fix "sin RUC" en diálogo de emisión (bug cosmético, YA diagnosticado, fix listo de 3 líneas): el diálogo lee client.ruc legacy en vez de tax_id. Fix en 3 lugares: types/invoice.ts:229 (agregar tax_id al tipo), queries/invoices.ts:118 (agregar tax_id al select del fkey), facturas/[id]/page.tsx:336 (receptorRuc = tax_id ?? ruc ?? null). No toca emisión ni mapper. Aplicar mañana.
2. RUC obligatorio para tipo 01/03 en el form de cliente (hoy solo se valida DV).
3. Backfill/validación de client_type NULL en clientes (afecta inferencia de tipo_receptor_fe).
4. Sprint FE-ANULACIÓN: implementar el evento CreateCancellation al PAC para que el botón haga la anulación fiscal real ante la DGI (hoy solo anula local). Al completarlo, el disclaimer del punto anterior desaparece.
5. Link "Abrir en portal DGI" con digestValue mal formado (consulta por QR falla; por CUFE directo funciona).
6. Retención de ITBMS en emisión (facturas con agente de retención) + confirmar CPBS_REI real con contador.

### === ESPERANDO RESPUESTA EXTERNA ===
- Ideati: si exponen endpoint feConsRucDV (RUC→DV+tipo) vía su API → automatizaría el DV y las licenciadas dejarían de cargarlo a mano. Correo enviado.

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

### A-0. ESTADO AL 03/09/2026 — por acá se retoma

`develop`, **575 tests en verde**, `tsc` limpio. Los 21 errores de ESLint son la deuda vieja
de A-bis: este día no agregó ni quitó ninguno. Producción intacta.

**Hecho hoy (commit único):**

1. **Auditoría del inventario del 25/08, fila por fila contra el código.** Las ocho secciones
   de `REQUISITOS-REUNION-25-AGOSTO.md`. **Once filas estaban mal marcadas, en los dos
   sentidos.** El documento se reescribió: se eliminó el bloque narrativo "estado al cierre
   del día" que competía con las tablas, y ahora **cada fila lleva su prueba en
   `archivo:línea`**. Esa doble fuente de verdad es lo que lo hizo mentir tres veces en dos
   días.
2. **`sql/pending/035`** — los 6 servicios `REIM-*` de `2201` a `130003`. Aplicado a staging,
   idempotencia verificada. **Producción NO.**
3. **`033` y `034` al `BUNDLE_2`** de staging: se habían aplicado a mano el 02/09 y sin ellas
   un `--reset` armaba una base sin proveedores y sin el UNIQUE de asiento por documento.
4. **"Pago" → "Cobro"** en `add-expense-form.tsx` y `section-expense-form.tsx`. Cierra el
   punto 2 del estado del 02/09.

**Los tres bloqueos reales, confirmados contra el código** (el resto de lo que falta se puede
construir hoy):

1. **La fecha de los saldos cargados** → el asiento de apertura. Ver A-quinquies. Puede
   resolverse sin preguntar: a qué fecha se generó el reporte de QuickBooks.
2. **Qué cuenta de ingreso ACTIVA va en cada servicio** → el cableado factura→asiento.
   `services_catalog.revenue_account` de los `HON-*` sigue en `4101`, del plan viejo e
   inactiva.
3. **Contra qué cuenta va el ITBMS que el bufete PAGA** → el asiento de compras. No es
   `200003` (ese es el que cobró y le debe a la DGI); el de compras es crédito fiscal, un
   activo, y **no hay cuenta para eso en el plan**.

**Ya NO están bloqueados** (el inventario decía que sí): el banco del cobro (Rose contestó —
falta el campo, `payments` no lo tiene), el reembolso a `130003` (hecho hoy), los ocho
renglones de gastos de trámite (el acta decidió su asiento), el capital de las socias (Rose:
"debe existir la opción"), y la captura del reporte de antigüedad de Josuarth — **obsoleta**,
el reporte ya está construido.

**Pendiente, en este orden:**

0. ✅ **PRE-FLIGHT DE `expenses` — HECHO (Oliver, 03/09).** 128 gastos, 0 en cero o negativos,
   0 sin concepto, 97 con comprobante, min/max 0,50 / 3.033,00. El `CHECK` de
   `expense_lines.amount` quedó en `> 0`. La consulta queda abajo por si hay que repetirla el
   día del deploy a producción, que es lo recomendado.

   <details><summary>La consulta</summary>

   ~~~sql
   SELECT COUNT(*) AS total,
          COUNT(*) FILTER (WHERE amount <= 0) AS cero_o_negativos,
          COUNT(*) FILTER (WHERE concept IS NULL OR btrim(concept) = '') AS sin_concepto,
          COUNT(*) FILTER (WHERE receipt_url IS NOT NULL) AS con_adjunto,
          MIN(amount), MAX(amount)
     FROM expenses;
   ~~~
   </details>

1. **EL BLOQUE: gastos de trámite con encabezado + líneas, y su asiento.**

   **Hecho y commiteado (03/09):** modelo de líneas compartido con compras
   (`types/expense-line.ts`), validador, editor reusable
   (`components/finanzas/expense-lines-editor.tsx`), pantalla contable
   `/finanzas/gastos-tramite/{id}` con su recorte de privacidad (SOP-022) y el permiso del
   contador, migración `036` (tabla + 4 columnas de encabezado + backfill + 5 verificaciones),
   migración `037` (el `CHECK NOT VALID` que cierra el hueco del validador, SOP-023), y la
   limpieza de los sin clasificar: vista "Gastos" en `/legal/gastos` con chip, selector por
   fila y asignación masiva que **solo llena blancos**.

   **`038` HECHA (03/09):** el CHECK de `source_type` con `'gasto_tramite'` (filtrado por
   contenido y verificando que `je_reversion_requires_ref` siga en pie), el builder puro del
   asiento, `POST /api/expenses/[id]/post-to-ledger` — **la primera ruta de `/api` que escribe
   en el ledger**, con las tres capas de idempotencia — y los dos triggers de inmutabilidad.
   Verificado contra staging con el RPC real y ROLLBACK: 8/8.

   **BLOQUE COMPLETO (03/09).** El formulario de alta con proveedor, vencimiento precargado
   desde el plazo del proveedor y el editor de líneas; `POST /api/expenses` exigiendo líneas y
   calculando el monto del lado del servidor; y el botón de posteo en la pantalla del gasto.

   **Falta solo, cuando no queden líneas sin clasificar:**
   ```sql
   ALTER TABLE public.expense_lines VALIDATE CONSTRAINT expense_lines_cuenta_obligatoria;
   ```
   Mientras quede una en NULL ese comando falla, así que es el semáforo: el día que corre
   limpio, la limpieza terminó.

   **Staging tiene un gasto posteado de demostración** (asiento 13, tres líneas contra tres
   cuentas) para poder recorrer mayor a asiento a documento a pantalla. Lo siembra
   `scripts/seed-gasto-tramite-demo.mts`, idempotente, y hay que volver a correrlo después de
   cada `seed:staging`.

   ⚠️ **Pendiente de decisión:** `src/components/cases/add-expense-form.tsx` es **código
   muerto** —no se monta en ningún lado, la pantalla del caso usa `SectionExpenseForm`— y se le
   aplicó igual el renombrado "Pago" a "Cobro". Borrarlo es una decisión aparte.

   ⚠️ **`GUIA-REVISION-RM.md` no existe** en el repo ni en la carpeta del cliente, y nada lo
   referencia. Los totales nuevos del Balance de staging (Activo 263.129,81 / Pasivo 18.832,65
   / Patrimonio 244.297,16 / descuadre 0,00) están en el changelog del 03/09; falta saber a qué
   documento iban.
   - Cuando no queden líneas en NULL:
     `ALTER TABLE expense_lines VALIDATE CONSTRAINT expense_lines_cuenta_obligatoria;`

   ⚠️ **Nada de esto se vio renderizado todavía.** El dev server local viene muriéndose; lo
   verificado es `tsc`, 626 tests y las migraciones contra staging. Es el bloque elegido porque construye **la primera
   ruta de `/api` que postea al ledger** (hoy no hay ninguna: `postJournalEntry` solo se llama
   desde su definición y desde `scripts/backfill-asientos-faltantes.mts`), y ese patrón lo van
   a copiar factura, cobro y compra. Además el modelo de líneas lo reusa compras, donde el
   hallazgo del 02/09 fue que un gasto necesita tres cuentas y el modelo admite una.
2. **Ver las tres pantallas del filtro de período renderizadas.** Lo único del bloque del
   02/09 que no se verificó en pantalla. El dev server local viene muriéndose; el camino es
   `scripts/render-pantalla.mts` contra staging, que necesita
   `VERCEL_AUTOMATION_BYPASS_SECRET` y hoy no lo tenemos.
   Rutas: `/finanzas/reportes/balance?hasta=2026-05-31`,
   `/finanzas/reportes/pyl?desde=2026-05-01&hasta=2026-06-30`,
   `/finanzas/reportes/comprobacion?desde=2026-05-01&hasta=2026-06-30`.
3. **Buscar a qué fecha se generó el reporte de QuickBooks** de los saldos de apertura. Paso
   previo de **A-quinquies**, y ese dato lo tenemos nosotros. Si aparece, el arreglo es un
   UPDATE de `saldo_inicial_fecha` y no hay que preguntarle nada a RM.
4. **Higiene chica del hub de reportes:** los badges de `/pyl` y `/balance` siguen diciendo
   "Sin corte por período" (`reportes/page.tsx:53,59`), que dejó de ser cierto el 02/09.
5. **Pantalla de asientos manuales.** El motor está entero (`postJournalEntry()` valida y
   postea, el RPC serializa correlativo y hash). Después del bloque, porque el bloque deja el
   patrón de la ruta.
6. **El hueco de auditoría de A-quater**: aceptar o rechazar una cotización a mano no registra
   QUIÉN. Camino barato en su propio bloque más abajo.

---

### A-0-bis. ESTADO AL CIERRE DEL 02/09/2026

`develop` limpio, producción intacta, **575 tests en verde**, `tsc` limpio. Los 21 errores
de ESLint son la deuda vieja de A-bis: este día no agregó ni quitó ninguno.

**Commiteado hoy:**

| SHA | Qué |
|---|---|
| `87836e5` | Grupo C — totales del pie, filtro del plan y mes con datos |
| `d791e27` | Todo el texto visible de voseo/tuteo a usted |
| `76f11e5` | Título de pestaña en las 17 pantallas de Finanzas que no lo tenían |
| `739be0c` | Tres cadenas en tuteo que se escaparon del barrido |
| `bf8ea00` | Trato de usted en el CRM interno (grupos 1 a 7) |
| `2f32c31` | Trato de usted en el portal público y los correos al cliente |
| `49eeda5` | Los dos banners que decían que el portal no existe |
| `801692b` | **Corte por fecha en los tres estados financieros** |

**Pendiente, en este orden:**

1. **Ver las tres pantallas filtradas renderizadas.** Es lo ÚNICO del bloque del filtro de
   período que no se verificó en pantalla: los números se comprobaron corriendo el código
   real de las pantallas contra staging, pero nadie miró el HTML. El dev server local viene
   muriéndose en esta máquina; el camino es `scripts/render-pantalla.mts` contra el deploy
   de staging, que necesita `VERCEL_AUTOMATION_BYPASS_SECRET` y hoy no lo tenemos.
   Rutas: `/finanzas/reportes/balance?hasta=2026-05-31`,
   `/finanzas/reportes/pyl?desde=2026-05-01&hasta=2026-06-30`,
   `/finanzas/reportes/comprobacion?desde=2026-05-01&hasta=2026-06-30`.

2. **"Pagos" → "Cobros" en los dos formularios que crean el registro.** Está a medias y así
   es PEOR que no haberlo empezado: el mismo registro se llama **Cobro cuando se lee** y
   **Pago cuando se escribe**, que es justo la confusión que Rose pidió eliminar ("desde
   Integra, pago es dinero que sale"). Hecho: `legal/casos/[id]/page.tsx:664, 756, 823`.
   Falta: `add-expense-form.tsx:171, 178, 271, 286, 301` y
   `section-expense-form.tsx:177, 251, 263, 273` — pestañas "Pago para Trámite" / "Pago
   Administrativo", título "Nuevo Pago para Gastos del Trámite", "Fecha de pago" y el botón
   "Guardar Pago". Es solo texto.

3. **Buscar a qué fecha se generó el reporte de QuickBooks** del que salieron los saldos de
   apertura. Es el paso previo de **A-quinquies** y puede resolver la contradicción sin
   molestar a RM: ese dato lo tenemos nosotros. Si aparece, el arreglo es un UPDATE de
   `saldo_inicial_fecha` y no hay que preguntar nada.

4. **Pantalla de asientos manuales.** Faltan las dos cosas —UI y ruta de API—, pero el
   trabajo de fondo está hecho: `postJournalEntry()` valida y postea, y el RPC serializa
   correlativo y hash-chain. Hoy `postJournalEntry` se llama desde exactamente dos lugares
   (su propia definición y `scripts/backfill-asientos-faltantes.mts`): **ninguna ruta de
   `/api` postea al ledger**, y el asiento de diario del fixture lo creó
   `scripts/seed-asientos.ts`. La ruta es fina: validar líneas, cuadre y período, y llamar
   al helper — respetando SOP-014 (server-side, cliente de servicio, `tenant_id` del perfil
   y NUNCA del body).

5. **El hueco de auditoría de A-quater**: aceptar o rechazar una cotización a mano no
   registra QUIÉN lo hizo. Detalle, hipótesis y el camino barato (`audit_log`, sin tocar el
   esquema) en su propio bloque más abajo.

**Los dos bloques de análisis que quedaron escritos hoy y no se tocaron:** A-quater (el
`_userId` descartado) y A-quinquies (los saldos que contradicen la regla de Rose). Ninguno
de los dos se arregló a propósito.

### A-0-bis-2. 🔴 LA REVERSIÓN DE ASIENTOS — pasa a ser el bloque INMEDIATAMENTE siguiente

**Por qué cambió de prioridad.** Era "algún día". Dejó de serlo el 03/09/2026, y el motivo es
una consecuencia directa de la pantalla de asientos manuales:

> Hasta hoy el libro solo tiene asientos **sembrados** y de **gastos de trámite**, y estos
> últimos pasan por un gate que exige líneas clasificadas y cuentas válidas. En cuanto exista la
> pantalla de asientos manuales, **un contador puede equivocarse a mano — y no hay forma de
> deshacerlo.** Los asientos son inmutables por diseño: los triggers de la `023` rechazan UPDATE
> y DELETE.

O sea: la pantalla de asientos manuales **crea** la necesidad de la reversión. No se puede
entregar una y postergar la otra mucho tiempo sin dejar al contador sin salida ante su propio
error de tipeo.

**Lo que YA está listo en la base** (no hay que construirlo):
- `source_type = 'reversion'` en el CHECK.
- `reverses_entry_id` + `reversal_reason`, con el CHECK `je_reversion_requires_ref` que exige
  apuntar al original y un motivo de 3+ caracteres (Art. 5.7 del DE 34/1998). Lo restauró la
  `029` después de que la `028` lo dropeara sin querer.

**Falta:** el builder del asiento espejo, la ruta, y el botón en el detalle del asiento.

#### 📝 Y CUATRO AVISOS QUE HAY QUE REVERTIR EL DÍA QUE EXISTA

Hoy prometían un remedio que no existe: *"Corregirlo requiere un asiento de reversión"* — un
contador se equivoca, lo lee, va a buscarla y no la encuentra. El 03/09 se les agregó la
cláusula *"que todavía no está disponible en el sistema"*.

🔴 **El día que la reversión exista hay que sacarla, y solo esa cláusula.** Es exactamente lo
que nos pasó CUATRO veces esta semana con los badges del hub de reportes: un texto que describe
lo que al sistema le falta se vuelve falso en cuanto alguien lo construye, y nadie se acuerda de
volver.

| Archivo | Contexto | Qué queda cuando exista |
|---|---|---|
| `asientos/_components/asiento-manual-form.tsx` (confirmación) | DESPUÉS de postear | "…requiere un asiento de reversión." |
| `asientos/_components/asiento-manual-form.tsx` (pie del form) | ANTES de postear | Ídem, y se puede sacar el "verifique antes de registrarlo" |
| `gastos-tramite/[id]/_components/post-to-ledger-button.tsx` | ANTES de postear | Ídem |
| `api/expenses/lines/[id]/route.ts` | Error 409 | Ídem, y el "avísele a Oliver" pasa a ser un enlace a la reversión |

**Se buscan con:** `grep -rn "todavía no está" src/ --include="*.ts" --include="*.tsx"` — devuelve las cuatro.

⚠️ Con la frase completa NO funciona: en el JSX queda partida en dos líneas (`disponible` cae en el renglón siguiente) y `grep` es línea a línea, así que solo encuentra dos de las cuatro. Un puntero roto en una nota como ésta es peor que no tenerla: el que la use va a creer que ya arregló todo.

⚠️ **Tres mensajes MÁS con la misma frase viven en los triggers de la `038`** (SQL). No se
tocaron porque cambiarlos exige una migración, y solo se ven si alguien escribe en la base
saltándose las rutas —o sea, un desarrollador, no un contador—. Cuando se haga la reversión,
revisarlos en la misma migración:

```
grep -n "asiento de reversión" sql/pending/038_gasto_tramite_al_ledger.sql
```

**Ya está bien y no hay que tocarlo:** `api/invoices.ts:690` dice *"se habilita junto con el
asiento de reversión. Avisale a Oliver"* — nunca prometió que existiera.

**🔒 Y hay una pregunta contable que NO es de diseño — va a Josuarth, por correo:**

> ¿La reversión se postea con la **fecha del asiento original** —lo que puede caer en un período
> ya cerrado, y el RPC lo va a rechazar— o con la **fecha de la reversión**?

Las dos son prácticas legítimas y tienen consecuencias distintas:
- Con la fecha original, el período del error queda corregido en su propio mes, pero hay que
  poder reabrir un período cerrado (y hoy `post_journal_entry` aborta con
  *"El período 2026-03 está CERRADO: no admite asientos nuevos"*).
- Con la fecha de reversión, ningún período cerrado se toca, pero el mes del error queda
  reportado mal para siempre y la corrección aparece en otro.

No inventar la respuesta. Sin ella, el builder se puede escribir pero la ruta no sabe qué fecha
mandarle al RPC.

---

### A-0-ter. 🔒 BLOQUEADO POR RM — la lista corta de cuentas de compras

**La pregunta, en una línea:** ¿`600006 CSS Patronal` y `600007 Seguro Educativo` se registran
en el CRM como una **compra con proveedor**, o salen de la **planilla** y nunca pasan por
`/finanzas/gastos-bufete`?

**Por qué bloquea.** Gastos de trámite tiene una lista corta de 7 cuentas sobre 46 posibles, y
ese recorte es lo que evita clasificar una tasa judicial como Capital Social. Para compras el
recorte útil sería `610xxx` (19 operativas) + `110001 Mobiliario y equipo` = 20 sobre 46 — y
todo su valor está en **sacar de en medio las 8 cuentas de planilla** (`600001 Sueldos`,
`600003 Vacaciones`, `600004 Décimo Tercer Mes`, `600006 CSS Patronal`…).

Si la CSS patronal se carga como compra con proveedor, sacarla de la lista corta **esconde algo
que se usa todos los meses**, que es el único costo que tiene ese mecanismo. No es una decisión
de diseño: es cómo se registra la planilla, y la respuesta está en RM — son los contadores
del bufete y saben cómo se asienta.

**Lo que NO está bloqueado y ya se hizo (03/09):** el guard de compras acepta gasto, costo y
activo, que es lo que pide el acta. Ver `sop.md` SOP-024.

**Cuando llegue la respuesta:** la lista vive en `contabilidad/cuentas-de-gasto.ts`, al lado de
la de trámite, y tiene que ser **derivada** —por tipo o por prefijo— no una lista de códigos
literales, por el mismo motivo que la otra: se desactualiza el día que RM toque el plan.

---

### A. eFactura go-live (prioridad de Oliver)
Desbloqueo = respuesta de Eduardo (punto de facturación + confirmación de folios) + `CPBS_REI` del contador. Luego, en ese orden:
1. Cargar las 3 variables pendientes en Vercel Production.
2. Merge `develop → main` (fast-forward, disparará auto-deploy).
3. Primera emisión real de prueba con factura pequeña a receptor conocido.

### A-bis. Sprint de limpieza de lint (21 errores) — deuda visible, prioridad media

Creado el 24/08/2026 a pedido de Oliver, para que no se vuelva deuda invisible. El deploy
`0de75ca` salió con **excepción aprobada** en el paso 2 del SOP-006: el proyecto arrastra 21
errores de ESLint que YA estaban en `main`; ese deploy no introdujo ninguno, pero tampoco los
limpió, y el checklist va a seguir saliendo en amarillo hasta que alguien los tome.

- [ ] `src/components/tasks/task-list.tsx` — `CardHeader`, `CardTitle` sin usar
- [ ] `src/lib/clients/__tests__/numbering.test.ts` — `_cols` sin usar
- [ ] `src/lib/finanzas/queries/business-expenses.ts` — `accountMap` debe ser `const`
- [ ] `src/lib/utils/import-parser.ts` — `sheetName` sin usar
- [ ] `src/app/legal/casos/[id]/page.tsx` — `Upload`, `Button`, `backUrl` sin usar
- [ ] `src/app/legal/casos/page.tsx` — `count` debe ser `const`
- [ ] Resto: `documents/upload/route.ts`, `legal/admin/page.tsx`, `legal/clientes/page.tsx`,
      `legal/page.tsx`, `case-task-group.tsx`, `add-task-form.tsx`, `case-status-changer.tsx`,
      `client-form.tsx`, `expense-list.tsx`, `connectivity-indicator.tsx`,
      `seguimiento-view.tsx`
- [ ] Aparte, 4 warnings `jsx-a11y/alt-text` en los PDF de finanzas (`CreditNoteDocument`,
      `InvoiceDocument`, `QuoteDocument`)

**Cómo obtener la lista fresca:** `npx next lint`. **Criterio:** son todos triviales (imports
muertos y `prefer-const`); el riesgo está en tocar 17 archivos de una, así que conviene un
commit propio, sin mezclar con features, y correr la suite completa después.

### A-ter. Centralizar el mensaje de error de red — refactor, prioridad media

Detectado el 02/09/2026 durante el barrido de tuteo, y anotado porque el barrido lo
dejó a la vista sin resolverlo: **la misma frase de error de red está escrita a mano
en 33 archivos**.

    "Error de red. Intente de nuevo."          (y sus variantes "al guardar", "al subir")
    "Error inesperado. Intente recargar la página."
    "Error de conexión. Verifique su conexión a internet."

No es un problema de idioma — el idioma ya quedó corregido. Es que **cambiar esa frase
hoy cuesta 33 ediciones y debería costar una**. El barrido de septiembre tuvo que tocar
33 archivos para conjugar un verbo, y dos de esos archivos además tenían la palabra
"conexion" sin tilde desde que se escribieron: nadie la vio nunca porque no había un
solo lugar donde mirarla.

- [ ] Constante o helper compartido (candidato: `src/lib/ui/mensajes.ts`) con las tres
      variantes, más el `catch` de red que hoy se repite igual en cada handler.
- [ ] Reemplazar las 33 ocurrencias por la constante.
- [ ] Test que falle si vuelve a aparecer la cadena literal fuera del módulo.

**Es refactor, no texto.** Deliberadamente NO se hizo junto con el barrido de tuteo,
para que ese commit fuera solo copy y su diff se pudiera leer de un vistazo.

### A-quater. Aceptar/rechazar una cotización a mano no registra QUIÉN — hueco de auditoría

Encontrado el 02/09/2026 investigando por qué un banner le decía a las abogadas que
marcaran la cotización a mano. El banner era falso y ya se corrigió; **esto es lo que
apareció debajo, y es lo valioso del hallazgo.** No se arregló a propósito: no es texto.

**Lo que pasa hoy**

- `markAcceptedManual()` — `src/lib/finanzas/api/quotes.ts:1217` — y
  `markRejectedManual()` — `:1259` — **reciben el `userId` y lo descartan**. No es una
  omisión ambigua: el parámetro está escrito `_userId`, con guion bajo, que es la forma
  de decirle a TypeScript "sé que no lo uso".
- El UPDATE guarda `approved_at` / `rejected_at` (el **cuándo**) y pone
  `approved_by_ip` / `approved_by_user_agent` en `NULL` deliberadamente, para marcar que
  la decisión **fue manual y no vino del portal**. Así que queda el CUÁNDO y queda el
  QUE FUE MANUAL — pero **no queda el QUIÉN**.
- **La ruta `mark-accepted` no escribe en `audit_log`.** Las rutas `duplicate` y
  `resend` del mismo módulo **sí** lo hacen. Esa asimetría, dentro del mismo sprint y
  el mismo directorio, es lo que hace pensar que es un descuido y no una decisión de
  diseño: si se hubiera decidido no auditarlo, las otras dos tampoco auditarían.
- Lo pueden hacer **tres roles**: `admin`, `abogada` y `contador`
  (`ALLOWED_ROLES` en `src/app/api/finanzas/quotes/[id]/mark-accepted/route.ts:10`).

**Lo que NO está roto** (verificado en la misma investigación, para que nadie lo
arregle de más): una decisión tomada desde el portal **no se puede pisar**. Los dos
helpers exigen `status === 'enviada'` y devuelven 400 en cualquier otro estado; el
botón tampoco se renderiza, porque `isQuoteDecidable()` es `status === "enviada"`. La
evidencia de firma electrónica (`quote_acceptances` / `quote_rejections`) solo la
escriben las rutas públicas del portal, con un UNIQUE por cotización. Ni se pisa, ni
queda huérfana.

**La pregunta a responder ANTES de tocar nada**

¿Hay una columna en `quotes` donde escribir el usuario? **Verificado: no la hay.**
`quotes` tiene `sent_by` para el envío, pero para la decisión solo tiene
`approved_by_ip` / `approved_by_user_agent` y sus gemelas de rechazo — ninguna guarda
un `user_id`. Agregarla es una **migración**, y eso saca el arreglo de la categoría
"chico".

- [ ] **Evaluar primero el camino barato: escribir en `audit_log`**, igual que hacen
      `duplicate` y `resend`, sin tocar el esquema. Si alcanza para responder "quién
      aceptó la COT-00XXXX y cuándo", el tema se cierra ahí.
- [ ] Solo si no alcanza, evaluar `approved_by` / `rejected_by` como columnas nuevas,
      con su migración y su backfill (las filas viejas quedarían en NULL, que es
      honesto: de verdad no se sabe quién fue).

### A-quinquies. Los saldos cargados contradicen la regla que dio la contadora — PREGUNTA PARA EL CORREO

Apareció el 02/09/2026 midiendo el peso de las aperturas para diseñar el filtro de
período. **No se tocó ningún saldo y no hay que tocarlo hasta que RM responda.**

**El dato, medido en staging:**

- **15 cuentas de resultado** (income / cost / expense) tienen `saldo_inicial` distinto
  de cero, por un total de **244.476,91**.
- **Las 15 tienen `saldo_inicial_fecha = 2026-01-01`.** No es una que quedó mal: son
  todas, con la misma fecha.
- Para dimensionarlo: la Utilidad del Ejercicio que hoy hace cuadrar el Balance es
  −245.382,66, de los cuales **−244.476,91 son apertura y solo −905,75 son movimiento
  real del ledger**. El 99,6 % del resultado del sistema es un saldo cargado.

**La regla que dio Rose** (correo del 25/08, hilo "Papel de trabajo", respondiendo a
"¿desde qué fecha arrancan los saldos cargados?"):

> "Las cuentas de resultado se cierran al cierre de cada período (1 de enero al 31 de
> diciembre). **Al 1 de enero solo tienen saldo las cuentas del estado de situación
> financiera**."

**Las dos cosas no pueden ser ciertas a la vez.** Si al 1 de enero solo las cuentas de
balance tienen saldo, entonces 15 cuentas de resultado con saldo fechado 01/01/2026 son
un dato imposible.

**Las dos hipótesis:**

1. **La fecha está mal y el saldo está bien.** El corte real es posterior al 1 de enero
   —el inventario dice que los saldos cargados traen cuentas de resultado con movimiento
   de enero a agosto— y entonces 244.476,91 es el **acumulado del ejercicio hasta la
   fecha del reporte de QuickBooks** del que salieron. En ese caso hay que corregir
   `saldo_inicial_fecha` a la fecha real, que es un dato que tenemos nosotros (a qué
   fecha se generó ese reporte) y no RM.
2. **La fecha está bien y los saldos están mal cargados.** Las cuentas de resultado no
   deberían tener apertura, y esos 244.476,91 se cargaron donde no correspondía.

**Por qué importa más allá de la prolijidad:** el Estado de Resultado por período excluye
esas aperturas —es lo correcto— y por eso muestra 905,75 donde el reporte sin filtro
muestra 245.382,66. Esa diferencia es visible en pantalla y un contador la va a preguntar.
La respuesta honesta hoy es "no sabemos a qué fecha corresponden esos saldos". La pantalla
ya lo dice con el número exacto; lo que falta es la respuesta.

- [ ] Va al correo a RM como pregunta, con el número y las dos hipótesis.
- [ ] Antes de mandarlo: buscar de nuestro lado a qué fecha se generó el reporte de
      QuickBooks del que salieron los saldos. Si aparece, la hipótesis 1 queda confirmada
      sin molestar a Rose y el arreglo es un UPDATE de `saldo_inicial_fecha`.
- [ ] **Ningún saldo se modifica hasta tener la respuesta.** Cambiar `saldo_inicial` de
      una cuenta de resultado mueve la Utilidad del Ejercicio y con ella el patrimonio del
      Balance.

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
| 11.1 | Testing completo con Playwright MCP | — | ✅ Hecho | Verificación en navegador antes de cada release; el ciclo quedó incorporado al SOP, no es un hito de una sola vez |
| 11.2 | Pre-deploy checklist (13 pasos) | — | ✅ Hecho | SOP-006 corrido en el deploy del 14/08/2026 (281/281 tests, `tsc` limpio, `next build` OK, diff review) |
| 11.3 | Deploy a producción | — | ✅ Hecho | Merge `060fed7` a `main` el 14/08/2026, aprobado por Oliver. Rollback: `f149735` |
| 11.4 | Verificación post-deploy | — | ✅ Hecho | Smoke en `crm-integra-legal.vercel.app` el 14/08/2026 (balance, pyl, cuentas, ficha de cliente). Detalle en `changelog.md` |

**Nota:** esta fase se cerró con el deploy del 14/08/2026. De acá en adelante los cuatro
pasos son parte del ciclo de CADA release (ver `sop.md`), no un hito pendiente del plan.
