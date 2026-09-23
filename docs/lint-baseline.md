# LISTA BASE DE LINT — 20 errores preexistentes

**Congelada el 2026-09-23.** Decisión de Oliver en el cierre del Bloque 9B.

## Para qué existe

`npm run lint` **nunca estuvo en cero**. Venía reportándose como "lint verde" en sesiones
anteriores y no lo estaba: los 20 errores de abajo ya existían y ninguno pertenece a los
bloques 8, 9A ni 9B. Todos son del módulo **Legal** y todos son del mismo tipo — un import o
una variable que quedó sin usar, y dos `prefer-const`.

**No se corrigen.** Son un barrido por código que nadie está tocando, y hacerlo al pasar mezcla
una limpieza con el trabajo del bloque. Cuándo limpiarlos lo decide Oliver.

## 🔴 El criterio, desde hoy

> **Cero errores NUEVOS fuera de esta lista.**

Y se reporta así — **no vuelve a decirse "lint verde" mientras esta lista exista**. La forma
correcta de reportarlo es *"lint: 0 errores nuevos; siguen los 20 de la lista base"*.

Lo verifica un script, para que no dependa de que alguien cuente a ojo:

```
node scripts/lint-contra-baseline.mjs
```

Sale con código **1** si aparece un error que no está acá. Compara por **archivo + regla +
símbolo**, no por número de línea: una línea agregada en otro lado del mismo archivo correría
los números y haría aparecer "errores nuevos" que no lo son.

Un error de esta lista que **desaparece** no es un problema: el script lo informa y sigue. Si
se arreglan todos, se borra el archivo y vuelve a valer "lint verde".

## La lista

| Archivo | Regla | Símbolo |
|---|---|---|
| `src/app/api/documents/upload/route.ts` | `@typescript-eslint/no-unused-vars` | `ext` |
| `src/app/legal/admin/page.tsx` | `@typescript-eslint/no-unused-vars` | `DollarSign` |
| `src/app/legal/casos/page.tsx` | `prefer-const` | `count` |
| `src/app/legal/casos/[id]/page.tsx` | `@typescript-eslint/no-unused-vars` | `Upload` |
| `src/app/legal/casos/[id]/page.tsx` | `@typescript-eslint/no-unused-vars` | `Button` |
| `src/app/legal/casos/[id]/page.tsx` | `@typescript-eslint/no-unused-vars` | `backUrl` |
| `src/app/legal/clientes/page.tsx` | `prefer-const` | `caseCounts` |
| `src/app/legal/page.tsx` | `@typescript-eslint/no-unused-vars` | `DEFAULT_CLASSIFICATION_COLORS` |
| `src/components/asistente/case-task-group.tsx` | `@typescript-eslint/no-unused-vars` | `caseId` |
| `src/components/cases/add-task-form.tsx` | `@typescript-eslint/no-unused-vars` | `Plus` |
| `src/components/cases/case-status-changer.tsx` | `@typescript-eslint/no-unused-vars` | `currentStatusName` |
| `src/components/clients/client-form.tsx` | `@typescript-eslint/no-unused-vars` | `classifications` |
| `src/components/expenses/expense-list.tsx` | `@typescript-eslint/no-unused-vars` | `Separator` |
| `src/components/layout/connectivity-indicator.tsx` | `@typescript-eslint/no-unused-vars` | `Wifi` |
| `src/components/seguimiento/seguimiento-view.tsx` | `@typescript-eslint/no-unused-vars` | `CardHeader` |
| `src/components/seguimiento/seguimiento-view.tsx` | `@typescript-eslint/no-unused-vars` | `CardTitle` |
| `src/components/tasks/task-list.tsx` | `@typescript-eslint/no-unused-vars` | `CardHeader` |
| `src/components/tasks/task-list.tsx` | `@typescript-eslint/no-unused-vars` | `CardTitle` |
| `src/lib/clients/__tests__/numbering.test.ts` | `@typescript-eslint/no-unused-vars` | `_cols` |
| `src/lib/utils/import-parser.ts` | `@typescript-eslint/no-unused-vars` | `sheetName` |

**20 errores en 16 archivos.** Los `warning` de `jsx-a11y/alt-text` en
`src/lib/finanzas/pdf/QuoteDocument.tsx` no entran acá: son avisos, no errores, y `next lint`
sale con 0 igual.

## Uno que se encontró y se dejó

`src/lib/utils/import-parser.ts` → `parseImportFile(buffer, sheetName?)`: el parámetro está
**muerto de verdad** — ningún llamador lo pasa y la función elige la hoja por regex. Se había
borrado y se revirtió, porque arreglar uno de veinte no devuelve el gate a verde y mete un
archivo ajeno en un commit del bloque fiscal. Queda anotado acá para cuando se haga la limpieza
completa.
