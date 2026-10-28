// @vitest-environment happy-dom
import { nextTick, reactive, ref } from 'vue'

import NewsletterAddress from '../../../app/components/NewsletterAddress.vue'

import { RequestError } from '@commons/frontend-utils/request'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { get, profileGet, post, mockRequest } = vi.hoisted(() => ({
  get: vi.fn(),
  profileGet: vi.fn(),
  post: vi.fn(),
  mockRequest: () => ({ get: (options: { url: string }) => (options.url === '/v1/user/userinfo' ? profileGet(options) : get(options)), post })
}))
mockNuxtImport('request', () => mockRequest)
mockNuxtImport('useI18n', () => () => ({ t: (key: string) => key }))
let user: { userInfo: { userId: number }; refreshServerUserInfo: ReturnType<typeof vi.fn> }, session: ReturnType<typeof ref<{ generation: number }>>, sessionToken: string
vi.mock('~/stores/user', () => ({ useUserStore: () => user }))
vi.mock('~/composables/useAccountContext', () => ({
  useAccountContext: () => ({
    context: session,
    snapshot: () => ({ token: sessionToken })
  })
}))
const domain = 'newsletterreader.slax.dev'
const empty = { address: null, domain, status: 'account_required' }
const ready = {
  address: 'feed+reader@newsletterreader.slax.dev',
  domain,
  status: 'ready'
}
const wrappers: ReturnType<typeof mount>[] = []
const create = () => {
  const wrapper = mount(NewsletterAddress, {
    attachTo: document.body,
    global: { mocks: { $t: (key: string) => key } }
  })
  wrappers.push(wrapper)
  return wrapper
}
const submit = async (wrapper: ReturnType<typeof mount>, name = 'reader') => {
  await wrapper.get('#newsletter-account').setValue(name)
  await wrapper.get('form').trigger('submit')
  await flushPromises()
}
const confirm = async (wrapper: ReturnType<typeof mount>) => {
  await wrapper.get('[data-confirm-address]').trigger('click')
  await flushPromises()
}
beforeEach(() => {
  user = reactive({
    userInfo: { userId: 1 },
    refreshServerUserInfo: vi.fn().mockResolvedValue({})
  })
  session = ref({ generation: 0 })
  sessionToken = 'first-session'
  localStorage.clear()
  get.mockReset().mockResolvedValue(empty)
  profileGet.mockReset().mockResolvedValue({ account: '' })
  post.mockReset().mockResolvedValue('ok')
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  })
  vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (this: HTMLDialogElement) {
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  })
})
afterEach(() => {
  wrappers.splice(0).forEach(w => w.unmount())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('confirmed Newsletter setup', () => {
  it.each(['alex', 'abcde', 'Reader01', 'jane.doe', 'reader-1', ' reader01', 'reader01 ', '读者reader', 'abcdefghijklmnop'])('does not confirm an invalid first-configuration token %j', async name => {
    const w = create()
    await flushPromises()
    await submit(w, name)
    expect(w.find('dialog[open]').exists()).toBe(false)
    expect(w.get('#newsletter-account-error').text()).toContain('newsletter.errors.invalid_account')
    expect(post).not.toHaveBeenCalled()
  })
  it('shows the complete candidate before writes and cancellation leaves the draft unchanged', async () => {
    const w = create()
    await flushPromises()
    await submit(w, 'reader')
    expect(post).not.toHaveBeenCalled()
    expect(w.get('dialog').attributes('open')).toBeDefined()
    expect(w.get('[data-confirm-candidate]').text()).toBe('feed+reader@newsletterreader.slax.dev')
    expect(w.get('dialog').text()).toContain('newsletter.confirm_permanent')
    await w.get('[data-cancel-address]').trigger('click')
    expect(post).not.toHaveBeenCalled()
    expect(w.get('#newsletter-account').element).toHaveProperty('value', 'reader')
  })
  it('confirms the frozen candidate and reads the actual issued address', async () => {
    get.mockResolvedValueOnce(empty).mockResolvedValueOnce(ready)
    const w = create()
    await flushPromises()
    await submit(w, 'reader')
    await confirm(w)
    expect(post.mock.calls.map(([p]) => [p.url, p.body])).toEqual([
      ['/v1/user/setting', { key: 'account', value: 'reader' }],
      [
        '/v1/user/setting/enable',
        {
          key: 'lab:newsletter',
          newsletter_address: 'feed+reader@newsletterreader.slax.dev'
        }
      ]
    ])
    expect(w.get('.newsletter-address').text()).toBe(ready.address)
    expect(w.find('dialog[open]').exists()).toBe(false)
    expect(user.refreshServerUserInfo).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(w.get('[data-copy-address]').element)
  })
  it('prefills an existing account and still confirms without rewriting the account', async () => {
    profileGet.mockResolvedValue({ account: 'reader' })
    get.mockResolvedValueOnce({ ...empty, status: 'not_provisioned' }).mockResolvedValueOnce(ready)
    const w = create()
    await flushPromises()
    expect(w.get('#newsletter-account').element).toHaveProperty('value', 'reader')
    await w.get('form').trigger('submit')
    expect(post).not.toHaveBeenCalled()
    await confirm(w)
    expect(post).toHaveBeenCalledOnce()
    expect(post.mock.calls[0][0].body.newsletter_address).toBe(ready.address)
  })
  it('keeps detail-read failure retryable without creating from unverified account state', async () => {
    profileGet.mockRejectedValueOnce(new Error('private profile failure'))
    const w = create()
    await flushPromises()
    expect(w.find('#newsletter-account').exists()).toBe(false)
    expect(w.get('.setup-error').text()).toContain('newsletter.errors.unavailable')
    expect(w.text()).not.toContain('private profile failure')
    profileGet.mockResolvedValue({ account: 'reader' })
    await w.get('.setup-error button').trigger('click')
    await flushPromises()
    expect(w.get('#newsletter-account').element).toHaveProperty('value', 'reader')
    expect(post).not.toHaveBeenCalled()
  })
  it('does not refresh the unrelated lightweight profile after changing the Reader account', async () => {
    user.refreshServerUserInfo.mockImplementation(() => {
      session.value.generation++
      return Promise.reject(new Error('profile failed'))
    })
    post.mockResolvedValueOnce('ok').mockRejectedValueOnce(new Error('creation failed'))
    const w = create()
    await flushPromises()
    await submit(w, 'newreader')
    await confirm(w)
    expect(user.refreshServerUserInfo).not.toHaveBeenCalled()
    expect(w.get('#newsletter-account').element).toHaveProperty('value', 'newreader')
    expect(w.get('.setup-error').text()).toContain('newsletter.errors.unavailable')
  })
  it.each(['EXISTS_USER_NAME_ERROR', 'address_reserved'])('shows field feedback without raw errors for %s', async code => {
    const name = code === 'EXISTS_USER_NAME_ERROR' ? code : { error: code }
    post.mockRejectedValueOnce(
      new RequestError({
        message: 'private raw error',
        name: name as string,
        code: 409
      })
    )
    const w = create()
    await flushPromises()
    await submit(w, 'taken01')
    await confirm(w)
    expect(w.get('#newsletter-account-error').text()).toContain('newsletter.errors.' + (code === 'EXISTS_USER_NAME_ERROR' ? 'account_taken' : code))
    expect(w.get('#newsletter-account').attributes('aria-invalid')).toBe('true')
    expect(w.get('#newsletter-account').attributes('aria-describedby')).toContain('newsletter-account-error')
    expect(w.get('#newsletter-account').element).toHaveProperty('value', 'taken01')
    expect(w.text()).not.toContain('private raw error')
    await w.get('#newsletter-account').setValue('available')
    expect(w.find('#newsletter-account-error').exists()).toBe(false)
    expect(w.get('button[type=submit]').attributes('disabled')).toBeUndefined()
  })
  it('allows repair of a reserved address returned by GET', async () => {
    get.mockResolvedValue({ ...empty, status: 'address_reserved' })
    const w = create()
    await flushPromises()
    expect(w.get('#newsletter-account-error').text()).toContain('newsletter.errors.address_reserved')
    await w.get('#newsletter-account').setValue('available')
    expect(w.find('#newsletter-account-error').exists()).toBe(false)
  })
  it('shows pending feedback and prevents duplicate confirmation or Escape while submitting', async () => {
    let finish!: (value: string) => void
    post.mockReturnValueOnce(
      new Promise(resolve => {
        finish = resolve
      })
    )
    get.mockResolvedValueOnce(empty).mockResolvedValueOnce(ready)
    const w = create()
    await flushPromises()
    await submit(w)
    await w.get('[data-confirm-address]').trigger('click')
    await nextTick()
    expect(w.get('[data-confirm-address]').attributes('disabled')).toBeDefined()
    expect(w.get('[data-confirm-address]').text()).toContain('newsletter.creating')
    await w.get('[data-confirm-address]').trigger('click')
    expect(post).toHaveBeenCalledOnce()
    const event = new Event('cancel', { cancelable: true })
    w.get('dialog').element.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    finish('ok')
    await flushPromises()
    expect(post).toHaveBeenCalledTimes(2)
    expect(w.get('.newsletter-address').text()).toBe(ready.address)
  })
  it('distinguishes infrastructure failure and preserves the draft for retry', async () => {
    post.mockRejectedValueOnce(new Error('connection string must not be rendered'))
    const w = create()
    await flushPromises()
    await submit(w)
    await confirm(w)
    expect(w.get('[role=alert]').text()).toContain('newsletter.errors.unavailable')
    expect(w.get('#newsletter-account').attributes('aria-invalid')).toBe('false')
    expect(w.get('#newsletter-account').element).toHaveProperty('value', 'reader')
    expect(w.text()).not.toContain('connection string')
    expect(w.get('button[type=submit]').attributes('disabled')).toBeUndefined()
  })
  it('refreshes a changed candidate without issuing a different address silently', async () => {
    post.mockResolvedValueOnce('ok').mockRejectedValueOnce({ name: { error: 'address_changed' } })
    get.mockResolvedValueOnce(empty).mockResolvedValueOnce(ready)
    const w = create()
    await flushPromises()
    await submit(w, 'older01')
    await confirm(w)
    expect(w.get('.newsletter-address').text()).toBe(ready.address)
    expect(w.text()).not.toContain('feed+older01@')
  })
  it.each(['..invalid', '-invalid', 'a'.repeat(60)])('does not confirm invalid account %s', async name => {
    const w = create()
    await flushPromises()
    await submit(w, name)
    expect(w.find('dialog[open]').exists()).toBe(false)
    expect(post).not.toHaveBeenCalled()
  })
})
describe('disclosure and session isolation', () => {
  it('retains address/copy while collapsed and restores the preference independently per user', async () => {
    get.mockResolvedValue(ready)
    let w = create()
    await flushPromises()
    await w.get('[data-toggle-newsletter]').trigger('click')
    expect(w.get('[data-toggle-newsletter]').attributes('aria-expanded')).toBe('false')
    expect(w.get('.newsletter-address').text()).toBe(ready.address)
    expect(w.get('[data-copy-address]').isVisible()).toBe(true)
    expect(w.get('#newsletter-details').isVisible()).toBe(false)
    w.unmount()
    w = create()
    await flushPromises()
    expect(w.get('[data-toggle-newsletter]').attributes('aria-expanded')).toBe('false')
    get.mockResolvedValue({
      ...ready,
      address: 'feed+other@newsletterreader.slax.dev'
    })
    user.userInfo.userId = 2
    await flushPromises()
    expect(w.get('[data-toggle-newsletter]').attributes('aria-expanded')).toBe('true')
    expect(w.text()).not.toContain(ready.address)
  })
  it('storage failure does not block load, disclosure or copy', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    get.mockResolvedValue(ready)
    const w = create()
    await flushPromises()
    await w.get('[data-toggle-newsletter]').trigger('click')
    await w.get('[data-copy-address]').trigger('click')
    await flushPromises()
    expect(w.get('[data-copy-address]').text()).toContain('newsletter.copied')
    expect(writeText).toHaveBeenCalledWith(ready.address)
  })
  it('closes confirmation and clears the draft on an owner change', async () => {
    const w = create()
    await flushPromises()
    await submit(w, 'private-draft')
    profileGet.mockResolvedValue({ account: 'other' })
    user.userInfo = { userId: 2 }
    await flushPromises()
    expect(w.find('dialog[open]').exists()).toBe(false)
    expect(w.text()).not.toContain('private-draft')
    expect(w.get('#newsletter-account').element).toHaveProperty('value', 'other')
    expect(post).not.toHaveBeenCalled()
  })
  it('rejects an obsolete confirmation after token replacement with the same user id', async () => {
    const w = create()
    await flushPromises()
    await submit(w)
    sessionToken = 'new-session'
    await confirm(w)
    expect(post).not.toHaveBeenCalled()
    expect(w.find('dialog[open]').exists()).toBe(false)
  })
  it('does not continue an in-flight account write into a new owner', async () => {
    let finish!: (value: string) => void
    post.mockReturnValueOnce(
      new Promise(resolve => {
        finish = resolve
      })
    )
    const w = create()
    await flushPromises()
    await submit(w)
    await w.get('[data-confirm-address]').trigger('click')
    profileGet.mockResolvedValue({ account: 'other' })
    user.userInfo = { userId: 2 }
    await flushPromises()
    finish('ok')
    await flushPromises()
    expect(post).toHaveBeenCalledOnce()
    expect(w.find('[data-copy-address]').exists()).toBe(false)
    expect(w.find('dialog[open]').exists()).toBe(false)
  })
  it('discards late address responses from the old owner', async () => {
    let finish!: (value: unknown) => void
    get
      .mockReturnValueOnce(
        new Promise(resolve => {
          finish = resolve
        })
      )
      .mockResolvedValue(empty)
    const w = create()
    user.userInfo.userId = 2
    await nextTick()
    finish(ready)
    await flushPromises()
    expect(w.text()).not.toContain(ready.address)
  })
})
