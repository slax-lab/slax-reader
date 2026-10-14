import { describe, expect, it, beforeEach } from 'vitest'
import { defineComponent, ref } from 'vue'
import { mountWithApp } from '~~/tests/setup/mount'
import { useOnboardingPending } from '~~/app/composables/bookmark/useOnboardingPending'

beforeEach(() => {
  localStorage.clear()
  useState('onboarding-flags', () => ({})).value = {}
})
it('publishes completion to a cached sibling before navigation and dismissed wins stale pending', () => {
  const id = ref<number | undefined>(7)
  localStorage.setItem('slax_onboarding_pending_7', 'true')
  const consumers: ReturnType<typeof useOnboardingPending>[] = []
  const Host = defineComponent({
    setup() {
      consumers.push(useOnboardingPending(id))
      return () => null
    }
  })
  const a = mountWithApp(Host)
  const b = mountWithApp(Host)
  consumers[1]!.setDismissed()
  expect(consumers[0]!.isDismissed.value).toBe(true)
  expect(consumers[0]!.isPending.value).toBe(false)
  a.unmount()
  b.unmount()
})
