/**
 * PRUEBAS DE SANDBOX DEL BLOQUE 9B — anulación ante la DGI.
 *
 *   npx tsx scripts/efactura/prueba-anulacion-sandbox.ts
 *
 * Responde de una sola pasada las tres preguntas que el código dejó abiertas a
 * propósito, y que no se pueden contestar leyendo el swagger porque el swagger
 * no describe ni un solo campo de estos dos endpoints:
 *
 *   PRUEBA 5   ¿Cómo se ve una anulación que la DGI ACEPTA?
 *              (`clasificar-respuesta-de-anulacion.ts` hoy manda todo lo que no
 *              reconoce a `indeterminada`, justamente para no adivinar.)
 *   PRUEBA (b) ¿Qué campo y qué valor muestran que un documento está ANULADO?
 *              (`anulacion-en-pac.ts` devuelve `anulado: null` hasta saberlo.)
 *   PRUEBA (a) ¿`CreateCancellation` es IDEMPOTENTE sobre un CUFE ya anulado?
 *              (De eso depende si el reintento puede ser automático — D3.)
 *
 * Y de yapa, según cómo salga la 5, responde la (c): si rechaza por plazo,
 * sabremos que la DGI cuenta las 182 horas desde un punto que ya pasó.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 ANTES DE CADA LLAMADA SE IMPRIME EL AMBIENTE
 * ─────────────────────────────────────────────────────────────────────────────
 * Es el pedido explícito de Oliver: el candado de `emisor-config` está bien,
 * pero quiere el `i_amb = 2` VISTO en cada prueba, no supuesto. El script
 * aborta si no es 2.
 *
 * NO toca la base: sólo habla con el PAC y escribe un informe en disco. Lo que
 * el CRM haga con esta información es una decisión posterior — si la DGI anula
 * el documento, `invoices.fe_estado` de staging queda desactualizado a
 * propósito, y eso se resuelve mirando el informe.
 */
import * as dotenv from "dotenv";
import { resolve } from "path";
import { writeFileSync } from "fs";

const AQUI = __dirname;
dotenv.config({ path: resolve(AQUI, "../../.env.local") });

import { get, post } from "../../src/lib/finanzas/efactura/transport/efactura-client";
import { clasificarRespuestaDeAnulacion } from "../../src/lib/finanzas/efactura/orchestration/clasificar-respuesta-de-anulacion";
import { leerEstadoDelDocumento } from "../../src/lib/finanzas/efactura/transport/anulacion-en-pac";

/** El CUFE de la única factura de staging que la DGI autorizó (17/09/2026). */
const CUFE = process.argv[2] ?? "FE0920000025046169-3-2021-4000002026091700000000010010121650905584";
const MOTIVO = "Prueba del Bloque 9B: anulacion en ambiente de pruebas";

const informe: string[] = [];

function anotar(linea: string) {
  console.log(linea);
  informe.push(linea);
}

/** 🔴 El candado que pidió Oliver. Se imprime y se verifica antes de cada llamada. */
function confirmarAmbiente(paso: string) {
  const iAmb = process.env.EFACTURA_I_AMB;
  const appEnv = process.env.NEXT_PUBLIC_APP_ENV;
  anotar(`\n🔒 [${paso}] AMBIENTE: EFACTURA_I_AMB = ${iAmb}  ·  NEXT_PUBLIC_APP_ENV = ${appEnv}`);
  if (iAmb !== "2") {
    throw new Error(
      `ABORTADO: EFACTURA_I_AMB = ${iAmb}. Esta prueba SOLO corre contra el sandbox (2).`
    );
  }
  if (appEnv === "production") {
    throw new Error("ABORTADO: NEXT_PUBLIC_APP_ENV = production.");
  }
}

function volcar(titulo: string, valor: unknown) {
  anotar(`\n${titulo}:`);
  anotar(JSON.stringify(valor, null, 2));
}

async function main() {
  anotar("═".repeat(78));
  anotar("PRUEBAS DE SANDBOX 9B — anulación ante la DGI");
  anotar(`fecha: ${new Date().toISOString()}`);
  anotar(`CUFE:  ${CUFE}`);
  anotar("═".repeat(78));

  // ── PRUEBA (b), parte 1: cómo se ve el documento ANTES ────────────────────
  confirmarAmbiente("b-antes");
  anotar("→ GET /api/v1/Invoices/Authorization/{cufe}  (estado ANTES de anular)");
  let antes: unknown = null;
  try {
    antes = await get(`/api/v1/Invoices/Authorization/${encodeURIComponent(CUFE)}`);
    volcar("RESPUESTA (antes)", antes);
    volcar("LEÍDA por leerEstadoDelDocumento", leerEstadoDelDocumento(antes));
  } catch (err) {
    anotar(`✗ falló el GET: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── PRUEBA 5: la anulación ────────────────────────────────────────────────
  confirmarAmbiente("prueba-5");
  anotar("→ POST /api/v1/InvoiceEvents/CreateCancellation  (primera vez)");
  let r1: unknown = null;
  try {
    r1 = await post("/api/v1/InvoiceEvents/CreateCancellation", {
      cufe: CUFE,
      cancellationReason: MOTIVO,
    });
    volcar("RESPUESTA (1ª anulación)", r1);
    volcar("CLASIFICADA como", clasificarRespuestaDeAnulacion(r1));
  } catch (err) {
    anotar(`✗ el POST lanzó: ${err instanceof Error ? err.message : String(err)}`);
    anotar("  (un HTTP no-2xx sale por acá: el cuerpo del error está en el mensaje)");
  }

  // ── PRUEBA (b), parte 2: qué cambió en el documento ───────────────────────
  confirmarAmbiente("b-despues");
  anotar("→ GET /api/v1/Invoices/Authorization/{cufe}  (estado DESPUÉS)");
  let despues: unknown = null;
  try {
    despues = await get(`/api/v1/Invoices/Authorization/${encodeURIComponent(CUFE)}`);
    volcar("RESPUESTA (después)", despues);
    volcar("LEÍDA por leerEstadoDelDocumento", leerEstadoDelDocumento(despues));

    // El diff es la respuesta de (b): qué campo cambió al anular.
    const a = (antes ?? {}) as Record<string, unknown>;
    const d = (despues ?? {}) as Record<string, unknown>;
    const cambios = Object.keys({ ...a, ...d }).filter(
      (k) => JSON.stringify(a[k]) !== JSON.stringify(d[k])
    );
    anotar(`\n🔴 CAMPOS QUE CAMBIARON AL ANULAR: ${cambios.length ? cambios.join(", ") : "(ninguno)"}`);
    for (const k of cambios) {
      anotar(`   ${k}: ${JSON.stringify(a[k])}  →  ${JSON.stringify(d[k])}`);
    }
  } catch (err) {
    anotar(`✗ falló el GET: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── PRUEBA (a): ¿es idempotente? ──────────────────────────────────────────
  confirmarAmbiente("prueba-a");
  anotar("→ POST /api/v1/InvoiceEvents/CreateCancellation  (SEGUNDA vez, mismo CUFE)");
  try {
    const r2 = await post("/api/v1/InvoiceEvents/CreateCancellation", {
      cufe: CUFE,
      cancellationReason: MOTIVO,
    });
    volcar("RESPUESTA (2ª anulación)", r2);
    volcar("CLASIFICADA como", clasificarRespuestaDeAnulacion(r2));
    anotar(
      `\n🔴 IDEMPOTENCIA: ${
        JSON.stringify(r1) === JSON.stringify(r2)
          ? "la segunda llamada devolvió LO MISMO que la primera"
          : "la segunda llamada devolvió algo DISTINTO (ver arriba)"
      }`
    );
  } catch (err) {
    anotar(`✗ la 2ª llamada lanzó: ${err instanceof Error ? err.message : String(err)}`);
    anotar("  🔴 IDEMPOTENCIA: NO — repetir la anulación da error.");
  }

  anotar("\n" + "═".repeat(78));
  anotar("FIN. Nada de esto tocó la base de datos.");
  anotar("═".repeat(78));

  const salida = resolve(AQUI, "../../docs/efactura/prueba-anulacion-sandbox.txt");
  writeFileSync(salida, informe.join("\n"), "utf8");
  console.log(`\n📄 informe: ${salida}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
