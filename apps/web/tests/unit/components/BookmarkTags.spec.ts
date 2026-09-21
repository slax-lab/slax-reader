// components/BookmarkTags.vue 单测 —— 标签面板改为“勾选后一次提交”
// 覆盖：TagChip 旧版外观（readonly / compact）/ 删除走 DELETE_BOOKMARK_TAG 并 emit change /
//      面板分组标题 / 点击候选只切换 pending 不发请求 / Done 一次 ADD_BOOKMARK_TAGS 提交 /
//      create 行 / Enter 提交 / 点击外部提交 / 重开保留 searchText / 出错保留 pending 并 toast /
//      LF 非 compact：createUserTag 一次 + setTags 一次 / LF compact：走 bookmarkTagActions + SharedUserTagsKey
// 关键约束：search-list 面板用 v-if 整块挂卸（非 v-show），isPanelHidden 对
//          "元素不存在" 和 "display:none" 均视为已关闭
import { computed, ref } from 'vue'

import BookmarkTags from '~~/app/components/BookmarkTags.vue'

import type { BookmarkTag } from '@commons/types/interface'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { DOMWrapper, flushPromises } from '@vue/test-utils'
import { LocalFirstAdapterKey, SharedUserTagsKey } from '~~/app/composables/local-first/injection'
import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGet, mockPost, mockRequest, mockToast } = vi.hoisted(() => {
  const get = vi.fn()
  const post = vi.fn()
  return {
    mockGet: get,
    mockPost: post,
    mockRequest: vi.fn(() => ({ get, post })),
    mockToast: vi.fn()
  }
})

mockNuxtImport('request', () => mockRequest)

vi.mock('~/components/Toast', () => ({
  default: { showToast: mockToast },
  ToastType: { Success: 'success', Error: 'error', Normal: 'normal' }
}))

const tech: BookmarkTag = { id: 1, name: 'tech', show_name: 'tech', source: 'mine', added_by: 'user' }
const ai: BookmarkTag = { id: 2, name: 'ai', show_name: 'ai', source: 'auto', added_by: 'ai' }
const design: BookmarkTag = { id: 3, name: 'design', show_name: 'design', source: 'mine' }
const aiTools: BookmarkTag = { id: 4, name: 'ai-tools', show_name: 'ai-tools', source: 'auto' }

const baseTags = [tech, ai]
const catalog = [tech, ai, design, aiTools]

type Wrapper = ReturnType<typeof mountWithApp>

// 每个用例结束都卸载：面板的 click-outside 挂在 window 上，残留实例会吃掉后续用例的点击
const mounted: Wrapper[] = []
function mountTags(options: Parameters<typeof mountWithApp>[1]) {
  const wrapper = mountWithApp(BookmarkTags, options)
  mounted.push(wrapper)
  return wrapper
}

// 面板现在 Teleport 到 document.body，不再挂在 wrapper 的子树里，
// 需要直接查 document 而非 wrapper.find/findAll；包一层 DOMWrapper 保留 .trigger() 用法
function isPanelHidden(): boolean {
  const el = document.querySelector<HTMLElement>('.search-list')
  if (!el) return true
  return el.style.display === 'none'
}

function candidateNames(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.search-tag:not(.create) .tag-name')).map(el => el.textContent ?? '')
}

function selectable(): DOMWrapper<HTMLElement>[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.search-tag:not(.attached):not(.create)')).map(el => new DOMWrapper(el))
}

// 面板内其它元素（confirm-btn / input / result-wrapper / group-heading / search-tag.*）同理，需查 document
function panelFind(selector: string): DOMWrapper<HTMLElement> {
  const el = document.querySelector<HTMLElement>(selector)
  if (!el) throw new Error(`panelFind: no element matches ${selector}`)
  return new DOMWrapper(el)
}

function panelFindAll(selector: string): DOMWrapper<HTMLElement>[] {
  return Array.from(document.querySelectorAll<HTMLElement>(selector)).map(el => new DOMWrapper(el))
}

async function openPanel(wrapper: Wrapper) {
  await wrapper.find('.tag-add-wrap .tag-add').trigger('click')
  await flushPromises()
}

const tick = () => new Promise(resolve => setTimeout(resolve, 5))

function lastPostBody() {
  const call = mockPost.mock.calls.at(-1)![0] as { url: string; body: Record<string, unknown> }
  return call
}

beforeEach(() => {
  mockGet.mockReset()
  mockPost.mockReset()
  mockToast.mockReset()
  mockGet.mockResolvedValue(catalog.map(tag => ({ ...tag })))
  mockPost.mockResolvedValue([])
})

afterEach(() => {
  mounted.splice(0).forEach(wrapper => wrapper.unmount())
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('components/BookmarkTags', () => {
  describe('渲染', () => {
    it('readonly=false：每个 tag 使用旧版方角外观，带删除按钮 + add 按钮', () => {
      const wrapper = mountTags({ props: { tags: baseTags, bookmarkId: 7 } })
      expect(wrapper.findAll('.tags-cells .tag-chip')).toHaveLength(2)
      expect(wrapper.findAll('.tag-act.remove')).toHaveLength(2)
      expect(wrapper.find('.tags-cells .tag-chip').classes()).toContain('legacy')
      expect(wrapper.find('.tags-cells .tag-chip').classes()).not.toContain('clickable')
      expect(wrapper.find('.tag-add-wrap .tag-add').exists()).toBe(true)
    })

    it('readonly=true：不渲染删除按钮 + 不渲染 add 按钮', () => {
      const wrapper = mountTags({ props: { tags: baseTags, readonly: true } })
      expect(wrapper.findAll('.tags-cells .tag-chip')).toHaveLength(2)
      expect(wrapper.findAll('.tag-act.remove')).toHaveLength(0)
      expect(wrapper.find('.tag-add-wrap').exists()).toBe(false)
    })

    it('compact：仍使用旧版外观并保留列表筛选所需的可点击状态', () => {
      const wrapper = mountTags({ props: { tags: baseTags, bookmarkId: 7, compact: true } })
      const chip = wrapper.find('.tags-cells .tag-chip')
      expect(chip.classes()).toContain('legacy')
      expect(chip.classes()).toContain('clickable')
      expect(chip.classes()).not.toContain('compact')
    })

    it('非 compact：不渲染裁剪用的度量行', () => {
      const wrapper = mountTags({ props: { tags: baseTags, bookmarkId: 7 } })
      expect(wrapper.find('.tags-measure').exists()).toBe(false)
      expect(wrapper.findAll('.tags-cells .tag-chip')).toHaveLength(2)
    })

    it('点击标签主体：emit select-tag', async () => {
      const wrapper = mountTags({ props: { tags: baseTags, bookmarkId: 7 } })
      await wrapper.find('.tags-cells .tag-chip').trigger('click')
      expect(wrapper.emitted('select-tag')![0]![0]).toEqual(tech)
    })

    it('props.tags 变化：watch 同步 bookmarkTags', async () => {
      const wrapper = mountTags({ props: { tags: [...baseTags], bookmarkId: 7 } })
      await wrapper.setProps({ tags: [{ id: 9, name: 'newone', show_name: 'newone' }] })
      await flushPromises() // displayTags 走 nextTick 去抖，setProps 后需再等一拍
      expect(wrapper.findAll('.tags-cells .tag-chip')).toHaveLength(1)
      expect(wrapper.find('.tags-cells .tag-name').text()).toBe('newone')
    })
  })

  describe('删除标签', () => {
    it('调 DELETE_BOOKMARK_TAG + 从列表移除 + emit change', async () => {
      const wrapper = mountTags({ props: { tags: [...baseTags], bookmarkId: 7 } })
      await wrapper.findAll('.tag-act.remove')[0]!.trigger('click')
      expect(mockPost).toHaveBeenCalledTimes(1)
      const call = lastPostBody()
      expect(call.url).toBe('/v1/bookmark/del_tag')
      expect(call.body).toEqual({ bookmark_id: 7, bookmark_uid: undefined, tag_id: 1 })
      await flushPromises()
      expect(wrapper.findAll('.tags-cells .tag-chip')).toHaveLength(1)
      expect(wrapper.emitted('change')![0]![0]).toEqual([ai])
    })

    it('bookmarkId 缺失短路不调 post', async () => {
      const wrapper = mountTags({ props: { tags: [...baseTags] } })
      await wrapper.findAll('.tag-act.remove')[0]!.trigger('click')
      expect(mockPost).not.toHaveBeenCalled()
      expect(wrapper.findAll('.tags-cells .tag-chip')).toHaveLength(2)
    })
  })

  describe('打开面板', () => {
    it('点击 add：调 request.get 拉 TAG_LIST', async () => {
      const wrapper = mountTags({ props: { tags: [...baseTags], bookmarkId: 7 } })
      await openPanel(wrapper)
      expect(mockGet).toHaveBeenCalledTimes(1)
      expect(mockGet.mock.calls[0]![0]).toEqual({ url: '/v1/tag/list' })
    })

    it('候选分组：mine 标题在前、auto 在后；已绑定的显示但不可选', async () => {
      const wrapper = mountTags({ props: { tags: [...baseTags], bookmarkId: 7 } })
      await openPanel(wrapper)
      const headings = panelFindAll('.group-heading').map(h => h.text())
      expect(headings).toEqual(['My tags', 'Auto tags'])
      expect(candidateNames()).toEqual(['tech', 'design', 'ai', 'ai-tools'])
      expect(panelFindAll('.search-tag.attached').map(r => r.find('.tag-name').text())).toEqual(['tech', 'ai'])
      await panelFind('.search-tag.attached').trigger('click')
      expect(panelFind('.confirm-btn').text()).toBe('Done (0)')
    })

    it('某组为空时不渲染该组标题', async () => {
      mockGet.mockResolvedValue([design])
      const wrapper = mountTags({ props: { tags: [], bookmarkId: 7 } })
      await openPanel(wrapper)
      expect(panelFindAll('.group-heading').map(h => h.text())).toEqual(['My tags'])
    })

    it('searchText 过滤名称包含 ai 的候选', async () => {
      const wrapper = mountTags({ props: { tags: [...baseTags], bookmarkId: 7 } })
      await openPanel(wrapper)
      await panelFind('input').setValue('ai')
      expect(candidateNames()).toEqual(['ai', 'ai-tools'])
    })

    it('isAddingLoading：searchingTags 调用中再次触发返回早返', async () => {
      let resolveGet: (v: unknown) => void = () => {}
      mockGet.mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveGet = resolve
          })
      )
      const wrapper = mountTags({ props: { tags: [...baseTags], bookmarkId: 7 } })
      await wrapper.find('.tag-add-wrap .tag-add').trigger('click')
      await wrapper.find('.tag-add-wrap .tag-add').trigger('click')
      expect(mockGet).toHaveBeenCalledTimes(1)
      resolveGet([])
      await flushPromises()
    })

    it('多次点击 add 切换面板', async () => {
      const wrapper = mountTags({ props: { tags: [...baseTags], bookmarkId: 7 } })
      await openPanel(wrapper)
      expect(isPanelHidden()).toBe(false)
      await openPanel(wrapper)
      expect(isPanelHidden()).toBe(true)
    })

    it('挂到 document 上：+ 能关掉开着的面板，且不重复拉词表', async () => {
      const wrapper = mountTags({ props: { tags: [...baseTags], bookmarkId: 7 }, attachTo: document.body })
      await openPanel(wrapper)
      expect(isPanelHidden()).toBe(false)
      // vueuse 的 click-outside 挂在 window 的 capture 阶段，靠 setTimeout(0) 去抖
      wrapper.find('.tag-add-wrap .tag-add').element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await new Promise(resolve => setTimeout(resolve, 0))
      await flushPromises()
      expect(isPanelHidden()).toBe(true)
      expect(mockGet).toHaveBeenCalledTimes(1)
    })

    it('搜索词改了，之前勾的“创建 xxx”从 pending 里去掉', async () => {
      const wrapper = mountTags({ props: { tags: [...baseTags], bookmarkId: 7 } })
      await openPanel(wrapper)
      await panelFind('input').setValue('foo')
      await panelFind('.search-tag.create').trigger('click')
      expect(panelFind('.confirm-btn').text()).toContain('1')
      await panelFind('input').setValue('foob')
      expect(panelFind('.confirm-btn').text()).toContain('0')
    })

    it('重开面板保留 searchText 与滚动位置', async () => {
      const wrapper = mountTags({ props: { tags: [...baseTags], bookmarkId: 7 } })
      await openPanel(wrapper)
      await panelFind('input').setValue('des')
      const list = panelFind('.result-wrapper')
      Object.defineProperty(list.element, 'scrollTop', { value: 42, writable: true, configurable: true })
      await list.trigger('scroll')
      await openPanel(wrapper) // close
      await openPanel(wrapper) // reopen
      expect((panelFind('input').element as HTMLInputElement).value).toBe('des')
      expect(candidateNames()).toEqual(['design'])
      expect((panelFind('.result-wrapper').element as HTMLElement).scrollTop).toBe(42)
    })
  })

  describe('勾选 + Done 提交（REST）', () => {
    it('点击候选只切换 pending，不发请求；再点取消', async () => {
      const wrapper = mountTags({ props: { tags: [...baseTags], bookmarkId: 7 } })
      await openPanel(wrapper)
      const rows = selectable()
      await rows[0]!.trigger('click')
      expect(mockPost).not.toHaveBeenCalled()
      expect(selectable()[0]!.classes()).toContain('active')
      expect(panelFind('.confirm-btn').text()).toBe('Done (1)')
      await selectable()[0]!.trigger('click')
      expect(selectable()[0]!.classes()).not.toContain('active')
      expect(panelFind('.confirm-btn').text()).toBe('Done (0)')
    })

    it('Done：一次 ADD_BOOKMARK_TAGS 带 tags:[{id},{id}]，合并列表 + emit change + 关闭', async () => {
      mockPost.mockResolvedValueOnce([
        { ...design, added_by: 'user' },
        { ...aiTools, added_by: 'user' }
      ])
      const wrapper = mountTags({ props: { tags: [...baseTags], bookmarkId: 7 } })
      await openPanel(wrapper)
      await selectable()[0]!.trigger('click')
      await selectable()[1]!.trigger('click')
      await panelFind('.confirm-btn').trigger('click')
      await flushPromises()
      expect(mockPost).toHaveBeenCalledTimes(1)
      const call = lastPostBody()
      expect(call.url).toBe('/v1/bookmark/add_tags')
      expect(call.body).toEqual({ bookmark_id: 7, bookmark_uid: undefined, tags: [{ id: 3 }, { id: 4 }] })
      expect(wrapper.findAll('.tags-cells .tag-chip')).toHaveLength(4)
      const emitted = wrapper.emitted('change')![0]![0] as BookmarkTag[]
      expect(emitted.map(t => t.id)).toEqual([1, 2, 3, 4])
      expect(isPanelHidden()).toBe(true)
    })

    it('Done 时 pending 为空：只关闭，不发请求', async () => {
      const wrapper = mountTags({ props: { tags: [...baseTags], bookmarkId: 7 } })
      await openPanel(wrapper)
      await panelFind('.confirm-btn').trigger('click')
      await flushPromises()
      expect(mockPost).not.toHaveBeenCalled()
      expect(isPanelHidden()).toBe(true)
    })

    it('bookmarkId 与 bookmarkUid 都缺失：不发请求', async () => {
      const wrapper = mountTags({ props: { tags: [...baseTags] } })
      await openPanel(wrapper)
      await selectable()[0]!.trigger('click')
      await panelFind('.confirm-btn').trigger('click')
      await flushPromises()
      expect(mockPost).not.toHaveBeenCalled()
    })

    it('bookmarkUid：owner 走 bookmark_uid', async () => {
      mockPost.mockResolvedValueOnce([design])
      const wrapper = mountTags({ props: { tags: [...baseTags], bookmarkUid: 'u1' } })
      await openPanel(wrapper)
      await selectable()[0]!.trigger('click')
      await panelFind('.confirm-btn').trigger('click')
      await flushPromises()
      expect(lastPostBody().body).toEqual({ bookmark_id: undefined, bookmark_uid: 'u1', tags: [{ id: 3 }] })
    })

    it('搜索无精确匹配：出现 create 行，勾选后 body 带 { name }', async () => {
      mockPost.mockResolvedValueOnce([{ id: 99, name: 'brand-new', show_name: 'brand-new', source: 'mine', added_by: 'user' }])
      const wrapper = mountTags({ props: { tags: [...baseTags], bookmarkId: 7 } })
      await openPanel(wrapper)
      await panelFind('input').setValue('brand-new')
      const create = panelFind('.search-tag.create')
      expect(create.exists()).toBe(true)
      expect(create.text()).toContain('Create “brand-new”')
      await create.trigger('click')
      expect(panelFind('.confirm-btn').text()).toBe('Done (1)')
      await panelFind('.confirm-btn').trigger('click')
      await flushPromises()
      expect(lastPostBody().body.tags).toEqual([{ name: 'brand-new' }])
      expect(wrapper.findAll('.tags-cells .tag-chip')).toHaveLength(3)
      // 提交成功后清空 searchText
      await openPanel(wrapper)
      expect((panelFind('input').element as HTMLInputElement).value).toBe('')
    })

    it('搜索精确匹配某候选（大小写敏感）：不出现 create 行', async () => {
      const wrapper = mountTags({ props: { tags: [...baseTags], bookmarkId: 7 } })
      await openPanel(wrapper)
      await panelFind('input').setValue('design')
      expect(document.querySelector('.search-tag.create')).toBeNull()
      await panelFind('input').setValue('Design')
      expect(document.querySelector('.search-tag.create')).not.toBeNull()
    })

    it('出错：toast 报错、pending 保留、面板不关', async () => {
      mockPost.mockRejectedValueOnce(new Error('boom'))
      const wrapper = mountTags({ props: { tags: [...baseTags], bookmarkId: 7 } })
      await openPanel(wrapper)
      await selectable()[0]!.trigger('click')
      await panelFind('.confirm-btn').trigger('click')
      await flushPromises()
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
      expect(isPanelHidden()).toBe(false)
      expect(panelFind('.confirm-btn').text()).toBe('Done (1)')
      expect(selectable()[0]!.classes()).toContain('active')
      expect(wrapper.emitted('change')).toBeUndefined()
    })
  })

  describe('Enter 提交', () => {
    it('文本是已绑定的 tag 名：直接关闭不调 post', async () => {
      const wrapper = mountTags({ props: { tags: [...baseTags], bookmarkId: 7 } })
      await openPanel(wrapper)
      const input = panelFind('input')
      await input.setValue('tech')
      await input.trigger('keydown', { key: 'Enter' })
      await flushPromises()
      expect(mockPost).not.toHaveBeenCalled()
      expect(isPanelHidden()).toBe(true)
    })

    it('文本精确命中候选：加入 pending 并提交 {id}', async () => {
      mockPost.mockResolvedValueOnce([design])
      const wrapper = mountTags({ props: { tags: [...baseTags], bookmarkId: 7 } })
      await openPanel(wrapper)
      const input = panelFind('input')
      await input.setValue('design')
      await input.trigger('keydown', { key: 'Enter' })
      await flushPromises()
      expect(mockPost).toHaveBeenCalledTimes(1)
      expect(lastPostBody().body.tags).toEqual([{ id: 3 }])
      expect(isPanelHidden()).toBe(true)
    })

    it('文本未命中：提交 {name}，连同已勾选的候选', async () => {
      mockPost.mockResolvedValueOnce([aiTools, { id: 99, name: 'brand-new-tag', show_name: 'brand-new-tag' }])
      const wrapper = mountTags({ props: { tags: [...baseTags], bookmarkId: 7 } })
      await openPanel(wrapper)
      await selectable()[1]!.trigger('click')
      const input = panelFind('input')
      await input.setValue('brand-new-tag')
      await input.trigger('keydown', { key: 'Enter' })
      await flushPromises()
      expect(lastPostBody().body.tags).toEqual([{ id: 4 }, { name: 'brand-new-tag' }])
    })

    it('面板已关闭：Enter 不调 post', async () => {
      const wrapper = mountTags({ props: { tags: [...baseTags], bookmarkId: 7 } })
      await openPanel(wrapper)
      const input = panelFind('input')
      await input.setValue('design')
      await openPanel(wrapper) // close
      await input.trigger('keydown', { key: 'Enter' })
      await flushPromises()
      expect(mockPost).not.toHaveBeenCalled()
    })
  })

  describe('点击外部提交', () => {
    it('click outside：提交 pending 并关闭', async () => {
      mockPost.mockResolvedValueOnce([design])
      const wrapper = mountTags({ props: { tags: [...baseTags], bookmarkId: 7 }, attachTo: document.body })
      await openPanel(wrapper)
      await selectable()[0]!.trigger('click')
      await tick() // vueuse onClickOutside 用 setTimeout(0) 去重连点
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushPromises()
      await tick()
      expect(mockPost).toHaveBeenCalledTimes(1)
      expect(lastPostBody().url).toBe('/v1/bookmark/add_tags')
      expect(isPanelHidden()).toBe(true)
    })
  })

  describe('local-first', () => {
    const asId = (id: string) => id as unknown as number
    const lfTech: BookmarkTag = { id: asId('t-1'), name: 'tech', show_name: 'tech', source: 'mine', added_by: 'user' }
    const lfDesign: BookmarkTag = { id: asId('t-3'), name: 'design', show_name: 'design', source: 'mine' }
    const lfAiTools: BookmarkTag = { id: asId('t-4'), name: 'ai-tools', show_name: 'ai-tools', source: 'auto' }
    const lfCreated: BookmarkTag = { id: asId('t-new'), name: 'fresh', show_name: 'fresh', source: 'mine' }

    function makeSource() {
      const tags = ref<BookmarkTag[]>([lfTech])
      const userTags = ref<BookmarkTag[]>([lfTech, lfDesign, lfAiTools])
      const src = {
        tags: computed(() => tags.value),
        userTags: computed(() => userTags.value),
        isLoading: ref(false),
        add: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
        setTags: vi.fn().mockResolvedValue(undefined),
        createUserTag: vi.fn().mockResolvedValue(lfCreated)
      }
      return { src, tags, userTags }
    }

    it('非 compact：两个已有 + 一个新建 → createUserTag 一次 + setTags 一次（并集）', async () => {
      const { src } = makeSource()
      const bookmarkTagSource = vi.fn(() => src)
      const wrapper = mountTags({
        props: { tags: [lfTech], bookmarkUuid: 'b-1' },
        global: { provide: { [LocalFirstAdapterKey as symbol]: { bookmarkTagSource } } }
      })
      await flushPromises()
      expect(bookmarkTagSource).toHaveBeenCalledTimes(1)
      await openPanel(wrapper)
      expect(mockGet).not.toHaveBeenCalled()
      expect(candidateNames()).toEqual(['tech', 'design', 'ai-tools'])
      await selectable()[0]!.trigger('click')
      await selectable()[1]!.trigger('click')
      await panelFind('input').setValue('fresh')
      await panelFind('.search-tag.create').trigger('click')
      await panelFind('.confirm-btn').trigger('click')
      await flushPromises()
      expect(src.createUserTag).toHaveBeenCalledTimes(1)
      expect(src.createUserTag).toHaveBeenCalledWith('fresh')
      expect(src.setTags).toHaveBeenCalledTimes(1)
      expect(src.setTags).toHaveBeenCalledWith('b-1', ['t-1', 't-3', 't-4', 't-new'])
      expect(src.add).not.toHaveBeenCalled()
      expect(mockPost).not.toHaveBeenCalled()
      const emitted = wrapper.emitted('change')![0]![0] as BookmarkTag[]
      expect(emitted.map(t => t.id)).toEqual(['t-1', 't-3', 't-4', 't-new'])
      expect(isPanelHidden()).toBe(true)
    })

    it('非 compact：源没有 setTags 时逐个 add', async () => {
      const { src } = makeSource()
      const { setTags: _drop, ...noSetTags } = src
      void _drop
      const wrapper = mountTags({
        props: { tags: [lfTech], bookmarkUuid: 'b-1' },
        global: { provide: { [LocalFirstAdapterKey as symbol]: { bookmarkTagSource: () => noSetTags } } }
      })
      await flushPromises()
      await openPanel(wrapper)
      await selectable()[0]!.trigger('click')
      await selectable()[1]!.trigger('click')
      await panelFind('.confirm-btn').trigger('click')
      await flushPromises()
      expect(src.add).toHaveBeenCalledTimes(2)
      expect(src.add).toHaveBeenNthCalledWith(1, 'b-1', 't-3')
      expect(src.add).toHaveBeenNthCalledWith(2, 'b-1', 't-4')
    })

    it('非 compact：删除走 source.remove', async () => {
      const { src } = makeSource()
      const wrapper = mountTags({
        props: { tags: [lfTech], bookmarkUuid: 'b-1' },
        global: { provide: { [LocalFirstAdapterKey as symbol]: { bookmarkTagSource: () => src } } }
      })
      await flushPromises()
      await wrapper.find('.tag-act.remove').trigger('click')
      await flushPromises()
      expect(src.remove).toHaveBeenCalledWith('b-1', 't-1')
      expect(mockPost).not.toHaveBeenCalled()
      expect(wrapper.emitted('change')![0]![0]).toEqual([])
    })

    it('compact：走 bookmarkTagActions + SharedUserTagsKey，不建 bookmarkTagSource、不拉 TAG_LIST', async () => {
      const actions = {
        setTags: vi.fn().mockResolvedValue(undefined),
        add: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
        createUserTag: vi.fn().mockResolvedValue(lfCreated)
      }
      const bookmarkTagSource = vi.fn()
      const shared = { tags: computed(() => [lfTech, lfDesign, lfAiTools]), create: vi.fn() }
      const wrapper = mountTags({
        props: { tags: [lfTech], bookmarkUuid: 'b-1', compact: true },
        global: {
          provide: {
            [LocalFirstAdapterKey as symbol]: { bookmarkTagSource, bookmarkTagActions: () => actions },
            [SharedUserTagsKey as symbol]: shared
          }
        }
      })
      await flushPromises()
      expect(bookmarkTagSource).not.toHaveBeenCalled()
      await openPanel(wrapper)
      expect(mockGet).not.toHaveBeenCalled()
      expect(candidateNames()).toEqual(['tech', 'design', 'ai-tools'])
      await selectable()[0]!.trigger('click')
      await panelFind('input').setValue('fresh')
      await panelFind('.search-tag.create').trigger('click')
      await panelFind('.confirm-btn').trigger('click')
      await flushPromises()
      expect(actions.createUserTag).toHaveBeenCalledWith('fresh')
      expect(actions.setTags).toHaveBeenCalledTimes(1)
      expect(actions.setTags).toHaveBeenCalledWith('b-1', ['t-1', 't-3', 't-new'])
      expect(mockPost).not.toHaveBeenCalled()
      const emitted = wrapper.emitted('change')![0]![0] as BookmarkTag[]
      expect(emitted.map(t => t.id)).toEqual(['t-1', 't-3', 't-new'])
      expect(wrapper.findAll('.tags-cells .tag-chip')).toHaveLength(3)

      await wrapper.find('.tag-act.remove').trigger('click')
      await flushPromises()
      expect(actions.remove).toHaveBeenCalledWith('b-1', 't-1')
      expect(bookmarkTagSource).not.toHaveBeenCalled()
    })

    it('compact 且没有 SharedUserTagsKey：候选回退到 TAG_LIST', async () => {
      const actions = {
        setTags: vi.fn().mockResolvedValue(undefined),
        add: vi.fn(),
        remove: vi.fn(),
        createUserTag: vi.fn()
      }
      const wrapper = mountTags({
        props: { tags: [...baseTags], bookmarkUuid: 'b-1', compact: true },
        global: { provide: { [LocalFirstAdapterKey as symbol]: { bookmarkTagActions: () => actions } } }
      })
      await openPanel(wrapper)
      expect(mockGet).toHaveBeenCalledTimes(1)
      expect(candidateNames()).toEqual(['tech', 'design', 'ai', 'ai-tools'])
    })

    it('LF 出错：toast + pending 保留', async () => {
      const { src } = makeSource()
      src.setTags.mockRejectedValueOnce(new Error('offline'))
      const wrapper = mountTags({
        props: { tags: [lfTech], bookmarkUuid: 'b-1' },
        global: { provide: { [LocalFirstAdapterKey as symbol]: { bookmarkTagSource: () => src } } }
      })
      await flushPromises()
      await openPanel(wrapper)
      await selectable()[0]!.trigger('click')
      await panelFind('.confirm-btn').trigger('click')
      await flushPromises()
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
      expect(isPanelHidden()).toBe(false)
      expect(panelFind('.confirm-btn').text()).toBe('Done (1)')
    })
  })

  // 裁剪逻辑本身（几个 chip 能放下）由纯函数 computeVisibleTagCount 覆盖（tests/unit/utils/tagOverflow.spec.ts）。
  // 组件内 rootEl/measureEl 这两个模板 ref 在本仓库当前 happy-dom + @vue/test-utils 组合下不会被填充
  // （连这个文件里早就存在、与本次改动无关的 add ref 在同样环境下也是 undefined，属于预置环境问题，
  // 不是这次改动引入的），所以这里只覆盖不依赖 DOM ref 解析的部分：默认态渲染、compact 才出现度量行、
  // + 图标默认态。真实宽度裁剪→图标切换的端到端行为已用真实 Chrome + 组件同款 CSS/DOM 结构离线验证过。
  describe('compact：宽度裁剪 —— 默认态与度量行', () => {
    it('默认（未收到真实宽度测量前）：全部显示，+ 图标，无 More tags title', () => {
      const tags = [tech, ai, design]
      const wrapper = mountTags({ props: { tags: [...tags], bookmarkId: 7, compact: true } })
      expect(wrapper.findAll('.tags-cells .tag-chip')).toHaveLength(3)
      expect(wrapper.find('.tag-add').find('circle').exists()).toBe(false)
      expect(wrapper.find('.tag-add').attributes('title')).toBe('Add')
    })

    it('compact 才渲染不可见度量行，且数量与 displayTags 一致', () => {
      const tags = [tech, ai, design]
      const wrapper = mountTags({ props: { tags: [...tags], bookmarkId: 7, compact: true } })
      expect(wrapper.findAll('.tags-measure .tag-chip')).toHaveLength(3)
    })
  })
})
