// useLocalBookmarks：本地 SQL 的形状（多标签交集、未打标签、候选词、词表排序、写入来源）
// 注意：不用 mockNuxtImport('useNuxtApp')，那会把 @nuxt/test-utils 的运行时钩子一起换掉；
// 这里直接往真实 nuxtApp 上 provide 一个 $powersync 桩。
import { computed, ref } from 'vue'

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUseQuery, queryCalls } = vi.hoisted(() => {
  const queryCalls: { sql: any; params: any }[] = []
  return {
    queryCalls,
    mockUseQuery: vi.fn((sql: any, params: any) => {
      queryCalls.push({ sql, params })
      return { data: ref<any[]>([]), isLoading: ref(false) }
    })
  }
})

vi.mock('@powersync/vue', () => ({ useQuery: mockUseQuery }))

// $powersync 是 nuxtApp 上不可重定义的 getter，mockNuxtImport('useNuxtApp') 又会连 test-utils 自己的钩子一起换掉，
// 所以这里不碰它：读路径只经过 useQuery（已 mock），写路径用源码文本断言兜底
import { useLocalBookmarks } from '~~/app/composables/bookmark/useLocalBookmarks'

const unwrap = (v: any) => (v && typeof v === 'object' && 'value' in v ? v.value : v)
const lastQuery = () => {
  const q = queryCalls[queryCalls.length - 1]
  return { sql: unwrap(q.sql) as string, params: unwrap(q.params) as unknown[] }
}

beforeEach(() => {
  queryCalls.length = 0
  mockUseQuery.mockClear()
  })

describe('composables/bookmark/useLocalBookmarks', () => {
  it('watchList topics builds one EXISTS per selected tag and passes the ids as params', () => {
    const local = useLocalBookmarks()
    const ids = ref(['a', 'b'])
    local.watchList(computed(() => 'topics'), ids)
    const { sql, params } = lastQuery()
    expect(sql.match(/EXISTS \(SELECT 1 FROM json_each/g)).toHaveLength(2)
    expect(sql).toContain('deleted_at IS NULL')
    expect(params).toEqual(['a', 'b'])

    ids.value = ['a']
    expect(lastQuery().sql.match(/EXISTS \(SELECT 1 FROM json_each/g)).toHaveLength(1)
    expect(lastQuery().params).toEqual(['a'])
  })

  it('watchList topics with no selection selects nothing', () => {
    const local = useLocalBookmarks()
    local.watchList(computed(() => 'topics'), ref([]))
    expect(lastQuery().sql).toContain('WHERE 0')
    expect(lastQuery().params).toEqual([])
  })

  it('watchList untagged filters on an empty or missing metadata.tags', () => {
    const local = useLocalBookmarks()
    local.watchList(computed(() => 'untagged'))
    const { sql } = lastQuery()
    expect(sql).toContain("json_array_length(JSON_EXTRACT(metadata, '$.tags')), 0) = 0")
    expect(sql).toContain('ORDER BY created_at DESC')
  })

  it('list rows carry metadata.tags so cards can show chips', () => {
    const local = useLocalBookmarks()
    local.watchList(computed(() => 'inbox'))
    expect(lastQuery().sql).toContain("JSON_EXTRACT(metadata, '$.tags')                        AS m_tags")
  })

  it('watchUserTags selects ownership and recency, orders used-first, keeps only display rows, mine first', () => {
    const local = useLocalBookmarks()
    const { tags } = local.watchUserTags()
    const q = queryCalls[0]
    expect(unwrap(q.sql)).toContain('SELECT id, tag_name, display, source, last_used_at FROM sr_user_tag')
    expect(unwrap(q.sql)).toContain('ORDER BY (last_used_at IS NULL), last_used_at DESC, created_at DESC')

    const data = mockUseQuery.mock.results[0].value.data
    data.value = [
      { id: 'u1', tag_name: 'auto-recent', display: '1', source: 'auto', last_used_at: '2026-02-01' },
      { id: 'u2', tag_name: 'hidden', display: '0', source: 'mine', last_used_at: null },
      { id: 'u3', tag_name: 'mine-old', display: '1', source: 'mine', last_used_at: '2026-01-01' },
      { id: 'u3', tag_name: 'dupe', display: '1', source: 'mine', last_used_at: null }
    ]
    expect(tags.value.map(t => [t.id, t.source, t.id_kind])).toEqual([
      ['u3', 'mine', 'uuid'],
      ['u1', 'auto', 'uuid']
    ])
  })

  it('watchCandidateTags counts tags inside the intersection, excludes the selected ones, joins names from the vocabulary', () => {
    const local = useLocalBookmarks()
    const { candidates } = local.watchCandidateTags(ref(['a', 'b']))
    const countQuery = queryCalls[0]
    const sql = unwrap(countQuery.sql) as string
    expect(sql).toContain('GROUP BY je.value')
    expect(sql).toContain('je.value NOT IN (?, ?)')
    expect(sql.match(/EXISTS \(SELECT 1 FROM json_each/g)).toHaveLength(2)
    expect(sql).not.toContain('sr_user_bookmark.metadata')
    expect(unwrap(countQuery.params)).toEqual(['a', 'b', 'a', 'b'])

    mockUseQuery.mock.results[0].value.data.value = [
      { id: 'c', count: 3 },
      { id: 'd', count: 1 }
    ]
    mockUseQuery.mock.results[1].value.data.value = [
      { id: 'd', tag_name: 'dd', display: '1', source: 'auto' },
      { id: 'c', tag_name: 'cc', display: '1', source: 'mine' },
      { id: 'x', tag_name: 'xx', display: '1', source: 'auto' }
    ]
    expect(candidates.value.map(t => [t.show_name, t.count])).toEqual([
      ['cc', 3],
      ['dd', 1]
    ])
  })

  it('createUserTag writes source=mine locally', () => {
    const src = readFileSync(resolve(process.cwd(), 'app/composables/bookmark/useLocalBookmarks.ts'), 'utf8')
    expect(src).toContain('INSERT INTO sr_user_tag (id, user_id, tag_name, display, source, created_at)')
    expect(src).toMatch(/\[id, '', tagName, '1', 'mine', nowIso\(\)\]/)
    expect(src).toContain("source: 'mine', last_used_at: null, display: true")
  })
})
