import { afterEach, describe, expect, it, vi } from 'vitest'
import { getWebSiteInfo } from '../src/utils/website'

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('Reader snapshot collection', () => {
  it('keeps the Reader tab URL and avoids uploading its presentation shell', () => {
    vi.stubEnv('PUBLIC_BASE_URL', 'https://reader.test')
    const href = 'https://reader.test/b/1ac0b3d6-3b65-4d6b-8412-6dcccb903adc?shared=1'
    const cloneNode = vi.fn(() => ({ getElementsByTagName: () => [], documentElement: { outerHTML: 'Reader shell' } }))
    vi.stubGlobal('window', { location: { href } })
    vi.stubGlobal('document', { title: 'Reader article', querySelector: () => null, cloneNode })
    expect(getWebSiteInfo()).toMatchObject({ target_url: href, content: '' })
    expect(cloneNode).not.toHaveBeenCalled()
  })
})
