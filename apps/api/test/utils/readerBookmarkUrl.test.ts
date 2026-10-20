import { describe, expect, test } from 'vitest'
import { parseReaderBookmarkUrl } from '@/utils/readerBookmarkUrl'

const front = 'https://reader.example.com'
const env = { FRONT_END_URL: front }
const uuid = '123e4567-e89b-42d3-a456-426614174000'
const url = `${front}/b/${uuid}`

describe('Reader bookmark URL recognition', () => {
  test('selects a source UUID only from the configured canonical origin', () => {
    expect(parseReaderBookmarkUrl(url, env)).toEqual({ bookmarkUid: uuid, canonicalUrl: url })
  })

  test('supports an explicitly configured development origin and port', () => {
    const canonicalUrl = `http://localhost:3000/b/${uuid}`
    expect(parseReaderBookmarkUrl(canonicalUrl, { FRONT_END_URL: 'http://localhost:3000/' })).toEqual({ bookmarkUid: uuid, canonicalUrl })
  })

  test.each([
    `${front}.evil.test/b/${uuid}`,
    `https://evil.test/b/${uuid}`,
    `http://reader.example.com/b/${uuid}`,
    `https://reader.example.com:8443/b/${uuid}`,
    `https://reader.example.com:443/b/${uuid}`,
    `https://name:password@reader.example.com/b/${uuid}`,
    `https://reader.example.com@evil.test/b/${uuid}`,
    `https://READER.example.com/b/${uuid}`,
    `https://reader.example.com./b/${uuid}`,
    `https://%72eader.example.com/b/${uuid}`,
    `https://r.slax.com/b/${uuid}`
  ])('does not grant Reader identity to an alternate authority: %s', value => {
    expect(parseReaderBookmarkUrl(value, env)).toBeNull()
  })

  test.each([
    `${url}/`,
    `${url}/extra`,
    `${front}/B/${uuid}`,
    `${front}//b/${uuid}`,
    `${front}/%62/${uuid}`,
    `${front}/other/../b/${uuid}`,
    `${front}/other/%2e%2e/b/${uuid}`,
    `${front}/b/%31${uuid.slice(1)}`,
    `${front}\\b\\${uuid}`,
    `${url}?source=share`,
    `${url}?bookmark_uid=another-uuid`,
    `${url}?`,
    `${url}#article`,
    `${url}#`,
    `${url}\n`,
    ` ${url}`,
    `//reader.example.com/b/${uuid}`,
    `reader.example.com/b/${uuid}`
  ])('does not normalize malformed paths into a Reader source: %s', value => {
    expect(parseReaderBookmarkUrl(value, env)).toBeNull()
  })

  test.each([
    'not-a-uuid',
    uuid.toUpperCase(),
    uuid.slice(0, -1),
    `${uuid}0`,
    '00000000-0000-0000-0000-000000000000',
    '123e4567-e89b-92d3-a456-426614174000',
    '123e4567-e89b-42d3-0456-426614174000'
  ])('rejects a noncanonical source UUID: %s', value => {
    expect(parseReaderBookmarkUrl(`${front}/b/${value}`, env)).toBeNull()
  })

  test.each(['', 'garbage', 'javascript:alert(1)', 'https://name:password@reader.example.com', `${front}?secret=1`, `${front}#fragment`])(
    'fails closed for invalid deployment configuration: %s', FRONT_END_URL => {
      expect(parseReaderBookmarkUrl(url, { FRONT_END_URL })).toBeNull()
    }
  )

  test.each([`${front}/s/Share123`, 'https://example.com/article', 'javascript:alert(1)', ''])('leaves ordinary URLs outside Reader recognition: %s', value => {
    expect(parseReaderBookmarkUrl(value, env)).toBeNull()
  })

  test('has no operation state, so a retry selects the identical source', () => {
    const first = parseReaderBookmarkUrl(url, env)
    expect(parseReaderBookmarkUrl(url, env)).toEqual(first)
  })
})
