export type BookmarkEventSource = 'extension_save' | 'share_sheet' | 'web_button' | 'import' | 'api' | 'cli' | 'onboarding_gs'

/** Serializable request context, carried unchanged into asynchronous work. */
export interface EventRequestContext {
  device_id: string
  platform: string
  locale: string
  client_version: string
  source: BookmarkEventSource
  ua?: string
}

export const resolveDeviceId = (request: Request): string => {
  const explicit = request.headers.get('x-device-id')?.trim()
  if (explicit) return explicit
  for (const item of (request.headers.get('cookie') || '').split(';')) {
    const separator = item.indexOf('=')
    if (separator < 0 || item.slice(0, separator).trim() !== '_su') continue
    try {
      return decodeURIComponent(item.slice(separator + 1).trim()).trim()
    } catch {
      return item.slice(separator + 1).trim()
    }
  }
  return ''
}

export const normalizeEventLocale = (locale: string): string => locale.trim().toLowerCase().replaceAll('_', '-').split('-')[0] || 'en'
