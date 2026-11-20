import type { PowerSyncDatabase, SQLOnChangeOptions, WatchOnChangeEvent, WatchOnChangeHandler } from '@powersync/web'
import { deferLiveQueriesWhileHidden } from '~/local-first/powersync-visibility-gate'
import { describe, expect, it, vi } from 'vitest'

function fakeDocument(state: DocumentVisibilityState) {
  const listeners: Array<() => void> = []
  return {
    visibilityState: state,
    addEventListener: (_type: string, listener: () => void) => listeners.push(listener),
    set(next: DocumentVisibilityState) {
      this.visibilityState = next
      listeners.forEach(listener => listener())
    }
  }
}

function fakeDatabase() {
  const handlers: WatchOnChangeHandler[] = []
  const database = {
    onChangeWithCallback: vi.fn((handler?: WatchOnChangeHandler, options?: SQLOnChangeOptions) => {
      handlers.push(handler!)
      if (options?.triggerImmediate) void handler!.onChange({ changedTables: [] })
      return () => {}
    }),
    resolveTables: vi.fn(async () => ['notes'])
  }
  const emit = (event: WatchOnChangeEvent) => Promise.all(handlers.map(handler => handler.onChange(event)))
  return { database: database as unknown as PowerSyncDatabase, emit }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))
const settle = () => new Promise(resolve => setTimeout(resolve, 550))

describe('deferLiveQueriesWhileHidden', () => {
  it('runs changes immediately while the page is visible', async () => {
    const doc = fakeDocument('visible')
    const { database, emit } = fakeDatabase()
    deferLiveQueriesWhileHidden(database, doc)
    const onChange = vi.fn()
    database.onChangeWithCallback({ onChange }, { tables: ['notes'] })
    await emit({ changedTables: ['notes'] })
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('holds a change until the page becomes visible', async () => {
    const doc = fakeDocument('visible')
    const { database, emit } = fakeDatabase()
    deferLiveQueriesWhileHidden(database, doc)
    const onChange = vi.fn()
    database.onChangeWithCallback({ onChange })
    doc.set('hidden')
    const delivered = emit({ changedTables: ['notes'] })
    await flush()
    expect(onChange).not.toHaveBeenCalled()
    doc.set('visible')
    await delivered
    expect(onChange).toHaveBeenCalledWith({ changedTables: ['notes'] })
  })

  it('keeps holding changes when the page is shown only briefly', async () => {
    const doc = fakeDocument('hidden')
    const { database, emit } = fakeDatabase()
    deferLiveQueriesWhileHidden(database, doc)
    const onChange = vi.fn()
    database.onChangeWithCallback({ onChange })
    const delivered = emit({ changedTables: ['notes'] })
    doc.set('visible')
    await flush()
    doc.set('hidden')
    await settle()
    expect(onChange).not.toHaveBeenCalled()
    doc.set('visible')
    await delivered
    expect(onChange).toHaveBeenCalledOnce()
  })

  it('holds the initial query of a registration made while hidden until the page is shown', async () => {
    const doc = fakeDocument('hidden')
    const { database } = fakeDatabase()
    deferLiveQueriesWhileHidden(database, doc)
    const onChange = vi.fn()
    database.onChangeWithCallback({ onChange }, { triggerImmediate: true })
    await flush()
    expect(onChange).not.toHaveBeenCalled()
    doc.set('visible')
    await settle()
    expect(onChange).toHaveBeenCalledWith({ changedTables: [] })
  })

  it('releases every held change after repeated hide and show', async () => {
    const doc = fakeDocument('hidden')
    const { database, emit } = fakeDatabase()
    deferLiveQueriesWhileHidden(database, doc)
    const onChange = vi.fn()
    database.onChangeWithCallback({ onChange })
    const first = emit({ changedTables: ['a'] })
    doc.set('visible')
    await first
    doc.set('hidden')
    const second = emit({ changedTables: ['b'] })
    await flush()
    expect(onChange).toHaveBeenCalledTimes(1)
    doc.set('visible')
    await second
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('holds table resolution for a watched query while hidden', async () => {
    const doc = fakeDocument('hidden')
    const { database } = fakeDatabase()
    const original = database.resolveTables
    deferLiveQueriesWhileHidden(database, doc)
    const resolved = vi.fn()
    void database.resolveTables('SELECT * FROM notes').then(resolved)
    await flush()
    expect(original).not.toHaveBeenCalled()
    doc.set('visible')
    await settle()
    expect(resolved).toHaveBeenCalledWith(['notes'])
  })
})
