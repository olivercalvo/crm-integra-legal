# Ventana del Bloque 1 — orden final, tiempo y ensayo

**Qué es:** el orden de aplicación en producción de las **61 migraciones** de la `025` a la
`092` (todas menos la `056`, reservada, y las bitácoras), ensayado de punta a punta el
**05/10/2026** contra una base local igual a producción. Las bitácoras (`086`, `087`, `089`,
`090`, `091`) van en una **ventana aparte**, después.

**Qué reemplaza:** el ORDEN de `docs/runbooks/despliegue-025-055.md` (§0b, §3 y §5), que llegaba
hasta la `067` y dejaba la `068`–`092` en notas sueltas. **El detalle de cada paso sigue allá**: el
pre-flight P-1 a P-16, el respaldo, qué anotar de cada migración, el rollback y las variables
`EFACTURA_*`. Este documento dice en qué orden, cuánto tarda y qué cambió con el ensayo.

**Fuente única del orden:** `scripts/ensayo-ventana/orden.mjs`. Si se mueve una migración, se mueve
ahí, se vuelve a ensayar y se copia acá.

---

## 1. Resultado del ensayo (05/10/2026)

| Fase | Pasos | Errores | Tiempo de base |
|---|---:|---:|---:|
| Base = producción: `main` 24b227a (hasta la 024, 48 archivos) + datos + la 084 | 50 | 0 | 2,2 s |
| Ventana Bloque 1: A (29) → B (13) → C (19) | 61 migraciones + 33 verificaciones | **0** en migraciones | 2,3 s + 1,5 s |
| Ventana de bitácoras: 086 → 087 → 089 → 090 → 091 | 5 | 0 | 0,2 s |
| Prueba de las 41 tablas (después de las bitácoras) | 131 operaciones | 0 | — |
| Concurrencia bitácora ↔ libro (20 rondas, 9 combinaciones) | 180 rondas | 0 deadlocks | — |
| Concurrencia `--control` (orden viejo) | 27 rondas | 27 deadlocks (lo esperado) | — |

Además, después de todo: `verify_accounting_chain` en 0 filas; ninguna función ni política llama
a `tenant_id()`/`user_role()` sin esquema (en producción viven en `auth`, no en `public`); `anon` y
`authenticated` no ejecutan `post_journal_entry` ni `register_external_invoice`; ningún servicio
activo apunta a una cuenta inexistente o inactiva.

Registro completo, migración por migración, con cada NOTICE: `docs/finanzas/ensayo-ventana/*.json`.

### La base del ensayo, y por qué se parece a producción

- **Postgres 17.9 local** (staging es 17.6). ⚠️ La versión de producción no se pudo confirmar desde
  acá: correr `SELECT version();` en P-0. Si es 15, el ensayo no cubre diferencias de versión.
- **`postgres` sin superusuario**, como en Supabase, y `supabase_admin` como superusuario. Una
  migración que sólo funciona como superusuario habría fallado.
- **Los helpers de RLS en `auth`**, como en PRODUCCIÓN. Staging los tiene en `public` y su runner
  reescribe las migraciones; el ensayo no reescribe nada: corre los archivos tal cual van a
  producción. Lo mínimo de Supabase (roles, `auth.users`, `storage`) está en
  `scripts/ensayo-ventana/supabase-shim.sql`.
- **Esquema base leído de `main`** (`git show 24b227a:…`), con los dos parches de
  `staging-fixups.mjs`, que describen cómo quedó producción al aplicar esos archivos a mano.
- **Datos:** el seed de pruebas de staging (sólo lectura), recortado a lo que puede existir en la
  024: libro vacío y cero compras (como producción el 22/09); sin las cuentas, servicios y facturas
  que crearon migraciones posteriores; las filas que la 024 rechaza, fuera. Quedan **97 cuentas**,
  las mismas que producción. Sin datos reales.

### Lo que el ensayo NO puede probar

- 🔴 **Los números de la `025`.** La `025` no aborta si su POST-CHECK no coincide: imprime
  «esperado N» y sigue. En el ensayo imprimió `account_type=cost 0 (esperado 6)` y
  `gastos_operativos 55 (esperado 30)` y quedó aplicada. Es un artefacto (las cuentas de staging ya
  tienen el vocabulario NIIF 18), pero es exactamente el peligro 1 del runbook: **la `025` no falla,
  miente.** La única defensa sigue siendo P-1(e): los «esperado» calculados contra producción y la
  comparación a mano en D·5.
- **P-15 / HON-FAM y HON-OTROS:** en staging ya apuntaban a 400009 / 400010, así que la `043` dijo
  «PENDIENTE (esperado)» y el movimiento que producción necesita no se ejerció. Lo cubre la consulta
  de P-15 el día −2.
- **Tiempos reales:** el SQL tarda segundos; la ventana tarda lo que tarda una persona en el SQL
  Editor (§3).

---

## 2. El orden final

Sin cambios de orden en las migraciones: el de §3 y §5 del runbook viejo funciona tal cual, y el
Bloque C va **después** del B. Cambia el orden de **tres verificaciones** (ver §4).

### Bloque A — con la app de `main` arriba (29)

```
026 → 027 → 028 → 029 → 030 → 031 → 032 → 033 → 034 → 036 → 038
 → 039 → 041 → 042 → 044 → 046 → 047 → 051 → 052 → 053 → 054 → 055
 → 057 → 059 → 065 → 060 → 062 → 063 → 067
```

Después: `NOTIFY pgrst, 'reload schema';` y la verificación del Bloque A (§4 y §10.2 del runbook viejo).

### Congelar (D·4)

Nadie emite, anula, cobra ni carga un CUFE hasta que el deploy esté arriba.

### Bloque B — congelado (13)

```
035 → 043 → 040 → 037 → 045 → 048 → 049 → 050 → 066 → 058 → 061 → 064 → 025
```

- 🔴 Después de la `025`: comparar su POST-CHECK con P-1(e), línea por línea. Si no coincide,
  **parar** (la `025` ya quedó aplicada: se sigue con el rollback de §8 del runbook viejo, no con la C).
- ⚠️ El paso de datos «Reasignar los servicios de P-15» (después de la `043`) **ya no va**: lo
  reemplazan la `079` (HON-FAM → 400009) y la `082` (HON-OTROS → 400010), que van en el Bloque C.
  Si Josuarth elige otra cuenta para alguno, se cambia después de la ventana desde el catálogo.

### Bloque C — congelado, inmediatamente después de la 025 (19)

```
068 → 069 → 070 → 071 → 072 → 073 → 074 → 075 → 076 → 077 → 078
 → 079 → 080 → 081 → 082 → 083 → 084 → 085 → 092
```

Por qué después del B y no antes: la `069` reescribe RPC de la `048`, la `050` y la `066`; la
`079` parte de las subcategorías de la `025`; la `071` no es compatible con el código de `main` y
sólo puede ir en la parte congelada. La `084` ya está en producción: entra y no cambia nada.

- 📋 Antes de la `071`, el paso previo de los gastos de trámite sin proveedor (runbook viejo,
  encabezado): `sql/verificacion/gastos-tramite-sin-proveedor.sql`, sólo lectura.
- 📋 Antes de la `092`: `sql/verificacion/produccion-cufe-repetidos.sql`. Si devuelve filas con
  «sí», la `092` aborta: decidir antes qué factura conserva el CUFE.

### Merge y deploy (D·6, D·7)

`NOTIFY pgrst, 'reload schema';` → merge `develop` → `main` con aprobación de Oliver → verificación
post-deploy (§6 y §10.3 del runbook viejo) → descongelar.

### Ventana aparte: bitácoras (5), otro día

```
086 → 087 → 089 → 090 → 091
```

La `088` (copia del registro anterior) no va todavía. Se hace con la app arriba pero sin
operación (las bitácoras fallan cerrado: si algo sale mal, se deja de poder guardar).

---

## 3. Tiempo estimado

El SQL de las 61 migraciones corre en ~2,3 s; con los volúmenes de producción (102 facturas, 137
gastos de trámite, 146 clientes) sigue siendo cuestión de segundos. Lo que se mide es el trabajo de
una persona en el SQL Editor: abrir el archivo, pegar, correr, leer los NOTICE contra lo esperado,
marcar. Estimado con 2,5 min por migración (4 en las que tienen números que comparar: `025`, `033`,
`035`/`043`, `058`, `061`/`064`) y 1 min por verificación.

| Tramo | Contenido | Estimado |
|---|---|---:|
| D·0–D·1 | P-0 (+ `SELECT version()`) y respaldo, abrirlo | 25 min |
| D·2 | Bloque A: 29 migraciones + 13 verificaciones | 1 h 30 min |
| D·3 | reload + verificación del A | 15 min |
| D·4 | Congelar y avisar | 5 min |
| D·5a | Bloque B: 13 migraciones + 7 verificaciones (con la de la `067`) + comparar la `025` con P-1(e) | 55 min |
| D·5b | Bloque C: 19 migraciones + 13 verificaciones + los dos chequeos previos | 1 h 05 min |
| D·6–D·8 | merge, deploy, post-deploy, descongelar | 35 min |
| | **Total del día** | **~4 h 50 min** |
| | **Congelado (D·4 a D·8)** | **~2 h 40 min** |

Ventana de bitácoras: 5 migraciones + recarga + prueba de humo en la app (guardar un comentario,
emitir y anular una factura de prueba no: es producción; basta con guardar y leer una bitácora) ≈
**30 min**.

> El runbook viejo estimaba 3 h 45 min para 42 migraciones. Con las 19 del C, el congelado pasa de
> ~1 h 30 min a ~2 h 40 min. Si hace falta acortarlo: la `048`→`049`→`050`→`066` están en el B
> sólo porque rompen el módulo de compras de `main`, y producción tiene **cero compras**; pasarlas
> al A acortaría el congelado unos 15 min. **No se hizo**: es mover un orden verificado y lo decide
> Oliver. Si se decide, se cambia `orden.mjs` y se vuelve a ensayar.

---

## 4. Qué falló en el ensayo, qué cambia y qué faltaba en el runbook

Ninguna migración falló. Lo que salió son problemas de las VERIFICACIONES y del paso −1:

1. **`verificacion-067` va después de la `025`, no después de la `067`.** Usa
   `chart_of_accounts.cuenta_control`, que crea la `025` (al final del B). En el ensayo falló
   pegada a la `067` y pasó al final. Se corre al terminar el Bloque B.
2. **Siete verificaciones no prueban nada en producción:** `046`, `048`, `052`, `053`, `054`, `060`
   y `071` dicen «nada que verificar» porque el libro está vacío y no hay compras ni proveedores.
   La `066` y la `076` directamente fallan por la misma razón («no hay compra de prueba»; la NC sin
   compra exige un proveedor). **No es motivo de parar**: en el día D se anotan como «sin datos» y la
   prueba real es este ensayo, donde se corrieron con datos de «primer uso»
   (`datos-primer-uso.sql`: un proveedor, una compra, tres asientos y el banco de un cobro).
3. **Cada verificación se corre pegada a su migración, nunca al final.** Corridas todas al terminar
   la ventana, diez fallan (`038`, `039`, `048`, `049`, `050`, `051`, `055`, `066`, `068-069`, `071`):
   están escritas contra el motor de su momento (13 parámetros antes de la `071`, el `AD-` libre,
   el cobro sin referencia antes de la `074`, la firma vieja de la NC de compra antes de la `076`).
   No son pruebas de regresión. Si una se corre tarde y falla, no dice nada de la migración.
4. **El paso −1 no prueba lo que dice.** Pide correr la de 41 tablas y la de concurrencia «en
   staging, con el mismo esquema que va a producción». Staging ya tiene todo (la `092` y las
   bitácoras): no es el esquema que va a producción en ninguna de las dos ventanas. Y en producción
   no se pueden correr: antes de la ventana de bitácoras no existe `auditoria`, y después piden un
   proveedor, un asiento y un cobro con banco que producción no tiene. **Cambio:** el paso −1 es
   este ensayo (§5), que arma la base igual a producción y corre las dos pruebas con el esquema
   exacto de cada ventana. Las de staging se pueden correr además, como hasta ahora.
5. **Faltaba en el runbook:** el orden de la `068` a la `092` (ahora §2), el chequeo de CUFE
   repetidos antes de la `092`, que el paso «Reasignar» de P-15 ya no va, la ventana aparte de las
   bitácoras y `SELECT version()` en P-0.
6. Menor, sin efecto en la ventana: `business_expenses.status` sigue con `DEFAULT 'pagado'` (de la
   `010`) y el guard de la `048` rechaza justamente ese valor al crear. La app siempre manda
   `pendiente_pago`; un INSERT que omita la columna falla. Propuesta: cambiar el default en una
   migración futura.

---

## 5. Cómo se ensaya (paso −1)

En la máquina, sin Docker. Postgres 17 por npm, en una carpeta corta (Windows corta las rutas
largas: el error es `0xC0000106`):

```powershell
$D = "$env:TEMP\pgl"; New-Item -ItemType Directory -Force $D | Out-Null; Set-Location $D
npm init -y | Out-Null; npm i embedded-postgres@17.9.0-beta.17 pg
$B = "$D\node_modules\@embedded-postgres\windows-x64\native\bin"
& "$B\initdb.exe" -D "$D\data" -U supabase_admin -A trust -E UTF8 --locale=C
Add-Content -Encoding ascii "$D\data\postgresql.conf" "`nport = 54329`nlisten_addresses = 'localhost'`nshared_preload_libraries = 'pg_stat_statements'`ndeadlock_timeout = 1s`nmax_connections = 60`n"
& "$B\postgres.exe" -D "$D\data"      # dejarlo corriendo en otra terminal
```

Desde el repo (lee staging sólo para copiar el seed; escribe sólo en localhost):

```bash
node scripts/ensayo-ventana/ensayo.mjs base                  # prod_024 = producción hoy
node scripts/ensayo-ventana/ensayo.mjs ventana               # A → B → C, cada una con su verificación
node scripts/ensayo-ventana/ensayo.mjs verificar --primer-uso
node scripts/ensayo-ventana/ensayo.mjs bitacoras
export ENSAYO_DATABASE_URL=postgresql://postgres@localhost:54329/ventana
node scripts/run-sql.mjs sql/tests/verificacion-087-captura-41-tablas.sql
node sql/tests/concurrencia-bitacora-libro.mjs
node sql/tests/concurrencia-bitacora-libro.mjs 3 --control
```

`ENSAYO_DATABASE_URL` sólo se acepta si apunta a localhost. Se para si: una migración da error, la de
41 tablas da una `FALLA`, la de concurrencia un deadlock, o el `--control` no se traba en todas.
