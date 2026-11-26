// BookmarksSearchBar：顶栏搜索框
// 关注点：回车搜索 / 清除 / 页面搜索词通过 search-text 同步进输入框
import { nextTick, ref } from 'vue'

import BookmarksSearchBar from '~~/app/components/BookmarkList/BookmarksSearchBar.vue'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { mountWithApp } from '~~/tests/setup/mount'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const context = ref({ status: 'empty', accountKey: '' })
mockNuxtImport('useAccountContext', () => () => ({ context, sync() {} }))

describe('BookmarksSearchBar', () => {
  beforeEach(() => {
    context.value = { status: 'empty', accountKey: '' }
    localStorage.clear()
  })

  it('emits the trimmed keyword on enter and nothing when empty', async () => {
    const w = mountWithApp(BookmarksSearchBar)
    const input = w.find('input.search-input')
    await input.setValue('   ')
    await input.trigger('keydown.enter')
    expect(w.emitted('search')).toBeUndefined()
    await input.setValue('  vue  ')
    await input.trigger('keydown.enter')
    expect(w.emitted('search')?.[0]).toEqual(['vue'])
  })

  it('emits an empty search from the clear button', async () => {
    const w = mountWithApp(BookmarksSearchBar)
    await w.find('input.search-input').setValue('vue')
    await w.find('.search-clear').trigger('mousedown')
    expect(w.emitted('search')?.[0]).toEqual([''])
    expect((w.find('input.search-input').element as HTMLInputElement).value).toBe('')
  })

  it('opens the same input, submits a keyword and restores focus when dismissed', async () => {
    const wrapper = mountWithApp(BookmarksSearchBar, { attachTo: document.body })
    const opener = wrapper.get('.compact-search-open')
    await opener.trigger('click')
    const input = wrapper.get('input')
    expect(document.activeElement).toBe(input.element)
    await input.setValue('Rust')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('search')?.at(-1)).toEqual(['Rust'])
    await input.trigger('keydown.esc')
    expect(wrapper.emitted('search')?.at(-1)).toEqual([''])
    expect(document.activeElement).toBe(opener.element)
    expect(opener.attributes('aria-expanded')).toBe('false')
    wrapper.unmount()
  })

  it('follows the page search text: filled by ?q=, cleared on back', async () => {
    const w = mountWithApp(BookmarksSearchBar, { props: { searchText: '' } })
    const input = () => w.find('input.search-input').element as HTMLInputElement
    await w.setProps({ searchText: 'rust' })
    expect(input().value).toBe('rust')
    await w.setProps({ searchText: '' })
    expect(input().value).toBe('')
    // Typing locally does not emit until enter
    await w.find('input.search-input').setValue('go')
    expect(w.emitted('search')).toBeUndefined()
  })

  it('still searches when browser storage is unavailable', async () => {
    context.value = { status: 'ready', accountKey: 'A' }
    const storage = Object.getPrototypeOf(localStorage)
    const denied = () => { throw new DOMException('Blocked', 'SecurityError') }
    const blocked = ['removeItem', 'getItem', 'setItem'].map(method => vi.spyOn(storage, method).mockImplementation(denied))
    try {
      const wrapper = mountWithApp(BookmarksSearchBar)
      const input = wrapper.get('input')
      await input.trigger('focus')
      await input.setValue('rust')
      await input.trigger('keydown.enter')
      expect(wrapper.emitted('search')).toEqual([['rust']])
    } finally {
      blocked.forEach(mock => mock.mockRestore())
    }
  })

  it('removes unowned history, isolates verified accounts and clears only the active one', async () => {
    localStorage.setItem('slax-reader.search-history', JSON.stringify(['legacy']))
    const wrapper = mountWithApp(BookmarksSearchBar)
    const input = wrapper.get('input')
    const search = async (value: string) => {
      await input.setValue(value)
      await input.trigger('keydown.enter')
      await input.setValue('')
      await input.trigger('focus')
    }
    const switchTo = async (accountKey: string, status = 'ready') => {
      context.value = { status, accountKey }
      await nextTick()
      await input.trigger('focus')
    }
    const terms = () => wrapper.findAll('.history-item').map(item => item.text())
    await input.trigger('focus')
    expect(terms()).toEqual([])
    expect(localStorage.getItem('slax-reader.search-history')).toBeNull()
    await switchTo('A', 'local')
    await search('unverified')
    await switchTo('A')
    expect(terms()).toEqual([])
    for (const term of ['1', '2', '3', '4', '5', '6', '5']) await search(term)
    expect(terms()).toEqual(['5', '6', '4', '3', '2'])
    await switchTo('', 'empty')
    expect(terms()).toEqual([])
    await switchTo('B')
    expect(terms()).toEqual([])
    await search('B term')
    await switchTo('A')
    expect(terms()).toContain('6')
    await wrapper.get('.history-clear-btn').trigger('click')
    await switchTo('B')
    expect(terms()).toEqual(['B term'])
    await switchTo('A')
    expect(terms()).toEqual([])
  })
})
