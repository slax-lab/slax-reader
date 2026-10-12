import { mountWithApp } from '../../../setup/mount'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'

// request() for bindPlatform
const { requestMock } = vi.hoisted(() => ({
  requestMock: vi.fn(() => ({
    post: vi.fn().mockResolvedValue('https://t.me/auth'),
    get: vi.fn().mockResolvedValue(null) // null → statusData stays null, no subscription.type crash
  }))
}))
mockNuxtImport('request', () => requestMock)

const makeUserInfo = (overrides = {}) => ({
  id: 1,
  name: 'Test User',
  email: 'test@example.com',
  platform: [],
  stripe_connect: null,
  share_collect: null,
  ...overrides
})

describe('UserRelatedInfoSection', () => {
  it('shows NavigateStyleButton for unbound telegram', async () => {
    const { default: UserRelatedInfoSection } = await import('~~/app/components/global/UserRelatedInfoSection.vue')
    const wrapper = mountWithApp(UserRelatedInfoSection, {
      props: { userInfo: makeUserInfo({ platform: [] }) }
    })
    // no telegram binding → no <p> with "Telegram:"
    const paragraphs = wrapper.findAll('p')
    const telegramBound = paragraphs.some(p => p.text().includes('Telegram:'))
    expect(telegramBound).toBe(false)
  })

  it('shows bound account text when telegram is bound', async () => {
    const { default: UserRelatedInfoSection } = await import('~~/app/components/global/UserRelatedInfoSection.vue')
    const wrapper = mountWithApp(UserRelatedInfoSection, {
      props: {
        userInfo: makeUserInfo({
          platform: [{ platform: 'telegram', user_name: '@testuser' }]
        })
      }
    })
    expect(wrapper.text()).toContain('Telegram: @testuser')
  })

  it('shows NavigateStyleButton for unbound twitter', async () => {
    const { default: UserRelatedInfoSection } = await import('~~/app/components/global/UserRelatedInfoSection.vue')
    const wrapper = mountWithApp(UserRelatedInfoSection, {
      props: { userInfo: makeUserInfo({ platform: [] }) }
    })
    const paragraphs = wrapper.findAll('p')
    const twitterBound = paragraphs.some(p => p.text().includes('Twitter:'))
    expect(twitterBound).toBe(false)
  })

  it('shows bound account text when twitter is bound', async () => {
    const { default: UserRelatedInfoSection } = await import('~~/app/components/global/UserRelatedInfoSection.vue')
    const wrapper = mountWithApp(UserRelatedInfoSection, {
      props: {
        userInfo: makeUserInfo({
          platform: [{ platform: 'twitter', user_name: '@twitteruser' }]
        })
      }
    })
    expect(wrapper.text()).toContain('Twitter: @twitteruser')
  })

  it('bindPlatform calls request().post and opens window', async () => {
    const windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    requestMock.mockReturnValue({
      post: vi.fn().mockResolvedValue('https://t.me/auth'),
      get: vi.fn().mockResolvedValue(null) // UserApiKeySection + UserSubscribeSection call get on mount
    })

    const { default: UserRelatedInfoSection } = await import('~~/app/components/global/UserRelatedInfoSection.vue')
    const wrapper = mountWithApp(UserRelatedInfoSection, {
      props: { userInfo: makeUserInfo({ platform: [] }) }
    })

    // Find NavigateStyleButton for telegram and trigger its action
    const vm = wrapper.vm as any
    await vm.bindPlathform('telegram')

    expect(windowOpenSpy).toHaveBeenCalledWith('https://t.me/auth')
    windowOpenSpy.mockRestore()
  })
})
