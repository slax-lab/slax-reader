export const EDGE_SECRET_HEADER = 'x-slax-edge-secret'
export const EDGE_IDENTITY_HEADER = 'x-slax-edge-identity'
export const EDGE_RAY_ID_HEADER = 'x-slax-ray-id'

export interface EdgeIdentity {
  deId: number
  enId: number
  email: string
  lang: string
  audience: 'reader'
}

export const encodeEdgeIdentity = (id: EdgeIdentity): string => {
  const bytes = new TextEncoder().encode(JSON.stringify(id))
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

export const decodeEdgeIdentity = (raw: string): EdgeIdentity => {
  const bytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0))
  return JSON.parse(new TextDecoder().decode(bytes)) as EdgeIdentity
}
