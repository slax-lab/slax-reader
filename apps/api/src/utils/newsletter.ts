import PostalMime from 'postal-mime'
import { Buffer } from 'node:buffer'
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
  sender: string
  sourceTitle: string
  title: string
  messageKey: string
  html: string
  excerpt: string
  truncated: boolean
  publishedAt: Date | null
}
// Keep oversized mail text readable without changing the shipped RSS sanitizer.
function sanitizeMailHtml(html: string) {
  const doc = new DOMParser().parseFromString(`<html><body>${html}</body></html>`, 'text/html') as unknown as Document
  for (const parent of doc.querySelectorAll('*'))
    for (const node of Array.from(parent.childNodes)) {
      const text = node.nodeType === 3 ? node.textContent || '' : ''
      if (text.length <= 4096) continue
      for (let offset = 0; offset < text.length; ) {
        let end = Math.min(offset + 4096, text.length)
        if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--
        const span = doc.createElement('span')
        span.textContent = text.slice(offset, end)
        parent.insertBefore(span, node)
        offset = end
      }
      parent.removeChild(node)
    }
  return sanitizeFeedHtml(doc.body.innerHTML, 'https://rss.invalid/')
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
  const allAttachments = mail.attachments.map(item => ({
    filename: label(item.filename?.replace(/[\\/]/g, '_'), 'Unnamed attachment'),
    mimeType: label(item.mimeType, 'application/octet-stream'),
    size: typeof item.content === 'string' ? new TextEncoder().encode(item.content).byteLength : item.content.byteLength
  }))
  if (!body && !allAttachments.length) throw new NewsletterError('invalid_message')
  // Email has no trustworthy document base. Remove references that RSS would resolve against its synthetic base.
  const doc = new DOMParser().parseFromString('<html><body>' + body.slice(0, 512 * 1024) + '</body></html>', 'text/html') as unknown as Document
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
  // Sanitize small opaque placeholders before embedding image bytes, preserving the text budget.
  const inline = new Map<string, string>(),
    used = new Set<number>(),
    imagePrefix = `https://newsletter-inline.invalid/${crypto.randomUUID()}/`
  for (const image of doc.querySelectorAll('img')) {
    const source = image.getAttribute('src') || ''
    if (!/^cid:/i.test(source)) continue
    let cid: string
    try {
      cid = decodeURIComponent(source.slice(4)).replace(/^<|>$/g, '')
    } catch {
      image.removeAttribute('src')
      continue
    }
    const index = mail.attachments.findIndex(item => item.contentId?.replace(/^<|>$/g, '') === cid)
    const attachment = mail.attachments[index]
    if (!attachment || !/^image\/(?:png|jpeg|gif|webp|avif)$/i.test(attachment.mimeType)) {
      image.removeAttribute('src')
      continue
    }
    const placeholder = imagePrefix + index
    if (!inline.has(placeholder)) inline.set(placeholder, `data:${attachment.mimeType.toLowerCase()};base64,${Buffer.from(attachment.content as ArrayBuffer).toString('base64')}`)
    used.add(index)
    image.setAttribute('src', placeholder)
  }
  for (const node of doc.querySelectorAll('[srcset]')) node.removeAttribute('srcset')
  for (const node of doc.querySelectorAll('[src], [href], [data-src], [data-original]')) {
    for (const key of ['src', 'href', 'data-src', 'data-original']) {
      const value = node.getAttribute(key)
      if (value !== null && !/^https?:\/\//i.test(value)) node.removeAttribute(key)
    }
  }
  const full = sanitizeMailHtml(doc.body.innerHTML)
  const attachments = allAttachments.filter((_, index) => !used.has(index))
  const attachmentHtml = attachments.length
    ? '<section><h2>Attachments</h2><p>Binary attachments are not stored. Refer to the original email to open them.</p><ul>' +
      attachments.map(item => '<li>' + escape(item.filename) + ' (' + escape(item.mimeType) + ', ' + item.size + ' bytes)</li>').join('') +
      '</ul></section>'
    : ''
  const clean = sanitizeFeedHtml(full.html + attachmentHtml, 'https://rss.invalid/')
  const attachmentIdentity = await Promise.all(
    mail.attachments.map(async (item, index) => [allAttachments[index], await hashSHA256(typeof item.content === 'string' ? item.content : new Uint8Array(item.content))])
  )
  const rendered = new DOMParser().parseFromString('<html><body>' + clean.html + '</body></html>', 'text/html') as unknown as Document
  let embeddedBytes = 0,
    inlineTruncated = false
  for (const image of rendered.querySelectorAll('img')) {
    const data = inline.get(image.getAttribute('src') || '')
    if (!data) continue
    // Each reference duplicates its encoded bytes in HTML; cap expansion independently of text.
    if (embeddedBytes + data.length > NEWSLETTER_LIMITS.rawBytes) {
      image.remove()
      inlineTruncated = true
      continue
    }
    image.setAttribute('src', data)
    embeddedBytes += data.length
  }
  const id = mail.messageId?.trim()
  const messageKey = await hashSHA256(id ? 'id:' + id : 'body:' + JSON.stringify([sender, mail.subject || '', mail.date || '', mail.html || mail.text || '', attachmentIdentity]))
  const date = mail.date ? new Date(mail.date) : null
  return {
    attachments,
    removedTrackingImages,
    sender,
    sourceTitle: label(mail.from?.name, sender),
    title: label(mail.subject, '(No subject)'),
    messageKey,
    html: rendered.body.innerHTML,
    excerpt: clean.text.slice(0, 500),
    truncated: full.truncated || clean.truncated || inlineTruncated || body.length > 512 * 1024,
    publishedAt: date && Number.isFinite(date.valueOf()) && date.valueOf() <= Date.now() + 24 * 3600_000 ? date : null
  }
}
