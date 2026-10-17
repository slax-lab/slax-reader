import { outboundUrlProblem } from '@/utils/podcastSource'

const USER_AGENT = 'Mozilla/5.0 (compatible; SlaxReaderBot/1.0; +https://slax.com)'

/**
 * Fetch a podcast page, feed, lookup answer or transcript file from an address that came from a
 * user or a feed. Every hop (redirects are followed by hand) must pass the outbound screen, the
 * body is capped, and the whole request has a time limit.
 */
export async function fetchPublicText(url: string, opts: { maxBytes?: number; timeoutMs?: number; accept?: string } = {}): Promise<string> {
  const maxBytes = opts.maxBytes ?? 5 * 1024 * 1024
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 20_000)
  let current = url
  for (let hop = 0; hop < 5; hop++) {
    const problem = outboundUrlProblem(current)
    if (problem) throw new Error(`blocked_url:${problem}`)
    const resp = await fetch(current, { redirect: 'manual', signal, headers: { 'User-Agent': USER_AGENT, Accept: opts.accept ?? '*/*' } })
    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get('location')
      if (!location) throw new Error(`http_${resp.status}`)
      current = new URL(location, current).toString()
      continue
    }
    if (!resp.ok) throw new Error(`http_${resp.status}`)
    if (Number(resp.headers.get('content-length') ?? 0) > maxBytes) throw new Error('too_large')
    if (!resp.body) return ''
    const reader = resp.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        await reader.cancel()
        throw new Error('too_large')
      }
      chunks.push(value)
    }
    const all = new Uint8Array(size)
    let offset = 0
    for (const c of chunks) {
      all.set(c, offset)
      offset += c.byteLength
    }
    return new TextDecoder().decode(all)
  }
  throw new Error('too_many_redirects')
}
