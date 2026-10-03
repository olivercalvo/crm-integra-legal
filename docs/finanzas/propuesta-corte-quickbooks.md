# Propuesta: «contabilizado fuera» para los documentos anteriores al corte con QuickBooks

> 03/10/2026 · **Solo diseño, nada construido.** Fecha de corte propuesta: **01/07/2026**, sin confirmar.

## 1. El problema

Desde marzo de 2026 el CRM tiene facturas, cobros, gastos de trámite y cobros del caso. La contabilidad
de ese período la llevó QuickBooks. Si el libro del CRM arranca en una fecha de corte con un **saldo de
apertura**, todo documento anterior al corte ya está contado ahí (dentro del saldo de 100004, 200001,
130003 y bancos). Postearlo además en el libro del CRM lo contaría dos veces.

Pero esos documentos **no pueden desaparecer**:
- una factura de mayo que sigue pendiente se cobra en octubre, y ese cobro tiene que aplicarse a ella;
- la antigüedad tiene que mostrarla en su tramo real;
- el cliente reconoce su número.

## 2. La regla en una línea

**Un documento con fecha anterior al corte queda marcado `contabilizado_fuera`: vive como documento
(saldo, cobros, antigüedad, PDF), pero nunca genera un asiento.** Lo posterior al corte se contabiliza
normal, incluidos los cobros sobre facturas anteriores al corte.

## 3. Qué cambia en la base

### 3.1 La fecha de corte

| Tabla | Campo nuevo | Notas |
|---|---|---|
| `finanzas_parametros` (078) | `fecha_corte_libro date NULL` | Una por bufete. NULL = sin corte (todo se contabiliza, como hoy). Escriben admin y contador, como la tasa de ISR. **Se fija una vez**: cambiarla con documentos ya marcados está prohibido por trigger (ver 3.3). |

### 3.2 La marca en cada documento

| Tabla | Campo nuevo | Fecha que se compara con el corte |
|---|---|---|
| `invoices` | `contabilizado_fuera boolean NOT NULL DEFAULT false` | `accounting_date` (068); sin la 068, `issue_date` |
| `credit_notes` | igual | `accounting_date` |
| `payments` (cobros de Finanzas) | igual | `payment_date` |
| `expenses` (gastos de trámite) | igual | `accounting_date`; sin la 068, `date` |
| `supplier_payments` (pagos del gasto de trámite y de compras) | igual | `payment_date` |
| `business_expenses` (compras) | igual | `accounting_date` |
| `client_payments` (cobros del caso, Legal) | igual, **solo informativa** | `payment_date`. Hoy no postea nunca (`asiento-tesoreria.ts`): la marca solo sirve para el cuadre de §5 |

**Por qué un campo guardado y no una cuenta al vuelo (`fecha < corte`):** la decisión es inmutable como el
libro. Si alguien cambiara el corte, una cuenta al vuelo reclasificaría en silencio documentos que ya
tienen o no tienen asiento. Guardado, el documento dice para siempre qué se decidió.

### 3.3 Reglas que pone la base

1. **Al insertar o cambiar la fecha** (trigger `BEFORE INSERT OR UPDATE`): si la fecha del documento es
   anterior a `fecha_corte_libro`, `contabilizado_fuera = true`. No lo elige la pantalla.
2. **Nunca un documento marcado con asiento**: `post_journal_entry` rechaza un posteo cuyo
   `source_type`/`source_id` apunte a un documento `contabilizado_fuera`. Es el mismo lugar donde hoy se
   exige el tercero: el motor, no la app.
3. **Nunca se marca un documento que ya tiene asiento** (el libro es inmutable y ese asiento no se
   borra): la migración y el trigger lo rechazan y lo listan.
4. **La marca no se quita** (`true → false` rechazado), salvo con una llave como
   `finanzas.amount_paid_override` (SOP-017), para una corrección autorizada.
5. **`fecha_corte_libro` no cambia** si hay algún documento marcado.

## 4. La migración (`084_contabilizado_fuera`, cuando se decida)

1. `ALTER TABLE finanzas_parametros ADD COLUMN fecha_corte_libro date`.
2. `ADD COLUMN contabilizado_fuera` en las siete tablas.
3. **Pre-flight que aborta** si hay documentos anteriores al corte **con** asiento:
   - En producción no debería haber ninguno: el libro de producción está vacío (plan del Bloque 1, §3).
   - En staging sí hay (los asientos de septiembre son de prueba). Para staging, la salida es regenerar los
     datos (SOP-012), no tocar el libro.
4. Backfill: `contabilizado_fuera = true` donde la fecha es anterior al corte. **No toca el libro.**
5. Triggers de 3.3 y el parche de `post_journal_entry`, verificado sobre la definición vigente.
6. La fecha de corte se carga **en la misma ventana**, después de la apertura, por la pantalla de
   Parámetros, no en la migración: es un dato del bufete.

**Orden en la ventana:** 068 (fechas de registro) → … → la apertura (E7) → 084 → cargar la fecha de corte.

## 5. El cuadre que tiene que dar

La regla de oro: **por cada cliente, el saldo de apertura de 100004 al corte = la suma de los saldos, a esa
fecha, de sus facturas `contabilizado_fuera`** (menos sus NC y más sus ND anteriores al corte). Igual para
200001 por proveedor con compras y gastos de trámite, y para 130003 con los gastos de trámite por cobrar.

- **Después del corte se mantiene solo.** Un cobro de octubre sobre una factura de mayo postea
  `DEBE banco / HABER 100004 (cliente)`: baja el saldo del Mayor y baja el saldo de la factura en la misma
  cantidad.
- **Se verifica con un reporte nuevo, «Cuadre de apertura»** (solo lectura, admin y contador). Por
  tercero muestra:
  - el saldo de apertura en el libro;
  - la suma de los documentos marcados a la fecha de corte;
  - la diferencia.

  Si la diferencia no es cero, la apertura está mal cargada o falta un documento. Hay que verlo **antes**
  de cerrar el primer mes.
- **Una factura de QuickBooks que no está en el CRM** (anterior a marzo) no tiene documento que la
  explique. Ahí entra lo recomendado para la apertura (§7 del plan): una factura interna de saldo inicial.
  Con este corte, **las facturas del CRM anteriores al corte ya son ese detalle**: solo hace falta crear
  las de QuickBooks que el CRM nunca tuvo.

## 6. Impacto en pantallas y reportes

| Lugar | Hoy | Con el corte |
|---|---|---|
| Emitir una factura o NC con fecha anterior al corte | Postea | No debería pasar: los meses anteriores al corte quedan cerrados. Si pasa, el motor la rechaza (3.3) |
| Cobro **posterior** al corte sobre factura anterior | Postea | Igual, postea. Es lo que mantiene el cuadre |
| Cobro **anterior** al corte | Sin asiento si es viejo | Marcado, sin asiento. 🔴 **No se elimina**: cambiaría el saldo de la factura y rompería el cuadre de §5. Se bloquea igual que hoy se bloquea un cobro con asiento |
| Anular una factura anterior al corte | Reversa su asiento | No tiene asiento ni mes abierto: **solo nota de crédito**, con fecha de registro posterior al corte (asiento propio). Es la regla del 09/09 |
| Gasto de trámite anterior al corte | El botón «Registrar en el libro contable» lo postea (es la puerta de los 128 de producción) | 🔴 **El botón desaparece** para los marcados y la ruta responde 409: postearlo duplicaría QuickBooks |
| Antigüedad por cobrar | Lee documentos con saldo | Igual: los marcados con saldo siguen saliendo. Etiqueta «Antes del corte» en la fila |
| Antigüedad por pagar | Lee solo los gastos de trámite **en el libro** (`posted_entry_id`, `antiguedad-source.ts:453`) | 🔴 **Hay que cambiarlo**: también los marcados, si no un gasto de trámite de mayo pendiente desaparece de la antigüedad |
| «Diferencia contra el Mayor» de la antigüedad | Explica con asientos manuales | Desde el corte, lo marcado se explica con la apertura (§5). Lo que no cuadre lo dice el reporte nuevo |
| Mayor, Diario, Estado de Resultado, Balance | Solo el libro | Sin cambios: lo anterior al corte no está en el libro y no debe estar |
| Resumen de ITBMS (`vat-calculo.ts`) | Lee **documentos** por fecha de registro | 🔴 **Excluir los marcados**: esos meses se declararon desde QuickBooks. Sin esto, julio, agosto o septiembre podrían sumar ITBMS de facturas viejas si su fecha cae ahí |
| Ventas mensuales y PDF | Documentos | Sin cambios: son documentos reales. En el listado, un badge «Contabilizado fuera» |
| Facturación electrónica | Independiente del libro | Sin cambios: lo fiscal y lo contable son dos preguntas distintas (SOP-038) |

## 7. Dudas

1. 🔴 **La fecha choca con la respuesta P-9a del 02/10.** Josuarth dijo:
   - corte al **31/12/2025**;
   - él registra 2026 desde enero;
   - no se cargan ingresos ni gastos acumulados.

   Con corte al **01/07/2026** la apertura llevaría el resultado de enero a junio (ingresos y gastos
   acumulados) o se iría a patrimonio, y enero a junio quedarían en QuickBooks. **Hay que elegir una de las
   dos** antes de construir. Con corte al 31/12/2025, el CRM no tiene documentos anteriores y esta propuesta
   casi no hace falta (solo las facturas de QuickBooks pendientes al 31/12, por saldo inicial).
2. ¿Josuarth carga en QuickBooks **todo** hasta el corte, cobros incluidos? Si un cobro anterior al corte
   está en el CRM y no en QuickBooks (o al revés), el cuadre de §5 no da y hay que saber cuál manda.
3. **Cobros del caso (Legal):** hoy no postean y no deben. ¿Josuarth los usa para el fondo de trámites
   (130003) o para anticipos (200004)? Si sí, el corte no los resuelve: es otra decisión, anterior a esta.
4. **NC y ND anteriores al corte:** se marcan igual. ¿Josuarth las tiene en QuickBooks con los mismos
   montos?
5. ¿Qué fecha manda para un documento con fecha de documento antes del corte y fecha de registro después?
   La propuesta usa la de **registro** (la contable). Con la 068 todavía sin producción, la de registro de
   lo existente es igual a la del documento.
6. El resultado de la consulta `sql/verificacion/produccion-facturas-dgi-por-mes.sql` dice cuántos
   documentos de producción quedarían marcados por mes: conviene tenerlo antes de decidir el corte.
