import { ref } from 'vue'

import { mountWithApp } from '../../../setup/mount'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'

// Mock useSubscribeChecking composable (fork-only, auto-imported)
const { useSubscribeCheckingMock } = vi.hoisted(() => ({
  useSubscribeCheckingMock: vi.fn(() => ({
    loadingTitle: 'Processing...',
    isSubscribed: ref(false),
    isProcessing: ref(false)
  }))
}))
mockNuxtImport('useSubscribeChecking', () => useSubscribeCheckingMock)

describe('ProIcon', () => {
  it('renders nothing when not subscribed and not processing', async () => {
    useSubscribeCheckingMock.mockReturnValue({
      loadingTitle: '',
      isSubscribed: ref(false),
      isProcessing: ref(false)
    })
    const { default: ProIcon } = await import('~~/app/components/global/ProIcon.vue')
    const wrapper = mountWithApp(ProIcon)
    expect(wrapper.find('.pro-icon').exists()).toBe(false)
  })

  it('renders "Pro" when subscribed', async () => {
    useSubscribeCheckingMock.mockReturnValue({
      loadingTitle: '',
      isSubscribed: ref(true),
      isProcessing: ref(false)
    })
    const { default: ProIcon } = await import('~~/app/components/global/ProIcon.vue')
    const wrapper = mountWithApp(ProIcon)
    expect(wrapper.find('.pro-icon').exists()).toBe(true)
    expect(wrapper.find('.pro-icon').text()).toBe('Pro')
  })

  it('renders loading title when processing', async () => {
    useSubscribeCheckingMock.mockReturnValue({
      loadingTitle: 'Processing...',
      isSubscribed: ref(false),
      isProcessing: ref(true)
    })
    const { default: ProIcon } = await import('~~/app/components/global/ProIcon.vue')
    const wrapper = mountWithApp(ProIcon)
    expect(wrapper.find('.pro-icon').exists()).toBe(true)
    expect(wrapper.find('.pro-icon').text()).toBe('Processing...')
  })
})
