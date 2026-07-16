# Reconciliación Legal ↔ Finanzas — fuente de verdad única para el ledger

**Fecha:** 14/07/2026 · **Estado:** propuesta de diseño (pendiente revisión de Oliver + contador)
**Motivo:** antes de construir el ledger de partida doble (DE 34/1998), unificar los dos registros de dinero para que no se dupliquen ingresos/egresos.

---

## 1. El problema (hallazgo de la auditoría)

El CRM lleva dinero en **dos silos paralelos sin conexión a nivel de evento económico**:

- **Legal (por caso):** `expenses` (gastos/adelantos del caso) y `client_payments` (pagos que entrega el cliente). Balance del caso calculado al vuelo, no persistido.
- **Finanzas (formal):** `invoices`, `invoice_lines`, `payments` + `payment_applications`, `credit_notes`, `business_expenses`, con plan de cuentas (`chart_of_accounts`), ITBMS y eFactura.

No hay ninguna FK que ligue un gasto de caso con la línea de factura que lo cobra, ni un pago del cliente (legal) con un pago de finanzas. Solo comparten las dimensiones `case_id` y `client_id`. La separación fue intencional en la cabeza del equipo, pero **nunca se implementó como integración**.

**Consecuencia:** el mismo hecho económico se teclea en dos lados sin reconciliar → un ledger que ingiera ambas fuentes contaría doble.

Decisión tomada (Oliver, 14/07): **ambos registros se usan y deben cuadrar** → hay que conectarlos, no descartar uno.

---

## 2. Principio rector

**Un solo registro autoritativo por evento económico; donde un segundo módulo necesite reflejarlo, se usa un LINK, no una copia.** Así la vista de la abogada (por caso) y la del contador (finanzas) leen de datos vinculados y cuadran por construcción.

---

## 3. Inventario de eventos económicos y su doble representación actual

| Evento | Legal (hoy) | Finanzas (hoy) | Riesgo |
|---|---|---|---|
| Gasto reembolsable de caso | `expenses` (origen) | `invoice_lines` kind=REEMBOLSO (cobro) | Doble conteo: mismo desembolso en 2 tablas sin link |
| Pago del cliente | `client_payments` (por caso) | `payments` + `payment_applications` (aplicado a factura) | Mismo dinero, 2 tablas, sin vínculo |
| Honorarios | (reflejado en `client_payments`, sin distinguir) | `invoices` kind=HONORARIOS (verdad) | Ingreso potencialmente contado en legal y finanzas |
| Gasto operativo del bufete | — | `business_expenses` (único) | Sin duplicación (ya es única) |

---

## 4. Modelo objetivo por evento

### 4.1 Gasto reembolsable de caso
- **Fuente de verdad del desembolso:** `expenses` (legal). La abogada lo registra cuando ocurre — está más cerca del hecho.
- **Link al cobro:** `invoice_lines` (REEMBOLSO) gana `source_expense_id` (FK nullable → `expenses.id`). Cuando el contador factura el reembolso, la línea apunta al/los gasto(s) que cobra.
- **Estado derivado en el gasto:** un `expense` está "facturado" si existe una `invoice_line` que lo referencia. Opcional: `expenses.billable boolean` para distinguir reembolsables de gastos internos del caso.
- **Resultado:** la vista del caso muestra el gasto + si ya se facturó; finanzas muestra la factura; el ledger postea el desembolso una vez y el cobro lo referencia. Sin doble conteo.

### 4.2 Pago del cliente (el cambio de fondo)
- **Unificar en `payments` de finanzas.** Agregar `case_id` (nullable) a `payments`. La acción "Registrar pago del cliente" del legal pasa a **crear un `payment` de finanzas** (etiquetado con `case_id` + `client_id`), no una fila en `client_payments`.
- **Balance del caso** lee los `payments` de finanzas filtrados por `case_id`.
- **Migrar** los `client_payments` existentes → `payments` (con `case_id`), y **deprecar** `client_payments`.
- **Adelantos:** un pago que aún no se aplica a una factura queda como `amount_unapplied` (anticipo del cliente) — esto mapea al concepto de fondos en custodia (cuenta 2201, ver decisiones del contador).
- **Alternativa más liviana** (si el refactor es muy grande de golpe): mantener `client_payments` pero agregarle `payment_id` (FK → `payments`) y exigir que cada pago de cliente tenga su `payment` de finanzas. Mantiene dos tablas pero elimina la desconexión. Menos limpio; recomendado solo como paso transitorio.

### 4.3 Honorarios
- **Fuente de verdad:** `invoices` kind=HONORARIOS. El legal **no** registra honorarios por separado.
- La vista del caso **muestra** los honorarios desde las facturas de finanzas por `case_id` (reflejo de solo lectura), y los pagos de honorario son `payments` de finanzas aplicados a esas facturas.

### 4.4 Gasto operativo del bufete
- `business_expenses` — ya es única, con `chart_account_code` y crédito fiscal. Sin cambios. El ledger postea directo de acá.

---

## 5. Cambios de schema propuestos (estructura, no tratamiento contable)

1. `invoice_lines` += `source_expense_id uuid NULL` FK → `expenses(id)` — liga la línea de reembolso al gasto de caso.
2. `expenses` += `billable boolean NOT NULL DEFAULT true` (distinguir reembolsable de interno). El estado "facturado" es derivado (existe invoice_line que lo referencia).
3. `payments` += `case_id uuid NULL` FK → `cases(id)` — atribuir el pago a un caso.
4. Migración: `client_payments` → `payments` (mapear amount, fecha, case_id, tipo). Deprecar `client_payments` tras verificar.
5. El balance del caso pasa a ser una vista/consulta reconciliada sobre finanzas (`payments` por caso) + `expenses` por caso.

> Todos aditivos y guardados; el paso 4 (deprecar `client_payments`) se hace en lock-step: agregar `case_id` a payments → backfill/migrar → apuntar el código legal a payments → verificar → recién entonces deprecar la tabla vieja (lección de sprints anteriores: nunca dropear antes de migrar y verificar).

---

## 6. Cómo queda el "cuadre" (abogada ↔ contador)

- La **abogada** ve, en el caso: honorarios facturados (de `invoices`), gastos reembolsables (de `expenses`, con estado facturado), pagos del cliente (de `payments` por caso), y el balance neto — todo derivado de las fuentes únicas.
- El **contador** ve, en finanzas: las mismas facturas, pagos y gastos, con su tratamiento contable.
- Como leen de las **mismas tablas vinculadas**, cuadran por construcción. Se elimina la posibilidad de que un pago exista en un lado y no en el otro.

---

## 7. Migración de datos existentes

- **`client_payments` → `payments`:** crear un `payment` por cada `client_payment` con su `case_id`. Los que correspondan a facturas existentes, aplicarlos (payment_application); los que sean anticipos, dejar `unapplied`. Preview antes de escribir.
- **`expenses` ↔ `invoice_lines` REEMBOLSO:** intentar match por (caso, monto, fecha) para poblar `source_expense_id` en líneas ya emitidas. Best-effort + revisión manual de las licenciadas/contador (no automatizable con certeza).
- BD única de producción, sin staging → preview de cada backfill y limpieza de data de prueba.

---

## 8. Decisiones que requieren al contador (tratamiento contable)

Estas definen los débitos/créditos de los asientos del futuro ledger:

1. **Reembolsos:** ¿el cobro de un reembolso cruza el pasivo (2201, como sugiere `services_catalog`) o genera ingreso? ¿El desembolso va a cuenta por cobrar reembolsos (1202) contra banco?
2. **Fondos en custodia / trust:** el par 1103 (banco trust) / 2201 (obligación al cliente) — ¿cómo se postean los anticipos del cliente?
3. **Honorarios:** reconocimiento devengado (a la emisión) vs caja (al cobro).
4. **ITBMS en reembolsos:** hoy EXENTO — confirmar.
5. **Adelantos del cliente:** ¿pasivo (anticipo) hasta aplicarse a factura?

---

## 9. Cómo esto habilita el ledger

Una vez unificadas las fuentes, el ledger postea desde registros únicos y vinculados:
- Factura emitida → asiento (CxC / ingreso o pasivo reembolso / ITBMS por pagar).
- Pago (finanzas, con case_id) → asiento (banco / CxC).
- Gasto de caso (`expenses`) → asiento (CxC reembolsos o gasto / banco).
- Gasto del bufete (`business_expenses`) → asiento (gasto / banco o CxP).

Sin doble conteo, porque cada evento tiene una sola fuente y los links evitan que se postee dos veces.

---

## 10. Riesgos y consideraciones

- El cambio de `client_payments` → `payments` **toca el flujo que las abogadas usan a diario** (registrar pago del cliente). Requiere migración cuidadosa + verificación + no romper la UI del caso. Es el ítem más sensible.
- La reconciliación de datos históricos (gastos ↔ líneas de reembolso, pagos legacy) no es 100% automatizable — necesita criterio de las licenciadas/contador.
- Este diseño es **estructural**; el tratamiento contable (sección 8) lo cierra el contador antes de codificar los asientos.

---

## Próximos pasos sugeridos

1. Oliver revisa este diseño estructural.
2. Llevar la sección 8 al contador (tratamiento contable) junto con las preguntas ya pendientes (ruta Diario/Mayor, resolución de aval).
3. Con ambas respuestas, implementar la reconciliación (schema + migración + código) en lock-step.
4. Recién entonces, retomar el ledger sobre la base ya unificada.
