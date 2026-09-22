/**
 * 内容审核结果等级
 * 0 - 普通内容
 * 1 - 色情内容
 * 2 - 极度危险内容（儿童色情 / 反动 / 恐怖主义 / 核武制造 / 毒品等）
 */
export enum ModerationResult {
  NORMAL = 0,
  PORN = 1,
  DANGEROUS = 2
}

type ModerationInput = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }

interface ModerationApiResponse {
  results?: Array<{
    flagged?: boolean
    categories?: Record<string, boolean | null>
    category_scores?: Record<string, number | null>
  }>
}

export class OpenAIModerationClient {
  private keys: string[]
  private endpoint: string
  private static readonly MODEL = 'omni-moderation-latest'

  private static readonly MAX_TEXT_LEN = 4000

  private static readonly MAX_IMAGES = 20

  constructor(env: Env) {
    const endpoint = env.OPENAI_MODERATION_ENDPOINT?.trim() || 'https://api.openai.com/v1/moderations'
    let url: URL
    try {
      url = new URL(endpoint)
    } catch {
      throw new Error('Invalid OpenAI moderation endpoint')
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
      throw new Error('OpenAI moderation endpoint must be an HTTPS URL without credentials or fragment')
    }
    this.endpoint = url.toString()
    this.keys = OpenAIModerationClient.parseKeys(env.OPENAI_MODERATION_KEYS, env.OPENAI_API_KEY)
  }

  private static parseKeys(rawKeys: string | undefined, fallback: string | undefined): string[] {
    const keys = (rawKeys || '')
      .split(',')
      .map(k => k.trim())
      .filter(k => k.length > 0)
    if (keys.length > 0) return keys
    return fallback?.trim() ? [fallback.trim()] : []
  }

  private pickKey(): string {
    if (this.keys.length === 0) throw new Error('No OpenAI moderation key configured')
    return this.keys[Math.floor(Math.random() * this.keys.length)]
  }

  /**
   * 对多模态输入（文本 / 图片）做审核，返回分级结果。
   */
  public async moderate(input: string | ModerationInput[]): Promise<ModerationResult> {
    const resp = await fetch(this.endpoint, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.pickKey()}`
      },
      body: JSON.stringify({ model: OpenAIModerationClient.MODEL, input })
    })

    if (!resp.ok) {
      throw new Error(`omni-moderation request failed: ${resp.status} ${await resp.text().catch(() => '')}`)
    }

    const data = (await resp.json()) as ModerationApiResponse
    return this.classify(data)
  }

  private static readonly BATCH_CONCURRENCY = 5

  public async moderateContent(params: { title?: string; text?: string; imageUrls?: string[] }): Promise<ModerationResult> {
    const { title, text, imageUrls } = params

    const jobs: ModerationInput[][] = []

    const textItems: ModerationInput[] = []
    if (title && title.trim().length > 0) textItems.push({ type: 'text', text: title.trim() })
    if (text && text.trim().length > 0) textItems.push({ type: 'text', text: text.trim().slice(0, OpenAIModerationClient.MAX_TEXT_LEN) })
    if (textItems.length > 0) jobs.push(textItems)

    for (const url of (imageUrls || []).slice(0, OpenAIModerationClient.MAX_IMAGES)) {
      if (url && url.length > 0) jobs.push([{ type: 'image_url', image_url: { url } }])
    }

    if (jobs.length === 0) return ModerationResult.NORMAL

    let worst = ModerationResult.NORMAL
    let anySuccess = false
    let lastError: unknown = null

    for (let i = 0; i < jobs.length; i += OpenAIModerationClient.BATCH_CONCURRENCY) {
      const batch = jobs.slice(i, i + OpenAIModerationClient.BATCH_CONCURRENCY)
      const settled = await Promise.allSettled(batch.map(input => this.moderate(input)))
      for (const r of settled) {
        if (r.status === 'fulfilled') {
          anySuccess = true
          if (r.value > worst) worst = r.value
        } else {
          lastError = r.reason
        }
      }
      if (worst === ModerationResult.DANGEROUS) return worst
    }

    if (!anySuccess && lastError) throw lastError instanceof Error ? lastError : new Error(String(lastError))
    return worst
  }

  /**
   * 将 omni-moderation 分类映射为业务分级。
   * 极度危险（2）：儿童色情 / 暴力违法（武器、恐怖主义等） / 威胁性仇恨（反动、极端）。
   * 色情（1）：一般色情内容。
   * 其余归为普通（0）。
   */
  private classify(res: ModerationApiResponse): ModerationResult {
    const result = res.results?.[0]
    if (!result || !result.categories) return ModerationResult.NORMAL
    if (result.flagged === false) return ModerationResult.NORMAL

    const c = result.categories
    const scores = result.category_scores || {}
    const flag = (key: string) => c[key] === true
    const scoreAtLeast = (key: string, threshold: number) => typeof scores[key] === 'number' && scores[key] >= threshold

    if (
      (flag('sexual/minors') && scoreAtLeast('sexual/minors', 0.5)) ||
      (flag('illicit/violent') && scoreAtLeast('illicit/violent', 0.8)) ||
      (flag('hate/threatening') && scoreAtLeast('hate/threatening', 0.8))
    ) {
      return ModerationResult.DANGEROUS
    }

    // 色情内容
    if (flag('sexual') && scoreAtLeast('sexual', 0.5)) {
      return ModerationResult.PORN
    }

    return ModerationResult.NORMAL
  }
}
