# FINDINGS.MD — CRM INTEGRA LEGAL

## FND-007: El modal heredaba la alineación de la celda que lo abría
**Fecha:** 2026-09-21
**Contexto:** Punto 5 de la verificación del Bloque 2 — reversar un cobro con clic real desde el listado de cobros (deploy `6d0f621`). Era la verificación que había quedado pendiente del bloque de reversión del 17/09 (el modal nunca se había visto abierto).
**Hallazgo:** `ConfirmationModal` no fija su propia alineación de texto. Como se renderiza donde lo monta el botón que lo abre —en los listados, dentro de un `<td class="text-right">`—, toda la advertencia ámbar, el rótulo "Motivo de la reversión" y la descripción del asiento salían alineados a la derecha. En el detalle de la factura pasa exactamente igual (el botón Reversar está en la columna de acciones). La lógica funcionaba (textarea, contador 2/1000 en ámbar, botón apagado hasta 3 caracteres, vista previa con el espejo, POST → asiento 23); lo roto era el render, que es lo único que un fetch no ve.
**Impacto:** Preexistente, visual, en cualquier modal abierto desde una celda alineada a la derecha.
**Decisión:** `text-left` en el panel del modal, junto con el `max-h`/`overflow` de FND-006. Verificado en el deploy siguiente.

---

## FND-011 (CERRADO 22/09/2026): `emitInvoice` deja un asiento con un número que la factura nunca recibe cuando el UPDATE falla por número duplicado
**Fecha:** 2026-09-22
**Contexto:** Verificación en pantalla del commit 4 del Bloque 5. `verificar-nota-de-credito.mts` necesitaba facturas nuevas y las emitió por la API como la abogada. La primera emisión falló con `duplicate key value violates unique constraint "invoices_tenant_number_unique"`, y la antigüedad por cobrar de staging quedó con un residuo de 321,00 que el reporte atribuye a "una tercera causa".
**Hallazgo:**
- **Causa de fondo, arreglada en `523ca6a`:** `seed-staging.ts` pisaba `numbering_sequences` con el máximo SEMBRADO (`invoice_hon = 7`) cada vez que se corría, aunque la base ya tuviera facturas emitidas después del seed (hasta `FAC-HON-000011`). La siguiente emisión tomaba el 8 y chocaba con el UNIQUE. Ahora las secuencias se dejan en el máximo entre lo sembrado y lo que ya tienen; staging se realineó a mano (`invoice_hon = 11`).
- **Lo que quedó al descubierto, y NO está arreglado:** `emitInvoice` toma el número (paso 3), postea el asiento con ese número en la descripción y la referencia (3b) y recién después hace el `UPDATE ... status='emitida', invoice_number` (4). Ese orden es el de SOP-031 y es correcto para una falla TRANSITORIA: el reintento encuentra el asiento (23505 idempotente) y completa la emisión. Pero si el UPDATE falla por **número duplicado**, el reintento toma OTRO número de la secuencia: el asiento dice `FAC-HON-000007` y la factura saldría `FAC-HON-000014`. Y mientras nadie reintenta, el libro tiene **un asiento de 321,00 en 100004 (asiento 43, "Factura FAC-HON-000007 — FERRETERÍA VALLARINO") cuyo `source_id` es un borrador** (`DRAFT-ad8142bceaa8`) — el residuo exacto de la antigüedad por cobrar de staging (36,00 − 507,00 + 150,00 = −321,00).
- `FAC-HON-000007` de verdad es otra factura (de Aurelio Barría, sin asiento). El asiento 43 la nombra sin ser suya.
**Impacto:** Solo puede pasar si la secuencia queda detrás de los números emitidos — en producción no hay seed que la rebobine, así que hoy es un riesgo de staging. Pero el modo de falla es el peor: un asiento inmutable con el número de un documento ajeno. El ledger no se borra; en staging el residuo se va con el próximo reset de la base.
**Decisión:** Aprobado por Oliver el 22/09 y **CERRADO el mismo día** (`c74cb7f`, deploy `dpl_85XLSPWn15VLmcJRVfuUMb6sTPst`): (1) `asegurarNumeroLibre()` antes de postear → 409 sin postear nada; (2) `asientoDeFacturaExistente()` → el reintento toma el número del `reference` del asiento y no vuelve a postear (UNIQUE (tenant, source_type, source_id) de la `034`); sin `reference` o con el número ya tomado por otra factura, 409 en vez de inventar. Test `emit-invoice-numero-del-asiento.test.ts` (5 casos, los cinco fallan sin el arreglo) y `scripts/verificar-fnd-011.mts` contra el deploy (3/3). **El asiento 43 de staging se REVERSÓ** (asiento 48, fecha de hoy, `construirAsientoDeReversion` vía `scripts/reversar-asiento-huerfano.ts`) y la antigüedad por cobrar quedó explicada al centavo, sin "tercera causa". Los otros tres creadores con correlativo (`REC-`, `CE-`, `NC-`) escriben el número en el mismo INSERT y postean después: no tienen este modo de falla.

---

## FND-010: La antigüedad por pagar no lee los gastos de trámite, que SÍ acreditan 200001
**Fecha:** 2026-09-21
**Contexto:** Verificación en pantalla del commit 4 del Bloque 3. La "Antigüedad de Cuentas por Pagar" de staging mostraba una diferencia contra el mayor de 1.464,20 que el propio reporte declaraba no poder explicar ("hay una tercera causa"). Se descompuso contra la base para descartar que fuera del bloque.
**Hallazgo:**
- Un gasto de trámite (`expenses`, módulo Legal) se contabiliza por decisión de RM del 25/08 como `DEBE 130003 / HABER 200001 Cuentas por pagar` (`asiento-gasto-tramite.ts`, origen `gasto_tramite`). Es decir, **crea una cuenta por pagar real** en la misma cuenta control que las compras del bufete.
- `sinAsientoPagar` y `loadAntiguedad("pagar")` (`antiguedad-source.ts`) leen **solo `business_expenses`**. El gasto de trámite no entra al auxiliar, así que la cuenta control lo tiene y el reporte no.
- Y no es solo el reporte: `expenses` **no tiene estado de pago** (`information_schema`: `amount`, `due_date`, `payment_account_code`, y nada de `status`/`amount_paid`), y ningún origen del ledger postea la salida de esa deuda (`SourceType` no tiene un "pago de gasto de trámite"). Un gasto de trámite contabilizado **queda en 200001 para siempre**, aunque el bufete lo haya pagado el mismo día.
- La cuenta cierra al centavo: 1.464,20 = **1.497,85 (el único gasto de trámite con asiento en staging, #4 del 15/03)** − 107,15 (el seed posteó el asiento #3 por 1.497,85 para una compra de 1.605,00; dato de prueba) + 73,50 (los dos saldos heredados de la 048, que el reporte sí nombra).
**Impacto:** Josuarth pidió el 25/08 que la antigüedad cuadre contra el mayor. En producción todavía no hay gastos de trámite contabilizados (`post-to-ledger` es de `develop`), pero el primero que se postee va a producir exactamente este descuadre, y va a crecer con cada uno. No lo detecta ningún test: el residuo se atribuye a "tercera causa" y se sigue.
**Cerrado el 21/09/2026 (Bloque 4, `1fc59ec`):** la antigüedad por pagar lee los gastos de trámite EN EL LIBRO (`gastosTramitePendientes`), `expenses` tiene `amount_paid`/`status` derivados (049) y el pago existe como entidad (arco en `supplier_payments`). En staging la diferencia quedó explicada al centavo (−33.65 = +73.50 heredados − 107.15 del seed). Los gastos sin asiento no entran hasta registrarse: no están en 200001.

**Decisión (original):** Fuera de alcance del Bloque 3 (Oliver, 21/09). **No es chico: es un bloque propio**, el espejo de este para el gasto de trámite: (1) un pago del gasto de trámite como entidad, con banco y asiento `HABER banco / DEBE 200001` (hoy `expenses.payment_account_code` existe desde la `036` pero no lo lee nadie que postee), (2) `amount_paid`/estado derivados en `expenses` con el mismo patrón de trigger y guard que la 048, y (3) la antigüedad por pagar leyendo las dos tablas con el mismo tercero. Hasta entonces, el reporte ya dice qué encontró (`2af7ee8`) y este finding dice qué no puede encontrar.

---

## FND-009: "Marcar como pagada" escribe una columna que `business_expenses` no tiene — y lo hace DESPUÉS de postear
**Fecha:** 2026-09-21
**Contexto:** Plan del Bloque 3 (pagos a proveedores). Al verificar contra el código y contra staging lo que se iba a afirmar.
**Hallazgo:**
- `markBusinessExpenseAsPaid` (`api/business-expenses.ts`, cableado el 04/09) hace `UPDATE business_expenses SET status='pagado', payment_date, payment_method, payment_account_code`. **`business_expenses` no tiene `payment_account_code`**: la 036 se la agregó a `expenses` (gastos de trámite) y la 041 a `payments` (cobros). El tipo `PagoProveedorParaAsiento` dice textual "`business_expenses.payment_account_code`, que existe desde la `036`" — es el origen de la confusión. Verificado con `information_schema.columns` en staging: la columna no está.
- PostgREST rechaza el UPDATE con columna desconocida, así que el botón **falla siempre**. Y falla en el peor orden: el asiento del pago ya se posteó (es inmutable) y la compra sigue `pendiente_pago`. Un clic deja el libro diciendo que se pagó y el documento diciendo que no — exactamente la divergencia que el orden "asiento antes del UPDATE" quería evitar en la compra, invertida acá.
- Evidencia de que nadie lo apretó nunca: el libro de staging tiene **cero** asientos `pago_proveedor` (7 `factura`, 7 `gasto`, 1 `gasto_tramite`, 3 `manual`, 6 `pago`, 3 `reversion`), y las tres compras `pagado` de staging tienen `payment_date` pero ningún asiento de pago (son del seed o de antes del cableado). `scripts/verificar-asiento-tesoreria.ts` (04/09) probó SOLO el lado del cobro; el changelog de ese día lo dice ("cinco pasos, con un cobro nuevo").
- En producción (`main`) `markBusinessExpenseAsPaid` no postea nada ni escribe esa columna: es un UPDATE de `status`/`payment_date`/`payment_method`. Allá el botón funciona, sin libro.
**Impacto:** Solo `develop`/staging, y solo ese botón. Ninguna compra quedó a medias porque nadie lo usó. Pero es un botón vivo en el deploy de staging que, apretado, postea un asiento huérfano.
**Decisión:** No se parchea suelto: el Bloque 3 reemplaza `markBusinessExpenseAsPaid` por un pago como entidad (`supplier_payments`), con el banco en el PAGO y no en la compra, y con el orden del cobro (INSERT del pago → asiento → DELETE compensatorio). Hasta que llegue, el botón queda como está y se anota acá. El comentario del tipo se corrige en ese bloque.

---

## FND-008: `render-pantalla.mts` "no se podía conectar" al deploy — era Git Bash
**Fecha:** 2026-09-21
**Contexto:** Verificación de roles contra el deploy (contador y asistente). El 17/09 el script había fallado tres veces con *"No se pudo conectar"* mientras un fetch idéntico desde otro script funcionaba, y quedó anotado sin investigar.
**Hallazgo:** El `catch` se tragaba el error. Al imprimirlo: `getaddrinfo ENOTFOUND …vercel.appc`. Git Bash en Windows aplica conversión de rutas de MSYS a los argumentos que empiezan con `/`: `/finanzas/cobros` llega al script como `C:/Program Files/Git/finanzas/cobros`, la URL queda `https://…vercel.appC:/Program Files/…` y el host `…appc` no resuelve. Desde PowerShell no pasa; contra `localhost` tampoco se notaba porque el error decía "¿está corriendo npm run dev?" y se asumía que sí era eso.
**Impacto:** Solo herramienta de verificación; ninguna pantalla afectada. Pero costó una verificación el 17/09 y habría costado otra hoy.
**Decisión:** El `catch` ahora imprime la causa real (`err.message` + `cause`). El encabezado del script dice `MSYS_NO_PATHCONV=1` o PowerShell. Con eso, contra el deploy: contador → 307 en `/finanzas/cobros`, 200 en el PDF del recibo; asistente → 403 en el PDF, 307 a `/legal`.

---

## FND-006: El modal de confirmación no scrolleaba — el botón quedaba fuera de la pantalla
**Fecha:** 2026-09-21
**Contexto:** Verificación en el deploy `6021dc6` del diálogo "Registrar pago" refactorizado, desde una ventana de 1568×710.
**Hallazgo:** `ConfirmationModal` (`src/components/ui/confirmation-modal.tsx`, lo usan 22 pantallas) era `fixed` sin `max-h` ni `overflow`. Con siete campos el panel medía más que el viewport y los botones "Cancelar" / "Registrar pago" quedaban abajo del borde, sin forma de llegar: la rueda del mouse scrolleaba la página de atrás, no el modal. En un celular —el target del proyecto— pasa lo mismo con menos campos. Los clics de la extensión sobre el botón "se ejecutaban" sin efecto, y no quedó ningún cobro en la base.
**Impacto:** Preexistente, no de este bloque; afecta a todo modal alto (el de reversar, con textarea + vista previa, entra en la misma categoría). No lo detecta ningún test.
**Decisión:** `max-h-full overflow-y-auto` en el panel. El modal scrollea por dentro y los botones siempre están al alcance. Verificado en el deploy siguiente.

---

## FND-005: El seed de staging "resucitaba" un cobro reversado
**Fecha:** 2026-09-21
**Contexto:** Bloque 2 (recibo de caja). Se corrió `npm run seed:staging` para probar la llamada a `backfill_payment_numbers` y, al abrir el listado de facturas en el deploy, FAC-HON-000002 aparecía "Pago parcial · saldo 605" — el 17/09 su cobro de B/. 1,000.00 se había reversado (asiento 21) y la factura había quedado *Emitida*, saldo 1,605.
**Hallazgo:**
- `seedPayments()` decide por existencia de filas con id determinista: si falta la `payment_application`, la inserta. Desde la migración `046` reversar un cobro **borra sus aplicaciones** y deja el cobro `anulado`, así que para el seed un cobro reversado se ve como "cobro con la aplicación perdida" y la vuelve a crear.
- T7a hizo el resto: `amount_paid` 0 → 1,000, `emitida` → `parcialmente_pagada`. El libro seguía diciendo que la plata se devolvió (asiento 21). Dos verdades opuestas, la clase de divergencia que la reversión existe para impedir.
- Verificado en la base: `REC-000003 anulado apps=1 revs=1`, con la aplicación creada a las 15:59 del 21/09 (la hora del seed).
**Impacto:** Solo staging (el seed no corre contra producción). Pero cualquier corrida del seed después de una reversión deshacía la reversión sin avisar, y era el paso previo a verificar la reversión en pantalla.
**Decisión:** El estado del cobro manda. `seedPayments()` lee `payments.status` del cobro existente y si es `anulado` no toca ni la aplicación ni nada (`reversadosRespetados`, se cuenta en el resumen). Staging se restauró borrando SOLO esa aplicación (T7a devolvió la factura a *Emitida*, 0.00 / 1,605.00) y el seed corrido de nuevo reportó "1 reversado en staging, sin tocar". Anotado en SOP-030.

---

## FND-001: Datos del Excel con inconsistencias
**Fecha:** 2026-04-02
**Contexto:** Análisis del archivo REGISTRO_DE_EXPEDIENTES_OFICINA_INTEGRA_LEGAL-2026.xlsx
**Hallazgos:**
- Fechas en 4 formatos distintos: `DD/MM/YYYY`, `YYYY` (solo año), `datetime` (Python), `D/M/YYYY` (sin cero)
- Responsables con aliases y espacios trailing: `Daveiva`, `Daveiva `, `Dave`, `Dave `, `Milena `, `Mile ` → Solo 2 personas reales (Daveiva y Milena, socias)
- Tipos de cliente con inconsistencias: `Corporativo`, `Corporativo `, `corporativo `, `Regulatorio `
- Columna UBICACIÓN FÍSICA mezcla ubicación del archivero (`Archivo - Sección Clientes`) con institución (`MINSA`, `CORPORATIVO`)
- Columna COLOR completamente vacía — ligada a clasificación pero no implementada
- Filas placeholder vacías (CLI-046 a CLI-050, expedientes 47-50) con N° pero sin datos
- Solo 2 de 7 clasificaciones en uso: CORPORATIVO y REGULATORIO
- No existe columna de Institución separada en el Excel

**Impacto:** Requiere limpieza automática en la migración inicial
**Decisión:** Script de migración con normalización: trim, unificar aliases, parsear fechas, eliminar vacíos, separar institución de ubicación

---

## FND-002: Campo Ubicación Física — Pendiente de definición
**Fecha:** 2026-04-02
**Contexto:** El campo "Ubicación Física" es para localizar el expediente en el archivero/gavetero de la oficina
**Hallazgo:** Las socias aún no han definido cómo van a clasificar los gaveteros
**Decisión:** Implementar como texto libre buscable. Cuando definan su sistema de clasificación, se puede convertir en catálogo editable

---

## FND-003: Reportes específicos — Pendiente de validación
**Fecha:** 2026-04-02
**Contexto:** Se necesita funcionalidad de exportación pero no se han definido los reportes específicos
**Decisión:** Construir infraestructura genérica de exportación (PDF/Excel). Los reportes específicos se definen después de validar con las socias

---

## FND-004: Notificaciones — Fuera del MVP
**Fecha:** 2026-04-02
**Contexto:** No se implementan notificaciones (email, push, in-app) en el MVP
**Aplica a:** Gastos en rojo, tareas asignadas, fechas límite
**Decisión:** Solo indicadores visuales en dashboard. Se evalúa con las socias post-MVP si necesitan notificaciones
