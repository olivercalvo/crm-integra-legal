# Revisión del sistema contable con Josuarth

**Para:** Josuarth Torres
**Preparó:** Oliver Calvo
**Fecha de preparación:** 25/09/2026

Esta agenda recorre, en el orden en que trabaja un bufete, los 49 puntos que salieron de las
reuniones del 25/08 y del 09/09, más lo que se agregó después: gasto de trámite completo,
nota de crédito de venta ante la DGI, anulación ante la DGI, nota de crédito de compra,
importar asientos desde Excel, cierre de mes y el resumen de ITBMS con notas de crédito.

Todo se hace en el **ambiente de pruebas**. Ahí no hay un solo dato real del bufete: clientes,
facturas y montos son inventados, y la DGI que responde es la de pruebas. Nada de lo que se
haga en esta revisión llega a los libros del bufete ni a la DGI real.

---

## 0. Cómo entrar

1. Abre el enlace que te manda Oliver por correo (ábrelo completo, tal como llega).
2. Arriba de todo tiene que aparecer una banda naranja que dice **STAGING: DATOS DE PRUEBA**.
   Si no la ves, no sigas: estás en otro lugar.
3. Entra con el usuario **contador@staging.test**. La contraseña te la manda Oliver aparte.
4. Tu usuario tiene el rol **Contador**, el mismo que tendrás en el sistema del bufete. Con él
   ves: Reportes, Gastos del Bufete, Proveedores, Cobros (solo lectura), Asientos de Diario,
   Períodos Contables, Plan de Cuentas e Impuestos. También abres el detalle de cualquier
   factura, nota de crédito o gasto de trámite desde el Libro Mayor.
5. Lo que tu rol **no** ve (facturar, emitir notas de crédito de venta, registrar cobros,
   clientes y casos) lo muestra Oliver en su pantalla durante la reunión, con un usuario
   administrador.
6. **Tu usuario queda activo después de la revisión.** Sigues en el proyecto, así que es el
   mismo acceso que vas a usar de aquí en adelante en el ambiente de pruebas.

---

## 1. Cómo leer cada punto

- **Estado:**
  - ✅ **Listo:** hace lo que pediste.
  - 🟡 **Listo con valor por defecto:** funciona, pero con una decisión que tomamos nosotros
    y que tienes que confirmar. Está en la sección de decisiones del final.
  - ⏸️ **Pendiente de tu decisión:** no se construyó porque necesita tu respuesta primero.
- **Script de prueba:** pasos numerados con los datos exactos del ambiente de pruebas y lo que
  tiene que pasar en cada paso.
- **Probado:** cada script lo recorrió Oliver con clics el 25/09/2026, con usuario
  administrador. Donde el script registra algo que no se puede borrar (una factura, un pago),
  se probó hasta el botón de confirmar y se dejó el dato sin usar para la reunión. Así lo dice
  cada script.

**Documentos que nadie toca antes de la reunión:** están en la sección 16.

---

## 2. Tiempos y propuesta de dos sesiones

| # | Bloque | Minutos |
|---|---|---|
| 3 | Clientes y servicios | 10 |
| 4 | Facturación electrónica | 20 |
| 5 | Errores de la DGI y reenvío | 10 |
| 6 | Anulación | 10 |
| 7 | Nota de crédito de venta | 15 |
| 8 | Cobros y bancos | 15 |
| 9 | Compras y proveedores | 15 |
| 10 | Nota de crédito de compra | 10 |
| 11 | Pagos a proveedores y gasto de trámite | 15 |
| 12 | Plan de cuentas y saldos iniciales | 15 |
| 13 | Asientos manuales e importación | 20 |
| 14 | Cierre de mes | 10 |
| 15 | Reportes | 25 |
| 17 | Decisiones que necesitamos de ti | 40 |
| 18 | Preguntas para las licenciadas | 10 |
| | **Total** | **4 h** |

Pasa de dos horas, así que proponemos **dos sesiones**:

- **Sesión 1: ventas (1 h 55 min).** Bloques 3 a 8 (80 min), más las decisiones de ventas:
  3, 10, 13, 14, 16, 17 y 18 (25 min), y las preguntas para las licenciadas (10 min).
- **Sesión 2: compras, libro y reportes (2 h 05 min).** Bloques 9 a 15 (110 min), más el resto
  de las decisiones (15 min). Si alguna queda sin contestar, se responde por correo.

Entre una sesión y la otra puedes entrar solo con tu usuario y repetir los scripts que
quieras.

---

## 3. Clientes y servicios

### 2.1 · Cada servicio lleva a una cuenta de ingreso

- **Lo que pediste:** que cada tipo de servicio esté asociado a su cuenta de ingreso.
- **Estado:** 🟡 Listo con valor por defecto. Cinco servicios de honorarios tienen su cuenta
  (Corporativo 400001, Laboral 400003, Civil 400004, Penal 400005, Migratorio 400007). Los
  seis de reembolso van a 130003. **HON-FAM (Familia)** está en 400004 Derecho Civil como
  propuesta nuestra; separarla de Civil lo deciden las licenciadas (sección 18). **HON-OTROS**
  sigue en la cuenta vieja 4101, que está desactivada: por eso esa factura no se deja emitir.
  Ver decisión 3.
- **Ruta:** no tiene pantalla propia. Se ve en el asiento de cada factura, en el Libro Mayor.
- **Script de prueba:** es el script 4.2 (cuenta desactivada) y el asiento del 4.1.
- **Probado:** ✅ con el 4.1 y el 4.2.

### 2.2 · El reembolso va a 130003

- **Lo que pediste:** la línea de reembolso lleva su contrapartida a 130003, no a ingreso.
- **Estado:** ✅ Listo.
- **Ruta:** Reportes, Libro Mayor, cuenta `130003`. (Tu usuario puede.)
- **Script de prueba:**
  1. Abre el mayor de 130003 y busca **FAC-REI-000004** (Constructora Chiriquí Antiguo,
     reembolso de B/. 10.00, exento, del 24/09/2026).
     Resultado: asiento **56**, haber **10.00** en 130003, con contrapartida *Cuentas por
     Cobrar Clientes*. No aparece ninguna cuenta de ingreso.
- **Probado:** ✅.

### RUC y DV del cliente se revisan al guardar

- **Lo que pediste (09/09):** que un RUC mal escrito no se descubra recién cuando la DGI
  rechaza la factura.
- **Estado:** ✅ Listo.
- **Ruta:** Gestión Legal, Clientes, `FERRETERÍA VALLARINO, S.A.`, Editar. (Pantalla de Oliver.)
- **Script de prueba:**
  1. En **Dígito verificador (DV)** intenta escribir letras. Resultado: el campo no las acepta.
  2. En **RUC / Cédula** borra el número y escribe `12`. Aprieta **Siguiente** hasta el
     final. Resultado: aparece en rojo *El RUC "12" es demasiado corto para ser válido.* y
     no se guarda nada.
  3. Aprieta **Cancelar**.
- **Probado:** ✅.

---

## 4. Facturación electrónica

### 4.1 · Emitir una factura y enviarla a la DGI (incluye 2.3 y 6.4)

- **Lo que pediste:** que el ITBMS de venta vaya siempre a 200003, sin que el usuario lo
  pueda cambiar (2.3), y que el mayor se alimente de verdad desde facturación (6.4: *el 09/09
  se emitió una factura y el movimiento no apareció*).
- **Estado:** ✅ Listo.
- **Ruta:** Finanzas, Facturas, `DRAFT-ad8142bceaa8`. (Pantalla de Oliver.)
- **Script de prueba:**
  1. Abre el borrador `DRAFT-ad8142bceaa8`: Ferretería Vallarino, 3 × B/. 100.00 de
     honorarios corporativos con ITBMS 7 %, total **B/. 321.00**.
  2. Aprieta **Emitir factura interna**. Resultado: el diálogo avisa *Todavía no vale ante la
     DGI. Después de emitirla, envíala a la DGI desde esta misma factura con el botón «Enviar a
     la DGI».* Confirma. Resultado: la factura pasa a **FAC-HON-000022**, estado Emitida.
  3. Oliver prepara el ambiente antes de este paso. En la tarjeta de Facturación Electrónica
     aprieta **Enviar a la DGI** y confirma. Resultado: **Autorizada DGI**, con CUFE y
     protocolo.
  4. Ve a Reportes, Libro Mayor, cuenta `100004`. Resultado: aparece FAC-HON-000022 con
     fecha de hoy, débito **321.00**. En el mayor de `400001` aparece con crédito **300.00**
     y en el de `200003` con crédito **21.00**.
- **Probado:** ✅ hasta el diálogo de confirmación (anuncia *Número que se asignará:
  FAC-HON-000022, Total $321.00*). No se confirmó para no gastar el borrador. El envío a la
  DGI se probó completo el 25/09 con FAC-HON-000019, 000020 y 000021, las tres autorizadas.
- **Pregunta para ti:** ninguna.

### 4.2 · Una cuenta desactivada no deja emitir, y no gasta el número

- **Estado:** ✅ Listo.
- **Ruta:** Finanzas, Facturas, `DRAFT-d9b78ce42314`. (Pantalla de Oliver.)
- **Script de prueba:**
  1. Abre `DRAFT-d9b78ce42314`: Ferretería Vallarino, servicio HON-OTROS, B/. 10.70.
  2. Aprieta **Emitir factura interna** y confirma. Resultado: *No se puede emitir esta
     factura: el servicio «Honorarios, otros» (HON-OTROS) usa la cuenta de ingreso 4101, que
     no existe o está desactivada en el plan de cuentas.* La factura sigue en borrador.
  3. Abre el borrador `DRAFT-ad8142bceaa8` y aprieta **Emitir factura interna** sin
     confirmar. Resultado: sigue anunciando **FAC-HON-000022**: el intento fallido no se
     comió ningún número. Aprieta **Cancelar**.
- **Probado:** ✅. Verificado además en la base: el contador de facturas de honorarios siguió
  en 21.

### 2.4 · Tasas de ITBMS distintas del 7 %

- **Lo que pediste:** que el sistema no esté limitado al 7 %; que existan 10 % y 5 %.
- **Estado:** ✅ Listo. Se pueden crear tasas nuevas. Hay una de prueba, `PRUEBA_10`, creada
  y desactivada el 23/09.
- **Ruta:** Finanzas, Impuestos. (Tu usuario puede.)
- **Script de prueba:**
  1. Abre Impuestos. Resultado: EXENTO, ITBMS 0 %, ITBMS 7 % activas y PRUEBA_10 (10 %)
     inactiva.
  2. Aprieta **Nueva tasa**, escribe `5` en el porcentaje. Resultado: la pantalla muestra
     *se guarda como 0.0500 = 5 %*. Aprieta **Cancelar** (o guárdala si quieres verla en los
     selectores de factura y compra; después se desactiva).
- **Probado:** ✅ el 23/09 con PRUEBA_10 (alta, aparece en los tres selectores, se
  desactiva). Hoy se revisó el listado.

---

## 5. Errores de la DGI y reenvío

### Facturas que la DGI no aceptó

- **Lo que pediste (09/09):** ver cuáles facturas rebotó la DGI y por qué, en palabras.
- **Estado:** ✅ Listo.
- **Ruta:** Finanzas, Facturas. (Pantalla de Oliver.)
- **Script de prueba:**
  1. Abre Facturas. Resultado: arriba aparece *2 facturas con error en la DGI: la DGI no las
     aceptó y siguen sin reenviarse.*
  2. Aprieta **Ver cuáles**. Resultado: quedan **FAC-HON-000016** (Constructora Chiriquí
     Antiguo, B/. 10.70) y **FAC-HON-000007** (Aurelio Barría Quintero, B/. 107.00).
  3. Abre **FAC-HON-000007**. Resultado: *La DGI no aceptó esta factura. La DGI dice que el
     RUC del cliente no está bien formado.* y abajo *Qué hacer: revise el RUC y el dígito
     verificador (DV) en la ficha de Aurelio Barría Quintero…*
  4. **No aprietes nada en FAC-HON-000007.** Se queda así para esta demostración.
- **Probado:** ✅.

### Reenviar una factura con error

- **Estado:** ✅ Listo.
- **Ruta:** Finanzas, Facturas, `FAC-HON-000016`. (Pantalla de Oliver.)
- **Script de prueba:**
  1. Abre FAC-HON-000016. Resultado: el aviso de error de la DGI con el motivo.
  2. Aprieta **Reenviar a la DGI**. Resultado: la DGI de pruebas la vuelve a rechazar, porque
     el RUC del cliente es inventado, y el aviso muestra el rechazo nuevo. Un rechazo
     **nunca** borra el aviso aunque se corrija el cliente después.
- **Probado:** ✅ el 25/09 (reenvío con clics). Hoy solo se revisó la pantalla.

---

## 6. Anulación

### Anular ante la DGI una factura del mes

- **Lo que pediste (acta del 09/09):** *una factura de venta sólo se anula dentro del mismo
  mes. Cerrado el mes, la corrección es nota de crédito con fecha del día.*
- **Estado:** ✅ Listo. Además la DGI da **182 horas** desde la emisión para anular; pasado
  ese plazo, el botón **Anular** desaparece y queda solo **Nota de crédito**.
- **Ruta:** Finanzas, Facturas, la **FAC-HON-000022** del script 4.1. (Pantalla de Oliver.)
- **Script de prueba:**
  1. En FAC-HON-000022 aprieta **Anular factura**. Resultado: el diálogo dice *Esta factura
     está autorizada por la DGI. Al confirmar, el sistema la anula primero ante la DGI y
     después en el CRM.*
  2. Escribe un motivo de menos de 15 caracteres. Resultado: el botón no se habilita (la DGI
     exige 15).
  3. Escribe `Error en el monto de honorarios pactado` y marca la casilla. Confirma.
  4. Resultado: la factura queda **Anulada** y **Anulada en DGI**. Se crea una nota de
     crédito total automática y el asiento de la factura se reversa **con la fecha de hoy**:
     100004 haber 321.00, 400001 debe 300.00, 200003 debe 21.00.
- **Probado:** ✅ el 25/09 con FAC-HON-000019 y FAC-HON-000020 (anuladas ante la DGI con
  clics). Hoy no quedaba ninguna factura en condiciones sin gastar la del script 4.1.

### Pasadas las 182 horas, solo nota de crédito

- **Estado:** ✅ Listo.
- **Ruta:** Finanzas, Facturas, `FAC-REI-000002`.
- **Script de prueba:**
  1. Abre FAC-REI-000002 (emitida el 10/06/2026). Resultado: no hay botón **Anular**. En su
     lugar: *Esta factura no se anula: venció el plazo de 182 horas para anular ante la DGI.
     La corrección es una nota de crédito con fecha de hoy, que referencia el CUFE de esta
     factura.*
- **Probado:** ✅.

---

## 7. Nota de crédito de venta

### 2.5 y 2.6 · Nota de crédito por líneas, con su asiento

- **Lo que pediste:** que exista la nota de crédito como documento (2.5) y que invierta el
  asiento: débito a ingreso, crédito a cuenta por cobrar (2.6). El 09/09: *factura de mil,
  nota de crédito de doscientos.*
- **Estado:** 🟡 Listo con valor por defecto. La nota de crédito **no está en un desplegable
  junto a la factura**: se emite con el botón **Nota de crédito** desde la factura que
  corrige, porque siempre necesita una factura detrás. Ver la pregunta de abajo.
- **Ruta:** Finanzas, Facturas, `FAC-HON-000021`, botón **Nota de crédito**. (Pantalla de
  Oliver.)
- **Antes de empezar:** FAC-HON-000021 (Ferretería Vallarino, 2 × B/. 10.00 con ITBMS 7 %,
  total 21.40) ya tiene una nota de crédito parcial, **NC-000017**, autorizada por la DGI.
  Ábrela desde la factura: asiento propio **400001 debe 10.00**, **200003 debe 0.70**,
  **100004 haber 10.70**. Es el asiento de la factura al revés, por la parte acreditada.
- **Script de prueba:**
  1. En FAC-HON-000021 aprieta **Nota de crédito**. Resultado: *Saldo pendiente: B/. 10.70*.
     La línea *Honorarios corporativos · ITBMS 7 %* muestra disponible **1 de 2**: la otra
     unidad ya la acreditó NC-000017. No aparece **Anular**: una factura con una nota de
     crédito ya no se anula, se sigue acreditando.
  2. Marca la línea y escribe cantidad `2`. Resultado: en rojo, *La línea "Honorarios
     corporativos" tiene 1 disponible(s) para acreditar (facturado 2, ya acreditado 1).* y *La
     nota de crédito (B/. 21.40) supera el saldo pendiente (B/. 10.70).* El botón **Sí, emitir
     la nota de crédito** se apaga.
  3. Cambia la cantidad a `1`. Resultado: *Total de la nota de crédito B/. 10.70* y el botón
     se vuelve a encender.
  4. Motivo: `Descuento acordado con el cliente`. Aprieta **Sí, emitir la nota de crédito**.
  5. Resultado: nota de crédito **NC-000020** (la NC-000019 la toma la anulación del script 6)
     con fecha de hoy. Asiento propio igual al de NC-000017. La factura queda con saldo 0.00 y
     la marca *Acreditada total*.
  6. (Opcional. Oliver prepara el ambiente antes de este paso.) En la nota de crédito aprieta
     **Enviar a la DGI**. Resultado: **Autorizada DGI**, con CUFE que empieza
     con `FE04`.
- **Probado:** ✅ pasos 1 a 3 (el freno en rojo y el total de B/. 10.70). No se confirmó para no
  gastar la factura. El envío de una nota de crédito a la DGI se probó el 24/09 y el 25/09 (NC-000014 y
  NC-000017).
- **Pregunta para ti:** ¿te sirve que la nota de crédito se emita desde la factura, en lugar
  de un desplegable de tipo de documento?

### Reversar una nota de crédito

- **Estado:** ✅ Listo. Si la nota de crédito está autorizada por la DGI, primero se anula
  ante la DGI y después se reversa en el libro.
- **Ruta:** Finanzas, Facturas, FAC-HON-000021, nota **NC-000017**. (Tu usuario puede
  reversar.)
- **Script de prueba:**
  1. Abre NC-000017 y aprieta **Reversar**. Resultado: *Vas a reversar la nota de crédito de
     NC-000017 · 10.70 de la factura FAC-HON-000021. El asiento 66 no se borra: se postea su
     espejo con la fecha de hoy…* y *Se anula ante la DGI y se reversa en el libro contable.
     Quedan N horas de las 182 horas del plazo.*
  2. Escribe un motivo de 15 caracteres o más y confirma. Resultado: NC-000017 **Anulada**
     ante la DGI y en el libro, con un asiento espejo de fecha de hoy. La factura recupera
     10.70 de saldo.
- **Probado:** ✅ hasta el diálogo (el 25/09 por la noche decía *Quedan 165 horas*). ⚠️ **Este
  script sirve hasta el 01/10/2026.** El 02/10 vence el plazo de 182 horas de NC-000017 y el
  sistema, correctamente, deja de ofrecer anularla ante la DGI.

---

## 8. Cobros y bancos

### Un recibo para varias facturas, repartido por antigüedad

- **Lo que pediste (21/09):** *sí hace falta poder pagar varias facturas con una sola
  transferencia*, y que el contador vea la pantalla de Cobros.
- **Estado:** ✅ Listo. Tú ves Cobros y bajas el recibo en PDF; registrar lo hacen admin y
  abogada.
- **Ruta:** Finanzas, Cobros, **Registrar cobro**. (Pantalla de Oliver.)
- **Script de prueba:**
  1. Cliente: **FERRETERÍA VALLARINO, S.A.** Resultado: aparecen FAC-HON-000009 (saldo
     1,305.00), FAC-HON-000012 (214.00) y FAC-HON-000021 (10.70).
  2. Marca FAC-HON-000009 y FAC-HON-000012 y aprieta **Continuar**. Resultado: *Saldo
     pendiente total B/. 1,519.00*, próximo recibo **REC-000008**.
  3. Monto: `1600`. Banco: `100001 Banco General Operativa`. Aprieta **Registrar cobro**.
     Resultado: *El monto no puede superar el saldo pendiente (B/. 1,519.00)*. No se
     registra nada. (Esto es el excedente: ver decisión 10.)
  4. Cambia el monto a `1400`. Resultado: se reparte de la más vieja a la más nueva:
     1,305.00 a FAC-HON-000009 y 95.00 a FAC-HON-000012.
  5. Aprieta **Registrar cobro**. Resultado: recibo **REC-000008**. Asiento: **100001 debe
     1,400.00, 100004 haber 1,400.00**. FAC-HON-000009 queda Pagada y FAC-HON-000012 con saldo
     119.00.
  6. Abre el recibo y baja el PDF. Resultado: recibo de caja con RUC y DV en dos líneas.
- **Probado:** ✅ pasos 1 a 3 (el rechazo del excedente, verificado en la base: no se creó
  ningún recibo). Pasos 4 a 6 no se confirmaron para no gastar las facturas.

### Reversar un cobro

- **Estado:** ✅ Listo. Un cobro con asiento no se borra: se reversa con la fecha de hoy.
- **Ruta:** Finanzas, Facturas, `FAC-HON-000007`, sección Pagos. (Tu usuario puede.)
- **Script de prueba:**
  1. Mira el recibo **REC-000006**. Resultado: aparece tachado, *Reversado · asiento 26*, con
     su motivo. La factura volvió a tener saldo 107.00.
- **Probado:** ✅ (solo lectura, sin tocar FAC-HON-000007).

---

## 9. Compras y proveedores

### 4.1, 4.2 y 4.3 · Ficha del proveedor

- **Lo que pediste:** dirección, RUC, DV, razón social, razón comercial, teléfono y contacto
  (4.1); RUC y DV en columnas separadas para los anexos de la DGI (4.2); número con
  secuencia (4.3).
- **Estado:** ✅ Listo. El contacto es de la **persona** (nombre, teléfono, correo) y está
  separado del teléfono y correo de la **empresa**.
- **Ruta:** Finanzas, Proveedores. (Tu usuario puede.)
- **Script de prueba:**
  1. Abre Proveedores. Resultado: *2 proveedores · el próximo será PRV-003*. Columnas **RUC**
     y **DV** separadas: PRV-001 CABLE ONDA S.A, RUC `12314-5-8858787`, DV `67`.
  2. Abre PRV-001. Resultado: contacto *Mariela Q. Aguilar*, plazo 30 días, cuenta por
     defecto 610005.
- **Probado:** ✅ el listado. La ficha se probó el 23/09.

### 4.4 y 4.5 · Cuenta por defecto y plazo de pago

- **Lo que pediste:** una cuenta contable por defecto del proveedor, estilo QuickBooks (4.4),
  y los términos 1 a 30, 31 a 60, 61 a 90 y más de 91 en el proveedor (4.5).
- **Estado:** 🟡 Listo con valor por defecto. El plazo es un **número de días** con botones de
  atajo (contado, 30, 60, 90), no un tramo. Los tramos salen solos en la antigüedad, a partir
  del vencimiento. La cuenta por defecto solo se usa en compras: en gastos de trámite el
  valor por defecto sigue siendo 130003.
- **Ruta:** Finanzas, Gastos del Bufete, **Nuevo gasto**. (Tu usuario puede.)
- **Script de prueba:**
  1. Proveedor: **PRV-001 · CABLE ONDA S.A**. Resultado: aparece *Plazo: 30 días*, la línea
     se completa sola con **610005 · Internet** e ITBMS 7 %, y **Vence** queda en hoy más 30
     días.
  2. Cambia la cuenta de la línea. Resultado: se puede: el defecto no obliga.
  3. Aprieta **Cancelar** (o guarda la compra si quieres verla en el mayor).
- **Probado:** ✅ pasos 1 y 2 (fecha 25/09, vence 25/10). No se guardó.

### 3.1, 3.2 y 3.4 · Compra con líneas gravadas y exentas

- **Lo que pediste:** encabezado con proveedor, fecha, vencimiento y número de factura del
  proveedor (3.1); proveedor de una lista (3.2); ITBMS por línea, con gravadas y exentas en
  la misma factura (3.4).
- **Estado:** ✅ Listo.
- **Ruta:** Finanzas, Gastos del Bufete, `desarrollo crm fase 1`.
- **Script de prueba:**
  1. Abre la compra `desarrollo crm fase 1`. Resultado: **Proveedor** *PRV-002 Cliente en el
     Centro*, **RUC proveedor** `123456` y **DV** `05` en campos separados, y **N.º factura
     proveedor** `123456`.
  2. Resultado: dos líneas, una de 100.00 con ITBMS 7 % (7.00) y una de 10.00 exenta. Total
     **B/. 117.00**, *ITBMS (7 % sobre B/. 100.00) B/. 7.00*.
- **Probado:** ✅.

### 3.3 · Ítem en la línea de compra

- **Lo que pediste:** líneas con ítem, descripción, cuenta y monto.
- **Estado:** ⏸️ Pendiente de tu decisión. Descripción, cuenta y monto están; el **ítem** no.
  Ver decisión 7.

---

## 10. Nota de crédito de compra (3.5)

- **Lo que pediste:** la nota de crédito del proveedor, inversa a la compra: débito a cuentas
  por pagar.
- **Estado:** 🟡 Listo con valores por defecto: fecha contable de hoy, no se acredita más de
  lo que falta pagar, resta el ITBMS de compras en el mes de la nota, número del documento
  del proveedor obligatorio y CUFE opcional, numeración `NCP-`, solo para compras (no para
  gastos de trámite). Ver decisión 1.
- **Ruta:** Finanzas, Gastos del Bufete, `desarrollo crm fase 1`, **Registrar nota de crédito
  del proveedor**. (Tu usuario puede.)
- **Script de prueba:**
  1. Aprieta **Registrar nota de crédito del proveedor**. Resultado: *Lo que falta pagar de
     esta compra: B/. 117.00. Es el máximo que se puede acreditar.* Dos líneas con disponible
     100.00 y 10.00.
  2. Número del documento del proveedor: `NC-PRV-0930`. Fecha del documento: hoy. En la
     línea 1, base a acreditar `20`. Motivo: `Descuento por pronto pago`.
  3. Confirma. Resultado: **NCP-000003**. Asiento: **200001 debe 21.40**, **500002 Notarios
     haber 20.00**, **200003 haber 1.40**. Saldo de la compra: 117.00 a **95.60**.
  4. Abre la NCP-000003 y aprieta **Reversar** con un motivo. Resultado: asiento espejo con
     la fecha de hoy, la NCP queda Anulada y el saldo vuelve a 117.00.
- **Ejemplos ya registrados:** NCP-000001 (total, sobre la compra de combustible de febrero,
  asiento 69) y NCP-000002 (parcial y después anulada, asientos 70 y 71).
- **Probado:** ✅ hasta el diálogo del paso 1. El ciclo completo (total, parcial y anulada)
  se probó con clics el 25/09.

---

## 11. Pagos a proveedores y gasto de trámite

### Pago parcial a un proveedor

- **Lo que pediste (21/09):** *a un proveedor sí se le puede pagar por partes* y *un pago por
  factura*.
- **Estado:** 🟡 Listo con valor por defecto: el comprobante de egreso se numera `CE-000001`.
  Ver decisión 9.
- **Ruta:** Finanzas, Gastos del Bufete, `desarrollo crm fase 1`, **Registrar pago**. (Tu
  usuario puede.)
- **Script de prueba:**
  1. Aprieta **Registrar pago**. Resultado: *Saldo pendiente de la compra B/. 117.00* (o
     95.60 si ya hiciste el script 10). *Máximo: el saldo. Un monto menor es un pago
     parcial.*
  2. Monto `50`, banco `100001`, método Transferencia. Confirma. Resultado: **CE-000006**.
     Asiento: **200001 debe 50.00**, **100001 haber 50.00**. La compra queda parcialmente
     pagada.
  3. Baja el PDF del comprobante de egreso.
- **Probado:** ✅ hasta el diálogo. No se confirmó.

### 1.1 a 1.9 · Gasto de trámite (fondos legales 130003)

- **Lo que pediste:** proveedor de la lista (1.1), descripción (1.2), vencimiento (1.3),
  cuenta por línea con 130003 por defecto (1.4), banco de salida (1.5), asiento 130003 contra
  200001 al registrar (1.6), verlo en el mayor de 130003 con acceso al detalle (1.7), "Pagos"
  pasa a "Cobros" en los fondos del caso (1.8), mismo formulario que compras (1.9).
- **Estado:** ✅ Listo. El banco va en el **pago** del gasto, no en el gasto: registrar el gasto
  es la deuda con el proveedor, y pagarlo es la segunda transacción.
- **Ruta:** Reportes, Libro Mayor, cuenta `130003`. (Tu usuario puede.)
- **Script de prueba:**
  1. Abre el mayor de 130003. Resultado: columnas **Débito** y **Crédito** separadas, y cinco
     movimientos de tipo *Gasto de trámite*.
  2. Abre el de B/. 32.34 *Verificación B4: posteo automático en el alta*. Resultado: el
     detalle del gasto, asiento 34, dos líneas (130003 por 12.34 y 500004 por 20.00), y del
     caso **solo el número** (CORP-001).
  3. Resultado: tiene un pago CE-000004 **reversado**, y los botones **Registrar pago** y
     **Reversar**.
  4. (Pantalla de Oliver.) En Gestión Legal, Casos, CORP-001, fondos del caso: la sección dice
     **Cobros** y el formulario del gasto tiene proveedor, vencimiento y líneas con cuenta.
- **Probado:** ✅ pasos 1 a 3. El paso 4 no se probó hoy con clics (se probó el 21/09).

---

## 12. Plan de cuentas y saldos iniciales

### 5.1, 5.2 y 5.4 · Tipos, subcategoría NIIF y fecha del saldo inicial

- **Lo que pediste:** seis tipos de cuenta, incluido costo (5.1); subcategoría NIIF al crear
  la cuenta (5.2); fecha en el saldo inicial (5.4).
- **Estado:** ✅ Listo. La fecha que tienen hoy las cuentas es la de nuestra propuesta; la
  fecha real es la decisión 4.
- **Ruta:** Finanzas, Plan de Cuentas, **Nueva cuenta**. (Tu usuario puede.)
- **Script de prueba:**
  1. Tipo: **Ingreso**. Resultado: subcategoría obligatoria con *Ingresos Operativos*,
     *Ingresos de Inversión* e *Ingresos por financiamiento*.
  2. Tipo: **Activo**. Resultado: la subcategoría cambia a *Sin clasificar, Activo corriente,
     Activo no corriente, Propiedad, planta y equipo, Depreciación acumulada, Otro*, y es
     opcional. (Esto es el punto 5.3.)
  3. Aprieta **Cancelar**.
- **Probado:** ✅.

### 5.3 · Subcategoría solo en cuentas de resultado

- **Estado:** ⏸️ Pendiente de tu decisión. Ver el paso 2 de arriba y la decisión 8.

### 5.5 · El saldo inicial como asiento real

- **Estado:** ⏸️ Pendiente de tu decisión. Hoy el mayor muestra una fila "Saldo inicial"
  calculada desde el plan de cuentas; no hay asiento de apertura. Se arma cuando confirmes
  la fecha de corte (decisión 4). Ver decisión 5.

### 5.6 · Importar saldos iniciales por Excel

- **Estado:** ⏸️ Pendiente de tu decisión. Hoy se cargan dentro de **Importar cuentas**, con la
  columna "Saldo inicial" y sin fecha. Ver decisión 6.

---

## 13. Asientos manuales e importación

### 7.1 a 7.4 · Cuadre, tercero por línea y clonar

- **Lo que pediste:** alerta o bloqueo si no cuadra (7.1); sin los rótulos "Línea 1 / Línea
  2" (7.2); proveedor o cliente por línea (7.3); clonar un asiento (7.4): *abres un asiento
  viejo, le das copiar, y te queda uno igual.*
- **Estado:** ✅ Listo.
- **Ruta:** Finanzas, Asientos de Diario, asiento **50**. (Tu usuario puede.)
- **Script de prueba:**
  1. Abre el asiento 50. Resultado: columna **Tercero** con *Aníbal Serracín Concepción* en
     100004 y *CABLE ONDA S.A* en 200001, B/. 12.00. Dice *Reversado por el 51*.
  2. Aprieta **Clonar**. Resultado: *Copiado del asiento 50: cuentas, importes, terceros y
     descripciones vinieron tal cual. La fecha es la de hoy, no la del original.*
  3. Cambia el crédito de 12.00 a `10.00`. Resultado: *El asiento no cuadra: faltan B/. 2.00 en
     el crédito.* y el botón **Registrar en el libro** se apaga.
  4. Sal sin registrar.
- **Probado:** ✅.

### 7.6 y 7.7 · No se borra, se reversa con la fecha de hoy

- **Lo que pediste:** un asiento registrado solo se reversa (7.6), y la reversión lleva la
  fecha en que se hace (7.7, acta del 09/09).
- **Estado:** ✅ Listo.
- **Ruta:** Finanzas, Asientos de Diario, asiento **15**.
- **Script de prueba:**
  1. Abre el asiento 15 (*Depreciación de mobiliario*, 620001 debe 100.00, 112001 haber
     100.00, del 10/09/2026). Resultado: no hay Editar ni Eliminar; hay **Clonar** y
     **Reversar**.
  2. Aprieta **Reversar**, escribe un motivo y confirma. Resultado: asiento nuevo con 112001
     debe 100.00 y 620001 haber 100.00, **con fecha de hoy**, no del 10/09.
- **Probado:** ✅ hasta el botón **Reversar**. La reversión de un asiento manual se probó
  completa el 22/09 (asientos 50 y 51).

### 7.5 · Importar asientos desde Excel

- **Lo que pediste:** importar asientos desde Excel.
- **Estado:** 🟡 Listo con valores por defecto: fechas DD/MM/AAAA o AAAA-MM-DD, sin columna de
  tercero, cuentas control permitidas sin aviso, **todo o nada** (si una fila tiene error no
  se registra ninguna), tope de 200 asientos y 3.000 líneas por archivo. Ver decisión 2.
- **Ruta:** Finanzas, Asientos de Diario, **Importar desde Excel**. (Tu usuario puede.)
- **Archivos de prueba:** `asientos-con-errores.xlsx` y `asientos-validos.xlsx`, en esta misma
  carpeta.
- **Script de prueba:**
  1. Aprieta **Descargar la plantilla**. Resultado: un Excel con las columnas Asiento, Fecha,
     Descripción del asiento, Referencia, Cuenta, Descripción de la línea, Débito y Crédito,
     con instrucciones y el plan de cuentas.
  2. Sube `asientos-con-errores.xlsx`. Resultado: **8 errores** con fila y columna, todos
     juntos, entre ellos *El asiento "1" no cuadra: débitos B/. 100.00, créditos B/. 90.00;
     faltan B/. 10.00 en el crédito.*, *La cuenta 4101 está desactivada*, *El monto 10.555
     tiene más de dos decimales*, *Fecha inválida: "31/02/2026"* y *La línea tiene débito y
     crédito. Deja solo uno.* No hay botón para contabilizar.
  3. Sube `asientos-validos.xlsx`. Resultado: *4 filas · 2 asientos · débitos B/. 155.50* y el
     botón **Contabilizar 2 asientos (B/. 155.50)**.
  4. Contabiliza. Resultado: dos asientos nuevos con fecha 25/09/2026, y la importación queda
     en **Ver importaciones**.
  5. Abre la importación y aprieta **Deshacer la importación** con un motivo. Resultado: dos
     asientos de reversión con fecha de hoy; nada se borra.
- **Probado:** ✅ pasos 2 y 3 (vista previa, sin contabilizar). El ciclo completo se probó con
  clics el 25/09 (asientos 72 a 75).

---

## 14. Cierre de mes

- **Lo que pediste (09/09):** poder cerrar un mes para que no entre nada nuevo con esa fecha.
- **Estado:** ✅ Listo. Cerrar lo hacen admin y contador; reabrir pide un motivo y queda
  registrado.
- **Ruta:** Finanzas, Períodos Contables. (Tu usuario puede.)
- **Script de prueba:**
  1. En **agosto 2026** (0 asientos) aprieta **Cerrar** y **Sí, cerrar el período**.
     Resultado: agosto queda **Cerrado**, con tu nombre y la fecha.
  2. Ve a Asientos de Diario, asiento 15, **Clonar**, y cambia la fecha a `15/08/2026`.
     Aprieta **Registrar en el libro**. Resultado: *El período 2026-08 está CERRADO: no admite
     asientos nuevos.* No se registra nada.
  3. Vuelve a Períodos, **Reabrir** agosto. Resultado: pide un motivo de al menos 10
     caracteres y avisa que los estados de ese mes pueden cambiar. Escribe el motivo y
     confirma. Resultado: agosto queda **Reabierto**.
- **Probado:** ✅ completo, con enero 2026 en lugar de agosto. Enero quedó reabierto (en la
  pantalla dice "Reabierto"; la marca se conserva a propósito).

---

## 15. Reportes

### Resumen de ITBMS con notas de crédito

- **Lo que pediste:** que el resumen mensual de ITBMS sea el insumo de la declaración.
- **Estado:** 🟡 Listo con valor por defecto: las notas de crédito restan en el mes **de la
  nota**, no en el mes de la factura o compra que corrigen. Ver decisión 1 (J-5) y la
  pregunta de abajo.
- **Ruta:** Reportes, Resumen de ITBMS, septiembre 2026. (Tu usuario puede.)
- **Script de prueba:**
  1. Abre el resumen de septiembre 2026. Resultado, antes de los scripts de esta agenda:
     línea 1 **30.00**, línea 2 **20.00**, línea 3 **1.40**, línea 4 **83.60**, línea 5
     **300.00**, línea 6 **21.00**, línea 7 **(19.60)**, línea 10 **(19.60)**.
  2. Resultado: la línea 3 es 1.40 porque NC-000012 (de una factura de junio, autorizada en
     septiembre) resta su ITBMS en septiembre. La línea 4 es 83.60 porque NCP-000001 (de una
     compra exenta de febrero) resta 246.40 en septiembre.
  3. Mira **Detalle de facturas**: las notas de crédito aparecen como filas en negativo. Las
     anuladas no aparecen.
  4. Si ya hiciste el script 10 (NCP-000003): línea 4 baja a 63.60, línea 6 a 19.60 y línea 7
     queda en (18.20).
- **Probado:** ✅ paso 1 y 2 con los valores de arriba.
- **Pregunta para ti:** con esta regla, la línea 5 (compras gravadas, 300.00) queda **mayor**
  que la línea 4 (total de compras, 83.60), porque la nota de crédito de una compra exenta de
  otro mes resta del total y no de las gravadas. ¿Así lo quieres ver, o la nota de crédito
  debería restar en el mes de la compra original?

### 8.5, 8.6 y 8.7 · Estado de resultado NIIF

- **Lo que pediste:** agrupado por subcategoría con subtotal por grupo (8.5); distribución a
  socias después de la utilidad operativa, cerrando en cero (8.6); línea de impuesto sobre la
  renta (8.7).
- **Estado:** ✅ Listo. La línea de impuesto se oculta cuando vale 0, como pediste el 09/09.
  La distribución a socias es un cálculo del reporte, no un asiento.
- **Ruta:** Reportes, Estado de Resultado.
- **Script de prueba:**
  1. Abre el Estado de Resultado sin fechas. Resultado: *Total ingresos operativos
     293,957.06*, *Total costos operativos (10,713.88)*, *Utilidad Bruta operativa
     283,243.18*, *Total gastos operativos (37,704.12)*, *Utilidad Operativa 245,539.06*,
     *300004 Distribución a Socias (245,539.06)*, *Resultado del ejercicio 0.00*.
  2. Aprieta un número de cuenta. Resultado: abre el mayor de esa cuenta (6.2).
- **Probado:** ✅ (valores del 25/09; cambian con los scripts que registran).
- **Pregunta para ti:** todas las cuentas de gasto están hoy como **operativas**, incluida
  **700001 Gastos Bancarios**. ¿Alguna es de financiamiento o de inversión? Ver decisión 11.

### Balance general

- **Estado:** ✅ Listo.
- **Ruta:** Reportes, Balance General.
- **Script de prueba:**
  1. Abre el Balance. Resultado: *Total de Activo 261,918.38*, *Total Pasivo + Patrimonio
     -261,918.38* y el aviso *El balance cuadra*.
- **Probado:** ✅.

### 8.1 a 8.4 · Antigüedad de saldos

- **Lo que pediste:** antigüedad por cobrar y por pagar que se alimente sola (8.1, 8.2), con
  detalle por factura dentro de cada cliente o proveedor (8.3), y que cuadre contra el mayor
  (8.4).
- **Estado:** ✅ 8.1 a 8.3 listos. 8.4: 🟡 la diferencia contra el mayor **se explica en
  pantalla**, pero la mayor parte es el saldo de apertura que vino sin detalle de documentos.
  Cerrarla necesita tu lista de documentos pendientes a la fecha de corte (decisión 12).
- **Ruta:** Reportes, Antigüedad de Saldos, **Por cobrar** y **Por pagar**.
- **Script de prueba:**
  1. Abre **Por cobrar**. Resultado: *Total del auxiliar 2,047.40*, *Cuenta control 100004
     195,787.95*, *Diferencia 193,740.55*, y *De dónde sale esa diferencia*: saldo de apertura
     sin detalle **191,947.55** y documentos anteriores al 09/09 sin asiento **1,793.00**.
  2. Aprieta **FERRETERÍA VALLARINO, S.A. (3 docs)**. Resultado: se abren sus tres facturas
     con saldo, cada una con su tramo.
  3. Resultado: CONSTRUCTORA CHIRIQUÍ ANTIGUO tiene 400.00 en **61 a 90** (FAC-REI-000002,
     vencida el 10/07).
  4. Cambia a **Por pagar** y repite.
- **Probado:** ✅ **Por cobrar**. ⚠️ En este ambiente la explicación dice que hay *una tercera
  causa que este reporte no sabe explicar*: son documentos de prueba que dejamos en las
  verificaciones de septiembre, no un problema del cálculo.

### 6.1 a 6.4 · Libro Mayor

- **Lo que pediste:** débito y haber separados (6.1), abrir el mayor desde el número de cuenta
  (6.2), exportar a Excel con nombre de cliente y RUC (6.3), y que se alimente de verdad desde
  facturas y compras (6.4).
- **Estado:** ✅ Listo. El Excel lleva Nombre, RUC y DV en columnas separadas.
- **Ruta:** Reportes, Libro Mayor.
- **Script de prueba:**
  1. Abre el mayor de 100004. Resultado: columnas Débito, Crédito y Saldo, con facturas,
     cobros, notas de crédito y reversiones.
  2. Aprieta **Exportar a Excel**. Resultado: el archivo trae Fecha, Tipo, N.º documento,
     Nombre, RUC, DV, Descripción, Contrapartida, Débito y Crédito.
- **Probado:** ✅ paso 1 (mayor de 130003 con Débito, Crédito y Exportar). La descarga del
  Excel se probó el 02/09.

---

## 16. Datos de la demostración

### Documentos que nadie toca antes de la reunión

| Documento | Para qué script | Por qué |
|---|---|---|
| **FAC-HON-000007** | 5 | Se queda con el error de la DGI, sin nota de crédito |
| **FAC-HON-000016** | 5 | Segundo error de la DGI; el contador de "2 facturas" depende de ella |
| **DRAFT-ad8142bceaa8** | 4.1 y 6 | Es la factura que se emite y después se anula |
| **DRAFT-d9b78ce42314** | 4.2 | HON-OTROS con la cuenta desactivada |
| **FAC-REI-000002** | 6 y 15 | Plazo de 182 horas vencido; 400.00 en el tramo 61 a 90 |
| **FAC-REI-000004** | 3 | El reembolso que va a 130003 (asiento 56) |
| **FAC-HON-000009** y **FAC-HON-000012** | 8 | El cobro repartido (saldo 1,519.00) |
| **FAC-HON-000021** y **NC-000017** | 7 | Nota de crédito de la unidad que falta y reversar una autorizada (hasta el 01/10) |
| **Compra `desarrollo crm fase 1`** | 9, 10, 11 | NC de compra y pago parcial (saldo 117.00) |
| **Gasto de trámite de B/. 32.34, asiento 34** | 11 | Detalle desde el mayor de 130003 |
| **Asientos 15 y 50** | 13 y 14 | Clonar y reversar |
| **Agosto 2026** | 14 | Mes sin asientos para cerrar y reabrir |
| **PRV-001 CABLE ONDA S.A** | 9 | Cuenta por defecto 610005 y plazo 30 días |
| `asientos-validos.xlsx` y `asientos-con-errores.xlsx` | 13 | Archivos de la importación |
| `cuentas-de-resultado-niif.xlsx` | decisión 11 | Las 45 cuentas de resultado para que las clasifiques |

Números de control al 25/09/2026, para saber si alguien tocó el ambiente: último asiento
**75**, próximo recibo **REC-000008**, próxima factura de honorarios **FAC-HON-000022**,
próximo comprobante de egreso **CE-000006**, próxima nota de crédito de compra **NCP-000003**.

### Datos creados para esta revisión

Ninguno: todo lo que usan los scripts ya estaba. Lo único que se movió en el ambiente al
probar fue **cerrar y reabrir enero 2026**.

### Un dato de prueba que vas a ver

En la ficha de la nota de crédito **NC-000014** la línea dice *ITBMS_7 (0%)*. Es un dato de una
prueba del 24/09, no del cálculo; por eso esta agenda usa NC-000017.

---

## 17. Decisiones que necesitamos de ti

Cada pregunta dice qué hace el sistema hoy mientras no contestes, y qué cambia según tu
respuesta.

### 1. Nota de crédito de compra (punto 3.5)

**Hoy:** fecha contable de hoy; no se acredita más de lo que falta pagar; resta el ITBMS de
compras en el mes de la nota; número del documento del proveedor obligatorio y CUFE opcional;
número interno `NCP-000001`; solo para compras, no para gastos de trámite.

- **J-1.** ¿El bufete recibe notas de crédito de proveedores? ¿Cuántas al mes?
- **J-2.** ¿Qué fecha lleva en el libro: la del documento del proveedor o la del registro? Y
  si el mes del documento está cerrado: ¿fecha de hoy, o no se registra?
  *Cambia:* la fecha del asiento y el mes del resumen de ITBMS.
- **J-3.** Compra ya pagada y nota de crédito por más de lo que falta pagar: (a) no se
  registra hasta que el proveedor devuelva el dinero, (b) saldo a favor dentro de 200001,
  (c) cuenta de activo aparte (¿qué código?).
  *Cambia:* hoy se rechaza. Con (b) o (c) se registra y queda un saldo a favor.
- **J-4.** Si hay saldo a favor: ¿el proveedor devuelve el dinero, o se descuenta de la
  próxima compra? (Descontarlo rompe la regla de "un pago por factura".)
- **J-5.** ¿La nota de crédito resta el ITBMS de compras (haber 200003) en el mes de su fecha
  contable? *Cambia:* el mes en que baja la línea 6 del resumen de ITBMS.
- **J-6.** ¿Llegan notas de crédito por un monto global, sin línea (por ejemplo, pronto pago)?
  Si sí: ¿a qué cuenta y con qué ITBMS? *Cambia:* hoy se acredita línea por línea.
- **J-7.** Gasto de trámite ya refacturado al cliente (REIM): (a) además nota de crédito de
  venta al cliente, (b) queda en 130003 y se descuenta en la próxima refactura, (c) no se
  permite. *Cambia:* hoy la nota de crédito de compra no se ofrece en gastos de trámite.
- **J-8.** En un gasto de trámite, ¿la nota de crédito acredita la misma cuenta de cada
  línea?
- **J-9.** En los anexos de la DGI, ¿va como renglón negativo con RUC y DV en el mes de su
  fecha contable?
- **J-10.** ¿Número del documento del proveedor obligatorio? ¿Y el CUFE?
- **J-11.** ¿Te sirve `NCP-000001` como número interno?

### 2. Importar asientos desde Excel (punto 7.5)

**Hoy:** fechas DD/MM/AAAA o AAAA-MM-DD; sin columna de tercero; se permiten líneas contra
100004 y 200001 sin aviso; se rechaza el archivo entero si una fila tiene error; tope de 200
asientos y 3.000 líneas por archivo.

- **K-1.** ¿Escribes las fechas DD/MM/AAAA? ¿Usas celdas con formato de fecha?
- **K-2.** Si agregamos el tercero: ¿lo identificas por RUC o por código (CLI-, PRV-)?
- **K-3.** Líneas contra 100004 o 200001: (a) se exige tercero, (b) solo aviso, (c) no se
  permiten. *Cambia:* hoy pasan sin tercero y la antigüedad las nombra como asiento de diario
  sin cliente.
- **K-4.** ¿Hay cuentas que no deberían importarse (200003, bancos)? ¿Cuáles?
- **K-5.** ¿Se permiten fechas futuras dentro del mes siguiente?
- **K-6.** ¿Cuántos asientos por archivo usas, y cuántas líneas tiene el más grande?
  *Cambia:* el tope de 200 y 3.000.
- **K-8.** ¿Lo piensas usar para saldos iniciales? Si sí, va con la decisión 6.
- **K-9.** ¿Referencia obligatoria por asiento? ¿Descripción de línea obligatoria?
- **K-10.** ¿Montos con coma decimal (1.234,56) o con punto (1,234.56)? *Cambia:* hoy se
  aceptan los dos, y se rechaza lo ambiguo como `12.345`.

### 3. Cuenta de ingreso de HON-OTROS (punto 2.1)

**Hoy:** el servicio *Honorarios, otros* (HON-OTROS) sigue apuntando a 4101, una cuenta del plan
viejo que está desactivada, y **no se deja facturar**.
**Pregunta:** ¿a qué cuenta de ingreso va?
**Cambia:** la cuenta que elijas es la que queda; hasta entonces esa factura no sale.
(HON-FAM, Familia, la deciden las licenciadas: sección 18.)

### 4. Fecha de corte de los saldos iniciales

**Hoy:** el acta del 09/09 dice *al 30 de junio de 2026; el sistema arranca a registrar desde
julio*, pero no lo tenemos confirmado por escrito, y las cuentas cargadas llevan otra fecha.
**Necesitamos:** que lo confirmes por escrito.
**Te vamos a mandar:** el mayor de QuickBooks de enero a julio de 2026, que pediste el 09/09
para decidir la fecha.
**Cambia:** la fecha que muestra el mayor en la fila de saldo inicial, el primer mes que se
puede cerrar, y la fecha del asiento de apertura (decisión 5).

### 5. El saldo inicial como asiento de apertura (punto 5.5)

**Hoy:** el saldo inicial es una fila calculada en el mayor; no hay asiento.
**Pregunta:** ¿quieres un asiento de apertura real en el Diario, con la fecha de corte, que
salde todas las cuentas del plan?
**Cambia:** con sí, el Diario empieza con ese asiento y el mayor deja de calcular la fila. Un
asiento no se borra, así que se hace una sola vez y después de la decisión 4.

### 6. Importar saldos iniciales por Excel (punto 5.6)

**Hoy:** se importan dentro de **Importar cuentas**, en la columna "Saldo inicial", y el
archivo **no trae fecha**: toma la del inicio del período.
**Pregunta:** ¿necesitas una pantalla aparte solo para saldos, con columna de fecha? ¿O basta
con que la importación de cuentas pida la fecha?

### 7. Ítem en la línea de compra (punto 3.3)

**Hoy:** cada línea tiene descripción, cuenta, base e impuesto. No hay ítem.
**Pregunta:** ¿qué es el ítem para ti: un catálogo de cosas que el bufete compra (por ejemplo
"Internet", "Papelería") que trae su cuenta e ITBMS, o solo un código libre?
**Cambia:** con catálogo, cada línea se completa sola al elegir el ítem, como los servicios en
la factura.

### 8. Subcategoría en cuentas de balance (punto 5.3)

**Hoy:** en cuentas de ingreso, costo y gasto la subcategoría NIIF es obligatoria. En activo,
pasivo y patrimonio aparece también, **opcional**, con otra lista (corriente, no corriente,
propiedad planta y equipo…), que usa el Balance General para agrupar.
**Pregunta:** ¿la quitamos de las cuentas de balance, o la dejas porque sirve para el
Balance?

### 9. Nombre del comprobante de egreso

**Hoy:** cada pago a proveedor es un **CE-000001** (comprobante de egreso).
**Pregunta:** ¿te sirve ese nombre y ese prefijo, o el bufete usa otro?

### 10. Excedente de un cobro

**Hoy:** si el cliente transfiere más que lo que debe, el sistema **rechaza** el cobro (lo
viste en el script 8).
**Pregunta:** ¿dónde va el excedente: se queda en 100004 como saldo a favor del cliente, o va
a una cuenta de anticipos de clientes? ¿Cuál?
**Cambia:** con respuesta, el cobro se acepta y el sobrante queda en esa cuenta para aplicarlo
a la próxima factura.

### 11. Clasificación NIIF de las 45 cuentas de resultado

**Hoy:** toda cuenta de ingreso, costo y gasto que no tenía subcategoría quedó como
**operativa**. El Estado de Resultado del 25/09 no tiene ningún bloque de inversión ni de
financiamiento.
**Necesitamos:** que revises la lista de las 45 cuentas (va adjunta al correo:
`cuentas-de-resultado-niif.xlsx`) y marques en cada una su clasificación en la columna «Tu
clasificación». Por ejemplo: 700001 Gastos Bancarios.
**Cambia:** los subtotales del Estado de Resultado.

### 12. Detalle de los saldos de apertura de clientes y proveedores (punto 8.4)

**Hoy:** la antigüedad no cuadra con el mayor porque la apertura de 100004 (191,947.55) y de
200001 vino como un saldo único, sin facturas detrás.
**Necesitamos:** la lista de facturas pendientes de cobro y de pago a la fecha de corte, con
cliente o proveedor, número, fecha, vencimiento y saldo.
**Cambia:** con esa lista, la antigüedad cuadra contra el mayor y cada cliente muestra sus
facturas viejas en su tramo.

### 13. Nota de crédito sobre una factura ya cobrada

**Hoy:** no se puede acreditar más que el saldo pendiente de la factura. Si ya se cobró, hay
que reversar el cobro primero.
**Pregunta:** ¿se permite una nota de crédito sobre una factura cobrada, dejando al cliente
con saldo a favor? Es la misma pregunta que J-3 pero del lado de ventas, y conviene un solo
criterio para las dos.

### 14. Nota de débito

**Hoy:** no existe.
**Pregunta:** ¿el bufete emite notas de débito (por ejemplo, para cobrar un recargo sobre una
factura ya emitida)? Si no, se deja fuera.

### 15. Cierre anual del ejercicio y distribución a socias

**Hoy:** no existe un cierre del ejercicio. El 1 de enero no pasa nada automático: los meses
del año nuevo ya están abiertos y se sigue registrando, pero las cuentas de ingreso, costo y
gasto **no vuelven a cero**. Siguen acumulando lo de todos los años.
- El Estado de Resultado sin fechas suma todo lo registrado; con fechas, muestra solo ese
  rango.
- El Balance muestra el resultado como un renglón calculado, *Utilidad del Ejercicio*, con
  todo lo acumulado.
- La línea *Distribución a Socias* del Estado de Resultado también es un **cálculo** para que
  el resultado cierre en cero. La cuenta 300004 no tiene movimientos.
- Hoy el cierre se podría hacer a mano con un asiento de diario al 31/12, pero el sistema no
  lo arma.

**Pregunta:** ¿el cierre del ejercicio lleva un asiento real que deje las cuentas de resultado
en cero? ¿Contra qué cuenta: 300003 Utilidad del Ejercicio, 300004 Distribución a Socias, o
primero una y después la otra? ¿Con qué fecha, y la distribución a socias es anual o mensual?
**Cambia:** con asiento, el Estado de Resultado del año nuevo arranca en cero, el número de la
distribución sale del Diario y no del reporte, y el sistema puede armar ese asiento solo al
cerrar diciembre.

### 16. Reembolsos con sobreprecio

**Hoy:** en la reunión del 09/09 se vio que al cliente a veces se le cobra más que el gasto
real, y esa diferencia es ingreso del bufete: el cliente la reporta a la DGI como pago a
Integra. El sistema hoy manda **toda** la línea de reembolso a 130003, exenta. Si se factura
100 por un gasto de 80, en 130003 quedan 20 a favor que nadie pasa a ingreso. Además, una
factura de reembolso **no puede llevar líneas de honorarios** (lo pediste el 17/09).

**Opciones:**
- **(a)** Facturar el reembolso por el monto exacto (exento, contra 130003) y la diferencia
  como "gestión", ingreso con ITBMS. Como no se mezclan, son **dos facturas**: una de
  reembolso y otra de honorarios. Hace falta crear el servicio "gestión" con su cuenta de
  ingreso.
- **(b)** Facturar todo como reembolso y que tú pases cada mes el sobrante de 130003 a
  ingreso con un asiento de diario. No cambia nada en el sistema, pero ese ingreso queda sin
  ITBMS y sin factura que lo respalde.

**Pregunta:** ¿cuál usamos? Se decide junto con las licenciadas (sección 18).

### 17. El dinero que el cliente deposita para los gastos del trámite

**Hoy:** en cada caso, la sección **Cobros** registra lo que el cliente entrega para pagar los
gastos del trámite. Ese registro **no genera asiento**: no tiene banco ni cuenta, y el dinero
no entra al libro. Al libro llega después, cuando se factura el reembolso y se cobra esa
factura.
**Pregunta:** ¿ese depósito tiene que registrarse en el libro cuando entra? Si sí, ¿contra qué
cuentas? Por ejemplo: debe 100003 Banco General Saldo Clientes, haber 200004 Anticipo de
Clientes (o haber 130003). ¿Y en qué banco entra normalmente?
**Cambia:** con asiento, cada depósito pediría el banco y dejaría su asiento. La factura de
reembolso tendría que descontar ese anticipo en vez de dejar una cuenta por cobrar nueva.

### 18. Facturar algo que no es un servicio legal

**Hoy:** no se puede. Cada línea de una factura necesita un servicio del catálogo, que dice a
qué cuenta de ingreso va. El catálogo solo tiene honorarios y reembolsos, y no hay pantalla
para agregar un servicio: se hace por fuera del sistema. Por ejemplo, la venta de un equipo de
la oficina hoy no se puede facturar desde aquí.
**Pregunta:** ¿el bufete factura cosas que no son servicios legales? ¿Con qué frecuencia? En la
venta de un activo, ¿cómo quieres el asiento (baja del activo y su depreciación, ganancia o
pérdida)?
**Cambia:** según la respuesta, se agrega al catálogo un servicio "otros ingresos" con su
cuenta, o se arma un camino aparte para la venta de activos.

---

## 18. Preguntas para las licenciadas

Estas no son del contador: las decide el bufete. Las repasamos contigo para que sepas qué se
les va a preguntar.

### L1. ¿Honorarios de familia separados de civil?

**Hoy:** el servicio *Honorarios familia* (HON-FAM) va a **400004 Derecho Civil**, como
propuesta nuestra. El 09/09 dijiste que separar Familia de Civil lo decide la dueña.
**Cambia:** si lo quieren separado, se crea una cuenta de ingreso de Familia y el servicio pasa
a esa cuenta. Si no, queda como está.

### L2. ¿Pagan trámites con tarjeta de crédito?

**Hoy:** un pago a proveedor o de un gasto de trámite sale siempre de un **banco**. No hay una
cuenta de tarjeta de crédito por pagar en el plan.
**Cambia:** si pagan con tarjeta, hace falta crear esa cuenta de pasivo y permitir elegirla como
medio de pago. Después, el pago de la tarjeta al banco es otro movimiento.

### L3. Reembolsos con sobreprecio: ¿cómo quieren facturarlo?

Es la decisión 16, vista desde el bufete: ¿dos facturas (reembolso exacto y gestión aparte con
ITBMS) o una sola de reembolso con el ajuste que hace el contador cada mes? Se decide junto con
Josuarth.
