import PostalMime from 'postal-mime'
import type { NewsletterErrorCode } from '@slax-reader/contracts'
import { DOMParser } from 'linkedom'
import { sanitizeFeedHtml } from '@/domain/rss/feed'
import { hashSHA256 } from '@/utils/strings'

export const NEWSLETTER_LIMITS = { rawBytes: 5 * 1024 * 1024, sources: 200, daily: 200 } as const
export class NewsletterError extends Error {
  constructor(
    public code: NewsletterErrorCode,
    public status = 400
  ) {
    super(code)
  }
}
export interface NewsletterConfig {
  NEWSLETTER_ENABLED?: string
  NEWSLETTER_DOMAIN?: string
}
export const newsletterLocalPart = (value: string): string | null =>
  value.length > 0 && value.length <= 64 && /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(value) && !value.includes('..') ? value.toLowerCase() : null
export const newsletterDomain = (value: string): string | null =>
  value.length <= 253 && /^(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(value) ? value.toLowerCase() : null
export const configuredNewsletterDomain = (env: NewsletterConfig): string | null => (env.NEWSLETTER_ENABLED === 'true' ? newsletterDomain(env.NEWSLETTER_DOMAIN || '') : null)

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
  if (!body) throw new NewsletterError('invalid_message')
  // Email has no trustworthy document base. Remove references that RSS would resolve against its synthetic base.
  const doc = new DOMParser().parseFromString('<html><body>' + body.slice(0, 512 * 1024) + '</body></html>', 'text/html')
  for (const node of doc.querySelectorAll('[srcset]')) node.removeAttribute('srcset')
  for (const node of doc.querySelectorAll('[src], [href], [data-src], [data-original]')) {
    for (const key of ['src', 'href', 'data-src', 'data-original']) {
      const value = node.getAttribute(key)
      if (value !== null && !/^https?:\/\//i.test(value)) node.removeAttribute(key)
    }
  }
  const clean = sanitizeFeedHtml(doc.body.innerHTML, 'https://rss.invalid/')
  const id = mail.messageId?.trim()
  const messageKey = await hashSHA256(id ? 'id:' + id : 'body:' + JSON.stringify([sender, mail.subject || '', mail.date || '', mail.html || mail.text || '']))
  const date = mail.date ? new Date(mail.date) : null
  return {
    sender,
    sourceTitle: label(mail.from?.name, sender),
    title: label(mail.subject, '(No subject)'),
    messageKey,
    html: clean.html,
    summary: clean.text.slice(0, 500),
    truncated: clean.truncated || body.length > 512 * 1024,
    publishedAt: date && Number.isFinite(date.valueOf()) && date.valueOf() <= Date.now() + 24 * 3600_000 ? date : null
  }
}
