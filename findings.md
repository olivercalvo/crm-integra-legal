# FINDINGS.MD — CRM INTEGRA LEGAL

## FND-007: El modal heredaba la alineación de la celda que lo abría
**Fecha:** 2026-09-21
**Contexto:** Punto 5 de la verificación del Bloque 2 — reversar un cobro con clic real desde el listado de cobros (deploy `6d0f621`). Era la verificación que había quedado pendiente del bloque de reversión del 17/09 (el modal nunca se había visto abierto).
**Hallazgo:** `ConfirmationModal` no fija su propia alineación de texto. Como se renderiza donde lo monta el botón que lo abre —en los listados, dentro de un `<td class="text-right">`—, toda la advertencia ámbar, el rótulo "Motivo de la reversión" y la descripción del asiento salían alineados a la derecha. En el detalle de la factura pasa exactamente igual (el botón Reversar está en la columna de acciones). La lógica funcionaba (textarea, contador 2/1000 en ámbar, botón apagado hasta 3 caracteres, vista previa con el espejo, POST → asiento 23); lo roto era el render, que es lo único que un fetch no ve.
**Impacto:** Preexistente, visual, en cualquier modal abierto desde una celda alineada a la derecha.
**Decisión:** `text-left` en el panel del modal, junto con el `max-h`/`overflow` de FND-006. Verificado en el deploy siguiente.

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
