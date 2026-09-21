/**
 * Verifica CONTRA STAGING el cableado cobro/pago → asiento.
 *
 *   npx tsx scripts/verificar-asiento-tesoreria.ts
 *
 * Mismos cinco pasos que factura y compra.
 *
 * 🛡️ TODO DENTRO DE UNA TRANSACCIÓN QUE TERMINA EN ROLLBACK.
 * ⚠️ SAVEPOINT alrededor de cada intento que debe fallar (`25P02`).
 * 🛑 CANDADO ANTI-PRODUCCIÓN.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

import {
  construirAsientoDeCobro,
  esCuentaDeBancoValida,
  type CobroParaAsiento,
} from "../src/lib/finanzas/contabilidad/asiento-tesoreria";

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

/** Replica `cargarCobroParaAsiento()` en SQL. El módulo que ARMA es el real. */
async function cargar(paymentId: string): Promise<CobroParaAsiento> {
  const p = (
    await c.query(
      `SELECT p.id, p.payment_number, p.payment_date, p.amount, p.payment_account_code, cl.name AS client_name,
              a.code, a.name AS cta_nombre, a.account_type, a.active
         FROM payments p
         JOIN clients cl ON cl.id = p.client_id
         LEFT JOIN chart_of_accounts a
                ON a.tenant_id = p.tenant_id AND a.code = p.payment_account_code
        WHERE p.tenant_id = $1 AND p.id = $2`,
      [TENANT, paymentId]
    )
  ).rows[0];

  const facturas = (
    await c.query(
      `SELECT i.invoice_number FROM payment_applications pa
         JOIN invoices i ON i.id = pa.invoice_id
        WHERE pa.tenant_id = $1 AND pa.payment_id = $2`,
      [TENANT, paymentId]
    )
  ).rows.map((r) => r.invoice_number as string);

  return {
    id: p.id,
    payment_number: p.payment_number ?? null,
    payment_date: new Date(p.payment_date).toISOString().slice(0, 10),
    amount: Number(p.amount),
    client_name: p.client_name,
    facturas,
    payment_account_code: p.payment_account_code,
    banco_valido: esCuentaDeBancoValida(
      p.code ? { code: p.code, name: p.cta_nombre, account_type: p.account_type, active: p.active } : null
    ),
  };
}

async function postear(a: {
  transaction_date: string;
  description: string;
  lines: { account_code: string; debit: number; credit: number; description?: string | null }[];
  source_id?: string | null;
  reference?: string | null;
  idempotency_key?: string | null;
  source_type?: string;
}) {
  const r = await c.query(
    `SELECT post_journal_entry($1,$2,$3,$4,$5::jsonb,$6,NULL,NULL,NULL,NULL,NULL,$7,$8) AS id`,
    [
      TENANT,
      a.transaction_date,
      a.description,
      a.source_type ?? "pago",
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

async function main() {
  await c.connect();
  await c.query("BEGIN");
  console.log("🔓 BEGIN\n");

  try {
    // ═══════════════════════════════════════════════════════════════════════
    console.log("0) crear un cobro NUEVO con banco");
    // ═══════════════════════════════════════════════════════════════════════
    const inv = (
      await c.query(
        `SELECT id, invoice_number, client_id FROM invoices
          WHERE tenant_id=$1 AND status='emitida' AND invoice_number LIKE 'FAC-HON%' LIMIT 1`,
        [TENANT]
      )
    ).rows[0];

    const nuevo = (
      await c.query(
        `INSERT INTO payments
           (tenant_id, client_id, payment_date, amount, currency, method,
            payment_account_code, reference, status)
         VALUES ($1,$2,'2026-09-04',500.00,'USD','transferencia','100002',
                 'Verificación 041','registrado')
         RETURNING id`,
        [TENANT, inv.client_id]
      )
    ).rows[0];
    await c.query(
      `INSERT INTO payment_applications (tenant_id, payment_id, invoice_id, amount_applied)
       VALUES ($1,$2,$3,500.00)`,
      [TENANT, nuevo.id, inv.id]
    );
    ok("cobro creado", `500.00 contra ${inv.invoice_number}, banco 100002`);

    // ═══════════════════════════════════════════════════════════════════════
    console.log("\n1) el cobro con banco postea y cuadra");
    // ═══════════════════════════════════════════════════════════════════════
    const cobro = await cargar(nuevo.id);
    const armado = construirAsientoDeCobro(cobro);
    if (!armado.ok) {
      mal("el módulo debía armar el asiento", armado.mensaje);
    } else {
      ok("el módulo arma el asiento");
      const l = armado.asiento.lines;
      if (l[0].account_code === "100002" && l[0].debit === 500) {
        ok("DEBE el banco ELEGIDO (100002, no la operativa por defecto)");
      } else {
        mal("el débito no fue al banco elegido", JSON.stringify(l[0]));
      }
      if (l[1].account_code === "100004" && l[1].credit === 500) {
        ok("HABER 100004 Cuentas por Cobrar");
      } else {
        mal("el crédito no es 100004", JSON.stringify(l[1]));
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
        if (Math.round(sd * 100) === Math.round(sc * 100) && sd === 500) {
          ok("cuadra y coincide con el monto del cobro", sd.toFixed(2));
        } else {
          mal("no cuadra", `D ${sd} C ${sc}`);
        }

        // ═══════════════════════════════════════════════════════════════════
        console.log("\n3) el reintento NO duplica");
        // ═══════════════════════════════════════════════════════════════════
        const r2 = await intento(() => postear(armado.asiento as never));
        if (r2.ok) {
          mal("🔴 el segundo posteo pasó: asiento DUPLICADO");
        } else {
          const code = (r2.e as unknown as { code?: string }).code;
          if (code === "23505") {
            ok("rechazado por un UNIQUE (23505)");
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
    console.log("\n2) un cobro SIN banco se rechaza nombrando el problema");
    // ═══════════════════════════════════════════════════════════════════════
    await c.query(`UPDATE payments SET payment_account_code = NULL WHERE id = $1`, [nuevo.id]);
    const sinBanco = await cargar(nuevo.id);
    const armadoMalo = construirAsientoDeCobro(sinBanco);
    if (armadoMalo.ok) {
      mal("🔴 debía RECHAZAR: el cobro no tiene banco");
    } else {
      ok("rechaza");
      console.log(`     motivo: ${armadoMalo.motivo}`);
      console.log(`     mensaje: ${armadoMalo.mensaje}`);
      /saldos de clientes/.test(armadoMalo.mensaje)
        ? ok("el mensaje explica POR QUÉ no se puede deducir")
        : mal("el mensaje no explica el motivo");
    }

    // Y una cuenta que existe pero no sirve como banco.
    await c.query(`UPDATE payments SET payment_account_code = '610001' WHERE id = $1`, [nuevo.id]);
    const malaCuenta = construirAsientoDeCobro(await cargar(nuevo.id));
    if (malaCuenta.ok) {
      mal("🔴 610001 es un GASTO y no puede recibir un cobro");
    } else {
      ok("una cuenta que no es de activo se rechaza", `motivo: ${malaCuenta.motivo}`);
    }

    // ═══════════════════════════════════════════════════════════════════════
    console.log("\n4) el gate: un cobro CON asiento no se borra");
    // ═══════════════════════════════════════════════════════════════════════
    const conAsiento = (
      await c.query(
        `SELECT p.id, je.entry_number FROM payments p
           JOIN journal_entries je ON je.source_type='pago' AND je.source_id = p.id
          WHERE p.tenant_id=$1 LIMIT 1`,
        [TENANT]
      )
    ).rows[0];
    if (!conAsiento) {
      mal("no hay ningún cobro con asiento en staging");
    } else {
      ok("hay un cobro con asiento", `asiento ${conAsiento.entry_number}`);
      // El gate vive en la APLICACIÓN. Acá se comprueba la CONSECUENCIA de que
      // no existiera: que la base sí deja borrar, y que borrarlo revierte la
      // factura mientras el asiento sigue en pie.
      const antes = (
        await c.query(
          `SELECT i.invoice_number, i.amount_paid, i.status
             FROM payment_applications pa JOIN invoices i ON i.id = pa.invoice_id
            WHERE pa.payment_id = $1 LIMIT 1`,
          [conAsiento.id]
        )
      ).rows[0];
      const r = await intento(async () => {
        await c.query(`DELETE FROM payments WHERE id = $1`, [conAsiento.id]);
        return (
          await c.query(`SELECT amount_paid, status FROM invoices WHERE invoice_number=$1`, [
            antes.invoice_number,
          ])
        ).rows[0];
      });
      if (r.ok) {
        console.log(
          `     sin el gate: ${antes.invoice_number} pasaría de ` +
            `${antes.amount_paid}/${antes.status} a ${r.v.amount_paid}/${r.v.status},`
        );
        console.log(`     mientras el asiento ${conAsiento.entry_number} sigue diciendo que se cobró.`);
        ok("por eso el gate está en deletePayment", "lo prueba payments-gate.test.ts");
      } else {
        ok("la base también lo impide", r.e.message);
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    console.log("\n5) el orden en el código es el que dice el comentario");
    // ═══════════════════════════════════════════════════════════════════════
    const src = readFileSync(resolve(ROOT, "src/lib/finanzas/api/payments.ts"), "utf8");
    const crear = src.slice(src.indexOf("export async function createPayment"));
    const iApp = crear.indexOf('.from("payment_applications")');
    const iPost = crear.indexOf("await postJournalEntry(");
    const iDeshacer = src.indexOf("async function deshacerCobro");

    if (iApp > 0 && iPost > iApp) {
      ok("el posteo va DESPUÉS de la aplicación del cobro");
    } else {
      mal("orden inesperado", `app@${iApp} post@${iPost}`);
    }
    if (iDeshacer > 0 && crear.includes("deshacerCobro(")) {
      ok("hay DELETE compensatorio en el camino del fallo");
    } else {
      mal("no hay DELETE compensatorio");
    }
    // 🔑 Lo medido: se borra SOLO el payment, el CASCADE hace el resto.
    const cuerpoDeshacer = src.slice(iDeshacer, iDeshacer + 900);
    const borraSoloElPago =
      cuerpoDeshacer.includes('.from("payments")') &&
      !cuerpoDeshacer.includes('.from("payment_applications")');
    if (borraSoloElPago) {
      ok("borra SOLO el payment y deja actuar al CASCADE", "el orden B que se midió");
    } else {
      mal("el compensatorio borra las dos filas: no es el orden que documenta el comentario");
    }
    if (src.includes("Los dos dan el mismo estado final")) {
      ok("el comentario registra la medición de los dos órdenes");
    } else {
      mal("falta la medición en el comentario");
    }
    // La distinción entre las dos familias de rutas tiene que estar escrita.
    const tes = readFileSync(
      resolve(ROOT, "src/lib/finanzas/contabilidad/asiento-tesoreria.ts"),
      "utf8"
    );
    if (tes.includes("client_payments") && tes.includes("NO POSTEA, Y NO DEBE")) {
      ok("la distinción payments vs client_payments está escrita en el código");
    } else {
      mal("falta la advertencia sobre client_payments");
    }
  } finally {
    await c.query("ROLLBACK");
    console.log("\n🔒 ROLLBACK — staging quedó como estaba");
    const q = await c.query(
      `SELECT (SELECT COUNT(*) FROM journal_entries WHERE tenant_id=$1) je,
              (SELECT COUNT(*) FROM payments WHERE tenant_id=$1) pagos,
              (SELECT COUNT(*) FROM payments WHERE tenant_id=$1 AND payment_account_code IS NOT NULL) con_banco`,
      [TENANT]
    );
    console.log(
      `   asientos: ${q.rows[0].je} · cobros: ${q.rows[0].pagos} · con banco: ${q.rows[0].con_banco}`
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
