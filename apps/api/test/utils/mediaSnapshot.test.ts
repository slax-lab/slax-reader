import { describe, expect, it } from 'vitest'
import { freezeMediaSnapshot, parseMediaSnapshot, privateMediaVersion, canSettleMedia, type MediaSnapshot } from '@/utils/mediaSnapshot'

const capture = (): MediaSnapshot => ({
  schema: 1,
  kind: 'youtube',
  mode: 'capture',
  revision: 'source',
  sourceId: 'video',
  sourceHash: 'captions',
  inputFingerprint: 'inputs',
  defaultLanguage: 'en',
  transcript: 'ready',
  bodyLanguage: null,
  variants: { en: { status: 'ready', content: { language: 'en', format: 'article', lede: 'saved', sections: [] } }, zh: { status: 'pending' } }
})

describe('private media snapshots', () => {
  it('freezes only ready variants and gives the destination independent version tokens', () => {
    const before = capture()
    const fork = freezeMediaSnapshot(before, 'destination')
    expect(fork.variants.zh.status).toBe('unavailable')
    expect(fork.variants.en.content?.lede).toBe('saved')
    expect(privateMediaVersion(fork, 'en')).not.toBe(privateMediaVersion(before, 'en'))
    expect(before.variants.zh.status).toBe('pending')
  })

  it('keeps a transcript body even when the source has a ready fallback article', () => {
    expect(freezeMediaSnapshot(capture(), 'fork').bodyLanguage).toBeNull()
  })

  it('settles only the matching pending capture, never a frozen or terminal variant', () => {
    const current = capture()
    expect(canSettleMedia(current, 'zh', 'inputs')).toBe(true)
    expect(canSettleMedia(current, 'en', 'inputs')).toBe(false)
    expect(canSettleMedia(current, 'zh', 'other-input')).toBe(false)
    expect(canSettleMedia(freezeMediaSnapshot(current, 'fork'), 'zh', 'inputs')).toBe(false)
  })

  it('fails closed on missing or malformed managed sidecars', () => {
    for (const invalid of [null, {}, { schema: 1, kind: 'youtube' }, { ...capture(), variants: { en: { status: 'ready' } } }]) {
      expect(() => parseMediaSnapshot(invalid)).toThrow()
    }
    expect(parseMediaSnapshot({ schema: 1, kind: 'html' })).toBeNull()
    expect(parseMediaSnapshot(capture())).toEqual(capture())
  })
})
