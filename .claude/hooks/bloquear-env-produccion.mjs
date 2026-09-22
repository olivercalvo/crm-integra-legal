#!/usr/bin/env node
// =============================================================================
// PreToolUse — ningún agente lee `.env.produccion.local`
// =============================================================================
// Ese archivo tiene las credenciales de PRODUCCIÓN del Supabase del bufete
// (`SUPABASE_SERVICE_ROLE_KEY`, que salta RLS). Existe para una sola cosa: que
// la tarea programada de Windows «Respaldo Base Integra» pueda correr
// `scripts/backup-supabase.mjs`. Ver `CLAUDE.md` §8.
//
// POR QUÉ UN HOOK Y NO SOLO REGLAS DE PERMISOS:
//   Las reglas `deny` de `permissions` cubren la herramienta Read por ruta, pero
//   NO cubren `cat`, `type`, `Get-Content`, `source`, `head`, `python -c open(…)`
//   ni ninguna de las cien formas de leer un archivo desde la shell. Una regla
//   `Bash(cat .env.produccion.local)` solo atrapa esa forma exacta. Este hook
//   mira el texto del comando entero, así que no depende de adivinar la forma.
//
// ALCANCE DELIBERADAMENTE GRUESO:
//   Rechaza CUALQUIER comando que NOMBRE el archivo, aunque solo quiera saber si
//   existe (`ls`, `git check-ignore`). Es a propósito: distinguir «leer» de
//   «mirar metadata» es heurístico y frágil, y del lado seguro se pierde poco.
//   Si hace falta un chequeo de metadata, lo corre una persona con `! <comando>`.
//
// LO QUE ESTE HOOK **NO** PUEDE HACER:
//   · No afecta nada fuera de Claude Code. La tarea programada de Windows corre
//     `C:\\Users\\Oliver\\OneDrive\\Backups\\Respaldar-Base-Integra.bat` y sigue
//     funcionando igual: los hooks solo existen dentro de una sesión.
//   · No impide que un script del repo lea el archivo por su cuenta. Por eso
//     también se rechaza invocar `backup-supabase.mjs` desde acá.
// =============================================================================

const PATRONES = [
  {
    re: /env[.\-_]?produccion[.\-_]?local/i,
    motivo:
      "`.env.produccion.local` tiene las credenciales de PRODUCCIÓN del Supabase del bufete " +
      "(service_role, que salta RLS). Ningún agente lo lee, lo carga ni lo nombra. " +
      "Existe solo para la tarea programada de Windows «Respaldo Base Integra», que corre " +
      "fuera de Claude Code y no se ve afectada.",
  },
  {
    // Solo una INVOCACIÓN, no una mención. El riesgo de este script es correrlo,
    // no nombrarlo: escribir su nombre en un commit, en un doc o en un grep es
    // legítimo y se hace todo el tiempo. El `(?!\s*-)` deja pasar `node -e "…"`,
    // que es un script inline y no una ejecución de este archivo.
    // (El patrón de arriba SÍ es estricto: ahí el riesgo es nombrar el archivo,
    // porque nombrarlo suele ser el primer paso para leerlo.)
    re: /(?:^|[;&|]\s*)[\w./\\-]*\b(?:node|npx|tsx|bun|sh|bash)\b(?!\s*-)[^;&|]*backup-supabase\.mjs/i,
    motivo:
      "ese script carga las credenciales de producción y se conecta a PRODUCCIÓN. " +
      "Lo corre la tarea programada de Windows, no un agente. " +
      "Si hace falta un respaldo fuera de horario, lo lanza una persona.",
  },
];

/** Solo los campos por los que se LEE algo. El contenido de Write/Edit no: un
 *  documento puede nombrar el archivo legítimamente (el runbook lo hace). */
function textoInspeccionable(toolName, input) {
  if (!input || typeof input !== "object") return "";
  const piezas = [];
  if (toolName === "Bash" || toolName === "PowerShell") {
    piezas.push(input.command);
  } else {
    piezas.push(input.file_path, input.path, input.pattern, input.glob);
  }
  return piezas.filter((p) => typeof p === "string").join("\n");
}

let crudo = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (crudo += c));
process.stdin.on("end", () => {
  let payload;
  try {
    payload = JSON.parse(crudo || "{}");
  } catch {
    process.exit(0); // payload ilegible: no es asunto de este hook
  }

  const texto = textoInspeccionable(payload.tool_name, payload.tool_input);
  const golpe = PATRONES.find((p) => p.re.test(texto));

  if (golpe) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: `🔴 BLOQUEADO por .claude/hooks/bloquear-env-produccion.mjs — ${golpe.motivo}`,
        },
      })
    );
  }
  process.exit(0);
});
