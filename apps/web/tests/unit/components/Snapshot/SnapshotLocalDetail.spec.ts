import { defineComponent, h } from 'vue'

import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

const queries = vi.hoisted(() => ({ provided: [] as unknown[], marks: vi.fn(() => ({ marks: {}, isLoading: {} })), detail: vi.fn(() => ({ row: {} })) }))
vi.mock('@powersync/vue', () => ({ providePowerSync: (database: unknown) => queries.provided.push(database) }))
vi.mock('@/composables/bookmark/useLocalMarks', () => ({ useLocalMarks: () => ({ watchMarkDetail: queries.marks }) }))
vi.mock('@/composables/bookmark/useLocalBookmarks', () => ({ useLocalBookmarks: () => ({ watchDetail: queries.detail }) }))

const { default: SnapshotLocalDetail } = await import('~~/app/components/Snapshot/SnapshotLocalDetail.vue')

describe('SnapshotLocalDetail', () => {
  it('creates its queries against the late database and emits ready only after it has mounted', () => {
    const database = { name: 'late' }
    const events: string[] = []
    let readySources: { database: unknown } | null = null
    const Child = defineComponent({
      setup: () => () =>
        h(SnapshotLocalDetail, {
          database,
          bookmarkUuid: 'b-1',
          onReady: (sources: { database: unknown }) => {
            events.push('ready')
            readySources = sources
          },
          onVnodeBeforeMount: () => events.push('before-mount'),
          onVnodeMounted: () => events.push('mounted')
        })
    })
    mount(Child)
    expect(queries.provided).toEqual([database])
    expect(queries.marks).toHaveBeenCalledWith('b-1')
    expect(queries.detail).toHaveBeenCalledWith('b-1')
    expect(events).toEqual(['before-mount', 'ready', 'mounted'])
    expect(readySources!.database).toBe(database)
  })
})
