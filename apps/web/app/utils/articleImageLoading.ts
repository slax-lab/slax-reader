import { defaultTreeAdapter, html as parse5Html, parseFragment } from 'parse5'
import type { DefaultTreeAdapterTypes } from 'parse5'

type Element = DefaultTreeAdapterTypes.Element
type Node = DefaultTreeAdapterTypes.Node

const HTML_NS = parse5Html.NS.HTML
const TEXT_LIMIT = 600
const SMALL_IMAGE_LIMIT = 96
const ASCII_SPACE = /[\t\n\f\r ]/
const IMAGE_CLASSES = new Set(['avatar', 'icon', 'emoji', 'logo', 'profile-image', 'zhihu-qa-avatar'])
const HEADER_CLASSES = new Set(['tweet-header', 'quote-header', 'zhihu-qa-user'])
const INERT_TAGS = new Set(['script', 'style', 'template', 'noscript'])

export interface ArticleImageLoadingOptions {
  enabled: boolean
  excludedPresentation: boolean
}

interface Patch {
  start: number
  end: number
  value: string
}
interface Declaration {
  value: string
  important: boolean
}

const isElement = (node: Node): node is Element => 'tagName' in node
const attr = (element: Element, name: string) => element.attrs.find(item => item.name === name)?.value
const classes = (element: Element) => (attr(element, 'class') || '').split(/[\t\n\f\r ]+/).map(token => token.replace(/^oc-/, ''))

// Split declarations without interpreting separators inside strings, comments or functions.
function styleParts(style: string): string[] {
  const parts: string[] = []
  let part = ''
  let quote = ''
  let depth = 0
  for (let index = 0; index < style.length; index++) {
    const char = style[index]!
    if (quote) {
      part += char
      if (char === '\\') part += style[++index] || ''
      else if (char === quote) quote = ''
    } else if (char === '/' && style[index + 1] === '*') {
      const end = style.indexOf('*/', index + 2)
      if (end === -1) break
      part += ' '
      index = end + 1
    } else if (char === '"' || char === "'") {
      quote = char
      part += char
    } else if (char === '(' || char === '[') {
      depth++
      part += char
    } else if (char === ')' || char === ']') {
      depth--
      part += char
    } else if (char === ';' && depth === 0) {
      parts.push(part)
      part = ''
    } else part += char
  }
  parts.push(part)
  return parts
}

function styles(element: Element): Map<string, Declaration> {
  const result = new Map<string, Declaration>()
  for (const part of styleParts(attr(element, 'style') || '')) {
    const colon = part.indexOf(':')
    if (colon < 0) continue
    const name = part.slice(0, colon).trim().toLowerCase()
    const raw = part.slice(colon + 1).trim()
    const important = /!\s*important\s*$/i.test(raw)
    const value = raw.replace(/!\s*important\s*$/i, '').trim().toLowerCase()
    if (!value) continue
    const previous = result.get(name)
    if (!previous || important || !previous.important) result.set(name, { value, important })
  }
  return result
}

function positivePx(value: string | undefined): number | undefined {
  if (!value || !/^[+]?(?:\d*\.\d+|\d+)(?:e[+-]?\d+)?px$/i.test(value)) return undefined
  const number = Number(value.slice(0, -2))
  return number > 0 && Number.isFinite(number) ? number : undefined
}

function positiveDimension(value: string | undefined): number | undefined {
  if (!value || !/^\s*\d+(?:\.\d+)?\s*$/.test(value)) return undefined
  const number = Number(value)
  return number > 0 && Number.isFinite(number) ? number : undefined
}

function isSmall(element: Element, declarations: Map<string, Declaration>): boolean {
  for (const axis of ['width', 'height']) {
    // An authored display size supersedes that axis's HTML presentational hint.
    const size = declarations.has(axis) ? positivePx(declarations.get(axis)?.value) : positiveDimension(attr(element, axis))
    const maximum = positivePx(declarations.get(`max-${axis}`)?.value)
    if ((size !== undefined && size <= SMALL_IMAGE_LIMIT) || (maximum !== undefined && maximum <= SMALL_IMAGE_LIMIT)) return true
  }
  return false
}

function responsive(element: Element): boolean {
  if (attr(element, 'srcset')?.trim()) return true
  const parent = element.parentNode
  return Boolean(parent && isElement(parent) && parent.namespaceURI === HTML_NS && parent.tagName === 'picture'
    && parent.childNodes.some(child => isElement(child) && child.namespaceURI === HTML_NS && child.tagName === 'source' && attr(child, 'srcset')?.trim()))
}

function selectImages(fragment: DefaultTreeAdapterTypes.DocumentFragment): { images: Element[]; selected: Element | null } {
  const images: Element[] = []
  let selected: Element | null = null
  let stopped = false
  let text = 0
  const stack: { node: Node; hidden: boolean; header: boolean; inert: boolean }[] = [{ node: fragment, hidden: false, header: false, inert: false }]
  while (stack.length) {
    const item = stack.pop()!
    const { node } = item
    let { hidden, header, inert } = item
    if (isElement(node)) {
      const declarations = styles(node)
      hidden ||= attr(node, 'hidden') !== undefined || declarations.get('display')?.value === 'none' || declarations.get('visibility')?.value === 'hidden'
      inert ||= INERT_TAGS.has(node.tagName)
      const tokens = classes(node)
      if (node.namespaceURI === HTML_NS && node.tagName === 'img' && !inert) {
        images.push(node)
        const source = attr(node, 'src')?.trim() || ''
        const hasSource = source !== '' && !/^(?:data:|blob:)/i.test(source)
        if (!selected && !stopped && text < TEXT_LIMIT && !hidden && !header && !isSmall(node, declarations) && !tokens.some(token => IMAGE_CLASSES.has(token))) {
          // A source-only picture is still a real responsive resource: do not leap over it.
          if (responsive(node) && (hasSource || !source)) stopped = true
          else if (hasSource) selected = node
        }
      }
      header ||= tokens.some(token => HEADER_CLASSES.has(token))
    } else if (node.nodeName === '#text' && !hidden && !inert && !selected && !stopped) {
      for (const point of (node as DefaultTreeAdapterTypes.TextNode).value) {
        if (!/\s/u.test(point)) text++
        if (text >= TEXT_LIMIT) break
      }
    }
    if ('childNodes' in node) {
      for (let index = node.childNodes.length - 1; index >= 0; index--) stack.push({ node: node.childNodes[index]!, hidden, header, inert })
    }
  }
  return { images, selected }
}

// Attribute tokenization follows HTML's ASCII whitespace and quote rules, including
// slash characters in unquoted values. Only policy tokens are replaced or removed.
function imagePatches(html: string, image: Element, eager: boolean): Patch[] {
  const location = image.sourceCodeLocation?.startTag
  if (!location || !Number.isInteger(location.startOffset) || !Number.isInteger(location.endOffset)
    || location.startOffset < 0 || location.endOffset <= location.startOffset || location.endOffset > html.length
    || image.sourceCodeLocation?.startOffset !== location.startOffset) throw new Error('Missing image source span')
  for (const source of Object.values(image.sourceCodeLocation?.attrs || {})) {
    if (source.startOffset < location.startOffset || source.endOffset > location.endOffset) throw new Error('Ambiguous image attribute span')
  }
  const tag = html.slice(location.startOffset, location.endOffset)
  const opening = /^<(?:img|image)(?=[\t\n\f\r />])/i.exec(tag)
  if (!opening || !tag.endsWith('>')) throw new Error('Ambiguous image source span')
  const values = new Map([['loading', eager ? 'eager' : 'lazy'], ['fetchpriority', eager ? 'high' : 'auto']])
  const patches: Patch[] = []
  let index = opening[0].length
  const seen = new Set<string>()
  while (index < tag.length - 1) {
    while (ASCII_SPACE.test(tag[index] || '')) index++
    if (tag[index] === '>') break
    if (tag[index] === '/') { index++; continue }
    const start = index++
    while (index < tag.length && !/[\t\n\f\r =/>]/.test(tag[index]!)) index++
    const name = tag.slice(start, index).toLowerCase()
    let end = index
    while (ASCII_SPACE.test(tag[index] || '')) index++
    if (tag[index] === '=') {
      index++
      while (ASCII_SPACE.test(tag[index] || '')) index++
      const quote = tag[index]
      if (quote === '"' || quote === "'") {
        index++
        while (index < tag.length && tag[index] !== quote) index++
        if (index >= tag.length) throw new Error('Unclosed image attribute')
        index++
      } else while (index < tag.length && !/[\t\n\f\r >]/.test(tag[index]!)) index++
      end = index
    }
    if (values.has(name)) {
      // Confirm the first token against the parser's location map before editing.
      if (!seen.has(name)) {
        const source = image.sourceCodeLocation?.attrs?.[name]
        if (!source || source.startOffset !== location.startOffset + start || source.endOffset !== location.startOffset + end) throw new Error('Ambiguous image attribute span')
      }
      patches.push({ start: location.startOffset + start, end: location.startOffset + end, value: seen.has(name) ? '' : `${name}="${values.get(name)}"` })
      seen.add(name)
    }
  }
  // Insert immediately after the tag name: appending at '/>' can mutate an
  // unquoted source ending with '/', and adjacent malformed attributes need gaps.
  const missing = [...values].filter(([name]) => !seen.has(name)).map(([name, value]) => ` ${name}="${value}"`).join('')
  if (missing) patches.push({ start: location.startOffset + opening[0].length, end: location.startOffset + opening[0].length, value: missing })
  return patches
}

const establishedRendering = (html: string): string => html.replace(/<img/g, '<img loading="lazy"')

export function applyArticleImageLoading(html: string, options: ArticleImageLoadingOptions): string {
  if (!options.enabled || options.excludedPresentation) return establishedRendering(html)
  try {
    const context = defaultTreeAdapter.createElement('div', HTML_NS, [])
    const fragment = parseFragment(context, html, { scriptingEnabled: true, sourceCodeLocationInfo: true })
    const { images, selected } = selectImages(fragment)
    const patches = images.flatMap(image => imagePatches(html, image, image === selected)).sort((a, b) => b.start - a.start)
    let boundary = html.length
    let result = ''
    for (const patch of patches) {
      if (patch.end > boundary) throw new Error('Overlapping image source spans')
      result = patch.value + html.slice(patch.end, boundary) + result
      boundary = patch.start
    }
    return html.slice(0, boundary) + result
  } catch {
    return establishedRendering(html)
  }
}
