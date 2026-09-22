export const base64UrlDecodeString = (s: string) => s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)

export const base64UrlDecode = (s: string) =>
  new Uint8Array(
    atob(base64UrlDecodeString(s))
      .split('')
      .map(char => char.charCodeAt(0))
  ).buffer
