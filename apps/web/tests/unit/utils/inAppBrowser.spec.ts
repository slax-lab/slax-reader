import { detectInAppBrowser, isInAppBrowser } from '~~/app/utils/inAppBrowser'

import { describe, expect, it } from 'vitest'

describe('in-app browser detection', () => {
  it.each([
    ['WeChat', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 MicroMessenger/8.0.50'],
    ['Instagram', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 332.0.0.0.80'],
    ['Facebook Android', 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Mobile Safari/537.36 [FBAN/EMA;FBAV/442.0.0.0.0;FBBV/555555555]'],
    ['Facebook iOS', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 [FBAN/FBIOS;FBAV/467.0.0.0.0]'],
    ['YouTube', 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Mobile Safari/537.36 YouTube/19.20.2'],
    ['Android WebView', 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UP1A.231005.007; wv) AppleWebKit/537.36 Version/4.0 Chrome/124.0.0.0 Mobile Safari/537.36']
  ])('%s is eligible', (_name, userAgent) => {
    expect(isInAppBrowser(userAgent)).toBe(true)
    expect(detectInAppBrowser(userAgent)).not.toBeNull()
  })

  it.each([
    ['Slax Reader iOS', 'SlaxReader/2.0.11 Build/123 CFNetwork/1496.0.7 Darwin/23.5.0'],
    ['Slax Reader Android', 'com.slax.reader/2.0.11 (Android 14; en_US; Pixel 8; Build/123; Webkit/537.36)'],
    ['Safari', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'],
    ['Chrome', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'],
    ['Android Chrome', 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36'],
    ['Firefox', 'Mozilla/5.0 (Android 14; Mobile; rv:125.0) Gecko/125.0 Firefox/125.0'],
    ['Edge', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0'],
    ['Unknown', 'ExampleBrowser/1.0']
  ])('%s is hidden', (_name, userAgent) => {
    expect(isInAppBrowser(userAgent)).toBe(false)
    expect(detectInAppBrowser(userAgent)).toBeNull()
  })

  it('does not classify generic mobile or touch-capable user agents', () => {
    expect(isInAppBrowser('Mozilla/5.0 (Linux; Android 14; Mobile)')).toBe(false)
    expect(isInAppBrowser('')).toBe(false)
  })

  it.each([
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/130.0.0.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 EdgiOS/130.0.0 Mobile/15E148 Safari/605.1.15',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 FxiOS/130.0 Mobile/15E148 Safari/605.1.15',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Version/4.0 Chrome/124.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
    'Mozilla/5.0 (Linux; Android 14; wvbrowser) AppleWebKit/537.36',
    'Mozilla/5.0 (Example OS; wv) AppleWebKit/537.36',
    'ExampleBrowser/1.0 NotInstagram NotYouTube NotMicroMessenger NOTFBAV',
    'ExampleBrowser/1.0 https://www.youtube.com https://www.instagram.com'
  ])('keeps external browsers and ambiguous markers hidden: %s', userAgent => {
    expect(detectInAppBrowser(userAgent)).toBeNull()
  })

  it.each(['SlaxReader', 'SlaxReader/2.0', 'com.slax.reader/2.0'])('excludes native WebViews before matching generic markers: %s', marker => {
    expect(detectInAppBrowser(`Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 ${marker}`)).toBeNull()
  })

  it.each([
    ['[FB_IAB/FB4A;FBAV/456.0]', 'facebook'],
    ['[FB4A/456.0]', 'facebook'],
    ['[FBIOS/456.0]', 'facebook'],
    ['com.google.ios.youtube/19.20.2', 'youtube'],
    ['com.google.android.youtube/19.20.2', 'youtube'],
    ['MicroMessenger/8.0.50', 'wechat'],
    ['Instagram 332.0', 'instagram']
  ])('returns the explicit app family before the WebView fallback: %s', (marker, kind) => {
    expect(detectInAppBrowser(`Mozilla/5.0 (Linux; Android 14; wv) ${marker}`)).toBe(kind)
  })
})
