/**
 * Verifica CONTRA STAGING que cerrar un período por el mismo camino que la
 * pantalla hace que `post_journal_entry` rechace un asiento de ese mes.
 *
 *   npx tsx scripts/verificar-cierre-periodo.mts
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * POR QUÉ ESTE SCRIPT Y NO UN TEST MÁS
 * ═════════════════════════════════════════════════════════════════════════════
 * `periodos.route.test.ts` prueba que la ruta escriba `status='cerrado'` con un
 * fake. Lo que NO puede probar es la consecuencia: que ESE cambio, en la base de
 * verdad, haga que el motor rechace. Son dos piezas distintas —una ruta de Next y
 * una función de Postgres— y lo único que las conecta es una fila.
 *
 * Acá se recorre la cadena entera contra staging: se cierra con el MISMO UPDATE
 * que hace la ruta, se intenta postear, y se comprueba el rechazo.
 *
 * 🛡️ TODO DENTRO DE UNA TRANSACCIÓN QUE TERMINA EN ROLLBACK. No deja el período
 *    cerrado, no postea ningún asiento y no consume correlativo.
 *
 * ⚠️ El `BEGIN` es explícito y el `ROLLBACK` también. No alcanza con confiar en
 *    que el driver agrupe las sentencias: el 03/09 un script de verificación se
 *    escribió sin `BEGIN` y no persistió nada solo porque node-postgres manda el
 *    archivo entero en un `query()` y eso abre una transacción implícita. Salió
 *    bien por el driver, no por el script. Contra un ledger inmutable eso no se
 *    deja al azar.
 *
 * 🛑 CANDADO ANTI-PRODUCCIÓN: aborta si la URL no es la de staging.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

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
const client = new pg.Client({ connectionString: CONN });
await client.connect();

let fallos = 0;
const ok = (t: string, extra = "") => console.log(`  ✅ ${t}${extra ? " — " + extra : ""}`);
const mal = (t: string, extra = "") => {
  fallos++;
  console.log(`  ❌ ${t}${extra ? " — " + extra : ""}`);
};

let sp = 0;

/**
 * Postea un asiento de prueba. Devuelve null si entró, o el mensaje de error.
 *
 * ⚠️ Va envuelto en un SAVEPOINT, y no es un detalle: cuando el RPC lanza —que es
 * justo el caso que este script quiere provocar— PostgreSQL **aborta la
 * transacción entera** y todo lo que venga después falla con `25P02 current
 * transaction is aborted`. Sin el savepoint, el primer rechazo esperado mataba
 * los pasos 4 y 5.
 *
 * Con `ROLLBACK TO SAVEPOINT` se deshace solo el intento fallido y la transacción
 * externa sigue viva — que es lo que permite medir el antes y el después en una
 * sola corrida y revertir todo al final.
 */
async function intentarPostear(fecha: string): Promise<string | null> {
  const lineas = JSON.stringify([
    { account_code: "610001", debit: 25, credit: 0, description: "verificación de cierre" },
    { account_code: "200001", debit: 0, credit: 25, description: "verificación de cierre" },
  ]);
  const nombre = `sp_${++sp}`;
  await client.query(`SAVEPOINT ${nombre}`);
  try {
    await client.query(
      `SELECT public.post_journal_entry($1::uuid, $2::date, $3, 'manual', $4::jsonb)`,
      [TENANT, fecha, "Verificación de cierre de período", lineas]
    );
    await client.query(`RELEASE SAVEPOINT ${nombre}`);
    return null;
  } catch (e) {
    await client.query(`ROLLBACK TO SAVEPOINT ${nombre}`);
    return (e as Error).message;
  }
}

try {
  await client.query("BEGIN");

  const hoy = new Date();
  const anio = hoy.getUTCFullYear();
  const mes = hoy.getUTCMonth() + 1;
  const fecha = `${anio}-${String(mes).padStart(2, "0")}-15`;
  const codigo = `${anio}-${String(mes).padStart(2, "0")}`;

  console.log(`Período de prueba: ${codigo}\n`);

  // ── 1. Estado inicial ───────────────────────────────────────────────────
  const inicial = await client.query(
    `SELECT status, closed_at, closed_by FROM public.accounting_periods
      WHERE tenant_id = $1 AND year = $2 AND month = $3`,
    [TENANT, anio, mes]
  );
  if (inicial.rowCount !== 1) {
    mal("el período existe", `se encontraron ${inicial.rowCount} filas`);
    throw new Error("sin período que probar");
  }
  console.log("1) ANTES DE CERRAR");
  inicial.rows[0].status === "abierto"
    ? ok("el período está abierto")
    : mal("el período está abierto", `está ${inicial.rows[0].status}`);

  const antes = await intentarPostear(fecha);
  antes === null
    ? ok("un asiento de ese mes SE POSTEA")
    : mal("un asiento de ese mes se postea", antes);

  // ── 2. Cerrar con el MISMO UPDATE que hace la ruta ──────────────────────
  console.log("\n2) CERRAR — el mismo UPDATE de PATCH /api/finanzas/periodos");
  const usuario = await client.query(
    `SELECT id FROM public.users WHERE tenant_id = $1 AND role IN ('admin','contador') LIMIT 1`,
    [TENANT]
  );
  const userId = usuario.rows[0]?.id ?? null;

  await client.query(
    `UPDATE public.accounting_periods
        SET status = 'cerrado', closed_at = now(), closed_by = $4
      WHERE tenant_id = $1 AND year = $2 AND month = $3`,
    [TENANT, anio, mes, userId]
  );
  ok(`período ${codigo} cerrado`, `closed_by = ${userId ?? "null"}`);

  // ── 3. LA COMPROBACIÓN QUE IMPORTA ─────────────────────────────────────
  console.log("\n3) DESPUÉS DE CERRAR — lo que este script existe para medir");
  const despues = await intentarPostear(fecha);
  if (despues === null) {
    mal("el asiento de ese mes es RECHAZADO", "entró igual: el cierre no surtió efecto");
  } else if (despues.includes("CERRADO")) {
    ok("el asiento de ese mes es RECHAZADO", despues.trim());
  } else {
    mal("el asiento es rechazado POR EL CIERRE", `rechazado por otra razón: ${despues}`);
  }

  // ── 4. El cierre es por MES, no global ─────────────────────────────────
  console.log("\n4) OTRO MES, que sigue abierto");
  const mesVecino = mes === 1 ? 2 : mes - 1;
  const fechaVecina = `${anio}-${String(mesVecino).padStart(2, "0")}-15`;
  const vecino = await intentarPostear(fechaVecina);
  vecino === null
    ? ok("un asiento de otro mes sigue entrando", "el cierre es por período, no global")
    : mal("un asiento de otro mes sigue entrando", vecino);

  // ── 5. Reabrir devuelve la capacidad de postear ─────────────────────────
  console.log("\n5) REABRIR — solo `status`, conservando closed_at y closed_by");
  await client.query(
    `UPDATE public.accounting_periods SET status = 'abierto'
      WHERE tenant_id = $1 AND year = $2 AND month = $3`,
    [TENANT, anio, mes]
  );
  const reabierto = await client.query(
    `SELECT status, closed_at, closed_by FROM public.accounting_periods
      WHERE tenant_id = $1 AND year = $2 AND month = $3`,
    [TENANT, anio, mes]
  );
  const r = reabierto.rows[0];
  r.status === "abierto" && r.closed_at !== null
    ? ok("queda como REABIERTO", "status=abierto pero closed_at conservado")
    : mal("queda como reabierto", `status=${r.status} closed_at=${r.closed_at}`);

  const trasReabrir = await intentarPostear(fecha);
  trasReabrir === null
    ? ok("vuelve a aceptar asientos de ese mes")
    : mal("vuelve a aceptar asientos de ese mes", trasReabrir);
} finally {
  await client.query("ROLLBACK");
  await client.end();
}

console.log(
  fallos === 0
    ? "\n✅ 7/7 — el cierre por la pantalla SÍ hace que el motor rechace. ROLLBACK aplicado.\n"
    : `\n❌ ${fallos} comprobación(es) fallaron. ROLLBACK aplicado.\n`
);
process.exit(fallos === 0 ? 0 : 1);
