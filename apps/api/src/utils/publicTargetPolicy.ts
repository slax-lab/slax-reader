export class PublicTargetError extends Error {
  constructor(message = 'Target must be a public HTTP(S) URL') {
    super(message)
    this.name = 'PublicTargetError'
  }
}

const inV4Range = (ip: number, base: number[], bits: number) => {
  const network = base.reduce((value, octet) => value * 256 + octet, 0)
  return Math.floor(ip / 2 ** (32 - bits)) === Math.floor(network / 2 ** (32 - bits))
}

const publicIPv4 = (host: string) => {
  const octets = host.split('.').map(Number)
  const ip = octets.reduce((value, octet) => value * 256 + octet, 0)
  const excluded: Array<[number[], number]> = [
    [[0, 0, 0, 0], 8],
    [[10, 0, 0, 0], 8],
    [[100, 64, 0, 0], 10],
    [[127, 0, 0, 0], 8],
    [[169, 254, 0, 0], 16],
    [[168, 63, 129, 16], 32],
    [[172, 16, 0, 0], 12],
    [[192, 0, 0, 0], 24],
    [[192, 0, 2, 0], 24],
    [[192, 31, 196, 0], 24],
    [[192, 52, 193, 0], 24],
    [[192, 88, 99, 0], 24],
    [[192, 168, 0, 0], 16],
    [[192, 175, 48, 0], 24],
    [[198, 18, 0, 0], 15],
    [[198, 51, 100, 0], 24],
    [[203, 0, 113, 0], 24],
    [[224, 0, 0, 0], 3]
  ]
  return !excluded.some(([base, bits]) => inV4Range(ip, base, bits))
}

const publicIPv6 = (host: string) => {
  const [left, right] = host.slice(1, -1).split('::')
  const prefix = left ? left.split(':') : []
  const suffix = right ? right.split(':') : []
  const words = [...prefix, ...Array(right === undefined ? 0 : 8 - prefix.length - suffix.length).fill('0'), ...suffix].map(word => parseInt(word, 16))
  // Only global unicast; this also excludes mapped IPv4, NAT64, local and multicast addresses.
  if ((words[0] & 0xe000) !== 0x2000) return false
  if (words[0] === 0x2001 && (words[1] < 0x200 || words[1] === 0xdb8)) return false
  if (words[0] === 0x2002 || (words[0] === 0x3fff && words[1] < 0x1000)) return false
  if (words[0] === 0x2620 && words[1] === 0x4f && words[2] === 0x8000) return false
  return true
}

export const publicTarget = (input: string | URL): URL => {
  const raw = String(input)
  if (!/^https?:\/\//i.test(raw) || /[\u0000-\u0020\u007f\\]/.test(raw) || raw.split('/')[2]?.includes('@')) throw new PublicTargetError()
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new PublicTargetError()
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) throw new PublicTargetError()
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (host.startsWith('[')) {
    if (!publicIPv6(host)) throw new PublicTargetError()
  } else if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    if (!publicIPv4(host)) throw new PublicTargetError()
  } else {
    if (!host.includes('.') || host.length > 253 || host.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw new PublicTargetError()
    if (['localhost', 'local', 'internal', 'lan', 'home', 'home.arpa', 'localdomain', 'onion', 'arpa'].some(suffix => host === suffix || host.endsWith(`.${suffix}`)))
      throw new PublicTargetError()
  }
  url.hostname = host
  url.hash = ''
  return url
}
