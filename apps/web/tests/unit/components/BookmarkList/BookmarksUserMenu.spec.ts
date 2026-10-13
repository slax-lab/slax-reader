import BookmarksUserMenu from '~~/app/components/BookmarkList/BookmarksUserMenu.vue'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { clearAuth, navigateTo } = vi.hoisted(() => ({ clearAuth: vi.fn(), navigateTo: vi.fn() }))
mockNuxtImport('useAuth', () => () => ({ clearAuth }))
mockNuxtImport('navigateTo', () => navigateTo)
vi.mock('~/stores/user', () => ({ useUserStore: () => ({ userInfo: null }) }))

beforeEach(() => vi.resetAllMocks())

describe('BookmarksUserMenu logout', () => {
  it('waits for session cleanup before navigating to login', async () => {
    let finish!: () => void
    clearAuth.mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
    const wrapper = mount(BookmarksUserMenu, { global: { mocks: { $t: (key: string) => key } } })
    try {
      await wrapper.get('.user-avatar').trigger('click')
      await wrapper.get('.popover-item.danger').trigger('click')
      expect(clearAuth).toHaveBeenCalledOnce()
      expect(navigateTo).not.toHaveBeenCalled()
      finish()
      await flushPromises()
      expect(navigateTo).toHaveBeenCalledWith('/login', { replace: true })
    } finally {
      wrapper.unmount()
    }
  })
})
