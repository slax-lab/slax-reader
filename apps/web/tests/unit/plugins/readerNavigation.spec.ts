import plugin from '~~/app/plugins/reader-navigation.client'

import { readerStartupScript } from '~~/app/utils/readerStartup'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let navigate: (to: any, from: any) => void
beforeEach(() => {
  window.history.replaceState({}, '', '/b/first')
  window.eval(readerStartupScript)
  plugin.setup!({ $router: { beforeEach: (guard: typeof navigate) => { navigate = guard } } } as any)
})
afterEach(() => { window.__slaxReaderStartup!.takePanel(window.__slaxReaderStartup!.navigation.path); window.__slaxReaderStartup!.navigation.stop() })
const from = { path: '/b/first', matched: [{}] }
const to = (fullPath: string) => {
  const url = new URL(fullPath, location.origin)
  return { path: url.pathname, fullPath, hash: url.hash, query: Object.fromEntries(url.searchParams) }
}
describe('reader navigation handoff', () => {
  it('latches a same-page highlight across query consumption and cancels current corrections', () => {
    const cancelled = vi.fn()
    window.addEventListener('slax:reader-navigation', cancelled, { once: true })
    navigate(to('/b/first?highlight=mark'), from)
    navigate(to('/b/first'), from)
    expect(window.__slaxReaderStartup!.navigation.explicit).toBe(true)
    expect(cancelled).toHaveBeenCalledOnce()
  })
  it('leaves ordinary query changes alone', () => {
    const navigation = window.__slaxReaderStartup!.navigation
    navigate(to('/b/first?view=reading'), from)
    expect(window.__slaxReaderStartup!.navigation).toBe(navigation)
    expect(navigation.explicit).toBe(false)
  })
  it('starts fresh for normal navigation but preserves Back/Forward intent', () => {
    window.dispatchEvent(new WheelEvent('wheel'))
    navigate(to('/b/second'), from)
    expect(window.__slaxReaderStartup!.navigation.interacted).toBe(false)
    expect(window.__slaxReaderStartup!.navigation.initial).toBe(false)
    window.__slaxReaderStartup!.historyPath = '/b/first'
    navigate(to('/b/first'), { path: '/b/second', matched: [{}] })
    expect(window.__slaxReaderStartup!.navigation.history).toBe(true)
  })
})
