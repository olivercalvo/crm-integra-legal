# Ventana del Bloque 1 — orden final, tiempo y ensayo

**Qué es:** el orden de aplicación en producción de las **63 migraciones** de la `025` a la
`094` (todas menos la `056`, reservada, y las bitácoras) y del paso de datos que marca lo de prueba,
ensayado de punta a punta el **05/10/2026** contra una base local igual a producción. Al final, el
paso «Accesos» (§6). Las bitácoras (`086`, `087`, `089`,
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
| Ventana Bloque 1: A (29) → B (14) → C (20) | 63 migraciones + 35 verificaciones | **0** en migraciones | 10,4 s en total |
| Paso «Marcar los datos de prueba» (base `pruebas`, datos equivalentes) | consulta → aborto → paso → consulta → paso otra vez | 0 marcas incorrectas | — |
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

- **Postgres 17.9 local.** **Producción es 17.6** (`SELECT version()`, consulta de Oliver del 05/10/2026)
  y staging también. Misma versión mayor: el catálogo, la sintaxis y los permisos que usan las
  migraciones son los mismos; entre 17.6 y 17.9 sólo hay correcciones.
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
Bloque C va **después** del B. Cambia el orden de **tres verificaciones** (ver §4). Se suman dos
migraciones nuevas del 05/10 (`093` en el B, `094` al final del C) y el paso de datos de prueba.

### Bloque A — con la app de `main` arriba (29)

```
026 → 027 → 028 → 029 → 030 → 031 → 032 → 033 → 034 → 036 → 038
 → 039 → 041 → 042 → 044 → 046 → 047 → 051 → 052 → 053 → 054 → 055
 → 057 → 059 → 065 → 060 → 062 → 063 → 067
```

Después: `NOTIFY pgrst, 'reload schema';` y la verificación del Bloque A (§4 y §10.2 del runbook viejo).

### Congelar (D·4)

Nadie emite, anula, cobra ni carga un CUFE hasta que el deploy esté arriba.

### Bloque B — congelado (14)

```
035 → 043 → 040 → 037 → 045 → 048 → 093 → 049 → 050 → 066 → 058 → 061 → 064 → 025
```

- 🔴 **La `048` y el código de compras van en el MISMO despliegue** (esta ventana: la `048` en el B
  congelado, el código en el merge de D·6). Las dos mitades se necesitan: el formulario de `main`
  manda el estado que elige la persona («Pagado» por defecto) y la `048` rechaza crear una compra que
  no nazca `pendiente_pago`; el código nuevo nace pendiente y registra el pago en `supplier_payments`,
  que crea la `048`. Entre la `048` y el deploy nadie carga compras (está congelado, y producción tiene
  cero). Lo confirma el ensayo: la `093` y su verificación pasan pegadas a la `048`.
- `093` (05/10): el `DEFAULT` de `business_expenses.status` pasa de `'pagado'` a `'pendiente_pago'`,
  el único valor que la `048` acepta al crear. No toca filas. Verificación: `verificacion-093` (2/2).

- 🔴 Después de la `025`: comparar su POST-CHECK con P-1(e), línea por línea. Si no coincide,
  **parar** (la `025` ya quedó aplicada: se sigue con el rollback de §8 del runbook viejo, no con la C).
- ⚠️ El paso de datos «Reasignar los servicios de P-15» (después de la `043`) **ya no va**: lo
  reemplazan la `079` (HON-FAM → 400009) y la `082` (HON-OTROS → 400010), que van en el Bloque C.
  Si Josuarth elige otra cuenta para alguno, se cambia después de la ventana desde el catálogo.

### Bloque C — congelado, inmediatamente después de la 025 (20)

```
068 → 069 → 070 → 071 → 072 → 073 → 074 → 075 → 076 → 077 → 078
 → 079 → 080 → 081 → 082 → 083 → 084 → 085 → 092 → 094
 → paso de datos «Marcar los datos de prueba»
```

Por qué después del B y no antes: la `069` reescribe RPC de la `048`, la `050` y la `066`; la
`079` parte de las subcategorías de la `025`; la `071` no es compatible con el código de `main` y
sólo puede ir en la parte congelada. La `084` ya está en producción: entra y no cambia nada.

- 📋 Antes de la `071`, el paso previo de los gastos de trámite sin proveedor (runbook viejo,
  encabezado): `sql/verificacion/gastos-tramite-sin-proveedor.sql`, sólo lectura.
- 📋 Antes de la `092`: `sql/verificacion/produccion-cufe-repetidos.sql`. Si devuelve filas con
  «sí», la `092` aborta: decidir antes qué factura conserva el CUFE.
- `094` (05/10): la marca de prueba es del DOCUMENTO (`de_prueba` en facturas, NC, cobros, cobros y
  gastos del caso) y la del cliente sólo vale para lo nuevo. Propuesta: `propuesta-corte-quickbooks.md`
  §9. Verificación: `verificacion-094` (9/9). Todavía ningún reporte filtra por ella (§9.4): marca, no
  cambia números.

#### Paso de datos «Marcar los datos de prueba» (después de la 094, todavía congelado)

🛑 **Pausa obligatoria** (cambio de datos en producción). Sin DELETE: sólo marca.

| Se marca de prueba | Se queda real |
|---|---|
| Clientes CLI-066, CLI-069, CLI-070, 0TEST-FE-001, 0TEST-FE-002 | CLI-026 (INTEGRA LEGAL) |
| Facturas FAC-HON-000454, FAC-REI-000038, FAC-HON-000455, 456, 457, 459, 460, 461 | **FAC-HON-000463** (real ante la DGI aunque su cliente sea 0TEST-FE-002) |
| — | El gasto ADM-001 de 1.00 |

`contador.test@integra-panama.com` no se toca acá: se desactiva en «Accesos» (§6).

1. **Antes:** `sql/verificacion/produccion-datos-de-prueba-a-marcar.sql` (sólo lectura; también corre hoy,
   con el esquema de la 024). Tiene que dar **16 filas**: 13 «marcar de prueba» y 3 «se queda real»,
   **ninguna «REVISAR» ni «NO ENCONTRADO»**, y `con_asiento = false` en todas. Si aparece un «REVISAR»
   (un cobro, una NC, otra factura o un gasto del caso de un cliente de prueba, u otro `0TEST-*`): parar,
   decidir, y agregarlo a la lista de los dos archivos.
2. **El paso:** `sql/ventana/marcar-datos-de-prueba.sql`. Aborta sin cambiar nada si falta la `094`, si un
   número no existe, si hay algo sin decidir o si una factura de la lista tiene asiento. Termina con
   `Marcadas ahora: 8 facturas y 5 clientes … Reales sin marca: FAC-HON-000463, CLI-026 y el gasto
   ADM-001 de 1.00.` Re-ejecutable (la segunda vez dice «0 facturas y 0 clientes»).
3. **Después:** la misma consulta del punto 1. `marca_hoy = true` en las 13 «marcar de prueba» y `false`
   en las 3 «se queda real».

Ensayado el 05/10 en una copia de `prod_024` con los mismos números y datos ficticios
(`ensayo.mjs marcar-pruebas`, registro en `docs/finanzas/ensayo-ventana/marcar-pruebas.json`): con un cobro
de CLI-066 sin decidir, abortó sin marcar nada; sin él, marcó 8 y 5 y dejó las tres reales sin marca.

### Merge y deploy (D·6, D·7)

`NOTIFY pgrst, 'reload schema';` → merge `develop` → `main` con aprobación de Oliver → verificación
post-deploy (§6 y §10.3 del runbook viejo) → descongelar → **Accesos (§6 de este documento)**.

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
| D·0–D·1 | P-0 y respaldo, abrirlo | 25 min |
| D·2 | Bloque A: 29 migraciones + 13 verificaciones | 1 h 30 min |
| D·3 | reload + verificación del A | 15 min |
| D·4 | Congelar y avisar | 5 min |
| D·5a | Bloque B: 14 migraciones + 8 verificaciones (con la de la `067`) + comparar la `025` con P-1(e) | 1 h |
| D·5b | Bloque C: 20 migraciones + 14 verificaciones + los dos chequeos previos | 1 h 10 min |
| D·5c | Marcar los datos de prueba: consulta, pausa, paso, consulta | 15 min |
| D·6–D·8 | merge, deploy, post-deploy, descongelar | 35 min |
| D·9 | Accesos (§6): usuario de Josuarth, su contraseña, desactivar contador.test, consulta | 20 min |
| | **Total del día** | **~5 h 35 min** |
| | **Congelado (D·4 a D·8)** | **~3 h 05 min** |

Ventana de bitácoras: 5 migraciones + recarga + prueba de humo en la app (guardar un comentario,
emitir y anular una factura de prueba no: es producción; basta con guardar y leer una bitácora) ≈
**30 min**.

> El runbook viejo estimaba 3 h 45 min para 42 migraciones. Con las 20 del C y el paso de datos, el
> congelado pasa de ~1 h 30 min a ~3 h 05 min. «Accesos» no necesita congelar. Si hace falta acortarlo: la `048`→`049`→`050`→`066` están en el B
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
   bitácoras y la versión de producción (17.6, confirmada por Oliver el 05/10).
6. ~~Menor: `business_expenses.status` sigue con `DEFAULT 'pagado'`~~ **Resuelto el 05/10:** la `093`
   cambia el default, la pantalla de compras arranca en «Pendiente de pago» y la API toma un alta sin
   estado como pendiente. Va con la `048` (§2, Bloque B).
7. **Desactivar un usuario no le quitaba el acceso** (encontrado ensayando §6 en staging el 05/10): sólo
   marcaba `public.users.active`, que ni el login ni el middleware miran. Un contador desactivado volvía a
   entrar y `/finanzas/reportes` le respondía 200. **Corregido en el código de esta ventana**: desactivar
   lo bloquea en Supabase Auth y reactivar lo desbloquea. Por eso «Accesos» va DESPUÉS del deploy.

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
node scripts/ensayo-ventana/ensayo.mjs marcar-pruebas        # el paso de datos de prueba, en otra copia
export ENSAYO_DATABASE_URL=postgresql://postgres@localhost:54329/ventana
node scripts/run-sql.mjs sql/tests/verificacion-087-captura-41-tablas.sql
node sql/tests/concurrencia-bitacora-libro.mjs
node sql/tests/concurrencia-bitacora-libro.mjs 3 --control
```

`ENSAYO_DATABASE_URL` sólo se acepta si apunta a localhost. Se para si: una migración da error, la de
41 tablas da una `FALLA`, la de concurrencia un deadlock, o el `--control` no se traba en todas.

---

## 6. Accesos (después de la verificación de la app)

Último paso del día, con la app nueva arriba y descongelada. **Tiene que ir después del deploy**: con el
código de `main`, «Desactivar» no le quita el acceso a nadie (§4, punto 7).

**Antes del día:** confirmar con Josuarth el correo personal que va a usar (a confirmar). En el proyecto de
producción, la plantilla de correo «Reset Password» tiene que llevar `{{ .TokenHash }}` y mandar a
`/auth/recuperar` (así quedó el 15/08, cuando se probó de la computadora al celular).

1. **Oliver crea el usuario.** Administración › Usuarios › Nuevo usuario:
   - Nombre completo: el de Josuarth. Correo: el confirmado.
   - **Rol: Contador.** ⚠️ El formulario arranca en «Abogada»: hay que cambiarlo.
   - Contraseña: **una descartable**, larga, generada en el momento, que no se anota ni se envía a nadie.
     Nadie la va a usar: Josuarth define la suya en el paso 2. (El sistema no tiene invitación por
     correo; el enlace que le llega a Josuarth es el de «¿Olvidaste tu contraseña?», que cumple esa función.)
2. **Josuarth define su contraseña.** Oliver le avisa (sin contraseña de por medio, **nunca por
   WhatsApp ni por ningún chat**) que entre a la dirección del CRM, escriba su correo y toque
   **«¿Olvidaste tu contraseña?»**. Lo que ve (probado en staging el 05/10):
   - en el login, en verde: «Se envió un enlace de recuperación a su correo.»;
   - en su correo, el enlace de recuperación; funciona aunque lo abra en otro dispositivo (el celular);
   - el enlace abre **«Elige tu contraseña nueva»**: «Contraseña nueva» (mínimo 8 caracteres) y «Repetir
     la contraseña», botón «Guardar contraseña»;
   - «Contraseña actualizada · Entrando al sistema…», y entra: «Buenas tardes, …» con la tarjeta
     **Finanzas** (es lo único que ve un contador). «Entrar» lo lleva a Reportes.
   - Si el enlace venció o ya se usó, el login lo dice y se pide otro con el mismo botón.
3. **Josuarth confirma que entró.** Recién entonces Oliver, en Administración › Usuarios, **desactiva
   `contador.test@integra-panama.com`**. Desde este deploy, desactivar lo bloquea en Supabase Auth: el login
   le responde «user_banned». ⚠️ Una sesión que ya estuviera abierta dura hasta que vence su token (1 h):
   si hay dudas, hacer este paso con esa sesión cerrada.
4. **Comprobar** con `sql/verificacion/produccion-accesos-contador.sql` (sólo lectura; poner antes el correo
   de Josuarth en la primera línea del `WITH`). Esperado: una sola fila «contador» activa y es la de
   Josuarth, con «puede_entrar» y «ya_entró» en «sí»; contador.test con «activo = no» y «puede_entrar = no»;
   ninguna fila «inactivo pero puede entrar»; **VEREDICTO = OK**. Si aparece un usuario inactivo que todavía
   puede entrar (desactivado antes de este deploy), se lo reactiva y se lo vuelve a desactivar desde la
   pantalla.

**Ensayado en staging el 05/10/2026** con dos usuarios ficticios (`contador.ensayo.0510@staging.test` y
`contador.ensayo2.0510@staging.test`; los dos quedaron desactivados y bloqueados): alta con contraseña
descartable (201) → «¿Olvidaste tu contraseña?» → enlace → «Elige tu contraseña nueva» → primer ingreso
→ la descartable ya no sirve (400). Desactivar con el código anterior: **seguía entrando** (200, y
`/finanzas/reportes` 200). Con el arreglo: `user_banned` (400); reactivar → entra (200); desactivar otra vez →
400. El correo en sí no se envió (dominio de prueba): el enlace se generó con el mismo token que pone la
plantilla. La consulta del punto 4 se probó en staging (sólo lectura): «OK» simulando los dos correos.
