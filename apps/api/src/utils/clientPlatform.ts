export type ClientPlatform = 'web' | 'ios' | 'android' | 'extension'

const CLIENT_TYPE_HEADER = 'X-CLIENT-TYPE'
// 客户端自报值，非白名单一律忽略
const DECLARED: ReadonlySet<string> = new Set<ClientPlatform>(['web', 'ios', 'android', 'extension'])

/** 解析 SlaxReader/<平台> <版本> 形态的 UA */
export function parseClientSource(ua: string): { platform: ClientPlatform; version?: string } {
  const match = ua.match(/^SlaxReader\/(iOS|Android)\s+(.+)$/i)
  if (match) return { platform: match[1].toLowerCase() as ClientPlatform, version: match[2] }
  return { platform: 'web' }
}

/** 自报优先，其次按 UA 推断 */
export function resolvePlatform(request: Request): ClientPlatform {
  const declared = (request.headers.get(CLIENT_TYPE_HEADER) || '').toLowerCase()
  if (DECLARED.has(declared)) return declared as ClientPlatform
  return parseClientSource(request.headers.get('User-Agent') || '').platform
}
