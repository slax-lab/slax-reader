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

export const SNAPSHOT_REVISION_HEADER = 'x-snapshot-revision'

export async function snapshotMetadataRevision(metadata: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(metadata))
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')
}

/** Cached HTML is usable only while its authorization, policy and presentation remain current. */
export async function matchesCurrentSnapshot(
  cached: Response,
  backend: { fetch: (url: string, init: RequestInit) => Promise<Response> },
  uuid: string,
  token: string | undefined,
  role: 'owner' | 'visitor'
): Promise<boolean> {
  const revision = cached.headers.get(SNAPSHOT_REVISION_HEADER)
  if (!revision) return false
  try {
    const response = await backend.fetch(`https://content.internal/content/meta?uuid=${encodeURIComponent(uuid)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    })
    if (!response.ok) return false
    const metadata = (await response.json()) as { role?: string }
    return metadata.role === role && (await snapshotMetadataRevision(metadata)) === revision
  } catch {
    return false
  }
}
