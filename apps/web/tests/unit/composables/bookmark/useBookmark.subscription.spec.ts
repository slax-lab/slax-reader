import { effectScope, nextTick, reactive, ref } from 'vue'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { makeUser } from '~~/tests/fixtures/user'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ store: {} as any, account: {} as any, upgrade: vi.fn(), login: vi.fn() }))
vi.mock('~/stores/user', () => ({ useUserStore: () => mocks.store }))
vi.mock('~/composables/useAccountContext', () => ({ useAccountContext: () => mocks.account }))
vi.mock('~/components/SubscriptionModal', () => ({ default: { showModal: mocks.upgrade } }))
vi.mock('~/components/Modal', () => ({ showLoginModal: mocks.login }))
vi.mock('~~/app/composables/bookmark/useCommon', () => ({
  useResize: () => ({ summariesExpanded: ref(false), botExpanded: ref(false) })
}))
mockNuxtImport('useScroll', () => () => ({ y: ref(0) }))
mockNuxtImport('useRequestURL', () => () => ({ href: 'https://example.invalid/b/reader' }))
mockNuxtImport('useLogBookmark', () => vi.fn())
mockNuxtImport('logChat', () => vi.fn())
mockNuxtImport('logAnalyzed', () => vi.fn())
import { useBookmark } from '~~/app/composables/bookmark/useBookmark'

let scope: ReturnType<typeof effectScope>
const start = () => {
  scope = effectScope()
  const selected = ref(true)
  const chatbot = ref({ addQuoteData: vi.fn(), focusTextarea: vi.fn() })
  const bookmark = scope.run(() => useBookmark({ chatbot, typeOptions: () => ({ type: 'normal', bmId: 1 }), quoteActive: () => selected.value } as Parameters<typeof useBookmark>[0]))!
  return { bookmark, chatbot, selected }
}
const confirm = (expired = false) => {
  mocks.store.userInfo = makeUser({ subscription_end_at: expired ? '2000-01-01T00:00:00Z' : '2099-01-01T00:00:00Z', subscription_type: 2 })
  mocks.account.context.value = { accountKey: 'a', status: 'ready', serverUserId: 1, generation: 0 }
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.store = reactive({ userInfo: null, isLogin: true, refreshServerUserInfo: vi.fn(() => new Promise(() => {})) })
  mocks.account = { context: ref({ accountKey: 'a', status: 'local', serverUserId: null, generation: 0 }) }
})
afterEach(() => scope.stop())

it('keeps a pending click closed without prompting, then permits the verified subscriber', async () => {
  const { bookmark } = start()
  expect(bookmark.showChatbot()).toBe(false)
  expect(mocks.upgrade).not.toHaveBeenCalled()
  confirm()
  await nextTick()
  expect(bookmark.showChatbot()).toBe(true)
  expect(mocks.store.refreshServerUserInfo).toHaveBeenCalledTimes(1)
})
it('delivers a pending selection once after verification without sending a message', async () => {
  const { bookmark, chatbot } = start()
  const quote = { text: 'selected passage' }
  bookmark.chatBotQuote(quote)
  await nextTick()
  expect(chatbot.value.addQuoteData).not.toHaveBeenCalled()
  confirm()
  await nextTick()
  expect(chatbot.value.addQuoteData).toHaveBeenCalledExactlyOnceWith(quote)
})
it('discards a pending selection when the selected panel is abandoned', async () => {
  const { bookmark, chatbot, selected } = start()
  bookmark.chatBotQuote({ text: 'abandoned' })
  await nextTick()
  selected.value = false
  confirm()
  await nextTick()
  selected.value = true
  await nextTick()
  expect(chatbot.value.addQuoteData).not.toHaveBeenCalled()
})
it('retains the confirmed inactive upgrade flow', () => {
  confirm(true)
  const { bookmark } = start()
  expect(bookmark.showAnalyzed()).toBe(false)
  expect(mocks.upgrade).toHaveBeenCalledOnce()
})
it('retains the login check even while the subscription is unresolved', () => {
  mocks.store.isLogin = false
  const { bookmark } = start()
  expect(bookmark.showChatbot()).toBe(false)
  expect(mocks.login).toHaveBeenCalledOnce()
  expect(mocks.upgrade).not.toHaveBeenCalled()
})
