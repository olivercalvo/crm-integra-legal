# Propuesta: registrar en el CRM una factura emitida fuera

> 05/10/2026 · **Solo propuesta, nada construido, ninguna migración escrita.**
> Casos que la motivan (`cruce-facturador-2026-10-05.md` §4 y §5):
> - Las 3 del **punto 100** (portal directo) que no están en el CRM: MEI Tower 1C (100-2), MEI Tower 2B
>   (100-3) y Mi Condado (100-4, que reemplaza a FAC-HON-000467, anulada en el CRM).
> - Si Josuarth lo prefiere a su importación: los **7 de QuickBooks** del 01 al 03/07 (050-601 a 607).
>
> Objetivo: que entren en CxC, ventas, ITBMS y el libro **sin mandarlas al PAC y sin gastar correlativo
> del 051**.

## 1. Lo que existe hoy (caso B, 9C)

Hay un camino armado para **cargar el CUFE de una factura que ya está en el CRM**:

1. La factura existe en el CRM como borrador y se **emite** (`POST …/invoices/[id]/emit` → `emitInvoice`):
   toma el número de `numbering_sequences` (`FAC-HON-`/`FAC-REI-`), postea el asiento con su fecha de
   registro y queda `emitida` con `fe_estado = 'no_emitida'`.
2. Desde la tarjeta «CUFE del portal» (`cufe-del-portal-card.tsx`) se pega el CUFE:
   `POST …/invoices/[id]/cufe` → `registrarCufeDelPortal` valida la forma (`validarCufe`) y escribe
   `dgi_cufe` + `dgi_cufe_origen = 'portal_050'`. **No toca `fe_estado`.** Admin y abogada.

Lo que ya hace bien, y conviene reusar:

| Qué | Cómo |
|---|---|
| **No gasta correlativo del 051** | El 051 sólo lo toma `allocateFeNumero`, que sólo llaman `emit-invoice-to-efactura` y `emit-credit-note-to-efactura`. Emitir no lo toca. |
| **No va al PAC después** | `emitInvoiceToEfactura` responde 409 si `dgi_cufe_origen` no es `crm` (25/09). |
| **Sale de «Pendientes DGI»** | `queries/pendientes-dgi.ts` filtra `dgi_cufe IS NULL`. |
| **Entra en ventas, CxC e ITBMS** | Es una factura `emitida` con asiento: el Estado de Resultado lee el libro, la antigüedad lee `balance_due` y el ITBMS (`vat-calculo.ts`) cuenta toda factura emitida no anulada **sin exigir** `fe_estado = 'authorized'`. |
| **Se puede acreditar** | Con el CUFE cargado, una NC 04 la referencia (caso B). |

## 2. Por qué no alcanza para estas facturas

1. **La ventana entre emitir y pegar el CUFE.** Durante ese rato la factura es una «no enviada» más: aparece
   en Pendientes DGI y en el aviso del listado, y **el botón «Enviar a la DGI» está a la vista**. Si alguien
   lo aprieta, se toma un número del 051 y nace **un segundo documento fiscal por la misma venta**. Es el
   riesgo más grave, y hoy depende de que nadie se equivoque.
2. **`validarParaLaDgi` corre al emitir** («la factura siempre»). Para un documento que la DGI **ya
   autorizó**, revalidar el RUC con nuestras reglas puede bloquear el registro de algo que es un hecho.
3. **El origen dice `portal_050`**, que para el punto 100 es falso, y para el 050 es dudoso: el 050 es
   **QuickBooks** (corrección del 05/10; la 061 lo llamó «portal de ideati»). Dentro de seis meses no se
   va a saber de dónde salió cada CUFE.
4. **La identidad fiscal no se guarda.** `invoices.punto_facturacion` y `numero_documento` existen (019)
   pero el caso B no los llena: no se puede cruzar «100-2» contra el CRM sin abrir el CUFE.
5. **Gasta un número `FAC-HON-`/`FAC-REI-`.** No es del 051, pero hoy esa serie es **«lo que emitió el
   CRM»** y cruza 1 a 1 con el 051 (salvo los huecos). Meterle facturas de otro punto rompe ese cruce.
6. **Nada verifica que el CUFE sea de ESTA factura.** El CUFE trae adentro el tipo de documento, la fecha,
   el número y el punto (comprobado en el archivo: `…2026071400000000021000…` = 14/07, n.º 2, punto 100).
   Hoy sólo se valida la forma.
7. **No hay índice único sobre `dgi_cufe`.** El mismo CUFE se podría cargar en dos facturas.

## 3. Propuesta: «Registrar factura emitida fuera»

Una acción nueva que crea la factura **ya emitida y ya con su CUFE, en un solo paso**. Reusa el formulario,
el constructor del asiento y todo lo de abajo. Lo que cambia es la entrada y el número.

### 3.1 Pantalla

En `/finanzas/facturas/nueva`, una opción aparte (no un tilde dentro del alta normal): **«Registrar factura
emitida fuera del CRM»**. Mismo formulario de factura (cliente, tipo HON/REI, líneas con servicio, monto y
tasa) más:

- **Origen**, obligatorio: «QuickBooks (punto 050)» · «Portal de facturación (punto 100)».
- **CUFE**, obligatorio. Al pegarlo, la pantalla lee del CUFE el tipo, la fecha, el punto y el número y los
  muestra para confirmar: «Factura 01 · 14/07/2026 · punto 100 · n.º 2».
- **Fecha del documento** = la del CUFE (precargada, no editable).
- **Fecha de registro**: por defecto la del documento; ver §4.
- **Nota** opcional («Reemplaza a FAC-HON-000467»).
- Aviso fijo antes de guardar: «Esta factura ya está autorizada por la DGI. El CRM la registra en sus libros
  y **no la envía**».

### 3.2 Servidor, en este orden y antes de tomar número

1. `validarCufe` (forma) + **lectura del CUFE**: tipo `01`/`09` coincide con `invoice_kind` (HON/REI), fecha
   = fecha del documento, **punto distinto de `051`** («las del 051 las emitió el CRM: búsquela en el
   listado») y punto = el del origen elegido.
2. **El CUFE no existe** en ninguna factura ni NC del bufete (409 con el número de la que ya lo tiene).
3. Período de la fecha de registro abierto (`resolverFechaDeRegistro`, la regla de siempre).
4. Cuentas del asiento válidas (la validación previa de `emitInvoice` del 25/09).
5. **No** se corre `validarParaLaDgi`: se reemplaza por **avisos** que no bloquean (RUC o DV del cliente que
   no coinciden con la forma esperada). El documento ya existe ante la DGI.

### 3.3 Escritura

- **Número propio: serie `FAC-EXT-`** (una secuencia nueva en `numbering_sequences`), no `FAC-HON-` ni
  `FAC-REI-`. El 051 no se toca. `FAC-HON-` sigue cruzando 1 a 1 con el 051.
  - Alternativa más barata: seguir con `FAC-HON-`/`FAC-REI-` y aceptar que la serie mezcle orígenes.
    No la recomiendo por el punto 5 de §2.
- La factura nace `emitida`, con `dgi_cufe`, `dgi_cufe_origen = 'externo'`, `punto_facturacion` (`100` o
  `050`) y `numero_documento` (el del CUFE). `fe_estado` queda `no_emitida` como en el caso B: este sistema
  no la autorizó y no se dice que sí.
- **Asiento**: el mismo de una factura (`construirAsientoDeFactura`, `source_type = 'factura'`), cliente en
  la línea de 100004 y `referencia_externa` = «100-2» (el número fiscal de afuera, E3). Número del asiento =
  número de la factura, como en `emitInvoice`.
- Factura, CUFE y asiento en **una sola transacción**, para que no exista nunca la ventana del punto 1 de §2.
  Si el asiento falla, no queda nada (ni hueco en `FAC-EXT-`, si el número se toma adentro del RPC como el
  `AD-`).

### 3.4 Después

Igual que cualquier factura: cobros, antigüedad, NC (04 con el CUFE, desde el 051: en el sandbox una NC de un
punto autorizó referenciando una factura de otro, `prueba9c-s5-s8.txt`, S8) y anulación **sólo en el libro**. La pantalla nunca ofrece «Enviar a la DGI» ni
«Anular ante la DGI»: eso se hace en el sistema que la emitió.

### 3.5 Migración que haría falta (no escrita)

- CHECK de `dgi_cufe_origen` (061/064): sumar `'externo'`. `'portal_050'` se queda para lo ya cargado.
- Índice único parcial `(tenant_id, dgi_cufe) WHERE dgi_cufe IS NOT NULL` en `invoices` y en
  `credit_notes`. Pre-flight antes: contar duplicados en staging y producción.
- Fila de secuencia `FAC-EXT-` por bufete, si se elige la serie propia.
- Si el alta va por RPC (recomendado, por §3.3): la función, con `service_role` y el `tenant_id` del perfil.

## 4. La fecha de registro: la decisión que importa

El ITBMS del CRM cuenta cada documento en el mes de su **fecha de registro** (P-1a). La DGI lo tiene en el mes
de su fecha de documento. Para que coincidan, **la fecha de registro tiene que ser la del documento** (julio
y agosto).

- Si julio o agosto están **abiertos** en el CRM: se registran en su mes. Es lo correcto.
- Si están **cerrados**: hay dos salidas y la decide Josuarth:
  1. reabrir el mes, registrar y volver a cerrar (el ancla de la 075 queda registrada en cada cierre);
  2. registrar con fecha de hoy, sabiendo que el resumen de ITBMS del CRM no va a coincidir con lo declarado
     para ese mes.
- Nunca una fecha de registro futura (K-5).

## 5. Los 7 de QuickBooks (050-601 a 607)

Caen después de la fecha B (01/07), así que el CRM tiene que tenerlos de una forma u otra. Hay dos caminos
y hay que elegir **uno para los siete**; mezclarlos cuenta dos veces:

| | Por la importación de Josuarth | Por el CRM (esta propuesta) |
|---|---|---|
| Qué entra | Asientos de julio con el cliente en 100004 | Siete facturas `FAC-EXT-` con su asiento |
| CxC | Sí (E9: línea manual con tercero = partida) | Sí, por documento con vencimiento |
| Cobros | Se aplican contra el saldo del tercero, sin documento | Se aplican a cada factura en el CRM |
| ITBMS del CRM | **No** (el resumen lee documentos, no asientos manuales) | Sí, en julio |
| NC futura | Sin documento de la factura en el CRM | NC 04 con el CUFE |

Recomendación: **por el CRM**, si los cobros de esas facturas se van a registrar en el CRM. Si Josuarth ya los
cobró y concilió en QuickBooks, la importación es más simple. Pregunta para él: J-2, con los 7 en la mano.

## 6. Plan para las tres del punto 100, cuando exista

1. Verificar en el CRM de producción (solo lectura, la corre Oliver) que no exista ya una factura con alguno
   de los tres CUFE ni con el mismo cliente, fecha y monto.
2. Confirmar con Josuarth la fecha de registro (§4) y que FAC-HON-000467 quede como está (anulada) y la 100-4
   la reemplace.
3. Registrarlas desde la pantalla, una por una, con el CUFE del archivo.
4. Comprobar: CxC del cliente, ventas de julio/agosto, ITBMS de julio (+21.00: 10.50 + 10.50) y de agosto
   (+24.50), y que no aparezcan en Pendientes DGI.

## 7. Mientras no exista: lo que se puede hacer hoy y su riesgo

Se puede usar el caso B tal como está (crear → emitir interna → pegar el CUFE enseguida). Funciona para CxC,
ventas, ITBMS y libro, y no toca el 051. Los riesgos: la ventana del punto 1 de §2 (que alguien apriete
«Enviar a la DGI» antes de pegar el CUFE), el origen mal rotulado (`portal_050`), gastar números `FAC-HON-` y
que `validarParaLaDgi` bloquee el alta. Si se elige este camino: lo hace **una sola persona**, con la
factura abierta, y pega el CUFE antes de salir de la pantalla.

## 8. Preguntas abiertas

- Josuarth: ¿julio y agosto están abiertos o cerrados en el CRM de producción? (§4)
- Josuarth: los 7 de QuickBooks, ¿importación o CRM? (§5)
- Oliver: ¿serie propia `FAC-EXT-` o seguir con `FAC-HON-`/`FAC-REI-`? (§3.3)
- Oliver: ¿el contador también puede registrar una factura de afuera? Hoy el caso B es admin y abogada, y el
  contador no crea facturas.
