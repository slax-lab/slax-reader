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
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  vi.restoreAllMocks()
})
describe('Newsletter address setup', () => {
  it('sets the account inline, refreshes the profile, and then provisions the address', async () => {
    get.mockResolvedValue({
      address: null,
      domain: 'slax.dev',
      status: 'account_required'
    })
    post.mockImplementation(({ url }) => Promise.resolve(url.endsWith('newsletter_address') ? { address: 'reader@slax.dev', domain: 'slax.dev', status: 'ready' } : {}))
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
      expect.objectContaining({ url: '/v1/user/newsletter_address' })
    ])
    expect(user.refreshServerUserInfo).toHaveBeenCalledOnce()
    expect(wrapper.get('.newsletter-address').text()).toBe('reader@slax.dev')
  })
  it('preserves an issued address even if the current account is empty and exposes copy', async () => {
    get.mockResolvedValue({
      address: 'original@slax.dev',
      domain: 'slax.dev',
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
    expect(copy).toHaveBeenCalledWith('original@slax.dev')
    expect(wrapper.text()).toContain('newsletter.address_stable')
    expect(wrapper.text()).toContain('newsletter.privacy')
  })
  it('renders the reservation error inline and keeps setup available for retry', async () => {
    get.mockResolvedValue({
      address: null,
      domain: 'slax.dev',
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
      domain: 'slax.dev',
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
  it.each([['EXISTS_USER_NAME_ERROR', 'account_taken'], ['ERROR_PARAM', 'invalid_account']])('shows actionable account-setting error %s', async (name, code) => {
    get.mockResolvedValue({address:null,domain:'slax.dev',status:'account_required'})
    post.mockRejectedValue({name})
    const wrapper=create()
    await flushPromises()
    await wrapper.get('#newsletter-account').setValue('reader')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('newsletter.errors.'+code)
    expect(wrapper.find('#newsletter-account').exists()).toBe(true)
    expect(post).toHaveBeenCalledOnce()
  })
  it('discards a late address response after the account changes', async () => {
    let resolve!: (value: any) => void
    get
      .mockReturnValueOnce(
        new Promise((r) => {
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
      address: 'private@slax.dev',
      domain: 'slax.dev',
      status: 'ready'
    })
    await flushPromises()
    expect(wrapper.text()).not.toContain('private@slax.dev')
  })
})
