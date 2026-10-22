// @vitest-environment happy-dom
import { defineComponent, nextTick, ref, watch } from 'vue'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { BasePowerSyncDatabase, OnChangeQueryProcessor } from '@powersync/shared-internals'
import { createPowerSyncPlugin } from '@powersync/vue'
import { enableAutoUnmount,mount } from '@vue/test-utils'
import { flushPromises } from '@vue/test-utils'
import { useBookmarkData } from '~~/app/composables/bookmark/useBookmarkData'
import { useInboxOnboardingState } from '~~/app/composables/bookmark/useInboxOnboardingState'
import { useKocPromotionController } from '~~/app/composables/promotion/useKocPromotionFlow'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

// Node 22 omits node:sqlite from builtinModules, so Vitest tries to bundle a static import.
// Load the real Node module directly while keeping the Vue fixture in happy-dom.
const { DatabaseSync } = process.getBuiltinModule('node:sqlite')

const env = vi.hoisted(() => ({ db: null as any, states: new Map<string, any>(), token: '', profile: vi.fn() }))
mockNuxtImport('useNuxtApp', () => () => ({ $powersync: env.db }))
mockNuxtImport('useState', () => (key: string, init: () => unknown) => {
  if (!env.states.has(key)) env.states.set(key, ref(init()))
  return env.states.get(key)
})
mockNuxtImport('haveRequestToken', () => () => true)
mockNuxtImport('getUserToken', () => () => env.token)
mockNuxtImport('useRoute', () => () => ({ query: {} }))
mockNuxtImport('useRuntimeConfig', () => () => ({ public: { DWEB_API_BASE_URL: 'https://api.test' } }))
vi.mock('~/stores/user', () => ({ useUserStore: () => ({ refreshServerUserInfo: env.profile }) }))
mockNuxtImport('isLocalFirstEnabled', () => () => true)
mockNuxtImport('isHighlightLocalFirstEnabled', () => () => false)
mockNuxtImport('useI18n', () => () => ({ t: (v: string) => v, locale: ref('en') }))
mockNuxtImport('addChannelMessageHandler', () => () => {})
mockNuxtImport('removeChannelMessageHandler', () => () => {})
vi.mock('@vueuse/core', async () => ({ ...(await vi.importActual<any>('@vueuse/core')), useInfiniteScroll: () => ({ reset: vi.fn() }) }))
vi.mock('~/composables/useExtensionDetection', () => ({ useExtensionDetection: () => ({ isInstalled: ref(false), checked: ref(true) }) }))
enableAutoUnmount(afterEach)
beforeEach(() => {
  env.states.clear()
  localStorage.clear()
  env.token = `x.${btoa(JSON.stringify({ id: 'token-owner' }))}.x`
  env.profile.mockReset().mockResolvedValue({ userId: 7 })
})

function mountLocal(alreadySynced = false) {
  const sql = new DatabaseSync(':memory:')
  sql.exec(`
    CREATE TABLE sr_user_bookmark (id TEXT, archive_status INTEGER, deleted_at TEXT);
    CREATE TABLE sr_user_collection (id TEXT);
    CREATE TABLE sr_user_collection_subscriber (collection_id TEXT, is_cancelled INTEGER);
  `)
  let rows: any[] = []
  const listeners = new Set<any>()
  const tableListeners = new Set<any>()
  const proto = BasePowerSyncDatabase.prototype as any
  env.db = {
    currentStatus: { hasSynced: alreadySynced, connected: false },
    registerListener: (listener: any) => { listeners.add(listener); return () => listeners.delete(listener) },
    database: { registerListener: (listener: any) => { tableListeners.add(listener); return () => tableListeners.delete(listener) } },
    waitForReady: async () => {},
    resolveTables: async () => ['sr_user_bookmark', 'sr_user_collection_subscriber'],
    getAll: vi.fn(async (query: string) => query.includes('AS is_empty') ? sql.prepare(query).all() : query.includes('FROM sr_user_bookmark') ? rows : []),
    onChangeWithCallback: proto.onChangeWithCallback,
    handleTableChanges: proto.handleTableChanges,
    processTableUpdates: proto.processTableUpdates,
    customQuery: (query: any) => ({ watch: (options: any) => new OnChangeQueryProcessor({
      db: env.db, placeholderData: [], watchOptions: { query, ...options }
    }) })
  }
  env.states.set('powersync-owner', ref('token-owner'))
  const filter = { filterStatus: ref('inbox'), filterTopicIds: ref([]), filterCollectionId: ref(0) } as any
  let data!: ReturnType<typeof useBookmarkData>
  let flow!: ReturnType<typeof useInboxOnboardingState>
  let selectedOnboarding = false
  let identity!: ReturnType<typeof useKocPromotionController>
  const wrapper = mount(defineComponent({ setup() {
    identity = useKocPromotionController()
    void identity.identify()
    data = useBookmarkData(filter, ref(''))
    flow = useInboxOnboardingState({
      isCurrentInboxTab: ref(true), subscribedCount: ref(0), subscriptionReady: ref(true),
      isDataEmpty: data.isDataEmpty, isFirstLoad: data.isFirstLoad, onboardingReady: data.onboardingReady,
      confirmEmpty: data.confirmOnboardingEmpty, userId: ref(7)
    })
    watch(flow.inboxState, value => { selectedOnboarding = value === 'A' }, { immediate: true })
    return () => null
  } }), { global: { plugins: [createPowerSyncPlugin({ database: env.db })] } })
  return {
    data, flow, sql, wrapper, identity, selected: () => selectedOnboarding,
    sync: (bookmarks = false) => {
      if (bookmarks) rows = [{ id: 'downloaded', archive_status: 0, created_at: '2026-01-01', updated_at: '2026-01-01' }]
      for (const listener of tableListeners) listener.tablesUpdated?.({ tables: ['sr_user_bookmark', 'sr_user_collection_subscriber'] })
      for (const listener of listeners) listener.statusChanged?.({ hasSynced: true, connected: true })
    }
  }
}

it.each(['bookmarks', 'subscriptions'])('does not select onboarding before throttled %s queries refresh after first sync', async kind => {
  vi.useFakeTimers()
  const local = mountLocal()
  try {
    await flushPromises()
    expect(local.data.isDataEmpty.value).toBe(true)
    expect(local.data.onboardingReady.value).toBe(false)
    if (kind === 'bookmarks') local.sql.exec("INSERT INTO sr_user_bookmark VALUES ('downloaded', 0, NULL)")
    else local.sql.exec("INSERT INTO sr_user_collection VALUES ('collection'); INSERT INTO sr_user_collection_subscriber VALUES ('collection', 0)")
    local.sync(kind === 'bookmarks')
    await nextTick()
    await vi.advanceTimersByTimeAsync(31)
    await flushPromises()
    expect(local.selected()).toBe(false)
    expect(localStorage.getItem('slax_onboarding_pending_7')).toBeNull()
    if (kind === 'bookmarks') expect(local.data.isDataEmpty.value).toBe(false)
  } finally {
    local.wrapper.unmount()
    local.sql.close()
    vi.useRealTimers()
  }
})

it.each([
  ['', true],
  ["INSERT INTO sr_user_bookmark VALUES ('archived', 1, NULL)", true],
  ["INSERT INTO sr_user_bookmark VALUES ('deleted', 0, '2026-01-01')", true],
  ["INSERT INTO sr_user_collection VALUES ('c'); INSERT INTO sr_user_collection_subscriber VALUES ('c', 1)", true],
  ["INSERT INTO sr_user_collection_subscriber VALUES ('missing', 0)", true],
  ["INSERT INTO sr_user_collection VALUES ('c'); INSERT INTO sr_user_collection_subscriber VALUES ('c', NULL)", false]
])('confirms previously synced offline data with the existing Inbox audience: %s', async (seed, empty) => {
  const local = mountLocal(true)
  try {
    if (seed) local.sql.exec(seed)
    await flushPromises()
    expect(local.flow.inboxState.value).toBe(empty ? 'A' : 'B')
    expect(local.selected()).toBe(empty)
  } finally {
    local.wrapper.unmount()
    local.sql.close()
  }
})

it('rejects a database confirmation that settles after ownership changes', async () => {
  const local = mountLocal()
  try {
    await flushPromises()
    const read = env.db.getAll.getMockImplementation()
    let release!: () => void
    env.db.getAll.mockImplementation((query: string) => query.includes('AS is_empty') ? new Promise(resolve => { release = () => resolve([{ is_empty: 1 }]) }) : read(query))
    local.sync()
    await flushPromises()
    env.states.get('powersync-owner').value = '8'
    release()
    await flushPromises()
    expect(local.flow.inboxState.value).toBeNull()
    expect(local.selected()).toBe(false)
  } finally {
    local.wrapper.unmount()
    local.sql.close()
  }
})

it('does not set onboarding pending after a failed confirmation', async () => {
  const local = mountLocal()
  try {
    await flushPromises()
    const read = env.db.getAll.getMockImplementation()
    env.db.getAll.mockImplementation((query: string) => query.includes('AS is_empty') ? Promise.reject(Error('read failed')) : read(query))
    local.sync()
    await flushPromises()
    expect(local.flow.inboxState.value).toBeNull()
    expect(localStorage.getItem('slax_onboarding_pending_7')).toBeNull()
  } finally {
    local.wrapper.unmount()
    local.sql.close()
  }
})

it('does not use a profile response from a superseded session as local ownership', async () => {
  let release!: (value: unknown) => void
  env.profile.mockReturnValueOnce(new Promise(resolve => { release = resolve }))
  const local = mountLocal(true)
  try {
    await flushPromises()
    expect(local.selected()).toBe(true)
    env.token = `x.${btoa(JSON.stringify({ id: 'another-owner' }))}.x`
    env.states.get('powersync-owner').value = 'another-owner'
    release({ userId: 7 })
    await flushPromises()
    expect(local.selected()).toBe(false)
    expect(local.data.onboardingReady.value).toBe(false)
    expect(local.identity.state.value.userId).toBeNull()
  } finally {
    local.wrapper.unmount()
    local.sql.close()
  }
})
