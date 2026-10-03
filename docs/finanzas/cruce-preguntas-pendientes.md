# Cruce de preguntas pendientes (antes de los mensajes del lunes)

> 03/10/2026 · Solo lectura: nada construido, nada consultado en producción.
> Fuentes revisadas: `docs/finanzas/plan-bloque1.md` (§7 y §8), `CLAUDE.md`, `task_plan.md`, `changelog.md`,
> `docs/efactura/` (incluido el borrador a ideati), `docs/revision-josuarth/` (agenda, notas y los dos Excel),
> `docs/finanzas/propuesta-corte-quickbooks.md`, `docs/efactura/propuesta-alerta-no-enviadas.md`,
> `docs/finanzas/propuesta-bitacora-auditoria.md` y `docs/finanzas/roadmap-contable.md`.
> Una consulta de solo lectura en **staging** (plan de cuentas). Las de **producción** quedan escritas para que
> las corra Oliver en el SQL Editor.

## Resumen

| # | Para | Pregunta | Estado | Qué hacer el lunes |
|---|---|---|---|---|
| I-1 | ideati | NC sobre factura en papel o del facturador de la DGI | **Ya respondida en lo que importa** + en espera por decisión de Oliver | **No mandarla.** Antes, preguntar a las licenciadas si existe alguna factura en papel (L-4) |
| I-2 | ideati | ¿CPBS 8012 correcto para reembolsos tipo 09? | **Ya respondida** por ideati (el 09 no restringe CPBS); lo que queda es contable | **No mandarla a ideati.** Pasa a Josuarth (J-10) |
| I-3 | ideati | ¿459, 460, 461 y 463 en producción o en pruebas de la DGI? | **Ya respondida** en `task_plan.md` y **se puede confirmar con datos** | **No mandarla.** Oliver corre la consulta I-3; sólo 463 es real |
| L-1 | Licenciadas | ¿489, 496, 503 y 508 se hicieron en el facturador de la DGI? | **Se puede saber en parte con datos**; **hay que preguntar** el resto, reformulada | Oliver corre la consulta; después se pregunta con fecha y monto en la mano |
| L-2 | Licenciadas | ¿Antes de julio todo se facturaba fuera y el CRM era interno? | **Ya respondida** (Oliver, 23/09; roadmap) con una duda real que queda | Preguntar sólo la parte que falta, reformulada |
| L-3 | Licenciadas | ¿Gastos de trámite y cobros del caso de marzo a junio se llevaban en otro lado? | **Se puede saber con datos** lo del CRM; lo de afuera es de **Josuarth**, no de ellas | Consulta L-3; la pregunta va a Josuarth (J-2) |
| J-1 | Josuarth | Fecha de corte 01/07/2026 | **Respondida en parte**: acta del 09/09 y roadmap; Oliver la confirmó el 03/10. Falta Josuarth por escrito | Pedir confirmación en una línea |
| J-2 | Josuarth | Carga de enero a junio: ¿resumen mensual o detalle? | **Hay que preguntar** | Preguntar con las dos opciones y lo que exige la importación |
| J-3 | Josuarth | Qué hacer con las facturas de prueba | **Mal planteada**: tres son del sandbox; sólo FAC-HON-000463 es real | Preguntar sólo por la 463 |
| J-4 | Josuarth | Reemitir facturas de meses anteriores (fecha ante la DGI) | **Hay que preguntar**, pero **después** de una prueba en sandbox | Correr la prueba del `1519` primero |
| J-5 | Josuarth | Código de la cuenta puente de apertura | **Hay que preguntar** (staging no tiene ninguna candidata) | Preguntar |
| J-6 | Josuarth | Saldos de proveedores al 31/12/2025 | **Se puede saber en parte con datos**; **hay que preguntar** el detalle | Consulta J-6 y preguntar con el número |
| J-7 | Josuarth | Clasificación NIIF de la 440001 | **Hay que preguntar**, reformulada | Preguntar qué entra ahí |
| J-8 | Josuarth | Excel de subcategorías | **Hay que preguntar** (recordatorio): ninguno de los dos Excel volvió contestado | Reenviar los dos, con las cuentas nuevas agregadas |
| J-9 | Josuarth | Bitácora: ¿lecturas sensibles? ¿cuánto tiempo? | **Hay que preguntar** (abiertas en la propuesta) | Preguntar con la propuesta por defecto |

**Conteo (15 preguntas):** ya respondidas 4 (I-1, I-2, I-3, L-2); se pueden saber con datos 1 (L-3), y otras
2 en parte (L-1, J-6); hay que preguntar 10 (L-1, J-1 a J-9; J-3 reformulada a una sola factura). Las tres
preguntas a ideati salen del mensaje del lunes. Se agregan dos que faltaban: L-4 (facturas en papel) y J-10
(CPBS de reembolsos, que sale de I-2).

---

## 1. ideati

### I-1. NC sobre una factura en papel o hecha en el facturador de la DGI

**Ya respondida en lo que importa, y en espera por decisión de Oliver.**

- **Factura con CUFE** (portal, QuickBooks o el facturador de la DGI): se acredita con una **NC 04 con su
  CUFE**. Lo midió el sandbox el 24/09: una NC desde un punto referencia sin problema una factura de otro punto
  (S8, `task_plan.md:927`). El CUFE es de la DGI, no del sistema que emitió: no importa por dónde salió.
  Ese camino ya existe en el CRM (caso B: cargar el CUFE a mano, `POST …/invoices/[id]/cufe`).
- **Factura en papel** (sin CUFE): el PAC explota con `[0000] Object reference…` al referenciar
  `informacionReferenciaFacturaPapel`, igual con 04 que con 06 (`task_plan.md:941-956`, `CLAUDE.md`, «Nota de
  crédito FISCAL»). Eso sí está sin resolver.
- 🔴 **Oliver decidió no preguntarlo todavía** (24/09, reconfirmado el 25/09, `task_plan.md:1122-1136`):
  primero el bufete confirma **si existe alguna factura en papel** que haya que acreditar. Si no hay ninguna, la
  pregunta se cierra sin mandarse.

**Hallazgo:** el borrador `docs/efactura/borrador-mensaje-ideati-2026-10-03.md` incluye esta pregunta como la
número 1. Choca con esa decisión. Recomendación: sacarla del mensaje del lunes y preguntar antes a las
licenciadas (L-4, abajo). Si contestan que sí hay facturas en papel, se manda con el número en la mano.

### I-2. ¿El CPBS 8012 es el correcto para reembolsos tipo 09?

**Ya respondida por ideati; lo que queda es contable.**

- ideati ya dijo que **el tipo 09 no restringe el CPBS** y el sandbox autorizó con 8012 (`task_plan.md:2240-2244`,
  `changelog.md:1894`). La pregunta de si es el código correcto quedó anotada como **pregunta contable para
  Josuarth**, no para ideati.
- `task_plan.md:4462` registra que 8012 es el código de **servicios legales** (confirmado para honorarios). El
  catálogo CPBS de la DGI sigue la clasificación UNSPSC, donde 8012 es la familia de servicios legales; vale la
  pena verlo en el catálogo publicado antes de preguntar, porque es un dato, no una opinión.

**Reformulación (para Josuarth, J-10):** «En las facturas de reembolso usamos el mismo código de producto
(CPBS 8012, servicios legales) que en honorarios. ¿Te parece bien, o el reembolso de un gasto debería ir con
otro código?»

### I-3. ¿FAC-HON-000459, 000460, 000461 y 000463 se autorizaron en producción de la DGI o en pruebas?

**Ya respondida en el repositorio, y se puede confirmar con datos.**

- **459, 460 y 461 fueron del sandbox** (`i_amb=2`, punto `001`, correlativos 1, 2 y 3, 3 y 4 de junio):
  `task_plan.md:4380-4398` («Acumulado de pruebas autorizadas: 459 (nro 1) + 460 (nro 2) + 461 (nro 3), todos
  punto 001, i_amb=2»). Están en la base de producción porque **hasta el 25/08 `localhost` escribía en la base
  real** (Fase 0, `CLAUDE.md` §9). Para la DGI no existen.
- **463 es REAL**: fue la **primera emisión en producción** (go-live del 08/07, punto `051`), una factura de
  B/. 1.07 de Integra a Integra. `task_plan.md:3644`: «FAC-HON-000463 (prueba Integra-a-Integra $1.07): dejar
  como está o anular por el portal del PAC». La primera factura a un cliente real fue FAC-HON-000464.
- La ventana de 182 h para anular la 463 venció a mediados de julio: ya no se anula, sólo se acredita con NC.

**Consulta de confirmación (producción, la corre Oliver, solo SELECT):**

```sql
-- Producción (uqmmkklbhzxqybljiecs) · SOLO SELECT. fe_emisiones.i_amb: 1 = producción DGI, 2 = pruebas.
SELECT i.invoice_number, i.issue_date, i.grand_total, i.fe_estado,
       i.punto_facturacion, i.numero_documento,
       left(i.dgi_cufe, 24)            AS cufe_inicio,
       i.dgi_fecha_autorizacion,
       left(i.qr_content, 60)          AS qr_inicio,
       e.intento, e.i_amb, e.autorizada, e.created_at
  FROM public.invoices i
  LEFT JOIN public.fe_emisiones e ON e.invoice_id = i.id
 WHERE i.invoice_number IN ('FAC-HON-000459','FAC-HON-000460','FAC-HON-000461','FAC-HON-000463')
 ORDER BY i.invoice_number, e.intento;
```

Esperado: 459 a 461 con `i_amb = 2` y punto `001`; 463 con `i_amb = 1` y punto `051`. Si es así, la pregunta
3 del borrador a ideati sobra.

**Hallazgo:** la §9.5 de `propuesta-corte-quickbooks.md` y la pregunta 3 del borrador a ideati suponen que las
cuatro podrían ser reales. Con esto, sólo la 463 tiene efecto fiscal (B/. 0.07 de ITBMS). Las otras tres
siguen siendo basura en la base de producción (aparecen como «autorizadas»), y eso lo resuelve la marca de
cliente de prueba, no la DGI.

---

## 2. Licenciadas

### L-1. ¿FAC-HON-000489, 000496, 000503 y 000508 se hicieron en el facturador de la DGI?

**Se puede saber en parte con datos; hay que preguntar el resto, y está mal planteada.**

- Lo que se sabe (`docs/efactura/propuesta-alerta-no-enviadas.md`): las cuatro están `emitida` en producción
  y nunca se autorizaron (`fe_estado` `no_emitida` o `error`). Por el número son posteriores a la 464
  (09/07), o sea que se hicieron **después** de que el CRM ya emitía ante la DGI.
- Falta saber fecha, monto, quién la hizo y si alguien intentó mandarla. Eso lo dice
  `sql/verificacion/produccion-facturas-no-enviadas-detalle.sql` (producción, la corre Oliver; está escrita y
  sin correr según `task_plan.md:75`).
- Lo que **no** dicen los datos: si el cliente recibió una factura fiscal por otro medio.

**Por qué está mal planteada:** el canal que el bufete usó antes del CRM no es el facturador de la DGI sino
el **punto `050`** (QuickBooks o el portal de ideati, ver L-2). Preguntar sólo por el facturador de la DGI puede
dar un «no» que no descarta nada.

**Reformulación:** «Estas cuatro facturas están en el CRM pero nunca llegaron a la DGI desde el CRM:
[número, fecha, cliente, monto]. ¿Alguna se la entregaron al cliente emitida por otro medio (QuickBooks, el
portal de ideati o el facturador de la DGI)? Si es así, ¿nos pasan el CUFE o el PDF?»

### L-2. ¿Antes de julio todo se facturaba fuera y el CRM era solo interno?

**Ya respondida, con una duda que queda.**

- **Oliver, 23/09** (`task_plan.md:1585-1590`, `CLAUDE.md` «Qué se puede hacer ante la DGI»): «las facturas
  del bufete anteriores al 8 de julio de 2026 se emitieron a mano en el portal de ideati, por el punto de
  facturación 050, así que tienen CUFE ante la DGI; el CRM nunca lo guardó».
- `docs/finanzas/roadmap-contable.md:17` (correo de Josuarth del 31/07): «QuickBooks se cerró en julio; el
  resto de julio se pone al día en el CRM».
- El go-live del CRM ante la DGI fue el 08/07 (FAC-HON-000463) y el primer cliente real el 09/07 (464).

**La duda que queda** (y que sí importa para el corte y para cargar CUFE del caso B):
- `task_plan.md:3662` dice que el punto `050` **es el de QuickBooks**; la corrección del 23/09 dice **portal de
  ideati**. Puede ser lo mismo (QuickBooks emitiendo por ideati) o no.
- No se sabe si **toda** factura de marzo a junio existe en los dos lados (CRM y punto 050) con el mismo
  número, o si hubo facturas sólo de un lado.

**Se puede saber con datos** cuántas facturas de marzo a junio tiene el CRM y cuántas tienen CUFE cargado:
`sql/verificacion/produccion-facturas-dgi-por-mes.sql` (producción, la corre Oliver). La comparación contra lo
emitido por el punto 050 la puede hacer Josuarth con su Libro Mayor de QuickBooks.

**Reformulación:** «Antes del 8 de julio, ¿las facturas salían de QuickBooks o del portal de ideati? ¿Cada
factura del CRM de esos meses tiene su gemela emitida por ese medio, o hubo facturas que sólo están en uno de
los dos?»

### L-3. ¿Los gastos de trámite y cobros del caso de marzo a junio también se llevaban en otro lado?

**Se puede saber con datos lo del CRM; lo de afuera es una pregunta para Josuarth.**

- Que existen en el CRM desde marzo ya está registrado (`propuesta-corte-quickbooks.md` §2). Cuántos y por
  cuánto por mes lo da `sql/verificacion/produccion-documentos-por-mes.sql` (producción, la corre Oliver;
  separa gastos de trámite y cobros del caso).
- Si **también** están en QuickBooks no lo saben las licenciadas: lo sabe quien llevaba QuickBooks. Y es lo
  que de verdad importa: si están en los dos lados y entran por la importación de enero a junio, se cuentan dos
  veces.
- Los cobros del caso no postean en el CRM y no deben (`asiento-tesoreria.ts`); la duda de cómo los reflejaba
  QuickBooks ya está anotada en `propuesta-corte-quickbooks.md` §8.4.

**Reformulación:** sale de las licenciadas y va a Josuarth dentro de J-2.

### L-4. (nueva) ¿Hay alguna factura en papel?

Es la condición que Oliver puso para destrabar I-1. «¿Tienen alguna factura en papel, o hecha antes de la
facturación electrónica, a la que haya que hacerle una nota de crédito?»

---

## 3. Josuarth

### J-1. Fecha de corte 01/07/2026

**Respondida en parte. Falta su confirmación por escrito.**

- Acta del 09/09 (`docs/revision-josuarth/agenda.md:791`): «al 30 de junio de 2026; el sistema arranca a
  registrar desde julio», «pero no lo tenemos confirmado por escrito».
- `roadmap-contable.md:17`: QuickBooks se cerró en julio.
- **Oliver la confirmó el 03/10** como fecha B (`propuesta-corte-quickbooks.md` §1).
- **Josuarth confirmó otra cosa (P-9a, 02/10, `plan-bloque1.md:556`)**: apertura al **31/12/2025** y «él
  registra 2026 desde enero». No dijo hasta cuándo registra él y desde cuándo el CRM.

**Pregunta:** «Confírmanos por escrito: enero a junio de 2026 los cargas tú desde QuickBooks, y desde el 1 de
julio cada documento del CRM genera su asiento solo.»

### J-2. ¿Cómo carga enero a junio: resumen mensual o detalle?

**Hay que preguntar.** Abierta en `propuesta-corte-quickbooks.md` §8.3. Dos datos que cambian la respuesta y
conviene decirle:
- La importación **exige el tercero** en cada línea de 100004 y 200001 (E3). Un resumen mensual sirve, pero
  esas dos cuentas tienen que venir abiertas por cliente y por proveedor.
- Por factura (con su número en la referencia externa) permite además conciliar documento por documento
  contra lo que ya está en el CRM.
- Agregar acá lo que salió de L-3: si los gastos de trámite (130003) y los cobros de enero a junio también están
  en QuickBooks.

**Pregunta:** «¿Cómo te queda más fácil cargar enero a junio: un asiento por mes con el total de cada cuenta
(abriendo Cuentas por cobrar y Cuentas por pagar por cliente y proveedor), o el detalle factura por factura?
¿Los gastos de trámite y los cobros de esos meses están en QuickBooks?»

### J-3. Qué hacer con las facturas de prueba

**Mal planteada:** de las cuatro, tres nunca existieron ante la DGI (I-3). Lo que queda para él es una sola.

**Reformulación:** «FAC-HON-000463, del 8 de julio, es una factura real ante la DGI de B/. 1.07 (B/. 0.07 de
ITBMS) que Integra se hizo a sí misma para probar. Ya no se puede anular. ¿La dejamos así, o le hacemos una nota
de crédito? ¿Está incluida en el ITBMS de julio?»

Las otras tres (459 a 461) son una limpieza interna: la marca de cliente de prueba de
`propuesta-corte-quickbooks.md` §9 las saca de todo. No hace falta preguntarle.

### J-4. Reemitir facturas de meses anteriores (fecha ante la DGI)

**Hay que preguntar, pero después de una prueba que se puede hacer sin él.**

- Hoy el reintento manda la fecha del envío, no la de la factura (`propuesta-alerta-no-enviadas.md` §d): el
  ITBMS queda en un mes en el CRM y en otro ante la DGI.
- La alternativa (mandar la fecha del documento) depende de si la DGI acepta una fecha de más de 30 días con
  `1519` como aviso o la rechaza. **Eso se prueba en el sandbox** (una factura con fecha de 45 días atrás) y
  todavía no se hizo (`task_plan.md:77`).
- Mientras tanto el CRM ya bloquea el reenvío de un mes anterior con «Consultar con el contador».

**Pregunta (después de la prueba):** «Hay facturas que no llegaron a la DGI en su mes. Si se mandan ahora, ¿qué
prefieres: (a) que salgan con la fecha original (la DGI [acepta con aviso / rechaza]), o (b) anularlas en el CRM y
emitir una nueva con fecha de hoy, para que el ITBMS, el libro y la DGI caigan en el mismo mes?»

### J-5. Código de la cuenta puente de apertura

**Hay que preguntar.** Pendiente desde el 02/10 (`plan-bloque1.md:573`, «el código y nombre de la cuenta
puente»). En staging no hay ninguna cuenta que sirva (consulta de solo lectura del 03/10: en el grupo 3 están
300001 Capital Social, 300002 Perdida Retenidas, 300003 Utilidad del Ejercicio, 300004 Distribución a Socias,
y 3101/3201 inactivas; ninguna dice apertura ni puente).

**Pregunta:** «Para cargar los saldos iniciales necesitamos una cuenta puente que quede en cero al terminar.
¿Qué código y nombre le ponemos?»

### J-6. Saldos de proveedores al 31/12/2025

**Se puede saber en parte con datos; hay que preguntar el detalle.**

- En staging, el saldo inicial cargado desde QuickBooks en 200001 es **3,400.48** (`changelog.md:4729`), pero
  **no se sabe a qué fecha** se generó ese reporte (`task_plan.md:3722`, `:4170-4190`), así que no se puede dar
  por saldo al 31/12/2025.
- La agenda ya le pidió la lista de facturas pendientes de pago a la fecha de corte (decisión 12,
  `agenda.md:852-859`), sin respuesta registrada.

**Consulta (producción, la corre Oliver, solo SELECT; producción tiene la `024` pero no la `027`, así que no
hay fecha):**

```sql
SELECT code, name, saldo_inicial
  FROM public.chart_of_accounts
 WHERE code IN ('100004', '200001')
 ORDER BY code;
```

- En P-9a (02/10) dijo que los saldos iniciales **los manda él**, sacados de la declaración de renta. Lo que
  falta es si hay saldo de proveedores y, si lo hay, su detalle por factura (para la recomendación B de la
  apertura).

**Pregunta:** «Al 31 de diciembre de 2025, ¿cuánto se le debía a proveedores? Si hay saldo, ¿nos pasas la lista
de facturas pendientes (proveedor, número, fecha, vencimiento y saldo)?»

### J-7. Clasificación NIIF de la 440001

**Hay que preguntar, reformulada.**

- Abierta desde el 02/10 (`plan-bloque1.md:557`, P-8c): «falta que Josuarth diga si va a inversión o a
  financiamiento». Hoy está en `ingresos_operativos` (staging, consulta del 03/10).
- Está mal planteada como «¿inversión o financiamiento?»: en NIIF 18 la categoría de operación es la que queda
  cuando un ingreso no es de inversión ni de financiamiento. Un «otro ingreso» puede quedarse en operación.
- Además, ni la 440001, ni la 400009 ni la 400010 están en el Excel NIIF que se le mandó: se crearon después.

**Pregunta:** «La cuenta 440001 Otros ingresos queda para lo que no es del giro. ¿Qué tipo de ingresos van ahí
(intereses, venta de un activo, otra cosa)? Con eso la clasificamos en operación, inversión o financiamiento.»

### J-8. Excel de subcategorías

**Hay que preguntar (recordatorio).** Son dos Excel y **ninguno volvió contestado**:
- `subcategorias-cuentas-balance.xlsx` (P-8a, mandado el 30/09, en
  `03_Documentos/Adjuntos para Josuarth/`): sin respuesta registrada; P-8a sigue abierta (`task_plan.md:194`).
- `docs/revision-josuarth/cuentas-de-resultado-niif.xlsx` (decisión 11): leído el 03/10, la columna «Tu
  clasificación» está vacía en las 45 cuentas.

**Antes de reenviar:** agregar al Excel NIIF las cuentas 400009 Derecho de Familia, 400010 Otros servicios y
440001 Otros ingresos.

**Pregunta:** «Te reenvío los dos Excel (subcategorías de balance y clasificación NIIF de resultados), con tres
cuentas nuevas agregadas. Mientras no vuelvan, el sistema usa el valor por defecto que se ve en cada uno.»

### J-9. Bitácora: ¿registra lecturas sensibles? ¿Cuánto tiempo se guarda?

**Hay que preguntar.** Son las dudas 1 y 2 de `propuesta-bitacora-auditoria.md` («Dudas para Josuarth y
Oliver»). La propuesta por defecto ya existe y conviene mandarla así, para que sólo diga sí o no:
- lecturas sensibles: hoy no se registran (no son cambios de fila); haría falta registrar desde el código quién
  descargó un Excel o un PDF;
- tiempo: **para siempre** (son tablas chicas: menos de 50 MB por año, §b.8).

**Pregunta:** «La bitácora va a guardar cada cambio, para siempre. ¿Necesitas también saber quién descargó un
reporte o un PDF, aunque no haya cambiado nada? ¿Hay algún plazo mínimo de conservación que debamos respetar?»

### J-10. (nueva, sale de I-2) CPBS de reembolsos

Ver I-2.

---

## Mensajes sugeridos

Sólo lo que hay que preguntar. Antes de mandarlos, Oliver corre en producción las consultas I-3, L-1
(`produccion-facturas-no-enviadas-detalle.sql`), L-2 (`produccion-facturas-dgi-por-mes.sql`), L-3
(`produccion-documentos-por-mes.sql`) y J-6, y se corre en sandbox la prueba del `1519` (J-4).

### Para ideati

Nada por ahora. Las tres preguntas del borrador ya tienen respuesta o no les corresponden:
- la de la factura en papel espera a que el bufete diga si existe alguna (L-4);
- la del CPBS ya la contestaron (el 09 no restringe el código) y lo que queda es contable;
- la de las facturas de prueba se responde con nuestros propios datos (`fe_emisiones.i_amb`).

Si L-4 da que sí hay facturas en papel, se manda sólo la pregunta 1 del borrador, con el número de esa factura.

### Para las licenciadas

1. Estas cuatro facturas están en el CRM pero nunca llegaron a la DGI desde el CRM: [FAC-HON-000489, 000496,
   000503 y 000508, con fecha, cliente y monto]. ¿Alguna se la entregaron al cliente emitida por otro medio
   (QuickBooks, el portal de ideati o el facturador de la DGI)? Si es así, ¿nos pasan el CUFE o el PDF?
2. Antes del 8 de julio, ¿las facturas salían de QuickBooks o del portal de ideati? ¿Cada factura del CRM de
   esos meses tiene su gemela emitida por ese medio, o hubo facturas que sólo están en uno de los dos?
3. ¿Tienen alguna factura en papel, o hecha antes de la facturación electrónica, a la que haya que hacerle una
   nota de crédito?

### Para Josuarth

1. **Corte.** Confírmanos por escrito: enero a junio de 2026 los cargas tú desde QuickBooks, y desde el 1 de
   julio cada documento del CRM genera su asiento solo.
2. **Carga de enero a junio.** ¿Te queda más fácil un asiento por mes con el total de cada cuenta (abriendo
   Cuentas por cobrar y Cuentas por pagar por cliente y proveedor), o el detalle factura por factura? ¿Los
   gastos de trámite y los cobros de esos meses están en QuickBooks?
3. **Factura de prueba.** FAC-HON-000463, del 8 de julio, es una factura real ante la DGI de B/. 1.07
   (B/. 0.07 de ITBMS) que Integra se hizo a sí misma para probar. Ya no se puede anular. ¿La dejamos así o le
   hacemos una nota de crédito? ¿Está incluida en el ITBMS de julio?
4. **Facturas que no llegaron a la DGI en su mes.** Si se mandan ahora, ¿prefieres que salgan con su fecha
   original (resultado de la prueba: [la DGI acepta con aviso / rechaza]) o anularlas y emitir una nueva con
   fecha de hoy, para que el ITBMS, el libro y la DGI caigan en el mismo mes?
5. **Cuenta puente.** Para cargar los saldos iniciales necesitamos una cuenta puente que quede en cero al
   terminar. ¿Qué código y nombre le ponemos?
6. **Proveedores.** Al 31 de diciembre de 2025, ¿cuánto se le debía a proveedores? Si hay saldo, ¿nos pasas la
   lista de facturas pendientes (proveedor, número, fecha, vencimiento y saldo)? En lo que cargamos de
   QuickBooks, Cuentas por pagar dice [saldo de la consulta J-6], pero no sabemos de qué fecha es.
7. **Cuenta 440001.** Queda para lo que no es del giro. ¿Qué tipo de ingresos van ahí (intereses, venta de un
   activo, otra cosa)? Con eso la clasificamos.
8. **Excel.** Te reenvío los dos (subcategorías de balance y clasificación NIIF de resultados), con tres cuentas
   nuevas agregadas. Mientras no vuelvan, el sistema usa el valor por defecto de cada uno.
9. **Código de reembolsos.** En las facturas de reembolso usamos el mismo código de producto (CPBS 8012,
   servicios legales) que en honorarios. ¿Te parece bien, o el reembolso de un gasto debería ir con otro código?
10. **Bitácora.** Va a guardar cada cambio, para siempre. ¿Necesitas también saber quién descargó un reporte o
    un PDF, aunque no haya cambiado nada? ¿Hay algún plazo mínimo de conservación que debamos respetar?
