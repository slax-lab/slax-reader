import PostalMime from 'postal-mime'
import { ContentParser } from '@/utils/parser'
import type { NewsletterErrorCode } from '@slax-reader/contracts'
import { DOMParser } from 'linkedom'
import { sanitizeFeedHtml } from '@/domain/rss/feed'
import { hashSHA256 } from '@/utils/strings'

export const NEWSLETTER_LIMITS = {
  rawBytes: 5 * 1024 * 1024,
  sources: 200,
  daily: 200
} as const
export class NewsletterError extends Error {
  constructor(
    public code: NewsletterErrorCode,
    public status = 400
  ) {
    super(code)
  }
}
export interface NewsletterConfig {
  NEWSLETTER_DOMAIN?: string
}
export const NEWSLETTER_LOCAL_PREFIX = 'feed+'
// Reserve five SMTP local-part octets for feed+ when validating the initial account token.
export const newsletterLocalPart = (value: string): string | null =>
  value.length > 0 && value.length <= 64 - NEWSLETTER_LOCAL_PREFIX.length && /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(value) && !value.includes('..')
    ? value.toLowerCase()
    : null
export const newsletterRecipientPart = (value: string): string | null =>
  value.toLowerCase().startsWith(NEWSLETTER_LOCAL_PREFIX) ? newsletterLocalPart(value.slice(NEWSLETTER_LOCAL_PREFIX.length)) : null
export const newsletterDomain = (value: string): string | null =>
  value.length <= 253 && /^(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(value) ? value.toLowerCase() : null
export const configuredNewsletterDomain = (env: NewsletterConfig): string | null => newsletterDomain(env.NEWSLETTER_DOMAIN || '')

export async function readNewsletterRaw(message: { rawSize: number; raw: ReadableStream<Uint8Array> }): Promise<Uint8Array> {
  if (!Number.isFinite(message.rawSize) || message.rawSize < 0 || message.rawSize > NEWSLETTER_LIMITS.rawBytes) throw new NewsletterError('invalid_message', 413)
  const reader = message.raw.getReader(),
    chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > NEWSLETTER_LIMITS.rawBytes) {
        await reader.cancel()
        throw new NewsletterError('invalid_message', 413)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const raw = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    raw.set(chunk, offset)
    offset += chunk.byteLength
  }
  return raw
}
const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const label = (text: string | undefined, fallback: string) =>
  text
    ?.replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, 500) || fallback
export interface ParsedNewsletter {
  attachments: { filename: string; mimeType: string; size: number }[]
  removedTrackingImages: number
  extraction: 'content' | 'fallback'
  sender: string
  sourceTitle: string
  title: string
  messageKey: string
  html: string
  summary: string
  truncated: boolean
  publishedAt: Date | null
}
export async function parseNewsletter(raw: Uint8Array): Promise<ParsedNewsletter> {
  if (!raw.byteLength || raw.byteLength > NEWSLETTER_LIMITS.rawBytes) throw new NewsletterError('invalid_message', 413)
  let mail
  try {
    mail = await PostalMime.parse(raw, {
      maxNestingDepth: 32,
      maxHeadersSize: 64 * 1024,
      maxPartCount: 200,
      maxRfc822NestingDepth: 0,
      maxForwardedAddresses: 100,
      forceRfc822Attachments: true
    })
  } catch {
    throw new NewsletterError('invalid_message')
  }
  const sender = mail.from?.address?.trim().toLowerCase() || ''
  if (!/^[^\s<>@\u0000-\u001f]+@[^\s<>@\u0000-\u001f]+\.[^\s<>@\u0000-\u001f]+$/.test(sender) || sender.length > 254) throw new NewsletterError('invalid_message')
  const body = mail.html || (mail.text ? '<pre>' + escape(mail.text) + '</pre>' : '')
  const attachments = mail.attachments.map(item => ({
    filename: label(item.filename?.replace(/[\\/]/g, '_'), 'Unnamed attachment'),
    mimeType: label(item.mimeType, 'application/octet-stream'),
    size: typeof item.content === 'string' ? new TextEncoder().encode(item.content).byteLength : item.content.byteLength
  }))
  if (!body && !attachments.length) throw new NewsletterError('invalid_message')
  // Email has no trustworthy document base. Remove references that RSS would resolve against its synthetic base.
  const doc = new DOMParser().parseFromString('<html><body>' + body.slice(0, 512 * 1024) + '</body></html>', 'text/html')
  let removedTrackingImages = 0
  for (const node of doc.querySelectorAll('img')) {
    const style = (node.getAttribute('style') || '').toLowerCase().replace(/\s+/g, '')
    const dimension = (name: string) => node.getAttribute(name) || style.match(new RegExp('(?:^|;)' + name + ':([0-9.]+)(?:px)?(?:;|$)'))?.[1]
    const zeroDimension = ['width', 'height'].some(name => {
      const attribute = node.getAttribute(name)?.trim()
      return (
        (attribute !== undefined && attribute !== null && /^0(?:\.0+)?(?:px)?$/.test(attribute)) ||
        new RegExp('(?:^|;)' + name + ':0(?:\\.0+)?(?:px)?(?:!important)?(?:;|$)').test(style)
      )
    })
    const width = dimension('width'),
      height = dimension('height')
    let hidden = false
    for (let ancestor: Element | null = node; ancestor; ancestor = ancestor.parentElement) {
      const ancestorStyle = (ancestor.getAttribute('style') || '').toLowerCase().replace(/\s+/g, '')
      if (ancestor.hasAttribute('hidden') || /(?:^|;)(?:display:none|visibility:hidden|opacity:0)(?:!important)?(?:;|$)/.test(ancestorStyle)) hidden = true
    }
    if (hidden || zeroDimension || (width !== null && width !== undefined && height !== null && height !== undefined && Number(width) <= 1 && Number(height) <= 1)) {
      node.remove()
      removedTrackingImages++
    }
  }
  for (const node of doc.querySelectorAll('[srcset]')) node.removeAttribute('srcset')
  for (const node of doc.querySelectorAll('[src], [href], [data-src], [data-original]')) {
    for (const key of ['src', 'href', 'data-src', 'data-original']) {
      const value = node.getAttribute(key)
      if (value !== null && !/^https?:\/\//i.test(value)) node.removeAttribute(key)
    }
  }
  const full = sanitizeFeedHtml(doc.body.innerHTML, 'https://rss.invalid/')
  const extracted = ContentParser.parseContentOnly(doc.body.innerHTML)
  const candidate = extracted ? sanitizeFeedHtml(extracted, 'https://rss.invalid/') : null
  // Mail may contain multiple articles or short confirmations: retain the whole sanitized message whenever extraction loses content or links.
  const fullDoc = new DOMParser().parseFromString('<html><body>' + full.html + '</body></html>', 'text/html')
  const candidateDoc = new DOMParser().parseFromString('<html><body>' + (candidate?.html || '') + '</body></html>', 'text/html')
  const normalize = (value: string) => value.replace(/\s+/g, ' ').trim()
  const useExtraction =
    !!candidate &&
    normalize(candidate.text) === normalize(full.text) &&
    [...fullDoc.querySelectorAll('[href], [src]')].every(node =>
      [...candidateDoc.querySelectorAll('[href], [src]')].some(
        other => other.getAttribute('href') === node.getAttribute('href') && other.getAttribute('src') === node.getAttribute('src')
      )
    )
  const selected = useExtraction ? candidate! : full
  const attachmentHtml = attachments.length
    ? '<section><h2>Attachments</h2><p>Binary attachments are not stored. Refer to the original email to open them.</p><ul>' +
      attachments.map(item => '<li>' + escape(item.filename) + ' (' + escape(item.mimeType) + ', ' + item.size + ' bytes)</li>').join('') +
      '</ul></section>'
    : ''
  const clean = sanitizeFeedHtml(selected.html + attachmentHtml, 'https://rss.invalid/')
  const attachmentIdentity = await Promise.all(
    mail.attachments.map(async (item, index) => [attachments[index], await hashSHA256(typeof item.content === 'string' ? item.content : new Uint8Array(item.content))])
  )
  const id = mail.messageId?.trim()
  const messageKey = await hashSHA256(id ? 'id:' + id : 'body:' + JSON.stringify([sender, mail.subject || '', mail.date || '', mail.html || mail.text || '', attachmentIdentity]))
  const date = mail.date ? new Date(mail.date) : null
  return {
    attachments,
    removedTrackingImages,
    extraction: useExtraction ? 'content' : 'fallback',
    sender,
    sourceTitle: label(mail.from?.name, sender),
    title: label(mail.subject, '(No subject)'),
    messageKey,
    html: clean.html,
    summary: clean.text.slice(0, 500),
    truncated: full.truncated || clean.truncated || body.length > 512 * 1024,
    publishedAt: date && Number.isFinite(date.valueOf()) && date.valueOf() <= Date.now() + 24 * 3600_000 ? date : null
  }
}
