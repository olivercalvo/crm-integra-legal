# Ventana del Bloque 1 — orden final, tiempo y ensayo

**Qué es:** el orden de aplicación en producción de las **65 migraciones** de la `025` a la
`096` (todas menos la `056`, reservada, y las bitácoras) y del paso de datos que marca lo de prueba,
ensayado de punta a punta el **05/10/2026** contra una base local con el ESQUEMA de producción, y **otra vez
el 06/10/2026** con la `095`, el arreglo de los mensajes de anulación (§4, punto 8) y la `096` (inicio
contable): mismo resultado. Al final, el
paso «Accesos» (§6). Las bitácoras (`086`, `087`, `089`,
`090`, `091`) van en una **ventana aparte**, después.

**Qué reemplaza:** el ORDEN de `docs/runbooks/despliegue-025-055.md` (§0b, §3 y §5), que llegaba
hasta la `067` y dejaba la `068`–`092` en notas sueltas. **El detalle de cada paso sigue allá**: el
pre-flight P-1 a P-16, el respaldo, qué anotar de cada migración, el rollback y las variables
`EFACTURA_*`. Este documento dice en qué orden, cuánto tarda y qué cambió con el ensayo.

**Fuente única del orden:** `scripts/ensayo-ventana/orden.mjs`. Si se mueve una migración, se mueve
ahí, se vuelve a ensayar y se copia acá.

---

## 1. Resultado del ensayo (05/10/2026, repetido el 06/10/2026)

El 06/10 dio lo mismo, fila por fila: 65 migraciones sin errores (la `095` con su verificación 6/6 y la
`096` con la suya 19/19, SIN la llave), las mismas verificaciones «sin datos» y «tarde» de §4, marcas 8 y 5
con el aborto esperado, bitácoras 5/5, 41 tablas 131/131 y concurrencia 180 rondas sin deadlocks
(`--control` 27/27). El arreglo de anulación es sólo código: se probó en staging (§4, punto 8).

> 🔴 **La base del ensayo tiene el ESQUEMA de producción, no sus DATOS.** Los datos son el seed de
> staging recortado (ficticios). Que el pre-flight de la `096` diga «0 asientos» ahí prueba el
> mecanismo, no producción. Lo que decide en producción es su libro: tiene que estar vacío, y lo
> confirma la sección 0 de `sql/verificacion/produccion-documentos-antes-del-inicio.sql` (§2, Bloque C).


| Fase | Pasos | Errores | Tiempo de base |
|---|---:|---:|---:|
| Base = producción: `main` 24b227a (hasta la 024, 48 archivos) + datos + la 084 | 50 | 0 | 2,2 s |
| Ventana Bloque 1: A (29) → B (14) → C (22) | 65 migraciones + 37 verificaciones | **0** en migraciones | 11,1 s en total |
| Paso «Marcar los datos de prueba» (base `pruebas`, datos equivalentes) | consulta → aborto → paso → consulta → paso otra vez | 0 marcas incorrectas | — |
| Ventana de bitácoras: 086 → 087 → 089 → 090 → 091 | 5 | 0 | 0,2 s |
| Prueba de las 41 tablas (después de las bitácoras) | 131 operaciones | 0 | — |
| Concurrencia bitácora ↔ libro (20 rondas, 9 combinaciones) | 180 rondas | 0 deadlocks | — |
| Concurrencia `--control` (orden viejo) | 27 rondas | 27 deadlocks (lo esperado) | — |

Además, después de todo: `verify_accounting_chain` en 0 filas; ninguna función ni política llama
a `tenant_id()`/`user_role()` sin esquema (en producción viven en `auth`, no en `public`); `anon` y
`authenticated` no ejecutan `post_journal_entry` ni `register_external_invoice`; ningún servicio
activo apunta a una cuenta inexistente o inactiva.

Registro completo, migración por migración, con cada NOTICE: `docs/finanzas/ensayo-ventana/*.json`.

### La base del ensayo, y por qué se parece a producción

- **Postgres 17.9 local.** **Producción es 17.6** (`SELECT version()`, consulta de Oliver del 05/10/2026)
  y staging también. Misma versión mayor: el catálogo, la sintaxis y los permisos que usan las
  migraciones son los mismos; entre 17.6 y 17.9 sólo hay correcciones.
- **`postgres` sin superusuario**, como en Supabase, y `supabase_admin` como superusuario. Una
  migración que sólo funciona como superusuario habría fallado.
- **Los helpers de RLS en `auth`**, como en PRODUCCIÓN. Staging los tiene en `public` y su runner
  reescribe las migraciones; el ensayo no reescribe nada: corre los archivos tal cual van a
  producción. Lo mínimo de Supabase (roles, `auth.users`, `storage`) está en
  `scripts/ensayo-ventana/supabase-shim.sql`.
- **Esquema base leído de `main`** (`git show 24b227a:…`), con los dos parches de
  `staging-fixups.mjs`, que describen cómo quedó producción al aplicar esos archivos a mano.
- **Datos:** el seed de pruebas de staging (sólo lectura), recortado a lo que puede existir en la
  024: libro vacío y cero compras (como producción el 22/09); sin las cuentas, servicios y facturas
  que crearon migraciones posteriores; las filas que la 024 rechaza, fuera. Quedan **97 cuentas**,
  las mismas que producción. Sin datos reales.

### Lo que el ensayo NO puede probar

- 🔴 **Los números de la `025`.** La `025` no aborta si su POST-CHECK no coincide: imprime
  «esperado N» y sigue. En el ensayo imprimió `account_type=cost 0 (esperado 6)` y
  `gastos_operativos 55 (esperado 30)` y quedó aplicada. Es un artefacto (las cuentas de staging ya
  tienen el vocabulario NIIF 18), pero es exactamente el peligro 1 del runbook: **la `025` no falla,
  miente.** La única defensa sigue siendo P-1(e): los «esperado» calculados contra producción y la
  comparación a mano en D·5.
- **P-15 / HON-FAM y HON-OTROS:** en staging ya apuntaban a 400009 / 400010, así que la `043` dijo
  «PENDIENTE (esperado)» y el movimiento que producción necesita no se ejerció. Lo cubre la consulta
  de P-15 el día −2.
- **Tiempos reales:** el SQL tarda segundos; la ventana tarda lo que tarda una persona en el SQL
  Editor (§3).

---

## 2. El orden final

Sin cambios de orden en las migraciones: el de §3 y §5 del runbook viejo funciona tal cual, y el
Bloque C va **después** del B. Cambia el orden de **tres verificaciones** (ver §4). Se suman dos
migraciones nuevas del 05/10 (`093` en el B, `094` y `095` al final del C) y el paso de datos de prueba.

### Bloque A — con la app de `main` arriba (29)

```
026 → 027 → 028 → 029 → 030 → 031 → 032 → 033 → 034 → 036 → 038
 → 039 → 041 → 042 → 044 → 046 → 047 → 051 → 052 → 053 → 054 → 055
 → 057 → 059 → 065 → 060 → 062 → 063 → 067
```

Después: `NOTIFY pgrst, 'reload schema';` y la verificación del Bloque A (§4 y §10.2 del runbook viejo).

### Congelar (D·4)

Nadie emite, anula, cobra ni carga un CUFE hasta que el deploy esté arriba.

### Bloque B — congelado (14)

```
035 → 043 → 040 → 037 → 045 → 048 → 093 → 049 → 050 → 066 → 058 → 061 → 064 → 025
```

- 🔴 **La `048` y el código de compras van en el MISMO despliegue** (esta ventana: la `048` en el B
  congelado, el código en el merge de D·6). Las dos mitades se necesitan: el formulario de `main`
  manda el estado que elige la persona («Pagado» por defecto) y la `048` rechaza crear una compra que
  no nazca `pendiente_pago`; el código nuevo nace pendiente y registra el pago en `supplier_payments`,
  que crea la `048`. Entre la `048` y el deploy nadie carga compras (está congelado, y producción tiene
  cero). Lo confirma el ensayo: la `093` y su verificación pasan pegadas a la `048`.
- `093` (05/10): el `DEFAULT` de `business_expenses.status` pasa de `'pagado'` a `'pendiente_pago'`,
  el único valor que la `048` acepta al crear. No toca filas. Verificación: `verificacion-093` (2/2).

- 🔴 Después de la `025`: comparar su POST-CHECK con P-1(e), línea por línea. Si no coincide,
  **parar** (la `025` ya quedó aplicada: se sigue con el rollback de §8 del runbook viejo, no con la C).
- ⚠️ El paso de datos «Reasignar los servicios de P-15» (después de la `043`) **ya no va**: lo
  reemplazan la `079` (HON-FAM → 400009) y la `082` (HON-OTROS → 400010), que van en el Bloque C.
  Si Josuarth elige otra cuenta para alguno, se cambia después de la ventana desde el catálogo.

### Bloque C — congelado, inmediatamente después de la 025 (27)

```
068 → 069 → 070 → 071 → 072 → 073 → 074 → 075 → 076 → 077 → 078
 → 079 → 080 → 081 → 082 → 083 → 084 → 085 → 092 → 094 → 095 → 096
 → 097 → 098 → 099 → 100 → 101
 → paso de datos «Marcar los datos de prueba»
```

Por qué después del B y no antes: la `069` reescribe RPC de la `048`, la `050` y la `066`; la
`079` parte de las subcategorías de la `025`; la `071` no es compatible con el código de `main` y
sólo puede ir en la parte congelada. La `084` ya está en producción: entra y no cambia nada.

- 📋 Antes de la `071`, el paso previo de los gastos de trámite sin proveedor (runbook viejo,
  encabezado): `sql/verificacion/gastos-tramite-sin-proveedor.sql`, sólo lectura.
- 📋 Antes de la `092`: `sql/verificacion/produccion-cufe-repetidos.sql`. Si devuelve filas con
  «sí», la `092` aborta: decidir antes qué factura conserva el CUFE.
- `094` (05/10): la marca de prueba es del DOCUMENTO (`de_prueba` en facturas, NC, cobros, cobros y
  gastos del caso) y la del cliente sólo vale para lo nuevo. Propuesta: `propuesta-corte-quickbooks.md`
  §9. Verificación: `verificacion-094` (9/9).
- `095` (05/10): el libro rechaza el asiento de un documento de prueba y un asiento manual con un cliente
  de prueba como tercero; la NC hereda la marca de su factura; un cobro y la factura a la que se aplica no
  mezclan prueba y real. La factura REAL de un cliente de prueba (la 463) sigue entrando al libro.
  Verificación: `verificacion-095` (6/6).
- 📋 **Antes de la `096`** (puede correr días antes, es sólo lectura):
  `sql/verificacion/produccion-documentos-antes-del-inicio.sql`. Sección **0** tiene que dar **0 asientos**:
  si no, la `096` aborta (su pre-flight) y **se para**. Secciones **b** y **c** tienen que salir vacías
  (borradores de antes del inicio; facturas anuladas ante la DGI y vivas en el CRM): si no, se resuelven
  ANTES de la ventana, porque después la `096` no deja emitir ni anular nada anterior al inicio. **d**
  (cobros cruzados) y **a2** (documentos desde el 01/07 sin asiento, §4 punto 9) se anotan.
  ✅ **Resultado del 07/10:** la sección **b** da 5 borradores (detalle con
  `produccion-borradores-a-revisar.sql`). Decididos por Oliver:
  - DRAFT-c4521fe4b503, DRAFT-0b8e6f42c4a4, DRAFT-4ee2dc819140 y DRAFT-2202765ef7bf (CLI-036, 29/05,
    107.00, nada colgado) son pruebas: **se marcan de prueba por número** en el paso de datos (abajo).
    CLI-036 es real y no se marca.
  - DRAFT-cb03c1386ba0 (CLI-093 FOCUS GLOBAL ONTARIO CANADA, 25/06, 6741.66, con PDF) es **real**: no se
    marca ni se toca. **Después de la ventana**, para emitirlo, se edita y se le pone una fecha IGUAL O
    POSTERIOR al inicio (01/07/2026): la `096` rechaza emitirlo con el 25/06 y moverlo hacia atrás, pero
    deja moverlo hacia adelante (probado en el ensayo el 07/10). Al emitirse postea como cualquier factura.
  Con eso **b** deja de ser un bloqueo. **c** sigue teniendo que salir vacía.
- `096` (06/10): **inicio contable** (`finanzas_parametros.fecha_inicio_contable`, 01/07/2026). Lo anterior
  está contabilizado fuera: no genera asiento, no se crea, no se mueve a una fecha anterior, no se anula
  ni se elimina (factura, ND, FAC-EXT, NC, cobro, compra, gasto de trámite, pago, NC de compra); se corrige
  con una NC o un asiento de diario posterior. El inicio no se mueve si cruza documentos. **Va SIN la
  llave** `finanzas.inicio_contable_existentes` (ésa es sólo de staging). Verificación: `verificacion-096`
  (19/19 en el ensayo; 20/20 en staging, donde sí hay compras). El código (etiqueta «Contabilizado
  fuera», bloqueos en pantalla y en la API, antigüedad) llega con el merge de D·6.
- `097` → `098` → `099` y `100` → `101` (07/10): **aplicadas y SIN USAR** (Oliver, 07/10). No tocan datos:
  crean tablas, funciones y triggers que nadie llama hasta después de la ventana. El posteo de documentos
  por mes (`097`–`099`, §7) y la apertura (`100`–`101`, §8) se usan cuando Josuarth revise cada mes y
  confirme la fecha de la apertura. Por qué acá y no en otra ventana: el código que las usa llega con el
  merge de D·6; sin ellas, las pantallas nuevas fallarían al abrirse. Orden y dependencias: después de
  la `096` (las cinco leen `finanzas_inicio_contable`), la `097` usa `journal_import_entries` (067) y la
  `101` reemplaza `reverse_journal_entry` partiendo del cuerpo que deja la `080` (verificado idéntico al
  de la ventana del ensayo el 07/10: si alguien cambia esa función antes de la ventana, hay que rehacer
  la `101`). Verificaciones: `verificacion-097` después de la `099` (10/10 en el ensayo; el caso del
  banco de un cobro contabilizado se salta porque el libro está vacío) y `verificacion-100-101` después
  de la `101` (11/11; el caso de la factura se salta por lo mismo). Las dos van en ROLLBACK: no gastan
  números del libro. ⚠️ Después del deploy las pantallas «Documentos existentes» y «Apertura» quedan a la
  vista de admin y contador: **no se usan** hasta el visto bueno de Josuarth (§7 y §8).
- 🔴 **Los filtros de los reportes son CÓDIGO y llegan con el merge de D·6**, en esta misma ventana:
  antigüedad (y su cuadre), estado de cuenta, ITBMS, Pendientes DGI y sus contadores (listado, hub de
  reportes, dashboard de la abogada), el aviso de errores DGI, los selectores de cobro, NC y ND, y las
  exportaciones (usan los mismos loaders). La factura de prueba no se emite, no se cobra, no se acredita,
  no se anula y **no va a la DGI** (409, antes del número). En los listados sigue, con el badge «Prueba».
  Entre el paso de datos y el deploy las marcas existen y la app de `main` las ignora: está congelado.
  Probado en staging el 05/10 (`docs/finanzas/prueba-documentos-de-prueba.txt`).

#### Paso de datos «Marcar los datos de prueba» (después de la 094, todavía congelado)

🛑 **Pausa obligatoria** (cambio de datos en producción). Sin DELETE: sólo marca.

| Se marca de prueba | Se queda real |
|---|---|
| Clientes CLI-066, CLI-069, CLI-070, 0TEST-FE-001 | CLI-026 (INTEGRA LEGAL), **0TEST-FE-002**, CLI-036 |
| Facturas FAC-HON-000454, FAC-REI-000038, FAC-HON-000455, 456, 457, 459, 460, 461 | **FAC-HON-000463** (real ante la DGI, amb 1, 1.07, 08/07) |
| Borradores DRAFT-c4521fe4b503, DRAFT-0b8e6f42c4a4, DRAFT-4ee2dc819140, DRAFT-2202765ef7bf (CLI-036) | DRAFT-cb03c1386ba0 (CLI-093) |
| — | El gasto ADM-001 de 1.00 |

🔴 **0TEST-FE-002 NO se marca (Oliver, 07/10/2026).** Con el cliente marcado, la 463 seguía contando y
entrando al libro, pero la app no le dejaba registrar un cobro ni una NC (409 «El cliente 0TEST-FE-002 está
marcado de prueba»), así que no se podía cobrar, acreditar ni anular. Su factura de sandbox FAC-HON-000460
se marca **por número**, y el paso aborta si 0TEST-FE-002 tiene cualquier otra factura sin decidir.

`contador.test@integra-panama.com` no se toca acá: se desactiva en «Accesos» (§6).

1. **Antes:** `sql/verificacion/produccion-datos-de-prueba-a-marcar.sql` (sólo lectura; también corre hoy,
   con el esquema de la 024). Tiene que dar **22 filas**: 16 «marcar de prueba» (4 clientes, 8 facturas
   y 4 borradores) y 6 «se queda real» (0TEST-FE-002, CLI-026, CLI-036, FAC-HON-000463, DRAFT-cb03c1386ba0
   y el gasto ADM-001),
   **ninguna «REVISAR» ni «NO ENCONTRADO»**, y `con_asiento = false` en todas. Si aparece un «REVISAR»
   (un cobro, una NC, otra factura o un gasto del caso de un cliente de prueba, u otro `0TEST-*`): parar,
   decidir, y agregarlo a la lista de los dos archivos.
2. **El paso:** `sql/ventana/marcar-datos-de-prueba.sql`. Aborta sin cambiar nada si falta la `094`, si un
   número no existe, si hay algo sin decidir o si una factura de la lista tiene asiento. Termina con
   `Marcadas ahora: 12 facturas y borradores y 4 clientes (12 y 4 en total). Reales sin marca:
   FAC-HON-000463, DRAFT-cb03c1386ba0; clientes CLI-026, 0TEST-FE-002, CLI-036; y el gasto ADM-001 de
   1.00.` Re-ejecutable (la segunda vez dice «0 facturas y borradores y 0 clientes»).
3. **Después:** la misma consulta del punto 1. `marca_hoy = true` en las 16 «marcar de prueba» y `false`
   en las 6 «se queda real».

Ensayado el 05/10 en una copia de `prod_024` con los mismos números y datos ficticios
(`ensayo.mjs marcar-pruebas`, registro en `docs/finanzas/ensayo-ventana/marcar-pruebas.json`): con un cobro
de CLI-066 sin decidir, abortó sin marcar nada; sin él, marcó 8 y 5 y dejó las tres reales sin marca.
**Repetido el 07/10 con la lista nueva:** 22 filas antes y después, 0 «REVISAR»; abortó con el cobro sin
decidir; marcó 12 facturas y borradores y 4 clientes; la segunda vez, 0 y 0. Después del paso, en ROLLBACK:
un cobro nuevo de 0TEST-FE-002 nace real, deja la 463 «pagada» y su asiento entra al libro; una NC nueva
nace real y la acredita (saldo 0.00).

### Merge y deploy (D·6, D·7)

`NOTIFY pgrst, 'reload schema';` → merge `develop` → `main` con aprobación de Oliver → verificación
post-deploy (§6 y §10.3 del runbook viejo) → descongelar → **Accesos (§6 de este documento)**.

El merge lleva, además de lo de cada migración, dos arreglos de código sin migración: usuarios
desactivados (§4, punto 7) y los mensajes de anulación sin CUFE (§4, punto 8).

### Ventana aparte: bitácoras (5), otro día

```
086 → 087 → 089 → 090 → 091
```

La `088` (copia del registro anterior) no va todavía. Se hace con la app arriba pero sin
operación (las bitácoras fallan cerrado: si algo sale mal, se deja de poder guardar).

---

## 3. Tiempo estimado

El SQL de las 61 migraciones corre en ~2,3 s; con los volúmenes de producción (102 facturas, 137
gastos de trámite, 146 clientes) sigue siendo cuestión de segundos. Lo que se mide es el trabajo de
una persona en el SQL Editor: abrir el archivo, pegar, correr, leer los NOTICE contra lo esperado,
marcar. Estimado con 2,5 min por migración (4 en las que tienen números que comparar: `025`, `033`,
`035`/`043`, `058`, `061`/`064`) y 1 min por verificación.

| Tramo | Contenido | Estimado |
|---|---|---:|
| D·0–D·1 | P-0 y respaldo, abrirlo | 25 min |
| D·2 | Bloque A: 29 migraciones + 13 verificaciones | 1 h 30 min |
| D·3 | reload + verificación del A | 15 min |
| D·4 | Congelar y avisar | 5 min |
| D·5a | Bloque B: 14 migraciones + 8 verificaciones (con la de la `067`) + comparar la `025` con P-1(e) | 1 h |
| D·5b | Bloque C: 27 migraciones + 18 verificaciones + los tres chequeos previos | 1 h 35 min |
| D·5c | Marcar los datos de prueba: consulta, pausa, paso, consulta | 15 min |
| D·6–D·8 | merge, deploy, post-deploy, descongelar | 35 min |
| D·9 | Accesos (§6): usuario de Josuarth, su contraseña, desactivar contador.test y re-desactivar los dos inactivos, consulta | 25 min |
| | **Total del día** | **~6 h 05 min** |
| | **Congelado (D·4 a D·8)** | **~3 h 30 min** |

La `097` a la `101` suman en el ensayo 128 ms de SQL y 390 ms de verificaciones; lo que agregan es el
trabajo de pegar y leer: 5 migraciones a 2,5 min y 2 verificaciones a 1 min ≈ **15 min** de congelado.

Ventana de bitácoras: 5 migraciones + recarga + prueba de humo en la app (guardar un comentario,
emitir y anular una factura de prueba no: es producción; basta con guardar y leer una bitácora) ≈
**30 min**.

> El runbook viejo estimaba 3 h 45 min para 42 migraciones. Con las 20 del C y el paso de datos, el
> congelado pasa de ~1 h 30 min a ~3 h 10 min. «Accesos» no necesita congelar. Si hace falta acortarlo: la `048`→`049`→`050`→`066` están en el B
> sólo porque rompen el módulo de compras de `main`, y producción tiene **cero compras**; pasarlas
> al A acortaría el congelado unos 15 min. **No se hizo**: es mover un orden verificado y lo decide
> Oliver. Si se decide, se cambia `orden.mjs` y se vuelve a ensayar.

---

## 4. Qué falló en el ensayo, qué cambia y qué faltaba en el runbook

Ninguna migración falló. Lo que salió son problemas de las VERIFICACIONES y del paso −1:

1. **`verificacion-067` va después de la `025`, no después de la `067`.** Usa
   `chart_of_accounts.cuenta_control`, que crea la `025` (al final del B). En el ensayo falló
   pegada a la `067` y pasó al final. Se corre al terminar el Bloque B.
2. **Siete verificaciones no prueban nada en producción:** `046`, `048`, `052`, `053`, `054`, `060`
   y `071` dicen «nada que verificar» porque el libro está vacío y no hay compras ni proveedores.
   La `066` y la `076` directamente fallan por la misma razón («no hay compra de prueba»; la NC sin
   compra exige un proveedor). **No es motivo de parar**: en el día D se anotan como «sin datos» y la
   prueba real es este ensayo, donde se corrieron con datos de «primer uso»
   (`datos-primer-uso.sql`: un proveedor, una compra, tres asientos y el banco de un cobro).
3. **Cada verificación se corre pegada a su migración, nunca al final.** Corridas todas al terminar
   la ventana, diez fallan (`038`, `039`, `048`, `049`, `050`, `051`, `055`, `066`, `068-069`, `071`):
   están escritas contra el motor de su momento (13 parámetros antes de la `071`, el `AD-` libre,
   el cobro sin referencia antes de la `074`, la firma vieja de la NC de compra antes de la `076`).
   No son pruebas de regresión. Si una se corre tarde y falla, no dice nada de la migración.
4. **El paso −1 no prueba lo que dice.** Pide correr la de 41 tablas y la de concurrencia «en
   staging, con el mismo esquema que va a producción». Staging ya tiene todo (la `092` y las
   bitácoras): no es el esquema que va a producción en ninguna de las dos ventanas. Y en producción
   no se pueden correr: antes de la ventana de bitácoras no existe `auditoria`, y después piden un
   proveedor, un asiento y un cobro con banco que producción no tiene. **Cambio:** el paso −1 es
   este ensayo (§5), que arma la base igual a producción y corre las dos pruebas con el esquema
   exacto de cada ventana. Las de staging se pueden correr además, como hasta ahora.
5. **Faltaba en el runbook:** el orden de la `068` a la `092` (ahora §2), el chequeo de CUFE
   repetidos antes de la `092`, que el paso «Reasignar» de P-15 ya no va, la ventana aparte de las
   bitácoras y la versión de producción (17.6, confirmada por Oliver el 05/10).
6. ~~Menor: `business_expenses.status` sigue con `DEFAULT 'pagado'`~~ **Resuelto el 05/10:** la `093`
   cambia el default, la pantalla de compras arranca en «Pendiente de pago» y la API toma un alta sin
   estado como pendiente. Va con la `048` (§2, Bloque B).
7. **Desactivar un usuario no le quitaba el acceso** (encontrado ensayando §6 en staging el 05/10): sólo
   marcaba `public.users.active`, que ni el login ni el middleware miran. Un contador desactivado volvía a
   entrar y `/finanzas/reportes` le respondía 200. **El arreglo va en ESTA ventana, con el código del
   Bloque 1** (merge de D·6), no como un despliegue aparte (Oliver, 05/10: en producción hay dos usuarios
   desactivados y ninguno entra desde abril). Desactivar lo bloquea en Supabase Auth y reactivar lo
   desbloquea. Por eso «Accesos» va DESPUÉS del deploy, y ahí se re-desactivan esos dos (§6, paso 4).
8. **Anular una factura sin CUFE decía «quedó ANULADO ante la DGI»** si fallaba el libro (encontrado
   el 05/10, corregido el 06/10 en `d6f2a3d`). En ese camino no se le habla al PAC. Afecta a **FAC-HON-000489** y
   **FAC-HON-000503** de producción, las dos sin CUFE. **El arreglo va en ESTA ventana, con el código
   del Bloque 1** (merge de D·6). No lleva migración ni paso de datos. Ahora sin CUFE, interna o emitida
   fuera: el éxito dice «quedó anulada en el CRM… No se envió nada a la DGI» (aviso «Anulada en el
   CRM. No se envió nada a la DGI») y la falla dice «no se completó en el libro contable… sigue emitida,
   sin cambios», sin nombrar a la DGI (la NC total se compensa: no hay estado intermedio). Con CUFE,
   los mensajes no cambian de sentido. La reversión de una NC sin DGI de por medio sigue el mismo
   criterio. Probado en staging el 06/10 con FAC-HON-000030, en el estado de la 489: falla forzada del
   libro y después anulación normal (`scripts/verificar-anulacion-sin-cufe.mts`,
   `docs/finanzas/prueba-anulacion-sin-cufe.txt`). En producción **no se prueba anulando**: si alguna
   de las dos se anula después de la ventana, el mensaje que se lee es el nuevo.
9. 🔴 **Ninguna migración ni paso de la ventana pasa al libro un documento que ya existe** (revisado el
   06/10: los bloques que nombran `post_journal_entry` sólo leen su definición). Con la `096` eso está bien
   para lo anterior al 01/07 (contabilizado fuera), pero **los documentos reales DESDE el 01/07 hasta el día
   de la ventana quedan SIN asiento** también: el libro de producción está vacío y el posteo automático
   recién arranca con el deploy. La sección **a2** de la consulta los cuenta. ✅ **Decidido (Oliver,
   07/10): NO se postean en la ventana.** Se postean **después**, un mes por vez, cuando Josuarth revisa
   cada mes, con la pantalla de documentos existentes (§7). La ventana queda como está. Hasta entonces la
   antigüedad los muestra como «documentos sin asiento».
10. **Regenerar staging con la `096`:** las semillas (`seed:staging`, `seed:asientos` y
   `seed-gasto-tramite-demo`) bajan el inicio a 01/01/2025 mientras siembran y lo devuelven al 01/07/2026
   al terminar, también si fallan (`scripts/seed-data/inicio-contable-semilla.ts`). Ojo: el aplicador del
   `--reset` llega hasta la `048`; de la `049` a la `096` no hay un paso escrito (pendiente aparte).

---

## 5. Cómo se ensaya (paso −1)

En la máquina, sin Docker. Postgres 17 por npm, en una carpeta corta (Windows corta las rutas
largas: el error es `0xC0000106`):

```powershell
$D = "$env:TEMP\pgl"; New-Item -ItemType Directory -Force $D | Out-Null; Set-Location $D
npm init -y | Out-Null; npm i embedded-postgres@17.9.0-beta.17 pg
$B = "$D\node_modules\@embedded-postgres\windows-x64\native\bin"
& "$B\initdb.exe" -D "$D\data" -U supabase_admin -A trust -E UTF8 --locale=C
Add-Content -Encoding ascii "$D\data\postgresql.conf" "`nport = 54329`nlisten_addresses = 'localhost'`nshared_preload_libraries = 'pg_stat_statements'`ndeadlock_timeout = 1s`nmax_connections = 60`n"
& "$B\postgres.exe" -D "$D\data"      # dejarlo corriendo en otra terminal
```

Desde el repo (lee staging sólo para copiar el seed; escribe sólo en localhost):

```bash
node scripts/ensayo-ventana/ensayo.mjs base                  # prod_024 = producción hoy
node scripts/ensayo-ventana/ensayo.mjs ventana               # A → B → C, cada una con su verificación
node scripts/ensayo-ventana/ensayo.mjs verificar --primer-uso
node scripts/ensayo-ventana/ensayo.mjs bitacoras
node scripts/ensayo-ventana/ensayo.mjs marcar-pruebas        # el paso de datos de prueba, en otra copia
export ENSAYO_DATABASE_URL=postgresql://postgres@localhost:54329/ventana
node scripts/run-sql.mjs sql/tests/verificacion-087-captura-41-tablas.sql
node sql/tests/concurrencia-bitacora-libro.mjs
node sql/tests/concurrencia-bitacora-libro.mjs 3 --control
```

`ENSAYO_DATABASE_URL` sólo se acepta si apunta a localhost. Se para si: una migración da error, la de
41 tablas da una `FALLA`, la de concurrencia un deadlock, o el `--control` no se traba en todas.

---

## 6. Accesos (después de la verificación de la app)

Último paso del día, con la app nueva arriba y descongelada. **Tiene que ir después del deploy**: con el
código de `main`, «Desactivar» no le quita el acceso a nadie (§4, punto 7). El arreglo de usuarios
desactivados viaja en el merge del Bloque 1 (`30df55c`); no hay otro despliegue para eso.

**Antes del día:** confirmar con Josuarth el correo personal que va a usar (a confirmar). En el proyecto de
producción, la plantilla de correo «Reset Password» tiene que llevar `{{ .TokenHash }}` y mandar a
`/auth/recuperar` (así quedó el 15/08, cuando se probó de la computadora al celular).

1. **Oliver crea el usuario.** Administración › Usuarios › Nuevo usuario:
   - Nombre completo: el de Josuarth. Correo: el confirmado.
   - **Rol: Contador.** ⚠️ El formulario arranca en «Abogada»: hay que cambiarlo.
   - Contraseña: **una descartable**, larga, generada en el momento, que no se anota ni se envía a nadie.
     Nadie la va a usar: Josuarth define la suya en el paso 2. (El sistema no tiene invitación por
     correo; el enlace que le llega a Josuarth es el de «¿Olvidaste tu contraseña?», que cumple esa función.)
2. **Josuarth define su contraseña.** Oliver le avisa (sin contraseña de por medio, **nunca por
   WhatsApp ni por ningún chat**) que entre a la dirección del CRM, escriba su correo y toque
   **«¿Olvidaste tu contraseña?»**. Lo que ve (probado en staging el 05/10):
   - en el login, en verde: «Se envió un enlace de recuperación a su correo.»;
   - en su correo, el enlace de recuperación; funciona aunque lo abra en otro dispositivo (el celular);
   - el enlace abre **«Elige tu contraseña nueva»**: «Contraseña nueva» (mínimo 8 caracteres) y «Repetir
     la contraseña», botón «Guardar contraseña»;
   - «Contraseña actualizada · Entrando al sistema…», y entra: «Buenas tardes, …» con la tarjeta
     **Finanzas** (es lo único que ve un contador). «Entrar» lo lleva a Reportes.
   - Si el enlace venció o ya se usó, el login lo dice y se pide otro con el mismo botón.
3. **Josuarth confirma que entró.** Recién entonces Oliver, en Administración › Usuarios, **desactiva
   `contador.test@integra-panama.com`**. Desde este deploy, desactivar lo bloquea en Supabase Auth: el login
   le responde «user_banned». ⚠️ Una sesión que ya estuviera abierta dura hasta que vence su token (1 h):
   si hay dudas, hacer este paso con esa sesión cerrada.
4. **Los dos desactivados de antes.** Producción tiene dos usuarios desactivados (ninguno entra desde
   abril). Como se desactivaron con el código viejo, en Supabase Auth siguen habilitados: la consulta del
   paso 5 los muestra como «inactivo pero puede entrar». Para cada uno, en Administración › Usuarios:
   **Activar y enseguida Desactivar** (con el código nuevo, desactivar los bloquea). Son dos clics por
   usuario; en el medio queda activo unos segundos (Administración › Usuarios muestra los inactivos con
   su botón «Activar»).
5. **Comprobar** con `sql/verificacion/produccion-accesos-contador.sql` (sólo lectura; poner antes el correo
   de Josuarth en la primera línea del `WITH`). Esperado: una sola fila «contador» activa y es la de
   Josuarth, con «puede_entrar» y «ya_entró» en «sí»; contador.test con «activo = no» y «puede_entrar = no»;
   ninguna fila «inactivo pero puede entrar» (si queda alguna, es que falta el paso 4 con ese usuario);
   **VEREDICTO = OK**.

**Ensayado en staging el 05/10/2026** con dos usuarios ficticios (`contador.ensayo.0510@staging.test` y
`contador.ensayo2.0510@staging.test`; los dos quedaron desactivados y bloqueados): alta con contraseña
descartable (201) → «¿Olvidaste tu contraseña?» → enlace → «Elige tu contraseña nueva» → primer ingreso
→ la descartable ya no sirve (400). Desactivar con el código anterior: **seguía entrando** (200, y
`/finanzas/reportes` 200). Con el arreglo: `user_banned` (400); reactivar → entra (200); desactivar otra vez →
400. El correo en sí no se envió (dominio de prueba): el enlace se generó con el mismo token que pone la
plantilla. La consulta del punto 5 se probó en staging (sólo lectura): «OK» simulando los dos correos.

---

## 7. Después de la ventana: contabilizar los documentos existentes, un mes por vez

**No es parte de la ventana.** Es un paso aparte, uno por mes (julio, agosto, septiembre, octubre hasta el
día del deploy), cuando Josuarth revisa ese mes.

**Volumen real (producción, consulta de solo lectura del 07/10/2026), desde el 01/07/2026:** 91 facturas,
6 notas de crédito, 8 cobros y 85 gastos de trámite. **Ninguna compra.** **0 cobros cruzados** (ningún
cobro desde el 01/07 aplicado a una factura anterior), así que la apertura no tiene que dejar saldo de
100004 para eso. 🔴 **Antes de contabilizar julio hay que completar los proveedores y las cuentas de los
85 gastos de trámite y el banco de los 8 cobros** (ninguno los tiene). 🔴 **El botón «Contabilizar el mes» lo aprieta una
persona desde la pantalla. Nunca un agente ni un script** (`scripts/backfill-asientos-faltantes.mts` es
sólo de staging y tiene candado).

**🔌 Interruptor `FINANZAS_POSTEO_HISTORICO_HABILITADO`** (variable de entorno de servidor, sin migración):
- Controla los botones que escriben en el libro lo anterior a la ventana: «Contabilizar el mes» (documentos
  existentes, §7) y «Contabilizar» y «Reversar» (apertura, §8).
- **Apagado por defecto**: si la variable no existe (o tiene cualquier valor que no sea `true`), está apagado.
  Las pantallas se ven y dejan bajar la plantilla, el Excel en seco y el cuadre al corte; los botones que
  escriben quedan deshabilitados con «Disponible cuando el contador dé el visto bueno», y las rutas responden
  **403** aunque alguien las llame directo (lo exige `posteo-historico.test.ts`).
- **Producción: queda APAGADO en la ventana.** 🔴 Se prende **sólo con el visto bueno de Josuarth**, y lo prende
  Oliver: Vercel › proyecto del cliente › Settings › Environment Variables › `FINANZAS_POSTEO_HISTORICO_HABILITADO`
  = `true`, sólo en **Production**, y **Redeploy** (la variable se lee al arrancar). Es un cambio de env vars en
  producción: pausa obligatoria (CLAUDE.md). Para volver a apagarlo, se borra la variable y se vuelve a desplegar.
- Staging: prendido en `.env.local` (localhost). En los deploys de Preview no está cargada (apagado) hasta que
  se agregue en Vercel para Preview.

**Una vez, antes del primer mes:** las `097`, `098` y `099` ya están aplicadas desde la ventana (sin usar).
Lo único que falta es prender el interruptor, con el visto bueno de Josuarth.

**Antes, si la ventana no las incluyera (pausa obligatoria: cambio de esquema en producción):**
1. Respaldo de producción (la tarea programada «Respaldo Base Integra»).
2. Aplicar `097`, `098` y `099` (crean dos tablas, una función y dos triggers; no tocan datos).
   Verificación: `sql/tests/verificacion-097-posteo-de-documentos-existentes.sql` (en ROLLBACK, 12 casos con
   la 099).

**Requisitos de cada mes (si falta uno, la pantalla lo dice y no deja contabilizar):**
- 🔴 **Gastos de trámite con proveedor y con cuenta en cada línea.** En producción ningún gasto de
  trámite tiene proveedor (la 049 agrega la columna vacía) y las líneas de la 036 nacen sin cuenta. Se
  completan **en lote** en *Documentos existentes › Proveedores y cuentas de los gastos* (admin y
  contador): marcar varios gastos o líneas y asignarles el mismo proveedor o la misma cuenta.
- 🔴 **Cobros con banco.** Ningún cobro de producción tiene `payment_account_code` (llega con la 041,
  vacío). Se completa **en lote** en *Documentos existentes › Bancos de los cobros*.
- Las dos pantallas sólo muestran documentos SIN asiento, reales y desde el inicio contable; un documento
  con asiento no se toca (409, y la base lo vuelve a exigir). La bitácora contable registra cada cambio con
  su usuario. Cada fila de «Con problemas» lleva un botón «Corregir» a la pantalla que lo arregla.
- Compras con ficha de proveedor: la 033 la crea desde el nombre; revisar las que no enlazaron.
- Los meses anteriores ya contabilizados (van en orden) y el mes **abierto**. Después de la ventana
  todos los meses de 2026 quedan abiertos (ninguna migración cierra períodos; verificado en el ensayo:
  la base `ventana` tiene 1 a 12 en «abierto»). Si alguno estuviera cerrado, se reabre en Períodos
  Contables con motivo.
- 🔴 **Un mes se carga por un solo método** (099, Oliver 07/10). Si el mes tiene asientos **importados**
  vigentes, no se contabiliza (y los nombra). Los **ajustes a mano** (depreciación, provisiones) NO lo
  impiden: la pantalla y el Excel los listan en «Asientos manuales del mes» con el aviso «Revisa que ninguno
  registre un documento que también está en la hoja Asientos». Al revés, la importación masiva no entra en
  un mes ya contabilizado desde los documentos; el ajuste a mano sí.

**Cada mes:**
1. Josuarth (o Oliver) abre **Finanzas › Asientos de Diario › Documentos existentes, por mes**, elige el
   mes y baja **«Descargar en seco (Excel)»**. No escribe nada. Se puede hacer ANTES de aplicar la 097.
2. Josuarth revisa el Excel: hojas Léame, Asientos, Totales por cuenta, No se contabilizan, Con problemas
   y Asientos manuales del mes.
3. Se completa lo de «Con problemas» (botón «Corregir» de cada fila, o las dos pantallas en lote) y se
   vuelve a bajar hasta que no quede nada.
4. Con su visto bueno, **«Contabilizar el mes»** (confirmación). Entra todo el mes o nada. Si algo falla,
   el mes queda como estaba y el mensaje dice qué.
5. Volver a abrir el mes: tiene que decir «0 asientos» (repetirlo no duplica).

**Qué no entra:** documentos de prueba (094), FAC-HON-000496 y FAC-HON-000508 (emitidas sin CUFE ni
autorización de la DGI: se listan aparte y se resuelven por su lado) y lo que cuelga de ellas, las NC de una
anulación (su efecto es la anulación de la factura) y los cobros del caso de Legal. FAC-HON-000463 (real),
FAC-HON-000489 y FAC-HON-000503 (duplicadas) **sí** entran.

**Antes de la ventana, sólo lectura:** `sql/verificacion/produccion-documentos-de-un-mes.sql` lista los
documentos del mes (julio por defecto), si entran y qué les falta. No son los asientos: esos sólo los arma
la app.

**Probado en staging el 07/10:** julio (10 asientos, 1.000,10) corrido con dos corridas a la vez: una
contabilizó y la otra falló sin escribir nada; agosto (4 asientos, con la anulación de una factura de
julio) con el mes reabierto y vuelto a cerrar; las dos repetidas, «no hay nada que contabilizar».
Concurrencia en la base local del ensayo: `sql/tests/concurrencia-posteo-retroactivo.mjs`, 10 de 10.

---

## 8. Después de la ventana: el asiento de apertura

**No es parte de la ventana** y no se carga antes de que Josuarth confirme la fecha y los saldos. 🔴 Lo carga
una persona desde la pantalla, nunca un agente ni un script. Las `100` y `101` ya están aplicadas desde la
ventana; **«Contabilizar» y «Reversar» quedan apagados** por el interruptor `FINANZAS_POSTEO_HISTORICO_HABILITADO`
(§7) hasta el visto bueno de Josuarth. Apagado, se puede bajar la plantilla, revisar en seco y ver el cuadre.

1. **La fecha** (Finanzas › Configuración › Parámetros contables › Fecha de la apertura): 30/06/2026 (el día
   anterior al inicio contable, el valor por defecto) o 31/12/2025 (con enero a junio importado por Asientos ›
   Importar). Al 31/12 la apertura lleva sólo cuentas de balance; a mitad de año, también lo acumulado de las
   cuentas de resultado. No cambia mientras haya una apertura vigente.
2. **La plantilla** (Asientos de Diario › Apertura): con lo que conoce el CRM (hoy, una factura real anterior al
   inicio) o vacía. 🔴 **Los saldos salen de QuickBooks**, también la cuenta por cobrar y por pagar al corte: lo
   precargado es una ayuda, no la fuente. La hoja Léame y la pantalla lo dicen.
3. **Revisar en seco**: errores por fila y columna, totales por cuenta y el «Cuadre al corte» con ese archivo. No
   registra nada.
4. **Contabilizar**: un asiento `apertura` (número AD-), una sola vez. Desde ese momento los reportes dejan de
   sumar el `saldo_inicial` de las cuentas (y ya no se edita), y la antigüedad cuenta cada documento de la
   apertura con su fecha y vencimiento, sin repetir los documentos anteriores al inicio.
5. **Cuadre al corte** (misma pantalla y Excel): por cliente y proveedor, la apertura contra los documentos del
   CRM al corte. Una diferencia no es un error en sí: el CRM sólo sabe lo que se cargó en él.
6. **Corregir**: «Reversar la apertura» con motivo. La reversión lleva **la misma fecha** que la apertura y
   **sólo mientras su mes siga abierto**; después se carga otra. 🔴 **No cerrar el mes de la apertura hasta que
   Josuarth la dé por buena**: con el mes cerrado la pantalla no ofrece «Reversar» y la corrección va con un
   asiento de ajuste a mano.

**Probado:** `verificacion-100-101` 12/12 en staging (aplicadas el 07/10) y 11/11 en el ensayo completo de la
ventana. Prueba en staging con capturas (`docs/finanzas/capturas-apertura/`): con el interruptor apagado, la
revisión en seco funciona, el botón queda deshabilitado con el mensaje y las tres rutas responden 403 (plantilla,
Excel en seco y cuadre, 200); prendido: apertura ficticia al 30/06/2026 (AD-000002), reversión con la misma fecha
(asiento 152), apertura nueva corregida (AD-000003) con el cuadre de clientes en 0,00, la antigüedad sin el saldo
inicial y con la partida de la apertura, y con junio cerrado la pantalla no ofrece «Reversar».

