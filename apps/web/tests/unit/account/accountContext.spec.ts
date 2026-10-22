import { defineComponent, ref } from 'vue'

import { accountSnapshot, accountSnapshotMatches, deriveAccountKey, isValidServerUserId } from '~~/app/utils/accountContext'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useAccountContext } from '~~/app/composables/useAccountContext'
import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const tokenFor = (claims: Record<string, unknown>) => `header.${btoa(JSON.stringify(claims))}.signature`

const env = vi.hoisted(() => ({ token: null as ReturnType<typeof ref<string | undefined>> | null }))
vi.mock('~/utils/sessionOwner', () => ({
  getTokenUserId: (token: string | null | undefined) => {
    if (!token) return null
    try {
      return String((JSON.parse(atob(token.split('.')[1])) as { id?: string | number }).id ?? '') || null
    } catch {
      return null
    }
  }
}))
mockNuxtImport('getUserToken', () => () => env.token?.value)

describe('account context helpers', () => {
  beforeEach(() => {
    env.token = ref<string | undefined>(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('derives a stable opaque key without exposing token or email', () => {
    const token = tokenFor({ id: '42', email: 'person@example.test' })
    const key = deriveAccountKey(token)
    expect(key).toMatch(/^acct_[0-9a-f]{16}$/)
    expect(key).not.toContain(token)
    expect(key).not.toContain('person@example.test')
    expect(deriveAccountKey(tokenFor({ id: '42', email: 'other@example.test' }))).toBe(key)
  })

  it('rejects invalid server ids and guards exact session snapshots', () => {
    expect(isValidServerUserId(1)).toBe(true)
    expect(isValidServerUserId(0)).toBe(false)
    expect(isValidServerUserId('1')).toBe(false)
    const snapshot = accountSnapshot(tokenFor({ id: '42' }))
    expect(accountSnapshotMatches(snapshot, snapshot.token)).toBe(true)
    expect(accountSnapshotMatches(snapshot, tokenFor({ id: '43' }))).toBe(false)
  })

  it('keeps local context when server identity is unavailable and accepts only current profiles', async () => {
    env.token.value = tokenFor({ id: '42' })
    let api!: ReturnType<typeof useAccountContext>
    const wrapper = mountWithApp(
      defineComponent({
        setup() {
          api = useAccountContext()
          return () => null
        }
      })
    )
    expect(api.context.value.status).toBe('local')
    expect(api.context.value.serverUserId).toBeNull()
    expect(api.acceptServerUser(7)).toBe(true)
    expect(api.context.value.status).toBe('ready')
    env.token.value = tokenFor({ id: '43' })
    await wrapper.vm.$nextTick()
    expect(api.context.value.status).toBe('local')
    expect(api.context.value.serverUserId).toBeNull()
    expect(api.acceptServerUser(8)).toBe(true)
    api.invalidateServerUser()
    expect(api.context.value.status).toBe('local')
    wrapper.unmount()
  })
})
