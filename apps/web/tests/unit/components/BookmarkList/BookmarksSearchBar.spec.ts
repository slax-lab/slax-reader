// BookmarksSearchBar：顶栏搜索框
// 关注点：回车搜索 / 清除 / 页面搜索词通过 search-text 同步进输入框
import BookmarksSearchBar from '~~/app/components/BookmarkList/BookmarksSearchBar.vue'

import { mountWithApp } from '~~/tests/setup/mount'
import { beforeEach, describe, expect, it } from 'vitest'

describe('BookmarksSearchBar', () => {
  beforeEach(() => {
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
})
