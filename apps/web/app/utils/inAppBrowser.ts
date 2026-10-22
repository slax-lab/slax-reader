export type InAppBrowserKind = 'wechat' | 'instagram' | 'facebook' | 'youtube' | 'android-webview'

const SUPPORTED_MARKERS: Array<{ kind: InAppBrowserKind; pattern: RegExp }> = [
  { kind: 'wechat', pattern: /(?:^|[\s;(])MicroMessenger(?:\/|[\s;)\]])/i },
  { kind: 'instagram', pattern: /(?:^|[\s;(])Instagram(?:\/|[\s;)\d])/i },
  { kind: 'facebook', pattern: /(?:^|[\s\[(;])(?:FBAN|FBAV|FB_IAB|FB4A|FBIOS)(?:[\/;=\]])/i },
  { kind: 'youtube', pattern: /(?:^|[\s;(])(?:YouTube|com\.google\.(?:android|ios)\.youtube)(?:\/|[\s;)\]])/i }
]

const SLAX_READER_MARKER = /(?:^|[\s;(])(?:SlaxReader|com\.slax\.reader)(?:\/|[\s;)\]]|$)/i

/**
 * Return the supported embedded-browser family for a user agent.
 *
 * The matcher deliberately requires an explicit app marker. Generic mobile,
 * touch, viewport, and referrer signals are not sufficient because they would
 * make ordinary Safari and Chrome sessions display the guidance card.
 */
export function detectInAppBrowser(userAgent: string): InAppBrowserKind | null {
  if (!userAgent || SLAX_READER_MARKER.test(userAgent)) return null

  for (const marker of SUPPORTED_MARKERS) {
    if (marker.pattern.test(userAgent)) return marker.kind
  }

  if (/Android/i.test(userAgent) && /;\s*wv(?:[;)\s]|$)/i.test(userAgent)) {
    return 'android-webview'
  }

  return null
}

export function isInAppBrowser(userAgent: string): boolean {
  return detectInAppBrowser(userAgent) !== null
}
