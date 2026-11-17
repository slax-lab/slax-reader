import firstPartyAnalytics from '~~/app/plugins/first-party-analytics.client'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  let mounted: (() => void) | undefined
  return {
    eventLog: vi.fn(),
    afterEach: vi.fn(),
    mounted: () => mounted?.(),
    captureMounted: (callback: () => void) => {
      mounted = callback
    }
  }
})

vi.mock('@/utils/analytics', () => ({ eventLog: mocks.eventLog }))
mockNuxtImport('useRouter', () => () => ({
  afterEach: mocks.afterEach,
  beforeResolve: vi.fn(),
  currentRoute: { value: { path: '/b/source', query: {} } }
}))
mockNuxtImport('useError', () => () => ({ value: null }))

const documentListeners: Array<{ type: string; listener: EventListenerOrEventListenerObject; capture: boolean }> = []
const nativeAddEventListener = document.addEventListener

describe('first-party element clicks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
    documentListeners.length = 0
    document.addEventListener = function (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) {
      documentListeners.push({ type, listener, capture: typeof options === 'boolean' ? options : Boolean(options?.capture) })
      nativeAddEventListener.call(document, type, listener, options)
    } as typeof document.addEventListener
    firstPartyAnalytics({
      hook: (name: string, callback: () => void) => {
        if (name === 'app:mounted') mocks.captureMounted(callback)
      }
    } as never)
    mocks.mounted()
    mocks.eventLog.mockClear()
  })

  afterEach(() => {
    for (const { type, listener, capture } of documentListeners) document.removeEventListener(type, listener, capture)
    documentListeners.length = 0
    document.addEventListener = nativeAddEventListener
  })

  it('adds the source snapshot id only to snapshot save clicks', () => {
    document.body.innerHTML = `
      <button data-analytics-element="snapshot_save_button" data-analytics-source-bookmark-id="00000000-0000-4000-8000-000000000001"><span id="save">Save</span></button>
      <button data-analytics-element="bookmark_add_button"><span id="ordinary">Add</span></button>
    `

    document.getElementById('save')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    document.getElementById('save')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    document.getElementById('ordinary')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(mocks.eventLog).toHaveBeenCalledTimes(3)
    const snapshot = mocks.eventLog.mock.calls.filter(([event]) => event.properties.element_id === 'snapshot_save_button')
    expect(snapshot.map(([event]) => event)).toEqual([
      {
        event_name: 'element_clicked',
        properties: {
          element_id: 'snapshot_save_button',
          screen_name: 'detail',
          source_bookmark_id: '00000000-0000-4000-8000-000000000001'
        }
      },
      {
        event_name: 'element_clicked',
        properties: {
          element_id: 'snapshot_save_button',
          screen_name: 'detail',
          source_bookmark_id: '00000000-0000-4000-8000-000000000001'
        }
      }
    ])
    const ordinary = mocks.eventLog.mock.calls.filter(([event]) => event.properties.element_id === 'bookmark_add_button')
    expect(ordinary.map(([event]) => event)).toEqual([{ event_name: 'element_clicked', properties: { element_id: 'bookmark_add_button', screen_name: 'detail' } }])
  })
})
