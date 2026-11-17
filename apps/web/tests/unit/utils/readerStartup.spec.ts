import { readerStartupScript, shouldScrollReaderToTop } from '~~/app/utils/readerStartup'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  window.history.replaceState({}, '', '/b/first')
})
afterEach(() => { window.__slaxReaderStartup?.navigation.stop(); vi.restoreAllMocks() })

describe('reader document startup', () => {
  it('keeps pre-application reading input for the initial article', () => {
    window.eval(readerStartupScript)
    window.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 }))
    expect(window.__slaxReaderStartup!.navigation.interacted).toBe(true)
  })
  it('does not count ordinary typing as a request to cancel progress', () => {
    window.eval(readerStartupScript)
    const input = document.createElement('textarea')
    document.body.append(input)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    expect(window.__slaxReaderStartup!.navigation.interacted).toBe(false)
  })
  it('starts a fresh article decision rather than carrying old wheel input', () => {
    window.eval(readerStartupScript)
    window.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 }))
    window.__slaxReaderStartup!.start('/b/second', false)
    expect(window.__slaxReaderStartup!.navigation.interacted).toBe(false)
  })
  it('reads the destination target before the browser URL changes', () => {
    window.eval(readerStartupScript)
    window.__slaxReaderStartup!.start('/b/second?highlight=mark', false)
    expect(window.__slaxReaderStartup!.navigation.path).toBe('/b/second')
    expect(window.__slaxReaderStartup!.navigation.explicit).toBe(true)
    window.__slaxReaderStartup!.start('/b/third', false)
    expect(window.__slaxReaderStartup!.navigation.explicit).toBe(false)
  })
  it('reserves history entry and explicit highlight intent', () => {
    window.history.replaceState({}, '', '/b/first?highlight=mark')
    window.eval(readerStartupScript)
    expect(window.__slaxReaderStartup!.navigation.explicit).toBe(true)
    window.__slaxReaderStartup!.start('/b/second', true)
    expect(window.__slaxReaderStartup!.navigation.history).toBe(true)
  })
})

describe('article page scroll metadata', () => {
  const initial = { matched: [] }
  const previous = { matched: [{}] }
  it('suppresses only the plain initial HTML article reset', () => {
    expect(shouldScrollReaderToTop({ path: '/b/first', hash: '' }, initial)).toBe(false)
    expect(shouldScrollReaderToTop({ path: '/b/second', hash: '' }, previous)).toBe(true)
    expect(shouldScrollReaderToTop({ path: '/bookmarks', hash: '' }, initial)).toBe(true)
  })
  it('retains initial hash and PDF scroll behavior', () => {
    expect(shouldScrollReaderToTop({ path: '/b/first', hash: '#passage' }, initial)).toBe(true)
    document.body.innerHTML = '<div class="bookmark-detail is-pdf"></div>'
    expect(shouldScrollReaderToTop({ path: '/b/first', hash: '' }, initial)).toBe(true)
  })
})
