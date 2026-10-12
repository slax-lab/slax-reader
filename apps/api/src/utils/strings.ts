export async function hashMD5(source: string | Uint8Array): Promise<string> {
  const data = source instanceof Uint8Array ? source : new TextEncoder().encode(source)
  const digest = await crypto.subtle.digest('MD5', data)
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function hashSHA256(source: string | Uint8Array): Promise<string> {
  const data = typeof source === 'string' ? new TextEncoder().encode(source) : source
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

export function generateRandomNumber(length: number) {
  let randomNumber = ''

  for (let i = 0; i < length; i++) {
    randomNumber += Math.floor(Math.random() * 10)
  }

  return randomNumber
}
