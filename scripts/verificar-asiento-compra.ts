/**
 * Verifica CONTRA STAGING el cableado compra → asiento.
 *
 *   npx tsx scripts/verificar-asiento-compra.ts
 *
 * Mismos cinco pasos que `verificar-asiento-factura.ts`.
 *
 * ⚠️ **Crea una compra NUEVA dentro de la transacción**, con ITBMS distinto de
 *    cero. Las tres compras sembradas en staging tienen `tax_amount = 0` y
 *    además ya tienen asiento, así que no sirven para probar ni la pata del
 *    impuesto ni el posteo — el UNIQUE de la `034` las rechazaría.
 *
 * 🛡️ TODO DENTRO DE UNA TRANSACCIÓN QUE TERMINA EN ROLLBACK.
 * ⚠️ SAVEPOINT alrededor de cada intento que debe fallar (`25P02`).
 * 🛑 CANDADO ANTI-PRODUCCIÓN.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

import {
  construirAsientoDeCompra,
  type CompraParaAsiento,
  type LineaCompraParaAsiento,
} from "../src/lib/finanzas/contabilidad/asiento-compra";
import { esTipoValidoParaGasto } from "../src/lib/finanzas/contabilidad/cuentas-de-gasto";

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

/** Replica `cargarCompraParaAsiento()` en SQL. El módulo que ARMA es el real. */
async function cargar(compraId: string): Promise<CompraParaAsiento> {
  const be = (
    await c.query(
      `SELECT id, expense_date, description, total, supplier_name
         FROM business_expenses WHERE tenant_id=$1 AND id=$2`,
      [TENANT, compraId]
    )
  ).rows[0];

  const filas = (
    await c.query(
      `SELECT l.line_order, l.description, l.amount, l.tax_amount, l.chart_account_code,
              a.active, a.account_type
         FROM expense_lines l
         LEFT JOIN chart_of_accounts a
                ON a.tenant_id = $1 AND a.code = l.chart_account_code
        WHERE l.tenant_id = $1 AND l.business_expense_id = $2
        ORDER BY l.line_order`,
      [TENANT, compraId]
    )
  ).rows;

  const lineas: LineaCompraParaAsiento[] = filas.map((f) => ({
    line_order: f.line_order,
    description: f.description,
    amount: Number(f.amount),
    tax_amount: Number(f.tax_amount),
    chart_account_code: f.chart_account_code,
    cuenta_valida: f.active === true && esTipoValidoParaGasto(f.account_type),
  }));

  return {
    id: be.id,
    expense_date: new Date(be.expense_date).toISOString().slice(0, 10),
    description: be.description,
    total: Number(be.total),
    supplier_name: be.supplier_name,
    lineas,
  };
}

async function postear(a: {
  transaction_date: string;
  description: string;
  lines: { account_code: string; debit: number; credit: number; description?: string | null }[];
  source_id?: string | null;
  idempotency_key?: string | null;
}) {
  const r = await c.query(
    `SELECT post_journal_entry($1,$2,$3,$4,$5::jsonb,$6,NULL,NULL,NULL,NULL,NULL,NULL,$7) AS id`,
    [
      TENANT,
      a.transaction_date,
      a.description,
      "gasto",
      JSON.stringify(
        a.lines.map((l) => ({
          account_code: l.account_code,
          debit: l.debit,
          credit: l.credit,
          description: l.description ?? null,
        }))
      ),
      a.source_id ?? null,
      a.idempotency_key ?? null,
    ]
  );
  return r.rows[0].id as string;
}

async function main() {
  await c.connect();
  await c.query("BEGIN");
  console.log("🔓 BEGIN\n");

  try {
    // ═══════════════════════════════════════════════════════════════════════
    console.log("0) crear una compra NUEVA con ITBMS ≠ 0");
    // ═══════════════════════════════════════════════════════════════════════
    const nueva = (
      await c.query(
        `INSERT INTO business_expenses
           (tenant_id, expense_date, description, supplier_name,
            chart_account_code, subtotal, tax_rate, tax_amount, status)
         VALUES ($1, '2026-09-04', 'Verificación 040 — insumos con ITBMS',
                 'PROVEEDOR DE PRUEBA, S.A.', NULL, 300.00, 0.07, 21.00, 'pendiente_pago')
         RETURNING id, total`,
        [TENANT]
      )
    ).rows[0];
    ok("compra creada", `total ${nueva.total} (300 + 21 de ITBMS)`);

    await c.query(
      `INSERT INTO expense_lines
         (tenant_id, business_expense_id, line_order, description,
          chart_account_code, amount, tax_rate, tax_amount)
       VALUES
         ($1,$2,1,'Útiles de oficina','610008',100.00,0.07,7.00),
         ($1,$2,2,'Asesoría externa','610002',200.00,0.07,14.00)`,
      [TENANT, nueva.id]
    );
    ok("dos líneas, dos cuentas distintas");

    // ═══════════════════════════════════════════════════════════════════════
    console.log("\n1) la compra bien clasificada postea");
    // ═══════════════════════════════════════════════════════════════════════
    const compra = await cargar(nueva.id);
    console.log(
      `     líneas: ${compra.lineas.map((l) => `${l.chart_account_code}:${l.amount}+${l.tax_amount}`).join(", ")}`
    );

    const armado = construirAsientoDeCompra(compra);
    if (!armado.ok) {
      mal("el módulo debía armar el asiento", armado.mensaje);
    } else {
      ok("el módulo arma el asiento");
      const l = armado.asiento.lines;
      const itbms = l.filter((x) => x.account_code === "200003");
      if (itbms.length === 1 && itbms[0].debit === 21 && itbms[0].credit === 0) {
        ok("DEBE 200003 ITBMS por Pagar", "21.00 — la misma cuenta que acreditan las ventas");
      } else {
        mal("el ITBMS no está al débito de 200003", JSON.stringify(itbms));
      }
      const cxp = l.filter((x) => x.account_code === "200001");
      if (cxp.length === 1 && cxp[0].credit === 321) {
        ok("HABER 200001 Cuentas por pagar", "321.00");
      } else {
        mal("el crédito no es 200001 por el total", JSON.stringify(cxp));
      }

      const r = await intento(() => postear(armado.asiento as never));
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
          "     en el libro: " + lineas.map((x) => `${x.code} D:${x.debit} C:${x.credit}`).join(" | ")
        );
        const sd = lineas.reduce((s, x) => s + Number(x.debit), 0);
        const sc = lineas.reduce((s, x) => s + Number(x.credit), 0);
        if (Math.round(sd * 100) === Math.round(sc * 100) && Math.round(sc * 100) === Math.round(Number(nueva.total) * 100)) {
          ok("cuadra y coincide con el total de la compra", sc.toFixed(2));
        } else {
          mal("no cuadra contra el documento", `D ${sd} C ${sc} compra ${nueva.total}`);
        }

        // ═══════════════════════════════════════════════════════════════════
        console.log("\n3) el reintento NO duplica");
        // ═══════════════════════════════════════════════════════════════════
        const r2 = await intento(() => postear(armado.asiento as never));
        if (r2.ok) {
          mal("🔴 el segundo posteo pasó: hay un asiento DUPLICADO");
        } else {
          const code = (r2.e as unknown as { code?: string }).code;
          if (code === "23505") {
            ok("el segundo posteo lo rechaza un UNIQUE (23505)");
            console.log(`     índice: ${(r2.e as unknown as { constraint?: string }).constraint ?? "?"}`);
          } else {
            mal("rechazado, pero no por el UNIQUE", `${code}: ${r2.e.message}`);
          }
        }
      } else {
        mal("el RPC lo rechazó", r.e.message);
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    console.log("\n2) una línea mal clasificada se rechaza nombrando línea y cuenta");
    // ═══════════════════════════════════════════════════════════════════════
    await c.query(
      `UPDATE expense_lines SET chart_account_code='4101'
        WHERE business_expense_id=$1 AND line_order=2`,
      [nueva.id]
    );
    const mala = await cargar(nueva.id);
    const armadoMalo = construirAsientoDeCompra(mala);
    if (armadoMalo.ok) {
      mal("🔴 debía RECHAZAR: 4101 es income e inactiva");
    } else {
      ok("rechaza");
      console.log(`     motivo: ${armadoMalo.motivo}`);
      console.log(`     mensaje: ${armadoMalo.mensaje}`);
      /línea 2/.test(armadoMalo.mensaje) ? ok("nombra la LÍNEA") : mal("no nombra la línea");
      /4101/.test(armadoMalo.mensaje) ? ok("nombra la CUENTA") : mal("no nombra la cuenta");
    }

    const forzado = await intento(() =>
      postear({
        transaction_date: "2026-09-04",
        description: "FORZADO — no debe entrar",
        lines: [
          { account_code: "610008", debit: 100, credit: 0 },
          { account_code: "4101", debit: 0, credit: 100 },
        ],
        source_id: null,
        idempotency_key: null,
      })
    );
    if (forzado.ok) {
      mal("🔴 el RPC aceptó una cuenta INACTIVA");
    } else {
      ok("el RPC también la rechaza (segunda capa)");
      console.log(`     ${forzado.e.message}`);
    }

    // ═══════════════════════════════════════════════════════════════════════
    console.log("\n4) el gate contable: una compra con asiento no se edita ni se borra");
    // ═══════════════════════════════════════════════════════════════════════
    const conAsiento = (
      await c.query(
        `SELECT be.id, je.entry_number
           FROM business_expenses be
           JOIN journal_entries je ON je.source_type='gasto' AND je.source_id = be.id
          WHERE be.tenant_id=$1 LIMIT 1`,
        [TENANT]
      )
    ).rows[0];
    if (conAsiento) {
      ok("hay una compra con asiento para probar el gate", `asiento ${conAsiento.entry_number}`);
      console.log(
        "     ⚠️ El gate vive en la APLICACIÓN (`gateContable` en api/business-expenses.ts),\n" +
          "        no en la base: `business_expenses` no tiene trigger de inmutabilidad. Lo\n" +
          "        prueba `business-expense-gate.test.ts`; acá solo se confirma que el dato\n" +
          "        que el gate consulta existe y es alcanzable."
      );
    } else {
      mal("no hay ninguna compra con asiento en staging");
    }

    // ═══════════════════════════════════════════════════════════════════════
    console.log("\n5) el orden en el código: postear y deshacer si falla");
    // ═══════════════════════════════════════════════════════════════════════
    const src = readFileSync(resolve(ROOT, "src/lib/finanzas/api/business-expenses.ts"), "utf8");
    const crear = src.slice(src.indexOf("export async function createBusinessExpense"));
    const iInsert = crear.indexOf(".insert({");
    const iPost = crear.indexOf("await postJournalEntry(");
    const iDeshacer = src.indexOf("async function deshacerRegistro");
    if (iInsert > 0 && iPost > iInsert) {
      ok("el INSERT va antes del posteo (una compra no tiene ciclo borrador->emitir)");
    } else {
      mal("no se encontro el orden esperado", `insert@${iInsert} post@${iPost}`);
    }
    if (iDeshacer > 0 && crear.includes("deshacerRegistro(err)")) {
      ok("si el posteo falla, se deshace el registro con DELETE compensatorio");
    } else {
      mal("no hay DELETE compensatorio en el camino del fallo");
    }

    // ATENCION: esta comprobacion NO puede ser `!/postear antes de registrar/`.
    // El comentario contiene esa frase NEGADA, justamente para advertir que no
    // es lo que pasa, asi que un regex ingenuo da falso positivo — y lo dio la
    // primera vez que se corrio esto. Se verifica lo AFIRMATIVO.
    const encabezado = src.slice(0, src.indexOf("export async function createBusinessExpense"));
    const declaraOrdenReal = encabezado.includes("REGISTRAR \u2192 POSTEAR \u2192 DESHACER EL REGISTRO");
    const desmienteElOtro = encabezado.includes('No es "postear antes de registrar"');
    if (declaraOrdenReal && desmienteElOtro) {
      ok("el comentario declara el orden REAL y desmiente el de la factura");
    } else {
      mal("el comentario no describe el orden real",
          `declara=${declaraOrdenReal} desmiente=${desmienteElOtro}`);
    }
  } finally {
    await c.query("ROLLBACK");
    console.log("\n🔒 ROLLBACK — staging quedó como estaba");
    const q = await c.query(
      `SELECT (SELECT COUNT(*) FROM journal_entries WHERE tenant_id=$1) je,
              (SELECT COUNT(*) FROM business_expenses WHERE tenant_id=$1) compras,
              (SELECT COUNT(*) FROM expense_lines WHERE business_expense_id IS NOT NULL) lineas`,
      [TENANT]
    );
    console.log(
      `   asientos: ${q.rows[0].je} · compras: ${q.rows[0].compras} · líneas de compra: ${q.rows[0].lineas}`
    );
    await c.end();
  }

  console.log(fallos === 0 ? "\n✅ TODO OK\n" : `\n❌ ${fallos} FALLO(S)\n`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\n🛑 error inesperado:", e);
  process.exit(1);
});
