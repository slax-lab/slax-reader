// @vitest-environment happy-dom
import { defineComponent, ref, nextTick } from 'vue'
import { mount, enableAutoUnmount } from '@vue/test-utils'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { createPowerSyncPlugin } from '@powersync/vue'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { useBookmarkData } from '~~/app/composables/bookmark/useBookmarkData'

const env = vi.hoisted(() => ({ db: null as any, states: new Map<string, any>() }))
mockNuxtImport('useNuxtApp', () => () => ({ $powersync: env.db }))
mockNuxtImport('useState', () => (key: string, init: () => unknown) => {
  if (!env.states.has(key)) env.states.set(key, ref(init()))
  return env.states.get(key)
})
mockNuxtImport('haveRequestToken', () => () => true)
mockNuxtImport('getUserToken', () => () => 'test-account')
mockNuxtImport('isLocalFirstEnabled', () => () => true)
mockNuxtImport('isHighlightLocalFirstEnabled', () => () => false)
mockNuxtImport('useI18n', () => () => ({ t: (v: string) => v, locale: ref('en') }))
mockNuxtImport('addChannelMessageHandler', () => () => {})
mockNuxtImport('removeChannelMessageHandler', () => () => {})
vi.mock('@vueuse/core', async () => ({ ...(await vi.importActual<any>('@vueuse/core')), useInfiniteScroll: () => ({ reset: vi.fn() }) }))
enableAutoUnmount(afterEach)
beforeEach(() => env.states.clear())

it('uses the installed PowerSync query contract and requires first sync, query success and matching ownership', async () => {
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
  env.states.set('powersync-owner', ref('7'))
  env.states.set('koc-promotion', ref({ userId: 7 }))
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
  env.states.get('powersync-owner').value = '8'
  await nextTick()
  expect(data.onboardingReady.value).toBe(false)
})
