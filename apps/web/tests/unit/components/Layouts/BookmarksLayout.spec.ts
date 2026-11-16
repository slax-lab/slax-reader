// Layouts/BookmarksLayout 组件单测
// 新结构：BookmarksTopBar + sticky sidebar + main 三栏布局
// 保留 slot：sidebar-left、content-header、content-list
// expose: isSmallScreen() 基于 smallScreenTrigger.opacity
import BookmarksLayout from '~~/app/components/Layouts/BookmarksLayout.vue'

import { useSidebarCollapsed } from '~~/app/composables/bookmark/useSidebarCollapsed'
import { mountWithApp } from '~~/tests/setup/mount'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createMemoryStorage = () => {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size
    }
  }
}

const extractRule = (source: string, selector: string) => {
  const start = source.indexOf(`${selector} {`)
  if (start === -1) return ''
  const open = source.indexOf('{', start)
  let depth = 0
  for (let index = open; index < source.length; index++) {
    if (source[index] === '{') depth++
    else if (source[index] === '}') {
      depth--
      if (depth === 0) return source.slice(open + 1, index)
    }
  }
  return ''
}

const extractMedia = (rule: string, maxWidth: number) => {
  const marker = `@media (max-width: ${maxWidth}px) {`
  const start = rule.indexOf(marker)
  if (start === -1) return ''
  const open = rule.indexOf('{', start)
  let depth = 0
  for (let index = open; index < rule.length; index++) {
    if (rule[index] === '{') depth++
    else if (rule[index] === '}') {
      depth--
      if (depth === 0) return rule.slice(open + 1, index)
    }
  }
  return ''
}

describe('Layouts/BookmarksLayout', () => {
  it('at 768px stacks a full-width sidebar row above a full-width main', () => {
    const source = readFileSync(resolve(process.cwd(), 'app/components/Layouts/BookmarksLayout.vue'), 'utf8')
    const layout768 = extractMedia(extractRule(source, '.layout'), 768)
    const sidebar768 = extractMedia(extractRule(source, '.sidebar'), 768)
    const main768 = extractMedia(extractRule(source, '.main'), 768)

    expect(layout768).toContain('display: block')
    expect(sidebar768).toContain('display: flex')
    expect(sidebar768).toContain('flex-direction: row')
    expect(sidebar768).toContain('width: 100%')
    expect(main768).toContain('padding: 16px 16px 80px')
    // In a block layout this flex child spans the full row.
    expect(extractRule(source, '.main')).toContain('--style: flex-1 min-w-0')
  })

  it('mount → 渲染 .bookmarks-layout + .layout + .sidebar + .main', () => {
    const wrapper = mountWithApp(BookmarksLayout)
    expect(wrapper.find('.bookmarks-layout').exists()).toBe(true)
    expect(wrapper.find('.layout').exists()).toBe(true)
    expect(wrapper.find('.sidebar').exists()).toBe(true)
    expect(wrapper.find('.main').exists()).toBe(true)
  })

  it('具名 slot sidebar-left 渲染', () => {
    const wrapper = mountWithApp(BookmarksLayout, {
      slots: { 'sidebar-left': '<div class="custom-left">L</div>' }
    })
    expect(wrapper.find('.custom-left').exists()).toBe(true)
  })

  it('具名 slot content-header / content-list 渲染', () => {
    const wrapper = mountWithApp(BookmarksLayout, {
      slots: {
        'content-header': '<div class="custom-header">H</div>',
        'content-list': '<div class="custom-list">List</div>'
      }
    })
    expect(wrapper.find('.custom-header').exists()).toBe(true)
    expect(wrapper.find('.custom-list').exists()).toBe(true)
  })

  it('暴露 isSmallScreen() 基于 trigger opacity（happy-dom 默认 opacity 不为 1）', () => {
    const wrapper = mountWithApp(BookmarksLayout)
    expect((wrapper.vm as any).isSmallScreen()).toBe(false)
  })

  it('collapsed=true → .sidebar 带 collapsed class；恢复后移除', async () => {
    const wrapper = mountWithApp(BookmarksLayout)
    const { collapsed } = useSidebarCollapsed()
    expect(wrapper.find('.sidebar').classes()).not.toContain('collapsed')
    collapsed.value = true
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.sidebar').classes()).toContain('collapsed')
    collapsed.value = false
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.sidebar').classes()).not.toContain('collapsed')
  })

  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage())
  })

  afterEach(() => {
    useSidebarCollapsed().collapsed.value = false
    vi.unstubAllGlobals()
  })
})
