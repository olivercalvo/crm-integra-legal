# Roadmap Contable — CRM Integra Legal

**Fecha:** 18/07/2026 · **Estado:** plan de trabajo (consolida la reunión con el contador + el diseño previo)
**Fuentes:** reunión con el contador nuevo (Josuar) · `reconciliacion-legal-finanzas.md` · borrador de ledger `sql/pending/023_...` (EN ESPERA) · DE 34/1998

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
- **Ledger de partida doble** (asientos inmutables, hash-chain, correlativo sin huecos) — ya diseñado en `023` (EN ESPERA), a reescribir sobre el `chart_of_accounts` existente.
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

## 5. Insumos / decisiones pendientes del contador

- **Balance de comprobación de QuickBooks** (Edwin lo descarga) → da los saldos iniciales y valida el plan de cuentas.
- **Plan de cuentas validado** (revisará el `chart_of_accounts` de 34 cuentas extraído de QB — le mandamos el Excel).
- **Tratamientos contables específicos** (las 9 preguntas ya enviadas): reembolsos (¿pasivo 2201 o ingreso?), fondos en custodia/trust (1103/2201), reconocimiento de honorarios (devengado vs caja), ITBMS en reembolsos, anticipos.
- **Ya respondido en la reunión:** ruta contable = **Diario/Mayor** (Art. 2a); él es la cabeza de la certificación/aval.

## 6. ⚠️ Decisión de negocio abierta — proforma vs factura fiscal ("todo o nada")

El contador fue tajante: **no se puede mezclar** (algunas facturas al PAC y otras no) — un auditor lo lee como ocultamiento de ingresos. Hoy el CRM **permite elegir por factura** si se envía al PAC; eso es el riesgo. Integra debe decidir con él: **facturar todo electrónicamente** o **nada** (proforma para todo, reportando igual todos los ingresos). Afecta cómo debe comportarse el módulo de facturación (¿se mantiene el toggle por factura o se cambia el modelo?).

## 7. Qué ya existe vs qué hay que construir

**Existe:**
- `chart_of_accounts` — 34 cuentas (extraídas de QB, pendiente validación del contador), con `is_system`, mapeo a QB.
- `tax_codes`, `services_catalog`, `numbering_sequences` + RPC `get_next_sequence_number`.
- VAT Summary implementado. P&L / Balance / Aging como placeholders.
- Diseño del ledger (`023`, en espera) y de la reconciliación Legal↔Finanzas.

**Hay que construir:**
- Ledger (reescrito sobre el COA existente) + asientos manuales (saldos iniciales).
- UI de gestión de plan de cuentas (crear/editar cuentas).
- Enganche factura→asiento y pago→asiento (Fase 2).
- Los 6 reportes contables (Fase 4).
- Conexión de gastos legales (Fase 3, sobre la reconciliación).

## 8. La conexión bancaria — resumen

- **No hay API directa de Banco General.** Se conecta vía **agregador Prometeo** (`prometeoapi.com`), que tiene conector de Banco General Panamá. Cadena: CRM → Prometeo → banco. Requiere que Integra autorice a Prometeo el acceso a la cuenta. Costo a cotizar (no público).
- **Primera versión recomendada:** importación de estado de cuenta (Excel/CSV) + reglas. Sin costo, sin ceder credenciales, calza con el cierre mensual.
- **NO es Fase 1.** Se evalúa en la Fase 5.

## 9. Próximos pasos

1. Esperar del contador: balance de comprobación + plan de cuentas validado + respuestas a las 9 preguntas.
2. Mientras: verificar el estado de la gestión de plan de cuentas en el CRM (¿hay UI de crear cuentas hoy?) para dimensionar la Fase 1.
3. Con el material del contador: reescribir el `023` sobre el COA existente y arrancar la Fase 1 (estructura + ledger + saldos iniciales).
4. Fase 2 (factura→asiento) puede empezar en paralelo apenas esté el ledger — deriva de Finanzas, no depende de la reconciliación legal.
