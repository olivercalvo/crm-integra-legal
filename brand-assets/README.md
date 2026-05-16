# Brand assets — Integra Legal (Chapman & Batista Asociados)

Carpeta con los archivos fuente de identidad de marca para Integra Legal.
**NO se sirven a clientes.** Para los usos web/PDF runtime, mirá `public/`.

## Archivos

### `Logo-Integra-2024.webp`

Logo principal del bufete. Formato WebP, 592 × 259 px, color navy
(#1B2A4A) sobre fondo blanco. Provisto por el cliente en 2024.

> ⚠️ **Trampa histórica:** el archivo original llegó nombrado
> `Logo-Integra-2024.jpg` aunque su contenido es WebP. Lo renombramos a
> `.webp` en este repo para evitar confusión a futuro. El archivo original
> con extensión `.jpg` queda untracked en la raíz del repo y se puede
> ignorar (no está commiteado).

## Derivados runtime (en `public/`)

### `public/integra-logo.png`

Versión PNG del logo, generada para `@react-pdf/renderer` que no soporta
WebP nativo. Mismas dimensiones (592 × 259 px). Lo embebe el componente
PDF en `src/lib/finanzas/pdf/QuoteDocument.tsx` y `CreditNoteDocument.tsx`.

## Proceso de conversión

Si en algún momento el cliente entrega un logo nuevo, regeneramos el PNG
así (desde la raíz del repo, requiere Python 3 + Pillow):

```bash
# 1. Guardá el nuevo archivo fuente como brand-assets/Logo-Integra-YYYY.webp
# 2. Ejecutá:
python -c "
from PIL import Image
img = Image.open('brand-assets/Logo-Integra-YYYY.webp')
img.convert('RGBA').save('public/integra-logo.png', 'PNG', optimize=True)
"
# 3. Verificá visualmente abriendo public/integra-logo.png
# 4. Commit ambos archivos juntos.
```

Si Pillow no está instalado en el sistema:
```bash
pip install Pillow
```

Otras alternativas si Pillow no es viable: `cwebp` + `ImageMagick`,
`sharp-cli` vía npm, o subir el WebP a un convertidor online (NO
recomendado por confidencialidad de marca, pero válido para una
emergencia).

## Histórico

| Fecha       | Cambio                                                       |
|-------------|--------------------------------------------------------------|
| 2026-05-16  | Logo inicial commiteado durante Sprint QUOTES-POLISH.        |
