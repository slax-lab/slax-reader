// useOnboardingPending 单元测试
import { defineComponent, ref } from 'vue'

import { useOnboardingPending } from '~~/app/composables/bookmark/useOnboardingPending'
import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const mountPending = (userId: ReturnType<typeof ref<number | undefined>>) => {
  let api: ReturnType<typeof useOnboardingPending> | undefined
  const Host = defineComponent({
    setup() {
      api = useOnboardingPending(userId)
      return () => null
    }
  })
  const wrapper = mountWithApp(Host)
  return { wrapper, api: api! }
}

describe('useOnboardingPending', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('userId 未就位（undefined）→ isPending 恒为 false，setPending/clearPending 均不写入', () => {
    const userId = ref<number | undefined>(undefined)
    const { api } = mountPending(userId)
    expect(api.isPending.value).toBe(false)
    api.setPending()
    expect(api.isPending.value).toBe(false)
    expect(localStorage.length).toBe(0)
  })

  it('setPending → isPending=true + localStorage 写入按 userId 命名的 key', () => {
    const userId = ref<number | undefined>(42)
    const { api } = mountPending(userId)
    api.setPending()
    expect(api.isPending.value).toBe(true)
    expect(localStorage.getItem('slax_onboarding_pending_42')).toBe('true')
  })

  it('clearPending → isPending=false + localStorage 移除', () => {
    const userId = ref<number | undefined>(42)
    const { api } = mountPending(userId)
    api.setPending()
    api.clearPending()
    expect(api.isPending.value).toBe(false)
    expect(localStorage.getItem('slax_onboarding_pending_42')).toBeNull()
  })

  it('mount 时 localStorage 已有该 userId 的标记 → isPending 初始为 true', async () => {
    localStorage.setItem('slax_onboarding_pending_7', 'true')
    const userId = ref<number | undefined>(7)
    const { api } = mountPending(userId)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(api.isPending.value).toBe(true)
  })

  it('不同 userId 的标记互不影响', () => {
    const userId = ref<number | undefined>(1)
    const { api } = mountPending(userId)
    api.setPending()
    expect(localStorage.getItem('slax_onboarding_pending_1')).toBe('true')
    expect(localStorage.getItem('slax_onboarding_pending_2')).toBeNull()
  })

  it('setDismissed → isDismissed=true + localStorage 写入按 userId 命名的 dismissed key', () => {
    const userId = ref<number | undefined>(42)
    const { api } = mountPending(userId)
    api.setDismissed()
    expect(api.isDismissed.value).toBe(true)
    expect(localStorage.getItem('slax_onboarding_dismissed_42')).toBe('true')
  })

  it('mount 时 localStorage 已有该 userId 的 dismissed 标记 → isDismissed 初始为 true', async () => {
    localStorage.setItem('slax_onboarding_dismissed_7', 'true')
    const userId = ref<number | undefined>(7)
    const { api } = mountPending(userId)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(api.isDismissed.value).toBe(true)
  })

  it('userId 切换（切账号）→ isPending 重新读取新 key 对应的值', async () => {
    localStorage.setItem('slax_onboarding_pending_2', 'true')
    const userId = ref<number | undefined>(1)
    const { api } = mountPending(userId)
    expect(api.isPending.value).toBe(false)
    userId.value = 2
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(api.isPending.value).toBe(true)
  })
})
