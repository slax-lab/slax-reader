import type { BookmarkItem } from '@commons/frontend-types/models'

type BookmarkSource = Pick<BookmarkItem, 'host_url' | 'target_url'>

export const normalizeSourceDomain = (value?: string | null): string => {
  const source = value?.trim()
  if (!source) return ''

  try {
    const url = new URL(/^https?:\/\//i.test(source) ? source : `https://${source}`)
    return url.hostname.toLowerCase().replace(/\.$/, '')
  } catch {
    return ''
  }
}

export const isNewsletterBookmarkTarget = (value?: string | null): boolean => /^slax-newsletter:/i.test(value?.trim() || '')

export const getBookmarkSourceDomain = (bookmark: BookmarkSource): string => isNewsletterBookmarkTarget(bookmark.target_url) ? '' : normalizeSourceDomain(bookmark.host_url) || normalizeSourceDomain(bookmark.target_url)

export const bookmarkMatchesSourceDomain = (bookmark: BookmarkSource, domain: string): boolean => getBookmarkSourceDomain(bookmark) === normalizeSourceDomain(domain)
