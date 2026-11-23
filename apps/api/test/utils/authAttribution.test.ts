import { describe, expect, test } from 'vitest'
import { parseAppleAuthAttribution, parseWebAuthAttribution } from '@/utils/authAttribution'

const id = 'b1e2c3d4-0000-4000-8000-123456789abc'
const collection = { collection_id: 'abc123', source_screen: 'collection', presentation: 'modal', trigger_element_id: 'collection_subscribe_button' }
const snapshot = { source_screen: 'detail', presentation: 'modal', trigger_element_id: 'snapshot_save_button', source_bookmark_id: id }
const acquisition = { source: 'hackerlinks', medium: 'header', campaign: 'mvp' }

describe('auth attribution parsing', () => {
  test.each([collection, snapshot, acquisition, { ...acquisition, medium: 'resource_detail' }, { ...snapshot, source_bookmark_id: id.toUpperCase() }])(
    'Web accepts %j unchanged',
    value => {
      expect(parseWebAuthAttribution(value)).toEqual(value)
    }
  )

  test('unknown keys are dropped, never forwarded', () => {
    expect(parseWebAuthAttribution({ ...collection, extra: 'leak' })).toEqual(collection)
    expect(parseWebAuthAttribution({ ...acquisition, collection_id: 'x' })).toEqual(acquisition)
  })

  test('the first matching shape wins when an input satisfies two', () => {
    expect(parseWebAuthAttribution({ ...collection, ...acquisition })).toEqual(collection)
    expect(parseWebAuthAttribution({ ...acquisition, ...snapshot })).toEqual(snapshot)
  })

  test.each([
    undefined,
    null,
    'collection',
    [],
    [collection],
    {},
    { ...collection, collection_id: '' },
    { ...collection, collection_id: 'a'.repeat(65) },
    { ...collection, collection_id: 'ab-12' },
    { ...collection, collection_id: 12 },
    { ...collection, presentation: 'page' },
    { ...snapshot, source_bookmark_id: 'nope' },
    { ...snapshot, source_bookmark_id: 5 },
    { ...acquisition, medium: 'other' }
  ])('Web rejects %j', value => {
    expect(parseWebAuthAttribution(value)).toBeUndefined()
  })

  test('the 64-character collection ID boundary is accepted', () => {
    expect(parseWebAuthAttribution({ ...collection, collection_id: 'a'.repeat(64) })?.collection_id).toHaveLength(64)
  })

  test('Apple accepts snapshot and acquisition shapes only', () => {
    expect(parseAppleAuthAttribution(snapshot)).toEqual(snapshot)
    expect(parseAppleAuthAttribution(acquisition)).toEqual(acquisition)
    expect(parseAppleAuthAttribution(collection)).toBeUndefined()
  })
})
