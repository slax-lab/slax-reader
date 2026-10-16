export const READER_ORIGIN = 'https://reader.slax.invalid/'

export const READER_CSP = "default-src 'none'; script-src 'unsafe-inline' https://www.youtube.com https://s.ytimg.com; style-src 'unsafe-inline' https:; font-src https: data:; img-src https: data: blob: slaxstatic: slaxstatics:; media-src https: data: blob: slaxmedia: slaxmedias:; frame-src https:; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'; worker-src 'none'"

export function readerProtectedHosts(config: {webUrl: string; webDomain: string; apiUrl: string; betaApiUrl: string}): string[] {
  const host = (value: string) => {
    const normalized = value.toLowerCase().replace(/\.$/, '')
    if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(normalized) || normalized.split('.').some(part => !part || part.startsWith('-') || part.endsWith('-'))) throw new Error('Invalid Reader protected host')
    return normalized
  }
  const fromUrl = (value: string) => {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid Reader protected origin')
    return host(url.hostname)
  }
  return [...new Set(['slax.com', host(config.webDomain.replace(/^\./, '')), ...[config.webUrl, config.apiUrl, config.betaApiUrl].map(fromUrl)])].sort()
}

export function readerImageProxyOrigins(config: {apiUrl: string; betaApiUrl: string}): string[] {
  return [...new Set([config.apiUrl, config.betaApiUrl].map(value => {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid Reader proxy origin')
    return url.origin
  }))]
}

export function readerSignedImageProxy(raw: string, origins: readonly string[]): boolean {
  try {
    if (/[\u0000-\u0020\u007f\\]/.test(raw)) return false
    const url = new URL(raw.replace(/^slaxstatics:/i, 'https:').replace(/^slaxstatic:/i, 'http:'))
    if (!origins.includes(url.origin) || url.pathname !== '/static/image' || url.username || url.password || url.hash) return false
    const keys = [...url.searchParams.keys()]
    if (keys.some(key => !['u', 'r', 'd', 'm'].includes(key)) || new Set(keys).size !== keys.length) return false
    if (!/^[a-f0-9]{32}$/.test(url.searchParams.get('d') ?? '') || (url.searchParams.has('m') && url.searchParams.get('m') !== 'rss')) return false
    const source = new URL(decodeURIComponent(url.searchParams.get('u') ?? ''))
    const referer = new URL(url.searchParams.get('r') ?? '')
    return [source, referer].every(value => ['http:', 'https:'].includes(value.protocol) && !value.username && !value.password)
  } catch { return false }
}

export function readerAllowsImage(raw: string, protectedHosts: readonly string[], proxyOrigins: readonly string[]): boolean {
  return readerAllowsUrl(raw, protectedHosts) || readerSignedImageProxy(raw, proxyOrigins)
}

export function readerAllowsUrl(raw: string, protectedHosts: readonly string[]): boolean {
  try {
    if (/[\u0000-\u0020\u007f\\]/.test(raw)) return false
    const url = new URL(raw.replace(/^slaxstatics:/i, 'https:').replace(/^slaxstatic:/i, 'http:'))
    const host = url.hostname.toLowerCase().replace(/\.$/, '')
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !!host &&
      !protectedHosts.some(root => host === root || host.endsWith(`.${root}`))
  } catch { return false }
}
