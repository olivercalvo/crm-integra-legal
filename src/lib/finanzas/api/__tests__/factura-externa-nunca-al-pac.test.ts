/**
 * 🔴 UNA FACTURA EMITIDA FUERA NUNCA VA AL PAC Y NUNCA GASTA CORRELATIVO DEL 051 (092).
 *
 *   npm test
 *
 * Lee el código, igual que `ruc-dv-separados.test.ts`: es una regla que un tipo
 * de TypeScript no puede sostener. La base la sostiene además (guard de la 092,
 * que congela `fe_estado` de una factura externa).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { puedeAccederA } from "@/lib/auth/route-access";

const raiz = process.cwd();
const leer = (r: string) => readFileSync(join(raiz, r), "utf8");

const ARCHIVOS = [
  "src/lib/finanzas/api/facturas-externas.ts",
  "src/app/api/finanzas/facturas-externas/route.ts",
  "src/lib/finanzas/validators/factura-externa.ts",
  "src/lib/finanzas/efactura/cufe/leer-cufe.ts",
];

/** Quita los comentarios de bloque y de línea (aproximado, alcanza para esto). */
function sinComentarios(c: string): string {
  return c.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "");
}

const PROHIBIDOS = [
  "efactura/orchestration",
  "efactura/secuencias",
  "efactura/transport",
  "allocateFeNumero",
  "fe_secuencias",
];

test("ningún archivo del registro importa el orquestador, la secuencia del PAC ni el transporte", () => {
  for (const a of ARCHIVOS) {
    // Sólo el código: los comentarios explican justamente estas prohibiciones.
    const codigo = sinComentarios(leer(a));
    for (const prohibido of PROHIBIDOS) {
      assert.ok(!codigo.includes(prohibido), `${a} usa ${prohibido}`);
    }
  }
});

test("el registro va por el RPC de la 092 con el cliente de servicio, y el tenant sale del perfil", () => {
  const api = leer("src/lib/finanzas/api/facturas-externas.ts");
  assert.match(api, /ledgerDb\.rpc\("register_external_invoice"/);
  const ruta = leer("src/app/api/finanzas/facturas-externas/route.ts");
  assert.match(ruta, /createAdminClient\(ctx\.userId\)/);
  assert.match(ruta, /ctx\.tenantId/);
  assert.ok(!sinComentarios(ruta).includes("tenant_id"), "el tenant no puede venir del body");
});

test("admin y contador, nadie más: la ruta de API y la pantalla dicen lo mismo", () => {
  const ruta = leer("src/app/api/finanzas/facturas-externas/route.ts");
  const m = ruta.match(/const ROLES = \[([^\]]*)\]/);
  assert.ok(m, "la ruta declara sus roles");
  const roles = (m?.[1] ?? "")
    .split(",")
    .map((x) => x.trim().replace(/"/g, ""))
    .filter(Boolean)
    .sort();
  assert.deepEqual(roles, ["admin", "contador"]);
  for (const rol of ["admin", "contador"] as const) {
    assert.equal(puedeAccederA(rol, "/finanzas/facturas-externas"), true, rol);
    assert.equal(puedeAccederA(rol, "/finanzas/facturas-externas/nueva"), true, rol);
  }
  for (const rol of ["abogada", "asistente"] as const) {
    assert.equal(puedeAccederA(rol, "/finanzas/facturas-externas"), false, rol);
    assert.equal(puedeAccederA(rol, "/finanzas/facturas-externas/nueva"), false, rol);
  }
});

test("la pantalla de la factura no ofrece «Enviar a la DGI» ni el PDF del CRM a una externa", () => {
  const pagina = leer("src/app/finanzas/facturas/[id]/page.tsx");
  assert.ok(pagina.includes("canEmitToPac={canEmitToPac && !emitidaFuera}"));
  assert.ok(pagina.includes("emitidaFueraDelCrm: emitidaFuera"));
  assert.match(pagina, /\{!emitidaFuera && \(\s*<DownloadInvoicePdfButton/);
  const pdf = leer("src/app/api/finanzas/invoices/[id]/pdf/route.ts");
  assert.ok(pdf.includes('dgi_cufe_origen === "externo"'));
});

test("la migración congela el estado fiscal y sólo el RPC escribe 'externo'", () => {
  const sql = sinComentarios(leer("sql/pending/092_factura_emitida_fuera.sql"));
  assert.match(sql, /NEW\.fe_estado\s+IS DISTINCT FROM OLD\.fe_estado/);
  assert.ok(sql.includes("finanzas.registro_externo"));
  assert.ok(sql.includes("CREATE UNIQUE INDEX IF NOT EXISTS invoices_cufe_unico"));
  assert.ok(!/fe_secuencias|allocate_fe_numero/.test(sql), "la 092 no toca el correlativo del PAC");
});

test("«Enviar a la DGI» corta una externa PRIMERO, antes del mes anterior y de las validaciones previas", async () => {
  const { motivoParaNoEnviar } = await import("@/lib/finanzas/efactura/orchestration/enviar-a-la-dgi");
  assert.match(motivoParaNoEnviar("externo", "FE01X") ?? "", /emitió fuera del CRM/);
  assert.match(motivoParaNoEnviar("portal_050", "FE01X") ?? "", /ya existe ante la DGI/);
  assert.equal(motivoParaNoEnviar(null, null), null);
  assert.equal(motivoParaNoEnviar("crm", "  "), null);
  // El orden: si el mes anterior fuera primero, una externa de un mes viejo
  // diría «consultar con el contador»; si las validaciones fueran primero, a
  // una del mes en curso se le guardaría un motivo de pendiente.
  const src = leer("src/lib/finanzas/efactura/orchestration/enviar-a-la-dgi.ts");
  const cuerpo = src.slice(src.indexOf("async function antesDeEnviar"));
  const i = cuerpo.indexOf("motivoParaNoEnviar(");
  assert.ok(i > 0);
  assert.ok(i < cuerpo.indexOf("esDeUnMesAnterior("), "antes del mes anterior");
  assert.ok(i < cuerpo.indexOf("validarParaLaDgi("), "antes de las validaciones previas");
});

test("el badge fiscal no dice «Sin enviar» de una externa (listado y tarjeta)", () => {
  assert.ok(leer("src/components/finanzas/fe-estado-badge.tsx").includes('origen === "externo"'));
  const lista = leer("src/app/finanzas/facturas/_components/invoices-list.tsx");
  assert.equal((lista.match(/<FeEstadoBadge estado=\{inv\.fe_estado\} origen=\{inv\.dgi_cufe_origen\} \/>/g) ?? []).length, 2);
  assert.ok(leer("src/app/finanzas/facturas/_components/efactura-card.tsx").includes('origen={emitidaFuera ? "externo" : null}'));
});
