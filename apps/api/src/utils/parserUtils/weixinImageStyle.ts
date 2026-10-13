// linkedom exposes !important as part of the value and does not implement
// getPropertyPriority. Resolve duplicate declarations before choosing a size.
function readStyle(style: string): Map<string, string> {
  const result = new Map<string, string>()
  for (const declaration of style.split(';')) {
    const colon = declaration.indexOf(':')
    if (colon < 0) continue
    const name = declaration.slice(0, colon).trim()
    const property = name.startsWith('--') ? name : name.toLowerCase()
    const value = declaration.slice(colon + 1).trim()
    if (!property || !value) continue
    if (/!important\s*$/i.test(result.get(property) || '') && !/!important\s*$/i.test(value)) continue
    // Keep the winning declaration's position relative to shorthands.
    result.delete(property)
    result.set(property, value)
  }
  return result
}

function styleValue(style: Map<string, string>, property: string): string {
  return (style.get(property) || '').replace(/\s*!important\s*$/i, '').trim()
}

function positiveNumber(value: string): number | undefined {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : undefined
}

function pixelWidth(value: string): number | undefined {
  return /^\d*\.?\d+px$/i.test(value) ? positiveNumber(value.slice(0, -2)) : undefined
}

function isLength(value: string): boolean {
  return /^(?:\d*\.)?\d+(?:px|em|rem|%|vw|vh|vmin|vmax|ch|ex|cm|mm|in|pt|pc)$/i.test(value) && parseFloat(value) > 0
}

function hasSize(value: string): boolean {
  return !!value && !/^(auto|none|initial|inherit|unset|revert(?:-layer)?)$/i.test(value)
}

function attributeSize(img: HTMLImageElement, property: string): string {
  const number = positiveNumber(img.getAttribute(property) || '')
  return number ? `${number}px` : ''
}

function derivedPixelWidth(img: HTMLImageElement, height: string): number | undefined {
  const heightPx = pixelWidth(height)
  const ratio = positiveNumber(img.getAttribute('data-ratio') || '')
  const width = heightPx && ratio ? heightPx / ratio : undefined
  return width && Number.isFinite(width) ? width : undefined
}

export function prepareWeixinImageStyle(img: HTMLImageElement): void {
  img.setAttribute('slax-style', img.getAttribute('style') || '')
  const style = readStyle(img.getAttribute('style') || '')
  let width = styleValue(style, 'width') || attributeSize(img, 'width')
  if (!hasSize(width)) {
    const derived = derivedPixelWidth(img, styleValue(style, 'height') || attributeSize(img, 'height'))
    if (derived) width = `${derived}px`
  }
  // Readability 0.6.5 expects plain px/% values; linkedom otherwise includes
  // !important or resolves duplicates differently. The backup keeps priority.
  if (pixelWidth(width) || /^\d*\.?\d+%$/.test(width)) style.set('width', width.toLowerCase())
  img.setAttribute('style', Array.from(style, ([property, value]) => `${property}: ${value}`).join('; '))
}

/** Preserve the author's display size before making ordinary images responsive. */
export function restoreWeixinImageStyle(img: HTMLImageElement): void {
  const current = readStyle(img.getAttribute('style') || '')
  const original = readStyle(img.getAttribute('slax-style') ?? img.getAttribute('style') ?? '')
  const width = styleValue(original, 'width') || attributeSize(img, 'width')
  const height = styleValue(original, 'height') || attributeSize(img, 'height')
  const generatedWidth = pixelWidth(styleValue(current, 'width'))
  const widthPx = pixelWidth(width)
  let displayWidth = ''
  let displayHeight = ''

  if (widthPx) {
    // Keep Readability's parent constraint, but never enlarge an explicit size
    // just because it failed to parse e.g. "24px !important".
    displayWidth = `${Math.min(widthPx, generatedWidth ?? widthPx)}px`
  } else if (isLength(width)) {
    displayWidth = width.endsWith('%') && generatedWidth ? `${generatedWidth}px` : width
  } else if (!hasSize(width) && hasSize(height)) {
    // A generated width based on data-w must not overwrite a height-only icon.
    const derivedWidth = derivedPixelWidth(img, height)
    if (derivedWidth) {
      displayWidth = `${Math.min(derivedWidth, generatedWidth ?? derivedWidth)}px`
    } else {
      displayWidth = 'auto'
      displayHeight = height
    }
  } else if (hasSize(width)) {
    // Unknown expressions/units are not evidence that data-w is the intended
    // size. Keep the author's declarations rather than guessing.
    displayWidth = width
    displayHeight = height
  } else if (generatedWidth) {
    displayWidth = `${generatedWidth}px`
  }

  if (displayWidth && !displayHeight && isLength(displayWidth)) {
    const objectFit = styleValue(original, 'object-fit')
    displayHeight = hasSize(height) && /^(cover|contain|none|scale-down)$/i.test(objectFit) ? height : 'auto'
    const maxWidth = styleValue(original, 'max-width')
    // Preserve tighter author limits while still fitting the reader container.
    const limit = !maxWidth || /^(none|initial|unset|inherit)$/i.test(maxWidth) ? '100%' : maxWidth
    original.set('max-width', `${limit === '100%' ? limit : `min(100%, ${limit})`} !important`)
  }

  if (displayWidth) original.set('width', `${displayWidth} !important`)
  if (displayHeight) original.set('height', `${displayHeight} !important`)
  for (const property of ['opacity', 'display', 'visibility']) original.delete(property)
  img.setAttribute('style', Array.from(original, ([property, value]) => `${property}: ${value}`).join('; '))
  img.removeAttribute('slax-style')
  img.removeAttribute('data-original-style')
}
