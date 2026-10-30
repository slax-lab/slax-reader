import PostalMime from 'postal-mime'
import { Buffer } from 'node:buffer'
import { DOMParser } from 'linkedom'
import { sanitizeFeedHtml } from '@/domain/rss/feed'
import { hashSHA256 } from '@/utils/strings'

import { NEWSLETTER_LIMITS, NewsletterError, readNewsletterMime, type NewsletterMessageInput, type NewsletterMimeInput } from './newsletterMime'
import type { NewsletterTiming } from './newsletterTiming'
export { NEWSLETTER_LIMITS, NewsletterError } from './newsletterMime'

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
export function parseNewsletter(raw: Uint8Array): Promise<ParsedNewsletter> {
  return parseNewsletterStream({
    rawSize: raw.byteLength,
    raw: new ReadableStream({
      start(controller) {
        controller.enqueue(raw)
        controller.close()
      }
    })
  })
}
export async function parseNewsletterStream(message: NewsletterMessageInput, timing?: NewsletterTiming): Promise<ParsedNewsletter> {
  const input = timing ? await timing.measure('read', () => readNewsletterMime(message)) : await readNewsletterMime(message)
  return timing ? timing.measure('parse', () => renderNewsletter(input)) : renderNewsletter(input)
}
async function renderNewsletter(input: NewsletterMimeInput): Promise<ParsedNewsletter> {
  let mail
  try {
    mail = await PostalMime.parse(input.mime, {
      maxNestingDepth: NEWSLETTER_LIMITS.depth,
      maxHeadersSize: NEWSLETTER_LIMITS.headerBytes + NEWSLETTER_LIMITS.parts * 128,
      maxPartCount: NEWSLETTER_LIMITS.parts,
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
  const allAttachments = input.attachments.map(item => ({
    filename: label(item.filename?.replace(/[\\/]/g, '_'), 'Unnamed attachment'),
    mimeType: label(item.mimeType, 'application/octet-stream'),
    size: item.size
  }))
  if (!body && !allAttachments.length) throw new NewsletterError('invalid_message')
  // Email has no trustworthy document base. Remove references that RSS would resolve against its synthetic base.
  const doc = new DOMParser().parseFromString('<html><body>' + body.slice(0, NEWSLETTER_LIMITS.bodyCharacters) + '</body></html>', 'text/html') as unknown as Document
  let removedTrackingImages = 0,
    cidTruncated = false
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
    if (input.omittedCids.has(cid)) {
      image.removeAttribute('src')
      cidTruncated = true
      continue
    }
    const index = input.attachments.findIndex(item => item.contentId === cid)
    const attachment = mail.attachments.find(item => item.contentId?.replace(/^<|>$/g, '') === cid)
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
  const clean = sanitizeFeedHtml(full.html, 'https://rss.invalid/')
  // Attachment metadata remains visible even when the body reaches its render limit.
  const rendered = new DOMParser().parseFromString('<html><body>' + clean.html + attachmentHtml + '</body></html>', 'text/html') as unknown as Document
  let embeddedBytes = 0,
    inlineTruncated = false
  for (const image of rendered.querySelectorAll('img')) {
    const data = inline.get(image.getAttribute('src') || '')
    if (!data) continue
    // Each reference duplicates its encoded bytes in HTML; cap expansion independently of text.
    if (embeddedBytes + data.length > NEWSLETTER_LIMITS.embeddedCharacters) {
      image.remove()
      inlineTruncated = true
      continue
    }
    image.setAttribute('src', data)
    embeddedBytes += data.length
  }
  const id = mail.messageId?.trim()
  const messageKey = id ? await hashSHA256('id:' + id) : input.rawHash
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
    truncated: input.truncated || cidTruncated || full.truncated || clean.truncated || inlineTruncated || body.length > NEWSLETTER_LIMITS.bodyCharacters,
    publishedAt: date && Number.isFinite(date.valueOf()) && date.valueOf() <= Date.now() + 24 * 3600_000 ? date : null
  }
}
