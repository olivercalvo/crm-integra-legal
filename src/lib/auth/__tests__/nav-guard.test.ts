/**
 * EL SIDEBAR Y EL MIDDLEWARE TIENEN QUE DECIR LO MISMO.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUÉ PROBLEMA EVITA ESTE ARCHIVO
 * ─────────────────────────────────────────────────────────────────────────────
 * El 01/09/2026, con el contador del cliente a punto de entrar a staging, se
 * encontró que el sidebar le ofrecía "Plan de Cuentas" y el middleware lo
 * rebotaba a /finanzas/reportes. Un botón que existe y no lleva a ninguna parte
 * le hace dudar del resto del sistema a quien lo aprieta.
 *
 * No fue un descuido puntual: eran dos listas de permisos en dos archivos, sin
 * nada que las obligara a coincidir. Encontrarlo dependía de que una persona
 * recorriera el menú con cada rol, y eso no escala ni se repite.
 *
 * Mismo criterio que el guard de `amount_paid`: que lo detecte una máquina y no
 * una pantalla que alguien mire.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LOS DOS ERRORES SON DISTINTOS Y LOS DOS IMPORTAN
 * ─────────────────────────────────────────────────────────────────────────────
 *   · El menú OFRECE lo que el middleware rebota → botón roto. Se ve enseguida
 *     y hace perder la confianza.
 *   · El menú OCULTA lo que el middleware permite → permiso abierto que nadie
 *     revisó. No se ve nunca, y es el peligroso: esconder el botón no cierra el
 *     permiso, solo lo saca de la vista.
 *
 * Ejecución:
 *   npx tsx --test src/lib/auth/__tests__/nav-guard.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";

import { TABS } from "@/lib/nav-config";
import { puedeAccederA, type Role } from "@/lib/auth/route-access";

const ROLES: Role[] = ["admin", "abogada", "asistente", "contador"];

interface EntradaDeMenu {
  label: string;
  href: string;
  roles: readonly string[];
  tab: string;
}

/** Todas las entradas del menú, aplanadas, con el tab del que cuelgan. */
function entradasDeMenu(): EntradaDeMenu[] {
  const salida: EntradaDeMenu[] = [];
  for (const tab of TABS) {
    for (const item of tab.items) {
      salida.push({ label: item.label, href: item.href, roles: item.roles, tab: tab.label });
    }
  }
  return salida;
}

/** ¿El menú le muestra esta entrada a este rol? */
function elMenuLaMuestra(entrada: EntradaDeMenu, role: Role): boolean {
  return (entrada.roles as readonly string[]).includes(role);
}

test("ninguna entrada del menú lleva a una ruta que el middleware rebota", () => {
  const rotos: string[] = [];

  for (const entrada of entradasDeMenu()) {
    for (const role of ROLES) {
      if (!elMenuLaMuestra(entrada, role)) continue;
      if (puedeAccederA(role, entrada.href)) continue;
      rotos.push(
        `   · [${role}] "${entrada.label}" (${entrada.tab}) → ${entrada.href}` +
          `  — el menú lo ofrece y el middleware lo rebota`
      );
    }
  }

  assert.deepEqual(
    rotos,
    [],
    `\nHay ${rotos.length} entrada(s) de menú que no llevan a ninguna parte:\n${rotos.join("\n")}\n\n` +
      `   CÓMO SE ARREGLA\n` +
      `     O el rol debe entrar —y entonces se amplía el permiso en\n` +
      `     src/lib/auth/route-access.ts— o no debe, y entonces se saca el rol\n` +
      `     de esa entrada en src/lib/nav-config.ts. Lo que no puede quedar es\n` +
      `     el botón que rebota.\n`
  );
});

test("ninguna pantalla del menú queda accesible sin aparecer en el menú de ese rol", () => {
  // El caso inverso: el permiso está abierto pero el ítem está oculto. No se ve
  // en pantalla y por eso es el que sobrevive años.
  const ocultos: string[] = [];

  for (const entrada of entradasDeMenu()) {
    for (const role of ROLES) {
      if (elMenuLaMuestra(entrada, role)) continue;
      if (!puedeAccederA(role, entrada.href)) continue;
      ocultos.push(
        `   · [${role}] "${entrada.label}" (${entrada.tab}) → ${entrada.href}` +
          `  — accesible, pero oculto en el menú`
      );
    }
  }

  assert.deepEqual(
    ocultos,
    [],
    `\nHay ${ocultos.length} pantalla(s) accesibles que el menú no muestra:\n${ocultos.join("\n")}\n\n` +
      `   POR QUÉ IMPORTA\n` +
      `     Esconder el ítem NO cierra el permiso: escribir la URL a mano entra\n` +
      `     igual. O el rol debe verlo —y se agrega a nav-config.ts— o no debe, y\n` +
      `     entonces hay que cerrarlo de verdad en route-access.ts.\n`
  );
});

test("un tab visible para un rol tiene al menos una entrada que ese rol puede abrir", () => {
  // Un tab sin destinos útiles es una pestaña que se abre en un menú vacío.
  const vacios: string[] = [];

  for (const tab of TABS) {
    for (const role of ROLES) {
      if (!(tab.roles as readonly string[]).includes(role)) continue;
      const alcanzables = tab.items.filter(
        (i) => (i.roles as readonly string[]).includes(role) && puedeAccederA(role, i.href)
      );
      if (alcanzables.length === 0) {
        vacios.push(`   · [${role}] el tab "${tab.label}" no tiene ninguna entrada abrible`);
      }
    }
  }

  assert.deepEqual(vacios, [], `\n${vacios.join("\n")}\n`);
});

// ---------------------------------------------------------------------------
// Casos concretos, para que el archivo también documente el alcance de cada rol
// ---------------------------------------------------------------------------

test("el contador entra a lo suyo: reportes, gastos del bufete y configuración", () => {
  for (const ruta of [
    "/finanzas",
    "/finanzas/reportes",
    "/finanzas/reportes/mayor",
    "/finanzas/reportes/balance",
    "/finanzas/reportes/comprobacion",
    "/finanzas/reportes/diario",
    "/finanzas/reportes/aging",
    "/finanzas/reportes/estado-cuenta",
    "/finanzas/gastos-bufete",
    // Proveedores (02/09/2026): de ahí salen el RUC y el DV para los anexos de
    // renta, y el plazo con el que la antigüedad calcula los vencimientos.
    "/finanzas/proveedores",
    "/finanzas/proveedores/nuevo",
    "/finanzas/configuracion/cuentas",
    "/finanzas/configuracion/impuestos",
  ]) {
    assert.equal(puedeAccederA("contador", ruta), true, `el contador debería entrar a ${ruta}`);
  }
});

test("el contador NO entra a facturación, cotizaciones ni al módulo legal", () => {
  for (const ruta of [
    "/finanzas/facturas",
    "/finanzas/cotizaciones",
    "/finanzas/admin",
    "/legal",
    "/legal/casos",
    "/legal/clientes",
    "/legal/admin",
  ]) {
    assert.equal(puedeAccederA("contador", ruta), false, `el contador NO debería entrar a ${ruta}`);
  }
});

test("asientos y períodos son de admin y contador — la ABOGADA no entra", () => {
  // Son las dos únicas rutas de /finanzas cerradas a la abogada, y las dos
  // necesitan `ADMIN_CONTADOR_ONLY_PREFIXES` porque su `ROLE_ROUTES` le abre todo
  // `/finanzas`. Sin esa lista, el gate general la dejaría pasar.
  //
  // El criterio, el mismo en las dos: `updateChartAccount()` ya reserva a admin y
  // contador la reclasificación contable de una cuenta ("quien modifica la
  // clasificación contable de una cuenta debe ser el contador", guía de RM). Un
  // asiento manual escribe directo en el libro sin documento que lo respalde, y
  // cerrar un período le cambia el resultado a todo el sistema. Si la abogada no
  // puede lo menos, no puede lo más.
  for (const ruta of ["/finanzas/asientos", "/finanzas/periodos"]) {
    assert.equal(puedeAccederA("admin", ruta), true, `el admin entra a ${ruta}`);
    assert.equal(puedeAccederA("contador", ruta), true, `el contador entra a ${ruta}`);
    assert.equal(
      puedeAccederA("abogada", ruta),
      false,
      `🔒 la abogada NO debe entrar a ${ruta} — su ROLE_ROUTES le abre /finanzas, ` +
        `así que solo ADMIN_CONTADOR_ONLY_PREFIXES la puede dejar afuera`
    );
    assert.equal(puedeAccederA("asistente", ruta), false, `el asistente no entra a ${ruta}`);
  }
});

test("el gate de admin+contador cubre el subárbol, no solo la raíz", () => {
  // Va por PREFIJO y no por patrón: si mañana se agrega /finanzas/periodos/2026
  // o /finanzas/asientos/nuevo, quedan cubiertos sin tocar nada.
  assert.equal(puedeAccederA("abogada", "/finanzas/periodos/2026"), false);
  assert.equal(puedeAccederA("abogada", "/finanzas/asientos/nuevo"), false);
  assert.equal(puedeAccederA("contador", "/finanzas/periodos/2026"), true);
});

test("un prefijo vecino NO queda cerrado por parecerse", () => {
  // "/finanzas/periodos" no puede cerrar "/finanzas/periodos-informe".
  assert.equal(puedeAccederA("abogada", "/finanzas/periodos-informe"), true);
});

test("el asistente sigue con su alcance reducido del 24/08/2026", () => {
  assert.equal(puedeAccederA("asistente", "/legal/casos"), true);
  assert.equal(puedeAccederA("asistente", "/legal/pendientes"), true);
  assert.equal(puedeAccederA("asistente", "/legal/clientes/abc-123"), true, "la ficha puntual sí");
  assert.equal(puedeAccederA("asistente", "/legal/clientes"), false, "el directorio no");
  assert.equal(puedeAccederA("asistente", "/legal/gastos"), false);
  assert.equal(puedeAccederA("asistente", "/finanzas/reportes"), false);
});

test("solo el admin entra a los subárboles /admin", () => {
  for (const role of ROLES) {
    const esperado = role === "admin";
    assert.equal(puedeAccederA(role, "/legal/admin"), esperado);
    assert.equal(puedeAccederA(role, "/legal/admin/usuarios"), esperado);
    assert.equal(puedeAccederA(role, "/finanzas/admin"), esperado);
  }
});

test("un prefijo no cubre a otro que solo comparte el comienzo del texto", () => {
  // "/finanzas/reportes" no puede habilitar "/finanzas/reportes-secretos".
  assert.equal(puedeAccederA("contador", "/finanzas/reportes-internos"), false);
  assert.equal(puedeAccederA("asistente", "/legalotro"), false);
});

// ===========================================================================
// LOS ENLACES DENTRO DE LAS PANTALLAS  (01/09/2026)
// ===========================================================================
// Los tests de arriba comparan el SIDEBAR contra el middleware, y por eso no
// agarraron esto: el ícono "Abrir el documento que originó este movimiento" del
// Libro Mayor apuntaba a /finanzas/facturas/{id}, que el middleware le rebota al
// contador. El reporte al que sí entra prometía llevarlo a un documento y lo
// depositaba en otra pantalla, sin explicación — en SEIS de los diez asientos
// sembrados (los cuatro de factura y los dos de pago).
//
// Es la misma clase de error una capa más adentro: no en el menú, sino en los
// enlaces de CONTENIDO. Estos tests la cubren en sus dos formas.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";

import { rutasDeEjemplo } from "@/lib/finanzas/reports/destino-documento";

/** Reportes que llevan a documentos, con la ruta desde la que se enlaza. */
const REPORTES_CON_ENLACE_A_DOCUMENTO = [
  "/finanzas/reportes/mayor",
  // El Diario General enlaza al documento de cada asiento con las MISMAS rutas
  // (`destino-documento.ts`), así que hereda el mismo riesgo y la misma
  // verificación.
  "/finanzas/reportes/diario",
  // La Antigüedad abre cada documento pendiente desde la fila del tercero, y el
  // Estado de Cuenta desde cada movimiento. Los dos usan el mismo resolvedor, así
  // que entran a la misma verificación en vez de repetirla a mano.
  "/finanzas/reportes/aging",
  "/finanzas/reportes/estado-cuenta",
];

test("todo documento enlazado desde un reporte lo puede abrir quien ve el reporte", () => {
  const rotos: string[] = [];

  for (const reporte of REPORTES_CON_ENLACE_A_DOCUMENTO) {
    for (const role of ROLES) {
      if (!puedeAccederA(role, reporte)) continue; // no ve el reporte: nada que enlazar
      for (const { sourceType, ruta } of rutasDeEjemplo()) {
        if (puedeAccederA(role, ruta)) continue;
        rotos.push(
          `   · [${role}] ${reporte} enlaza un asiento de tipo "${sourceType}" a ${ruta},` +
            ` y el middleware se lo rebota`
        );
      }
    }
  }

  assert.deepEqual(
    rotos,
    [],
    `\n${rotos.length} enlace(s) de documento que no abren:\n${rotos.join("\n")}\n\n` +
      `   CÓMO SE ARREGLA\n` +
      `     O el rol debe poder abrir el documento —y se amplía el permiso en\n` +
      `     route-access.ts— o no debe verlo enlazado, y entonces hay que dejar\n` +
      `     el renglón sin enlace en vez de prometerlo.\n`
  );
});

// ---------------------------------------------------------------------------
// Enlaces literales escritos en el JSX de las pantallas
// ---------------------------------------------------------------------------

/** Todos los archivos .tsx bajo un directorio. */
function archivosTsx(dir: string): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) salida.push(...archivosTsx(ruta));
    else if (ruta.endsWith(".tsx") && !ruta.includes(".test.")) salida.push(ruta);
  }
  return salida;
}

/**
 * La ruta de la app que corresponde a un archivo del App Router.
 * `src/app/finanzas/reportes/mayor/page.tsx` → `/finanzas/reportes/mayor`.
 * Los `_components` cuelgan de su pantalla, así que se les corta ese tramo.
 */
function rutaDeArchivo(archivo: string): string | null {
  const partes = archivo.split(sep);
  const i = partes.indexOf("app");
  if (i === -1) return null;
  const tramos: string[] = [];
  for (const t of partes.slice(i + 1)) {
    if (t.startsWith("_")) break; // _components y similares: la ruta es la del padre
    if (t.endsWith(".tsx")) break;
    if (t.startsWith("(") || t.startsWith("@")) continue; // grupos y slots del router
    tramos.push(t.startsWith("[") ? "id-de-ejemplo" : t);
  }
  return "/" + tramos.join("/");
}

/**
 * `href="/algo"` literales. Se ignoran los dinámicos, los externos y los de API.
 *
 * ---------------------------------------------------------------------------
 * LA VÁLVULA: `nav-guard-ok`
 * ---------------------------------------------------------------------------
 * Este test lee TEXTO, no entiende JSX: no distingue un enlace que se renderiza
 * siempre de uno dentro de un `{canManageClient && ...}`, ni ve que el archivo
 * empiece con `if (rol === "asistente") return <OtraCosa />`. En su primera
 * corrida marcó cuatro enlaces que YA estaban correctamente gateados.
 *
 * Un test que grita cuando no hay nada roto se termina desactivando, y entonces
 * deja de proteger. Así que hay una salida — pero DECLARADA EN EL LUGAR, no en
 * una lista central que se pudre lejos del código:
 *
 *     {/* nav-guard-ok: el asistente no llega acá, ve AsistenteHome *\/}
 *     <Link href="/legal/clientes/nuevo">
 *
 * Vale en la misma línea o en las tres anteriores. Obliga a escribir el motivo,
 * se encuentra con un grep, y un enlace nuevo sin gate lo sigue cazando.
 */
function hrefsLiterales(contenido: string): string[] {
  const lineas = contenido.split("\n");
  const encontrados: string[] = [];

  lineas.forEach((linea, i) => {
    const matches = Array.from(linea.matchAll(/href="(\/[^"${}]*)"/g));
    if (matches.length === 0) return;

    const contexto = lineas.slice(Math.max(0, i - 3), i + 1).join("\n");
    if (contexto.includes("nav-guard-ok")) return;

    for (const m of matches) {
      const href = m[1];
      if (href !== "/" && !href.startsWith("/api/")) encontrados.push(href);
    }
  });

  return encontrados;
}

test("ninguna pantalla enlaza a una ruta que el middleware le rebota a quien la ve", () => {
  const rotos: string[] = [];
  const raiz = join(process.cwd(), "src", "app");

  for (const archivo of archivosTsx(raiz)) {
    const rutaPantalla = rutaDeArchivo(archivo);
    if (!rutaPantalla) continue;

    const hrefs = hrefsLiterales(readFileSync(archivo, "utf8"));
    if (hrefs.length === 0) continue;

    for (const role of ROLES) {
      // Solo interesa quien PUEDE ver la pantalla: los enlaces de una pantalla
      // que el rol no abre nunca los va a ver.
      if (!puedeAccederA(role, rutaPantalla)) continue;
      for (const href of hrefs) {
        if (puedeAccederA(role, href)) continue;
        rotos.push(
          `   · [${role}] ${rutaPantalla} → ${href}` +
            `\n     (${archivo.slice(archivo.indexOf("src"))})`
        );
      }
    }
  }

  assert.deepEqual(
    rotos,
    [],
    `\n${rotos.length} enlace(s) que llevan a una pantalla que ese rol no puede abrir:\n` +
      `${rotos.join("\n")}\n\n` +
      `   POR QUÉ IMPORTA\n` +
      `     Un enlace que rebota es peor que no tener el enlace: promete algo y\n` +
      `     deposita al usuario en otra pantalla sin decirle por qué.\n\n` +
      `   SI EL ENLACE YA ESTÁ GATEADO y este test no puede verlo —está dentro de\n` +
      `   un condicional, o el archivo hace un early return por rol— poné encima\n` +
      `   un comentario "nav-guard-ok: <motivo>". Ver hrefsLiterales().\n`
  );
});

test("el contador puede abrir el detalle de una factura, pero no el módulo de ventas", () => {
  const id = "11111111-2222-3333-4444-555555555555";
  assert.equal(puedeAccederA("contador", `/finanzas/facturas/${id}`), true, "el detalle sí");
  assert.equal(puedeAccederA("contador", "/finanzas/facturas"), false, "el listado no");
  assert.equal(puedeAccederA("contador", "/finanzas/facturas/nuevo"), false, "crear no");
  assert.equal(
    puedeAccederA("contador", `/finanzas/facturas/${id}/editar`),
    false,
    "editar no"
  );
});

// ===========================================================================
// LAS RUTAS DE EXPORTACIÓN  (02/09/2026)
// ===========================================================================
// Una exportación es tan sensible como la pantalla que la origina, y más fácil
// de olvidar: no aparece en el menú, así que ninguno de los tests de arriba la
// mira. Si mañana alguien agrega un rol a la pantalla del mayor y no a su
// export —o al revés— nadie se entera hasta que un contador ve un 403, o hasta
// que alguien baja un archivo que no debería.
//
// Estos tests LEEN las rutas y comparan su lista de roles contra el middleware.

/** Rutas de exportación, con la pantalla de la que salen. */
const EXPORTS = [
  {
    archivo: "src/app/api/finanzas/reportes/mayor/export/route.ts",
    pantalla: "/finanzas/reportes/mayor",
  },
  {
    archivo: "src/app/api/finanzas/reportes/aging/export/route.ts",
    pantalla: "/finanzas/reportes/aging",
  },
  {
    archivo: "src/app/api/finanzas/reportes/vat-summary/export/route.ts",
    pantalla: "/finanzas/reportes/vat-summary",
  },
];

/** Extrae la lista de roles declarada en el archivo de la ruta. */
function rolesDeclarados(fuente: string): string[] {
  const m = fuente.match(/const\s+(?:ROLES|READING_ROLES)\s*=\s*\[([^\]]*)\]/);
  if (!m) return [];
  return Array.from(m[1].matchAll(/"([a-z]+)"/g)).map((x) => x[1]);
}

test("cada exportación exige exactamente los roles que ven su pantalla", () => {
  const problemas: string[] = [];

  for (const { archivo, pantalla } of EXPORTS) {
    const fuente = readFileSync(join(process.cwd(), archivo), "utf8");
    const declarados = rolesDeclarados(fuente);

    if (declarados.length === 0) {
      problemas.push(`   · ${archivo} no declara ninguna lista de roles`);
      continue;
    }

    for (const role of ROLES) {
      const veLaPantalla = puedeAccederA(role, pantalla);
      const puedeExportar = declarados.includes(role);

      if (puedeExportar && !veLaPantalla) {
        problemas.push(
          `   · [${role}] puede EXPORTAR ${archivo} pero el middleware le rebota ${pantalla}` +
            " — la exportación es una puerta lateral"
        );
      }
      if (veLaPantalla && !puedeExportar) {
        problemas.push(
          `   · [${role}] ve ${pantalla} pero su exportación lo rechaza — el botón le va a fallar`
        );
      }
    }
  }

  assert.deepEqual(problemas, [], `\n${problemas.join("\n")}\n`);
});

test("ninguna ruta de exportación acepta un tenant_id por parámetro", () => {
  // El `tenant_id` sale SIEMPRE del perfil autenticado. Si una ruta lo leyera
  // del request, cualquiera podría bajarse los libros de otro bufete.
  const problemas: string[] = [];

  for (const { archivo } of EXPORTS) {
    const fuente = readFileSync(join(process.cwd(), archivo), "utf8");
    for (const patron of [
      /searchParams\.get\(\s*["']tenant/i,
      /sp\.get\(\s*["']tenant/i,
      /body\.tenant_id/i,
    ]) {
      if (patron.test(fuente)) {
        problemas.push(`   · ${archivo} lee el tenant del request`);
      }
    }
    if (!/ctx\.tenantId/.test(fuente)) {
      problemas.push(`   · ${archivo} no usa ctx.tenantId — ¿de dónde saca el bufete?`);
    }
  }

  assert.deepEqual(problemas, [], `\n${problemas.join("\n")}\n`);
});
