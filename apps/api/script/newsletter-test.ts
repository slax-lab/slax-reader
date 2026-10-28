import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { parseNewsletter } from '../src/utils/newsletter'
import { DOMParser } from 'linkedom'

export function localEmailUrl(edge: string, to: string, from: string): URL {
  const url = new URL(edge)
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password)
    throw new Error('A localhost HTTP edge URL is required')
  url.pathname = '/cdn-cgi/local/email'
  url.search = new URLSearchParams({ to, from }).toString()
  url.hash = ''
  return url
}
export function previewDocument(html: string): string {
  return (
    '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; base-uri \'none\'; form-action \'none\'"><title>Newsletter local preview</title></head><body>' +
    html +
    '</body></html>'
  )
}
export async function runNewsletterTest(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      mode: { type: 'string' },
      eml: { type: 'string' },
      out: { type: 'string' },
      edge: { type: 'string' },
      to: { type: 'string' },
      from: { type: 'string' },
      repeat: { type: 'string' }
    }
  })
  if (!values.eml || !['preview', 'deliver'].includes(values.mode || '')) throw new Error('Use --mode preview|deliver --eml /path [--out /tmp/directory]')
  const raw = new Uint8Array(await readFile(resolve(values.eml)))
  const parsed = await parseNewsletter(raw)
  if (values.mode === 'deliver') {
    if (!values.edge || !values.to) throw new Error('Delivery requires --edge http://localhost:8787 --to feed+account@domain')
    const url = localEmailUrl(values.edge, values.to, values.from || parsed.sender)
    const repeat = Number(values.repeat || '1')
    if (!Number.isInteger(repeat) || repeat < 1 || repeat > 20) throw new Error('Repeat must be an integer from 1 to 20')
    for (let i = 0; i < repeat; i++) {
      const response = await fetch(url, { method: 'POST', body: raw, redirect: 'error', headers: { 'content-type': 'message/rfc822' } })
      if (!response.ok) throw new Error('Local email delivery failed with status ' + response.status)
    }
    console.log('Local email deliveries completed: ' + repeat)
    return
  }
  if (!values.out) throw new Error('Preview requires --out /tmp/directory')
  const out = resolve(values.out)
  await mkdir(out, { recursive: true, mode: 0o700 })
  const document = new DOMParser().parseFromString('<html><body>' + parsed.html + '</body></html>', 'text/html')
  await writeFile(join(out, 'newsletter.html'), previewDocument(parsed.html), { mode: 0o600 })
  await writeFile(join(out, 'newsletter.txt'), document.body.textContent || '', { mode: 0o600 })
  await writeFile(
    join(out, 'report.json'),
    JSON.stringify(
      {
        title: parsed.title,
        sender: parsed.sender,
        publishedAt: parsed.publishedAt,
        messageKey: parsed.messageKey,
        attachments: parsed.attachments,
        removedTrackingImages: parsed.removedTrackingImages,
        extraction: parsed.extraction,
        truncated: parsed.truncated
      },
      null,
      2
    ),
    { mode: 0o600 }
  )
  console.log('Local preview created')
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runNewsletterTest(process.argv.slice(2)).catch(() => {
    console.error('Newsletter simulation failed; check arguments and local input.')
    process.exitCode = 1
  })
}
