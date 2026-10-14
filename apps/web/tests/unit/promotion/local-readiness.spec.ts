// @vitest-environment happy-dom
import { defineComponent, nextTick,ref } from 'vue'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { createPowerSyncPlugin } from '@powersync/vue'
import { enableAutoUnmount,mount } from '@vue/test-utils'
import { useBookmarkData } from '~~/app/composables/bookmark/useBookmarkData'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const env = vi.hoisted(() => ({ db: null as any, states: new Map<string, any>(), token: null as any }))
mockNuxtImport('useNuxtApp', () => () => ({ $powersync: env.db }))
mockNuxtImport('useState', () => (key: string, init: () => unknown) => {
  if (!env.states.has(key)) env.states.set(key, ref(init()))
  return env.states.get(key)
})
mockNuxtImport('haveRequestToken', () => () => true)
mockNuxtImport('getUserToken', () => () => env.token.value)
mockNuxtImport('isLocalFirstEnabled', () => () => true)
mockNuxtImport('isHighlightLocalFirstEnabled', () => () => false)
mockNuxtImport('useI18n', () => () => ({ t: (v: string) => v, locale: ref('en') }))
mockNuxtImport('addChannelMessageHandler', () => () => {})
mockNuxtImport('removeChannelMessageHandler', () => () => {})
vi.mock('@vueuse/core', async () => ({ ...(await vi.importActual<any>('@vueuse/core')), useInfiniteScroll: () => ({ reset: vi.fn() }) }))
enableAutoUnmount(afterEach)
beforeEach(() => {
  env.states.clear()
  env.token = ref(`x.${btoa(JSON.stringify({ id: 'token-owner' }))}.x`)
})

it.each([
  [{ id: 'token-owner' }, 'token-owner'],
  [{ id: 42 }, '42'],
  [{ email: 'fallback@example.test' }, 'fallback@example.test']
])('requires first sync, query success and verified ownership for token claims %j', async (claims, owner) => {
  env.token.value = `x.${btoa(JSON.stringify(claims))}.x`
  const queries: Array<{ sql: string; emit: (state: any) => void }> = []
  let emitStatus!: (status: any) => void
  env.db = {
    currentStatus: { hasSynced: false, connected: false },
    registerListener: ({ statusChanged }: any) => {
      emitStatus = statusChanged
      return () => {}
    },
    customQuery: (query: any) => ({
      watch: () => ({
        registerListener: ({ onStateChange }: any) => {
          queries.push({ sql: query.compile().sql, emit: onStateChange })
          return () => {}
        },
        close: () => {}
      })
    })
  }
  // JWT IDs and /user/me IDs use different Hashid contexts for the same account.
  env.states.set('powersync-owner', ref(owner))
  env.states.set('koc-promotion', ref({ userId: 7, sessionOwner: owner }))
  const filter = { filterStatus: ref('inbox'), filterTopicIds: ref([]), filterCollectionId: ref(0) } as any
  let data!: ReturnType<typeof useBookmarkData>
  mount(
    defineComponent({
      setup() {
        data = useBookmarkData(filter, ref(''))
        return () => null
      }
    }),
    { global: { plugins: [createPowerSyncPlugin({ database: env.db })] } }
  )
  const query = queries.find(q => q.sql.includes('FROM sr_user_bookmark') && q.sql.includes('archive_status = 0'))!
  expect(query).toBeDefined()
  query.emit({ data: [], isLoading: false, isFetching: false })
  await nextTick()
  expect(data.onboardingReady.value).toBe(false)
  emitStatus({ hasSynced: true, connected: false })
  await nextTick()
  expect(data.onboardingReady.value).toBe(true)
  expect(data.isDataEmpty.value).toBe(true)
  query.emit({ data: [], isLoading: false, isFetching: false, error: Error('read failed') })
  await nextTick()
  expect(data.onboardingReady.value).toBe(false)
  query.emit({ data: [{ id: 'a', archive_status: 0, created_at: '2026-01-01', updated_at: '2026-01-01' }], isLoading: false, isFetching: false })
  await nextTick()
  expect(data.onboardingReady.value).toBe(true)
  expect(data.isDataEmpty.value).toBe(false)
  env.states.get('koc-promotion').value.sessionOwner = null
  await nextTick()
  expect(data.onboardingReady.value).toBe(false)
  env.states.get('koc-promotion').value.sessionOwner = owner
  env.token.value = `x.${btoa(JSON.stringify({ id: 'another-owner' }))}.x`
  await nextTick()
  expect(data.onboardingReady.value).toBe(false)
  env.token.value = 'invalid-token'
  await nextTick()
  expect(data.onboardingReady.value).toBe(false)
  env.token.value = undefined
  await nextTick()
  expect(data.onboardingReady.value).toBe(false)
  env.token.value = `x.${btoa(JSON.stringify({ ...claims, iat: 2 }))}.x`
  await nextTick()
  expect(data.onboardingReady.value).toBe(true)
  env.states.get('powersync-owner').value = '8'
  await nextTick()
  expect(data.onboardingReady.value).toBe(false)
})
