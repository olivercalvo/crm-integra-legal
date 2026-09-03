/**
 * QUIÉN PUEDE ENTRAR A QUÉ RUTA. Fuente única.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO NO VIVE YA DENTRO DE `middleware.ts`
 * ─────────────────────────────────────────────────────────────────────────────
 * Vivía ahí, y el 01/09/2026 se descubrió el costo: el sidebar (`nav-config.ts`)
 * le mostraba al contador "Plan de Cuentas", y el middleware lo rebotaba a
 * /finanzas/reportes. Un botón que existe y no lleva a ninguna parte no es un
 * detalle cosmético — le hace dudar del resto del sistema a quien lo aprieta, y
 * el que lo iba a apretar era el contador del cliente en su primera revisión.
 *
 * La causa no fue un descuido puntual: eran dos listas de permisos, en dos
 * archivos, que nadie obligaba a coincidir. Sacar las reglas acá permite que
 * `nav-guard.test.ts` cruce el menú contra ellas y falle si se separan. Un test
 * que duplicara las reglas no serviría: verificaría su propia copia.
 *
 * Módulo PURO: sin I/O, sin React, sin Supabase. Lo importan el middleware
 * (Edge runtime) y los tests.
 *
 * ⚠️ AL TOCAR ESTE ARCHIVO se mueven tres cosas juntas, como dice `CLAUDE.md`:
 * estas reglas, `nav-config.ts` y la tabla de permisos del propio `CLAUDE.md`.
 * Cambiar solo el menú esconde el botón pero deja el permiso abierto; cambiar
 * solo esto deja el botón que rebota.
 */

export type Role = "admin" | "abogada" | "asistente" | "contador";

const ROLES: readonly Role[] = ["admin", "abogada", "asistente", "contador"];

/**
 * ¿El valor que vino del JWT es un rol que este sistema conoce?
 *
 * Importa que sea explícito: un rol desconocido no debe caer al comportamiento
 * por defecto de un `?? "/"`, sino tratarse como sesión inválida. Un rol que el
 * código no conoce no tiene permisos definidos, y "sin permisos definidos" nunca
 * puede significar "los de todos".
 */
export function esRol(v: unknown): v is Role {
  return typeof v === "string" && (ROLES as readonly string[]).includes(v);
}

/**
 * Prefijos que cada rol puede acceder.
 *   "/"           — selector de módulos, abierto a todo rol autenticado.
 *   "/legal/*"    — módulo Legal: abogada, asistente y admin (NO contador).
 *   "/finanzas/*" — módulo Finanzas: abogada, admin y contador (NO asistente).
 */
export const ROLE_ROUTES: Record<Role, string[]> = {
  admin: ["/", "/legal", "/finanzas"],
  abogada: ["/", "/legal", "/finanzas"],
  asistente: ["/", "/legal"],
  contador: ["/", "/finanzas"],
};

/** Subárboles admin-only, gateados aparte de ROLE_ROUTES. */
export const ADMIN_ONLY_PREFIXES = ["/legal/admin", "/finanzas/admin"];

/**
 * Rutas admin-only que NO cuelgan de un subárbol `/admin`.
 *
 * `/finanzas/cotizaciones/configuracion` (Plantilla T&C) ya era admin-only,
 * pero el gate vivía DENTRO de la página, con un `redirect()` propio. Funcionaba
 * — la abogada entraba y salía rebotada— pero dejaba la regla en un tercer lugar
 * además del middleware y el menú, y por eso `nav-guard.test.ts` la marcaba como
 * un permiso abierto: desde afuera no hay forma de distinguir "gateado en la
 * página" de "no gateado". Se subió acá para que haya UNA respuesta a "quién
 * entra a qué". El redirect de la página se queda como defensa en profundidad.
 */
export const ADMIN_ONLY_ROUTES = ["/finanzas/cotizaciones/configuracion"];

/**
 * Rutas de /legal fuera del alcance del asistente.
 *
 * Clientes: puede abrir la FICHA de un cliente puntual (llega a ella desde el
 * detalle de un caso), pero NO el directorio completo ni las pantallas de
 * alta/edición. Por eso el gate es por ruta EXACTA y no por prefijo:
 * /legal/clientes/{id} tiene que seguir pasando.
 *
 * Gastos: fuera de su alcance por completo desde el 24/08/2026 (decisión de
 * negocio del cliente). Acá sí va por PREFIJO. Ocultarlo del menú no alcanza:
 * sin este patrón, escribir /legal/gastos a mano igual renderiza la pantalla.
 */
export const ASISTENTE_BLOCKED_PATTERNS: RegExp[] = [
  /^\/legal\/clientes\/?$/, // directorio
  /^\/legal\/clientes\/nuevo\/?$/, // alta
  /^\/legal\/clientes\/[^/]+\/editar\/?$/, // edición
  /^\/legal\/gastos(\/.*)?$/, // gastos — módulo completo
  // Agregadas el 01/09/2026 por la auditoría de `nav-guard.test.ts`.
  //
  // Estas tres YA estaban fuera del menú del asistente y fuera de la tabla de
  // permisos de CLAUDE.md ("ve SOLO tres pantallas: Dashboard, Casos y Mis
  // Pendientes"), pero NADIE las cerraba: ni el menú —que solo esconde—, ni el
  // middleware, ni las páginas. Escribiendo la URL a mano entraba.
  //
  // `/legal/importar` era el más serio de los tres: es la importación masiva,
  // que CLAUDE.md reserva a admin y abogada.
  /^\/legal\/seguimiento(\/.*)?$/,
  /^\/legal\/prospectos(\/.*)?$/,
  /^\/legal\/importar(\/.*)?$/,
];

/**
 * El contador es un rol especializado en cierre contable, y dentro de
 * /finanzas ve un subconjunto.
 *
 * `/finanzas/configuracion` se agregó el 01/09/2026. Dos motivos:
 *   1. La guía que entregó RM dice textual que quien modifica la clasificación
 *      contable de una cuenta debe ser el CONTADOR. El permiso estaba al revés
 *      de lo que el propio cliente pidió.
 *   2. El plan de cuentas es el documento de Josuarth — él mandó las 62 cuentas.
 *      Es lo primero que abre.
 * Cubre también `/finanzas/configuracion/impuestos`; ahí la EDICIÓN sigue siendo
 * admin-only, y eso se gatea en la ruta de API, no acá.
 */
export const CONTADOR_FINANZAS_ALLOWED_PREFIXES = [
  "/finanzas/reportes",
  "/finanzas/gastos-bufete",
  "/finanzas/configuracion",
  // Proveedores (02/09/2026). Es el maestro de datos que el contador usa para
  // los anexos de la declaración de renta —el RUC y el DV salen de acá— y de
  // donde sale el plazo con el que la antigüedad calcula los vencimientos.
  // Quien llena el formulario de la DGI tiene que poder corregir esos campos.
  "/finanzas/proveedores",
];

/**
 * Rutas SUELTAS de /finanzas que el contador puede abrir, fuera de sus prefijos.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EL DETALLE DE FACTURA, PERO NO EL MÓDULO DE FACTURAS
 * ─────────────────────────────────────────────────────────────────────────────
 * Auditar el Libro Mayor ES llegar al documento que originó cada movimiento: la
 * guía de RM lo pide en su lista de validación ("cada reporte permite llegar al
 * documento origen"). Sin esto, el ícono del mayor prometía abrir la factura y
 * depositaba al contador en /finanzas/reportes sin explicación — y afectaba a
 * SEIS de los diez asientos sembrados: los cuatro de factura y los dos de pago,
 * que enlazan a la factura que cancelaron.
 *
 * Lo que se abre es EXACTAMENTE el detalle y nada más:
 *   ✅ /finanzas/facturas/{id}
 *   ❌ /finanzas/facturas          (el listado sigue siendo del módulo de ventas)
 *   ❌ /finanzas/facturas/nuevo
 *   ❌ /finanzas/facturas/{id}/editar
 *
 * El `(?!nuevo$)` no es adorno: sin él, "nuevo" entra como si fuera un id.
 *
 * Y el detalle se abre en SOLO LECTURA: los botones de editar, emitir, eliminar,
 * anular y registrar pago se ocultan por rol en la propia pantalla, y las rutas
 * de API ya respondían 403. Se ocultan además de responder 403 porque un botón
 * que falla al apretarlo es la misma clase de error que este arreglo resuelve.
 *
 * Es el mismo patrón que el asistente con `/legal/clientes/{id}`: la ficha
 * puntual sí, el directorio no.
 */
export const CONTADOR_FINANZAS_ALLOWED_PATTERNS: RegExp[] = [
  /^\/finanzas\/facturas\/(?!nuevo$)[^/]+$/,
  // ───────────────────────────────────────────────────────────────────────────
  // Detalle de un GASTO DE TRÁMITE (03/09/2026)
  // ───────────────────────────────────────────────────────────────────────────
  // Un gasto de trámite vive en `/legal/casos/{id}`, y el contador NO entra a
  // /legal en absoluto. Pero sí entra al Libro Mayor, y la guía de RM pide que
  // "cada reporte permite llegar al documento origen": sin esta ruta, el ícono
  // del mayor le prometería abrir el gasto y lo depositaría en otra pantalla.
  // Es el mismo arreglo que el detalle de factura, un módulo más adelante.
  //
  // 🔒 La pantalla muestra el gasto y NADA del caso más que su código —
  // decisión de política del bufete, no de diseño. El recorte se hace en el
  // `select` de `queries/expense-tramite.ts` y lo fija
  // `gastos-tramite-privacidad.test.ts`.
  //
  // Es un PATRÓN y no un prefijo, igual que facturas: hoy no hay listado de
  // gastos de trámite bajo /finanzas, y si alguien agrega uno mañana el
  // contador NO lo hereda sin que alguien lo decida acá.
  //   ✅ /finanzas/gastos-tramite/{id}
  //   ❌ /finanzas/gastos-tramite        (no existe, y si existiera: no)
  //   ❌ /finanzas/gastos-tramite/{id}/editar   (es solo lectura)
  /^\/finanzas\/gastos-tramite\/(?!nuevo$)[^/]+$/,
];

/**
 * Rutas de `/finanzas` que SOLO ven admin y contador — la abogada NO.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ES EL PRIMER CASO DE SU TIPO, Y POR ESO NECESITA SU PROPIA LISTA
 * ─────────────────────────────────────────────────────────────────────────────
 * Hasta el 03/09/2026 el reparto de `/finanzas` era simple: admin y abogada
 * entran a todo por `ROLE_ROUTES`, y el contador a un subconjunto. Los asientos
 * de diario invierten eso por primera vez: **el contador sí, la abogada no.**
 *
 * Por qué la abogada queda afuera, y no es una preferencia:
 *
 *   · `updateChartAccount()` ya reserva a admin y contador la reclasificación
 *     contable de una cuenta, con el criterio textual de la guía de RM: "quien
 *     modifica la clasificación contable de una cuenta debe ser el contador".
 *   · Un asiento manual es MÁS sensible que reclasificar una cuenta: escribe
 *     directo en el libro **sin ningún documento que lo respalde**, y lo escrito
 *     es inmutable. Si la abogada no puede lo menos, no puede lo más.
 *
 * ⚠️ Va por PREFIJO y no por patrón, al revés que el detalle de factura del
 * contador: ahí se abría UNA pantalla dentro de un módulo cerrado; acá se cierra
 * un módulo entero dentro de uno abierto. El subárbol completo —listado, alta,
 * detalle— es de admin y contador.
 */
export const ADMIN_CONTADOR_ONLY_PREFIXES = ["/finanzas/asientos"];

/**
 * Home primaria por rol — destino cuando el rol no tiene acceso a la ruta.
 * El contador cae al hub de reportes, no al selector: es donde empieza a
 * trabajar.
 */
export const ROLE_HOME: Record<Role, string> = {
  admin: "/",
  abogada: "/",
  asistente: "/legal",
  contador: "/finanzas/reportes",
};

/** ¿`prefix` cubre a `pathname`? "/" solo cubre exactamente "/". */
function cubre(prefix: string, pathname: string): boolean {
  if (prefix === "/") return pathname === "/";
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

/**
 * ¿Este rol puede entrar a esta ruta?
 *
 * Replica el orden de decisión del middleware, que importa: el gate admin-only
 * corre ANTES que el del contador, y el del contador antes que el de prefijos
 * generales. Una ruta bajo /finanzas/admin no la salva estar en los prefijos
 * permitidos del contador.
 */
export function puedeAccederA(role: Role, pathname: string): boolean {
  // 1. Admin-only: subárboles /admin y rutas sueltas.
  if (
    ADMIN_ONLY_PREFIXES.some((p) => pathname.startsWith(p)) ||
    ADMIN_ONLY_ROUTES.some((p) => cubre(p, pathname))
  ) {
    return role === "admin";
  }

  // 2. Rutas de /finanzas reservadas a admin y contador. Va ANTES del gate del
  //    contador y del de prefijos generales: es la única forma de sacar a la
  //    abogada de una ruta que su `ROLE_ROUTES` le abriría.
  if (ADMIN_CONTADOR_ONLY_PREFIXES.some((p) => cubre(p, pathname))) {
    return role === "admin" || role === "contador";
  }

  // 3. El contador, dentro de /finanzas, solo en sus prefijos. El root
  //    /finanzas pasa: tiene un redirect por rol en su propia página.
  if (
    role === "contador" &&
    pathname.startsWith("/finanzas/") &&
    !CONTADOR_FINANZAS_ALLOWED_PREFIXES.some((p) => cubre(p, pathname)) &&
    !CONTADOR_FINANZAS_ALLOWED_PATTERNS.some((re) => re.test(pathname))
  ) {
    return false;
  }

  // 4. El asistente, dentro de /legal, con sus rutas bloqueadas.
  if (role === "asistente" && ASISTENTE_BLOCKED_PATTERNS.some((p) => p.test(pathname))) {
    return false;
  }

  // 5. Prefijos generales del rol.
  return (ROLE_ROUTES[role] ?? []).some((p) => cubre(p, pathname));
}
