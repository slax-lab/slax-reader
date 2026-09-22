export const base64toBlob = (base64uri: string) => {
  const byteString = atob(base64uri.split(',')[1] ?? '')
  const mimeString = base64uri.split(',')[0]?.split(':')[1]?.split(';')[0] ?? ''

  const ab = new ArrayBuffer(byteString.length)
  const ia = new Uint8Array(ab)

  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i)
  }

  return new Blob([ab], { type: mimeString })
}
