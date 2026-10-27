// @vitest-environment happy-dom
import { nextTick, reactive } from 'vue'

import NewsletterAddress from '../../../app/components/NewsletterAddress.vue'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { get, post, mockRequest, mockUseI18n } = vi.hoisted(() => {
  const get = vi.fn(),
    post = vi.fn()
  return {
    get,
    post,
    mockRequest: () => ({ get, post }),
    mockUseI18n: () => ({ t: (key: string) => key })
  }
})
mockNuxtImport('request', () => mockRequest)
mockNuxtImport('useI18n', () => mockUseI18n)
let user: any
vi.mock('~/stores/user', () => ({ useUserStore: () => user }))
const wrappers: ReturnType<typeof mount>[] = []
const create = () => {
  const wrapper = mount(NewsletterAddress, {
    global: { mocks: { $t: (key: string) => key } }
  })
  wrappers.push(wrapper)
  return wrapper
}
beforeEach(() => {
  user = reactive({
    userInfo: { userId: 1, account: null },
    refreshServerUserInfo: vi.fn().mockResolvedValue({})
  })
  get.mockReset()
  post.mockReset()
})
afterEach(() => {
  wrappers.splice(0).forEach(wrapper => wrapper.unmount())
  vi.restoreAllMocks()
})
describe('Newsletter address setup', () => {
  it('sets the account inline, repeats Lab enable, and reads the issued address', async () => {
    get
      .mockResolvedValueOnce({
        address: null,
        domain: 'newsletterreader.slax.dev',
        status: 'account_required'
      })
      .mockResolvedValueOnce({
        address: 'feed+reader@newsletterreader.slax.dev',
        domain: 'newsletterreader.slax.dev',
        status: 'ready'
      })
    post.mockResolvedValue('ok')
    const wrapper = create()
    await flushPromises()
    await wrapper.get('#newsletter-account').setValue('reader')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(post.mock.calls.map(([options]) => options)).toEqual([
      expect.objectContaining({
        url: '/v1/user/setting',
        body: { key: 'account', value: 'reader' }
      }),
      expect.objectContaining({
        url: '/v1/user/setting/enable',
        body: { key: 'lab:newsletter' }
      })
    ])
    expect(user.refreshServerUserInfo).toHaveBeenCalledOnce()
    expect(get).toHaveBeenCalledTimes(2)
    expect(wrapper.get('.newsletter-address').text()).toBe('feed+reader@newsletterreader.slax.dev')
  })

  it('keeps the account form accessible when enable succeeds without issuing an address', async () => {
    get
      .mockResolvedValueOnce({
        address: null,
        domain: 'newsletterreader.slax.dev',
        status: 'not_provisioned'
      })
      .mockResolvedValueOnce({
        address: null,
        domain: 'newsletterreader.slax.dev',
        status: 'account_required'
      })
    post.mockResolvedValue('ok')
    const wrapper = create()
    await flushPromises()
    await wrapper.get('[data-provision-address]').trigger('click')
    await flushPromises()
    expect(wrapper.find('#newsletter-account').exists()).toBe(true)
    expect(wrapper.find('[data-copy-address]').exists()).toBe(false)
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/v1/user/setting/enable',
        body: { key: 'lab:newsletter' }
      })
    )
  })
  it('repairs a binding conflict through account setting, repeated enable, and a fresh address read', async () => {
    get
      .mockResolvedValueOnce({
        address: null,
        domain: 'newsletterreader.slax.com',
        status: 'not_provisioned'
      })
      .mockResolvedValueOnce({
        address: 'feed+another@newsletterreader.slax.com',
        domain: 'newsletterreader.slax.com',
        status: 'ready'
      })
    post.mockRejectedValueOnce({ name: { error: 'address_reserved' } }).mockResolvedValue('ok')
    const wrapper = create()
    await flushPromises()
    await wrapper.get('[data-provision-address]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-copy-address]').exists()).toBe(false)
    await wrapper.get('#newsletter-account').setValue('another')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(post.mock.calls.map(([options]) => [options.url, options.body])).toEqual([
      ['/v1/user/setting/enable', { key: 'lab:newsletter' }],
      ['/v1/user/setting', { key: 'account', value: 'another' }],
      ['/v1/user/setting/enable', { key: 'lab:newsletter' }]
    ])
    expect(wrapper.get('.newsletter-address').text()).toBe('feed+another@newsletterreader.slax.com')
    expect(wrapper.find('[role=alert]').exists()).toBe(false)
  })
  it.each(['account_required', 'invalid_account', 'address_reserved'])('repairs read-only setup status %s after successful Lab enable', async status => {
    get
      .mockResolvedValueOnce({
        address: null,
        domain: 'newsletterreader.slax.dev',
        status
      })
      .mockResolvedValueOnce({
        address: 'feed+repaired@newsletterreader.slax.dev',
        domain: 'newsletterreader.slax.dev',
        status: 'ready'
      })
    post.mockResolvedValue('ok')
    const wrapper = create()
    await flushPromises()
    expect(wrapper.find('[data-copy-address]').exists()).toBe(false)
    if (status === 'address_reserved') expect(wrapper.get('[role=alert]').text()).toContain('newsletter.errors.address_reserved')
    await wrapper.get('#newsletter-account').setValue('repaired')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('.newsletter-address').text()).toBe('feed+repaired@newsletterreader.slax.dev')
  })
  it('preserves an issued address even if the current account is empty and exposes copy', async () => {
    get.mockResolvedValue({
      address: 'feed+original@newsletterreader.slax.dev',
      domain: 'newsletterreader.slax.dev',
      status: 'ready'
    })
    const copy = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: copy }
    })
    const wrapper = create()
    await flushPromises()
    expect(wrapper.find('form').exists()).toBe(false)
    await wrapper.get('[data-copy-address]').trigger('click')
    await flushPromises()
    expect(copy).toHaveBeenCalledWith('feed+original@newsletterreader.slax.dev')
    expect(wrapper.text()).toContain('newsletter.address_stable')
    expect(wrapper.text()).toContain('newsletter.privacy')
  })
  it('renders the reservation error inline and keeps setup available for retry', async () => {
    get.mockResolvedValue({
      address: null,
      domain: 'newsletterreader.slax.dev',
      status: 'not_provisioned'
    })
    post.mockRejectedValue({ name: { error: 'address_reserved' } })
    const wrapper = create()
    await flushPromises()
    await wrapper.get('[data-provision-address]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('newsletter.errors.address_reserved')
    expect(wrapper.find('#newsletter-account').exists()).toBe(true)
    await wrapper.get('#newsletter-account').setValue('another')
    expect(wrapper.get('button[type=submit]').attributes('disabled')).toBeUndefined()
  })
  it('opens the inline account form if provisioning reports a changed invalid account', async () => {
    get.mockResolvedValue({
      address: null,
      domain: 'newsletterreader.slax.dev',
      status: 'not_provisioned'
    })
    post.mockRejectedValue(new Error('invalid_account'))
    const wrapper = create()
    await flushPromises()
    await wrapper.get('[data-provision-address]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('newsletter.errors.invalid_account')
    expect(wrapper.find('#newsletter-account').exists()).toBe(true)
  })
  it.each([
    ['EXISTS_USER_NAME_ERROR', 'account_taken'],
    ['ERROR_PARAM', 'invalid_account']
  ])('shows actionable account-setting error %s', async (name, code) => {
    get.mockResolvedValue({
      address: null,
      domain: 'newsletterreader.slax.dev',
      status: 'account_required'
    })
    post.mockRejectedValue({ name })
    const wrapper = create()
    await flushPromises()
    await wrapper.get('#newsletter-account').setValue('reader')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('newsletter.errors.' + code)
    expect(wrapper.find('#newsletter-account').exists()).toBe(true)
    expect(post).toHaveBeenCalledOnce()
  })
  it('discards a late address response after the account changes', async () => {
    let resolve!: (value: any) => void
    get
      .mockReturnValueOnce(
        new Promise(r => {
          resolve = r
        })
      )
      .mockResolvedValue({
        address: null,
        domain: null,
        status: 'unavailable'
      })
    const wrapper = create()
    user.userInfo.userId = 2
    await nextTick()
    resolve({
      address: 'feed+private@newsletterreader.slax.dev',
      domain: 'newsletterreader.slax.dev',
      status: 'ready'
    })
    await flushPromises()
    expect(wrapper.text()).not.toContain('feed+private@newsletterreader.slax.dev')
  })
})
