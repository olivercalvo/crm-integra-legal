# Cobertura de requerimientos (reuniones del 16/07 al 06/10/2026)

Revisión de solo lectura del 07/10/2026, rama `feat/bloque1-contable` (último commit `36f00b7`). Se verificó en el
código, no sólo en los documentos. **«HECHO» quiere decir que está en el código y en staging**: las migraciones
066 a 101 todavía no están en producción, entran con la ventana del Bloque 1.

Rutas relativas a la raíz del repositorio. Tamaño: **chico** (horas a 1 día), **medio** (2 a 4 días), **grande**
(una semana o más).

## Resumen

| Estado | Cantidad |
|---|---:|
| HECHO | 20 |
| PARCIAL | 25 |
| FALTA | 9 |
| FUERA DEL SISTEMA | 2 |
| **Total** | **56** |

## Contabilidad base

| N | Requerimiento | Estado | Evidencia | Qué falta | Tamaño |
|---|---|---|---|---|---|
| 1 | Plan de cuentas: 6 tipos, código de 6 dígitos, subcategoría, descripción, saldo inicial con fecha, activa/inactiva | PARCIAL | `src/lib/finanzas/types/chart-of-account.ts`, `validators/chart-of-account.ts`, /finanzas/configuracion/cuentas | El código no se obliga a 6 dígitos (acepta hasta 20 caracteres alfanuméricos) | chico |
| 2 | Subcategorías creadas por el contador; Operativo/Financiamiento/Inversión; gasto financiero aparte; obligatorias y no eliminables; depreciación acumulada en PPE | PARCIAL | Migración 079 (`coa_subcategoria_por_tipo`), `SUBCATEGORIAS_POR_TIPO`, `gastos_financiamiento`, `types/__tests__/subcategorias-e6.test.ts` | Las subcategorías son una lista fija en código y en la base: el contador no las crea desde pantalla | medio |
| 3 | Carga masiva del plan por Excel con saldos iniciales y archivo de ejemplo | HECHO | `configuracion/cuentas/_components/import-accounts-panel.tsx`, `import/chart-of-accounts-workbook.ts`, `api/finanzas/configuracion/chart-of-accounts/bulk` | Detalle: una sola fecha de saldo para todo el lote, sin columna de descripción, y la hoja de instrucciones dice que la subcategoría es opcional | chico |
| 4 | Saldos iniciales por asiento de apertura | HECHO | /finanzas/asientos/apertura, migraciones 100 y 101, `sql/tests/verificacion-100-101-apertura.sql`, `contabilidad/__tests__/apertura.test.ts` | — | — |
| 5 | Ver el asiento que genera cada transacción | PARCIAL | Detalle de NC de venta y de compra (Debe/Haber); los cobros muestran su número de asiento | El detalle de factura, compra y gasto de trámite no muestra su asiento ni enlaza a él | chico |
| 6 | Asientos manuales con referencia, descripción y anulación; con tercero afectan la antigüedad | HECHO | /finanzas/asientos, `asientos/_components/asiento-manual-form.tsx`, migraciones 054, 055 y 071, `reports/antiguedad-source.ts` | — | — |
| 7 | Cuentas de depreciación en el plan; «servicios otro» creada y ligada | PARCIAL | Migración 082 (400010 Otros servicios, HON-OTROS ligado, con verificación); depreciación dentro de PPE (079) | Las cuentas de depreciación no las crea ninguna migración: las carga el contador en su plan | chico |

## Ventas

| N | Requerimiento | Estado | Evidencia | Qué falta | Tamaño |
|---|---|---|---|---|---|
| 8 | La factura genera CxC contra ingreso según la línea de servicio | HECHO | `contabilidad/asiento-factura.ts` (100004 contra `services_catalog.revenue_account` por línea; ITBMS por tasa, 073), `asiento-factura.test.ts` | — | — |
| 9 | Cada cuenta de ingreso nueva aparece para asociar servicios | FALTA | `services_catalog.revenue_account` sólo se cambia por SQL (079, 082) | Pantalla del catálogo de servicios con su cuenta de ingreso | medio |
| 10 | Factura mixta: honorarios a ingreso, reembolsos a 130003, cuenta de la línea de reembolso editable | FALTA (por decisión) | SOP-029: `validarConsistenciaDeKind` (`api/invoices.ts`) rechaza mezclar honorarios y reembolsos; los REIM-* van a 130003 | Hoy la regla vigente prohíbe la mezcla (Josuarth). Si se revierte: facturas mixtas y cuenta editable por línea | grande |
| 11 | Selector de tipo de documento en ventas, con título según el tipo; no llamar «Honorario» a la factura | PARCIAL | `facturas/_components/invoice-form.tsx` (Honorarios, Reembolso, Nota de débito); NC en /finanzas/notas-credito/nueva y emitida fuera en /finanzas/facturas-externas/nueva | NC y emitida fuera no están en el selector; el título siempre dice «Nueva factura»; la etiqueta sigue siendo «Honorarios» | medio |
| 12 | Facturar algo que no es honorario (venta de un equipo) | PARCIAL | Servicio OTR-ING → 440001 Otros ingresos (079), facturable | No hay tipo «venta de bienes»: no da de baja el activo ni registra la ganancia o la pérdida | medio |
| 13 | Cotización → aceptación → factura → FE, ligado al caso; «Facturar este caso» en Gestión legal | PARCIAL | `cotizaciones` (aceptar, convertir: /api/finanzas/quotes/[id]/convert), `case_id` en cotización y factura, /finanzas/facturas/nueva acepta `?case_id=` | Falta el botón «Facturar este caso» en el detalle del caso | chico |
| 14 | Precio con ITBMS incluido | FALTA | — | Opción en la línea para calcular la base a partir del precio con ITBMS | medio |
| 15 | Número de documento manual o automático | PARCIAL | Automático (`get_next_sequence_number`); manual sólo en la factura emitida fuera (FAC-EXT) | Número manual en la factura normal (cuidado con el correlativo de la DGI) | chico |
| 16 | NC como pantalla propia, factura opcional, montos editables, aviso sin factura; desde la factura; ventas y compras; código en el facturador | HECHO | /finanzas/notas-credito/nueva (`?factura=`), /finanzas/notas-credito-proveedor, migraciones 076 y 081; FE: 04 con factura y 06 sin factura (`efactura/mapper/tipo-de-documento.ts`, autorizadas en sandbox) | — | — |
| 17 | «Enviar a la DGI sí o no» en facturas y NC | PARCIAL | `components/finanzas/selector-de-envio.tsx` en NC y ND; migración 083 (`fe_estado 'interna'`) | La factura normal (honorarios y reembolso) no tiene la opción «Interna». La factura de saldos iniciales ya no hace falta: la cubre la apertura | chico |
| 18 | Número de reembolso: qué número es hoy | HECHO (informativo) | Serie interna `FAC-REI-000NNN` (secuencia `invoice_reim`); va a la DGI como tipo 09 desde el 17/09/2026 | Ante la DGI el número es otro: un solo correlativo por punto de facturación, compartido con FAC-HON y ND. Las 34 FAC-REI anteriores salieron como 01 (Josuarth decidió no corregirlas) | — |

## Compras y proveedores

| N | Requerimiento | Estado | Evidencia | Qué falta | Tamaño |
|---|---|---|---|---|---|
| 19 | Compras con líneas y cuenta; CxP; NC de proveedor; número de factura del proveedor; sin pago obligatorio; la sección se llama «Compras» | PARCIAL | /finanzas/gastos-bufete, `business-expense-form.tsx`, `expense-lines-editor.tsx`, migraciones 044, 066, 076 y 093 | El menú y el título dicen «Gastos del Bufete» (`src/lib/nav-config.ts:105`) | chico |
| 20 | Ficha de proveedor: razón social, comercial, RUC, DV aparte, dirección, teléfono, secuencial, términos de pago | HECHO | Migraciones 033 y 057, `proveedores/_components/supplier-form.tsx`, `ruc-dv-separados.test.ts` | El plazo es en días (0 a 365), no un selector de tramos; los tramos están en la antigüedad | — |
| 21 | Mayor de una cuenta de gasto a Excel con RUC, DV, nombre y monto por proveedor | HECHO | /finanzas/reportes/mayor, `api/finanzas/reportes/mayor/export`, `reports/mayor-export.ts`, `tercero-fiscal.ts` | Una fila por movimiento, sin subtotal por proveedor (se suma en Excel) | — |
| 22 | Gastos fijos mensuales; carga masiva de facturas de compra e ingreso con pantalla editable antes de contabilizar; cuenta predeterminada del proveedor; descripción del asiento anterior | PARCIAL | Cuenta predeterminada: migración 057, `cuenta-por-defecto.test.ts`. Sólo existe la importación de ASIENTOS (067) | Gastos recurrentes, importación de facturas de compra e ingreso con vista editable y copiar la descripción anterior | grande |
| 23 | Pagos a proveedores: elegir proveedor, ver sus pendientes y pagar; también desde la factura | PARCIAL | Desde la compra: `register-supplier-payment-dialog.tsx`, `api/supplier-payments.ts`; pendientes en la ficha (`supplier-expenses.tsx`) | Pantalla para elegir un proveedor y pagar varias compras pendientes juntas (hoy, un pago por compra) | medio |

## Gastos de trámite y fondos de clientes

| N | Requerimiento | Estado | Evidencia | Qué falta | Tamaño |
|---|---|---|---|---|---|
| 24 | Saldo de fondos por caso o cliente visible | HECHO | `legal/casos/[id]/page.tsx` (saldo del caso), /legal/gastos (`gastos-table.tsx`: pagado, gastado, balance, cliente) | Un total por cliente sumando todos sus casos (opcional) | chico |
| 25 | Gasto de trámite con proveedor, descripción, cuenta (130003 editable), CxP; banco de origen | HECHO | `section-expense-form.tsx` («Ya se pagó» con banco), `asiento-gasto-tramite.ts`, migraciones 049, 050 y 070 | — | — |
| 26 | Factura de reembolso: CxC contra 130003; el gasto no se cuenta dos veces | HECHO | `asiento-factura.ts` (REIM-* acreditan 130003), `asiento-factura.test.ts` | La cuenta 130003 no es configurable (decisión del 17/09) | chico |
| 27 | «Pasar a contabilidad» por gasto; lo de las abogadas queda en aprobación del contador, también en bloque | FALTA | El gasto se postea al crearse (Bloque 4); `task_plan.md` dice «pasar a contabilidad no se construye» | Indicador por gasto y bandeja de aprobación de gastos y cobros, uno a uno y en bloque | grande |
| 28 | «Pagos» del caso como «Dinero recibido» o «Cobros» | HECHO | `legal/casos/[id]/page.tsx` (la sección y las columnas dicen «Cobros») | Quedan «Registrar Pago» y «Fecha de Pago» en `components/expenses/payment-form.tsx` | chico |
| 29 | Remanente de reembolsables a fin de mes; gastos cobrados contra facturados | PARCIAL | Saldo de 130003 en el Mayor; balance por caso en /legal/gastos | El reporte en sí | medio |
| 30 | Margen en reembolsos (línea aparte con ITBMS) | FUERA DEL SISTEMA | `task_plan.md`: «el sistema NO debe calcular márgenes ni partir documentos» (decisión de las licenciadas) | — | — |

## Cobros, pagos y bancos

| N | Requerimiento | Estado | Evidencia | Qué falta | Tamaño |
|---|---|---|---|---|---|
| 31 | Cobros con banco o caja; varias facturas en una transferencia; referencia obligatoria; excedente con aviso y a favor del cliente | HECHO | /finanzas/cobros/nuevo, `payment-form-fields.tsx`, `repartir-por-antiguedad.ts` (`mensajeDeExcedente` en las dos puertas), migración 074, `cobro-con-excedente.test.ts` | — | — |
| 32 | Cada banco con su cuenta contable; módulo Banco con transferencias y conciliación | PARCIAL | Los bancos son cuentas de activo (100001, 100002, 100003 de saldos de clientes; `asiento-tesoreria.ts`) | Módulo Banco: transferencias entre cuentas (hoy por asiento manual) y conciliación | grande |
| 33 | Conexión con Banco General y reglas automáticas | FALTA | — | Todo | grande |
| 34 | Pagos con tarjeta Visa y su conciliación | PARCIAL | El método «tarjeta» existe en cobros y compras | La cuenta de pasivo de la tarjeta, sus pagos y la conciliación | medio |

## Impuestos

| N | Requerimiento | Estado | Evidencia | Qué falta | Tamaño |
|---|---|---|---|---|---|
| 35 | Cuenta ITBMS por tasa; ITBMS por línea en compras; tasas configurables; cuenta al crear; porcentaje | HECHO | Migraciones 045 y 073, /finanzas/configuracion/impuestos (`tax-codes-manager.tsx`), `verificacion-073-074.sql` | — | — |
| 36 | Reporte de ITBMS para la declaración | HECHO | /finanzas/reportes/vat-summary, export Excel y PDF, `reports/vat-calculo.ts` | — | — |

## Reportes

| N | Requerimiento | Estado | Evidencia | Qué falta | Tamaño |
|---|---|---|---|---|---|
| 37 | Estado de resultados mes a mes por subcategoría; utilidad bruta, ISR y neta; sin distribución a socias; «utilidad neta» en el balance | PARCIAL | /finanzas/reportes/pyl, `reports/estado-resultado-niif18.ts` (078), `balance-statement.tsx`, `estado-resultado-niif18.test.ts`, `isr-del-bufete.test.ts` | Vista **mes a mes** (una columna por mes): hoy es un solo rango | medio |
| 38 | Balance por subcategoría y balance de comprobación | HECHO | /finanzas/reportes/balance, /finanzas/reportes/comprobacion, `balance-comprobacion.test.ts` | No exportan a Excel ni a PDF | chico |
| 39 | Mayor: descripción por línea, Nombre, contrapartida, detalle, fechas, todas las cuentas o sólo con saldo, Excel | PARCIAL | /finanzas/reportes/mayor, `libro-mayor.ts`, export, `libro-mayor.test.ts`, `nombre-del-tercero-e2.test.ts` | Una cuenta a la vez: falta «todas las cuentas» y «sólo con saldo» | medio |
| 40 | Estados financieros a cualquier fecha; fecha de documento y de registro | HECHO | Migraciones 068 y 069 (`accounting_date`), corte por fecha en balance, ER, comprobación y Mayor, `periodo-estados-financieros.test.ts` | — | — |
| 41 | Auxiliares y antigüedad de CxC y CxP, con documento y tercero, detalle y resumen | PARCIAL | /finanzas/reportes/aging (resumen y detalle, Excel con RUC y DV), /finanzas/reportes/estado-cuenta | La antigüedad no tiene fecha de corte (cuenta contra hoy); el estado de cuenta no filtra por fechas | medio |
| 42 | Paquete mensual para revisar y firmar; reporte mensual de casos; PDF por correo | FALTA | Sólo la constancia de cierre de período y el PDF del ITBMS | Todo el paquete mensual | grande |
| 43 | Dashboard financiero en inicio (ventas y cobros del mes) | FALTA | /finanzas redirige a facturas o a reportes | El dashboard | medio |

## Menú, navegación y pantallas (reunión del 30/09)

| N | Requerimiento | Estado | Evidencia | Qué falta | Tamaño |
|---|---|---|---|---|---|
| 44 | Menú por módulos en el orden del contador; Legal aparte; clientes en los dos lados | PARCIAL | `src/lib/nav-config.ts` (Legal, Finanzas y Admin son pestañas aparte). Hoy Finanzas es una lista plana: Cotizaciones, Plantilla T&C, Facturas, Emitidas fuera, NC, Cobros, Pendientes DGI, Gastos del Bufete, NC de Proveedores, Proveedores, Reportes, Asientos, Períodos, Bitácora, Plan de Cuentas, Impuestos, Parámetros | Agrupar en Inicio, Ventas, Compras, Banco, Diario, Reportes y Configuración; listado de ND; Clientes también en Finanzas | medio |
| 45 | Todo lo de un tema dentro del mismo módulo | PARCIAL | Pagos y NC de proveedor dentro de la compra; cobros desde la factura | Clientes sólo en Legal; la apertura en Asientos (no en Configuración); bancos de cobros en documentos existentes | medio |
| 46 | Cada opción en ventana o pestaña nueva (estilo Navision) | FALTA | Ningún `target="_blank"` en el menú; sólo en PDFs y archivos | Ver la propuesta al pie | chico (pestaña del navegador) / grande (pestañas internas) |
| 47 | Menú por rol: la abogada no ve lo contable; el contador ve todo | PARCIAL | `nav-config.ts`, `route-access.ts`, `nav-guard.test.ts`. La abogada no ve Asientos, Períodos ni Bitácora, pero sí Plan de Cuentas, Impuestos, Parámetros y Reportes. El contador no ve Legal, Cotizaciones ni el listado de facturas | Es una decisión de permisos (CLAUDE.md §4, decisiones del cliente): la abogada vería menos y el contador más. Mover juntos el menú, `route-access.ts` y CLAUDE.md | chico |
| 48 | Acceso directo instalable | FALTA | No hay `manifest` ni íconos de app | `manifest` con `display: standalone` e íconos 192/512 | chico |
| 49 | Líneas compactas con botón «+» | HECHO | `invoice-line-items.tsx`, `expense-lines-editor.tsx`, `asiento-manual-form.tsx`, `quote-lines-editor.tsx` | Validar con el cliente si se ven lo bastante compactas | — |
| 50 | Filtros, buscador y orden en todas las pantallas; estados completos | PARCIAL | Facturas (6 estados), cobros, compras, proveedores, cotizaciones y diario tienen filtros | NC de venta y de proveedor sin filtros; ningún listado ordena por columna | medio |
| 51 | Referencia por módulo y número de transacción consecutivo | HECHO | `contabilidad/modulo-del-asiento.ts` (FAC-ING, FAC-CO, NC-ING, NC-CO, CO, PA, AD, AP, CA), `referencias-y-modulo-e3.test.ts` | — | — |
| 52 | Diario importado en vista editable con validación y diferencia | PARCIAL | /finanzas/asientos/importar, `import/asientos-import.ts` (errores por fila y columna, cuadre), migración 067 | La vista previa es de solo lectura: se corrige en el Excel y se vuelve a subir | medio |

## Fichas, accesos y otros

| N | Requerimiento | Estado | Evidencia | Qué falta | Tamaño |
|---|---|---|---|---|---|
| 53 | Ficha de cliente con DV aparte y dirección | HECHO | `clients.digito_verificador` (019, 022), `legal/clientes/[id]/page.tsx` | Sólo en Legal (ver 44 y 45) | — |
| 54 | Usuario contador para Josuarth | PARCIAL | Runbook de la ventana §6 «Accesos», ensayado en staging el 05/10 | Se hace en la ventana; falta confirmar su correo | chico |
| 55 | Bitácora, niveles de aprobación y de acceso | PARCIAL | /finanzas/auditoria, /legal/admin/auditoria, migraciones 084 y 086 a 091; 4 roles en `route-access.ts` | Las bitácoras van en su propia ventana; no hay niveles de aprobación (ver 27) | grande (aprobaciones) |
| 56 | Planilla 03, SIPE, arreglo de pago de renta | FUERA DEL SISTEMA | Ninguna referencia en el código | — | — |

### Propuesta para el 46 (estilo Navision)

- **Pestaña del navegador (chico, recomendado):** los enlaces del menú ya son `<Link>`, así que el clic con la rueda o
  con Ctrl ya abre en otra pestaña. Lo que falta es un ícono «abrir en pestaña nueva» al lado de cada opción y
  `target="_blank"` en los enlaces de documentos dentro de los reportes (Mayor, Diario, antigüedad). Medio día.
- **Pestañas internas tipo MDI (grande):** un contenedor que mantiene varias pantallas abiertas dentro de la app
  con su estado. Choca con el ruteo de Next (cada pantalla es una página del servidor) y con el uso en celular.
  Dos semanas o más, y lo más probable es que pida rehacer la navegación. No lo recomiendo.

## Propuesta: qué entra antes de la ventana y qué queda para el Bloque 2

**Antes de la ventana** (sólo código, sin migraciones, de bajo riesgo y que el contador ve el primer día; unos
2 días en total, con la suite y un ensayo más):

| N | Qué | Tamaño |
|---|---|---|
| 19 | «Gastos del Bufete» pasa a llamarse «Compras» (menú y títulos) | chico |
| 5 | En el detalle de factura, compra y gasto de trámite: «Ver asiento», con enlace al asiento | chico |
| 13 | Botón «Facturar este caso» en el detalle del caso | chico |
| 48 | Manifest e íconos para instalar el CRM en el escritorio | chico |
| 46 | Ícono «abrir en pestaña nueva» en el menú y en los enlaces de los reportes | chico |
| 3 | Corregir la hoja de instrucciones de la carga del plan (subcategoría obligatoria) | chico |
| 11 | Título según el tipo y etiqueta «Factura» en lugar de «Honorarios» | chico |

**Bloque 2** (en este orden, por el uso del contador):

1. 37 Estado de resultados mes a mes, 39 Mayor de todas las cuentas o sólo con saldo, 38 Excel del balance y
   la comprobación, 41 antigüedad con fecha de corte: lo que Josuarth pidió para revisar los meses.
2. 44 y 45 menú por módulos (con 47, si el cliente confirma el cambio de permisos), 43 dashboard y 50 filtros y
   orden.
3. 22 carga masiva de facturas de compra e ingreso con vista editable (y 52, el diario editable, con la misma pieza).
4. 23 pagar varias compras de un proveedor, 9 catálogo de servicios, 14 precio con ITBMS incluido, 17 factura
   interna, 15 número manual, 2 subcategorías desde pantalla, 1 código de 6 dígitos, 12 venta de bienes.
5. 29 reporte de reembolsables, 34 tarjeta, 32 módulo Banco con conciliación, 27 y 55 aprobaciones.
6. Contador ve Clientes (lista y ficha comercial, sin casos ni documentos legales). Decisión de Oliver del 08/10:
   hasta entonces el contador no ve Clientes. Es un cambio de permisos: se mueven juntos la tabla de roles de
   CLAUDE.md, `route-access.ts`, los guards de la API y `nav-config.ts`.

**Bloque 3 o más adelante:** 33 conexión con Banco General y 42 paquete mensual en PDF por correo.

**Esperan una decisión del cliente:** 10 factura mixta (hoy la prohíbe la regla de Josuarth, SOP-029) y 47 (es un cambio
de permisos).

---

## Decisión de fondo (reunión del 02/10): saldos al 31/12/2025 y carga de enero en adelante

Josuarth manda los saldos al 31/12/2025 (de la declaración de renta), carga enero a mano para probar los
reportes y quiere cargar de febrero en adelante con la carga masiva de facturas (requerimiento 22). El inicio
contable del CRM es el 01/07/2026 (096) y bloquea los documentos anteriores.

### Camino A: inicio contable en 01/07/2026; apertura al 31/12/2025; enero a junio como asientos de diario

**¿Funciona hoy de punta a punta? Sí, con lo que ya está en staging y en la ventana (096 a 101).** Pasos:

1. En la ventana todo queda como está (inicio 01/07/2026). Después, Josuarth carga la fecha de la apertura en
   Parámetros contables: 31/12/2025. Es anterior al inicio, así que la base la acepta.
2. Con el interruptor prendido, carga la apertura al 31/12/2025 desde la plantilla vacía. Al cierre del año lleva
   sólo cuentas de balance; el resultado de 2025 va en 300002. `post_apertura` crea los períodos de 2025. Probado:
   caso [2] de la verificación.
3. Enero, a mano en Asientos de Diario. Febrero a junio, por la importación de asientos (067). Funciona en meses
   anteriores al inicio: el respaldo de la 096 sólo frena asientos de DOCUMENTOS, y la 098 sólo frena importar en un
   mes contabilizado desde documentos (ninguno antes de julio). Tope: 200 asientos y 3.000 líneas por archivo, así
   que va un archivo por mes.
4. Desde julio, los documentos del CRM se contabilizan por mes con «Documentos existentes» (097 a 099). Como de
   enero a junio no hay posteo de documentos, la regla de un solo método no choca.
5. Los reportes (ER, balance, comprobación, Mayor) salen del libro: enero a junio con lo importado y julio en
   adelante con los documentos.

**Qué se pierde o hay que cuidar:**

- **Anexo de compras de la renta 2026:** se conserva **sólo si** cada línea de gasto importada lleva el
  proveedor como tercero (la importación lo permite en cualquier cuenta). Entonces el Mayor de la cuenta de gasto
  sale a Excel con RUC, DV y monto por proveedor (requerimiento 21). Si Josuarth importa totales por mes sin
  proveedor, el anexo de enero a junio no sale del CRM. Además, cada proveedor tiene que tener su ficha (PRV-)
  antes: no hay carga masiva de proveedores (chico, si hace falta).
- **Detalle por factura de enero a junio:** el CRM no tiene esos documentos, sólo asientos. En la antigüedad,
  una CxC de enero a junio aparece como partida del asiento (número AD-), no con el número de la factura. Mejora
  chica: mostrar la referencia externa del asiento en la antigüedad.
- **Los documentos del CRM anteriores a julio** (la factura real y los gastos de trámite) siguen «contabilizados
  fuera». Con la apertura vigente salen de la antigüedad: su saldo tiene que venir en lo importado, con tercero.
- **Resumen de ITBMS:** se arma con documentos, así que enero a junio no salen en el reporte del CRM. Ya están
  declarados, y el libro igual tiene las cuentas de ITBMS.
- **Cuadre al corte:** compara contra los documentos del CRM hasta el 31/12/2025, y no hay ninguno; para enero a
  junio no sirve. Mejora chica: un cuadre al 30/06/2026 (documentos del CRM anteriores al inicio contra el libro,
  por tercero).

### Camino B: inicio contable en 01/01/2026; enero a junio como documentos reales con carga masiva

**Qué habría que construir:**

1. **Mover el inicio hacia atrás.** El guard de la 096 lo rechaza: entre el 01/01 y el 01/07 hay documentos sin
   asiento que deberían tenerlo (los 67 gastos de trámite y la factura real). No hay llave en producción: la de
   la 096 sólo sirve para su pre-flight en staging. Hace falta una migración nueva (102) que permita moverlo con
   una confirmación explícita, más su verificación. Medio día a un día.
2. **Carga masiva de documentos** (requerimiento 22, grande): facturas de venta de enero a junio (ya autorizadas
   por la DGI en el portal: entrarían como emitidas fuera, FAC-EXT con CUFE, que hoy sólo se cargan de a una),
   compras, y también **cobros y pagos**. Sin los cobros, la CxC de junio quedaría inflada. Vista editable, validación
   y numeración. Entre 8 y 10 días.
3. **Contabilizar enero a junio** con la herramienta que ya existe (097 a 099), un mes por vez, después de
   completar proveedor, cuenta y banco con las asignaciones en lote.

**Qué pasa con lo que hay en producción antes de julio:**

- **Los 67 gastos de trámite:** dejan de estar «contabilizados fuera». Hay que asignarles proveedor y cuenta, y
  se contabilizan en su mes. Si en QuickBooks ya están dentro de los saldos al 31/12/2025 o de enero a junio, se
  contarían dos veces: hay que decidir cuáles entran.
- **La factura real anterior a julio:** se contabiliza en su mes.
- **Los 20 client_payments:** son del módulo Legal, nunca van al libro ni cuentan para el guard. No cambia nada.

**Tiempo:** unos 10 a 12 días de desarrollo más el ensayo, y el trabajo de Josuarth de preparar seis meses de
documentos. Lo de la ventana no cambia: el inicio se puede mover después de la ventana.

### Recomendación: camino A

- Funciona hoy, sin código ni migraciones nuevas, con la apertura al 31/12/2025 y la importación de asientos.
- Lo único importante que se perdería (el anexo de compras) se conserva si Josuarth importa las líneas de gasto
  con el proveedor. Es una instrucción para él, no un desarrollo.
- B cuesta dos o tres semanas para tener como documentos seis meses que ya están declarados y en QuickBooks, y
  abre el riesgo de contar dos veces los gastos de trámite.
- La carga masiva de facturas (22) igual conviene en el Bloque 2, pero para **julio en adelante**: le ahorra
  trabajo al contador con lo que sí se contabiliza desde el CRM.
- Mejoras chicas que hacen A más cómodo (Bloque 2, o antes si Josuarth empieza ya): la referencia externa en la
  antigüedad, el cuadre al 30/06 y la carga masiva de proveedores.
