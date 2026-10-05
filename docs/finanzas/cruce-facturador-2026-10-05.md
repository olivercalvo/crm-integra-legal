# Cruce del facturador contra el CRM · 05/10/2026

> Fuente: `03_Documentos/facturador-2026-01-01-a-2026-10-05.xlsx` (hoja `Invoices`, 238 documentos, sucursal 0),
> leída en solo lectura. «Monto total» es **sin ITBMS**; acá «Total» = Monto total + ITBMS.
> Puntos de facturación: **050** = QuickBooks (hasta el 03/07) · **051** = CRM · **100** = portal directo.
> Todo lo que dice «verificado» se comprobó contra el archivo. Lo que depende de la base de producción del CRM
> **no** se pudo verificar desde acá (no se lee producción) y está marcado.

## 1. Totales por mes y punto

Facturas **autorizadas** (tipo 01 «Factura de operación interna» y 09 «Reembolso»). Las notas de crédito y
los documentos anulados (`canceled`) van aparte, en sus columnas.

| Mes | Punto | Facturas (de ellas reembolso) | Base | ITBMS | Total | NC autorizadas (base + ITBMS) | Anulados (base + ITBMS) |
|---|---|---|---:|---:|---:|---|---|
| 2026-01 | 050 | 7 (6) | 834.25 | 45.94 | 880.19 | | |
| 2026-02 | 050 | 16 (7) | 6,508.75 | 313.43 | 6,822.18 | 1 · 40.00 + 0.00 | 1 · 700.00 + 49.00 |
| 2026-03 | 050 | 29 (9) | 13,468.18 | 714.94 | 14,183.12 | | 1 · 40.00 + 0.00 |
| 2026-03 | 100 | 0 | 0.00 | 0.00 | 0.00 | 1 · 50.00 + 3.50 | |
| 2026-04 | 050 | 22 (7) | 14,886.00 | 747.25 | 15,633.25 | | |
| 2026-05 | 050 | 34 (17) | 17,505.05 | 608.13 | 18,113.18 | | |
| 2026-06 | 050 | 31 (11) | 8,765.55 | 386.98 | 9,152.53 | | 4 · 1,015.00 + 45.50 |
| 2026-07 | 050 | 7 (3) | 4,588.00 | 210.00 | 4,798.00 | | |
| 2026-07 | 051 | 7 (0) | 2,858.00 | 108.57 | 2,966.57 | | |
| 2026-07 | 100 | 2 (0) | 300.00 | 21.00 | 321.00 | | |
| 2026-08 | 051 | 42 (0) | 24,333.50 | 917.18 | 25,250.68 | | |
| 2026-08 | 100 | 1 (0) | 350.00 | 24.50 | 374.50 | | |
| 2026-09 | 051 | 28 (2) | 13,679.25 | 363.36 | 14,042.61 | | |
| 2026-10 | 051 | 4 (1) | 4,022.50 | 245.00 | 4,267.50 | | |
| **Total** | | **230 (63)** | **112,099.03** | **4,706.28** | **116,805.31** | **2 · 90.00 + 3.50** | **6 · 1,755.00 + 94.50** |

Por punto (facturas autorizadas): **050** 146 · 66,555.78 + 3,026.67 · **051** 81 · 44,893.25 + 1,634.11 ·
**100** 3 · 650.00 + 45.50.

Notas de lectura:
- **En el 051 casi no hay tipo «Reembolso» hasta el 17/09.** Los reembolsos del CRM salían como tipo 01 hasta
  ese día (`tipoDocumentoDeKind`; las 34 REI emitidas como 01 no se corrigen por decisión de Josuarth). Para
  separar honorarios de reembolsos en el 051 no sirve la columna «Tipo»: hay que cruzar con el CRM.
- **051 n.º 1** (09/07, «CLIENTE PRUEBA FE», 1.00 + 0.07) es la FAC-HON-000463, la prueba del go-live. Está en
  el total de julio del 051. Ver `cruce-preguntas-pendientes.md` I-3.
- **ITBMS 10 % y 15 %:** cero en todo el archivo.

## 2. Huecos de numeración

Verificado: los huecos que pasaste son **exactamente** los del archivo, sin números repetidos en ningún punto.

| Punto | Rango | Documentos | Huecos |
|---|---|---:|---|
| 050 | 441 a 607 | 153 | 443, 444, 445, 451, 458, 468, 475, 480, 518, 539, 541, 542, 568, 597 (14) |
| 051 | 1 a 90 | 81 | 3, 4, 5, 7, 8, 13, 15, 51, 74 (9) |
| 100 | 1 a 4 | 4 | ninguno |

- Un hueco en el 051 es un número que el CRM tomó (`allocateFeNumero`) y que la DGI no autorizó: un rechazo,
  una falla de transporte o una respuesta ambigua. El rechazado **no** aparece en el facturador. El detalle
  de cada uno está en `fe_emisiones` de producción (consulta pendiente; no se leyó desde acá).
- Los del 050 son de QuickBooks; el CRM no los puede explicar. Se le preguntan a Josuarth junto con J-2.

## 3. Los 4 casos del CRM (489, 503, 496, 508)

| CRM | Lo que pasaste | Lo que muestra el archivo | Estado de la verificación |
|---|---|---|---|
| FAC-HON-000489 | Duplicada, rehecha como 051 n.º 52 | **n.º 51 es un hueco** entre el 50 (15/08 12:04, NEW GENERATION) y el **52** (15/08 12:58, ALCON TECHNOLOGY SERVICES, 400.00 + 28.00) | ✅ el 52 existe y el número anterior se consumió sin autorizar. ⚪ Que el 52 sea el rehecho de la 489 depende del CRM |
| FAC-HON-000503 | Duplicada, rehecha como 051 n.º 75 | **n.º 74 es un hueco** entre el 73 (11/09 16:17) y el **75** (11/09 16:26, NEW GENERATION DEVELOPMENT CORP, 125.00 + 8.75); el 72 y el 73 son del mismo cliente minutos antes | ✅ el 75 existe y el número anterior se consumió sin autorizar. ⚪ Ídem |
| FAC-HON-000496 | Nunca emitida | Nada en el archivo la contradice | ⚪ Depende del CRM (fecha, cliente y monto) |
| FAC-HON-000508 | Nunca emitida | Ídem | ⚪ Ídem |

Lectura: el patrón de la 489 y la 503 es el mismo. El intento consumió un número que la DGI no autorizó (51 y
74), y la factura se volvió a hacer con el número siguiente. Si la 489 y la 503 siguen `emitida` en el CRM
junto con las facturas que generaron el 52 y el 75, **cuentan dos veces en CxC, ventas e ITBMS**. Se cierra
con `sql/verificacion/produccion-facturas-no-enviadas-detalle.sql` (la corre Oliver) y la decisión de anular
o hacer NC es de Josuarth (`propuesta-alerta-no-enviadas.md`).

## 4. Las 3 del punto 100 (portal directo) que no están en el CRM

Verificado contra el archivo:

| Punto-n.º | Emisión | Cliente | RUC | Base | ITBMS | Total | CUFE |
|---|---|---|---|---:|---:|---:|---|
| 100-2 | 14/07/2026 17:18 | MEI TOWER 1C, S.A. | 155763965-2-2025 | 150.00 | 10.50 | 160.50 | `FE0120000025046169-3-2021-4000002026071400000000021000112431062839` |
| 100-3 | 14/07/2026 17:22 | MEI TOWER 2B, S.A. | 155764022-2-2025 | 150.00 | 10.50 | 160.50 | `FE0120000025046169-3-2021-4000002026071400000000031000112587224588` |
| 100-4 | 01/08/2026 09:52 | MI CONDADO S A | 1725894-1-691335 | 350.00 | 24.50 | 374.50 | `FE0120000025046169-3-2021-4000002026080100000000041000110418925905` |

- La 100-4 es el reemplazo de FAC-HON-000467, que quedó anulada en el CRM tras fallar con la DGI. El
  archivo tiene además la **050-598** (27/06, MI CONDADO, 350.00 + 24.50, `canceled`) por el mismo monto: es
  probable que sea el mismo cobro intentado tres veces (QuickBooks, CRM y portal). Lo confirma Josuarth.
- No confundir la 100-3 con la **051-9** (17/07, MEI TOWER 2B, 300.00 sin ITBMS): es otra factura,
  emitida por el CRM.
- El punto 100 tiene **un cuarto documento** que no estaba en la lista: la **100-1**, NC tipo 04 del 04/03
  (Serfasa, 50.00 + 3.50). Es anterior a la fecha B (01/07), así que es territorio de QuickBooks. Lo más
  probable es que acredite una de las dos facturas idénticas de Serfasa del 04/02 (**050-456 y 050-457**,
  50.00 + 3.50 cada una, una duplicada). En la misma situación está la **050-461**, NC genérica 06 del 19/02
  (Condado Plaza, 40.00). Las dos entran en la importación de QuickBooks, no en el CRM.

## 5. Los 7 documentos de QuickBooks del 01 al 03/07

Verificado: son 7 documentos, 050-601 a 050-607, todos `authorized`. **Base 4,588.00 + ITBMS 210.00 = 4,798.00.**
Caen **después** de la fecha B (01/07/2026), así que, si no entran por la importación de Josuarth, tienen que
entrar por el CRM (ver `propuesta-facturas-emitidas-fuera.md`).

| N.º | Fecha | Tipo | Cliente | RUC | Base | ITBMS |
|---|---|---|---|---|---:|---:|
| 601 | 01/07 | 01 | RENTING PICHINCHA, S.A. | 155648082-2-2017 | 350.00 | 24.50 |
| 602 | 02/07 | 01 | JUMBO CAPITAL, S.A | 2676824-1-844561 | 1,500.00 | 105.00 |
| 603 | 02/07 | 09 | Condado Plaza, S.A. | 155591383-2-2015 | 70.00 | 0.00 |
| 604 | 02/07 | 01 | Administración de Propiedad Horizontal, S.A | 2283159-1-787269 | 350.00 | 24.50 |
| 605 | 02/07 | 09 | Administración de Propiedad Horizontal, S.A | 2283159-1-787269 | 314.50 | 0.00 |
| 606 | 03/07 | 01 | Dimedisa, S.A. | 355536-1-418137 | 800.00 | 56.00 |
| 607 | 03/07 | 09 | Dimedisa, S.A. | 355536-1-418137 | 1,203.50 | 0.00 |

Los CUFE completos están en el archivo, columna «CUFE».

## 6. Anulados en el facturador

Seis, todos del 050 (QuickBooks): 469 (26/02, Merlino Lab, 700.00 + 49.00), 497 (28/03, PPA CONDADO, 40.00),
573, 574 y 587 (19/06, VG Logistics, 300.00 + 21.00, 65.00 y 300.00) y 598 (27/06, MI CONDADO, 350.00 + 24.50).
El 051 y el 100 no tienen anulados.

## 7. Qué cuadra y qué no se pudo cuadrar

- ✅ Todo lo que pasaste coincide con el archivo: huecos, fechas, montos de las tres del punto 100, los 7 de
  QuickBooks y la existencia de los n.º 52 y 75 con un hueco justo antes.
- ➕ Dos documentos más que no estaban en la lista: la NC 100-1 (marzo) y la NC genérica 050-461 (febrero).
- ⚪ No se pudo verificar desde el archivo (requiere la base de producción del CRM): que la 489 y la 503 sean
  las del 52 y el 75, que la 496 y la 508 no tengan gemela, y el total del 051 contra el libro de ventas del CRM.
  Se cierra con las consultas de solo lectura que corre Oliver (`cruce-preguntas-pendientes.md`, L-1).
