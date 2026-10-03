# Borrador para ideati (NO ENVIADO)

> Redactado el 03/10/2026 para que Oliver lo revise y lo mande. Nada de esto se envió.

**Asunto:** Integra Legal · tres consultas: notas de crédito, CPBS de reembolsos y facturas de prueba

Hola, Eduardo:

Les escribo desde el equipo de Integra Legal con tres consultas. Ya probamos en el ambiente de pruebas
los tipos 04, 05, 06 y 07, y los cuatro autorizaron con `0260` cuando van como corresponde (04 y 05 con el
CUFE de la factura; 06 y 07 sin referencia).

**1. Nota de crédito sobre una factura en papel o emitida fuera del sistema.**
Necesitamos acreditar facturas que no tienen CUFE en nuestro sistema: unas son de papel y otras se
emitieron fuera del CRM. Según la ficha técnica, eso sería una nota de crédito genérica (tipo 06) con el
grupo `gDFRefFacPap` (número de la factura en papel, B616). Cuando lo probamos el 24/09, el ambiente de
pruebas respondió `[0000] Object reference not set to an instance of an object`, igual con tipo 04 que
con tipo 06. La misma 06 **sin** referencia autoriza.
- ¿Cuál es la forma correcta de enviar una NC que corrige una factura en papel o fuera del sistema?
- ¿Se informa el bloque de factura en papel (B615/B616)? ¿Con qué estructura exacta en su API?
- Si la factura se emitió en su portal, ¿conviene referenciarla por CUFE con tipo 04, aunque nuestro
  sistema no la haya emitido?

**2. El código 8012 en las facturas de reembolso.**
En las facturas de reembolso (tipo 09) mandamos el código `8012` en el campo CPBS de cada línea, el mismo
que usamos en honorarios. El ambiente de pruebas las autoriza.
- ¿Qué significa el código `8012` en el catálogo de CPBS?
- ¿Es el código que corresponde a un reembolso de gastos legales a un cliente, o deberíamos usar otro?

**3. Facturas de prueba.**
Las facturas FAC-HON-000459, FAC-HON-000460 y FAC-HON-000461 (3 y 4 de junio de 2026) y FAC-HON-000463
(8 de julio de 2026) fueron pruebas internas.
- ¿Se autorizaron en el ambiente de producción de la DGI o en el de pruebas?
- Si fueron en producción, ¿cómo las anulamos?

Gracias de antemano.

Saludos,
Oliver Calvo
