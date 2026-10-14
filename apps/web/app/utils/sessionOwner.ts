/** Local database identity only; decoding a token does not verify authentication. */
export const getTokenUserId = (token: string | null | undefined): string | null => {
  if (!token) return null
  try {
    const part = token.split('.')[1]
    if (!part) return null
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const claims = JSON.parse(atob(padded)) as { id?: string | number; email?: string }
    return claims.id != null ? String(claims.id) : (claims.email ?? null)
  } catch {
    return null
  }
}
