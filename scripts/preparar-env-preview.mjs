/**
 * Genera `.env.preview-sandbox.local` para pegar en Vercel Preview.
 *
 * NO IMPRIME NINGÚN VALOR. Sólo nombres y el resultado de las comprobaciones.
 */
import dotenv from "dotenv";
import { writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const RAIZ = process.cwd();
const ORIGEN = resolve(RAIZ, ".env.local");
const DESTINO = resolve(RAIZ, ".env.preview-sandbox.local");

if (!existsSync(ORIGEN)) {
  console.error("❌ No existe .env.local");
  process.exit(1);
}
dotenv.config({ path: ORIGEN });

/** Las 16 obligatorias de docs/efactura/variables-de-entorno.md. */
const OBLIGATORIAS = [
  "EFACTURA_API_KEY",
  "EFACTURA_API_BASE_URL",
  "EFACTURA_I_AMB",
  "EFACTURA_EMISOR_RUC",
  "EFACTURA_EMISOR_DV",
  "EFACTURA_EMISOR_TIPO_CONTRIBUYENTE",
  "EFACTURA_EMISOR_RAZON_SOCIAL",
  "EFACTURA_EMISOR_SUCURSAL",
  "EFACTURA_EMISOR_DIRECCION",
  "EFACTURA_EMISOR_UBICACION_CODIGO",
  "EFACTURA_EMISOR_CORREGIMIENTO",
  "EFACTURA_EMISOR_DISTRITO",
  "EFACTURA_EMISOR_PROVINCIA",
  "EFACTURA_EMISOR_PUNTO_FACTURACION",
  "EFACTURA_EMISOR_CPBS_HON",
  "EFACTURA_EMISOR_CPBS_REI",
];

/**
 * Las dos "opcionales" que SÍ van, y por qué:
 * viajan dentro de `informacionEmisor` (`map-emisor.ts:26-27`) y están en el
 * payload congelado. Sin ellas, el documento que sale de Preview NO es el mismo
 * que se verificó en el sandbox.
 */
const OPCIONALES_QUE_VAN = ["EFACTURA_EMISOR_TELEFONO", "EFACTURA_EMISOR_EMAIL"];

const TODAS = [...OBLIGATORIAS, ...OPCIONALES_QUE_VAN];
const SECRETAS = new Set(["EFACTURA_API_KEY"]);
const PROJECT_REF_PRODUCCION = "uqmmkklbhzxqybljiecs";

// ── Faltantes ──────────────────────────────────────────────────────────────
const faltan = TODAS.filter((n) => !process.env[n]);
if (faltan.length) {
  console.error(`❌ Faltan en .env.local: ${faltan.join(", ")}`);
  process.exit(1);
}

// ── Comprobaciones de seguridad ────────────────────────────────────────────
const url = String(process.env.EFACTURA_API_BASE_URL ?? "");
const comprobaciones = [
  {
    nombre: "EFACTURA_I_AMB = 2 (sandbox)",
    ok: String(process.env.EFACTURA_I_AMB).trim() === "2",
  },
  {
    // 🔴 EL HOSTNAME NO DICE EL AMBIENTE. Medido el 23/09/2026: la URL del PAC
    //    no lleva NINGUNA marca — ni "test" ni "prod" ni "sandbox". Así que
    //    deducir el ambiente del nombre del host es imposible, y una
    //    comprobación que lo intentara daría una seguridad falsa.
    //
    //    Lo que sí se puede es PREGUNTARLE AL PAC: cada respuesta trae `iAmb`.
    //    Eso se hace abajo, con una llamada de sólo lectura.
    nombre: "la URL no lleva marcas de producción en el nombre",
    ok: !/(^|[^a-z])prod(uccion|uction)?([^a-z]|$)|live/i.test(url),
  },
  {
    nombre: "NEXT_PUBLIC_APP_ENV no se incluye en el archivo",
    ok: !TODAS.includes("NEXT_PUBLIC_APP_ENV"),
  },
  {
    nombre: "ninguna variable apunta al project ref de producción",
    ok: TODAS.every((n) => !String(process.env[n] ?? "").includes(PROJECT_REF_PRODUCCION)),
  },
  {
    nombre: "ninguna variable de Supabase entra al archivo",
    ok: TODAS.every((n) => !n.includes("SUPABASE")),
  },
  {
    nombre: "el punto de facturación son 3 dígitos y no es 000",
    ok: /^[0-9]{3}$/.test(String(process.env.EFACTURA_EMISOR_PUNTO_FACTURACION ?? "")) &&
      String(process.env.EFACTURA_EMISOR_PUNTO_FACTURACION) !== "000",
  },
];

// ── 🔴 LA COMPROBACIÓN QUE VALE: preguntarle al PAC en qué ambiente está ──
//    Es de sólo lectura (un GET sobre un CUFE que ya existe) y es la única
//    prueba real de que esta URL habla con el sandbox y no con la DGI.
const CUFE_CONOCIDO =
  "FE0920000025046169-3-2021-4000002026091700000000010010121650905584";
let iAmbDelPac = null;
let errorDelPac = null;
try {
  const r = await fetch(
    `${url}/api/v1/Invoices/Authorization/${encodeURIComponent(CUFE_CONOCIDO)}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.EFACTURA_API_KEY}`,
        "Accept-Language": "es-PA",
      },
      cache: "no-store",
    }
  );
  const cuerpo = await r.json();
  iAmbDelPac = cuerpo?.rRetEnviFe?.iAmb ?? null;
} catch (err) {
  errorDelPac = err instanceof Error ? err.message : String(err);
}

comprobaciones.push({
  nombre: `el PAC que responde en esa URL dice iAmb = 2 (contestó: ${iAmbDelPac ?? errorDelPac ?? "(sin dato)"})`,
  ok: iAmbDelPac === 2,
});

const fallan = comprobaciones.filter((c) => !c.ok);

// ── El archivo ─────────────────────────────────────────────────────────────
if (fallan.length === 0) {
  const lineas = TODAS.map((n) => `${n}=${process.env[n]}`);
  writeFileSync(DESTINO, lineas.join("\n") + "\n", "utf8");
}

// ── El informe, sin valores ────────────────────────────────────────────────
console.log("\n| Variable | Secreta | NEXT_PUBLIC_ |");
console.log("|---|---|---|");
for (const n of TODAS) {
  console.log(`| \`${n}\` | ${SECRETAS.has(n) ? "🔴 sí" : "no"} | ${n.startsWith("NEXT_PUBLIC_") ? "SÍ" : "no"} |`);
}
console.log(`\nvariables escritas: ${TODAS.length} (16 obligatorias + 2 que viajan en el documento)`);
console.log(`de ellas NEXT_PUBLIC_: ${TODAS.filter((n) => n.startsWith("NEXT_PUBLIC_")).length}`);

console.log("\n--- COMPROBACIONES ---");
for (const c of comprobaciones) console.log(`${c.ok ? "✅" : "❌"} ${c.nombre}`);

if (fallan.length) {
  console.error(`\n❌ ${fallan.length} comprobación(es) FALLARON. El archivo NO se escribió.`);
  process.exit(1);
}
console.log(`\n✅ escrito: .env.preview-sandbox.local`);
