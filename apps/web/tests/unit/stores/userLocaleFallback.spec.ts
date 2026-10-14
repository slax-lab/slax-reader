import { createApp } from 'vue'

import { userStoreExtensionPlugin } from '~~/app/plugins/pinia'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useNuxtApp } from '#imports'
import { useUserStore } from '~~/app/stores/user'
import { makeUser } from '~~/tests/fixtures/user'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ token: '', load: vi.fn(), clear: vi.fn(), navigate: vi.fn() }))
mockNuxtImport('useI18n', () => () => ({ locale: { value: 'en' } }))
mockNuxtImport('isLocalFirstEnabled', () => () => true)
mockNuxtImport('loadLocalUserInfo', () => mocks.load)
mockNuxtImport('useAuth', () => () => ({ clearAuth: mocks.clear }))
mockNuxtImport('navigateTo', () => mocks.navigate)
vi.mock('@vueuse/integrations/useCookies', () => ({
  useCookies: () => ({
    get: (name: string) => (name === '_su' ? 'device' : mocks.token),
    set: (_name: string, value: string) => {
      mocks.token = value
    }
  })
}))
const token = (id: number) => `x.${btoa(JSON.stringify({ id, email: id === 1 ? 'test@example.com' : 'b@test' }))}.x`
const pinia = () => {
  const p = createPinia()
  createApp({}).use(p)
  p.use(userStoreExtensionPlugin)
  setActivePinia(p)
  return p
}
let apply: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  mocks.token = token(1)
  mocks.load.mockReset().mockResolvedValue(makeUser({ lang: 'en' }))
  mocks.clear.mockReset()
  mocks.navigate.mockReset()
  pinia()
  apply = vi.spyOn(useNuxtApp().$i18n, 'setLocale').mockResolvedValue(undefined)
})
afterEach(() => {
  vi.unstubAllGlobals()
  apply.mockRestore()
})
it('keeps server-confirmed locale through actual Pinia fallback and rehydration', async () => {
  const f = vi.fn(async (url: string) => new Response(JSON.stringify({ code: 200, message: 'ok', data: url.endsWith('/refresh') ? { token: token(1) } : 'ok' })))
  vi.stubGlobal('fetch', f)
  const store = useUserStore()
  store.user = makeUser()
  await store.changeLocale('zh')
  const persisted = JSON.parse(JSON.stringify(store.$state))
  store.$dispose()
  const p = pinia()
  p.state.value.user = persisted
  const recovered = useUserStore()
  f.mockRejectedValue(new Error('offline'))
  const result = await recovered.refreshUserInfo()
  expect(result.lang).toBe('zh')
  expect(recovered.currentLocale).toBe('zh')
  expect(recovered.confirmedAccountLocale?.locale).toBe('zh')
  mocks.token = token(2)
  mocks.load.mockResolvedValue({ ...makeUser({ lang: 'en' }), userId: 2, email: 'b@test' })
  await recovered.refreshUserInfo()
  expect(recovered.confirmedAccountLocale).toBeNull()
  expect(recovered.user?.email).toBe('b@test')
})
it('does not invoke offline fallback or clear the new cookie on an old 401', async () => {
  let finish!: (response: Response) => void
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>(r => {
          finish = r
        })
    )
  )
  const run = useUserStore()
    .refreshUserInfo()
    .catch(e => e)
  await Promise.resolve()
  await Promise.resolve()
  mocks.token = token(2)
  finish(new Response('', { status: 401 }))
  await run
  expect(mocks.load).not.toHaveBeenCalled()
  expect(mocks.clear).not.toHaveBeenCalled()
  expect(mocks.navigate).not.toHaveBeenCalled()
  expect(mocks.token).toBe(token(2))
})
