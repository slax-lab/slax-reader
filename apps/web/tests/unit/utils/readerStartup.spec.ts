import { readerStartupScript, shouldScrollReaderToTop } from '~~/app/utils/readerStartup'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  window.history.replaceState({}, '', '/b/first')
})
afterEach(() => { window.__slaxReaderStartup?.takePanel(window.__slaxReaderStartup.navigation.path); window.__slaxReaderStartup?.navigation.stop(); document.body.innerHTML = ''; vi.restoreAllMocks() })

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
  it('does not classify library entry attribution as an explicit passage target', () => {
    window.history.replaceState({}, '', '/b/first?_slax_entry=bookmarks')
    window.eval(readerStartupScript)
    expect(window.__slaxReaderStartup!.navigation.explicit).toBe(false)
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


describe('reader panel activation before hydration', () => {
  const entry = (id: string, path = '/b/first') => {
    const button = document.createElement('button')
    button.dataset.snapshotPanel = id
    button.setAttribute('aria-busy', 'false')
    button.innerHTML = '<span>Panel</span>'
    const article = document.createElement('section')
    article.dataset.readerPath = path
    article.append(button)
    document.body.append(article)
    return button
  }

  it('acknowledges a nested-target click and consumes it only once', () => {
    window.eval(readerStartupScript)
    const button = entry('ai')
    const handled = vi.fn()
    button.addEventListener('click', handled)
    button.querySelector('span')!.click()
    expect(document.documentElement.dataset.slaxPendingPanel).toBe('ai')
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(handled).not.toHaveBeenCalled()
    window.__slaxReaderStartup!.navigation.stop()
    expect(window.__slaxReaderStartup!.takePanel('/b/first')).toBe('ai')
    expect(document.documentElement.hasAttribute('data-slax-pending-panel')).toBe(false)
    expect(button.getAttribute('aria-busy')).toBe('false')
    expect(window.__slaxReaderStartup!.takePanel('/b/first')).toBe(null)
    button.click()
    expect(handled).toHaveBeenCalledOnce()
  })

  it('keeps one latest choice rather than toggling or replaying repeated clicks', () => {
    window.eval(readerStartupScript)
    const ai = entry('ai')
    ai.click()
    ai.click()
    const chat = entry('chat')
    chat.click()
    expect(ai.getAttribute('aria-busy')).toBe('false')
    expect(chat.getAttribute('aria-busy')).toBe('true')
    expect(document.documentElement.dataset.slaxPendingPanel).toBe('chat')
    expect(window.__slaxReaderStartup!.takePanel('/b/first')).toBe('chat')
    expect(window.__slaxReaderStartup!.takePanel('/b/first')).toBe(null)
  })

  it('does not carry a pending panel to the next article', () => {
    window.eval(readerStartupScript)
    const ai = entry('ai')
    ai.click()
    window.__slaxReaderStartup!.start('/b/second', false)
    expect(ai.getAttribute('aria-busy')).toBe('false')
    expect(document.documentElement.hasAttribute('data-slax-pending-panel')).toBe(false)
    expect(window.__slaxReaderStartup!.takePanel('/b/second')).toBe(null)
  })

  it('leaves source article buttons with their handler while a destination is loading', () => {
    window.eval(readerStartupScript)
    window.__slaxReaderStartup!.takePanel('/b/first')
    const source = entry('comment')
    const handled = vi.fn()
    source.addEventListener('click', handled)
    window.__slaxReaderStartup!.start('/b/second', false)
    source.click()
    expect(handled).toHaveBeenCalledOnce()
    expect(document.documentElement.hasAttribute('data-slax-pending-panel')).toBe(false)
    entry('chat', '/b/second').click()
    expect(window.__slaxReaderStartup!.takePanel('/b/second')).toBe('chat')
  })

  it('ignores unknown panel ids and stale page claims', () => {
    window.eval(readerStartupScript)
    entry('unknown').click()
    expect(document.documentElement.hasAttribute('data-slax-pending-panel')).toBe(false)
    entry('comment').click()
    expect(window.__slaxReaderStartup!.takePanel('/b/other')).toBe(null)
    expect(document.documentElement.dataset.slaxPendingPanel).toBe('comment')
    expect(window.__slaxReaderStartup!.takePanel('/b/first')).toBe('comment')
  })
})
