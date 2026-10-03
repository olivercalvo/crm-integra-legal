# Inventario de facturación electrónica (03/10/2026)

Revisión del código y prueba en el sandbox de ideati. **Sin cambios de código.** Detalle de la prueba:
`prueba-tipos-05-06-07.txt`. Fuente normativa: *Ficha Técnica de Factura Electrónica para los Proveedores
de Autorización Calificados V1.00* (DGI, 25/05/2021), la más reciente publicada que se encontró; campo
B06 (`iDoc`) y grupo B60 (`gDFRef`).

## Qué dice la ficha

| B06 | Nombre en la ficha | Referencia (B60 `gDFRef`) |
|---|---|---|
| 01 | Factura de operación interna | No aplica |
| 04 | Nota de crédito referente a una o varias FE | **Obligatoria**, por CUFE (B606). Sin ella: `1705` |
| 05 | Nota de débito referente a una o varias FE | **Obligatoria**, por CUFE (B606). Sin ella: `1705` |
| 06 | Nota de crédito genérica | Opcional, solo papel (B616) o impresora fiscal (B621). Con CUFE: `1706` |
| 07 | Nota de débito genérica | Igual que la 06 |
| 09 | Reembolso | No aplica |

Campos del grupo B60 cuando va: RUC, tipo y DV del emisor del documento referenciado (B601, deben ser los
nuestros: `1719`), nombre (B602), fecha de emisión (B603: no posterior a la del documento nuevo, `1702`; no más
de seis años antes, `1701`; igual a la de la FE referenciada, `1720`) y una sola de B605 (CUFE), B615 (papel) o
B620 (impresora fiscal). Monto: `1711`, una 04/05 no puede superar el monto del CUFE referenciado.

## Tabla

| Documento | Tipo DGI que corresponde | Qué manda hoy | Estado | Autorizado en sandbox | Qué falta |
|---|---|---|---|---|---|
| Factura de honorarios | 01 | 01 | Construido y activo | Sí (24/09) | Nada |
| Factura de reembolso | 09 | 09 | Construido y activo | Sí (17/09) | El CPBS `8012` sigue sin confirmar |
| NC de venta con factura (con CUFE) | 04 | 04 + CUFE | Construido y activo | Sí (24/09) | Nada |
| NC sobre factura en papel / sin CUFE (caso C) | 06 con B616 | Nada (409) | Sin camino | No: el bloque de papel rompe el PAC (`[0000]`, 24/09) | Pregunta a ideati en espera |
| NC de venta **sin factura** | **06 sin referencia** | Nada (409 antes del correlativo) | Interna desde el 03/10 (P-4a); el envío no está construido | **Sí, hoy (06 sin referencia)** | Mandarla como 06 sin `gDFRef` y sacar el 409; desde entonces resta ITBMS como la 04 |
| ND con factura | **05 con CUFE** | 05 **sin** referencia | A medias, apagado (`PERMITIR_ND_A_LA_DGI = false`) | **Sí, hoy (05 con CUFE)**; sin referencia: `1705` | Pasar al mapper la referencia de `referenced_invoice_id` (hoy no se lee). Si esa factura no tiene CUFE: 409, como la NC |
| ND sin factura | **07 sin referencia** | 05 (rechazaría con `1705`) | A medias, apagado | **Sí, hoy (07 sin referencia)** | `tipoDocumentoDeKind` tiene que elegir 07 cuando la ND no ajusta una factura |
| Anulación de factura / de NC | Evento `CreateCancellation` | Sí | Construido y activo | Sí (23/09 y 24/09) | Nada |

## Para activar el envío (después de este inventario)

1. El tipo lo decide el documento y su referencia: NC con factura → 04, NC sin factura → 06, ND con
   factura → 05, ND sin factura → 07. Una sola función, como `tipoDocumentoDeKind`, con test.
2. 06 y 07 nunca llevan CUFE (`1706`); 04 y 05 siempre (`1705`). Lo mismo, congelado en un golden.
3. La ND con factura arma la referencia con `construirReferenciaFiscal()`, la misma que la NC.
4. `PERMITIR_ND_A_LA_DGI` pasa a `true` y la NC sin factura pierde su 409, en el mismo cambio.
