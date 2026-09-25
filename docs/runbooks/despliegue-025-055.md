# Runbook del despliegue 025 → 055

**Qué es:** la corrida completa de las **42** migraciones contables pendientes a
la base de producción, más el merge de `develop` a `main`:
**`025` a `055`, `057` y `058` a `067`** — toda la cola que existe hoy en `develop`.

> ⚠️ **El nombre del archivo dice `025-055` y ya se quedó corto.** El 23/09/2026
> se sumó la **`057`** (Bloque 8), y el 23–25/09 las **`058` a `064`** (Bloques
> 9B y 9C, y la corrección de la `061`). No se renombró a propósito: renombrarlo
> rompe los enlaces que ya apuntan acá desde `changelog.md`, `task_plan.md`, el
> inventario y la versión en página. Renombrarlo es una decisión de Oliver.
>
> 🔒 **La `056` está RESERVADA** para la corrección de la fecha de los saldos
> iniciales (§P-2(b)), que depende de la respuesta de Josuarth / RM. Es un
> **hueco a propósito**, no un olvido: si RM contesta después del despliegue, la
> `056` se aplica sola más adelante; nada de la cola la necesita antes.
>
> 🆕 **La `066` (NC de compra) y la `067` (importar asientos), 25/09/2026, noche.**
> La `066` toca `business_expenses` (saldo derivado, guard, recálculo de la `048`):
> va en el Bloque B después de la `050`. La `067` es aditiva y va al final del A.
>
> 🆕 **La `065` (25/09/2026, tarde):** `fe_anulaciones.credit_note_id`. Una NC autorizada
> se anula ahora ante la DGI antes de reversarse en el libro, y cada intento queda
> registrado. Aditiva, va en el Bloque A después de la `059`.
>
> 🆕 **La `064` no estaba en el pedido y se agregó el 25/09/2026.** El CHECK de
> la `061` deja pasar un origen NULL (`NULL IN (…)` es NULL, y un CHECK NULL se
> acepta), y el código de emisión no escribía el origen. Detalle en §3b.
>
> 📖 **Si vas a leer una sola sección, que sea §0b «El día D en una página».**
> Tiene el orden completo con el respaldo al principio; el resto del archivo es
> el detalle de cada paso.

**Versión en página:** https://claude.ai/artifact/RnL36m1tJEk5hhAJZ4moQG
(checklists marcables, botones de copiar y un cronómetro de la ventana).
**Este archivo es el respaldo.** Mismos pasos, mismo SQL, para imprimir o abrir
en el editor. Si la página no carga o el estado guardado se pierde, se opera
desde acá y no pasa nada.

- **Estado de producción:** relevado el 2026-09-22 por pre-flight de solo lectura.
- **Dónde se detuvo:** entre la `024` y la `025`. Marcador decisivo:
  `chart_of_accounts.cuenta_control` no existe.
- **Duración estimada:** ~3 h 45 m de punta a punta (la `057` son dos minutos:
  cuatro columnas nullable sobre una tabla vacía; las `058`–`064` suman unos
  20 minutos, casi todo leyendo NOTICEs: tocan como mucho las 102 facturas).
- 🔴 **Las `058`–`064` NO se midieron en el relevamiento del 22/09.** Las
  consultas que faltan están en §1b (P-11 a P-14) y se corren el día −2 junto
  con las demás. El archivo `claude/preflight-produccion-2026-09-22.md` que se
  menciona en algunos pedidos **no existe en el repo**: los números del 22/09
  viven solo en la tabla de abajo.

---

## Los números reales de producción (2026-09-22)

Esto cambia el plan, así que va primero:

| Tabla | Filas | Consecuencia |
|---|---:|---|
| `business_expenses` | **0** | 🔴 **El módulo de compras nunca se usó.** Cuatro backfills corren sobre cero filas |
| `expenses` (gastos de trámite) | 137 | El backfill de la `036` es el único que mueve volumen |
| `payments` | 8 | La `047` numera ocho recibos |
| `invoices` | 102 | La `051` reescribe esta tabla |
| `credit_notes` | 6 | La `051` recalcula `credited_total` en seis |
| `clients` | 146 | La FK de la `054` no bloquea nada: el libro está vacío |
| `chart_of_accounts` | **97** | 🔴 No 62. Los «esperado» del POST-CHECK de la `025` son de staging |
| `journal_entries` | 0 | El motor entra en una base limpia |
| `tenants` | 1 · `a0000000-…-001` | ✅ Coincide con el uuid hardcodeado en seis migraciones |

### Qué se cayó del plan con `business_expenses = 0`

- **P-5 (proveedores) desaparece.** La `033` no tiene de dónde sacar un
  `supplier_name`: crea cero proveedores. Sin nombres sucios, sin duplicados que
  fusionar, sin riesgo de abortar por el largo del nombre o del RUC.
- **P-7 quedó respondido en su mitad de compras: cero.** El guard de la `040`
  no puede dispararse. La pregunta abierta de D4 está cerrada.
- **La `045` no backfillea nada:** su backfill es solo sobre líneas de compra.
- **La `048` crea cero saldos heredados.**
- **El rollback de compras se reduce.** Los pasos 1 y 2 (la foto y devolver la
  cuenta al encabezado) ya no tienen datos que restaurar. Lo único que sigue
  haciendo falta son los `DROP TRIGGER` y soltar el CHECK de la `040`, porque lo
  que rompe el código viejo es el **guard**, no el dato. Ver §8.

**Lo que NO cambió:** la `025` sigue siendo exactamente igual de peligrosa. Las
97 cuentas del plan son reales y el Estado de Resultado es el reporte que firma
el contador.

---

## Los dos peligros que casi se pasan

**1 · La `025` no falla, miente.**
Termina con `NOTICE … OK` y a partir de ese segundo el Estado de Resultado de
producción está mal: las cuentas de costo pasan a `account_type = 'cost'` y el
filtro de `src/lib/finanzas/reports/accounting-reports.ts:268`
(`accounts.filter(a => a.account_type === "expense")`) las deja fuera del
reporte. No hay error, no hay log, no hay alerta: la utilidad sube sola.
Por eso la `025` va **última de todo**, pegada al merge.
Ventana esperada: **15–20 min**.

**2 · El uuid del tenant está hardcodeado en seis migraciones**
(`025`, `026`, `027`, `028`, `030`, `035`). Si producción no fuera
`a0000000-0000-0000-0000-000000000001`, esas seis correrían sin error y **no
harían nada**. ✅ Verificado el 2026-09-22: coincide. Se vuelve a confirmar en
P-0 el día del despliegue, porque cuesta diez segundos.

**3 · 🆕 La `061` + `064` rompen la emisión de `main` — van en la VENTANA.**
Con el CHECK de la `064` puesto, toda factura con CUFE tiene que tener origen.
El código de `main` (`24b227a`) no conoce la columna: cuando el PAC autoriza,
su `UPDATE invoices SET dgi_cufe = …` **falla**. El orden de `main` es PAC
primero, base después, así que el resultado es **una factura autorizada ante la
DGI con el CUFE perdido en nuestra base** — lo peor que puede pasar con un
documento fiscal. Por eso las dos van en el Bloque B, pegadas al merge, y
**desde la `061` hasta que el deploy esté arriba nadie emite ni anula**.

**4 · 🆕 La `058` rompe la anulación de `main` — también va en la VENTANA.**
`main` acepta motivos de 3 caracteres; la `058` exige 15 en la base. Una
anulación con 3–14 caracteres desde `main` falla en el `UPDATE` de la factura
**después** de haber creado la NC total (en `main` no es una transacción): queda
una NC suelta y la factura sin anular.

**5 · Lo del PAC se prueba en Preview o en `localhost`, nunca en producción
antes del merge.** Desde el 25/09 Preview tiene las variables del sandbox (§9).

---

## 0b · El día D en una página

Orden completo. Cada paso tiene su detalle más abajo; acá está la secuencia y
los puntos donde **se para**.

| # | Paso | Dónde | Para si… |
|---|---|---|---|
| −2 | Pre-flight P-1 a P-16 (§1 y §1b), solo SELECT | SQL Editor de prod | cualquier «Parar si» |
| −2 | Josuarth elige la cuenta de los servicios de P-15 | correo | si no decide: esos servicios quedan sin facturar |
| −2 | Respuestas por escrito de RM: P-1(b) y P-2 | correo | alguna sigue abierta → **no hay día D** |
| −1 | `develop` verde: `tsc`, `npm test`, lint contra la lista base, `npm run build` | máquina | algo en rojo |
| −1 | Avisar al bufete la ventana (hora de inicio y fin, qué no se puede hacer) | — | — |
| D·0 | P-0: uuid del tenant | SQL Editor | no coincide |
| D·1 | 🔴 **Respaldo** (§2), y abrirlo para comprobar que se lee | panel de Supabase | no se puede leer → **se termina el día acá** |
| D·2 | Bloque A, 29 migraciones con la app arriba (§3) | SQL Editor | cualquier `EXCEPTION` |
| D·3 | `NOTIFY pgrst, 'reload schema'` + verificación del Bloque A (§4, §10.2) | app de prod + SQL | algo distinto de lo anotado |
| D·4 | **Congelar**: nadie emite, anula ni cobra | aviso | — |
| D·5 | Bloque B — 12 migraciones (§5), con la `025` al final | SQL Editor | cualquier `EXCEPTION`, o la `025` no coincide con P-1(e) |
| D·6 | Merge `develop` → `main`, con aprobación explícita de Oliver | GitHub | — |
| D·7 | Deploy arriba → verificación post-deploy (§6, §10.3) | app de prod + SQL | la utilidad no coincide con D·3 |
| D·8 | Descongelar, anotar en `changelog.md`, regenerar inventario (§7) | — | — |

**Rollback:** hasta D·5 cada migración aborta sola si algo no cuadra y deja la
base como estaba. Desde que el motor entra en línea (`028`/`030`) cualquier
asiento es inmutable, así que **el rollback real es el respaldo de D·1**. Los
parches parciales están en §8.

**Riesgos del día, en orden de gravedad:**

1. 🔴 **Emitir o anular entre la `061`/`058` y el deploy** (peligros 3 y 4).
   Mitigación: congelamiento de D·4, y que el Bloque B sea corto.
2. 🔴 **La `025` no falla, miente** (peligro 1). Mitigación: P-1(e) y la foto.
3. 🟡 **La `058` aborta** si producción tiene alguna anulación con un motivo de
   menos de 15 caracteres (P-11). No es un error de la migración: es un dato que
   decide una persona. Si P-11 da > 0, se decide **antes** del día D.
4. 🟡 **La `060` falla** si alguna NC tiene un `status` que no sea `emitida` o
   `anulada` (P-13).
5. 🟡 **La `064` aborta** si hay un CUFE sin origen demostrable (P-14). Con el
   orden `061` → `064` sin nada en el medio, no puede pasar; se mide igual.
6. 🟢 La `059`, `062` y `063` son aditivas o reemplazan funciones que `main` no
   llama: si fallan, fallan antes de escribir y la app sigue igual.

---

## 0 · El chequeo que va antes del backup

```sql
SELECT id, name FROM public.tenants;
```

- [ ] **P-0** · uuid de Integra Legal: `________________________`
- [ ] Coincide con `a0000000-0000-0000-0000-000000000001`: **SI / NO**
- [ ] Cantidad de tenants: `____` (esperado: 1)

> **Parar si:** el uuid no coincide, o hay más de un tenant. No es «editar seis
> archivos y seguir»: hay que reescribirlos, reprobarlos contra staging y rehacer
> la verificación.

---

## 1 · Pre-flight de datos — solo SELECT

Se corre **el día −2**, no el día del despliegue. Acá es donde va el tiempo de
pensar; el día D solo se comparan números.

> 🔴 **Dos de estas no las decide el desarrollo.**
> **P‑1(b)** (en qué actividad NIIF 18 cae cada cuenta de resultado sin clasificar)
> y **P‑2** (a qué fecha corresponden los saldos iniciales) son **decisiones
> contables de RM Consultores**. El pre-flight las *consulta*; no las resuelve.
> Las dos tienen que estar respondidas **antes del día D, por escrito**. Si llega
> el día y alguna sigue abierta, **no se corre el despliegue**: la 025 y la 027
> escriben esas decisiones en la base, y después se corrigen editando filas que ya
> alimentaron un reporte.

### P-1 · Qué reclasifica la `025`  ·  🟡 (b) DECIDE RM

```sql
-- (a) las que pasan a 'cost' y desaparecen del P&L de main
SELECT code, name, account_type, subcategoria, active
  FROM public.chart_of_accounts
 WHERE account_type = 'expense' AND subcategoria = 'costo'
 ORDER BY code;

-- (b) las de resultado activas sin subcategoría NIIF 18 válida
SELECT code, name, account_type, subcategoria
  FROM public.chart_of_accounts
 WHERE active AND account_type IN ('income','cost','expense')
   AND (subcategoria IS NULL
        OR subcategoria NOT IN ('ingresos_operativos','ingresos_inversion',
             'ingresos_financiamiento','costos_operativos','costos_inversion',
             'costos_financiamiento','gastos_operativos','gastos_inversion',
             'gastos_financiamiento'))
 ORDER BY account_type, code;

-- (c) las dos cuentas control + (d) colisión de las que inserta
SELECT code, name FROM public.chart_of_accounts
 WHERE code IN ('100004','200001','200004','300004') ORDER BY code;
```

- [ ] (a) pasan a `cost`: `____`  → **guardar esta salida: es el undo de la `025`**
- [ ] (b) sin clasificar: `____`
- [ ] (c) `100004` y `200001` existen: `____`
- [ ] (d) `200004` / `300004` ya existen: `____`

> **Parar si:** en (b) aparece una cuenta que no debería ser operativa (de
> inversión o de financiamiento). La `025` la va a clasificar mal en silencio.
>
> ⚠️ Con 97 cuentas, (b) puede devolver varias decenas de filas.
>
> 🟡 **REQUIERE DECISIÓN DE RM CONSULTORES ANTES DEL DÍA D.**
> La 025 clasifica **toda** cuenta de resultado activa sin subcategoría válida como
> **operativa** de su tipo. Es el default correcto —hoy todo lo que existe es
> operativo— pero es un supuesto, no un dato: las otras seis actividades NIIF 18
> (inversión y financiamiento) quedan disponibles y nadie dijo que ninguna cuenta
> caiga ahí.
>
> **Lo que hay que preguntarle a RM:** ejecutar
> **`sql/verificacion/cuentas_para_rm_niif18.sql`** —no la (b) cruda, que cuenta de
> más porque incluye las que los pasos C y D mapean solos— pegar el resultado en
> Excel y mandárselo al contador. Trae tres columnas vacías para que marque cuenta
> por cuenta si el default es correcto. Si devuelve cero filas, no hay nada que
> preguntar y el punto queda cerrado.
> Es el criterio de la guía de RM —«quien modifica la clasificación contable de una
> cuenta debe ser el contador»— y es la misma razón por la que en la app la abogada
> no puede tocar `account_type`.
>
> **Si una cae fuera de operativa:** se corrige **antes** de correr la 025, con un
> UPDATE puntual de `subcategoria`. Después también se puede, pero ya habrá salido
> en un Estado de Resultado.
>
> - [ ] Fecha en que RM respondió: `__________`
> - [ ] Cuentas que RM movió de operativa: `________________________`

### P-1(e) · 🔴 Los «esperado» del POST-CHECK, calculados contra PRODUCCIÓN

El POST-CHECK de la `025` imprime `esperado 6 / 9 / 30 / 6`. **Esos números son
de staging**, que tiene otro plan de cuentas. Esta consulta simula los tres
UPDATE de la migración y calcula los cuatro números que producción va a imprimir
de verdad. Se corre **antes**, y el día D se compara contra esto y no contra el
texto de la migración.

```sql
WITH simulado AS (
  SELECT code, active,
         CASE WHEN account_type = 'expense' AND subcategoria = 'costo'
              THEN 'cost' ELSE account_type END AS at,
         CASE
           WHEN account_type = 'expense' AND subcategoria = 'costo'           THEN 'costos_operativos'
           WHEN account_type = 'income'  AND subcategoria = 'ingreso'         THEN 'ingresos_operativos'
           WHEN account_type = 'expense' AND subcategoria = 'gasto_operativo' THEN 'gastos_operativos'
           ELSE subcategoria
         END AS sub
    FROM public.chart_of_accounts
   WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
),
con_fbis AS (
  SELECT at,
         CASE WHEN active AND at IN ('income','cost','expense')
                   AND (sub IS NULL OR NOT (
                        (at = 'income'  AND sub IN ('ingresos_operativos','ingresos_inversion','ingresos_financiamiento'))
                     OR (at = 'cost'    AND sub IN ('costos_operativos','costos_inversion','costos_financiamiento'))
                     OR (at = 'expense' AND sub IN ('gastos_operativos','gastos_inversion','gastos_financiamiento'))))
              THEN CASE at WHEN 'income'  THEN 'ingresos_operativos'
                           WHEN 'cost'    THEN 'costos_operativos'
                           WHEN 'expense' THEN 'gastos_operativos' END
              ELSE sub END AS sub
    FROM simulado
)
SELECT count(*) FILTER (WHERE at  = 'cost')                 AS esperado_cost,
       count(*) FILTER (WHERE sub = 'ingresos_operativos')  AS esperado_ing_op,
       count(*) FILTER (WHERE sub = 'gastos_operativos')    AS esperado_gas_op,
       count(*) FILTER (WHERE sub = 'costos_operativos')    AS esperado_cos_op
  FROM con_fbis;
```

- [ ] `esperado_cost` = `____`
- [ ] `esperado_ing_op` = `____`
- [ ] `esperado_gas_op` = `____`
- [ ] `esperado_cos_op` = `____`

> **Estos cuatro números son la referencia.** Si el NOTICE de la `025` no coincide
> con el texto de la migración (`6 / 9 / 30 / 6`), **eso no es motivo de parar**:
> son los de staging. Si no coincide con **estos cuatro**, ahí sí se para.

### P-2 · La fecha de los saldos iniciales (`027`)  ·  🟡 DECIDE RM

```sql
SELECT count(*) AS con_saldo, min(saldo_inicial) AS menor,
       max(saldo_inicial) AS mayor, sum(saldo_inicial) AS suma
  FROM public.chart_of_accounts WHERE saldo_inicial <> 0;
```

- [ ] cuentas con saldo: `____`
- [ ] ¿`2026-01-01` es la fecha de corte correcta? **SI / la correcta es `________`**

> 🟡 **REQUIERE DECISIÓN DE RM CONSULTORES ANTES DEL DÍA D.**
>
> 🔴 **En la reunión del 09/09 se habló de cortar el balance al 30 de junio de
> 2026, no al 1 de enero.** Eso todavía no está confirmado por escrito, y es
> exactamente lo que la `027` necesita saber.
>
> **Y la propia migración ya lo había detectado.** Su encabezado dice, textual:
> *«es una FOTO DE MITAD DE AÑO, no una apertura»*, y sobre el backfill:
> *«2026-01-01 … es la ÚNICA fecha que el cliente especificó — se carga como tal,
> no como una fecha de corte verificada, y queda sujeta a la consulta de arriba»*.
> La evidencia que da: los saldos suman cero pero repartidos en balance
> `244.476,91` contra resultado `−244.476,91`, con **patrimonio en cero**. Una
> apertura al 1 de enero tendría las de resultado en 0 y el patrimonio cuadrando;
> lo que hay es el movimiento de enero a agosto.
>
> **Lo que hay que preguntarle a RM:** la fecha de corte de los saldos cargados,
> por escrito.
>
> - [ ] Fecha de corte que confirmó RM: `__________`
> - [ ] Fecha en que respondieron: `__________`

> **Parar si:** la fecha sigue sin confirmarse el día D. No se corre la `027` con
> una fecha que sabemos que probablemente es la equivocada: el asiento de apertura
> de la Fase 2 agrupa las cuentas **por esta columna**, y un asiento del libro es
> inmutable.

### P-2(b) · Cómo se corrige la fecha — no es un parámetro

La `027` es un `.sql` que se pega en el SQL Editor: **no admite parámetros**. El
`DATE '2026-01-01'` es un literal dentro del `UPDATE`. Tres caminos, no equivalentes:

| | Camino | Problema |
|---|---|---|
| **A** | Editar el literal de la `027` | La `027` **ya corrió en staging** con 2026-01-01, y su `UPDATE` filtra por `IS NULL`: re-correr el archivo editado no cambia nada allá. Staging y producción quedan con fechas distintas y el archivo deja de describir lo que pasó |
| **B** | Volverlo un GUC: `COALESCE(current_setting('finanzas.saldo_inicial_fecha', true)::date, DATE '2026-01-01')` | Hay que editar la migración igual, y agrega una palanca que se puede olvidar de setear — con un default silencioso que es justamente la fecha equivocada |
| **C** | **Dejar la `027` intacta y agregar una `056`** que haga el `UPDATE` a la fecha confirmada | Producción tiene la fecha vieja entre dos migraciones de la misma corrida. Nada la lee todavía |

**Recomendado: C.** La `027` queda byte a byte igual a lo que corrió en staging; la
decisión de RM entra con su propia migración, con el acta del 09/09 en el encabezado
y auditable; y la misma `056` corrige staging, que hoy también tiene la fecha
equivocada. El riesgo es nulo porque **nadie lee `saldo_inicial_fecha` todavía**: el
asiento de apertura es de la Fase 2 y no existe.

⚠️ **La `056` se escribe cuando RM confirme, no antes.** Con una fecha puesta «a ver
si es esa», el problema es el mismo que hoy.

### P-3 · Que el motor no pise nada (`028` / `030`)

```sql
SELECT (SELECT count(*) FROM public.journal_entries)     AS asientos,
       (SELECT count(*) FROM public.journal_entry_lines) AS lineas,
       (SELECT count(*) FROM public.accounting_periods)  AS periodos,
       (SELECT count(*) FROM public.accounting_sequences
         WHERE sequence_type = 'journal_entry')          AS seq;
```

- [ ] `0 / 0 / 0 / 0` → confirmado el 2026-09-22 (`journal_entries = 0`)

> **Parar si:** cualquier valor distinto de 0. Los asientos son inmutables: si
> algo escribió en el libro sin que lo supiéramos, se investiga antes de agregar
> uno más.

### P-4 · El bucket y sus políticas (`031`)

```sql
SELECT id, public FROM storage.buckets WHERE id = 'documents';

SELECT policyname, cmd FROM pg_policies
 WHERE schemaname = 'storage' AND tablename = 'objects'
 ORDER BY policyname;
```

- [ ] `public` = `______`
- [ ] políticas tenant-scoped presentes: **SI / NO**
- [ ] ¿quedó alguna de las abiertas (`storage_rls_policies.sql`)? **SI / NO**

> **No es motivo de parar.** `main` no usa `getPublicUrl` en ningún archivo
> (verificado); las descargas van por `createSignedUrl`. Cerrar el bucket no
> rompe nada del código que está corriendo.

### P-5 · Proveedores (`033`) — **vacío, confirmar y seguir**

```sql
SELECT count(*) AS compras FROM public.business_expenses;
```

- [ ] compras: `____` (esperado **0**)

> Con 0, la `033` crea cero proveedores y todo el bloque de riesgo de este
> pre-flight desaparece. **Si devuelve algo distinto de 0**, alguien empezó a
> usar el módulo entre el relevamiento y hoy: volver al pre-flight completo de
> proveedores (nombres duplicados, largo del nombre, largo del RUC) antes de
> seguir.

### P-6 · Las cuentas que la `035` y la `043` necesitan

```sql
-- 035 — 130003 NO la crea ninguna migración: en staging la siembra el seed
SELECT code, name, account_type, subcategoria, active
  FROM public.chart_of_accounts WHERE code IN ('130003','2201');

-- 043 — las cinco tienen que existir, estar ACTIVAS y ser income
SELECT code, name, account_type, active
  FROM public.chart_of_accounts
 WHERE code IN ('400001','400003','400004','400005','400007')
 ORDER BY code;

SELECT code, name, service_type, revenue_account
  FROM public.services_catalog
 WHERE code LIKE 'REIM%' OR code LIKE 'HON-%' ORDER BY code;
```

- [ ] `130003` existe: **SI / NO**
- [ ] las 5 de la `043`, activas y `income`: `____ de 5`
- [ ] `REIM-*` apuntan hoy a: `________`

> **Parar si:** falta `130003` (la `035` aborta, y crear la cuenta es una decisión
> del plan de cuentas, no un paso del despliegue), o si a la `043` le falta una de
> las cinco — aborta sin escribir nada:
> `ABORTADO sin escribir nada. Cuenta(s) destino inexistentes, inactivas o que no son de ingreso: …`

### P-7 · Volumen de los backfills

```sql
SELECT count(*) FILTER (WHERE chart_account_code IS NULL) AS sin_cuenta,
       count(*)                                           AS total
  FROM public.business_expenses;

SELECT count(*) AS gastos_tramite FROM public.expenses;
```

- [ ] compras sin cuenta: `____` (esperado **0**, porque no hay compras)
- [ ] gastos de trámite: `____` (esperado **137**) → es el volumen de la `036`

> **Cerrado:** con `business_expenses = 0` el guard de la `040` no puede
> dispararse. Ese guard es **incondicional** (chequea los NULL antes de mirar si
> el CHECK de la `037` existe), así que reordenar la `037` y la `040` nunca fue
> un remedio — pero ya no hace falta ninguno.

### P-8 · Recibos de caja (`047`)

```sql
SELECT count(*) FROM public.payments WHERE payment_number IS NOT NULL;

SELECT payment_number, count(*) FROM public.payments
 WHERE payment_number IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
```

- [ ] cobros ya numerados: `____` (de 8)
- [ ] duplicados: `____` (tiene que ser 0)

> **Parar si:** hay un `payment_number` duplicado — hace fallar el índice único
> de la `047`.
>
> La mitad de este chequeo que miraba `business_expenses.status` ya no aplica:
> no hay compras.

### P-9 · Dependencias de `balance_due` (`051`)

```sql
SELECT column_name, generation_expression FROM information_schema.columns
 WHERE table_schema='public' AND table_name='invoices' AND column_name='balance_due';

SELECT count(*) FROM pg_depend d
  JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
 WHERE d.refobjid = 'public.invoices'::regclass AND a.attname = 'balance_due';

SELECT count(*) FROM pg_views
 WHERE schemaname='public' AND definition ILIKE '%balance_due%';
```

- [ ] expresión actual: `________________________`
- [ ] `pg_depend`: `____` (esperado 1, su propio `pg_attrdef`)
- [ ] vistas que la nombran: `____` (esperado 0)

> **Parar si:** hay vistas. El `DROP COLUMN` de la `051` las arrastra y el reporte
> que las use queda roto sin aviso. El conteo del encabezado de la `051` está
> medido **en staging**, no acá.
>
> Volumen: 102 facturas — la reescritura es instantánea.

### P-10 · Los CHECK de `documents` (`047` / `048`)

```sql
SELECT DISTINCT entity_type FROM public.documents ORDER BY 1;
SELECT DISTINCT source      FROM public.documents ORDER BY 1;
```

- [ ] `entity_type` en uso: `________________________`
- [ ] `source` en uso: `________________________`

> **Parar si:** algún `entity_type` cae fuera de
> `client, case, task, comment, quote, invoice`, o algún `source` fuera de
> `manual` + los cuatro `auto_*`. Aborta el `ADD CONSTRAINT` de la `047`.

---

## 1b · Pre-flight de las `058` a `064` — solo SELECT

Se agregó el 25/09/2026. **Nada de esto se midió el 22/09**; lo que se sabe de
antemano es el techo: 102 facturas y 6 notas de crédito.

### P-11 · Motivos de anulación (`058`)  ·  🟡 puede requerir decisión

```sql
SELECT count(*) FILTER (WHERE cancellation_reason IS NOT NULL) AS con_motivo,
       count(*) FILTER (WHERE cancellation_reason IS NOT NULL
                          AND char_length(btrim(cancellation_reason)) < 15)   AS cortos,
       count(*) FILTER (WHERE char_length(btrim(cancellation_reason)) > 1000) AS largos
  FROM public.invoices;

-- si «cortos» o «largos» > 0, la lista:
SELECT invoice_number, status, char_length(btrim(cancellation_reason)) AS largo,
       btrim(cancellation_reason) AS motivo
  FROM public.invoices
 WHERE cancellation_reason IS NOT NULL
   AND char_length(btrim(cancellation_reason)) NOT BETWEEN 15 AND 1000
 ORDER BY invoice_number;
```

- [ ] con motivo: `____` · cortos: `____` · largos: `____`

> **Parar si:** cortos o largos > 0. La `058` **aborta a propósito** y lista las
> facturas: el motivo sale impreso en el PDF de la factura anulada y rellenarlo
> desde una migración sería falsificar el registro. Qué hacer con ellas lo
> deciden Oliver y el contador, **antes** del día D.

### P-12 · El historial de envíos (`059` / `062`)

```sql
SELECT count(*)                                  AS emisiones,
       count(*) FILTER (WHERE invoice_id IS NULL) AS sin_factura,
       count(*) FILTER (WHERE autorizada)         AS autorizadas
  FROM public.fe_emisiones;

SELECT to_regclass('public.fe_anulaciones') AS fe_anulaciones_ya_existe;

SELECT column_name FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'fe_emisiones'
   AND column_name = 'credit_note_id';
```

- [ ] emisiones: `____` · sin factura: `____` (esperado **0**) · autorizadas: `____`
- [ ] `fe_anulaciones_ya_existe`: `____` (esperado **NULL**)
- [ ] `credit_note_id`: `____` (esperado **0 filas**)

> **Parar si:** `sin_factura` > 0 — el CHECK del arco exclusivo de la `062` no
> entraría. Anotar «emisiones»: es el número que la `062` tiene que imprimir como
> «filas existentes intactas».

### P-13 · El estado de las notas de crédito (`060`)

```sql
SELECT status, count(*) FROM public.credit_notes GROUP BY 1 ORDER BY 1;

SELECT to_regproc('public.finanzas_credit_note_immutability') AS inmutabilidad;
```

- [ ] estados: `________________` (esperado solo **`emitida` · 6**)
- [ ] `inmutabilidad`: `____` (esperado **no NULL**)

> **Parar si:** aparece un `status` que no sea `emitida` ni `anulada`. La `060`
> re-declara el CHECK con esos dos valores y el `ADD CONSTRAINT` fallaría.

### P-14 · El origen de los CUFE (`061` / `064`)

```sql
SELECT count(*) FILTER (WHERE i.dgi_cufe IS NOT NULL) AS con_cufe,
       count(*) FILTER (WHERE i.dgi_cufe IS NOT NULL AND EXISTS (
         SELECT 1 FROM public.fe_emisiones e
          WHERE e.invoice_id = i.id AND e.autorizada AND e.cufe = i.dgi_cufe)) AS del_pac,
       count(*) FILTER (WHERE i.dgi_cufe IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.fe_emisiones e WHERE e.invoice_id = i.id))       AS cargados_a_mano
  FROM public.invoices i;
```

- [ ] con CUFE: `____` · del PAC: `____` · cargados a mano: `____`
- [ ] ambiguos = con CUFE − del PAC − a mano: `____` (esperado **0**)

> Qué va a pasar con cada grupo: la `061` marca **todos** `'crm'`; la `064`
> re-marca los «cargados a mano» como `'portal_050'` (la tarjeta legacy de antes
> de julio los copiaba del portal) y lista cada uno en un NOTICE.
>
> **No es motivo de parar, pero hay que mirarlo:** un «ambiguo» (tiene envíos
> del CRM pero ninguno autorizado con ese CUFE) queda como `'crm'`. Si aparece
> alguno, anotarlo y revisarlo a mano después del despliegue.

### P-15 · Servicios que quedan con una cuenta inactiva después de la `043`  ·  🟡 DECIDE JOSUARTH

Agregada el 25/09/2026. La `043` reasigna solo los cinco `HON-*` que Josuarth
confirmó y deja **HON-FAM y HON-OTROS en `4101`**, que en el plan nuevo está
**inactiva**, a propósito. Toda factura con esos servicios **se rechaza al emitir**.
Desde el 25/09 el rechazo ocurre antes de tomar el número (no deja huecos), pero
**no se puede facturar ese servicio** hasta reasignarlo. Esta consulta simula la
`043` y lista lo que va a quedar mal:

```sql
WITH despues_de_la_043 AS (
  SELECT s.tenant_id, s.code, s.name, s.service_type, s.active,
         CASE s.code
           WHEN 'HON-COR' THEN '400001' WHEN 'HON-LAB' THEN '400003'
           WHEN 'HON-CIV' THEN '400004' WHEN 'HON-PEN' THEN '400005'
           WHEN 'HON-MIG' THEN '400007' ELSE s.revenue_account
         END AS cuenta
    FROM public.services_catalog s
)
SELECT d.code, d.name, d.service_type, d.cuenta,
       c.name        AS nombre_cuenta,
       c.code IS NULL AS no_existe,
       c.active      AS activa,
       c.account_type
  FROM despues_de_la_043 d
  LEFT JOIN public.chart_of_accounts c
         ON c.tenant_id = d.tenant_id AND c.code = d.cuenta
 WHERE d.active
   AND (d.cuenta IS NULL
        OR c.code IS NULL
        OR NOT c.active
        OR c.account_type NOT IN ('income', 'asset'))
 ORDER BY d.code;
```

- [ ] Servicios que van a quedar mal: `________________________` (esperado: HON-FAM y
      HON-OTROS si existen en producción; probada en staging el 25/09, donde da HON-OTROS)
- [ ] Cuenta que Josuarth eligió para cada uno: `________________________`

> **No es motivo de parar el despliegue**, pero sí de **no reabrir la facturación**
> hasta reasignarlos: ver el paso «Reasignar» del Bloque B.
> En staging se usó **400004 Derecho Civil** para HON-FAM (el plan no tiene una
> cuenta de Familia y el derecho de familia es una rama del civil;
> `sql/datos-staging/2026-09-25_hon_fam_a_derecho_civil.sql`). **Es una propuesta, no la
> decisión:** en producción manda Josuarth. HON-OTROS no tiene candidata obvia.

### P-16 · Facturas anuladas en un mes distinto al de su emisión (resumen de ITBMS)

Agregada el 25/09/2026. Desde ese día el resumen de ITBMS **no cuenta las
facturas anuladas** (regla de Oliver). Antes contaban positivo en su mes y
negativo en el de la anulación. Desde la `052` sólo se anula dentro del mismo
mes, así que las dos cosas se compensaban; pero una anulación VIEJA entre meses
hace que el resumen de esos meses **cambie** después del despliegue. Esta
consulta dice si hay alguna:

```sql
SELECT invoice_number, issue_date, cancelled_at::date AS anulada_el, tax_total
  FROM public.invoices
 WHERE status = 'anulada'
   AND date_trunc('month', issue_date) <> date_trunc('month', cancelled_at)
 ORDER BY issue_date;
```

- [ ] Facturas anuladas entre meses: `____` (si hay: avisar al contador qué meses
      cambian en el resumen antes de que lo abra)

---

## 2 · El backup — acá es bloqueante

**El punto exacto:** después del último movimiento del bufete y **antes de la
primera migración de la Fase 3**. No antes de la Fase 5.

La primera escritura que no se deshace está en la Fase 3, no en la 5:

- la `033` asigna correlativos `PRV-` (con 0 compras no crea ninguno, pero
  siembra la secuencia),
- la `047` numera los ocho cobros existentes `REC-`,
- la `051` dropea y recrea `invoices.balance_due`.

Ninguna se revierte con un `DROP`. Y desde que el motor entra en línea
(`028`/`030`), **los asientos son inmutables**: los triggers de la `023` rechazan
`UPDATE` y `DELETE`.

- [ ] Avisar al bufete y confirmar que nadie está escribiendo
- [ ] Tomar el backup — panel de Supabase del proyecto `uqmmkklbhzxqybljiecs`,
      o `scripts/backup-supabase.mjs`.
      🔴 **Las credenciales de producción no van a una máquina:** si el script las
      pide, se usa el panel.
- [ ] Hora: `________` · Tamaño: `________` · Dónde quedó: `________________`
- [ ] Verificar que el archivo se **abre**: contar tablas, confirmar `invoices`,
      `expenses` y `chart_of_accounts`

> **Parar si:** el backup no se puede leer. Sin backup verificado no se corre la
> primera migración. El rollback del día **es** el backup.

---

## 3 · Bloque A: 29 migraciones, con la app arriba

Ninguna de estas altera lo que el código de `main` muestra hoy.

```
026 → 027 → 028 → 029 → 030 → 031 → 032 → 033 → 034 → 036 → 038
 → 039 → 041 → 042 → 044 → 046 → 047 → 051 → 052 → 053 → 054 → 055
 → 057 → 059 → 065 → 060 → 062 → 063 → 067
```

> **Por qué la `058`, la `061` y la `064` NO están acá**, aunque sean chicas:
> las tres rompen algo que `main` hace hoy (peligros 3 y 4). Van al Bloque B.
> Las cuatro que sí entran son aditivas (`059`, `062`) o reemplazan funciones
> que `main` no llama (`060`, `063`).

> **Por qué la `057` va al final de A y no junto a la `033`.** Su única
> dependencia es que exista `suppliers` (la crea la `033`), así que cualquier
> posición posterior sirve. Se appendea para **no alterar un orden ya
> verificado**: mover una migración de lugar obliga a re-verificar las
> dependencias de todas las que quedan alrededor, y acá no se gana nada.

- [ ] **`026` · `027`** — cuenta de socias y fecha de los saldos
  > Parar si la `027` falla en `ADD CONSTRAINT coa_saldo_inicial_requiere_fecha`:
  > quedó una cuenta con saldo y sin fecha que el backfill no alcanzó.

- [ ] **`028` → `029` → `030`** — el motor de posteo · *orden obligatorio*
  ```
  NOTICE: CHECK viejo de source_type eliminado: …
  NOTICE: je_reversion_requires_ref ya existe / RESTAURADO (faltaba)
  ```
  > Parar si la `028` dice que eliminó **más de un** CHECK de `source_type` (es el
  > bug que documenta la `042`). Después de la `030`, **verificar a mano** que ni
  > `anon` ni `authenticated` pueden ejecutar `post_journal_entry`: es la única
  > garantía de tenant que se mudó de la base al código.

- [ ] **`031` · `032`** — bucket privado y `amount_paid` derivada
  > Las dos son inertes para `main`: no escribe `amount_paid` (los 16 usos son
  > lectura) y no usa `getPublicUrl`.

- [ ] **`033`** — proveedores · proveedores creados: `____` (esperado **0**)
  > Parar si crea alguno: significa que apareció una compra desde el pre-flight.

- [ ] **`034` · `036`** — un asiento por documento y las líneas de gasto
  ```
  NOTICE: --- ANTES: 137 gastos · N con comprobante · suma X
  NOTICE: --- DESPUÉS ---
  NOTICE:   gastos ................ 137  (sin cambios)
  NOTICE:   líneas ................ 137  (una por gasto)
  NOTICE:   suma .................. X    (idéntica)
  NOTICE:   con comprobante ....... N    (sin cambios, Storage intacto)
  NOTICE:   líneas SIN CLASIFICAR . 137
  ```
  > La `036` aborta sola si la cantidad de gastos cambió, si no hay una línea por
  > gasto, si la suma no coincide o si se movió un comprobante. **Leer cuál de las
  > cinco**: «dos errores se estaban compensando» es la peor y no se resuelve
  > reintentando.
  > Gastos `____` · Líneas `____` · Sin clasificar `____`

- [ ] **`038` → `039` · `041` → `042` · `044`**
  > Parar si el paso 4 de la `039` no verifica que `anon` y `authenticated`
  > quedaron sin `EXECUTE` sobre `post_journal_entry`.

- [ ] **`046` · `047`** — reversión de cobro y recibo de caja
  ```
  NOTICE: 047: tenant … — 8 cobros numerados
  ```
  > Parar si no son 8: quedaron cobros sin `REC-` y el índice único no los atrapa
  > porque solo mira los no nulos.
  > Cobros numerados: `____`

- [ ] **`051`** — reescribe `invoices` · `ACCESS EXCLUSIVE`
  ```
  NOTICE: 051: balance_due recreada como grand_total - amount_paid - credited_total
  NOTICE: 051: credited_total recalculada en 6 factura(s) con NC
  NOTICE: 051 ✅ 13 columnas fiscales en credit_notes, credited_total derivada
          con guard, T7a con total neto, balance_due = …
  ```
  > Parar si sale `051: verificación fallida (fiscales …, checks …, triggers …,
  > balance_due = …, inconsistentes …)`. «Inconsistentes» = facturas cuyo saldo no
  > cierra contra el nuevo cálculo.
  > Son 102 facturas y 6 NC: la reescritura es instantánea.

- [ ] **`052` → `053` · `054` → `055`** — anulación con reversión y Bloque 7
  > La `053` es un `CREATE OR REPLACE` de la función de la `052`: van pegadas y en
  > ese orden. La `055` lleva un **pre-flight propio al pie del archivo**: correrlo
  > antes, no después. Si detecta un asiento reversado dos veces, el índice único
  > falla al crearse. Con el libro vacío no puede pasar, pero se corre igual.

- [ ] **`057`** — cuenta por defecto del proveedor + persona de contacto
  ```
  NOTICE: 057: columna `default_chart_account_code` agregada.
  NOTICE: 057: columna `contact_name` agregada.
  NOTICE: 057: columna `contact_phone` agregada.
  NOTICE: 057: columna `contact_email` agregada.
  NOTICE: 057: 4 columna(s) nueva(s) de 4 posibles.
  NOTICE: 057 — VERIFICACIÓN
  NOTICE:   columnas nuevas ....... 4 (esperado 4)
  NOTICE:   CHECK nuevos .......... 4 (esperado 4)
  NOTICE:   filas con dato ........ 0 (esperado 0 en la 1ª pasada)
  ```
  > **Parar si:** cualquiera de los dos contadores no da 4. Aditiva pura: cuatro
  > columnas nullable, sin backfill, sin tocar ninguna columna existente. Es
  > inerte para el código de `main`, que no conoce `suppliers` siquiera.

- [ ] **`059`** — tabla `fe_anulaciones` (lo que se le pidió al PAC al anular)
  ```
  NOTICE: 059 — VERIFICACIÓN
  NOTICE:   columnas .............. 12 (esperado 12)
  NOTICE:   CHECK ................. 5 (esperado 5)
  NOTICE:   índices ............... 5 (esperado 5: pkey + unique + 3)
  NOTICE:   RLS activo ............ true
  NOTICE:   políticas ............. 1 (esperado 1)
  ```
  > Parar si aborta con `no existe public.fe_emisiones` (debería existir desde
  > la `019`) o si algún contador no coincide. Tabla nueva, vacía: `main` no la
  > conoce.

- [ ] **`065`** · `fe_anulaciones.credit_note_id` · *después de la `059`*
  ```
  NOTICE: 065 ✅ fe_anulaciones.credit_note_id + arco exclusivo · 0 fila(s) existentes intactas
  ```
  > Parar si aborta con `no existe public.fe_anulaciones` (se saltó la `059`). La tabla
  > está vacía en producción recién creada por la `059`, así que el `0` es el esperado.
  > `main` no conoce `fe_anulaciones`: es inerte.

- [ ] **`060`** — reversión de nota de crédito · *después de la `055`*
  ```
  NOTICE: 060 ✅ reverse_credit_note, el status anulada y la inmutabilidad con UNA transición
  ```
  > Parar si: `falta el índice único de una reversión por asiento (055)` (se
  > saltó la `055`), `anon o authenticated pueden ejecutar el reversor`, o el
  > `ADD CONSTRAINT credit_notes_status_check` falla (lo debería haber atrapado
  > P-13). Toca el esquema de `credit_notes`, **no sus 6 filas**.

- [ ] **`062`** — `fe_emisiones.credit_note_id` (arco exclusivo)
  ```
  NOTICE: 062 ✅ fe_emisiones.credit_note_id + arco exclusivo · N fila(s) existentes intactas
  ```
  > **N tiene que ser el «emisiones» de P-12.** Parar si aborta con `fila(s) de
  > fe_emisiones no cumplen el arco exclusivo`. Para `main` es inerte: sigue
  > insertando siempre con `invoice_id`.

- [ ] **`063`** — la anulación bloquea solo por NC VIGENTES · *después de la `052`/`053`*
  ```
  NOTICE: 063 ✅ la anulación bloquea sólo por notas de crédito VIGENTES
  ```
  > Parar si cualquiera de sus seis chequeos aborta (firma, permisos, filtro,
  > gate de pagos, gate de período). Es un `CREATE OR REPLACE` de una función
  > que `main` no llama.

- [ ] **`067`** · importar asientos desde Excel · *después de la `055`*
  ```
  NOTICE: 067 ✅ importación de asientos: lote, vínculo, alta en una transacción y reversión del lote
  ```
  > Tablas nuevas y dos RPC sólo para `service_role`. `main` no las conoce: inerte.

- [ ] **Recargar el esquema de PostgREST**
  ```sql
  NOTIFY pgrst, 'reload schema';
  ```
  > Obligatorio después de la `051`: `balance_due` cambió de posición.

---

## 3b · Ficha de las migraciones `057` a `064`

Filas en producción: 🟢 = medido el 22/09 · 🟡 = techo conocido, el número
exacto sale del pre-flight indicado.

| | Qué cambia | Backfill | Filas que toca en prod | Cómo se verifica | Si falla |
|---|---|---|---|---|---|
| **`057`** | 4 columnas nullable en `suppliers` (cuenta por defecto + contacto) y 4 CHECK | No | 🟢 **0** (`suppliers` nace vacía en la `033`) | NOTICE: 4 columnas, 4 CHECK, 0 filas con dato | Aborta sin escribir. Es aditiva: se re-corre |
| **`058`** | CHECK: `invoices.cancellation_reason` NULL o 15–1000 caracteres | **No, a propósito**: no reescribe motivos | 🟡 0 escrituras; lee ≤ 102 (P-11) | NOTICE `058 — VERIFICACIÓN` con la definición y 0 fuera de rango | Aborta y lista las facturas con motivo corto; no aplica nada. Decisión de Oliver + contador |
| **`059`** | Tabla nueva `fe_anulaciones` con RLS | No | 🟢 **0** (tabla nueva) | 12 columnas · 5 CHECK · 5 índices · RLS · 1 política | Aborta sin crear nada. `DROP TABLE` si hubiera que sacarla |
| **`060`** | `credit_notes.status` admite `anulada`; 2 columnas nuevas; nueva inmutabilidad; RPC `reverse_credit_note` | No | 🟡 0 escrituras; el CHECK se valida contra las **6** NC (P-13) | NOTICE `060 ✅` + sus 7 chequeos internos | Todo en una transacción: no queda nada a medias. Re-correr después de corregir |
| **`061`** | Columna `invoices.dgi_cufe_origen` + CHECK | **Sí**: todo CUFE existente → `'crm'` | 🟡 las «con CUFE» de P-14 (≤ 102) | NOTICE `061 ✅ … N factura(s) marcadas como 'crm'`; N = «con CUFE» | Aborta sin escribir. **Solo en la ventana** (peligro 3) |
| **`062`** | `fe_emisiones.credit_note_id`, `invoice_id` deja de ser NOT NULL, CHECK de arco exclusivo | No | 🟡 0 escrituras; valida todas las de P-12 | NOTICE `062 ✅ … N fila(s) existentes intactas`, N = P-12 | Aborta sin escribir |
| **`065`** | `fe_anulaciones.credit_note_id`, `invoice_id` deja de ser NOT NULL, CHECK de arco exclusivo, índice único de intentos por NC | No | 🟢 **0** (la tabla la crea vacía la `059` en la misma corrida) | NOTICE `065 ✅ … 0 fila(s) existentes intactas` | Aborta sin escribir. Aditiva |
| **`066`** | NC de compra: `supplier_credit_notes` + líneas (inmutables), `business_expenses.credited_total` derivada y `balance_due` GENERATED, status contra el total neto, RPC de alta y de reversión, `source_type` y secuencia nuevos | No (credited_total nace en 0) | 🟢 **0** compras el 22/09 | NOTICE `066 ✅ … N compra(s) intactas` | Aborta sin escribir |
| **`067`** | Importar asientos: `journal_imports`, `journal_import_entries`, RPC en lote y reversión del lote | No | 🟢 **0** (tablas nuevas) | NOTICE `067 ✅` | Aborta sin escribir. Aditiva |
| **`063`** | Reemplaza `cancel_invoice_with_reversal`: bloquea solo por NC **vigentes** | No | 🟢 **0** (solo función) | NOTICE `063 ✅` + 6 chequeos del cuerpo | Aborta y queda la versión de la `053`, que es más estricta: nada se rompe |
| **`064`** | Corrige la `061`: CHECK con `IS NOT NULL` explícito; re-marca como `'portal_050'` los CUFE cargados a mano | **Sí**: los «cargados a mano» de P-14 → `'portal_050'` | 🟡 los «cargados a mano» de P-14 | NOTICE con los dos conteos + `064 ✅ … (probado: rechazado)` | Aborta y lista si queda un CUFE sin origen demostrable. **Solo en la ventana**, pegada a la `061` |

**Dependencias de orden** (todas se respetan con el orden de §3 y §5):
`060` necesita la `051` y la `055` · `062` necesita `credit_notes` y `fe_emisiones`
· `063` reemplaza la función de la `052`/`053` · `064` necesita la `061`, sin
nada en el medio.

---

## 4 · Verificación del Bloque A, con `main` todavía arriba

🔴 **Esta fase no se saltea, corra el mismo día o al día siguiente.** Es el único
momento donde se puede distinguir «lo rompió el Bloque A» de «lo rompió el
Bloque B».

- [ ] **Estado de Resultado: los costos SIGUEN apareciendo.** La `025` todavía no
      corrió. Anotar la utilidad: `B/. ____________` ← **es la foto contra la que
      se compara después del deploy**
- [ ] VAT Summary: abre y exporta
- [ ] Descargar el PDF de una factura y de una cotización (prueba de la `031`)
- [ ] Abrir una factura con pagos: `balance_due` da lo mismo que antes
      (prueba de la `051` + el `NOTIFY`)
- [ ] Registrar y anular un cobro de prueba
- [ ] Cargar un gasto de trámite y editarlo (prueba de la `036` y la `038` sobre
      los 137 existentes)

---

## 5 · La ventana: Bloque B, 13 migraciones y el merge

```
035 → 043 → 040 → 037 → 045 → 048 → 049 → 050 → 066 → 058 → 061 → 064 → 025 → merge
```

> 🔴 **Antes de la `058`: congelamiento.** Desde la `058` y hasta que el deploy
> esté arriba, **nadie emite, anula ni carga un CUFE** (peligros 3 y 4). Avisarlo
> al bufete con la hora; no alcanza con que «es tarde y no hay nadie».

**Con `business_expenses = 0`, la ventana larga no la sufre nadie.** Las `040`,
`045` y `048` son cambios de esquema sobre una tabla vacía. Lo único que se
rompe es un módulo que nunca se usó.

**La ventana que sí importa es la corta:** de la `025` al deploy, 15–20 minutos,
con el Estado de Resultado mal.

- [ ] Hora de inicio: `________`

- [ ] **`035` · `043`** — los servicios apuntan a las cuentas vigentes
  ```
  NOTICE:   HON-COR → 400001
  NOTICE:   HON-LAB → 400003   … (una por servicio cambiado)
  ```
  > Parar si: `ABORTADO sin escribir nada…` — debería haberlo atrapado P-6.

- [ ] **Reasignar los servicios de P-15** · *antes de reabrir la facturación*
  Con la cuenta que eligió Josuarth, una línea por servicio (es una escritura de
  datos: la corre Oliver en el SQL Editor, como el resto de la ventana):
  ```sql
  UPDATE public.services_catalog
     SET revenue_account = '<cuenta elegida>'
   WHERE code = '<SERVICIO>'
     AND tenant_id = 'a0000000-0000-0000-0000-000000000001';
  ```
  Y se verifica con la consulta de P-15 **sin el CTE** (la `043` ya corrió):
  ```sql
  SELECT s.code, s.name, s.revenue_account, c.active
    FROM public.services_catalog s
    LEFT JOIN public.chart_of_accounts c
           ON c.tenant_id = s.tenant_id AND c.code = s.revenue_account
   WHERE s.active AND (c.code IS NULL OR NOT c.active);
  -- esperado: 0 filas
  ```
  > Si Josuarth todavía no decidió alguno: **no se inventa la cuenta**. El servicio
  > queda rechazando al emitir (sin quemar número) y se avisa al bufete que ese
  > servicio no se puede facturar hasta la decisión.

- [ ] **`040` · `037` · `045`** — líneas de compra sobre una tabla vacía
  ```
  NOTICE: Guards OK. Compras a migrar: 0
  NOTICE: 040 OK
  NOTICE:   compras migradas : 0
  NOTICE:   líneas creadas   : 0
  NOTICE:   encabezados con cuenta: 0 (sellado por CHECK)
  ```
  > Parar si aparece `Hay N compra(s) sin chart_account_code … Clasificarlas antes
  > de aplicar esta migración`: significa que se cargó una compra entre el
  > pre-flight y ahora. Ese guard es **incondicional**.
  >
  > La `045` no debe tocar el libro: parar si sale
  > `La cantidad de asientos cambió: N antes, M después.`

- [ ] **`048` → `049` → `050`** — pagos a proveedores · *orden obligatorio*
  ```
  NOTICE: 048: 0 saldos heredados creados (compras que ya estaban pagadas)
  ```
  > Las tres van juntas: la `049` hace `ALTER TABLE supplier_payments` y sin la
  > `048` esa tabla no existe.
  > Parar si N ≠ 0, o si aparece `La compra no puede nacer con status = …`
  > (algo que no es la migración está escribiendo en `business_expenses`).

- [ ] **`066`** · NC de compra · *después de la `048` → `049` → `050`*
  ```
  NOTICE: 066 ✅ NC de compra: tablas, saldo derivado, RPC de alta y de reversión · N compra(s) intactas
  ```
  > N = compras en producción (**0** el 22/09). La verificación interna aborta si
  > alguna compra queda con `balance_due` distinto de `total − amount_paid`, o si
  > se perdió `je_reversion_requires_ref` al re-declarar el CHECK de `source_type`.
  > Va en la ventana porque reemplaza el recálculo y el guard de la `048`, que el
  > código de `main` no usa pero que no conviene cambiar con la app vieja arriba.

- [ ] **`058`** — el motivo de anulación exige 15 caracteres
  ```
  NOTICE: 058: 0 facturas con motivo fuera de rango. Se puede agregar el CHECK.
  NOTICE: 058 — VERIFICACIÓN
  NOTICE:   CHECK ................. CHECK (...BETWEEN 15 AND 1000)
  NOTICE:   filas fuera de rango .. 0 (esperado 0)
  ```
  > Parar si sale `058 — 🔴 HAY N FACTURA(S) CON UN MOTIVO QUE NO CUMPLE`: la
  > lista que sigue tiene que ser la de P-11. **No se corrigen desde acá.** Si
  > P-11 dio 0 y ahora no, alguien anuló después del pre-flight: el
  > congelamiento no se respetó.

- [ ] **`061` → `064`** — el origen del CUFE · *pegadas, sin nada en el medio*
  ```
  NOTICE: 061 ✅ dgi_cufe_origen · N factura(s) marcadas como 'crm'
  NOTICE: 064: 0 factura(s) con CUFE del PAC marcadas como 'crm'
  NOTICE:   FAC-… — CUFE sin ninguna emisión del CRM: pasa a portal_050   (una por factura)
  NOTICE: 064: M factura(s) con CUFE cargado a mano re-marcadas como 'portal_050'
  NOTICE: 064 ✅ un CUFE sin origen ya no entra (probado: rechazado)
  ```
  > **N = «con CUFE» de P-14 · M = «cargados a mano» de P-14.** La primera línea
  > de la `064` tiene que dar 0: la `061` acaba de marcar todo.
  > Parar si la `064` aborta con `CUFE sin origen demostrable`: algo escribió un
  > CUFE entre las dos. Parar también si termina en `(probado: …)` con otra
  > palabra que no sea `rechazado`.
  > 🔴 **Desde este punto, `main` no puede guardar una factura autorizada.** El
  > merge va enseguida.

- [ ] **La foto que permite revertir la `025`** — treinta segundos
  ```sql
  CREATE TABLE _foto_025_cuentas AS
    SELECT code, account_type, subcategoria, cuenta_control
      FROM public.chart_of_accounts;
  ```

- [ ] 🔴 **`025`** — NIIF 18 · *desde acá el P&L miente*
  ```
  NOTICE: — POST-CHECK NIIF 18 —
  NOTICE: account_type=cost .............. N (esperado 6)
  NOTICE: ingresos_operativos ............ N (esperado 9)
  NOTICE: gastos_operativos .............. N (esperado 30)
  NOTICE: costos_operativos .............. N (esperado 6)
  NOTICE: resultado activas sin clasificar N (esperado 0)
  NOTICE: vocabulario viejo restante ..... N (esperado 0)
  NOTICE: Anticipo de Clientes ........... N (esperado 1)
  NOTICE: cuentas control marcadas ....... N (esperado 2)
  ```

  > 🔴 **Los cuatro primeros «esperado» son de STAGING y producción tiene otro
  > plan de cuentas (97 vs 62). QUE NO COINCIDAN NO ES MOTIVO DE PARAR.**
  > Se comparan contra **P-1(e)**, que los calculó sobre producción:
  >
  > | | del texto (staging) | de P-1(e) (producción) | lo que salió |
  > |---|---|---|---|
  > | `cost` | 6 | `____` | `____` |
  > | `ingresos_operativos` | 9 | `____` | `____` |
  > | `gastos_operativos` | 30 | `____` | `____` |
  > | `costos_operativos` | 6 | `____` | `____` |
  >
  > **Los cuatro últimos sí son absolutos**, y de hecho la migración aborta sola
  > con ellos: `sin clasificar` = 0, `vocabulario viejo` = 0,
  > `Anticipo de Clientes` = 1. `cuentas control` = 2 no aborta, pero si no da 2 es
  > que falta `100004` o `200001` — lo debería haber atrapado P-1(c).
  >
  > **Parar si:** un número no coincide con P-1(e), o cualquiera de los tres
  > absolutos está mal. Revertir con `_foto_025_cuentas` antes de seguir.

- [ ] **Merge de `develop` a `main`** — requiere aprobación explícita de Oliver
      (regla no negociable, `CLAUDE.md` §5)
      SHA: `____________` · Hora del deploy OK: `________`

---

## 6 · Verificación post-deploy

- [ ] 🔴 **Estado de Resultado: los costos VOLVIERON** — *cierra la ventana corta*
      `/finanzas/reportes/pyl`. Las cuentas de costo tienen que aparecer ahora bajo
      **Costos operativos**, separadas de Gastos. **La utilidad tiene que ser la
      misma que anotaste en la Fase 4.** Si subió, el código nuevo no está arriba.
      Utilidad ahora: `B/. ____________` · ¿coincide? **SI / NO**
- [ ] **VAT Summary** — `/finanzas/reportes/vat-summary`, exportar el XLSX.
      El DV tiene que verse `05`, no `5`.
- [ ] Emitir una factura: el número del asiento es el de la factura
- [ ] Registrar un cobro, bajar el `REC-` y reversarlo
- [ ] Cargar un gasto de trámite: se postea al crearse y queda con asiento
- [ ] Cargar un asiento manual con tercero, clonarlo y reversarlo.
      Un segundo intento de reversar el mismo asiento tiene que ser rechazado.
- [ ] Emitir una nota de crédito por líneas sobre una de las 102 facturas
      ⚠️ Desde 9C la NC nace interna (`no_emitida`) y se manda a la DGI con OTRO
      botón. **No apretar «Enviar a la DGI»** en esta prueba: sería un documento
      fiscal real. Si esta prueba no es una NC que el bufete necesita de verdad,
      reemplazarla por abrir una NC existente.
- [ ] Entrar con los cinco roles y recorrer el menú
      (contador: `/finanzas/cobros` en solo lectura, sin botón de registrar;
      abogada: sin asientos ni períodos; asistente: tres pantallas)
- [ ] 🆕 **9B/9C, sin crear documentos fiscales.** Abrir una factura emitida por
      el CRM: la tarjeta eFactura se ve como antes. Abrir una factura anterior al
      8/7/2026 sin CUFE: aparece «Registrar el CUFE del portal» (admin/abogada).
      Abrir una NC: se ve su estado ante la DGI y, si tiene asiento propio, el
      botón «Reversar». **No anular ni emitir NC ante la DGI como prueba:** en
      producción `i_amb = 1` y cada envío es un documento fiscal real. La primera
      anulación o NC real la hace el bufete cuando la necesite, con Oliver al lado
      (SOP-040).
- [ ] 🆕 Consultas de §10.3 (solo SELECT): ninguna factura con CUFE sin origen,
      y la primera factura emitida después del deploy con origen `'crm'`
- [ ] Confirmar que **no** hay banda de entorno en producción
- [ ] Anotar el deploy en `changelog.md` y avisar que la ventana cerró

---

## 7 · Regenerar el inventario de migraciones

Es lo que valida que el Bloque A quedó donde dice que quedó.

```bash
# staging (lee .env.staging-db.local, el mismo archivo que run-sql.mjs)
node scripts/inventario-migraciones.mjs --staging

# producción: sus credenciales no van a una máquina
node scripts/inventario-migraciones.mjs --sql > introspeccion.sql
# pegar en el SQL Editor de producción, guardar el JSON que devuelve
node scripts/inventario-migraciones.mjs --desde salida.json --base produccion
```

El modo `--staging` lleva el mismo candado que `run-sql.mjs`: si la connection
string apunta al project ref de producción, aborta.

- [ ] Las 42 migraciones (`025`–`055`, `057`, `058`–`067`) figuran como **sí**.
      La `056` no existe todavía: su hueco es a propósito (§P-2(b))
- [ ] La sección «La cola, en orden» queda vacía o solo con la `022`
      (que es una decisión explícita de no aplicar)

---

## 8 · Rollback de compras

> **Esto es un parche para seguir operando, no un rollback.** El rollback de
> verdad es el backup. No deshace la `049`, la `050` ni la `025`, y los
> correlativos consumidos no vuelven.

**Con `business_expenses = 0`, los pasos 1 y 2 no tienen datos que restaurar.**
Lo que sigue haciendo falta es soltar los guards, porque lo que rompe el código
viejo es el **trigger**, no el dato.

```sql
-- 1 · la foto (con 0 compras devuelve 0 filas; se corre igual, cuesta nada)
CREATE TABLE _rollback_compras AS
  SELECT be.id, be.status, be.payment_date, be.payment_method,
         el.chart_account_code
    FROM public.business_expenses be
    LEFT JOIN public.expense_lines el ON el.business_expense_id = be.id;

-- 2 · soltar el CHECK de la 040 y devolver la cuenta al encabezado
ALTER TABLE public.business_expenses
  DROP CONSTRAINT business_expenses_cuenta_vive_en_la_linea;

UPDATE public.business_expenses be
   SET chart_account_code = r.chart_account_code
  FROM _rollback_compras r
 WHERE r.id = be.id;

-- 3 · soltar los guards, borrar los saldos heredados y devolver el estado
DROP TRIGGER IF EXISTS trg_guard_expense_amount_paid  ON public.business_expenses;
DROP TRIGGER IF EXISTS trg_recalc_expense_amount_paid ON public.supplier_payments;

SELECT set_config('finanzas.amount_paid_override','on', false);
DELETE FROM public.supplier_payments WHERE kind = 'migrated_balance';

UPDATE public.business_expenses be
   SET status         = r.status,
       payment_date   = r.payment_date,
       payment_method = r.payment_method
  FROM _rollback_compras r
 WHERE r.id = be.id;
```

🔴 **Los dos `DROP TRIGGER` del paso 3 son la parte que se olvida.** Sin ellos el
guard sigue rechazando todo `UPDATE` de `status` y el código viejo queda roto
igual, aunque los datos estén bien. **Con la tabla vacía, son lo único del
rollback que realmente hace algo.**

🔴 **El orden importa.** Si se borran los saldos heredados antes del paso 1, el
trigger deriva `status = 'pendiente_pago'` en todas las compras y se pierde
cuáles estaban pagadas. Con 0 compras no hay nada que perder hoy, pero el orden
se respeta igual: el día que esto se use, puede no ser hoy.

### Revertir solo la `025`

```sql
UPDATE public.chart_of_accounts c
   SET account_type = f.account_type,
       subcategoria = f.subcategoria,
       cuenta_control = f.cuenta_control
  FROM _foto_025_cuentas f
 WHERE f.code = c.code;
```

Requiere haber corrido la foto de la Fase 5. Soltar antes el CHECK
`coa_resultado_subcategoria_niif18` si el vocabulario viejo lo viola.

---

## 9 · Variables de entorno `EFACTURA_*` — Production contra Preview

**Solo nombres.** Relevado el 25/09/2026 con `vercel env ls`, que lista nombres
y entornos, no valores. Nadie leyó ni cargó un valor de producción.

> 🔄 **Actualizado el 25/09 a la tarde:** Oliver cargó en **Preview** las 18 del
> sandbox (`i_amb = 2`). Falta solo `FORMA_PAGO_DEFAULT`, que es opcional (default
> `08`). Production no cambió: sus 19 siguen con la fecha de carga de julio.

**Conclusión primero:** el despliegue **no necesita ninguna variable nueva**.
9B y 9C (anular ante la DGI, NC fiscal) usan las mismas que la emisión, por el
mismo `loadEmisorConfig()` y el mismo cliente HTTP, y las **19** ya están en
Production. Preview no tenía ninguna hasta el 25/09; ahora tiene 18 y el PAC de
pruebas se puede probar desde un deploy de rama.

> Por qué 19 y no 18: el conteo de `docs/efactura/variables-de-entorno.md` es
> 16 obligatorias + 2 opcionales. La 19.ª es `EFACTURA_EMISOR_FORMA_PAGO_DEFAULT`,
> opcional con default `08` en el código, y **sí está cargada** en Production.

| Variable | Secreta | Production hoy | Preview hoy | ¿Otro valor en Production? |
|---|---|:---:|:---:|---|
| `EFACTURA_API_KEY` | 🔴 sí | ✅ | ✅ | 🔴 **Sí** — la key de producción del PAC. La del sandbox no sirve allá, ni al revés |
| `EFACTURA_API_BASE_URL` | no | ✅ | ✅ | 🔴 **Sí** — la API real (`api.efacturapty.com`, `task_plan.md` 07/07). Local apunta al sandbox (verificado: no es la de producción) |
| `EFACTURA_I_AMB` | no | ✅ | ✅ | 🔴 **Sí — `1`**. En Preview y local, `2`. El candado de `emisor-config.ts` rechaza `1` si `NEXT_PUBLIC_APP_ENV` no es `production` |
| `EFACTURA_EMISOR_PUNTO_FACTURACION` | no | ✅ | ✅ | 🔴 **Sí — `051`** (ideati; el `050` es del portal/QuickBooks). Local usa otro punto (verificado: no es `051`) |
| `EFACTURA_EMISOR_RUC` | no | ✅ | ✅ | Igual: RUC del bufete (*) |
| `EFACTURA_EMISOR_DV` | no | ✅ | ✅ | Igual (*) |
| `EFACTURA_EMISOR_RAZON_SOCIAL` | no | ✅ | ✅ | Igual (*). Va también en la referencia de la NC (9C) |
| `EFACTURA_EMISOR_TIPO_CONTRIBUYENTE` | no | ✅ | ✅ | Igual |
| `EFACTURA_EMISOR_SUCURSAL` | no | ✅ | ✅ | Igual |
| `EFACTURA_EMISOR_DIRECCION` | no | ✅ | ✅ | Igual |
| `EFACTURA_EMISOR_UBICACION_CODIGO` | no | ✅ | ✅ | Igual |
| `EFACTURA_EMISOR_CORREGIMIENTO` | no | ✅ | ✅ | Igual |
| `EFACTURA_EMISOR_DISTRITO` | no | ✅ | ✅ | Igual |
| `EFACTURA_EMISOR_PROVINCIA` | no | ✅ | ✅ | Igual |
| `EFACTURA_EMISOR_CPBS_HON` | no | ✅ | ✅ | Igual |
| `EFACTURA_EMISOR_CPBS_REI` | no | ✅ | ✅ | Igual. ⚠️ El `8012` de reembolsos sigue sin confirmar por el contador |
| `EFACTURA_EMISOR_TELEFONO` | no | ✅ | ✅ | Igual (opcional) |
| `EFACTURA_EMISOR_EMAIL` | no | ✅ | ✅ | Igual (opcional) |
| `EFACTURA_EMISOR_FORMA_PAGO_DEFAULT` | no | ✅ | ❌ | Igual (opcional, default `08`) |

(*) Se espera el mismo dato del bufete en los dos ambientes, pero **no se
comparó**: comparar exige leer el valor de producción, y eso no se hace desde
una máquina.

**Y la que decide el candado:** `NEXT_PUBLIC_APP_ENV` está en los tres entornos.
En Production tiene que valer `production`; si no, el candado rechaza
`i_amb = 1` y **la facturación de producción se cae entera**. Se verifica
mirando que en producción **no** aparezca la banda de entorno (§6).

- [ ] El día D no se toca ninguna variable. Si alguien propone cargar algo en
      Production «para que ande», **parar**: las 19 ya están.
- [ ] Cargar las 19 del sandbox en **Preview** (con `i_amb = 2`) es otra
      decisión, independiente de este despliegue, y es de Oliver: es un cambio
      de configuración en la cuenta del cliente.

---

## 10 · Consultas de verificación en producción — en orden, solo SELECT

Ninguna escribe. Van en el orden en que se corren.

### 10.1 · Antes de empezar (día −2, y P-0 el día D)

En este orden, copiándolas de su sección, donde ya están listas:
**P-0** (§0) → **P-1 (a–d)** → **P-1(e)** → **P-2** → **P-3** → **P-4** →
**P-5** → **P-6** → **P-7** → **P-8** → **P-9** → **P-10** (§1) →
**P-11** → **P-12** → **P-13** → **P-14** → **P-15** → **P-16** (§1b).
No se duplican acá para que no haya dos copias que puedan divergir.

### 10.2 · Después del Bloque A (con `main` arriba)

```sql
-- V-A1 · lo que el Bloque A tenía que crear, y lo que NO tenía que tocar todavía
SELECT
  to_regclass('public.fe_anulaciones') IS NOT NULL                        AS "059_fe_anulaciones",
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
           AND table_name='credit_notes' AND column_name='cancelled_at')   AS "060_cancelled_at",
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
           AND table_name='fe_emisiones' AND column_name='credit_note_id') AS "062_credit_note_id",
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
           AND table_name='fe_anulaciones' AND column_name='credit_note_id') AS "065_credit_note_id",
  EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
           WHERE n.nspname='public' AND p.proname='cancel_invoice_with_reversal'
             AND position('reverses_entry_id = je.id' IN pg_get_functiondef(p.oid)) > 0) AS "063_filtro",
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
           AND table_name='suppliers' AND column_name='default_chart_account_code') AS "057_default",
  -- estas tres tienen que dar FALSE: son del Bloque B
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
           AND table_name='invoices' AND column_name='dgi_cufe_origen')     AS "061_todavia_NO",
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname='invoices_cancellation_reason_largo') AS "058_todavia_NO",
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
           AND table_name='chart_of_accounts' AND column_name='cuenta_control') AS "025_todavia_NO";
-- esperado: seis TRUE y tres FALSE

-- V-A2 · ningún RPC del libro es ejecutable desde la sesión del usuario
SELECT p.proname,
       has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('post_journal_entry','reverse_payment','reverse_supplier_payment',
                     'reverse_expense_tramite','reverse_journal_entry',
                     'cancel_invoice_with_reversal','reverse_credit_note')
 ORDER BY 1;
-- esperado: todas las filas en false / false

-- V-A3 · los datos de siempre, intactos
SELECT (SELECT count(*) FROM public.invoices)                                   AS facturas,     -- 102 o más
       (SELECT count(*) FROM public.credit_notes)                               AS nc,           -- 6 o más
       (SELECT count(*) FROM public.credit_notes WHERE status <> 'emitida')     AS nc_no_emitidas, -- 0
       (SELECT count(*) FROM public.fe_emisiones)                               AS emisiones,    -- = P-12
       (SELECT count(*) FROM public.journal_entries)                            AS asientos,     -- 0: main no postea
       (SELECT count(*) FROM public.invoices
         WHERE balance_due <> grand_total - amount_paid - credited_total)       AS saldos_que_no_cierran; -- 0
```

### 10.3 · Después del Bloque B y del deploy

```sql
-- V-B1 · la 025 dejó lo que P-1(e) calculó
SELECT count(*) FILTER (WHERE account_type = 'cost')                AS cost,
       count(*) FILTER (WHERE subcategoria = 'ingresos_operativos') AS ing_op,
       count(*) FILTER (WHERE subcategoria = 'gastos_operativos')   AS gas_op,
       count(*) FILTER (WHERE subcategoria = 'costos_operativos')   AS cos_op,
       count(*) FILTER (WHERE cuenta_control IS NOT NULL)           AS cuentas_control -- 2
  FROM public.chart_of_accounts
 WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001';
-- esperado: los cuatro primeros = P-1(e); el último = 2

-- V-B2 · 058: el CHECK está y nada lo viola
SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
 WHERE conname = 'invoices_cancellation_reason_largo';
SELECT count(*) AS fuera_de_rango FROM public.invoices
 WHERE cancellation_reason IS NOT NULL
   AND char_length(btrim(cancellation_reason)) NOT BETWEEN 15 AND 1000;   -- 0

-- V-B3 · 061 + 064: todo CUFE tiene origen, y el CHECK ya no tiene el agujero
SELECT dgi_cufe_origen, count(*) FROM public.invoices
 WHERE dgi_cufe IS NOT NULL GROUP BY 1 ORDER BY 1;
-- esperado: 'crm' = del_pac + ambiguos de P-14 · 'portal_050' = cargados a mano

SELECT count(*) AS cufe_y_origen_no_coinciden FROM public.invoices
 WHERE (dgi_cufe IS NULL) <> (dgi_cufe_origen IS NULL);                   -- 0

SELECT position('dgi_cufe_origen IS NOT NULL' IN pg_get_constraintdef(oid)) > 0 AS sin_agujero
  FROM pg_constraint WHERE conname = 'invoices_dgi_cufe_origen_check';    -- true

-- V-B4 · la primera factura emitida DESPUÉS del deploy (correr cuando exista una)
--        reemplazar la hora por la del deploy OK anotada en §5
SELECT invoice_number, fe_estado, dgi_cufe_origen, dgi_fecha_autorizacion
  FROM public.invoices
 WHERE dgi_fecha_autorizacion > TIMESTAMPTZ '2026-__-__ __:__-05'
 ORDER BY dgi_fecha_autorizacion;
-- esperado: fe_estado = 'authorized' y dgi_cufe_origen = 'crm' en todas.
-- Una con CUFE y origen NULL ya no puede existir (V-B3); si una quedó
-- 'pending' con la autorización en fe_emisiones, el deploy no tenía el código nuevo.

-- V-B5 · el libro empezó limpio y es de un solo tenant
SELECT tenant_id, count(*) AS asientos, min(entry_number), max(entry_number)
  FROM public.journal_entries GROUP BY 1;
-- esperado: 0 filas hasta la primera operación; después, solo a0000000-…-001
```

---

## Reglas del proyecto que este runbook no reemplaza

- `CLAUDE.md` §5 — pausa obligatoria antes del merge a `main` y antes de cualquier
  cambio de schema en producción. Producción no se toca desde una máquina.
- `sop.md` — SOP-012 (entornos), SOP-014 (hash-chain), SOP-017 (válvula de
  `amount_paid`), SOP-031 a SOP-035.
- `docs/staging/inventario-migraciones.md` — **generado**, ver §7.
