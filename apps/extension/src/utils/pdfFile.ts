import { PDF_MAX_BYTES, pdfMetadataTitle } from '@slax-reader/contracts/pdf'

export function pdfBasename(value: string, sourceUrl = false): string {
  let name = sourceUrl ? new URL(value).pathname.split('/').pop() || '' : value.split(/[\\/]/).pop() || ''
  if (sourceUrl) { try { name = decodeURIComponent(name) } catch {} }
  return name.replace(/[\u0000-\u001f\u007f/\\]/g, '').trim().slice(0, 200) || 'document.pdf'
}

export async function validatePdfFile(file: File): Promise<File> {
  if (!file.size || file.size > PDF_MAX_BYTES) throw new Error('size')
  if (!new TextDecoder('ascii').decode(await file.slice(0, 1024).arrayBuffer()).includes('%PDF-')) throw new Error('invalid')
  return new File([file], pdfBasename(file.name), { type: 'application/pdf' })
}

/** PDF.js owns this copy; the immutable File remains the exact upload body. */
export async function readPdfTitle(file: File, signal: AbortSignal): Promise<string | undefined> {
  signal.throwIfAborted()
  let timer: ReturnType<typeof setTimeout> | undefined
  let abort = () => {}
  let cleanup = async () => {}
  try {
    const { getResolvedPDFJS } = await import('unpdf')
    const { getDocument } = await getResolvedPDFJS()
    const data = new Uint8Array(await file.arrayBuffer())
    signal.throwIfAborted()
    const options = { data, isEvalSupported: false, useSystemFonts: false, disableFontFace: true, verbosity: 0 }
    const task = getDocument(options)
    cleanup = () => task.destroy().catch(() => {})
    return await Promise.race([
      task.promise.then(async pdf => {
        const { metadata, info } = await pdf.getMetadata()
        return pdfMetadataTitle(metadata?.get('dc:title'), (info as { Title?: unknown })?.Title)
      }),
      new Promise<never>((_, reject) => {
        abort = () => reject(signal.reason)
        signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) abort()
        timer = setTimeout(() => reject(new Error('PDF metadata timed out')), 10_000)
      })
    ])
  } catch {
    signal.throwIfAborted()
    return undefined
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', abort)
    await cleanup()
  }
}

export async function readLocalPdf(source: string, signal: AbortSignal): Promise<File> {
  const url = new URL(source)
  if (url.protocol !== 'file:') throw new Error('source')
  url.hash = ''
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) abort()
  const timeout = setTimeout(abort, 60_000)
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    const response = await fetch(url.href, { signal: controller.signal })
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error('read') }
    reader = response.body.getReader()
    const length = Number(response.headers.get('Content-Length') || 0)
    if (!Number.isSafeInteger(length) || length < 0 || length > PDF_MAX_BYTES) throw new Error('size')
    const bytes = new Uint8Array(length || PDF_MAX_BYTES)
    let size = 0
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      if (size + value.length > bytes.length) throw new Error('size')
      bytes.set(value, size)
      size += value.length
    }
    return await validatePdfFile(new File([bytes.subarray(0, size)], pdfBasename(source, true), { type: 'application/pdf' }))
  } catch (error) {
    if (error instanceof Error && ['size', 'invalid', 'source'].includes(error.message)) throw error
    throw new Error(signal.aborted ? 'cancelled' : 'read')
  } finally {
    await reader?.cancel().catch(() => {})
    reader?.releaseLock()
    controller.abort()
    clearTimeout(timeout)
    signal.removeEventListener('abort', abort)
  }
}
