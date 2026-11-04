import { mountWithApp } from '../../../setup/mount'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// useUserStore（upstream layer alias）—— 同步工厂返回可控 store
const { useUserStoreMock } = vi.hoisted(() => ({ useUserStoreMock: vi.fn() }))
vi.mock('~/stores/user', () => ({
  useUserStore: useUserStoreMock
}))

// showLoginModal（upstream layer 组件）—— 未登录点击订阅时应被调用（需求 1）
vi.mock('~/components/Modal', () => ({
  showLoginModal: vi.fn()
}))

// Toast（默认导出 + ToastType 命名导出）
vi.mock('~/components/Toast', () => ({
  default: { showToast: vi.fn() },
  ToastType: { Success: 'success', Error: 'error' }
}))

// request() —— 订阅 / 退订
const { requestMock } = vi.hoisted(() => ({
  requestMock: vi.fn(() => ({ post: vi.fn().mockResolvedValue({ subscribe: true }) }))
}))
mockNuxtImport('request', () => requestMock)

// 自动导入：onMounted 内读取 URL / route，doSubscribe 成功后 navigateTo
mockNuxtImport('useRequestURL', () => () => ({ href: 'https://example.com/c/test-code' }))
mockNuxtImport('useRoute', () => () => ({ query: {} }))
mockNuxtImport('navigateTo', () => vi.fn())

const { eventLog } = vi.hoisted(() => ({ eventLog: vi.fn() }))
mockNuxtImport('eventLog', () => eventLog)

const makeStore = (overrides = {}) => ({
  userInfo: undefined,
  getUserInfo: vi.fn().mockResolvedValue(null),
  ...overrides
})

const importBtn = async () => (await import('~~/app/components/Collection/SubscribeCollectionButton.vue')).default

describe('SubscribeCollectionButton', () => {
  beforeEach(() => { vi.clearAllMocks(); sessionStorage.clear() })
  afterEach(() => { sessionStorage.clear(); vi.useRealTimers() })
  it('renders the visitor button (accent) when not subscribed', async () => {
    useUserStoreMock.mockReturnValue(makeStore())
    const Btn = await importBtn()
    const wrapper = mountWithApp(Btn, {
      props: { collectionCode: 'test-code', subscribed: false }
    })
    expect(wrapper.find('.collection-action-btn.is-visitor').exists()).toBe(true)
    expect(wrapper.find('.collection-action-btn.is-subscriber').exists()).toBe(false)
  })

  it('renders the subscriber button (subscribed · unsubscribe) when subscribed', async () => {
    useUserStoreMock.mockReturnValue(makeStore())
    const Btn = await importBtn()
    const wrapper = mountWithApp(Btn, {
      props: { collectionCode: 'test-code', subscribed: true }
    })
    expect(wrapper.find('.collection-action-btn.is-subscriber').exists()).toBe(true)
    expect(wrapper.find('.collection-action-btn.is-visitor').exists()).toBe(false)
  })

  it('subscribes via request().post when a logged-in user clicks', async () => {
    const postMock = vi.fn().mockResolvedValue({ subscribe: true })
    requestMock.mockReturnValue({ post: postMock })
    useUserStoreMock.mockReturnValue(makeStore({ getUserInfo: vi.fn().mockResolvedValue({ id: 1 }) }))
    const Btn = await importBtn()
    const wrapper = mountWithApp(Btn, {
      props: { collectionCode: 'test-code', subscribed: false }
    })
    await wrapper.find('.collection-action-btn.is-visitor').trigger('click')
    await flushPromises()
    expect(postMock).toHaveBeenCalled()
  })

  // 未登录点订阅→弹登录，不发请求
  // 未登录 getUserInfo 抛错，用 reject 模拟
  it('shows the login modal when an anonymous user clicks subscribe', async () => {
    const { showLoginModal } = await import('~/components/Modal')
    vi.mocked(showLoginModal).mockClear()
    const postMock = vi.fn()
    requestMock.mockReturnValue({ post: postMock })
    useUserStoreMock.mockReturnValue(makeStore({ getUserInfo: vi.fn().mockRejectedValue(new Error('get user info failed')) }))
    const Btn = await importBtn()
    const wrapper = mountWithApp(Btn, {
      props: { collectionCode: 'test-code', subscribed: false }
    })
    await wrapper.find('.collection-action-btn.is-visitor').trigger('click')
    await flushPromises()
    expect(showLoginModal).toHaveBeenCalled()
    expect(postMock).not.toHaveBeenCalled()
  })

  it('unsubscribes via request().post when a subscriber clicks', async () => {
    const postMock = vi.fn().mockResolvedValue({})
    requestMock.mockReturnValue({ post: postMock })
    useUserStoreMock.mockReturnValue(makeStore())
    const Btn = await importBtn()
    const wrapper = mountWithApp(Btn, {
      props: { collectionCode: 'test-code', subscribed: true }
    })
    await wrapper.find('.collection-action-btn.is-subscriber').trigger('click')
    await flushPromises()
    expect(postMock).toHaveBeenCalled()
  })
  it('counts intent before authentication lookup and passes the originating collection into the modal', async () => {
    const { showLoginModal } = await import('~/components/Modal')
    const store = makeStore()
    useUserStoreMock.mockReturnValue(store)
    const Btn = await importBtn()
    const wrapper = mountWithApp(Btn, { props: { collectionCode: 'Collection123', subscribed: false } })
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(eventLog).toHaveBeenCalledExactlyOnceWith({ event_name: 'element_clicked', properties: { screen_name: 'collection', element_id: 'collection_subscribe_button', collection_id: 'Collection123' } })
    expect(eventLog.mock.invocationCallOrder[0]).toBeLessThan(store.getUserInfo.mock.invocationCallOrder[0]!)
    expect(showLoginModal).toHaveBeenCalledWith({ redirect: 'https://example.com/c/test-code?subscribe_after_login=1', authAttribution: { collection_id: 'Collection123', source_screen: 'collection', presentation: 'modal', trigger_element_id: 'collection_subscribe_button' } })
    wrapper.unmount()
  })

  it('does not count a second intent while a logged-in subscription is busy', async () => {
    let finish!: (value: { subscribe: boolean }) => void
    requestMock.mockReturnValue({ post: vi.fn(() => new Promise(resolve => { finish = resolve })) })
    useUserStoreMock.mockReturnValue(makeStore({ getUserInfo: vi.fn().mockResolvedValue({ id: 1 }) }))
    const Btn = await importBtn()
    const wrapper = mountWithApp(Btn, { props: { collectionCode: 'Collection123', subscribed: false } })
    await wrapper.get('button').trigger('click')
    await flushPromises()
    await wrapper.get('button').trigger('click')
    expect(eventLog).toHaveBeenCalledTimes(1)
    finish({ subscribe: false })
    await flushPromises()
    wrapper.unmount()
  })

  it('resumes a pending subscription after login without inventing another click', async () => {
    const post = vi.fn().mockResolvedValue({ subscribe: false })
    requestMock.mockReturnValue({ post })
    useUserStoreMock.mockReturnValue(makeStore({ userInfo: { id: 1 } }))
    sessionStorage.setItem('slax_subscribe_after_login', JSON.stringify({ code: 'Collection123', referrer: '' }))
    const Btn = await importBtn()
    const wrapper = mountWithApp(Btn, { props: { collectionCode: 'Collection123', subscribed: false } })
    await flushPromises()
    expect(post).toHaveBeenCalledTimes(1)
    expect(eventLog).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('never treats unsubscribe as subscription intent', async () => {
    requestMock.mockReturnValue({ post: vi.fn().mockRejectedValue(new Error('fixture failure')) })
    useUserStoreMock.mockReturnValue(makeStore())
    const Btn = await importBtn()
    const wrapper = mountWithApp(Btn, { props: { collectionCode: 'Collection123', subscribed: true } })
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(eventLog).not.toHaveBeenCalled()
    wrapper.unmount()
  })

})
