// Tests unitarios de isQuoteExpired (Sprint 2E.4 hot-fix Bug B).
//
// No tenemos Jest/Vitest configurado, así que duplicamos la lógica de la
// función bajo test acá adentro y verificamos los casos que importan.
// Si se rompe esta copia se rompe el script y el cambio se detecta vs.
// la fuente de verdad en src/lib/finanzas/queries/quote-portal.ts.
//
// Uso: node scripts/test-is-quote-expired.mjs
// Exit code 0 = OK, 1 = al menos un caso falló.

function todayInPanamaISO(now) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Panama",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function isQuoteExpired(validUntilIso, now = new Date()) {
  if (!validUntilIso) return false;
  const m = validUntilIso.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!m) return false;
  const validUntilDate = m[1];
  const today = todayInPanamaISO(now);
  return today > validUntilDate;
}

// `now` se fija en mediodía UTC para que el día Panamá (UTC-5) sea claro.
// Con 12:00 UTC = 07:00 Panamá, el día calendario coincide con la fecha UTC.
const fixedNow = (isoDateOnly) => new Date(`${isoDateOnly}T12:00:00Z`);

const cases = [
  {
    name: "vencida (7 días atrás)",
    valid_until: "2026-05-11",
    today: "2026-05-18",
    expected: true,
  },
  {
    name: "mismo día (NO vencida)",
    valid_until: "2026-05-18",
    today: "2026-05-18",
    expected: false,
  },
  {
    name: "futuro (NO vencida)",
    valid_until: "2026-06-17",
    today: "2026-05-18",
    expected: false,
  },
  {
    name: "valid_until con timestamp ISO completo",
    valid_until: "2026-05-11T00:00:00Z",
    today: "2026-05-18",
    expected: true,
  },
  {
    name: "string vacío (defensa: NO vencida)",
    valid_until: "",
    today: "2026-05-18",
    expected: false,
  },
  {
    name: "null (defensa: NO vencida)",
    valid_until: null,
    today: "2026-05-18",
    expected: false,
  },
  {
    name: "edge: día anterior",
    valid_until: "2026-05-17",
    today: "2026-05-18",
    expected: true,
  },
];

let failed = 0;
for (const c of cases) {
  const actual = isQuoteExpired(c.valid_until, fixedNow(c.today));
  const ok = actual === c.expected;
  if (!ok) failed++;
  const label = ok ? "✅" : "❌";
  console.log(
    `${label} ${c.name} — valid_until=${JSON.stringify(c.valid_until)} today=${c.today} expected=${c.expected} actual=${actual}`
  );
}

console.log("");
if (failed === 0) {
  console.log(`Todos los casos pasaron (${cases.length}/${cases.length}).`);
  process.exit(0);
} else {
  console.error(`${failed} de ${cases.length} casos fallaron.`);
  process.exit(1);
}
