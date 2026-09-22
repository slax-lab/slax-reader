import { describe, test, expect, vi, beforeEach } from 'vitest'

import { OpenAIModerationClient, ModerationResult } from '../../src/infra/external/openaiModeration'

const ALL_FALSE = {
  harassment: false,
  'harassment/threatening': false,
  hate: false,
  'hate/threatening': false,
  illicit: false,
  'illicit/violent': false,
  'self-harm': false,
  'self-harm/instructions': false,
  'self-harm/intent': false,
  sexual: false,
  'sexual/minors': false,
  violence: false,
  'violence/graphic': false
}

const buildResponse = (overrides: Record<string, boolean>) => ({
  id: 'modr-test',
  model: 'omni-moderation-latest',
  results: [
    {
      flagged: true,
      categories: { ...ALL_FALSE, ...overrides },
      category_scores: Object.fromEntries(Object.keys(ALL_FALSE).map(key => [key, overrides[key] ? 0.99 : 0.01]))
    }
  ]
})

// 每次请求返回 200 + 指定 body；记录 fetch 入参用于断言
const fetchMock = vi.fn()
function mockFetchOnce(body: unknown, ok = true, status = 200) {
  fetchMock.mockResolvedValueOnce({
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  })
}

const env = { OPENAI_API_KEY: 'sk-test' } as unknown as Env

/** 取最近一次 fetch 调用的 (url, init) 与解析后的 body。 */
function lastCall() {
  const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]
  return { url, init, body: JSON.parse((init as RequestInit).body as string) }
}

describe('OpenAIModerationClient', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  test('普通内容 → 0', async () => {
    mockFetchOnce({ results: [{ flagged: false, categories: ALL_FALSE }] })
    const client = new OpenAIModerationClient(env)
    expect(await client.moderate('hello world')).toBe(ModerationResult.NORMAL)
  })

  test('色情内容 sexual → 1', async () => {
    mockFetchOnce(buildResponse({ sexual: true }))
    expect(await new OpenAIModerationClient(env).moderate('...')).toBe(ModerationResult.PORN)
  })

  test('儿童色情 sexual/minors → 2（优先于色情）', async () => {
    mockFetchOnce(buildResponse({ sexual: true, 'sexual/minors': true }))
    expect(await new OpenAIModerationClient(env).moderate('...')).toBe(ModerationResult.DANGEROUS)
  })

  test('暴力违法 illicit/violent → 2', async () => {
    mockFetchOnce(buildResponse({ 'illicit/violent': true }))
    expect(await new OpenAIModerationClient(env).moderate('...')).toBe(ModerationResult.DANGEROUS)
  })

  test('威胁性仇恨 hate/threatening → 2', async () => {
    mockFetchOnce(buildResponse({ 'hate/threatening': true }))
    expect(await new OpenAIModerationClient(env).moderate('...')).toBe(ModerationResult.DANGEROUS)
  })

  test('普通仇恨/骚扰不升级到危险 → 0', async () => {
    mockFetchOnce(buildResponse({ harassment: true, hate: true }))
    expect(await new OpenAIModerationClient(env).moderate('...')).toBe(ModerationResult.NORMAL)
  })

  test('整体未标记时，即使类别字段异常为 true 也视为普通 → 0', async () => {
    mockFetchOnce({
      results: [{ flagged: false, categories: { ...ALL_FALSE, sexual: true }, category_scores: { sexual: 0.99 } }]
    })
    expect(await new OpenAIModerationClient(env).moderate('医学科普中的性健康关键词')).toBe(ModerationResult.NORMAL)
  })

  test('类别命中但置信度低于阈值 → 0', async () => {
    mockFetchOnce({
      results: [{ flagged: true, categories: { ...ALL_FALSE, sexual: true }, category_scores: { sexual: 0.2 } }]
    })
    expect(await new OpenAIModerationClient(env).moderate('新闻或医学文章')).toBe(ModerationResult.NORMAL)
  })

  test('请求体：默认 POST 到官方 endpoint，model + input，带 Bearer 头且禁止重定向', async () => {
    mockFetchOnce(buildResponse({}))
    await new OpenAIModerationClient(env).moderate('x')
    const { url, init, body } = lastCall()
    expect(url).toBe('https://api.openai.com/v1/moderations')
    expect((init as RequestInit).method).toBe('POST')
    expect((init as RequestInit).redirect).toBe('error')
    expect((init as any).headers.Authorization).toBe('Bearer sk-test')
    expect(body.model).toBe('omni-moderation-latest')
    expect(body.input).toBe('x')
  })

  test('只有显式配置才能向可信自建审核 endpoint 发送密钥', async () => {
    mockFetchOnce(buildResponse({}))
    await new OpenAIModerationClient({ ...env, OPENAI_MODERATION_ENDPOINT: 'https://moderation.example/v1/moderations' }).moderate('x')
    expect(lastCall().url).toBe('https://moderation.example/v1/moderations')
  })

  test.each(['not-a-url', 'http://moderation.example/v1', 'https://user:pass@moderation.example/v1', 'https://moderation.example/v1#fragment'])(
    '拒绝不安全的审核 endpoint：%s',
    endpoint => {
      expect(() => new OpenAIModerationClient({ ...env, OPENAI_MODERATION_ENDPOINT: endpoint })).toThrow()
      expect(fetchMock).not.toHaveBeenCalled()
    }
  )

  test('moderateContent：无标题/正文/图片 → 不请求，返回 0', async () => {
    const client = new OpenAIModerationClient(env)
    expect(await client.moderateContent({})).toBe(ModerationResult.NORMAL)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('moderateContent：拆成 1 次文本 + 每张图片各 1 次请求（单次仅 1 图）', async () => {
    // 3 个 job：文本(标题+正文) + 2 张图片
    mockFetchOnce(buildResponse({}))
    mockFetchOnce(buildResponse({ sexual: true }))
    mockFetchOnce(buildResponse({}))
    const res = await new OpenAIModerationClient(env).moderateContent({
      title: 'some title',
      text: 'body text',
      imageUrls: ['https://img.example/1.jpg', 'https://img.example/2.jpg']
    })
    expect(res).toBe(ModerationResult.PORN)
    expect(fetchMock).toHaveBeenCalledTimes(3)

    const inputs = fetchMock.mock.calls.map(c => JSON.parse((c[1] as RequestInit).body as string).input)
    // 文本 job：标题 + 正文
    expect(inputs[0]).toEqual([
      { type: 'text', text: 'some title' },
      { type: 'text', text: 'body text' }
    ])
    // 图片 job：每次仅 1 张
    expect(inputs[1]).toEqual([{ type: 'image_url', image_url: { url: 'https://img.example/1.jpg' } }])
    expect(inputs[2]).toEqual([{ type: 'image_url', image_url: { url: 'https://img.example/2.jpg' } }])
  })

  test('moderateContent：图片超 20 张 → 最多 21 次请求（1 文本 + 20 图），正文截断 4000', async () => {
    // 21 个 job 全部返回普通
    for (let i = 0; i < 21; i++) mockFetchOnce(buildResponse({}))
    const imageUrls = Array.from({ length: 30 }, (_, i) => `https://img.example/${i}.jpg`)
    await new OpenAIModerationClient(env).moderateContent({ title: 'T', text: 'a'.repeat(5000), imageUrls })
    expect(fetchMock).toHaveBeenCalledTimes(21)
    // 文本 job 的正文被截断到 4000
    const textJob = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).input
    expect(textJob[1].text).toHaveLength(4000)
  })

  test('moderateContent：命中 DANGEROUS 提前结束，剩余批次不再请求', async () => {
    // 第一批（并发 5）里就命中 sexual/minors=2
    for (let i = 0; i < 5; i++) mockFetchOnce(buildResponse(i === 0 ? { 'sexual/minors': true } : {}))
    const imageUrls = Array.from({ length: 20 }, (_, i) => `https://img.example/${i}.jpg`)
    const res = await new OpenAIModerationClient(env).moderateContent({ imageUrls })
    expect(res).toBe(ModerationResult.DANGEROUS)
    // 只跑了第一批 5 个，没有继续后面的批次
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })

  test('moderateContent：部分图片请求失败但有成功 → 取成功里最严重，不抛错', async () => {
    mockFetchOnce(buildResponse({ sexual: true })) // 文本 job：色情
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}), text: async () => 'boom' }) // 图片失败
    const res = await new OpenAIModerationClient(env).moderateContent({ title: 'T', imageUrls: ['https://img.example/1.jpg'] })
    expect(res).toBe(ModerationResult.PORN)
  })

  test('OPENAI_MODERATION_KEYS：逗号分隔多 key，每次随机选一个作 Bearer', async () => {
    const multiEnv = { OPENAI_MODERATION_KEYS: 'k1, k2 ,k3' } as unknown as Env
    const client = new OpenAIModerationClient(multiEnv)
    for (let i = 0; i < 20; i++) {
      mockFetchOnce(buildResponse({}))
      await client.moderate('x')
    }
    const used = new Set(fetchMock.mock.calls.map(c => (c[1] as any).headers.Authorization))
    used.forEach(a => expect(['Bearer k1', 'Bearer k2', 'Bearer k3']).toContain(a))
  })

  test('未配置 keys 时回退 OPENAI_API_KEY', async () => {
    mockFetchOnce(buildResponse({}))
    await new OpenAIModerationClient(env).moderate('x')
    expect((lastCall().init as any).headers.Authorization).toBe('Bearer sk-test')
  })

  test.each([{}, { OPENAI_API_KEY: ' ', OPENAI_MODERATION_KEYS: ' , ' }])('完全没有有效 key → 抛错，不发请求', async config => {
    const client = new OpenAIModerationClient(config as Env)
    await expect(client.moderate('x')).rejects.toThrow('No OpenAI moderation key configured')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('网关返回非 2xx → 抛错', async () => {
    mockFetchOnce({}, false, 404)
    await expect(new OpenAIModerationClient(env).moderate('x')).rejects.toThrow('omni-moderation request failed: 404')
  })
})
