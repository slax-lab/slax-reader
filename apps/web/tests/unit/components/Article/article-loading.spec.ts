import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import BookmarkArticle from '~/components/Article/BookmarkArticle.vue'
import { mountWithApp } from '~~/tests/setup/mount'

const config = vi.hoisted(() => ({ lcp: { articleImagePriority: true, anonymousPublicStartup: false } }))
mockNuxtImport('useAppConfig', () => () => config)
vi.mock('~/components/Article/CEComponents', () => ({ registerComponents: vi.fn() }))
vi.mock('~/composables/bookmark/useArticle', () => ({
  useArticleDetail: () => ({ bookmarkId: 1, title: ref('Synthetic article'), allowTagged: ref(false), allowAction: ref(false), bookmarkUserId: ref(1), updateStarred: ref(undefined) })
}))
vi.mock('~/composables/bookmark/useArticleSelection', () => ({
  useArticleSelection: () => ({ articleSelectionRef: ref(null), handleHTML: vi.fn(), findQuote: vi.fn(), cleanup: vi.fn() })
}))

const wrappers: ReturnType<typeof mountWithApp>[] = []
const detail = (content: string, extra = {}) => ({ content, title: 'Synthetic article', ...extra })
function mountArticle(content: string, extra = {}) {
  const wrapper = mountWithApp(BookmarkArticle, {
    props: { detail: detail(content, extra) },
    global: { stubs: { BookmarkTags: true, SnapshotArticleFooter: true, SnapshotArticleSource: true, PdfDocumentSource: true, ClientOnly: true } }
  })
  wrappers.push(wrapper)
  return wrapper
}
beforeEach(() => { config.lcp.articleImagePriority = true })
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()) })

describe('BookmarkArticle loading policy integration', () => {
  it('renders the candidate before mounted processors and recomputes it on a refreshed body', async () => {
    const wrapper = mountArticle('<img class="avatar" src="avatar.png"><img src="first.png"><img src="later.png">')
    expect(wrapper.find('img[src="first.png"]').attributes()).toMatchObject({ loading: 'eager', fetchpriority: 'high' })
    expect(wrapper.find('img[src="avatar.png"]').attributes('loading')).toBe('lazy')
    await wrapper.setProps({ detail: detail('<p>' + 'x'.repeat(600) + '</p><img src="late.png">') })
    expect(wrapper.find('[fetchpriority="high"]').exists()).toBe(false)
    expect(wrapper.find('img').attributes('loading')).toBe('lazy')
  })

  it('retains the previous blanket loading path when disabled', () => {
    config.lcp.articleImagePriority = false
    const wrapper = mountArticle('<img src="first.png">')
    expect(wrapper.find('img').attributes('loading')).toBe('lazy')
    expect(wrapper.find('[fetchpriority]').exists()).toBe(false)
  })

  it('selects the same hero for class-isolated SSR content and raw SPA content', () => {
    for (const prefix of ['', 'oc-']) {
      const wrapper = mountArticle(`<div class="tweet"><div class="tweet-header"><img src="header.png"></div><img class="${prefix}avatar" src="avatar.png"><img src="hero.png"></div>`)
      expect(wrapper.findAll('[fetchpriority="high"]').map(img => img.attributes('src'))).toEqual(['hero.png'])
    }
  })

  it('preserves the signed source, dimensions and anchors', () => {
    const wrapper = mountArticle('<p id="mark-anchor">Lead</p><img src="/image?sig=synthetic%2Ftoken&amp;e=123" style="width:100%" width="1200" height="600">')
    expect(wrapper.find('img').attributes()).toMatchObject({ src: '/image?sig=synthetic%2Ftoken&e=123', width: '1200', height: '600', style: 'width:100%' })
    expect(wrapper.find('#mark-anchor').text()).toBe('Lead')
  })

  it('retains PhotoSwipe fallback and does not render an HTML body for PDFs', () => {
    const photo = mountArticle('<slax-photo-swipe-topic><img src="topic.png"></slax-photo-swipe-topic>')
    expect(photo.find('img').attributes('loading')).toBe('lazy')
    expect(photo.find('[fetchpriority]').exists()).toBe(false)
    const pdf = mountArticle('<img src="should-not-render.png">', { type: 'pdf' })
    expect(pdf.find('.html-text').exists()).toBe(false)
    expect(pdf.find('img').exists()).toBe(false)
  })
})
