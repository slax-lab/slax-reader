import { PDF_MAX_BYTES } from '@slax-reader/contracts/pdf'

export const hasPdfSignature = (bytes: Uint8Array): boolean => {
  // PDF readers permit a small binary prefix before the header.
  return new TextDecoder('ascii').decode(bytes.subarray(0, 1024)).includes('%PDF-')
}

export async function readPdfBody(body: ReadableStream<Uint8Array> | null, contentLength?: string | null, timeoutMs = 60_000): Promise<Uint8Array> {
  if (!body) throw new Error('Empty PDF file')
  const advertised = contentLength ? Number(contentLength) : 0
  if (!Number.isSafeInteger(advertised) || advertised < 0 || advertised > PDF_MAX_BYTES) {
    await body.cancel()
    throw new Error('PDF file exceeds 50 MiB')
  }
  // One bounded allocation avoids retaining chunks plus a second full-file concatenation.
  const bytes = new Uint8Array(advertised || PDF_MAX_BYTES)
  const reader = body.getReader()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('PDF download timed out')), timeoutMs)
  })
  let size = 0
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), timeout])
      if (done) break
      if (size + value.byteLength > bytes.length) throw new Error('PDF file exceeds its byte limit')
      bytes.set(value, size)
      size += value.byteLength
    }
    if (!size || !hasPdfSignature(bytes.subarray(0, size))) throw new Error('Invalid PDF file')
    return bytes.subarray(0, size)
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally {
    clearTimeout(timer)
    reader.releaseLock()
  }
}
