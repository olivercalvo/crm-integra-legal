# Guía: cómo cargar los saldos al 31/12/2025 y los meses de enero a junio de 2026

Para: Josuarth (contador). Fecha: 07/10/2026.

## La idea en una frase

Los saldos al **31/12/2025** entran como un **asiento de apertura**. Los movimientos de **enero a junio de 2026**
entran como **asientos de diario**: enero escrito a mano en la pantalla, y de febrero a junio subiendo **un archivo
de Excel por mes**. Desde **julio de 2026** las facturas, cobros, compras y pagos ya están en el CRM y se pasan al libro desde ahí, así que esos
meses no se cargan a mano.

## Antes de empezar (una sola vez)

1. **Revisa el plan de cuentas** (Finanzas › Configuración › Plan de cuentas). Toda cuenta que vayas a usar tiene que
   existir y estar **activa**. Si falta una, créala ahí antes de subir nada.
2. **Crea la ficha de cada proveedor** al que le compraste de enero a junio (Finanzas › Compras › Proveedores › Nuevo
   proveedor), con su RUC y su DV en campos separados. Cada ficha recibe un código **PRV-…**: ese código es el que
   vas a poner en los archivos.
3. **Revisa que cada cliente** al que le quede una cuenta por cobrar tenga su ficha con código **CLI-…** (Finanzas ›
   Ventas › Clientes).

> ⚠️ **Por qué importa el proveedor en cada línea de gasto:** el anexo de compras de la declaración de renta sale
> del Libro Mayor de cada cuenta de gasto, con el RUC, el DV y el monto **por proveedor**. Si una línea de gasto entra
> sin proveedor, el sistema la acepta (en una cuenta de gasto el proveedor no es obligatorio), pero **esa compra no
> aparece en el anexo**. Pon el código PRV- del proveedor en cada línea de gasto. Al importar un archivo, la
> revisión te lo avisa en amarillo con el número de fila (ver «Qué hace el sistema si algo no está bien»).

## Paso 1. Los saldos al 31/12/2025 (asiento de apertura)

1. Finanzas › Configuración › Parámetros contables › **Fecha de la apertura**: escribe **31/12/2025** y guarda.
2. Finanzas › Configuración › **Saldos iniciales** › «Plantilla vacía». Se baja un Excel con una hoja «Apertura» y, como
   ayuda, la lista de cuentas, clientes y proveedores.
3. Llena una fila por saldo, con los números de tu declaración de renta:
   - Como la apertura es al **cierre del año**, lleva **sólo cuentas de balance** (activo, pasivo y patrimonio). El
     resultado de 2025 va en la cuenta de resultados acumulados (**300002**). Si pones una cuenta de ingreso, costo o
     gasto, el sistema la rechaza y te dice cuál.
   - En **100004 (cuentas por cobrar)** va **una fila por cada factura pendiente**, con el cliente (CLI-…), el número de
     la factura y su fecha. Lo mismo en **200001 (cuentas por pagar)**, con el proveedor (PRV-…).
   - Los débitos y los créditos tienen que sumar lo mismo.
4. Súbelo y aprieta **«Revisar en seco»**. No se registra nada: ves los errores fila por fila y los totales por
   cuenta. Corrige en el Excel y vuelve a subir hasta que diga «Sin errores».
5. Aprieta **«Contabilizar la apertura»**. Queda un asiento con número AD-.
   Compárala con QuickBooks en Finanzas › Reportes › Antigüedad de saldos, con **«Al» 31/12/2025**: por cobrar y por
   pagar tienen que dar lo mismo que el reporte de QuickBooks a esa fecha. El campo «Al» sirve igual para revisar el
   cierre de cada mes: toma sólo lo registrado hasta ese día y cuenta los días de atraso contra esa fecha.
6. Si después encuentras un error, puedes **reversar la apertura** (con un motivo) y cargarla de nuevo, siempre que el
   mes de diciembre de 2025 siga abierto. Por eso, **no cierres diciembre de 2025** hasta que la apertura esté bien.

## Paso 2. Enero de 2026, a mano

Finanzas › Asientos › Asientos de diario: el formulario está en la misma pantalla. Un asiento por operación (o uno por grupo, como prefieras), con:

- la **fecha** del movimiento (dentro de enero);
- una **descripción**;
- la **referencia** del documento (número de factura, cheque o transferencia);
- las **líneas**, cada una con su cuenta, débito o crédito, y el **tercero**:
  - en 100004 el cliente y en 200001 el proveedor (aquí es **obligatorio**);
  - en cada cuenta de gasto, el **proveedor** (para el anexo de compras).

Sirve para probar los reportes de enero (Estado de Resultados, Balance, Mayor) antes de cargar los demás meses.

## Paso 3. Febrero a junio, un archivo por mes

1. Finanzas › Asientos › **Importación de asientos** › «Descargar plantilla».
2. Llena **un archivo por mes** (febrero, marzo, abril, mayo y junio). Cada archivo admite hasta 200 asientos y 3.000
   líneas.
3. Súbelo, elige en **«Formato de fecha del archivo»** cómo vienen las fechas (ver «Las fechas», abajo) y revisa la
   **vista previa**: muestra cada error con su fila y su columna, y la **fecha leída** de cada asiento. **Si hay un solo error no se registra nada**: corrige el Excel y vuelve a subirlo. Debajo de los errores
   pueden salir **advertencias** en amarillo (por ejemplo, un gasto sin proveedor): no bloquean, pero revísalas.
4. Con la vista previa sin errores, aprieta **«Contabilizar»**. Entra el archivo completo, o no entra nada.
5. Revisa los reportes del mes antes de subir el siguiente.

### Las fechas

La misma fecha escrita como texto se lee distinto según el formato: **03/04/2026 es el 3 de abril en DD/MM/AAAA y el 4 de
marzo en MM/DD/AAAA**. Por eso la pantalla pregunta el formato:

- **Por defecto es MM/DD/AAAA** (mes primero), como lo decidiste el 30/09. Si un archivo viene con el día primero,
  elige **DD/MM/AAAA** antes de subirlo o después: la vista previa se vuelve a leer sola.
- La **apertura** tiene el mismo selector, también con MM/DD/AAAA por defecto. La plantilla de la apertura trae las
  fechas como celdas de fecha de Excel, que se leen igual con los dos formatos.
- Una celda con **formato de fecha de Excel** se lee igual en los dos formatos, y si trae hora no cambia el día.
- **AAAA-MM-DD** (2026-04-03) también vale y no depende del formato.
- Una fecha que no existe en el formato elegido (por ejemplo 25/09/2026 leída como MM/DD) es error en esa fila.
- En un **CSV** la fecha se lee siempre como texto, con el formato que elegiste. Guárdalo como «CSV UTF-8».

**Revisa la columna «Fecha leída» de la vista previa**: dice la fecha en palabras («3 de abril de 2026») y, al lado, cómo
venía en el archivo. Si dice otro mes, cambia el formato antes de contabilizar.

### El formato del archivo

Una fila por línea del asiento. Las filas de un mismo asiento van **juntas** y con el mismo valor en «Asiento».

| Columna | Qué va | Obligatoria |
|---|---|---|
| Asiento | Un identificador del asiento dentro del archivo (1, 2, 3… o FEB-01). Las filas con el mismo valor forman un asiento | Sí |
| Fecha | La fecha del movimiento, la misma en todas las líneas del asiento (MM/DD/AAAA por defecto; ver «Las fechas») | Sí |
| Descripción del asiento | Qué operación es (al menos 3 letras). En la primera línea del asiento | Sí |
| Referencia | El documento que lo respalda (número de factura, cheque) | No |
| Cuenta | El código de la cuenta (por ejemplo 610008) | Sí |
| Tercero | Código del cliente (CLI-…) o del proveedor (PRV-…) | En 100004 y 200001 sí; en las cuentas de gasto, **ponlo siempre** |
| Descripción de la línea | Detalle de la línea | No |
| Débito | Monto positivo, hasta dos decimales | Uno de los dos |
| Crédito | Monto positivo, hasta dos decimales | Uno de los dos |

### Ejemplo: dos compras y un cobro de febrero

Las fechas van en MM/DD/AAAA, el formato por defecto (02/05/2026 es el 5 de febrero).

| Asiento | Fecha | Descripción del asiento | Referencia | Cuenta | Tercero | Descripción de la línea | Débito | Crédito |
|---|---|---|---|---|---|---|---|---|
| 1 | 02/05/2026 | Compra de útiles | F-4521 | 610008 | PRV-003 | Útiles de oficina | 100.00 | |
| 1 | 02/05/2026 | | | 200003 | | ITBMS | 7.00 | |
| 1 | 02/05/2026 | | | 200001 | PRV-003 | | | 107.00 |
| 2 | 02/12/2026 | Mensajería del mes | F-889 | 500003 | PRV-007 | Mensajería | 45.00 | |
| 2 | 02/12/2026 | | | 100001 | | Pagado con banco | | 45.00 |
| 3 | 02/20/2026 | Cobro de la factura FAC-HON-000210 | TR-5530 | 100001 | | Transferencia | 535.00 | |
| 3 | 02/20/2026 | | | 100004 | CLI-012 | | | 535.00 |

Cada asiento cuadra: el 1 suma 107.00 de cada lado, el 2 suma 45.00 y el 3 suma 535.00. En el 2, la cuenta de gasto
(500003) lleva el proveedor aunque se haya pagado al contado: así entra en el anexo.

## Qué hace el sistema si algo no está bien

| Si… | El sistema… |
|---|---|
| la cuenta no existe | marca la fila: «La cuenta 6100 no existe en el plan de cuentas» y no registra nada |
| la cuenta está desactivada | «La cuenta … está desactivada en el plan de cuentas». Actívala o usa otra |
| el código del tercero no existe | «No hay ningún cliente ni proveedor con el código PRV-099». Crea la ficha primero |
| falta el tercero en 100004 o 200001 | «La cuenta 100004 es de clientes: pon en Tercero el código del cliente (CLI-…)» |
| pones un cliente en 200001 (o un proveedor en 100004) | lo marca en la columna Tercero |
| falta el proveedor en una cuenta de gasto o costo (o pusiste un cliente) | muestra una **advertencia** en amarillo con la fila: «Esta línea no tiene proveedor: no saldrá en el anexo de compras». **No bloquea**: puedes contabilizar igual, pero esa compra no sale en el anexo. Lo mejor es corregir el Excel |
| un asiento no cuadra | «El asiento "2" no cuadra: … faltan B/. 5.00 en el crédito» |
| una línea tiene débito y crédito, o ninguno | lo marca en la fila |
| el mes está cerrado | «El mes 02/2026 está cerrado». Se reabre en Períodos contables |
| la fecha es posterior a hoy o no se entiende | lo marca en la columna Fecha |

En todos los casos de error (en rojo), **si hay un solo error no se registra ninguna fila del archivo**. Corriges y
vuelves a subirlo. Las advertencias (en amarillo) no impiden registrar.

## Si algo quedó mal después de registrar

- **Un asiento:** en su detalle, «Reversar» (con un motivo). Queda el espejo y se carga el correcto. Nada se borra:
  el libro es inmutable.
- **Un archivo completo:** Finanzas › Asientos › Asientos de diario › Ver importaciones › la importación › «Deshacer» (reversa todos sus
  asientos de una vez).
- **Un mes ya cerrado:** se corrige con un asiento de ajuste en un mes abierto.

## El orden, resumido

1. Plan de cuentas revisado; fichas de proveedores y clientes creadas.
2. Fecha de la apertura: 31/12/2025.
3. Apertura al 31/12/2025 (sólo balance) → revisar en seco → contabilizar.
4. Enero a mano → revisar los reportes de enero.
5. Febrero, marzo, abril, mayo y junio: un archivo por mes, revisando los reportes de cada mes antes del siguiente.
6. Cuando un mes esté bien, ciérralo en Períodos contables.
7. Julio en adelante: los documentos ya están en el CRM. Se pasan al libro mes por mes desde Finanzas › Asientos › Contabilizar documentos por mes («Contabilizar el mes»). No se cargan a mano.
