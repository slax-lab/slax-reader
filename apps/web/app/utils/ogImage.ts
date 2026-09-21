const ICON_HINT_RE = /(sprite|icons?|logos?|avatar|emoji|favicon|spacer|pixel|1x1|badge|button|loading|placeholder|blank|tracking|beacon)/i

const getAttr = (tag: string, attr: string): string => {
  const re = new RegExp(`\\b${attr}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
  const m = tag.match(re)
  if (!m) return ''
  return (m[2] ?? m[3] ?? m[4] ?? '').trim()
}

const parseDim = (raw: string): number | null => {
  if (!raw) return null
  const m = raw.match(/^(\d+(?:\.\d+)?)\s*(px)?$/i)
  return m ? Number(m[1]) : null
}

const toAbsolute = (src: string, baseUrl?: string): string | null => {
  if (/^https?:\/\//i.test(src)) return src
  if (src.startsWith('//')) return `https:${src}`
  if (baseUrl) {
    try {
      return new URL(src, baseUrl).href
    } catch {
      return null
    }
  }
  return null
}

const MIN_SIDE = 300

export const extractFirstContentImage = (html: string, baseUrl?: string): string | null => {
  if (!html) return null

  const imgTagRe = /<img\b[^>]*>/gi
  let match: RegExpExecArray | null

  while ((match = imgTagRe.exec(html)) !== null) {
    const tag = match[0]

    const candidates = [getAttr(tag, 'data-src'), getAttr(tag, 'data-original'), getAttr(tag, 'src')].filter(Boolean)

    const width = parseDim(getAttr(tag, 'width'))
    const height = parseDim(getAttr(tag, 'height'))
    if ((width !== null && width < MIN_SIDE) || (height !== null && height < MIN_SIDE)) {
      continue
    }

    for (const src of candidates) {
      if (/^data:/i.test(src)) continue
      if (/\.svg(\?|#|$)/i.test(src)) continue
      if (ICON_HINT_RE.test(src)) continue
      const abs = toAbsolute(src, baseUrl)
      if (abs) return abs
    }
  }

  return null
}
