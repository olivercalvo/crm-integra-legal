# Clasificadores de respuesta del PAC — de dónde sale cada código

**Revisado el 2026-09-23**, después de que la prueba 5 encontrara que el
clasificador de anulación llamaba **rechazo** a `0600 — Evento registrado con éxito`.

## Por qué existe este archivo

El bug no fue un código que faltaba en una lista. Fue **copiar la lista de códigos de un
endpoint a otro** y, sobre todo, **tratar lo desconocido como malo**. Este archivo deja
asentado, por endpoint, qué códigos reconocemos y **de dónde salió cada uno** — para que la
próxima vez que alguien agregue uno tenga que decir de dónde lo sacó.

## Cuántos clasificadores hay

**Dos.** No más:

| Módulo | Qué clasifica |
|---|---|
| `orchestration/classify-pac-error.ts` + `parsePacResponse` (en `emit-invoice-to-efactura.ts`) | La respuesta de **emisión** — `POST /api/v1/Invoices` |
| `orchestration/clasificar-respuesta-de-anulacion.ts` | La respuesta de **anulación** — `POST /api/v1/InvoiceEvents/CreateCancellation` |

⚠️ **Los tipos de documento 04 (NC) y 05 (ND) no tienen clasificador propio y no lo van a
necesitar**: se emiten por el MISMO endpoint que el 01 y el 09, así que comparten
`parsePacResponse`. El `tipoDocumento` cambia el payload que se manda, no la forma de la
respuesta. Cuando 9C emita notas de crédito al PAC, hay que **verificar** ese supuesto contra
una respuesta real antes de darlo por bueno — es exactamente el tipo de cosa que produjo el
bug del `0600`.

## Emisión — `POST /api/v1/Invoices`

🔴 **No decide por lista de códigos.** El discriminador es el campo `autorizada`, que el PAC
manda **siempre y explícito**.

| Señal | Significado | De dónde sale | Test |
|---|---|---|---|
| `autorizada: true` + `cufe` | autorizado | **Fixture real** — `FAC-REI-000003`, 23/09/2026 | sí |
| `autorizada: false` | rechazado | **Fixture real** — mismo día, `1601`/`1602` | sí |
| cualquier otra cosa | **incierto** | regla, no código | sí |

Códigos que aparecen dentro de `gResProc`, sólo para el **texto** que se le muestra a la
persona (no para decidir):

| Código | Mensaje | De dónde sale | Test |
|---|---|---|---|
| `0260` | Autorizado el uso de la FE | **Fixture real** (23/09) + Ficha Técnica DGI v1.00 §8 Tabla 7 | sí |
| `1601` | Regla de formación del RUC invalida | **Fixture real** (23/09) | sí |
| `1602` | RUC inexistente en los registros de la DGI | **Fixture real** (23/09) | sí |
| `1002` | Documento duplicado | **Fixture real** (23/09) | sí |
| `0`, `00`, `000`, `0000` | variantes de OK | ⚠️ **SUPOSICIÓN** — ninguna respuesta real los trajo | — |

⚠️ Los cuatro ceros son el único resto de la época de adivinar. **Ya no deciden nada**: desde
que el discriminador es `autorizada`, un `0000` inesperado cae en `incierto` igual. Se dejan
porque sacarlos no cambia el comportamiento y su presencia documenta de dónde venía el
problema.

## Anulación — `POST /api/v1/InvoiceEvents/CreateCancellation`

| Código | Mensaje | Clase | De dónde sale | Test |
|---|---|---|---|---|
| `0600` | Evento registrado con éxito | `anulada` | **Fixture real** — `FAC-REI-000003`, 23/09/2026 | sí |
| `0622` | Ya existe un evento de anulación para esta FE | `ya_anulada` | **Fixture real** — mismo día | sí |
| cualquier otro | — | `indeterminada`, salvo que el **mensaje** diga que algo no se pudo | regla | sí |

🔴 **El swagger no aportó ni un código.** `InvoiceCancellationEventResponse` declara `codigo` y
`mensaje`, los dos `nullable`, **sin `enum`, sin `required` y sin una sola descripción**. Todo
lo que sabemos de este endpoint salió de llamarlo.

## La regla que vale para los dos

> **Un código que no reconocemos NO se declara rechazo.**
> Se declara **incierto**: no se escribe nada que dependa de él, el documento queda
> reintentable, y la pantalla dice *"Estado por confirmar"*.

Un rechazo lo declara el PAC —`autorizada: false` en emisión— o lo dice el **mensaje**
("no se pudo", "rechazado", "inexistente", "venció el plazo"). Palabras, no números: los
números los agrega ideati sin avisar, el castellano de "no se pudo" no cambia.

**Lo que esa regla cuesta y por qué se paga igual:** un rechazo real con un código que no
tengamos catalogado va a decir "Estado por confirmar" en vez de "la DGI rechazó". Es más
vago, pero manda a mirar. El error inverso —decirle a la licenciada que la DGI rechazó un
documento que en realidad autorizó— la manda a corregir una factura que está perfecta, o a
emitirla de nuevo.
