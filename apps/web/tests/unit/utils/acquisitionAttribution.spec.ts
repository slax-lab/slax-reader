import { acquisitionAttributionFromQuery, acquisitionUtmQuery } from '~~/app/utils/acquisitionAttribution'

import { describe, expect, it } from 'vitest'

describe('acquisitionAttributionFromQuery', () => {
  it.each(['header', 'resource_detail'] as const)('accepts the complete supported triplet for %s', medium => {
    const query = { utm_source: 'hackerlinks', utm_campaign: 'mvp', utm_medium: medium, utm_content: 'zh' }
    expect(acquisitionAttributionFromQuery(query)).toEqual({ source: 'hackerlinks', campaign: 'mvp', medium })
    expect(acquisitionUtmQuery(query)).toEqual({ utm_source: 'hackerlinks', utm_campaign: 'mvp', utm_medium: medium })
  })

  it.each([
    {},
    { utm_source: 'hackerlinks', utm_campaign: 'mvp' },
    { utm_source: 'other', utm_campaign: 'mvp', utm_medium: 'header' },
    { utm_source: 'hackerlinks', utm_campaign: 'other', utm_medium: 'header' },
    { utm_source: 'hackerlinks', utm_campaign: 'mvp', utm_medium: 'other' },
    { utm_source: ['hackerlinks'], utm_campaign: 'mvp', utm_medium: 'header' },
    { utm_source: 'hackerlinks', utm_campaign: ['mvp'], utm_medium: 'header' },
    { utm_source: 'hackerlinks', utm_campaign: 'mvp', utm_medium: ['header'] }
  ])('returns no attribution for incomplete, unsupported, or ambiguous input: %j', query => {
    expect(acquisitionAttributionFromQuery(query)).toBeUndefined()
    expect(acquisitionUtmQuery(query)).toEqual({})
  })

  it('does not retain a previous attempt or unrelated query values', () => {
    expect(acquisitionAttributionFromQuery({ utm_source: 'hackerlinks', utm_campaign: 'mvp', utm_medium: 'header' })).toBeDefined()
    expect(acquisitionAttributionFromQuery({ redirect: 'https://example.test/?utm_source=hackerlinks', resource_url: 'https://example.test/private' })).toBeUndefined()
  })
})
