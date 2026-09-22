# Runbook del despliegue 025 → 055

**Qué es:** la corrida completa de las 31 migraciones contables pendientes a la
base de producción, más el merge de `develop` a `main`.

**Versión en página:** https://claude.ai/artifact/RnL36m1tJEk5hhAJZ4moQG
(checklists marcables, botones de copiar y un cronómetro de la ventana).
**Este archivo es el respaldo.** Mismos pasos, mismo SQL, para imprimir o abrir
en el editor. Si la página no carga o el estado guardado se pierde, se opera
desde acá y no pasa nada.

- **Estado de producción:** relevado el 2026-09-22 por pre-flight de solo lectura.
- **Dónde se detuvo:** entre la `024` y la `025`. Marcador decisivo:
  `chart_of_accounts.cuenta_control` no existe.
- **Duración estimada:** ~3 h 20 m de punta a punta.

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

## 3 · Bloque A — 22 migraciones, con la app arriba

Ninguna de estas altera lo que el código de `main` muestra hoy.

```
026 → 027 → 028 → 029 → 030 → 031 → 032 → 033 → 034 → 036 → 038
 → 039 → 041 → 042 → 044 → 046 → 047 → 051 → 052 → 053 → 054 → 055
```

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

- [ ] **Recargar el esquema de PostgREST**
  ```sql
  NOTIFY pgrst, 'reload schema';
  ```
  > Obligatorio después de la `051`: `balance_due` cambió de posición.

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

## 5 · La ventana — Bloque B, 9 migraciones y el merge

```
035 → 043 → 040 → 037 → 045 → 048 → 049 → 050 → 025 → merge
```

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
- [ ] Entrar con los cinco roles y recorrer el menú
      (contador: `/finanzas/cobros` en solo lectura, sin botón de registrar;
      abogada: sin asientos ni períodos; asistente: tres pantallas)
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

- [ ] Las 31 migraciones figuran como **sí**
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

## Reglas del proyecto que este runbook no reemplaza

- `CLAUDE.md` §5 — pausa obligatoria antes del merge a `main` y antes de cualquier
  cambio de schema en producción. Producción no se toca desde una máquina.
- `sop.md` — SOP-012 (entornos), SOP-014 (hash-chain), SOP-017 (válvula de
  `amount_paid`), SOP-031 a SOP-035.
- `docs/staging/inventario-migraciones.md` — **generado**, ver §7.
