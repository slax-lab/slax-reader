import { deploymentOrigin } from './deploymentOrigin'

export interface ReaderBookmarkUrl {
  bookmarkUid: string
  canonicalUrl: string
}

const UUID_RE = /^(?!00000000-0000-0000-0000-000000000000)[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/**
 * Recognize a Reader snapshot URL without allowing URL parsing to broaden its authority or path.
 *
 * The raw prefix check is deliberate: URL normalizes host casing, default ports, escaped path
 * bytes, and some dot-segments. Those forms must not select a Reader snapshot implicitly.
 */
export function parseReaderBookmarkUrl(value: string, env: Pick<Env, 'FRONT_END_URL'>): ReaderBookmarkUrl | null {
  if (typeof value !== 'string' || value.length === 0 || /[\u0000-\u0020\\]/.test(value)) return null

  const origin = deploymentOrigin(env.FRONT_END_URL)
  if (!origin) return null

  const prefix = `${origin}/b/`
  if (!value.startsWith(prefix)) return null

  const suffix = value.slice(prefix.length)
  if (!UUID_RE.test(suffix)) return null

  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return null
  }

  if (parsed.origin !== origin || parsed.pathname !== `/b/${suffix}` || parsed.search !== '' || parsed.hash !== '') return null

  return { bookmarkUid: suffix, canonicalUrl: value }
}
