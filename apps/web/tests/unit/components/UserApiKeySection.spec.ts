import { mountWithApp } from '../../setup/mount'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// request() auto-import
const { requestMock } = vi.hoisted(() => ({
  requestMock: vi.fn(() => ({ get: vi.fn().mockResolvedValue(null), post: vi.fn().mockResolvedValue(null) }))
}))
mockNuxtImport('request', () => requestMock)

// Toast from upstream layer
vi.mock('~/components/Toast', () => ({
  default: { showToast: vi.fn() }
}))

// copyText from commons utils
vi.mock('@commons/utils/string', () => ({
  copyText: vi.fn().mockResolvedValue(undefined)
}))

const makeUserInfo = () => ({ id: 1, name: 'Test' }) as any

describe('UserApiKeySection', () => {
  beforeEach(() => {
    requestMock.mockClear()
    requestMock.mockReturnValue({ get: vi.fn().mockResolvedValue(null), post: vi.fn().mockResolvedValue(null) })
  })

  it('renders section with install tabs', async () => {
    const { default: Section } = await import('~~/app/components/UserApiKeySection.vue')
    const wrapper = mountWithApp(Section, { props: { userInfo: makeUserInfo() } })
    expect(wrapper.find('.install-tabs').exists()).toBe(true)
    expect(wrapper.findAll('.tab-item').length).toBe(2)
  })

  it('shows manual install content by default', async () => {
    const { default: Section } = await import('~~/app/components/UserApiKeySection.vue')
    const wrapper = mountWithApp(Section, { props: { userInfo: makeUserInfo() } })
    expect(wrapper.find('.code-block').exists()).toBe(true)
    expect(wrapper.find('.prompt-block').exists()).toBe(false)
  })

  it('switches to ai-agent tab on click', async () => {
    const { default: Section } = await import('~~/app/components/UserApiKeySection.vue')
    const wrapper = mountWithApp(Section, { props: { userInfo: makeUserInfo() } })
    const tabs = wrapper.findAll('.tab-item')
    await tabs[1]!.trigger('click')
    expect(wrapper.find('.prompt-block').exists()).toBe(true)
    expect(wrapper.find('.code-block').exists()).toBe(false)
  })

  it('shows generate button when no apiKey', async () => {
    const getMock = vi.fn().mockResolvedValue(null)
    requestMock.mockReturnValue({ get: getMock, post: vi.fn().mockResolvedValue(null) })
    const { default: Section } = await import('~~/app/components/UserApiKeySection.vue')
    const wrapper = mountWithApp(Section, { props: { userInfo: makeUserInfo() } })
    await flushPromises()
    expect(wrapper.find('.save').exists()).toBe(true)
  })

  it('shows key-box after generateApiKey succeeds', async () => {
    const getMock = vi.fn().mockResolvedValue(null)
    const postMock = vi.fn().mockResolvedValue({ id: 1, name: 'key', key: 'sk-abcdefghij1234', created_at: '2026-01-01' })
    requestMock.mockReturnValue({ get: getMock, post: postMock })
    const { default: Section } = await import('~~/app/components/UserApiKeySection.vue')
    const wrapper = mountWithApp(Section, { props: { userInfo: makeUserInfo() } })
    await flushPromises()
    await wrapper.find('.save').trigger('click')
    await flushPromises()
    expect(wrapper.find('.key-box').exists()).toBe(true)
  })

  it('shows masked key when not showing full key', async () => {
    const getMock = vi.fn().mockResolvedValue([{ id: 1, name: 'key', short_key: 'sk-abc12', created_at: '2026-01-01' }])
    requestMock.mockReturnValue({ get: getMock, post: vi.fn().mockResolvedValue(null) })
    const { default: Section } = await import('~~/app/components/UserApiKeySection.vue')
    const wrapper = mountWithApp(Section, { props: { userInfo: makeUserInfo() } })
    await flushPromises()
    // short_key present, no full key → shows "sk-abc12..."
    expect(wrapper.find('.key-box').text()).toContain('...')
  })
})
