import { pdfMetadataTitle } from '@slax-reader/contracts/pdf'

type Segment = { text: string; left: number; top: number; width: number; size: number; spaceBefore: boolean; spaceAfter: boolean }
type Line = { text: string; left: number; right: number; top: number; size: number; segments: Segment[] }
type Viewport = { width: number; height: number; transform: number[] }
const boilerplate = /^(?:arxiv\s*:|doi\s*:|https?:\/\/|www\.|abstract\b|keywords?\b|preprint\b|copyright\b|proceedings\b|(?:\d+[.)]?\s*)?(?:introduction|contents|references)\b)/i

/** A conservative heading fallback, never a substitute for usable PDF title metadata. */
export function pdfFirstPageTitle(items: readonly unknown[], viewport: Viewport): string | undefined {
  const { width, height, transform: v } = viewport
  if (![width, height, ...v].every(Number.isFinite) || width <= 0 || height <= 0 || v.length !== 6) return
  const segments: Segment[] = []
  const sizes = new Map<number, number>()
  // A malformed page cannot grow the heading detector's work without bound.
  for (const raw of items.slice(0, 10_000)) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as { str?: unknown; transform?: unknown; width?: unknown }
    if (
      typeof item.str !== 'string' ||
      !Array.isArray(item.transform) ||
      item.transform.length !== 6 ||
      !item.transform.every(Number.isFinite) ||
      typeof item.width !== 'number' ||
      !Number.isFinite(item.width)
    )
      continue
    const t = item.transform as number[]
    const text = pdfMetadataTitle(undefined, item.str)
    if (!text) continue
    const dx = v[0] * t[0] + v[2] * t[1],
      dy = v[1] * t[0] + v[3] * t[1]
    // Apply page rotation before excluding vertical/rotated margin identifiers.
    if (Math.abs(dy) > Math.abs(dx) * 0.15 || Math.abs(dx) < 0.01) continue
    const left = v[0] * t[4] + v[2] * t[5] + v[4]
    const top = v[1] * t[4] + v[3] * t[5] + v[5]
    const size = Math.hypot(v[0] * t[2] + v[2] * t[3], v[1] * t[2] + v[3] * t[3])
    if (size < 6 || size > 72 || left < 0 || left >= width || top < 0 || top >= height) continue
    const bucket = Math.round(size * 2) / 2
    sizes.set(bucket, (sizes.get(bucket) || 0) + Math.min(text.length, 200))
    segments.push({ text, left, top, size, width: Math.abs(item.width) * Math.hypot(v[0], v[1]), spaceBefore: /^\s/.test(item.str), spaceAfter: /\s$/.test(item.str) })
  }
  const dominant = [...sizes.entries()].sort((a, b) => b[1] - a[1])[0]
  if (!dominant || dominant[1] < 20) return
  segments.sort((a, b) => a.top - b.top || a.left - b.left)
  const lines: Line[] = []
  for (const segment of segments) {
    const last = lines[lines.length - 1]
    if (last && Math.abs(last.top - segment.top) <= Math.max(2, last.size * 0.25)) {
      last.segments.push(segment)
      last.size = Math.max(last.size, segment.size)
    } else lines.push({ text: '', left: segment.left, right: 0, top: segment.top, size: segment.size, segments: [segment] })
  }
  for (const line of lines) {
    line.segments.sort((a, b) => a.left - b.left)
    let previous: Segment | undefined
    for (const segment of line.segments) {
      const gap = previous ? segment.left - previous.left - previous.width : 0
      const space = previous && (previous.spaceAfter || segment.spaceBefore || gap > line.size * 0.15) ? ' ' : ''
      line.text += space + segment.text
      previous = segment
    }
    line.left = line.segments[0].left
    line.right = Math.max(...line.segments.map(item => item.left + item.width))
  }
  const candidate = (line: Line) =>
    line.top <= height * 0.55 && line.size >= dominant[0] * 1.2 && line.text.length >= 8 && line.text.length <= 500 && /\p{L}/u.test(line.text) && !boilerplate.test(line.text)
  const candidates = lines.filter(candidate)
  if (!candidates.length) return
  const largest = Math.max(...candidates.map(line => line.size))
  const start = lines.findIndex(line => candidate(line) && line.size >= largest * 0.95)
  let previous = lines[start],
    title = previous.text
  for (const next of lines.slice(start + 1, start + 4)) {
    const aligned = Math.abs(next.left - previous.left) <= previous.size * 2.5 || Math.abs(next.left + next.right - (previous.left + previous.right)) <= previous.size * 5
    if (!candidate(next) || Math.abs(next.size - previous.size) > previous.size * 0.1 || next.top - previous.top > previous.size * 1.8 || !aligned) break
    title += (title.endsWith('-') ? '' : ' ') + next.text
    previous = next
  }
  return title.length <= 500 ? pdfMetadataTitle(undefined, title) : undefined
}
