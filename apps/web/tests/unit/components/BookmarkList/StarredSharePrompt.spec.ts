import { ref } from 'vue'

import StarredSharePrompt from '~~/app/components/BookmarkList/StarredSharePrompt.vue'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { mountWithApp } from '~~/tests/setup/mount'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  copyText: vi.fn(() => Promise.resolve()),
  cursorShow: vi.fn(),
  toastShow: vi.fn(),
  ensure: vi.fn(),
  refresh: vi.fn(),
  post: vi.fn(),
  navigateTo: vi.fn(),
  info: { value: null as Record<string, unknown> | null, __v_isRef: true as const },
  loaded: { value: false, __v_isRef: true as const }
}))

vi.mock('~/composables/useShareCollectInfo', () => ({
  useShareCollectInfo: () => ({ info: mocks.info, loaded: mocks.loaded, ensure: mocks.ensure, refresh: mocks.refresh })
}))
vi.mock('@commons/frontend-utils/string', () => ({ copyText: mocks.copyText }))
vi.mock('~/components/CursorToast', () => ({ default: { showToast: mocks.cursorShow } }))
vi.mock('~/components/Toast', () => ({
  default: { showToast: mocks.toastShow },
  ToastType: { Normal: 'normal', Success: 'success', Error: 'error' }
}))
vi.mock('~/stores/user', () => ({
  useUserStore: () => ({ userInfo: { userId: 7, name: 'Alex' } })
}))

mockNuxtImport('request', () => () => ({ post: mocks.post }))
mockNuxtImport('navigateTo', () => mocks.navigateTo)

const openInfo = (overrides: Record<string, unknown> = {}) => ({
  show_name: 'Alex Picks',
  description: 'Great reads',
  starred_count: 0,
  subscriber_count: 12,
  collection_code: 'CODE123',
  status: 1,
  show_marks: true,
  allow_marks: true,
  show_profile: true,
  avatar: '',
  ...overrides
})

const closedInfo = (overrides: Record<string, unknown> = {}) => openInfo({ status: 0, description: '', ...overrides })

const mountPrompt = async (info: Record<string, unknown> | null, loaded = true) => {
  mocks.info.value = info
  mocks.loaded.value = loaded
  const wrapper = mountWithApp(StarredSharePrompt, {
    global: {
      stubs: {
        NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' }
      }
    }
  })
  await flushPromises()
  return wrapper
}

const mockReopenSuccess = () => {
  mocks.post.mockResolvedValueOnce({ status: 1, collection_code: 'CODE123' })
  mocks.refresh.mockImplementationOnce(async () => {
    mocks.info.value = openInfo()
    return mocks.info.value
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  // Real refs keep the component reactive when reopen writes back into the mocked cache.
  mocks.info = ref(null) as unknown as typeof mocks.info
  mocks.loaded = ref(false) as unknown as typeof mocks.loaded
  mocks.copyText.mockResolvedValue(undefined)
  mocks.post.mockResolvedValue({ status: 1, collection_code: 'CODE123' })
  mocks.refresh.mockResolvedValue(openInfo())
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('components/BookmarkList/StarredSharePrompt', () => {
  it.each([0, 1, 9, 10])('shows the same collection card with %i locally known stars', async count => {
    const wrapper = await mountPrompt(openInfo({ starred_count: count }))

    expect(wrapper.find('.starred-share-prompt').exists()).toBe(true)
    expect(wrapper.find('.starred-share-title').text()).toBe('Alex Picks')
    expect(wrapper.find('.starred-share-icon-btn').exists()).toBe(true)
    expect(wrapper.find('.starred-share-actions').exists()).toBe(true)
  })

  it('restores the enabled UX: status, name with subscribers, description, right actions', async () => {
    const wrapper = await mountPrompt(openInfo({ subscriber_count: 12 }))

    expect(wrapper.find('.starred-share-content > .starred-share-status').text()).toBe('Public')
    const header = wrapper.find('.starred-share-enabled-header')
    expect(header.find('.starred-share-title').text()).toBe('Alex Picks')
    expect(header.find('.starred-share-subscriber-count').text()).toContain('12')
    expect(wrapper.find('.starred-share-desc').text()).toBe('Great reads')
    expect(wrapper.find('.starred-share-actions .starred-share-icon-btn').exists()).toBe(true)
    expect(wrapper.findAll('button.starred-share-outline-btn').some(button => button.text().includes('View collection'))).toBe(true)
    expect(wrapper.find('.starred-share-manage-link').exists()).toBe(false)
    expect(wrapper.find('.starred-share-mini-entry').exists()).toBe(false)
  })

  it('shows the functional explanation when public without a custom description', async () => {
    const wrapper = await mountPrompt(openInfo({ description: '   ' }))

    expect(wrapper.find('.starred-share-desc').text()).toBe(
      'Starred items automatically form a recommendation page you can share with a link.'
    )
  })

  it('shows the custom description instead of the functional explanation when present', async () => {
    const wrapper = await mountPrompt(openInfo({ description: '  Great reads  ' }))

    expect(wrapper.find('.starred-share-desc').text()).toBe('Great reads')
  })

  it('stays hidden until /mine has loaded or when the read fails', async () => {
    expect((await mountPrompt(openInfo(), false)).find('.starred-share-prompt').exists()).toBe(false)
    expect((await mountPrompt(null)).find('.starred-share-prompt').exists()).toBe(false)
  })

  it('copies the same stable address on repeated sharing without reopening or mutating visibility', async () => {
    const wrapper = await mountPrompt(openInfo())

    await wrapper.find('.starred-share-icon-btn').trigger('click')
    await flushPromises()
    await wrapper.find('.starred-share-icon-btn').trigger('click')
    await flushPromises()

    expect(mocks.copyText).toHaveBeenCalledTimes(2)
    expect(mocks.copyText).toHaveBeenNthCalledWith(1, expect.stringContaining('/c/CODE123'))
    expect(mocks.copyText).toHaveBeenNthCalledWith(2, expect.stringContaining('/c/CODE123'))
    expect(mocks.cursorShow).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Link copied',
        trackDom: expect.any(HTMLElement)
      })
    )
  })

  it('shows only the single-line mini entry when closed', async () => {
    const wrapper = await mountPrompt(closedInfo())

    expect(wrapper.find('.starred-share-prompt').exists()).toBe(false)
    expect(wrapper.find('.starred-share-mini-entry').exists()).toBe(true)
    expect(wrapper.find('.starred-share-mini-copy').text()).toBe('Your stars can help others discover great content')
    expect(wrapper.find('.starred-share-mini-btn').text()).toContain('Reopen collection')

    expect(wrapper.find('.starred-share-status').exists()).toBe(false)
    expect(wrapper.find('.starred-share-icon-btn').exists()).toBe(false)
    expect(wrapper.findAll('button.starred-share-outline-btn')).toHaveLength(0)
    expect(wrapper.find('.starred-share-manage-link').exists()).toBe(false)
    expect(wrapper.find('.starred-share-cta').exists()).toBe(false)
    expect(wrapper.find('.starred-share-dismiss').exists()).toBe(false)
    expect(wrapper.find('.enable-collection-modal').exists()).toBe(false)
    expect(wrapper.find('input').exists()).toBe(false)
    expect(wrapper.find('textarea').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Manage collection')
    expect(wrapper.text()).not.toContain('Not now')
    expect(mocks.post).not.toHaveBeenCalled()
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it('reopens directly from the mini entry and restores the public area', async () => {
    mockReopenSuccess()
    const wrapper = await mountPrompt(closedInfo())
    expect(wrapper.find('.starred-share-mini-entry').exists()).toBe(true)

    await wrapper.find('.starred-share-mini-btn').trigger('click')
    await flushPromises()

    expect(mocks.post).toHaveBeenCalledWith({
      url: '/v1/user/setting/enable',
      body: { key: 'share_collect' }
    })
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.starred-share-status').text()).toBe('Public')
    expect(wrapper.find('.starred-share-icon-btn').exists()).toBe(true)
    expect(wrapper.findAll('button.starred-share-outline-btn').some(button => button.text().includes('View collection'))).toBe(true)
    expect(wrapper.find('.starred-share-mini-entry').exists()).toBe(false)
    expect(wrapper.find('.starred-share-manage-link').exists()).toBe(false)
  })

  it('does not coerce a 0 status from the enable response into open', async () => {
    mocks.post.mockResolvedValueOnce({ status: 0, collection_code: 'CODE123' })
    mocks.refresh.mockResolvedValueOnce(null)
    const wrapper = await mountPrompt(closedInfo())

    await wrapper.find('.starred-share-mini-btn').trigger('click')
    await flushPromises()

    expect(mocks.post).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.starred-share-mini-entry').exists()).toBe(true)
    expect(wrapper.find('.starred-share-status').exists()).toBe(false)
  })

  it('falls back to an error toast when copying fails', async () => {
    mocks.copyText.mockRejectedValueOnce(new Error('denied'))
    const wrapper = await mountPrompt(openInfo())

    await wrapper.find('.starred-share-icon-btn').trigger('click')
    await flushPromises()

    expect(mocks.toastShow).toHaveBeenCalledWith({ text: 'Operation failed', type: 'error' })
    expect(mocks.cursorShow).not.toHaveBeenCalled()
  })

  it('hides the card and mini entry if the owner contract has no code', async () => {
    const wrapper = await mountPrompt(openInfo({ collection_code: '', status: 0 }))
    expect(wrapper.find('.starred-share-prompt').exists()).toBe(false)
    expect(wrapper.find('.starred-share-mini-entry').exists()).toBe(false)
  })

  it('keeps the mini entry strictly single-line at narrow widths', () => {
    const source = readFileSync(resolve(process.cwd(), 'app/components/BookmarkList/StarredSharePrompt.vue'), 'utf8')
    const promptRule = source.match(/\.starred-share-prompt\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
    const miniRule = source.match(/\.starred-share-mini-entry\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
    const copyRule = source.match(/\.starred-share-mini-copy\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
    const btnRule = source.match(/\.starred-share-mini-btn\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''

    expect(promptRule).not.toContain('display: none')
    expect(miniRule).not.toContain('display: none')
    expect(miniRule).not.toContain('flex-wrap')
    expect(miniRule).not.toContain('justify-content')
    expect(miniRule).toContain('gap: 10px')
    expect(miniRule).toContain('line-height: 1')
    expect(copyRule).toContain('flex: 0 1 auto')
    expect(copyRule).not.toContain('flex: 1 1 auto')
    expect(copyRule).toContain('min-width: 0')
    expect(copyRule).toContain('overflow: hidden')
    expect(copyRule).toContain('text-overflow: ellipsis')
    expect(copyRule).toContain('white-space: nowrap')
    expect(btnRule).toContain('flex: none')
    expect(btnRule).toContain('white-space: nowrap')
    expect(source).not.toContain('white-space: normal')
    expect(source).toContain('@media (max-width: 768px)')
    expect(source).toContain('@media (max-width: 520px)')
    expect(source).toContain('grid-template-columns: minmax(0, 1fr)')
    expect(source).not.toContain('starred-share-cta')
    expect(source).not.toContain('starred-share-dismiss')
    expect(source).not.toContain('useStorage')
    expect(source).toContain(':deep(.cursor-toast-container)')
    expect(source).not.toContain(':global(.cursor-toast-container)')
  })

  it('uses the concise first-star cue and mini copy in both locales', () => {
    type ShareCopy = {
      page: {
        bookmarks_index: {
          starred_share: {
            first_star_cue: string
            view_collection: string
            view_starred: string
            default_desc: string
            mini_copy: string
            mini_cta: string
          }
        }
      }
    }
    const en = JSON.parse(readFileSync(resolve(process.cwd(), 'i18n/locales/en.json'), 'utf8')) as ShareCopy
    const zh = JSON.parse(readFileSync(resolve(process.cwd(), 'i18n/locales/zh.json'), 'utf8')) as ShareCopy

    expect(en.page.bookmarks_index.starred_share.first_star_cue).toBe('Star added to collection')
    expect(en.page.bookmarks_index.starred_share.view_starred).toBe('View starred')
    expect(en.page.bookmarks_index.starred_share.view_collection).toBe('View collection')
    expect(en.page.bookmarks_index.starred_share.default_desc).toBe(
      'Starred items automatically form a recommendation page you can share with a link.'
    )
    expect(en.page.bookmarks_index.starred_share.mini_copy).toBe('Your stars can help others discover great content')
    expect(en.page.bookmarks_index.starred_share.mini_cta).toBe('Reopen collection')

    expect(zh.page.bookmarks_index.starred_share.first_star_cue).toBe('已加入星标合集')
    expect(zh.page.bookmarks_index.starred_share.view_starred).toBe('去星标页看看')
    expect(zh.page.bookmarks_index.starred_share.view_collection).toBe('查看合集')
    expect(zh.page.bookmarks_index.starred_share.default_desc).toBe('星标会自动组成推荐阅读页，可复制链接分享。')
    expect(zh.page.bookmarks_index.starred_share.mini_copy).toBe('你的星标也能帮别人发现好内容')
    expect(zh.page.bookmarks_index.starred_share.mini_cta).toBe('重新开启合集')
  })
})
