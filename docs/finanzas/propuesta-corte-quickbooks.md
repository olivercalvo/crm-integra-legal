# Propuesta: corte con QuickBooks y documentos «contabilizado fuera»

> 03/10/2026 · **Solo diseño, nada construido.** Reemplaza la versión anterior del mismo día, que mezclaba
> dos fechas en una y por eso chocaba con P-9a.

## 1. Dos fechas, no una

| Fecha | Qué es | Valor | Quién la define |
|---|---|---|---|
| **A. Apertura contable** | El día de los saldos iniciales: un asiento de apertura con las cuentas de balance. Sin ingresos ni gastos acumulados. | **31/12/2025** (P-9a, Josuarth 02/10) | Fija |
| **B. Inicio del posteo automático** | Desde este día, cada documento del CRM genera su asiento. Lo anterior queda **«contabilizado fuera»**: vive como documento, sin asiento. | **01/07/2026, confirmada por Oliver el 03/10/2026** | Parámetro del bufete |

**Entre A y B (enero a junio de 2026)** el libro del CRM se llena con la **importación de asientos** que
carga Josuarth desde QuickBooks, con el tercero en cada línea de 100004 y 200001 (la importación ya lo
exige desde E3).

Con esto no hay choque con P-9a:
- la apertura es al 31/12/2025, como pidió Josuarth;
- 2026 completo está en el libro: enero a junio por importación, y desde julio por los documentos;
- no se cargan ingresos ni gastos acumulados.

```
31/12/2025 ── apertura (saldos de balance, con tercero en 100004 y 200001)
01/01/2026 ┐
   …       ├─ asientos importados de QuickBooks, mes a mes, con tercero  ← documentos del CRM: «contabilizado fuera»
30/06/2026 ┘
01/07/2026 ── fecha B ── desde acá, cada factura, NC, ND, cobro, compra, gasto de trámite y pago postea solo
```

## 2. El dato de producción que ordena todo

- Las 3 facturas autorizadas de junio (B/. 300) **fueron pruebas internas**, igual que FAC-HON-000463 de julio
  (dato de Oliver, 03/10/2026). La facturación real desde el CRM empieza en **julio**. Ver §9.
- **Mayo fue de prueba.**
- Desde marzo hay facturas, cobros y gastos de trámite en el CRM. Antes de la fecha B ninguno tiene asiento, y el libro de producción está vacío (plan del Bloque 1, §3).

Consecuencia: **todo lo que el CRM tiene antes de la fecha B ya está (o va a estar) en QuickBooks**, y
entra al libro del CRM por la importación, no por el documento.

## 3. La marca en la base

### 3.1 La fecha B

| Tabla | Campo | Notas |
|---|---|---|
| `finanzas_parametros` (078) | `inicio_posteo_automatico date NULL` | NULL = todo postea (como hoy). Admin y contador. **No cambia** si ya hay documentos marcados (trigger). |

### 3.2 La marca en cada documento

`contabilizado_fuera boolean NOT NULL DEFAULT false` en:

| Tabla | Fecha que se compara con B |
|---|---|
| `invoices` (facturas y ND) | `accounting_date` (068); sin la 068, `issue_date` |
| `credit_notes` | `accounting_date` |
| `payments` (cobros) | `payment_date` |
| `business_expenses` (compras) | `accounting_date` |
| `expenses` (gastos de trámite) | `accounting_date`; sin la 068, `date` |
| `supplier_payments` | `payment_date` |
| `client_payments` (cobros del caso, Legal) | `payment_date`. **Solo informativa**: hoy no postea nunca (`asiento-tesoreria.ts`) |

Guardada, no calculada al vuelo: la decisión es tan inmutable como el libro. Si alguien moviera B, una
cuenta al vuelo reclasificaría en silencio documentos con y sin asiento.

### 3.3 Reglas que pone la base

1. Trigger `BEFORE INSERT OR UPDATE`: fecha anterior a B ⇒ `contabilizado_fuera = true`. No lo elige la pantalla.
2. `post_journal_entry` **rechaza** un asiento cuyo `source_type`/`source_id` apunte a un documento marcado
   (el motor, como el tercero obligatorio).
3. No se marca un documento que ya tiene asiento: la migración aborta y lo lista. En producción no debería
   haber ninguno (libro vacío); en staging sí, y la salida es regenerar datos, no tocar el libro.
4. La marca no se quita (`true → false`), salvo con una llave tipo `finanzas.amount_paid_override` (SOP-017).
5. 🔴 **Después de fijar B no se registra un documento NUEVO con fecha anterior a B** (409). Los meses de
   enero a junio se llenan por importación; un cobro de mayo cargado en agosto como documento no tendría
   contraparte en el libro y rompería el cuadre. El caso «se olvidó cargarlo» se resuelve en la
   importación del mes, o con un asiento manual con tercero.

## 4. Cómo cuadran las facturas del CRM anteriores a B contra el 100004 importado

### 4.1 Lo que tiene cada lado al 30/06/2026

- **El libro (Mayor de 100004, por cliente)** = apertura al 31/12/2025 + asientos importados de enero a
  junio. Cada línea con su tercero. Es la verdad contable: lo que dice QuickBooks.
- **Los documentos del CRM marcados** = facturas, ND y NC de marzo a junio, con su saldo a esa fecha
  (después de sus cobros, también marcados).

No tienen por qué coincidir: el libro tiene además lo de QuickBooks que nunca pasó por el CRM (enero y
febrero, facturas hechas fuera, saldos de 2025).

### 4.2 La antigüedad, sin contar nada dos veces

Hoy (E9) la antigüedad suma por tercero los documentos con saldo **y** las líneas de diario y de apertura con
tercero en 100004. Con la importación eso **duplicaría**: la venta de marzo estaría como documento del CRM
**y** como línea importada.

**Regla nueva para todo lo anterior a B: por tercero, una sola cifra manda, la del libro.**

- **Antes de B**, la antigüedad de cada cliente se arma con:
  1. sus documentos del CRM marcados y con saldo, cada uno en su tramo real (por vencimiento);
  2. **una partida «Saldo anterior al corte sin documento en el CRM»** con fecha 30/06/2026 =
     *Mayor de 100004 del cliente al 30/06* − *Σ saldos de sus documentos marcados a esa fecha*.
- Las líneas importadas y la apertura **no entran como partidas sueltas**: entran a través de ese residuo.
- **Desde B**, la antigüedad es la de hoy: documentos con su asiento, y partidas de diario con tercero
  posteriores a B.

Por construcción, el total por cliente = su saldo en el Mayor, siempre. El residuo dice lo que el CRM no
explica:
- **positivo:** facturas de QuickBooks que no están en el CRM;
- **negativo:** un cobro o una NC en QuickBooks que el CRM no tiene, o al revés;
- **cero:** el CRM tiene todo el detalle.

### 4.3 El reporte «Cuadre al corte» (nuevo, solo lectura, admin y contador)

Por cliente, una fila con cuatro columnas:
- el Mayor de 100004 al 30/06;
- la suma de los documentos marcados a esa fecha;
- el residuo;
- de qué documentos sale la suma.

Igual para proveedores (200001) y para el fondo de trámites (130003). **Se revisa antes de cerrar julio.** Un
residuo que no se entiende se corrige en la importación de junio, no en el documento.

## 5. Cómo se aplican los cobros posteriores sin duplicar

Una factura de mayo (marcada), pendiente B/. 1,000, se cobra el 15/07:

| Paso | Documento | Libro |
|---|---|---|
| Venta de mayo | Factura FAC-HON-… en el CRM, marcada, sin asiento | La venta está en la importación de mayo (DEBE 100004 cliente / HABER ingreso, ITBMS) |
| Saldo al 30/06 | Factura con saldo 1,000 | 100004 del cliente incluye esos 1,000 |
| Cobro 15/07 | Recibo `CO-` aplicado a la factura (flujo normal): saldo de la factura 0 | Asiento del cobro **en el CRM**: DEBE banco / HABER 100004 (cliente) 1,000 |
| Resultado | Antigüedad: la factura sale | Mayor de 100004 del cliente baja 1,000. El residuo no cambia |

**Por qué no se duplica:**
- La venta entra una sola vez, por la importación: la factura marcada no tiene asiento (regla 3.3.2).
- El cobro entra una sola vez, por el CRM, porque es posterior a B. Josuarth no importa nada posterior a B
  que toque 100004 o 200001: la importación lo rechaza (regla nueva de `asientos-import.ts`, por fila, con
  el texto del caso).
- Los cobros anteriores a B están en QuickBooks y en la importación. Sus documentos en el CRM están marcados
  y no postean.

**Lo mismo del lado pagar:** una compra o un gasto de trámite de junio, pagado en agosto, se trata igual.
El pago postea `DEBE 200001 (proveedor) / HABER banco` y la compra marcada no postea.

**NC o anulación de una factura marcada después de B:**
- No se anula: no tiene asiento que reversar y su mes no está abierto.
- Se emite una nota de crédito con fecha de registro posterior a B. Postea su propio asiento (debita ingreso
  e ITBMS, acredita 100004 del cliente) y baja el saldo de la factura.

Es la regla del 09/09 tal como está.

## 6. Impacto en pantallas y reportes

| Lugar | Cambio |
|---|---|
| Antigüedad por cobrar y por pagar | Regla 4.2. Además, por pagar deja de leer solo los gastos de trámite **en el libro** (`antiguedad-source.ts:453`): los marcados con saldo también entran, si no desaparecen |
| «Diferencia contra el Mayor» | Antes de B se explica con el residuo por tercero; desde B, como hoy |
| Botón «Registrar en el libro contable» del gasto de trámite | 🔴 Desaparece para los marcados y la ruta responde 409: postearlo duplicaría la importación |
| Importación de asientos | 🔴 Nueva regla por fila: rechaza una línea en 100004 o 200001 con fecha igual o posterior a B |
| Resumen de ITBMS (`vat-calculo.ts`) | 🔴 Excluye los documentos marcados: enero a junio se declararon desde QuickBooks |
| Mayor, Diario, Estado de Resultado, Balance | Sin cambios: leen el libro, que ya trae enero a junio por la importación |
| Ventas mensuales, listados, PDF | Sin cambios (son documentos reales), con un badge «Contabilizado fuera» |
| Facturación electrónica | Sin cambios: lo fiscal y lo contable son preguntas distintas (SOP-038). Las 3 facturas autorizadas de junio siguen siendo de la DGI aunque estén marcadas |

## 7. Migraciones que harían falta (sin escribirlas)

1. **Apertura (E7)** con fecha 31/12/2025: incluye crear los períodos de 2025 (el motor solo crea el año
   en curso y el siguiente).
2. **`0xx_contabilizado_fuera`**:
   - el parámetro B;
   - la columna en las siete tablas;
   - los triggers de 3.3 (incluido el bloqueo de documentos nuevos anteriores a B);
   - el parche verificado de `post_journal_entry`;
   - un pre-flight que aborta si encuentra documentos anteriores a B con asiento.
3. Sin migración: el residuo de 4.2, el reporte de 4.3 y la regla de la importación son código (lectura y
   validación).

**Orden en la ventana:** 068 → … → apertura → 0xx → cargar B en Parámetros → Josuarth importa enero a junio
→ revisar el Cuadre al corte → cerrar enero a junio → operar.

## 8. Dudas

1. ~~**¿El 01/07/2026 es la fecha B?**~~ **Confirmada** por Oliver el 03/10/2026. La facturación real desde el
   CRM empieza en julio; las facturas de junio fueron pruebas (§9).
2. **Las facturas de prueba en producción:** respondida en §9 para las cuatro de junio y julio. Para las de
   mayo sigue en pie: si quedaron `emitida` con saldo, salen en la
   antigüedad como pendientes reales y ensucian el residuo. ¿Se anulan antes de fijar B? ¿O ya están
   anuladas o tienen otro estado?
3. **¿La importación de enero a junio trae las ventas por factura o por cliente y mes?** Las dos funcionan
   con el residuo. Por factura (con su número en la referencia externa) permitiría además conciliar
   documento por documento.
4. **Cobros del caso (Legal):** no postean y no deben. ¿Josuarth los refleja en QuickBooks como fondo de
   trámites (130003) o como anticipos (200004)? Si sí, entran por la importación y el CRM no cambia.
5. Un documento con fecha de documento antes de B y fecha de registro después: la propuesta usa la de
   **registro**. Es la que define el período del asiento.

## 9. Clientes de prueba (03/10/2026; ajustado el 05/10/2026: marca por documento)

### 9.1 El caso

En producción hay cuatro facturas que fueron **pruebas internas**, creadas por Oliver, `emitida` y
autorizadas:

| Factura | Fecha | Total | Cliente |
|---|---|---|---|
| FAC-HON-000459 | 03/06/2026 | 100.00 | 0TEST-FE-001 (receptor 02) |
| FAC-HON-000460 | 03/06/2026 | 100.00 | 0TEST-FE-002 (con el RUC del propio emisor) |
| FAC-HON-000461 | 04/06/2026 | 100.00 | 0TEST-FE-001 |
| FAC-HON-000463 | 08/07/2026 | 1.07 | 0TEST-FE-002 |

Las tres de junio quedan antes de B y la marca de §3 las saca del libro, pero **no** de la antigüedad
(siguen con saldo) ni de las ventas. **FAC-HON-000463 es de julio, después de B: sin otra regla se
contabilizaría** como venta real de 1.07 con su ITBMS.

### 9.2 La marca es del DOCUMENTO; la del cliente sólo vale para lo nuevo (ajustada el 05/10/2026)

> **Cambio del 05/10/2026.** La versión del 03/10 copiaba la marca del cliente a todos sus documentos.
> Con el resultado de `produccion-datos-de-prueba.sql` eso no sirve: **FAC-HON-000463 es real ante la
> DGI y su cliente es 0TEST-FE-002**, que es de prueba. Copiada desde el cliente, la 463 saldría de las
> ventas y del ITBMS del CRM mientras la DGI la tiene. La exclusión pasa a ser **por documento**.

- `de_prueba boolean NOT NULL DEFAULT false` y `de_prueba_motivo` (obligatorio al marcar) en cada documento:
  `invoices` (facturas y ND), `credit_notes`, `payments`, `client_payments` y `expenses`. **Es la única marca
  que leen los reportes.**
- `clients.es_de_prueba`, con `es_de_prueba_motivo`, `es_de_prueba_por` y `es_de_prueba_en`. **No se
  propaga a lo que ya existe**: sólo hace que los documentos NUEVOS de ese cliente nazcan `de_prueba`, y
  sirve para la regla fiscal de 9.3.4.
- Los documentos existentes se marcan **uno por uno, por número**, con una lista aprobada. Lo que no está en
  la lista no se marca, aunque su cliente sea de prueba: **ésa es la excepción explícita de la 463**, y queda
  escrita en el motivo del cliente («Excepción: FAC-HON-000463 … es real ante la DGI y sigue contando»).
- **Guardada, no calculada**, por la misma razón que §3.2: desmarcar no puede devolver en silencio documentos a
  las ventas de un mes cerrado.
- Lo marcan **admin y contador** (es una decisión contable). En la ventana, lo marca Oliver con el paso del
  runbook; la pantalla para marcar es posterior.

Es una marca distinta de `contabilizado_fuera`: un documento «contabilizado fuera» es real y está en
QuickBooks (cuenta en ventas, sale en listados); uno de prueba **no existe para el bufete**.

Lista aprobada el 05/10/2026 (resultado de `produccion-datos-de-prueba.sql`):

| Qué | De prueba | Se queda real |
|---|---|---|
| Clientes | CLI-066, CLI-069, CLI-070, 0TEST-FE-001, 0TEST-FE-002 | CLI-026 (INTEGRA LEGAL) |
| Facturas | FAC-HON-000454, FAC-REI-000038, FAC-HON-000455, 456, 457, 459, 460, 461 | **FAC-HON-000463** (cliente 0TEST-FE-002) |
| Gastos | — | el gasto ADM-001 de 1.00 |
| Usuarios | — | `contador.test@integra-panama.com` no se marca: se desactiva en el paso «Accesos» |

### 9.3 Reglas que pone la base

1. **No se marca un DOCUMENTO con asiento** (sacarlo de los reportes dejaría el libro sin documento detrás),
   ni una factura con un cobro aplicado que no sea de prueba. El cliente sí se puede marcar aunque tenga
   documentos reales con asiento: su marca no los toca. En producción el libro está vacío, así que hoy no hay
   ninguno.
2. `post_journal_entry` **rechaza** un asiento cuyo documento sea `de_prueba`. Ya **no** rechaza una línea por
   tener como tercero a un cliente de prueba: la 463 llevará a 0TEST-FE-002 en su línea de 100004 y es real.
   Un asiento MANUAL con un cliente de prueba como tercero sí se rechaza (no hay documento que lo decida).
3. Desmarcar (`true → false`), en el documento o en el cliente, solo con la llave `finanzas.de_prueba_override`
   (como SOP-017), y solo si el documento no cayó en un período cerrado.
4. 🔴 **Un documento NUEVO de un cliente de prueba no se manda a la DGI de producción** (409 en la puerta
   `enviar-a-la-dgi.ts`, antes del correlativo; en staging sí, para poder probar). Así no se repite el
   caso de las de junio. Nace `de_prueba` (regla de 9.2): para facturarle algo real a ese cliente, primero
   se desmarca el cliente con la llave.

### 9.4 Dónde deja de contar

| Lugar | Cambio |
|---|---|
| Libro (Mayor, Diario, Estado de Resultado, Balance) | Sin cambio de código: nunca tiene el asiento (regla 2) |
| Ventas mensuales, dashboard de Finanzas | Excluye `de_prueba` |
| Resumen de ITBMS (`vat-calculo.ts`) | Excluye `de_prueba` en débito y en las NC |
| Antigüedad por cobrar y estado de cuenta | Excluye `de_prueba`; el cliente no aparece |
| Cuadre al corte (§4.3) y residuo por tercero | Excluye `de_prueba` |
| Pendientes de enviar a la DGI | Excluye `de_prueba` |
| Exportaciones Excel | Las mismas funciones que la pantalla, así que heredan el filtro |
| Listados de facturas, NC, cobros | Ocultos por defecto, con el filtro «Mostrar pruebas» y un badge «Prueba» |
| Ficha del cliente | Banda «Cliente de prueba: sus documentos no cuentan en los libros ni en los reportes» |

Un solo predicado en código (`esDocumentoReal()` o un `.eq("de_prueba", false)` centralizado en los
loaders) y un test que recorra las fuentes de reportes y falle si alguna no lo usa, como `nav-guard`.

### 9.5 Lo fiscal es otra pregunta

La marca saca los documentos de **nuestros** libros, no de la DGI. Corrección del cruce de preguntas
(`docs/finanzas/cruce-preguntas-pendientes.md`, I-3), que lo encontró en el propio repositorio:
- **FAC-HON-000459, 460 y 461 se autorizaron en el SANDBOX** (`i_amb=2`, punto `001`, correlativos 1 a 3;
  `task_plan.md`, registro de pruebas de junio). Están en la base de producción porque hasta el 25/08
  `localhost` escribía en ella. **Para la DGI no existen**: no hay nada que anular allá.
- **FAC-HON-000463 es real ante la DGI**: fue la primera emisión en producción (go-live del 08/07, punto
  `051`), B/. 1.07 de Integra a Integra. La ventana de 182 h venció en julio: ante la DGI sólo se corrige
  con una **NC 04** con su CUFE, y esa NC también sería un documento fiscal real.
- La consulta de confirmación por `fe_emisiones.i_amb` está en el cruce (I-3); la corre Oliver.

Consecuencia para la propuesta: las tres de junio se marcan de prueba sin ningún paso fiscal. ~~La 463 es una
decisión de Josuarth~~ **Decidido el 05/10/2026: la 463 se queda REAL** (cuenta en libro, ventas e ITBMS
como la tiene la DGI); si hay que corregirla, es con una NC 04 con su CUFE. Por eso la marca pasó a ser
por documento (9.2). La pregunta 3 del borrador a ideati sobra.

### 9.6 Migración y paso de la ventana (escritos el 05/10/2026)

- **`094_documentos_de_prueba.sql`** (escrita, sin aplicar en staging; ensayada en local): columnas de 9.2,
  nacimiento `de_prueba` de lo nuevo de un cliente de prueba y las reglas 1 y 3 de 9.3. Va al final del
  Bloque C. Verificación: `sql/tests/verificacion-094-documentos-de-prueba.sql` (9/9 en el ensayo).
- **No incluye** la regla 2 (parche de `post_journal_entry`), la 4 (código) ni el filtro de 9.4. Hasta que
  existan, la marca no cambia ningún número: deja marcado lo que es de prueba para cuando se cableen.
- **El paso de datos** `sql/ventana/marcar-datos-de-prueba.sql`, sin DELETE, con la pausa obligatoria, entre
  `sql/verificacion/produccion-datos-de-prueba-a-marcar.sql` antes y después (runbook
  `ventana-bloque-1.md`, Bloque C). Aborta si un cliente de prueba tiene un documento que no está en la lista.

### 9.7 Dudas

1. ~~¿Hay más clientes de prueba en producción?~~ Respondida el 05/10 con `produccion-datos-de-prueba.sql`: la
   lista de 9.2. La consulta de antes del paso vuelve a buscar otros `0TEST-*` y lo que cuelgue de esos clientes.
2. ¿Marca admin y contador, o solo admin?
3. ¿Las pruebas de cotizaciones de esos clientes también se ocultan? La propuesta no las toca: no entran a
   ningún reporte contable.
