# Roadmap Contable — CRM Integra Legal

**Fecha:** 18/07/2026 · **Actualizado:** 04/08/2026 · **Estado:** plan de trabajo (consolida la reunión con el contador + el diseño previo)
**Fuentes:** reunión con el contador nuevo (Josuar) · correo Josuar 31/07/2026 + respuesta 01/08/2026 · `reconciliacion-legal-finanzas.md` · ledger `sql/pending/023_...` (reescrito 04/08, pendiente de aplicar) · DE 34/1998

---

## 1. Objetivo

El CRM debe llevar la contabilidad de Integra de forma **automática**, de modo que el contador solo tenga que **revisar mensualmente y firmar** (menos trabajo = menos costo para la firma). El CRM reemplaza a QuickBooks (ya cancelado) como sistema de registro, y debe ser **avalable por un CPA** (DE 34/1998).

## 2. Timeline (del contador)

- **Diciembre 2026:** contabilidad del CRM lista, con el año registrado.
- **31 de marzo 2027** (persona jurídica) o prórroga al **30 de abril**: presentar a la DGI.
- Runway: ~5 meses. QuickBooks se cerró en julio; el resto de julio se pone al día en el CRM.

## 3. Faseo (propuesto por el contador, alineado con nuestro diseño)

### Fase 1 — Estructura contable + saldos iniciales
- **Plan de cuentas** validado por el contador (ingresos = cuenta 4, costos = 5, gastos = 6; balance: banco, cuentas por cobrar, cuentas por pagar, patrimonio).
- **UI para crear/administrar cuentas** ("crear la manera de crear cuentas").
- **Ledger de partida doble** (asientos inmutables, hash-chain, correlativo sin huecos) — ✅ `023` **reescrito el 04/08** sobre el `chart_of_accounts` existente (ya no lo recrea; lo referencia por FK). Solo schema; **pendiente de aplicar en Supabase**. El posteo va en la Fase 2 del ledger.
- **Carga de saldos iniciales** vía **asientos de diario manuales** (`source_type='manual'`, ya contemplado) que cuadren con lo declarado a la DGI (el CRM arranca de cero, NO importa el histórico de QB — solo los saldos de cierre como saldos de apertura).

### Fase 2 — Factura → asiento automático
- Al emitir una factura, el sistema afecta automáticamente las cuentas: **DEBE cuenta por cobrar / HABER ingreso (401 servicios legales) + HABER ITBMS por pagar**.
- Reembolsos según el tratamiento que confirme el contador (ver §5).
- **Deriva 100% de Finanzas** (facturas/pagos), que es la fuente contable limpia → NO requiere resolver primero la reconciliación con el módulo legal.

### Fase 3 — Conectar el módulo legal + gastos del bufete
- Los **gastos de caso** (módulo legal) hoy NO están conectados a la contabilidad. Conectarlos por reglas (lo que cargás acá → va a esta cuenta). Requiere la **reconciliación Legal↔Finanzas** ya diseñada (evitar doble conteo).
- **Gastos operativos del bufete** (fijos, <10 mensuales) → sus cuentas.

### Fase 4 — Reportes mensuales (ver §4)

### Fase 5 (futuro) — Conexión bancaria
- Primera versión recomendada: **importación del estado de cuenta** (Banco General exporta Excel/CSV) + reglas de categorización.
- Alternativa de feed en vivo: **agregador Prometeo** (no hay API directa del banco). Implica costo + dar acceso a la cuenta a un tercero. NO es prioridad (el contador confirmó que no es dependencia).

## 4. Reportes que el contador necesita (mensuales)

Entregable concreto del módulo. Varios ya existen como **placeholder vacío** en `/finanzas/reportes/*`:

| Reporte | Estado hoy |
|---|---|
| Libro Mayor | No existe |
| Balance General | Placeholder |
| Estado de Resultado (P&L) | Placeholder |
| Antigüedad de Cuentas por Cobrar (AR aging) | Placeholder |
| Antigüedad de Cuentas por Pagar (AP aging) | No existe |
| Balance de Comprobación (balance de prueba) | No existe |
| VAT Summary (ITBMS) | ✅ Implementado |

**Nota:** estos 6 reportes son exactamente los mismos que Josuar pidió descargar del histórico de QuickBooks (§5.1). O sea, lo que baja de QB para los saldos iniciales es también el checklist de salidas que el módulo debe reproducir → sirve para validar que el CRM da los mismos números.

## 5. Insumos / decisiones pendientes del contador

### 5.1 Reportes históricos de QuickBooks — ENVIADOS a Josuar el 01/08/2026

Josuar pidió (reunión) descargar de QuickBooks **6 reportes** del histórico, no solo el balance de comprobación. Se exportaron de QBO ("Todas las fechas", hasta el cierre de QB) y se enviaron por correo el 01/08/2026:

| Reporte pedido | Nombre en QuickBooks Online | Dónde se saca |
|---|---|---|
| Libro Mayor | Libro mayor | Exportar datos |
| Balance General | Balance general | Exportar datos |
| Estado de Resultado (P&L) | Beneficios y pérdidas | Exportar datos |
| Balance de Comprobación | Balance de sumas y saldos | Exportar datos |
| Antigüedad de Cuentas por Cobrar (clientes) | Informe detallado de antigüedad de C_C | **Página de Informes** (no está en Exportar datos) |
| Antigüedad de Cuentas por Pagar (proveedores) | Informe detallado de antigüedad de C_P | **Página de Informes** (no está en Exportar datos) |

Extras enviados: Libro Diario ("Diario") + listados de Clientes y Proveedores. Los saldos de apertura salen del **Balance de Comprobación** (todas las cuentas) + las **dos antigüedades** (detalle de quién debe / a quién se debe al corte).

### 5.2 Insumos / decisiones pendientes de Josuar

- **Plan de cuentas final.** ⚠️ Los modelos que Josuar mandó (`EJEMPLOS DE LIBROS CONTABLES.xlsx`, 01/08) usan una estructura de cuentas **distinta** a las 34 extraídas de QB: ingresos `4xxxxx` (400001 Derecho Corporativo…), costos `5xxxxx`, gastos operativos `6xxx`, activos `1xxxxx`, pasivos `2xxxxx`, patrimonio `3xxxxx`. La Fase 1 será un **mapeo**, no una validación directa. Falta que confirme el plan definitivo (código, nombre, tipo).
- **Saldos de apertura** a la fecha de corte que él defina (aún sin confirmar la fecha).
- **Tratamientos contables (4 preguntas ENVIADAS el 01/08/2026)** — el roadmap las daba por enviadas pero no se habían mandado hasta esa fecha: reembolsos (¿ingreso o recuperación de gasto?), honorarios (devengado vs caja), ITBMS en reembolsos (hoy exento, confirmar), anticipos/fondos de clientes en custodia (¿pasivo hasta aplicar a factura? ¿cuenta específica?).
- **Modelos de los otros informes** — Josuar enviará más además de los 3 ya compartidos (Estado de Resultado, Balance General, Balance de Comprobación).

### 5.3 Ya confirmado por Josuar

- **Conexión bancaria = importación del Excel de Banco General + reglas de registro** (NO API en vivo). Confirmado por correo 31/07/2026. Alinea con la Fase 5.
- **Ruta contable = Diario/Mayor** (Art. 2a, reunión); él es la cabeza de la certificación/aval.

## 6. ⚠️ Decisión de negocio abierta — proforma vs factura fiscal ("todo o nada")

El contador fue tajante: **no se puede mezclar** (algunas facturas al PAC y otras no) — un auditor lo lee como ocultamiento de ingresos. Hoy el CRM **permite elegir por factura** si se envía al PAC; eso es el riesgo. Integra debe decidir con él: **facturar todo electrónicamente** o **nada** (proforma para todo, reportando igual todos los ingresos). Afecta cómo debe comportarse el módulo de facturación (¿se mantiene el toggle por factura o se cambia el modelo?).

## 7. Qué ya existe vs qué hay que construir

**Existe:**
- `chart_of_accounts` — 34 cuentas (extraídas de QB, pendiente validación del contador), con `is_system`, mapeo a QB.
- `tax_codes`, `services_catalog`, `numbering_sequences` + RPC `get_next_sequence_number`.
- VAT Summary implementado. P&L / Balance / Aging como placeholders.
- Schema del ledger (`023`, reescrito 04/08 sobre el COA existente — **falta aplicarlo**) y diseño de la reconciliación Legal↔Finanzas.

**Hay que construir:**
- Motor de posteo del ledger (RPC + verificador de hash-chain) + asientos manuales (saldos iniciales).
- UI de gestión de plan de cuentas (crear/editar cuentas).
- Enganche factura→asiento y pago→asiento (Fase 2).
- Los 6 reportes contables (Fase 4).
- Conexión de gastos legales (Fase 3, sobre la reconciliación).

## 8. La conexión bancaria — resumen

- **No hay API directa de Banco General.** Se conecta vía **agregador Prometeo** (`prometeoapi.com`), que tiene conector de Banco General Panamá. Cadena: CRM → Prometeo → banco. Requiere que Integra autorice a Prometeo el acceso a la cuenta. Costo a cotizar (no público).
- **Primera versión recomendada:** importación de estado de cuenta (Excel/CSV) + reglas. Sin costo, sin ceder credenciales, calza con el cierre mensual.
- **NO es Fase 1.** Se evalúa en la Fase 5.

## 9. Próximos pasos

1. **Esperar de Josuar:** plan de cuentas final + saldos de apertura (con fecha de corte) + respuestas a las 4 preguntas contables + modelos de los otros informes. (Reportes históricos de QB ya enviados 01/08.)
2. ✅ **Hecho (01/08/2026):** UI de gestión de plan de cuentas en producción (`/finanzas/configuracion/cuentas`, CRUD con `is_system`, sin hard delete, audit_log).
3. ✅ **Hecho (04/08/2026):** `023` reescrito como schema puro del ledger sobre el COA existente (chart-agnostic, FK al `chart_of_accounts`). **Pendiente: aplicarlo en Supabase** (pausa obligatoria).
4. Con el plan de cuentas final: **mapear** las cuentas de Josuar contra el `chart_of_accounts` actual (no coinciden, ver §5.2) y cargar los saldos iniciales por asiento manual. El mapeo ya no bloquea el schema del ledger, solo la lógica de posteo.
5. Fase 2 del ledger (RPC de posteo + verificador de hash-chain + factura→asiento) apenas el `023` esté aplicado y el plan de cuentas confirmado — deriva de Finanzas, no depende de la reconciliación legal.
