import { afterEach, describe, expect, it, vi } from 'vitest'
import { UrlParserHandler } from '@/domain/orchestrator/urlParser'
import { SlaxFetch } from '@/infra/external/remoteFetcher'
import { parserType } from '@/utils/urlPolicie'
import type { parseMessage } from '@/infra/queue/queueClient'

const targetUrl = 'https://x.com/a?a=1&b=2'
afterEach(() => vi.restoreAllMocks())

describe('legacy parser acquisition URL', () => {
  it.each([parserType.SERVER_FETCH_PARSE, parserType.SERVER_PUPPETEER_PARSE])('cleans the fetch URL without changing the save identity (parser=%s)', async type => {
    const response = { content: '<article>body</article>', url: 'https://x.com/a', title: 'Article' }
    const http = vi.spyOn(SlaxFetch.prototype, 'http').mockResolvedValue(response)
    const headless = vi.spyOn(SlaxFetch.prototype, 'headless').mockResolvedValue(response)
    const message = { targetUrl, parserType: type, resource: '' } as parseMessage
    expect(await UrlParserHandler.fetchContent({} as Env, message)).toEqual(response)
    if (type === parserType.SERVER_FETCH_PARSE) expect(http).toHaveBeenCalledWith('https://x.com/a', 'Asia/Hong_Kong')
    else expect(headless).toHaveBeenCalledWith('https://x.com/a')
    expect(message.targetUrl).toBe(targetUrl)
  })

  it('keeps the original URL when parsing client-supplied HTML', async () => {
    const message = { targetUrl, parserType: parserType.CLIENT_PARSE, resource: '<article>body</article>' } as parseMessage
    expect(await UrlParserHandler.fetchContent({} as Env, message)).toEqual({ content: '<article>body</article>', url: targetUrl, title: '' })
  })
})
