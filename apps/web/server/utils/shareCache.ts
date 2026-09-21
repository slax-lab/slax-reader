export const SHARE_PATH = /^\/b\/([^/]+)\/?$/
export const BCACHE_MAX_AGE = 600 // 10 分钟
export const OWNER_UID_HEADER = 'x-owner-uid'

export function viewerId(token: string | undefined): string {
  if (!token) return ''
  try {
    const payload = token.split('.')[1]
    if (!payload) return ''
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
    return typeof json.id === 'string' ? json.id : ''
  } catch {
    return ''
  }
}

export function ownerKey(uuid: string): string {
  return `https://__bcache.slax__/b/${uuid}?t=owner`
}
export function visitorKey(uuid: string): string {
  return `https://__bcache.slax__/b/${uuid}?t=visitor`
}

export function canUseVisitorCache(viewerUid: string, ownerUid: string | null): boolean {
  if (!viewerUid) return true
  return !!ownerUid && ownerUid !== viewerUid
}

export function getEdgeCache(): Cache | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = (globalThis as any).caches
  return c?.default ?? null
}
