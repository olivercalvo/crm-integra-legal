# Notas de Oliver para la revisión con Josuarth

Lo técnico que **no** va en la agenda. La agenda solo dice "Oliver prepara el ambiente antes de
este paso"; acá está qué hacer en cada caso. Nada de esto se le manda a Josuarth.

---

## Antes de mandar el correo

- **Acceso:** Shareable Link de Vercel del deploy de `develop` ("Anyone with the link", creado el
  15/09). El token va solo en el correo: **nunca** en un archivo del repo.
- **Contraseña** de `contador@staging.test`: en el correo, aparte del enlace. Tampoco en el repo.
- **Ventana de revisión abierta (SOP-019):** desde que sale el correo hasta que Josuarth confirma
  que terminó:
  - **No se hace push a `develop`.** El enlace compartido siempre muestra la última versión de la
    rama: un push le cambia el sistema en medio de la revisión.
  - Nada de `apply-staging-sql.mjs --reset`, `run-sql.mjs` con migraciones ni `seed:staging`.
  - El trabajo que haga falta va en una **rama aparte** y se integra cuando cierre la ventana.
- **Cerrar el acceso** al terminar: Administración, Usuarios, `contador@staging.test`, Desactivar
  (`docs/USUARIOS.md` §4). Si hace falta, revocar también el Shareable Link desde Vercel.

## Números de control (antes de la reunión)

Si alguno no coincide, alguien tocó staging:

```sql
SELECT sequence_type, last_number FROM public.numbering_sequences
 WHERE sequence_type IN ('invoice_hon','payment','supplier_payment','credit_note','supplier_credit_note');
-- esperado: invoice_hon 21 · payment 7 · supplier_payment 5 · credit_note 18 · supplier_credit_note 2
SELECT max(entry_number) FROM public.journal_entries;   -- esperado: 75
```

Se corre con `node scripts/run-sql.mjs <archivo.sql>` (lee `.env.staging-db.local`).

---

## Preparación por script

### 4.1 · Emitir y enviar a la DGI

El sandbox de ideati rechaza todo RUC de receptor inventado (`1601`/`1602`). Después del paso 2
(cuando la factura ya tiene número `FAC-HON-000022`) y **antes** de apretar «Enviar a la DGI»:

```bash
npx tsx scripts/efactura/sostener-receptor-emisor.ts CLI-001 FAC-HON-000022
```

Sostiene a Ferretería Vallarino con el RUC/DV del emisor en las tres columnas por 10 minutos y lo
restaura en un `finally`, también con Ctrl+C. Aborta si `EFACTURA_I_AMB` no es 2. Correrlo desde
la máquina (`.env.local`, staging + sandbox). El Preview ya tiene las 18 `EFACTURA_*` del sandbox.

Si el correlativo no es 22 (alguien emitió antes), usar el número que muestre la pantalla.

### 5 · Reenviar FAC-HON-000016

**Sin preparación, a propósito.** Se reenvía con el RUC inventado para que Josuarth vea el
rechazo nuevo. No correr `sostener-receptor-emisor` acá. **FAC-HON-000007 no se toca.**

### 6 · Anular FAC-HON-000022

Sin preparación: la anulación va por CUFE (`CreateCancellation`), no mira al receptor. Tiene que
hacerse dentro de las 182 h desde el `issue_date` y en el mismo mes.

### 7 · Nota de crédito sobre FAC-HON-000021 (paso 5, opcional)

Para mandar la NC nueva a la DGI:

```bash
npx tsx scripts/efactura/sostener-receptor-emisor.ts CLI-001 NC-000020
```

Si el número no es NC-000020 (la anulación del script 6 toma el 19), usar el que muestre la
pantalla. **Reversar NC-000017 sirve hasta el 01/10/2026**: el 02/10 vence su ventana de 182 h.

### 8 · Cobro repartido

Sin preparación. El rechazo del excedente no escribe nada; el cobro de 1,400.00 sí (REC-000008).

### 10 y 11 · NC de compra y pago a proveedor

Sin preparación. Hacer primero la NC (script 10) y después el pago (script 11), o el saldo que
anuncia el diálogo del pago cambia (117.00 → 95.60).

### 13 · Importación

Los dos Excel están en esta carpeta. `asientos-validos.xlsx` ya se importó y se deshizo el
25/09: el hash quedó libre, se puede volver a importar.

### 14 · Cierre de mes

Usar **agosto 2026** (0 asientos). Enero 2026 ya quedó "Reabierto" en las pruebas del 25/09.
Reabrir deja la marca "Reabierto" para siempre: es a propósito.

---

## Lo que se probó y cómo

- Scripts recorridos con clics el 25/09/2026 en el Preview de `develop`, sesión admin.
- Correcciones del mismo día (proveedor en el detalle de la compra, nombre único del envío, texto
  del diálogo de emitir, tope de la NC en pantalla): commits `cf1f710`, `1c7c733`, `5baf1d8`.
