import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { renderToString } from '@vue/server-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, createSSRApp, h, nextTick, reactive, ref, type App } from 'vue'
import BookmarkArticle from '~/components/Article/BookmarkArticle.vue'

mockNuxtImport('useAppConfig', () => () => ({ lcp: { articleImagePriority: true } }))
mockNuxtImport('useI18n', () => () => ({ t: (key: string) => key }))
vi.mock('~/components/Article/CEComponents', () => ({ registerComponents: vi.fn() }))
vi.mock('~/components/BookmarkTags.vue', () => ({ default: { render: () => null } }))
vi.mock('~/components/Snapshot/SnapshotArticleFooter.vue', () => ({ default: { render: () => null } }))
vi.mock('~/components/Snapshot/SnapshotArticleSource.vue', () => ({ default: { render: () => null } }))
vi.mock('~/components/Snapshot/SnapshotForkAttribution.vue', () => ({ default: { render: () => null } }))
vi.mock('~/composables/bookmark/useArticle', () => ({
  useArticleDetail: () => ({ bookmarkId: 1, title: ref('Article'), allowTagged: ref(false), allowAction: ref(false), bookmarkUserId: ref(1), updateStarred: ref(undefined) })
}))
vi.mock('~/composables/bookmark/useArticleSelection', () => ({
  useArticleSelection: () => ({ articleSelectionRef: ref(null), handleHTML: vi.fn(), findQuote: vi.fn(), cleanup: vi.fn() })
}))

const apps: App[] = []
const body = '<h2 id="chapter">A chapter</h2><p>Readable article text</p><img src="https://fixtures.invalid/cover.png" width="800" height="400">'
const detail = (content: string) => ({ content, title: 'Article' }) as BookmarkArticleDetail

async function hydrate(serverBody = body, clientBody = serverBody) {
  const server = createSSRApp({ render: () => h(BookmarkArticle, { detail: detail(serverBody), footerVia: '' }) })
  const html = await renderToString(server)
  const container = document.createElement('div')
  container.innerHTML = html
  document.body.append(container)
  const root = container.querySelector('.html-text')!
  if (serverBody) expect(root.textContent).toContain('A chapter')
  const originalText = root.querySelector('p')?.firstChild
  const originalImage = root.querySelector('img')
  const props = reactive({ detail: detail(clientBody), footerVia: '', bodyKey: 0 })
  const warnings: string[] = []
  const app = createSSRApp({ render: () => h(BookmarkArticle, { detail: props.detail, footerVia: props.footerVia, key: props.bodyKey }) })
  app.config.warnHandler = message => warnings.push(message)
  apps.push(app)
  app.mount(container)
  await nextTick()
  expect(warnings).toEqual([])
  return { container, root, originalText, originalImage, props }
}

afterEach(() => {
  apps.splice(0).forEach(app => app.unmount())
  vi.restoreAllMocks()
})

describe('article body hydration', () => {
  it('keeps the complete SSR body and its original text and image nodes', async () => {
    const { root, originalText, originalImage } = await hydrate()
    expect(originalText).not.toBeNull()
    expect(originalImage).not.toBeNull()
    expect(root.querySelector('p')!.firstChild).toBe(originalText)
    expect(root.querySelector('img')).toBe(originalImage)
    expect(root.querySelector('#chapter')).not.toBeNull()
  })

  it.each([body.replace('Readable article text', 'Updated article text'), ''])('reconciles a different initial client body', async content => {
    const { root } = await hydrate(body, content)
    expect(root.textContent).toBe(content ? 'A chapterUpdated article text' : '')
  })

  it('preserves processed marks and image handlers on unrelated updates, then replaces and clears real content', async () => {
    const { root, props, container } = await hydrate()
    const mark = document.createElement('mark')
    mark.textContent = 'Readable article text'
    root.querySelector('p')!.replaceChildren(mark)
    const image = root.querySelector('img')!
    const preview = vi.fn()
    image.addEventListener('click', preview)
    props.footerVia = 'Changed attribution'
    await nextTick()
    expect(root.querySelector('mark')).toBe(mark)
    root.querySelector('img')!.click()
    expect(preview).toHaveBeenCalledOnce()
    props.detail = detail('<h2 id="replacement">Replacement</h2>')
    await nextTick()
    expect(root.innerHTML).toBe('<h2 id="replacement">Replacement</h2>')
    props.detail = detail('')
    await nextTick()
    expect(root.innerHTML).toBe('')
    props.detail = detail(body)
    props.bodyKey++
    await nextTick()
    expect(root.isConnected).toBe(false)
    expect(container.querySelector('#chapter')!.textContent).toBe('A chapter')
    expect(container.querySelector('.html-text p')!.textContent).toBe('Readable article text')
    expect(container.querySelector('img')!.getAttribute('src')).toBe('https://fixtures.invalid/cover.png')
  })

  it('renders a fresh client-side article', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const app = createApp({ render: () => h(BookmarkArticle, { detail: detail(body) }) })
    apps.push(app)
    app.mount(container)
    await nextTick()
    expect(container.querySelector('#chapter')!.textContent).toBe('A chapter')
    expect(container.querySelector('img')!.getAttribute('src')).toBe('https://fixtures.invalid/cover.png')
  })
})
