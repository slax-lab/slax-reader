// components/BookmarkList/BookmarkListContent.vue 单测
// 关注点：filterStatus → effectiveMode 分发、text-mode 透传、select-tag 冒泡、SharedUserTagsKey provide
import { computed, defineComponent, inject } from 'vue'

import BookmarkListContent from '~~/app/components/BookmarkList/BookmarkListContent.vue'

import type { BookmarkItem, BookmarkTag } from '@slax-reader/contracts/interface'
import { LocalFirstAdapterKey, SharedUserTagsKey, type UserTagSource } from '~~/app/composables/local-first/injection'
import { makeBookmarkItem } from '~~/tests/fixtures/bookmark'
import { mountWithApp } from '~~/tests/setup/mount'
import { describe, expect, it, vi } from 'vitest'
import type { PropType } from 'vue'

// WindowVirtualizer 直接按 data 渲染 default slot，不做虚拟化
vi.mock('virtua/vue', () => ({
  WindowVirtualizer: defineComponent({
    name: 'WindowVirtualizer',
    props: { data: { type: Array, default: () => [] }, bufferSize: { type: Number, default: 0 } },
    template: `<div class="virtualizer"><template v-for="(item, i) in data" :key="i"><slot :item="item" /></template></div>`
  })
}))

type GroupedItem = { type: 'group'; label: string; key: string } | { type: 'bookmark'; bookmark: BookmarkItem; index: number }

// BookmarkCell 替身：暴露 textMode 与注入到的 SharedUserTagsKey，可发出 select-tag
const BookmarkCellStub = defineComponent({
  name: 'BookmarkCell',
  props: {
    bookmark: { type: Object as PropType<BookmarkItem>, required: true },
    index: { type: Number, default: undefined },
    isSubscribe: { type: Boolean, default: false },
    collectionCode: { type: String, default: undefined },
    sourceFilterable: { type: Boolean, default: false },
    textMode: { type: Boolean, default: false }
  },
  emits: ['select-tag', 'selectTag', 'delete', 'archiveUpdate', 'aliasTitleUpdate', 'bookmarkUpdate', 'sourceFilter'],
  setup() {
    // 默认 undefined：区分“provide 了 null”与“没 provide”
    const sharedUserTags = inject(SharedUserTagsKey, undefined)
    return { sharedUserTags }
  },
  template: `<div class="bookmark-cell" :data-text-mode="String(textMode)" @click="$emit('select-tag', { id: 7, name: 'vue', show_name: 'Vue' })">{{ bookmark.title }}</div>`
})

const stubs = {
  BookmarkCell: BookmarkCellStub,
  BookmarkDateGroup: { name: 'BookmarkDateGroup', props: ['label'], template: '<div class="date-group">{{ label }}</div>' },
  BookmarkHighlightCell: { name: 'BookmarkHighlightCell', props: ['highlight'], template: '<div class="highlight-cell" />' },
  // 同时渲染 default 与 fallback，两条分支都能断言
  ClientOnly: { name: 'ClientOnly', template: '<div class="client-only"><div class="co-default"><slot /></div><div class="co-fallback"><slot name="fallback" /></div></div>' }
}

const groupedBookmarks: GroupedItem[] = [
  { type: 'group', label: '2026-01', key: '2026-01' },
  { type: 'bookmark', bookmark: makeBookmarkItem({ id: 1, title: 'One' }), index: 0 },
  { type: 'bookmark', bookmark: makeBookmarkItem({ id: 2, title: 'Two' }), index: 1 }
]

const mountContent = (props: Partial<InstanceType<typeof BookmarkListContent>['$props']> = {}, provide: Record<symbol, unknown> = {}) =>
  mountWithApp(BookmarkListContent, {
    props: {
      filterStatus: 'inbox',
      groupedBookmarks,
      highlights: [],
      listMode: 'card',
      filterCollectionCode: '',
      ...props
    },
    global: { stubs, provide }
  })

describe('components/BookmarkList/BookmarkListContent', () => {
  describe('effectiveMode → text-mode 透传', () => {
    it('archive + card：两条分支的 cell 都不带 text-mode class，textMode=false，且保留月份分组', () => {
      const wrapper = mountContent({ filterStatus: 'archive', listMode: 'card' })
      for (const branch of ['.co-default', '.co-fallback']) {
        const cells = wrapper.findAll(`${branch} .bookmark-cell`)
        expect(cells).toHaveLength(2)
        for (const cell of cells) {
          expect(cell.classes()).not.toContain('text-mode')
          expect(cell.attributes('data-text-mode')).toBe('false')
        }
        expect(wrapper.findAll(`${branch} .date-group`)).toHaveLength(1)
      }
    })

    it('untagged + card：允许卡片布局', () => {
      const wrapper = mountContent({ filterStatus: 'untagged', listMode: 'card' })
      const cell = wrapper.find('.co-default .bookmark-cell')
      expect(cell.classes()).not.toContain('text-mode')
      expect(cell.attributes('data-text-mode')).toBe('false')
    })

    it('starred 强制文字模式：cell 带 text-mode class，textMode=true，不渲染分组', () => {
      const wrapper = mountContent({ filterStatus: 'starred', listMode: 'card' })
      for (const branch of ['.co-default', '.co-fallback']) {
        const cells = wrapper.findAll(`${branch} .bookmark-cell`)
        expect(cells).toHaveLength(2)
        for (const cell of cells) {
          expect(cell.classes()).toContain('text-mode')
          expect(cell.attributes('data-text-mode')).toBe('true')
        }
        expect(wrapper.findAll(`${branch} .date-group`)).toHaveLength(0)
      }
    })

    it('trashed 强制文字模式', () => {
      const wrapper = mountContent({ filterStatus: 'trashed', listMode: 'card' })
      expect(wrapper.find('.co-default .bookmark-cell').attributes('data-text-mode')).toBe('true')
    })

    it('inbox + listMode=text：textMode=true', () => {
      const wrapper = mountContent({ filterStatus: 'inbox', listMode: 'text' })
      expect(wrapper.find('.co-default .bookmark-cell').attributes('data-text-mode')).toBe('true')
    })
  })

  describe('select-tag 冒泡', () => {
    it('虚拟列表分支：cell 发出 select-tag → 组件 emit select-tag', async () => {
      const wrapper = mountContent({ filterStatus: 'inbox', listMode: 'card' })
      await wrapper.find('.co-default .bookmark-cell').trigger('click')
      expect(wrapper.emitted('select-tag')).toEqual([[{ id: 7, name: 'vue', show_name: 'Vue' }]])
    })

    it('fallback 分支：cell 发出 select-tag → 组件 emit select-tag', async () => {
      const wrapper = mountContent({ filterStatus: 'inbox', listMode: 'card' })
      await wrapper.find('.co-fallback .bookmark-cell').trigger('click')
      expect(wrapper.emitted('select-tag')).toEqual([[{ id: 7, name: 'vue', show_name: 'Vue' }]])
    })
  })

  describe('SharedUserTagsKey provide', () => {
    it('无 LocalFirstAdapter：provide null（而非未 provide）', () => {
      const wrapper = mountContent()
      const cell = wrapper.findComponent(BookmarkCellStub)
      expect(cell.vm.sharedUserTags).toBeNull()
    })

    it('有 LocalFirstAdapter.userTagSource：provide 同一份 source', () => {
      const source: UserTagSource = {
        tags: computed<BookmarkTag[]>(() => [{ id: 1, name: 'vue', show_name: 'Vue' }]),
        create: vi.fn()
      }
      const userTagSource = vi.fn(() => source)
      const wrapper = mountContent({}, { [LocalFirstAdapterKey as symbol]: { userTagSource } })
      const cells = wrapper.findAllComponents(BookmarkCellStub)
      expect(cells.length).toBeGreaterThan(1)
      for (const cell of cells) {
        expect(cell.vm.sharedUserTags).toBe(source)
      }
      // 只建一次，不是每张卡一份
      expect(userTagSource).toHaveBeenCalledTimes(1)
    })
  })

  describe('highlights', () => {
    it('filterStatus=highlights：渲染高亮列表，不渲染书签', () => {
      const wrapper = mountContent({ filterStatus: 'highlights', highlights: [{ id: 1 } as never] })
      expect(wrapper.findAll('.highlight-cell')).toHaveLength(1)
      expect(wrapper.find('.bookmark-cell').exists()).toBe(false)
    })
  })
})
