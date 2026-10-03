# Propuesta: facturas emitidas que nunca llegaron a la DGI

> 03/10/2026 · **Solo propuesta, nada construido. Las 4 facturas de producción no se tocan.**
> Hallazgo: en producción hay 4 facturas en `emitida` sin autorización de la DGI (`fe_estado` `error` o
> `no_emitida`): FAC-HON-000489, 000496, 000503 y 000508. Nadie se enteró.
> Detalle: `sql/verificacion/produccion-facturas-no-enviadas-detalle.sql` (la corre Oliver).

## a. Por qué una factura puede quedar emitida sin enviarse

El flujo tiene **dos pasos separados**, y cualquiera de los dos puede quedar a medias sin que nadie se
entere:

| # | Cómo pasa | Dónde está en el código | `fe_estado` que queda | Quién se entera hoy |
|---|---|---|---|---|
| 1 | **Se emite y nadie aprieta «Enviar a la DGI».** «Emitir factura interna» (número + asiento + `emitida`) y «Enviar a la DGI» son dos botones distintos, en dos momentos. Nada recuerda el segundo. | `emit-invoice-dialog.tsx` → `POST …/emit`; después `efactura-card.tsx` → `POST …/emit-efactura` | `no_emitida`, sin intentos | Nadie |
| 2 | **El envío se corta ANTES de tomar número**: el gate fiscal del cliente (`validateClientFiscalGate`, RUC, DV, tipo), una factura con CUFE del portal, la ND sobre factura sin CUFE. Es un `MutationError` en T0, **sin escribir nada**. | `emitInvoiceToEfactura` T0 y `fetchInvoiceEfacturaBundle` | **`no_emitida`**, sin intentos | Solo un aviso en pantalla, una vez. Al recargar, la factura parece **nunca enviada**. Lo más probable para las que están en `no_emitida` |
| 3 | **El PAC rechaza** (`1601` RUC mal formado, `10105` descripción larga, `1705`…). | T3/T4 del orquestador; `classify-pac-error.ts` | `error`, con `cod_res` en `fe_emisiones` | El listado de facturas cuenta las `error` (SOP-041). **Solo si alguien entra a ese listado**: no hay aviso en el dashboard ni por correo, y nada obliga a reintentar |
| 4 | **Falla el transporte** (`fetch failed`, timeout): pasó el 03/10 en sandbox con la ND-000003. | T3, `transport/efactura-client.ts` | `error`, sin `cod_res` útil | Igual que 3 |
| 5 | **El mapper revienta** después de reservar el número (datos del cliente inconsistentes). | T2: atrapa, marca `error`, re-lanza | `error`, **sin fila en `fe_emisiones`** | Un aviso en pantalla; después, el `error` sin motivo |
| 6 | **Respuesta ambigua** (sin `autorizada` clara, 200 con lista vacía). | `parsePacResponse` → `indeterminada` | `pending` indefinido | Nadie; tampoco lo cuenta el listado |

**Lo común:** el estado queda guardado bien, pero **ninguna pantalla que se mira todos los días lo dice** y
nada pide terminarlo. El contador del listado mira solo `error`, no `no_emitida` ni `pending`.

## b. Lista «Facturas sin autorización de la DGI»

**Qué entra:**
- documentos con `status IN ('emitida', 'parcialmente_pagada', 'pagada')`, `fe_estado IN ('no_emitida',
  'error', 'pending')`;
- **sin** CUFE (si lo tiene, ya existe ante la DGI: es el caso B del portal y no es una alarma);
- **sin** `fe_estado = 'interna'` (se decidió no enviarla).

Vale igual para NC y ND.

**Columnas:**
- número (con enlace) y fecha del documento;
- **días desde la emisión** (el dato que importa, ver d);
- cliente y monto;
- estado en palabras:
  - «Nunca se envió»;
  - «Rechazada por la DGI»;
  - «Falló la conexión»;
  - «Sin respuesta clara»;
- **motivo del PAC**: el último `cod_res` en castellano, con la guía de `classify-pac-error` («revisa el RUC
  del cliente»). Si nunca se intentó: «No se envió»;
- intentos y último intento;
- **botón «Enviar / Reintentar»**, el mismo endpoint de hoy (`emit-efactura`, que ya reusa el correlativo
  en el reintento).

**Quién la ve:** admin y abogada (son los que pueden enviar) **y el contador en lectura**: sin el envío, la
factura no vale ante el fisco y él la tiene en el ITBMS.

**Dónde:**
- Pantalla `/finanzas/facturas/sin-dgi`, con el mismo filtro que el contador del listado de hoy, ampliado a los
  tres estados.
- Una tarjeta en el dashboard: «N documentos sin autorización de la DGI · el más viejo tiene X días». Solo se
  muestra si N > 0.

**Prevención, para que no se acumulen:**
1. **Emitir y enviar en un paso para la factura**, como ya se hizo hoy para la NC y la ND: «Enviar a la DGI»
   marcado por defecto e «Interna» a propósito. Esto elimina el caso 1 entero.
2. **Correr el gate fiscal ANTES de emitir.** Si el RUC del cliente no pasa, no se emite. Hoy se emite, se
   postea, y recién al enviar se descubre: caso 2.
3. Mostrar el motivo del último intento en el detalle (ya está para `error`: SOP-041) **y** para `no_emitida`
   cuando el corte fue en T0. Hoy ese motivo no se guarda: hace falta una columna o una fila en
   `fe_emisiones` con `intento = 0` y el mensaje del gate.

## c. ¿Dashboard o correo?

**Las dos, con roles distintos:**

- **Dashboard (siempre):** la tarjeta de b, para admin, abogada y contador. Es barata (una consulta
  contada), no molesta cuando está en cero y se ve donde ya se entra todos los días.
- **Correo (resumen diario, solo si hay algo):** a admin y al contador, una vez por día hábil.
  - Asunto: «N facturas sin autorización de la DGI».
  - Cuerpo: la lista con el motivo y el enlace a la pantalla. No se manda nada en cero.
  - Ya existe Resend (cotizaciones).
  - Hace falta un cron (Vercel Cron), que es una pieza nueva de infraestructura en la cuenta del cliente:
    **pausa obligatoria antes de configurarla**.
- **Correo inmediato** solo para el caso 6 (`pending` más de 1 hora): es el único que puede querer decir
  «la DGI la autorizó y no lo sabemos».

Recomendación: **primero la tarjeta y la pantalla** (sin infraestructura nueva), y el correo diario cuando se
confirme quién lo recibe.

## d. ¿Qué pasa si se reintenta semanas después?

Hoy el payload lleva como fecha de emisión **el momento del envío**, no la fecha de la factura:
`mapInvoiceToEfacturaRequest` usa `options.fechaEmision ?? new Date()` y el orquestador no se la pasa
(`map-invoice.ts:130`). Consecuencias de reintentar hoy una factura del 10/09:

1. **Ante la DGI la factura queda con fecha de hoy.** La DGI no la rechaza: la regla `1519` («fecha de
   emisión muy antigua», más de 30 días antes de la transmisión) ni siquiera aplica, porque la fecha es la del
   envío.
2. **La fecha fiscal y la del CRM no coinciden:**
   - el PDF y la ficha dicen 10/09; el CUFE y el portal, 03/10;
   - el libro y el resumen de ITBMS del CRM la cuentan **en septiembre** (`accounting_date`);
   - ante la DGI cae en **octubre**.

   Si cruza de mes, **el ITBMS se declara en un mes y el documento fiscal está en otro**. Es el riesgo real.
3. **Los plazos que cuentan desde la emisión se corren:**
   - las 182 h para anular ante la DGI: el CRM las cuenta desde `issue_date`, así que es conservador;
   - los 180 días de la NC/ND (`1714`), que la DGI cuenta desde la fecha de emisión de la factura (la de hoy).
4. **La alternativa** es mandar la fecha del documento (`issue_date`):
   - pasados 30 días la DGI responde `1519`, que según la ficha es **notificación, no rechazo** (falta
     probarlo en sandbox);
   - el documento fiscal tendría la fecha correcta, pero con un aviso de «muy antigua»;
   - con más de 2 días hábiles al futuro, rechazo (`1520`); no aplica acá.

**Propuesta:**
- **No cambiar nada sin probar.**
  1. Probar en sandbox una factura con `fechaEmision` de 45 días atrás y ver si autoriza con `1519` como
     observación.
  2. Si autoriza, mandar siempre `issue_date` (la fecha fiscal = la del documento = la del libro).
  3. Si no autoriza, el reintento después de cerrar el mes de la factura no debería ofrecerse: lo correcto es
     **anular la factura del CRM (o NC) y emitir una nueva con fecha de hoy**, para que ITBMS, libro y DGI
     caigan en el mismo mes.
- La decisión de qué hacer con las 4 de producción es de Josuarth, con estas dos opciones a la vista. **La
  pantalla de b muestra los días** justamente para eso.
- Mientras tanto, el botón de reintento de la pantalla debería advertir: «Esta factura es del 10/09: ante la
  DGI va a quedar con fecha de hoy (03/10) y su ITBMS está declarado en septiembre».

## Lo que haría falta construir (cuando se decida)

| Pieza | Tamaño | Migración |
|---|---|---|
| Pantalla «Sin DGI» + tarjeta del dashboard | S | No |
| Contador del listado ampliado a `no_emitida` y `pending` | XS | No |
| Guardar el motivo del corte en T0 (`fe_emisiones` con `intento = 0` o columna `fe_ultimo_motivo`) | S | Sí, una columna o relajar el CHECK de `intento` |
| Emitir y enviar en un paso para la factura | S | No (reusa `aplicarEnvioAlEmitir`) |
| Gate fiscal antes de emitir | XS | No |
| Correo diario | M | No, pero un cron nuevo en Vercel (pausa obligatoria) |
| Fecha de emisión = `issue_date` | XS en código; **cambia el payload congelado** (`payload-completo-esperado.json`) | No. El golden va en un commit aparte (SOP-039) |
