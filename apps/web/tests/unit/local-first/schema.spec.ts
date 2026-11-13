/* eslint-disable camelcase */
import { AppSchema, sr_user_tag } from '~~/app/local-first/schema'
import { describe, expect, it } from 'vitest'

describe('local-first schema: sr_user_tag', () => {
  it('declares ownership and recency columns so the synced values are queryable', () => {
    const names = sr_user_tag.columns.map(c => c.name)
    expect(names).toEqual(expect.arrayContaining(['tag_name', 'display', 'source', 'last_used_at', 'created_at']))
  })

  it('is registered in the app schema', () => {
    expect(AppSchema.tables.some(t => t.name === 'sr_user_tag')).toBe(true)
  })
})

describe('local-first Newsletter metadata', () => {
  it('exposes a separate metadata table without message body or internal content references', () => {
    const table = AppSchema.tables.find(t => t.name === 'sr_newsletter_feed')
    expect(table).toBeDefined()
    expect(table!.columns.map(column => column.name)).toEqual(expect.arrayContaining(['source_key', 'sender', 'sender_name', 'title', 'excerpt', 'published_at', 'received_at']))
    expect(table!.columns.map(column => column.name)).not.toEqual(expect.arrayContaining(['content_key']))
  })
})
