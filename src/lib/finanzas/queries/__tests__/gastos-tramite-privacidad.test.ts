/**
 * 🔒 LA PANTALLA CONTABLE DE UN GASTO DE TRÁMITE NO FILTRA EL EXPEDIENTE.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * QUÉ PROTEGE, Y POR QUÉ NO ES UN TEST DE DISEÑO
 * ═════════════════════════════════════════════════════════════════════════════
 * `/finanzas/gastos-tramite/{id}` existe porque el contador tiene que poder
 * llegar al documento que originó un asiento, y un gasto de trámite vive dentro
 * de un caso — en `/legal/casos/{id}`, donde el contador no entra.
 *
 * O sea: **esta pantalla es una puerta al módulo legal que el contador no
 * tenía.** Los casos del bufete son confidenciales. Decisión de Oliver del
 * 03/09/2026, textual: *"ampliar el acceso del contador al contenido legal por
 * la puerta de atrás sería un cambio de política del bufete, no una pantalla"*.
 *
 * El alcance aprobado:
 *
 *   ✅ monto, líneas, cuentas, fecha, proveedor (RUC y DV), vencimiento,
 *      comprobante, y el **NÚMERO** del caso.
 *   ❌ descripción del caso, partes, cliente, documentos, notas, historial.
 *
 * El número le alcanza para identificar el gasto en su papel de trabajo.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ SE VERIFICA LEYENDO EL CÓDIGO
 * ─────────────────────────────────────────────────────────────────────────────
 * Es una regla que ningún tipo de TypeScript sostiene: agregar
 * `description` al `select` compila perfecto, pasa code review si el diff es
 * grande, y nadie se enteraría hasta que un contador esté mirando la estrategia
 * procesal de un caso.
 *
 * Mismo criterio que `ruc-dv-separados.test.ts` y que los tests de enlaces de
 * `nav-guard.test.ts`: lo detecta una máquina, no una persona que revise la
 * pantalla con cada rol.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DÓNDE ESTÁ EL RECORTE (y por qué ahí)
 * ─────────────────────────────────────────────────────────────────────────────
 * En el `select` del query, NO en el JSX. Si el query trajera el caso entero y
 * la pantalla eligiera qué renderizar, el dato confidencial ya estaría en el
 * servidor y a un `{caso.description}` de distancia. Con el recorte en el query,
 * **el dato nunca sale de la base.**
 *
 * Ejecución:  npm test
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CAMPOS_DE_CASO_PERMITIDOS } from "@/lib/finanzas/queries/expense-tramite";
import { puedeAccederA, type Role } from "@/lib/auth/route-access";
import { RUTA_DEL_DOCUMENTO } from "@/lib/finanzas/reports/destino-documento";

const QUERY = "src/lib/finanzas/queries/expense-tramite.ts";
const PANTALLA = "src/app/finanzas/gastos-tramite/[id]/page.tsx";

function leer(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

/**
 * Los campos pedidos DENTRO del join a `cases`, y solo esos.
 *
 * ⚠️ La primera versión de este test miraba todos los `.select(...)` del archivo
 * pegados en una cadena, y marcó `description` — que es
 * `expense_lines.description`, perfectamente legítima. Un test que grita cuando
 * no hay nada roto se termina desactivando, así que se hizo PRECISO en vez de
 * agregarle una excepción: se extrae el contenido del embed `cases(...)` y se
 * compara el conjunto exacto de campos contra la lista aprobada.
 *
 * Ser preciso lo hace además más FUERTE: la comprobación es una lista BLANCA, así
 * que falla también con un campo de `cases` que a nadie se le hubiera ocurrido
 * prohibir de antemano. Una lista negra solo atrapa lo que ya se pensó.
 */
function camposDelJoinDeCasos(fuente: string): string[] {
  const campos: string[] = [];
  const re = /\bcases\s*(?:!\w+)?\s*\(([^()]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fuente)) !== null) {
    for (const bruto of m[1].split(",")) {
      const campo = bruto.trim();
      if (campo !== "") campos.push(campo);
    }
  }
  return campos;
}

// ===========================================================================
// 1. EL QUERY
// ===========================================================================

test("de `cases` solo está aprobado `case_code`", () => {
  assert.deepEqual(
    [...CAMPOS_DE_CASO_PERMITIDOS],
    ["case_code"],
    "agregar un campo acá es un cambio de política del bufete: tiene que decidirlo una persona, " +
      "no un diff"
  );
});

test("el `select` del query no trae ningún campo del caso más que el código", () => {
  const fuente = leer(QUERY);
  const pedidos = camposDelJoinDeCasos(fuente);

  assert.ok(pedidos.length > 0, "se esperaba un join a `cases` con columnas explícitas");
  assert.ok(
    !pedidos.includes("*"),
    "🔒 `cases(*)` traería el expediente entero al servidor"
  );

  // Lista BLANCA: cualquier campo que no esté aprobado es un hallazgo, incluso
  // uno que nadie pensó en prohibir.
  const permitidos = new Set<string>(CAMPOS_DE_CASO_PERMITIDOS);
  const filtrados = pedidos.filter((c) => !permitidos.has(c));

  assert.deepEqual(
    filtrados,
    [],
    `\n🔒 El query de la pantalla contable trae ${filtrados.length} campo(s) del caso que no ` +
      `puede ver:\n   ${filtrados.join(", ")}\n\n` +
      `   POR QUÉ IMPORTA\n` +
      `     Esta pantalla la abre el CONTADOR, que no entra a /legal. Los casos del\n` +
      `     bufete son confidenciales y el alcance aprobado el 03/09/2026 es el gasto\n` +
      `     más el NÚMERO del caso, nada más.\n\n` +
      `   SI HAY QUE AMPLIARLO\n` +
      `     Es una decisión de política del bufete, no un cambio de pantalla. Se\n` +
      `     habla con Oliver, se suma a CAMPOS_DE_CASO_PERMITIDOS y se saca de la\n` +
      `     lista de prohibidos de este test, en el mismo commit.\n`
  );
});

test("el query no lee otras tablas del expediente", () => {
  const fuente = leer(QUERY);
  // `cases` está en la lista, y es la más importante: la comprobación de arriba
  // mira el JOIN (`cases(...)`), así que un `.from("cases")` directo la
  // saltearía entera. Las otras cuatro son las tablas por las que se llega a
  // las partes, los documentos y las notas del expediente.
  const prohibidas = [
    "cases",
    "case_comments",
    "comments",
    "documents",
    "case_documents",
    "clients",
  ];
  const encontradas = prohibidas.filter((t) =>
    new RegExp(`from\\(\\s*["'\`]${t}["'\`]`).test(fuente)
  );
  assert.deepEqual(
    encontradas,
    [],
    `🔒 el query lee ${encontradas.join(", ")} directamente. El caso se lee SOLO por el ` +
      `join \`cases(case_code)\`, que es lo que la lista blanca de arriba verifica; ` +
      `un \`.from()\` propio esquiva esa comprobación. Notas, documentos y partes del ` +
      `expediente quedan fuera del alcance del contador.`
  );
});

// ===========================================================================
// 2. LA PANTALLA
// ===========================================================================

test("la pantalla no consulta la base por su cuenta", () => {
  // Todo lo que se ve pasa por el query recortado. Un `.from(...)` acá sería una
  // segunda puerta que este test no estaría mirando.
  const fuente = leer(PANTALLA);
  assert.ok(
    !/\.from\(\s*["'`]/.test(fuente),
    "🔒 la pantalla tiene que leer SOLO por `getGastoTramiteContable`, que es donde está el recorte"
  );
});

test("la pantalla NO enlaza al expediente", () => {
  // Un <Link> a /legal/casos/{id} sería la puerta de atrás en una línea: el
  // middleware se lo rebota al contador, y para la abogada sería un atajo que
  // esta pantalla no tiene por qué ofrecer. El número va como texto.
  const fuente = leer(PANTALLA);
  assert.ok(
    !/\/legal\//.test(fuente.replace(/^\s*\*.*$/gm, "")),
    "🔒 la pantalla no debe construir ninguna ruta /legal/*"
  );
});

// ===========================================================================
// 3. EL PERMISO Y EL ENLACE, QUE TIENEN QUE MOVERSE JUNTOS
// ===========================================================================

test("el contador abre el DETALLE, y solo el detalle", () => {
  const id = "11111111-2222-3333-4444-555555555555";
  assert.equal(
    puedeAccederA("contador", `/finanzas/gastos-tramite/${id}`),
    true,
    "sin esto el ícono del mayor le promete un documento y lo rebota"
  );
  assert.equal(
    puedeAccederA("contador", "/finanzas/gastos-tramite"),
    false,
    "no hay listado, y si alguien lo agrega el contador no lo hereda"
  );
  assert.equal(puedeAccederA("contador", `/finanzas/gastos-tramite/${id}/editar`), false);
  assert.equal(puedeAccederA("contador", "/finanzas/gastos-tramite/nuevo"), false);
});

test("el asistente no entra: es una pantalla de Finanzas", () => {
  const id = "11111111-2222-3333-4444-555555555555";
  assert.equal(puedeAccederA("asistente", `/finanzas/gastos-tramite/${id}`), false);
});

test("admin y abogada entran por el prefijo /finanzas", () => {
  const id = "11111111-2222-3333-4444-555555555555";
  for (const role of ["admin", "abogada"] as Role[]) {
    assert.equal(puedeAccederA(role, `/finanzas/gastos-tramite/${id}`), true);
  }
});

test("`gasto_tramite` enlaza a la pantalla nueva y NO a la de compras", () => {
  // Son dos tablas distintas. Compartir source_type mandaría un gasto de trámite
  // a /finanzas/gastos-bufete con un id que ahí no existe.
  const id = "abc";
  assert.equal(RUTA_DEL_DOCUMENTO.gasto_tramite?.(id), `/finanzas/gastos-tramite/${id}`);
  assert.equal(RUTA_DEL_DOCUMENTO.gasto?.(id), `/finanzas/gastos-bufete/${id}`);
  assert.notEqual(
    RUTA_DEL_DOCUMENTO.gasto_tramite?.(id),
    RUTA_DEL_DOCUMENTO.gasto?.(id),
    "si estos dos coinciden, uno de los dos documentos abre la pantalla equivocada"
  );
});
