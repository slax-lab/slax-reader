import { defineComponent, h, inject } from 'vue'

import BookmarkArticleLocalFirst from '~/components/Article/BookmarkArticleLocalFirst.vue'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { DwebHttpClient } from '~/components/Article/Selection/adapters'
import { LocalFirstHttpClient } from '~/components/Article/Selection/adapters/LocalFirstHttpClient'
import { type ArticleSelectionAdapters,ArticleSelectionAdaptersKey } from '~/components/Article/Selection/injection'
import { mountWithApp } from '~~/tests/setup/mount'
import { describe, expect, it, vi } from 'vitest'

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

describe('BookmarkArticleLocalFirst adapters for a late local database', () => {
  it('keeps the blocking-startup behavior: local marks and local tags', () => {
    mountWith({ localFirst: true })
    expect(adapters?.httpClient()).toBeInstanceOf(LocalFirstHttpClient)
    expect(adapters?.tagsDataSource).toBe('local')
    expect(adapters?.tagsBookmarkUuid).toBe('bm-1')
  })

  it('writes marks locally but keeps tags on REST when the database arrived after setup', () => {
    const database = {} as never
    mountWith({ localFirst: true, localDatabase: database, localTags: false })
    const client = adapters?.httpClient()
    expect(client).toBeInstanceOf(LocalFirstHttpClient)
    expect((client as unknown as { database?: unknown }).database).toEqual(database)
    expect(adapters?.tagsDataSource).toBe('rest')
    expect(adapters?.tagsBookmarkUuid).toBe('')
  })

  it('uses REST for everything before the switch', () => {
    mountWith({ localFirst: false })
    expect(adapters?.httpClient()).toBeInstanceOf(DwebHttpClient)
    expect(adapters?.tagsDataSource).toBe('rest')
  })
})
