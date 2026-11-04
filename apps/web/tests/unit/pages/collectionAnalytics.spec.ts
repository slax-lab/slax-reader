import { h, nextTick, ref, Suspense } from 'vue'

import CollectionPage from '~~/app/pages/c/[id]/index.vue'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { eventLog, route, consumeEntry } = vi.hoisted(() => ({
  eventLog: vi.fn(),
  route: { params: { id: 'Collection123' }, query: {} as Record<string, string> },
  consumeEntry: vi.fn(() => 'external_link')
}))
const info = ref<any>()
const pending = ref(false)
const error = ref<Error | null>(null)
mockNuxtImport('useRoute', () => () => route)
mockNuxtImport('useAsyncData', () => async () => ({ data: info, pending, error }))
mockNuxtImport('consumeEventEntry', () => consumeEntry)
mockNuxtImport('useSchemaOrg', () => vi.fn())
mockNuxtImport('useRobotsRule', () => vi.fn())
mockNuxtImport('useRequestURL', () => () => new URL('https://fixture.test/c/Collection123'))
mockNuxtImport('request', () => () => ({ post: vi.fn().mockResolvedValue(undefined) }))
vi.mock('~/stores/user', () => ({ useUserStore: () => ({ userInfo: null, getUserInfo: vi.fn().mockRejectedValue(new Error('anonymous')) }) }))
vi.mock('@/utils/analytics', () => ({ eventLog }))

enableAutoUnmount(afterEach)
const open = async () => {
  const wrapper = mountWithApp({ render: () => h(Suspense, null, { default: () => h(CollectionPage) }) }, {
    global: { stubs: { ThemeSwitcher: true, SubscribeCollectionButton: true, BookmarkCell: true } }
  })
  await flushPromises()
  return wrapper
}

describe('public collection observations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    route.params.id = 'Collection123'
    route.query = {}
    info.value = { status: 1, list: [], bookmark_count: 0, subscrition_count: 0, collection_name: 'Fixture', publisher_name: 'Fixture', is_owner: false }
    pending.value = false
    error.value = null
    consumeEntry.mockReturnValue('external_link')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('counts a usable empty collection once and identifies the public surface', async () => {
    const wrapper = await open()
    expect(wrapper.find('.cp-empty-inline').exists()).toBe(true)
    expect(eventLog).toHaveBeenCalledExactlyOnceWith({ event_name: 'collection_opened', properties: { collection_id: 'Collection123', opened_from: 'external_link', surface: 'public_page' } })
    info.value = { ...info.value, subscrition_count: 20 }
    pending.value = true
    await nextTick()
    pending.value = false
    await nextTick()
    expect(eventLog).toHaveBeenCalledTimes(1)
  })

  it.each(['missing', 'closed', 'loading', 'out-of-range'])('does not count %s content as a usable open', async state => {
    if (state === 'missing') info.value = null
    if (state === 'closed') info.value.status = 0
    if (state === 'loading') pending.value = true
    if (state === 'out-of-range') route.query.page = '2'
    await open()
    expect(eventLog).not.toHaveBeenCalled()
  })

  it('waits for late data readiness and preserves the original entry source', async () => {
    pending.value = true
    consumeEntry.mockReturnValue('inbox')
    await open()
    expect(eventLog).not.toHaveBeenCalled()
    pending.value = false
    await nextTick()
    expect(eventLog).toHaveBeenCalledExactlyOnceWith({ event_name: 'collection_opened', properties: { collection_id: 'Collection123', opened_from: 'inbox', surface: 'public_page' } })
  })

  it('counts re-entry and another collection as new entries', async () => {
    const first = await open()
    first.unmount()
    const returned = await open()
    returned.unmount()
    route.params.id = 'Other456'
    await open()
    expect(eventLog).toHaveBeenCalledTimes(3)
    expect(eventLog.mock.calls[2]![0].properties.collection_id).toBe('Other456')
  })
})
