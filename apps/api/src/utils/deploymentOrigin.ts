/** Only exact HTTP(S) origins from operator configuration may extend web allowlists. */
export function deploymentOrigin(value?: string): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return undefined
    return url.origin
  } catch {
    return undefined
  }
}
