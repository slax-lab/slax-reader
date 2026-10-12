// useSidebarCollapsed 单元测试
// 模块级单例：用例之间手动重置 collapsed，避免状态串联
import { nextTick } from 'vue'

import { useSidebarCollapsed } from '~~/app/composables/bookmark/useSidebarCollapsed'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const STORAGE_KEY = 'slax-sidebar-collapsed'

describe('useSidebarCollapsed', () => {
  beforeEach(() => {
    localStorage.clear()
    useSidebarCollapsed().collapsed.value = false
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('默认展开（collapsed=false）', () => {
    const { collapsed } = useSidebarCollapsed()
    expect(collapsed.value).toBe(false)
  })

  it('toggle → collapsed 翻转', () => {
    const { collapsed, toggle } = useSidebarCollapsed()
    toggle()
    expect(collapsed.value).toBe(true)
    toggle()
    expect(collapsed.value).toBe(false)
  })

  it('两次调用共享同一个 ref（单例）', () => {
    const a = useSidebarCollapsed()
    const b = useSidebarCollapsed()
    a.toggle()
    expect(b.collapsed.value).toBe(true)
  })

  it('变更后写入 localStorage："1" / "0"', async () => {
    const { toggle } = useSidebarCollapsed()
    toggle()
    await nextTick()
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1')
    toggle()
    await nextTick()
    expect(localStorage.getItem(STORAGE_KEY)).toBe('0')
  })
})

describe('useSidebarCollapsed — 首次调用从 localStorage 恢复', () => {
  it('localStorage 为 "1" → 初始 collapsed=true', async () => {
    localStorage.setItem(STORAGE_KEY, '1')
    vi.resetModules()
    const { useSidebarCollapsed: fresh } = await import('~~/app/composables/bookmark/useSidebarCollapsed')
    expect(fresh().collapsed.value).toBe(true)
    localStorage.clear()
  })
})
