# FINDINGS.MD — CRM INTEGRA LEGAL

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
