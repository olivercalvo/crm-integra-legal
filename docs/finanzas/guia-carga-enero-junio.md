# Guía para cargar enero a junio de 2026

Para: Josuarth. Fecha: 08/10/2026.

## Qué vas a hacer

Pasar al sistema lo que hoy está en QuickBooks, en este orden:

1. Los saldos al 31/12/2025.
2. Enero, a mano.
3. Febrero a junio, un Excel por mes.

De julio en adelante no cargas nada a mano: las facturas, cobros y compras ya están en el CRM y se pasan al libro desde ahí.

## Antes de empezar

1. **Plan de cuentas** (Finanzas › Configuración › Plan de cuentas): todas las cuentas que vas a usar tienen que existir y estar activas. Si falta una, créala.
2. **Proveedores** (Finanzas › Compras › Proveedores): crea la ficha de cada proveedor de enero a junio, con su RUC y su DV. Cada uno recibe un código PRV-…, que es el que usas en los archivos.
3. **Clientes:** los códigos CLI-… están en la hoja de clientes de la plantilla de saldos iniciales. Si falta un cliente con saldo por cobrar, pide a las licenciadas que creen su ficha.

**Regla importante:** pon el proveedor en cada línea de gasto. El anexo de compras de la renta sale de ahí. Si falta, el sistema te avisa en amarillo pero deja registrar, y esa compra no sale en el anexo.

## Las fechas

Hay dos reglas, según dónde estés:

- **En las pantallas del sistema** las fechas se ven y se escriben con el **día primero**, como siempre: 31/12/2025 es el 31 de diciembre. Las fechas del texto de esta guía están escritas así.
- **En los archivos de Excel que subes** (saldos iniciales e importación de asientos), el sistema lee las fechas con el **mes primero (MM/DD/AAAA)**, como lo decidiste el 30/09. En un archivo, 02/05/2026 es el 5 de febrero.

Para no equivocarte con los archivos:

- Si tu archivo trae las fechas con el día primero, cambia «Formato de fecha del archivo» a DD/MM/AAAA antes de revisar.
- Las celdas con formato de fecha de Excel y las fechas escritas como 2026-02-05 se leen bien con cualquiera de los dos formatos.
- Antes de contabilizar, mira la columna **«Fecha leída»**: dice la fecha en palabras. Si sale otro mes, cambia el formato.

## Paso 1. Saldos al 31/12/2025

1. Finanzas › Configuración › Parámetros contables: en «Fecha de la apertura» escribe **31/12/2025** y guarda.
2. Finanzas › Configuración › Saldos iniciales: baja la **«Plantilla vacía»**.
3. Llena una fila por saldo, con los números de tu declaración de renta:
   - Solo cuentas de balance (activo, pasivo y patrimonio). El resultado de 2025 va en la **300002**.
   - En la **100004**, una fila por cada factura pendiente, con el cliente, el número de factura y su fecha. Igual en la **200001**, con el proveedor.
   - Los débitos y los créditos tienen que sumar lo mismo.
4. Súbela y aprieta **«Revisar en seco»**. No registra nada: te muestra los errores por fila. Corrige el Excel y vuelve a subirlo hasta que diga «Sin errores».
5. Aprieta **«Contabilizar la apertura»**.
6. Compara con QuickBooks en Finanzas › Reportes › Antigüedad de saldos, con «Al» **31/12/2025**. Por cobrar y por pagar tienen que dar lo mismo.

Si después encuentras un error, reversa la apertura (con un motivo) y cárgala de nuevo. Para eso, **no cierres diciembre de 2025** hasta que la apertura esté bien.

## Paso 2. Enero, a mano

En Finanzas › Asientos › Asientos de diario, registra un asiento por operación con su fecha, una descripción, la referencia (factura, cheque o transferencia) y las líneas. En cada línea va la cuenta, el débito o el crédito, y el tercero:

- En la 100004, el cliente (obligatorio).
- En la 200001, el proveedor (obligatorio).
- En las cuentas de gasto, el proveedor.

Al terminar, revisa los reportes de enero: Estado de resultado, Balance general y Libro mayor.

## Paso 3. Febrero a junio, un Excel por mes

1. En Finanzas › Asientos › Importación de asientos, baja la plantilla («Descargar plantilla»).
2. Llena un archivo por mes. Cada archivo admite hasta 200 asientos y 3.000 líneas.
3. Súbelo y revisa la vista previa:
   - **Errores en rojo:** no se registra nada. Corrige el Excel y vuelve a subirlo.
   - **Advertencias en amarillo:** no bloquean, pero revísalas.
4. Sin errores, aprieta **«Contabilizar»**. Entra el archivo completo o no entra nada.
5. Revisa los reportes del mes antes de subir el siguiente.
6. Cuando un mes esté bien, ciérralo en Finanzas › Asientos › Períodos contables.

### Cómo se llena el archivo

Una fila por cada línea del asiento. Las líneas de un mismo asiento van juntas y con el mismo número en la columna «Asiento».

| Columna | Qué va |
|---|---|
| Asiento | Número del asiento dentro del archivo (1, 2, 3…) |
| Fecha | Fecha del movimiento, la misma en todas las líneas del asiento |
| Descripción del asiento | Qué operación es. Va en la primera línea del asiento |
| Referencia | Número de factura, cheque o transferencia (opcional) |
| Cuenta | Código de la cuenta, por ejemplo 610008 |
| Tercero | Código del cliente (CLI-…) o del proveedor (PRV-…) |
| Descripción de la línea | Detalle de la línea (opcional) |
| Débito / Crédito | Monto positivo, con hasta dos decimales. Uno de los dos por línea |

### Ejemplo: dos compras y un cobro de febrero

Como es un archivo, las fechas van con el mes primero: 02/05/2026 es el 5 de febrero, 02/12/2026 el 12 de febrero y 02/20/2026 el 20 de febrero.

| Asiento | Fecha | Descripción del asiento | Referencia | Cuenta | Tercero | Descripción de la línea | Débito | Crédito |
|---|---|---|---|---|---|---|---|---|
| 1 | 02/05/2026 | Compra de útiles | F-4521 | 610008 | PRV-003 | Útiles de oficina | 100.00 | |
| 1 | 02/05/2026 | | | 200003 | | ITBMS | 7.00 | |
| 1 | 02/05/2026 | | | 200001 | PRV-003 | | | 107.00 |
| 2 | 02/12/2026 | Mensajería del mes | F-889 | 500003 | PRV-007 | Mensajería | 45.00 | |
| 2 | 02/12/2026 | | | 100001 | | Pagado con banco | | 45.00 |
| 3 | 02/20/2026 | Cobro de la factura FAC-HON-000210 | TR-5530 | 100001 | | Transferencia | 535.00 | |
| 3 | 02/20/2026 | | | 100004 | CLI-012 | | | 535.00 |

Cada asiento cuadra. En el asiento 2, la cuenta de gasto lleva el proveedor aunque se pagó al contado: así entra en el anexo.

## Si algo sale mal

- **Al revisar un archivo:** el sistema te dice la fila y qué pasa (una cuenta que no existe, un tercero que falta, un asiento que no cuadra, un mes cerrado). Corriges el Excel y lo vuelves a subir.
- **Un asiento ya registrado:** ábrelo y aprieta «Reversar», con un motivo. Después registras el correcto. Nada se borra.
- **Un archivo completo:** en Finanzas › Asientos › Asientos de diario › Ver importaciones, abre la importación y aprieta «Deshacer la importación».
- **Un mes ya cerrado:** se corrige con un asiento de ajuste en un mes abierto.
