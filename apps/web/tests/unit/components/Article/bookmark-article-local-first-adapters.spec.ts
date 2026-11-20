import { defineComponent, h, inject } from 'vue'

import BookmarkArticleLocalFirst from '~/components/Article/BookmarkArticleLocalFirst.vue'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { DwebHttpClient } from '~/components/Article/Selection/adapters'
import { LocalFirstHttpClient } from '~/components/Article/Selection/adapters/LocalFirstHttpClient'
import { type ArticleSelectionAdapters, ArticleSelectionAdaptersKey } from '~/components/Article/Selection/injection'
import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, describe, expect, it, vi } from 'vitest'

mockNuxtImport('useAppConfig', () => () => ({ lcp: { articleImagePriority: false, anonymousPublicStartup: false } }))

let adapters: ArticleSelectionAdapters | undefined
const ArticleProbe = defineComponent({
  setup(_, { expose }) {
    adapters = inject(ArticleSelectionAdaptersKey)
    expose({ findQuote: vi.fn(), articleSelection: null })
    return () => h('div')
  }
})
const mountWith = (props: Record<string, unknown>) =>
  mountWithApp(BookmarkArticleLocalFirst, {
    props: { detail: { content: '', title: 't' }, bookmarkUuid: 'bm-1', localReady: true, isOwner: true, ...props },
    global: { stubs: { BookmarkArticle: ArticleProbe } }
  })
const restPost = vi.spyOn(DwebHttpClient.prototype, 'post').mockResolvedValue({ via: 'rest' } as never)
const localPost = vi.spyOn(LocalFirstHttpClient.prototype, 'post').mockResolvedValue({ via: 'local' } as never)
afterEach(() => {
  restPost.mockClear()
  localPost.mockClear()
})

describe('BookmarkArticleLocalFirst adapters for a late local database', () => {
  it('keeps the blocking-startup behavior: local marks and local tags', async () => {
    mountWith({ localFirst: true })
    await expect(adapters!.httpClient!().post({ url: '/v1/mark/create' })).resolves.toEqual({ via: 'local' })
    expect(adapters?.tagsDataSource).toBe('local')
    expect(adapters?.tagsBookmarkUuid).toBe('bm-1')
  })

  it('writes marks locally with the late database but keeps tags on REST', async () => {
    const database = { id: 'late' } as never
    mountWith({ localFirst: true, localDatabase: database, localTags: false })
    await adapters!.httpClient!().post({ url: '/v1/mark/create' })
    expect(localPost).toHaveBeenCalledOnce()
    expect((localPost.mock.contexts[0] as unknown as { database?: unknown }).database).toStrictEqual(database)
    expect(adapters?.tagsDataSource).toBe('rest')
    expect(adapters?.tagsBookmarkUuid).toBe('')
  })

  it('uses REST for everything before the switch', async () => {
    mountWith({ localFirst: false })
    await expect(adapters!.httpClient!().post({ url: '/v1/mark/create' })).resolves.toEqual({ via: 'rest' })
    expect(adapters?.tagsDataSource).toBe('rest')
  })

  it('moves writes to the local database when the page switches after the client was handed out', async () => {
    const wrapper = mountWith({ localFirst: false })
    // The selection layer captures the client once, on its first mark draw.
    const captured = adapters!.httpClient!()
    await captured.post({ url: '/v1/mark/create' })
    expect(restPost).toHaveBeenCalledOnce()

    await wrapper.setProps({ localFirst: true, localDatabase: { id: 'late' }, localTags: false })
    await captured.post({ url: '/v1/mark/create' })
    expect(localPost).toHaveBeenCalledOnce()
    expect(restPost).toHaveBeenCalledOnce()
  })
})
