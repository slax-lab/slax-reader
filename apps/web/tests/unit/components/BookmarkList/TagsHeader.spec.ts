// TagsHeader 组件单测（标签页重做：我的标签 / 自动标签两段 + 多标签交集筛选）
// props: selectTagIds / selectTagName
// emit: select-tag(ids, name?) / select-untagged
// 浏览态：新建标签行 + My tags / Auto tags 两段 + 未打标签入口 + 空态
// 筛选态：返回 + 已选 chip（可 ×）+ “+” 候选弹层
// REST：request().get(TAG_LIST) / post(PROMOTE_USER_TAG) / get(TAG_LIST?within=)
// local-first：userTagSource().tags / bookmarkListTagSource().candidates()，改名删除提升仍走 REST
import { computed, ref } from 'vue'

import TagsHeader from '~~/app/components/BookmarkList/TagsHeader.vue'

import type { BookmarkTag } from '@commons/types/interface'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { LocalFirstAdapterKey } from '~~/app/composables/local-first/injection'
import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequest, mockGet, mockPost, mockShowEditTagModal, mockToastShowToast } = vi.hoisted(() => {
  const mockGet = vi.fn((): Promise<unknown> => Promise.resolve([]))
  const mockPost = vi.fn((): Promise<unknown> => Promise.resolve({ id: 'new', show_name: 'NewTag', display: true, source: 'mine' }))
  return {
    mockGet,
    mockPost,
    mockRequest: vi.fn(() => ({ get: mockGet, post: mockPost })),
    mockShowEditTagModal: vi.fn(),
    mockToastShowToast: vi.fn()
  }
})

mockNuxtImport('request', () => mockRequest)

vi.mock('~/components/Modal', () => ({
  showEditTagModal: mockShowEditTagModal
}))

vi.mock('~/components/Toast', () => ({
  default: { showToast: mockToastShowToast },
  ToastType: { Success: 'success', Error: 'error' }
}))

const tag = (id: string, source: 'mine' | 'auto', extra: Partial<BookmarkTag> = {}): BookmarkTag =>
  ({ id, name: id, show_name: id, display: true, source, ...extra }) as unknown as BookmarkTag

const mixedTags = () => [tag('m1', 'mine'), tag('m2', 'mine'), tag('a1', 'auto'), tag('a2', 'auto'), tag('a3', 'auto')]

const chipNames = (wrapper: ReturnType<typeof mountWithApp>, root = '') => wrapper.findAll(`${root} .tag-chip .tag-name`.trim()).map(c => c.text())

// local-first 适配器：tags 可被用例改写，候选由 candidates 给
const makeLf = (tags: BookmarkTag[], candidates: BookmarkTag[] = []) => {
  const tagsRef = ref<BookmarkTag[]>(tags)
  const create = vi.fn(async (name: string) => {
    const t = tag(`uuid-${name}`, 'mine', { id_kind: 'uuid' })
    tagsRef.value = [t, ...tagsRef.value]
    return t
  })
  const userTagSource = vi.fn(() => ({ tags: computed(() => tagsRef.value), create }))
  const candidatesFn = vi.fn(() => computed(() => candidates))
  const bookmarkListTagSource = vi.fn(() => ({ candidates: candidatesFn }))
  return { adapter: { userTagSource, bookmarkListTagSource }, tagsRef, create, userTagSource, bookmarkListTagSource, candidatesFn }
}

describe('TagsHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet.mockResolvedValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('浏览态：加载 + 分段', () => {
    it('GET TAG_LIST → mine / auto 两段按 source 分开渲染', async () => {
      mockGet.mockResolvedValueOnce(mixedTags())
      const wrapper = mountWithApp(TagsHeader)
      await flushPromises()
      expect(mockGet).toHaveBeenCalledWith(expect.objectContaining({ url: '/v1/tag/list' }))
      expect(wrapper.find('.tag-add').exists()).toBe(true)
      const sections = wrapper.findAll('.tag-section')
      expect(sections.length).toBe(2)
      expect(sections[0]!.find('.tag-section-title').text()).toBe('My tags')
      expect(sections[0]!.find('.tag-section-hint').text()).toBe('AI picks these first when tagging')
      expect(chipNames(wrapper, '.tag-section.mine')).toEqual(['m1', 'm2'])
      expect(sections[1]!.find('.tag-section-title').text()).toBe('Auto tags')
      expect(chipNames(wrapper, '.tag-section.auto')).toEqual(['a1', 'a2', 'a3'])
      // 自动标签可提升，我的标签不可
      expect(wrapper.findAll('.tag-section.auto .tag-act.promote').length).toBe(3)
      expect(wrapper.findAll('.tag-section.mine .tag-act.promote').length).toBe(0)
      // 未打标签入口
      expect(wrapper.find('.tag-untagged').text()).toContain('Untagged articles')
    })

    it('source 缺省视为 auto；display=false 被过滤', async () => {
      mockGet.mockResolvedValueOnce([tag('x', 'auto', { source: undefined }), tag('hidden', 'auto', { display: false })])
      const wrapper = mountWithApp(TagsHeader)
      await flushPromises()
      expect(chipNames(wrapper, '.tag-section.auto')).toEqual(['x'])
      expect(chipNames(wrapper)).not.toContain('hidden')
    })

    it('没有 mine → 引导块：标题/描述 + 前 8 个 auto 标签', async () => {
      const autos = Array.from({ length: 10 }, (_, i) => tag(`a${i}`, 'auto'))
      mockGet.mockResolvedValueOnce(autos)
      const wrapper = mountWithApp(TagsHeader)
      await flushPromises()
      const onboarding = wrapper.find('.mine-onboarding')
      expect(onboarding.exists()).toBe(true)
      expect(onboarding.find('.mine-onboarding-title').text()).toBe('Pick a few words you actually use')
      expect(onboarding.find('.mine-onboarding-desc').text()).toContain('Picked words move to the top')
      expect(chipNames(wrapper, '.mine-onboarding')).toEqual(autos.slice(0, 8).map(t => t.show_name))
      // auto 段仍列全部
      expect(chipNames(wrapper, '.tag-section.auto').length).toBe(10)
    })

    it('引导块点一个 → POST promote(tag_id) → 移到 mine 段', async () => {
      mockGet.mockResolvedValueOnce([tag('a1', 'auto'), tag('a2', 'auto')])
      mockPost.mockResolvedValueOnce(tag('a2', 'mine'))
      const wrapper = mountWithApp(TagsHeader)
      await flushPromises()
      await wrapper.findAll('.mine-onboarding .tag-chip')[1]!.trigger('click')
      await flushPromises()
      expect(mockPost).toHaveBeenCalledWith(expect.objectContaining({ url: '/v1/tag/promote', body: { tag_id: 'a2' } }))
      expect(wrapper.find('.mine-onboarding').exists()).toBe(false)
      expect(chipNames(wrapper, '.tag-section.mine')).toEqual(['a2'])
      expect(chipNames(wrapper, '.tag-section.auto')).toEqual(['a1'])
      // 引导块的点击不是选择
      expect(wrapper.emitted('select-tag')).toBeUndefined()
    })

    it('auto 段 ↑ → POST promote → 移到 mine 段', async () => {
      mockGet.mockResolvedValueOnce(mixedTags())
      mockPost.mockResolvedValueOnce(tag('a1', 'mine'))
      const wrapper = mountWithApp(TagsHeader)
      await flushPromises()
      await wrapper.find('.tag-section.auto .tag-act.promote').trigger('click')
      await flushPromises()
      expect(mockPost).toHaveBeenCalledWith(expect.objectContaining({ url: '/v1/tag/promote', body: { tag_id: 'a1' } }))
      expect(chipNames(wrapper, '.tag-section.mine')).toContain('a1')
      expect(chipNames(wrapper, '.tag-section.auto')).not.toContain('a1')
    })

    it('promote 失败（返 null）→ Toast Error，列表不变', async () => {
      mockGet.mockResolvedValueOnce(mixedTags())
      mockPost.mockResolvedValueOnce(null)
      const wrapper = mountWithApp(TagsHeader)
      await flushPromises()
      await wrapper.find('.tag-section.auto .tag-act.promote').trigger('click')
      await flushPromises()
      expect(mockToastShowToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
      expect(chipNames(wrapper, '.tag-section.auto')).toContain('a1')
    })

    it('chip 点击 → emit select-tag([id], name)', async () => {
      mockGet.mockResolvedValueOnce(mixedTags())
      const wrapper = mountWithApp(TagsHeader)
      await flushPromises()
      await wrapper.find('.tag-section.auto .tag-chip').trigger('click')
      expect(wrapper.emitted('select-tag')![0]).toEqual([['a1'], 'a1'])
    })

    it('未打标签入口 → emit select-untagged', async () => {
      mockGet.mockResolvedValueOnce(mixedTags())
      const wrapper = mountWithApp(TagsHeader)
      await flushPromises()
      await wrapper.find('.tag-untagged').trigger('click')
      expect(wrapper.emitted('select-untagged')).toBeTruthy()
    })

    it('没有任何标签 → 空态，不渲染分段和未打标签入口', async () => {
      mockGet.mockResolvedValueOnce([])
      const wrapper = mountWithApp(TagsHeader)
      await flushPromises()
      expect(wrapper.find('.tags-empty').exists()).toBe(true)
      expect(wrapper.find('.tag-section').exists()).toBe(false)
      expect(wrapper.find('.tag-untagged').exists()).toBe(false)
    })

    it('GET 失败（返 null）→ Toast Error', async () => {
      mockGet.mockResolvedValueOnce(null)
      mountWithApp(TagsHeader)
      await flushPromises()
      expect(mockToastShowToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
    })
  })

  describe('编辑', () => {
    it('铅笔 → showEditTagModal 带 source / idKind / 三个回调', async () => {
      mockGet.mockResolvedValueOnce(mixedTags())
      const wrapper = mountWithApp(TagsHeader)
      await flushPromises()
      await wrapper.find('.tag-section.mine .tag-edit-btn').trigger('click')
      expect(mockShowEditTagModal).toHaveBeenCalledWith(
        expect.objectContaining({
          tagId: 'm1',
          tagName: 'm1',
          source: 'mine',
          idKind: 'hashid',
          callback: expect.any(Function),
          deleteCallback: expect.any(Function),
          demoteCallback: expect.any(Function)
        })
      )
    })

    it('callback 改名 / deleteCallback 移除 / demoteCallback 降为 auto；id 不匹配则忽略', async () => {
      mockGet.mockResolvedValueOnce(mixedTags())
      const wrapper = mountWithApp(TagsHeader)
      await flushPromises()
      await wrapper.find('.tag-section.mine .tag-edit-btn').trigger('click')
      const opts = mockShowEditTagModal.mock.calls[0]![0]

      opts.callback('zzz', 'ignored')
      await flushPromises()
      expect(chipNames(wrapper, '.tag-section.mine')).toEqual(['m1', 'm2'])

      opts.callback('m1', 'renamed')
      await flushPromises()
      expect(chipNames(wrapper, '.tag-section.mine')).toEqual(['renamed', 'm2'])

      opts.demoteCallback('zzz')
      opts.demoteCallback('m1')
      await flushPromises()
      expect(chipNames(wrapper, '.tag-section.mine')).toEqual(['m2'])
      expect(chipNames(wrapper, '.tag-section.auto')).toContain('renamed')

      opts.deleteCallback('zzz')
      opts.deleteCallback('m1')
      await flushPromises()
      expect(chipNames(wrapper)).not.toContain('renamed')
      expect(chipNames(wrapper, '.tag-section.mine')).toEqual(['m2'])
    })
  })

  describe('新建标签', () => {
    it('Enter + 文本非空 → POST ADD_USER_TAG → 新标签进列表', async () => {
      mockGet.mockResolvedValueOnce([tag('a1', 'auto')])
      mockPost.mockResolvedValueOnce(tag('new', 'mine', { show_name: 'newtag' }))
      const wrapper = mountWithApp(TagsHeader)
      await flushPromises()
      await wrapper.find('.tag-add').trigger('click')
      const input = wrapper.find('.tag-input-wrap input')
      await input.setValue('newtag')
      await input.trigger('keydown', { key: 'Enter' })
      await flushPromises()
      expect(mockPost).toHaveBeenCalledWith(expect.objectContaining({ url: '/v1/tag/create', body: { tag_name: 'newtag' } }))
      expect(chipNames(wrapper, '.tag-section.mine')).toEqual(['newtag'])
      expect(wrapper.find('.tag-add').exists()).toBe(true)
    })

    it('POST 返回已存在的 id → 不重复推入', async () => {
      mockGet.mockResolvedValueOnce([tag('a1', 'auto')])
      mockPost.mockResolvedValueOnce(tag('a1', 'mine'))
      const wrapper = mountWithApp(TagsHeader)
      await flushPromises()
      await wrapper.find('.tag-add').trigger('click')
      const input = wrapper.find('.tag-input-wrap input')
      await input.setValue('a1')
      await wrapper.find('.tag-input-confirm').trigger('click')
      await flushPromises()
      expect(chipNames(wrapper)).toEqual(['a1'])
      expect(chipNames(wrapper, '.tag-section.mine')).toEqual(['a1'])
    })

    it('Enter + 空白 → 取消（不调 request）', async () => {
      const wrapper = mountWithApp(TagsHeader)
      await flushPromises()
      await wrapper.find('.tag-add').trigger('click')
      const input = wrapper.find('.tag-input-wrap input')
      await input.setValue('   ')
      await input.trigger('keydown', { key: 'Enter' })
      await flushPromises()
      expect(mockPost).not.toHaveBeenCalled()
      expect(wrapper.find('.tag-add').exists()).toBe(true)
    })

    it('Escape → 关闭输入行', async () => {
      const wrapper = mountWithApp(TagsHeader)
      await flushPromises()
      await wrapper.find('.tag-add').trigger('click')
      await wrapper.find('.tag-input-wrap input').trigger('keydown', { key: 'Escape' })
      await flushPromises()
      expect(wrapper.find('.tag-add').exists()).toBe(true)
    })

    it('POST 返 null → Toast Error', async () => {
      mockPost.mockResolvedValueOnce(null)
      const wrapper = mountWithApp(TagsHeader)
      await flushPromises()
      await wrapper.find('.tag-add').trigger('click')
      const input = wrapper.find('.tag-input-wrap input')
      await input.setValue('willfail')
      await input.trigger('keydown', { key: 'Enter' })
      await flushPromises()
      expect(mockToastShowToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
    })

    it('composition 期间 Enter → 短路', async () => {
      // attachTo: v-ime-guard 靠 document 捕获阶段拦截 Enter，元素必须真实挂在 document 树上才生效
      const wrapper = mountWithApp(TagsHeader, { attachTo: document.body })
      await flushPromises()
      await wrapper.find('.tag-add').trigger('click')
      const input = wrapper.find('.tag-input-wrap input')
      await input.trigger('compositionstart')
      await input.setValue('foo')
      await input.trigger('keydown', { key: 'Enter' })
      await flushPromises()
      expect(mockPost).not.toHaveBeenCalled()
      await input.trigger('compositionend')
      await input.trigger('keydown', { key: 'Enter' })
      await flushPromises()
      expect(mockPost).toHaveBeenCalled()
      wrapper.unmount()
    })
  })

  describe('筛选态', () => {
    it('已选 chip（active + ×）+ 返回 + “+”；名字从列表解析', async () => {
      mockGet.mockResolvedValueOnce([tag('m1', 'mine', { show_name: 'Mine One' }), tag('a1', 'auto', { show_name: 'Auto One' })])
      const wrapper = mountWithApp(TagsHeader, { props: { selectTagIds: ['m1', 'a1'], selectTagName: 'Mine One' } })
      await flushPromises()
      expect(wrapper.find('.tag-add').exists()).toBe(false)
      expect(wrapper.find('.selected-tag-header').exists()).toBe(true)
      const chips = wrapper.findAll('.selected-tags .tag-chip')
      expect(chips.map(c => c.find('.tag-name').text())).toEqual(['Mine One', 'Auto One'])
      chips.forEach(c => expect(c.classes()).toContain('active'))
      expect(wrapper.findAll('.selected-tags .tag-act.remove').length).toBe(2)
      expect(wrapper.find('.tag-add-filter').exists()).toBe(true)
      // 挂载时把当前选择回抛，供父级加载（列表未到，名字沿用 selectTagName）
      expect(wrapper.emitted('select-tag')![0]).toEqual([['m1', 'a1'], 'Mine One'])
    })

    it('单个未知 id → 回退 selectTagName；多个未知 id → 原样 id', async () => {
      mockGet.mockResolvedValueOnce([])
      const one = mountWithApp(TagsHeader, { props: { selectTagIds: ['zz'], selectTagName: 'Fallback' } })
      await flushPromises()
      expect(one.find('.selected-tags .tag-name').text()).toBe('Fallback')

      mockGet.mockResolvedValueOnce([])
      const two = mountWithApp(TagsHeader, { props: { selectTagIds: ['zz', 'yy'], selectTagName: 'Fallback' } })
      await flushPromises()
      expect(two.findAll('.selected-tags .tag-name').map(c => c.text())).toEqual(['zz', 'yy'])
    })

    it('返回 → emit select-tag([])', async () => {
      mockGet.mockResolvedValueOnce(mixedTags())
      const wrapper = mountWithApp(TagsHeader, { props: { selectTagIds: ['m1'] } })
      await flushPromises()
      await wrapper.find('.back-btn').trigger('click')
      const events = wrapper.emitted('select-tag')!
      expect(events[events.length - 1]).toEqual([[]])
    })

    it('× → emit 去掉该 id 的列表；最后一个 × → []', async () => {
      mockGet.mockResolvedValueOnce(mixedTags())
      const wrapper = mountWithApp(TagsHeader, { props: { selectTagIds: ['m1', 'a1'] } })
      await flushPromises()
      await wrapper.findAll('.selected-tags .tag-act.remove')[0]!.trigger('click')
      let events = wrapper.emitted('select-tag')!
      expect(events[events.length - 1]).toEqual([['a1'], 'a1'])

      await wrapper.setProps({ selectTagIds: ['a1'] })
      await wrapper.find('.selected-tags .tag-act.remove').trigger('click')
      events = wrapper.emitted('select-tag')!
      expect(events[events.length - 1]).toEqual([[]])
    })

    it('“+” → GET within= 候选；pick → emit 追加后的列表，弹层仍在；ids 变化后重新拉候选', async () => {
      mockGet.mockResolvedValueOnce(mixedTags())
      const wrapper = mountWithApp(TagsHeader, { props: { selectTagIds: ['m1'] } })
      await flushPromises()
      mockGet.mockResolvedValueOnce([tag('a1', 'auto', { count: 4 }), tag('a2', 'auto', { count: 2 })])
      await wrapper.find('.tag-add-filter').trigger('click')
      await flushPromises()
      expect(mockGet).toHaveBeenLastCalledWith(expect.objectContaining({ url: '/v1/tag/list', query: { within: 'm1' } }))
      const popover = wrapper.find('.tag-candidate-popover')
      expect(popover.exists()).toBe(true)
      expect(popover.findAll('.tag-chip').length).toBe(2)
      expect(popover.find('.tag-count').text()).toBe('4')

      mockGet.mockResolvedValueOnce([tag('a2', 'auto', { count: 1 })])
      await popover.find('.tag-chip').trigger('click')
      const events = wrapper.emitted('select-tag')!
      expect(events[events.length - 1]).toEqual([['m1', 'a1'], 'm1'])
      expect(wrapper.find('.tag-candidate-popover').exists()).toBe(true)

      // 父级回写 props → 按新 id 集合重新拉候选
      await wrapper.setProps({ selectTagIds: ['m1', 'a1'] })
      await flushPromises()
      expect(mockGet).toHaveBeenLastCalledWith(expect.objectContaining({ query: { within: 'm1,a1' } }))
      expect(wrapper.findAll('.tag-candidate-popover .tag-chip').length).toBe(1)
      expect(wrapper.findAll('.selected-tags .tag-chip').length).toBe(2)
    })

    it('候选 GET 失败（返 null）→ Toast Error + 空列表；Escape 关闭弹层；再点 “+” 收起', async () => {
      mockGet.mockResolvedValueOnce(mixedTags())
      const wrapper = mountWithApp(TagsHeader, { props: { selectTagIds: ['m1'] } })
      await flushPromises()
      mockGet.mockResolvedValueOnce(null)
      await wrapper.find('.tag-add-filter').trigger('click')
      await flushPromises()
      expect(mockToastShowToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
      expect(wrapper.find('.tag-candidate-popover .candidate-empty').exists()).toBe(true)

      await wrapper.find('.tag-candidate-popover input').trigger('keydown', { key: 'Escape' })
      expect(wrapper.find('.tag-candidate-popover').exists()).toBe(false)

      mockGet.mockResolvedValueOnce([])
      await wrapper.find('.tag-add-filter').trigger('click')
      await flushPromises()
      expect(wrapper.find('.tag-candidate-popover').exists()).toBe(true)
      await wrapper.find('.tag-add-filter').trigger('click')
      expect(wrapper.find('.tag-candidate-popover').exists()).toBe(false)
    })

    it('弹层开着时 ids 清空 → 回浏览态，弹层关闭', async () => {
      mockGet.mockResolvedValueOnce(mixedTags())
      const wrapper = mountWithApp(TagsHeader, { props: { selectTagIds: ['m1'] } })
      await flushPromises()
      mockGet.mockResolvedValueOnce([])
      await wrapper.find('.tag-add-filter').trigger('click')
      await flushPromises()
      await wrapper.setProps({ selectTagIds: [] })
      await flushPromises()
      expect(wrapper.find('.tag-candidate-popover').exists()).toBe(false)
      expect(wrapper.find('.tag-add').exists()).toBe(true)
      // 清空后不会再拉候选
      expect(mockGet).toHaveBeenCalledTimes(2)
    })
  })

  describe('local-first', () => {
    it('tags 来自 userTagSource；不调 GET；编辑按钮可见；缺 source 视为 auto', async () => {
      const lf = makeLf([tag('u1', 'mine', { id_kind: 'uuid' }), tag('u2', 'auto', { id_kind: 'uuid', source: undefined })])
      const wrapper = mountWithApp(TagsHeader, { global: { provide: { [LocalFirstAdapterKey as symbol]: lf.adapter } } })
      await flushPromises()
      expect(mockGet).not.toHaveBeenCalled()
      expect(lf.userTagSource).toHaveBeenCalledTimes(1)
      expect(lf.bookmarkListTagSource).toHaveBeenCalledTimes(1)
      expect(chipNames(wrapper, '.tag-section.mine')).toEqual(['u1'])
      expect(chipNames(wrapper, '.tag-section.auto')).toEqual(['u2'])
      expect(wrapper.findAll('.tag-edit-btn').length).toBe(2)

      await wrapper.find('.tag-section.mine .tag-edit-btn').trigger('click')
      expect(mockShowEditTagModal).toHaveBeenCalledWith(expect.objectContaining({ tagId: 'u1', idKind: 'uuid', source: 'mine' }))
      // LF 回调只依赖 sync，不崩
      const opts = mockShowEditTagModal.mock.calls[0]![0]
      opts.callback('u1', 'x')
      opts.deleteCallback('u1')
      opts.demoteCallback('u1')
      await flushPromises()
      expect(chipNames(wrapper, '.tag-section.mine')).toEqual(['u1'])
    })

    it('↑ promote → POST tag_uuid，列表交给 sync；失败 → Toast', async () => {
      const lf = makeLf([tag('u2', 'auto', { id_kind: 'uuid' })])
      mockPost.mockResolvedValueOnce(tag('u2', 'mine', { id_kind: 'uuid' }))
      const wrapper = mountWithApp(TagsHeader, { global: { provide: { [LocalFirstAdapterKey as symbol]: lf.adapter } } })
      await flushPromises()
      await wrapper.find('.tag-section.auto .tag-act.promote').trigger('click')
      await flushPromises()
      expect(mockPost).toHaveBeenCalledWith(expect.objectContaining({ url: '/v1/tag/promote', body: { tag_uuid: 'u2' } }))
      expect(chipNames(wrapper, '.tag-section.auto')).toEqual(['u2'])

      mockPost.mockResolvedValueOnce(null)
      await wrapper.find('.tag-section.auto .tag-act.promote').trigger('click')
      await flushPromises()
      expect(mockToastShowToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
    })

    it('新建 → source.create，不调 POST；新标签经 source 到达', async () => {
      const lf = makeLf([tag('u2', 'auto', { id_kind: 'uuid' })])
      const wrapper = mountWithApp(TagsHeader, { global: { provide: { [LocalFirstAdapterKey as symbol]: lf.adapter } } })
      await flushPromises()
      await wrapper.find('.tag-add').trigger('click')
      const input = wrapper.find('.tag-input-wrap input')
      await input.setValue('fresh')
      await input.trigger('keydown', { key: 'Enter' })
      await flushPromises()
      expect(lf.create).toHaveBeenCalledWith('fresh')
      expect(mockPost).not.toHaveBeenCalled()
      expect(chipNames(wrapper, '.tag-section.mine')).toEqual(['uuid-fresh'])
      expect(wrapper.find('.tag-add').exists()).toBe(true)
    })

    it('筛选态 “+” 用 bookmarkListTagSource.candidates，不发请求', async () => {
      const lf = makeLf([tag('u1', 'mine', { id_kind: 'uuid' })], [tag('u3', 'auto', { id_kind: 'uuid', count: 7 })])
      const wrapper = mountWithApp(TagsHeader, {
        props: { selectTagIds: ['u1'] },
        global: { provide: { [LocalFirstAdapterKey as symbol]: lf.adapter } }
      })
      await flushPromises()
      expect(lf.candidatesFn).toHaveBeenCalledTimes(1)
      expect(wrapper.find('.selected-tags .tag-name').text()).toBe('u1')
      await wrapper.find('.tag-add-filter').trigger('click')
      await flushPromises()
      expect(mockGet).not.toHaveBeenCalled()
      const popover = wrapper.find('.tag-candidate-popover')
      expect(popover.findAll('.tag-chip').length).toBe(1)
      expect(popover.find('.tag-count').text()).toBe('7')
      await popover.find('.tag-chip').trigger('click')
      const events = wrapper.emitted('select-tag')!
      expect(events[events.length - 1]).toEqual([['u1', 'u3'], 'u1'])
    })
  })
})
