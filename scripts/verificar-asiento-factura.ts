/**
 * Verifica CONTRA STAGING el cableado factura → asiento.
 *
 *   npx tsx scripts/verificar-asiento-factura.mts
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * QUÉ PRUEBA ESTO QUE LOS TESTS NO
 * ═════════════════════════════════════════════════════════════════════════════
 * `asiento-factura.test.ts` prueba el módulo puro con datos inventados. Lo que
 * NO puede probar es que el mapeo REAL del catálogo de staging produzca lo que
 * esperamos, ni que el RPC acepte el asiento que armamos. Son dos piezas
 * distintas —un módulo de TypeScript y una función de Postgres— y lo único que
 * las conecta es un JSON.
 *
 * Acá se usa el MÓDULO DE VERDAD (`construirAsientoDeFactura`, importado, no
 * reimplementado) sobre FACTURAS DE VERDAD de staging, y se postea con el RPC
 * de verdad.
 *
 * 🛡️ TODO DENTRO DE UNA TRANSACCIÓN QUE TERMINA EN ROLLBACK. No deja asientos,
 *    no emite facturas y no consume correlativo.
 *
 * ⚠️ `BEGIN` y `ROLLBACK` explícitos. No alcanza con confiar en que el driver
 *    agrupe: el 03/09 un script salió bien por el driver, no por el script.
 *
 * ⚠️ SAVEPOINT alrededor de cada intento que debe fallar. Una excepción del RPC
 *    aborta la transacción entera (`25P02`) y se llevaría puestos los pasos
 *    siguientes.
 *
 * 🛑 CANDADO ANTI-PRODUCCIÓN: aborta si la URL no es la de staging.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

import {
  construirAsientoDeFactura,
  type FacturaParaAsiento,
  type LineaFacturaParaAsiento,
} from "../src/lib/finanzas/contabilidad/asiento-factura";

const ROOT = process.cwd();
const PROD_PROJECT_REFS = ["uqmmkklbhzxqybljiecs"];

const envPath = resolve(ROOT, ".env.staging-db.local");
if (!existsSync(envPath)) {
  console.error(`\n🛑 Falta ${envPath}\n`);
  process.exit(1);
}
const CONN = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
).STAGING_DATABASE_URL as string;

if (!CONN) {
  console.error("\n🛑 Falta STAGING_DATABASE_URL\n");
  process.exit(1);
}
for (const ref of PROD_PROJECT_REFS) {
  if (CONN.includes(ref)) {
    console.error("\n🛑 ABORTADO: la conexión apunta a PRODUCCIÓN.\n");
    process.exit(1);
  }
}
console.log("✅ CANDADO OK — staging\n");

const TENANT = "a0000000-0000-0000-0000-000000000001";
const c = new pg.Client({ connectionString: CONN });

let fallos = 0;
const ok = (t: string, extra = "") => console.log(`  ✅ ${t}${extra ? " — " + extra : ""}`);
const mal = (t: string, extra = "") => {
  fallos++;
  console.log(`  ❌ ${t}${extra ? " — " + extra : ""}`);
};

let sp = 0;
/** Corre algo que PUEDE fallar sin arrastrar la transacción. */
async function intento<T>(fn: () => Promise<T>): Promise<{ ok: true; v: T } | { ok: false; e: Error }> {
  const nombre = `sp_${++sp}`;
  await c.query(`SAVEPOINT ${nombre}`);
  try {
    const v = await fn();
    await c.query(`RELEASE SAVEPOINT ${nombre}`);
    return { ok: true, v };
  } catch (e) {
    await c.query(`ROLLBACK TO SAVEPOINT ${nombre}`);
    return { ok: false, e: e as Error };
  }
}

/**
 * Arma el `FacturaParaAsiento` leyendo staging.
 *
 * ⚠️ Replica lo que hace `cargarFacturaParaAsiento()` pero en SQL, porque ese
 * loader habla supabase-js y acá hace falta `pg` para controlar la transacción.
 * Es la única pieza reimplementada; el módulo que ARMA el asiento es el real.
 * La consulta usa el mismo criterio: `active = true` decide `cuenta_valida`.
 */
async function cargar(invoiceNumber: string): Promise<FacturaParaAsiento> {
  const inv = (
    await c.query(
      `SELECT i.id, i.issue_date, i.grand_total, cl.name AS client_name
         FROM invoices i JOIN clients cl ON cl.id = i.client_id
        WHERE i.tenant_id = $1 AND i.invoice_number = $2`,
      [TENANT, invoiceNumber]
    )
  ).rows[0];
  if (!inv) throw new Error(`no existe la factura ${invoiceNumber} en staging`);

  const filas = (
    await c.query(
      `SELECT l.line_order, l.description, l.subtotal, l.tax_amount,
              s.code AS service_code, s.revenue_account,
              (a.code IS NOT NULL) AS cuenta_valida
         FROM invoice_lines l
         LEFT JOIN services_catalog s ON s.id = l.service_id
         LEFT JOIN chart_of_accounts a
                ON a.tenant_id = $1 AND a.code = s.revenue_account AND a.active
        WHERE l.tenant_id = $1 AND l.invoice_id = $2
        ORDER BY l.line_order`,
      [TENANT, inv.id]
    )
  ).rows;

  const lineas: LineaFacturaParaAsiento[] = filas.map((f) => ({
    line_order: f.line_order,
    description: f.description,
    subtotal: Number(f.subtotal),
    tax_amount: Number(f.tax_amount),
    service_code: f.service_code,
    revenue_account: f.revenue_account,
    cuenta_valida: f.cuenta_valida === true,
  }));

  return {
    id: inv.id,
    invoice_number: invoiceNumber,
    issue_date: new Date(inv.issue_date).toISOString().slice(0, 10),
    grand_total: Number(inv.grand_total),
    client_name: inv.client_name,
    lineas,
  };
}

async function postear(a: {
  transaction_date: string;
  description: string;
  lines: { account_code: string; debit: number; credit: number; description?: string | null }[];
  source_id?: string | null;
  reference?: string | null;
  idempotency_key?: string | null;
}) {
  const r = await c.query(
    `SELECT post_journal_entry($1,$2,$3,$4,$5::jsonb,$6,NULL,NULL,NULL,NULL,NULL,$7,$8) AS id`,
    [
      TENANT,
      a.transaction_date,
      a.description,
      "factura",
      JSON.stringify(
        a.lines.map((l) => ({
          account_code: l.account_code,
          debit: l.debit,
          credit: l.credit,
          description: l.description ?? null,
        }))
      ),
      a.source_id ?? null,
      a.reference ?? null,
      a.idempotency_key ?? null,
    ]
  );
  return r.rows[0].id as string;
}

// El cuerpo va dentro de una función porque este archivo es `.ts` (no `.mts`):
// tsx lo compila a CJS y ahí no hay top-level await. `.mts` tampoco sirve — desde
// un módulo ESM, los `.ts` del repo llegan como CJS y los named exports no se ven.
async function main() {
await c.connect();
await c.query("BEGIN");
console.log("🔓 BEGIN\n");

try {
  // ═══════════════════════════════════════════════════════════════════════
  console.log("1) REIM-* postea bien (cuenta 130003, activa)");
  // ═══════════════════════════════════════════════════════════════════════
  // FAC-REI-000002 está emitida y NO tiene asiento — es la única factura de
  // reembolso de staging que se puede postear sin chocar con el UNIQUE.
  const rei = await cargar("FAC-REI-000002");
  console.log(
    `     factura ${rei.invoice_number}  total ${rei.grand_total}  ` +
      `líneas: ${rei.lineas.map((l) => `${l.service_code}→${l.revenue_account}`).join(", ")}`
  );

  const armadoRei = construirAsientoDeFactura(rei);
  if (!armadoRei.ok) {
    mal("el módulo debía armar el asiento", armadoRei.mensaje);
  } else {
    ok("el módulo arma el asiento");
    const l = armadoRei.asiento.lines;
    const debe = l.filter((x) => x.debit > 0);
    const haber = l.filter((x) => x.credit > 0);
    if (debe.length === 1 && debe[0].account_code === "100004") {
      ok("DEBE 100004 Cuentas por Cobrar", String(debe[0].debit));
    } else {
      mal("el débito no es 100004", JSON.stringify(debe));
    }
    if (haber.some((x) => x.account_code === "130003")) {
      ok("HABER 130003 Fondo Legales de Clientes (reembolso, no ingreso)");
    } else {
      mal("el reembolso no acredita 130003", JSON.stringify(haber));
    }
    if (!haber.some((x) => x.account_code === "200003")) {
      ok("sin línea de ITBMS (el reembolso es exento)");
    } else {
      mal("un reembolso exento no debería generar ITBMS");
    }

    const r = await intento(() => postear(armadoRei.asiento as never));
    if (r.ok) {
      ok("el RPC lo acepta", `asiento ${String(r.v).slice(0, 8)}…`);

      const lineas = (
        await c.query(
          `SELECT a.code, l.debit, l.credit FROM journal_entry_lines l
             JOIN chart_of_accounts a ON a.id = l.account_id
            WHERE l.entry_id = $1 ORDER BY l.line_order`,
          [r.v]
        )
      ).rows;
      console.log(
        "     en el libro: " +
          lineas.map((x) => `${x.code} D:${x.debit} C:${x.credit}`).join(" | ")
      );
      const sd = lineas.reduce((s, x) => s + Number(x.debit), 0);
      const sc = lineas.reduce((s, x) => s + Number(x.credit), 0);
      if (Math.round(sd * 100) === Math.round(sc * 100) && Math.round(sd * 100) === Math.round(rei.grand_total * 100)) {
        ok("cuadra y coincide con el total de la factura", sd.toFixed(2));
      } else {
        mal("no cuadra contra el documento", `D ${sd} C ${sc} factura ${rei.grand_total}`);
      }

      // ═══════════════════════════════════════════════════════════════════
      console.log("\n3) el reintento NO duplica");
      // ═══════════════════════════════════════════════════════════════════
      const r2 = await intento(() => postear(armadoRei.asiento as never));
      if (r2.ok) {
        mal("🔴 el segundo posteo pasó: hay un asiento DUPLICADO");
      } else {
        const code = (r2.e as unknown as { code?: string }).code;
        if (code === "23505") {
          ok("el segundo posteo lo rechaza un UNIQUE (23505)");
          const ctr = (r2.e as unknown as { constraint?: string }).constraint;
          console.log(`     índice: ${ctr ?? "(no informado)"}`);
        } else {
          mal("rechazado, pero no por el UNIQUE", `${code}: ${r2.e.message}`);
        }
      }
    } else {
      mal("el RPC lo rechazó", r.e.message);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n2) HON-* se rechaza nombrando servicio y cuenta");
  // ═══════════════════════════════════════════════════════════════════════
  const hon = await cargar("FAC-HON-000001");
  console.log(
    `     factura ${hon.invoice_number}  ` +
      `líneas: ${hon.lineas.map((l) => `${l.service_code}→${l.revenue_account}`).join(", ")}`
  );
  const armadoHon = construirAsientoDeFactura(hon);
  if (armadoHon.ok) {
    mal("🔴 debía RECHAZAR: HON-* apunta a 4101, inactiva");
  } else {
    ok("rechaza");
    console.log(`     motivo: ${armadoHon.motivo}`);
    console.log(`     mensaje: ${armadoHon.mensaje}`);
    const nombraServicio = /HON-/.test(armadoHon.mensaje);
    const nombraCuenta = /4101/.test(armadoHon.mensaje);
    nombraServicio ? ok("el mensaje nombra el SERVICIO") : mal("no nombra el servicio");
    nombraCuenta ? ok("el mensaje nombra la CUENTA") : mal("no nombra la cuenta");
  }

  // Y el RPC, ¿rechaza también? Es la segunda capa: el guard es por el mensaje.
  const forzado = await intento(() =>
    postear({
      transaction_date: hon.issue_date,
      description: "FORZADO — no debe entrar",
      lines: [
        { account_code: "100004", debit: 100, credit: 0 },
        { account_code: "4101", debit: 0, credit: 100 },
      ],
      source_id: null,
      reference: null,
      idempotency_key: null,
    })
  );
  if (forzado.ok) {
    mal("🔴 el RPC aceptó una cuenta INACTIVA");
  } else {
    ok("el RPC también rechaza la cuenta inactiva (segunda capa)");
    console.log(`     ${forzado.e.message}`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n4) el correlativo cuando el posteo falla");
  // ═══════════════════════════════════════════════════════════════════════
  const antes = (
    await c.query(
      `SELECT last_number FROM numbering_sequences WHERE tenant_id=$1 AND sequence_type='invoice_hon'`,
      [TENANT]
    )
  ).rows[0];
  const consumido = (
    await c.query(`SELECT get_next_sequence_number($1,'invoice_hon') AS n`, [TENANT])
  ).rows[0].n;
  const despues = (
    await c.query(
      `SELECT last_number FROM numbering_sequences WHERE tenant_id=$1 AND sequence_type='invoice_hon'`,
      [TENANT]
    )
  ).rows[0];
  console.log(
    `     last_number antes=${antes?.last_number} → pidió ${consumido} → después=${despues?.last_number}`
  );
  if (despues && antes && despues.last_number > antes.last_number) {
    ok("get_next_sequence_number AVANZA el contador con un UPDATE");
    console.log(
      "     ⚠️ Es transaccional, pero `emitInvoice` lo llama por supabase-js y ahí\n" +
        "        cada RPC es su propia transacción auto-commiteada. O sea que en la app\n" +
        "        el número YA ESTÁ COMMITEADO cuando el posteo falla: se pierde y deja\n" +
        "        un HUECO en la numeración. Acá no se nota porque el ROLLBACK lo revierte."
    );
  } else {
    mal("el contador no avanzó", JSON.stringify({ antes, despues }));
  }

  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n5) la factura queda en borrador si el posteo falla");
  // ═══════════════════════════════════════════════════════════════════════
  // No se puede ejecutar `emitInvoice` acá (habla supabase-js), así que se
  // verifica la propiedad que lo hace cierto: el UPDATE a 'emitida' está DESPUÉS
  // del posteo en el código, y el posteo lanza. Se comprueba leyendo el orden.
  const src = readFileSync(resolve(ROOT, "src/lib/finanzas/api/invoices.ts"), "utf8");
  const iPost = src.indexOf("await postJournalEntry(");
  const iEmit = src.indexOf('status: "emitida"');
  if (iPost > 0 && iEmit > 0 && iPost < iEmit) {
    ok("en emitInvoice, el posteo va ANTES del UPDATE a 'emitida'");
  } else {
    mal("🔴 el orden se invirtió: se emite antes de postear", `post@${iPost} emit@${iEmit}`);
  }
  const iThrow = src.indexOf("throw new InvoiceMutationError(armado.mensaje", 0);
  if (iThrow > 0 && iThrow < iEmit) {
    ok("un asiento que no se puede armar LANZA antes de emitir");
  } else {
    mal("el rechazo no corta la emisión");
  }
} finally {
  await c.query("ROLLBACK");
  console.log("\n🔒 ROLLBACK — staging quedó como estaba");

  const q = await c.query(
    `SELECT (SELECT COUNT(*) FROM journal_entries WHERE tenant_id=$1) je,
            (SELECT COUNT(*) FROM invoices WHERE tenant_id=$1 AND status='emitida') emitidas`,
    [TENANT]
  );
  console.log(`   asientos: ${q.rows[0].je} · facturas emitidas: ${q.rows[0].emitidas}`);
  await c.end();
}

console.log(fallos === 0 ? "\n✅ TODO OK\n" : `\n❌ ${fallos} FALLO(S)\n`);
process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\n🛑 error inesperado:", e);
  process.exit(1);
});
