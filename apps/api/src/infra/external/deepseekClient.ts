/** Text-only JSON generation for media articles. No provider SDK or fallback is needed. */
export const DEEPSEEK_ARTICLE_MODEL = 'deepseek-flash'

export type ArticleModelConfig = {
  abortSignal?: AbortSignal
  temperature?: number
  maxOutputTokens: number
  responseSchema: object
}

export type ArticleModelReply = {
  text: string
  usage?: { inputTokens: number; outputTokens: number; thoughtTokens?: number }
  finishReason?: string
}

export interface ArticleModel {
  chat(contents: Array<{ role: string; parts: Array<{ text: string }> }>, config: ArticleModelConfig, options: { systemInstruction: string }): Promise<ArticleModelReply>
}

export class DeepSeekError extends Error {
  constructor(
    public readonly code: 'configuration' | 'http' | 'transport' | 'response',
    public readonly providerStatus?: number
  ) {
    super(`deepseek_${code}${providerStatus ? `:${providerStatus}` : ''}`)
    this.name = 'DeepSeekError'
  }
}

export class DeepSeekClient implements ArticleModel {
  constructor(private readonly env: { DEEPSEEK_API_KEY?: string }) {}

  async chat(contents: Parameters<ArticleModel['chat']>[0], config: ArticleModelConfig, options: { systemInstruction: string }): Promise<ArticleModelReply> {
    const key = this.env.DEEPSEEK_API_KEY?.trim()
    if (!key) throw new DeepSeekError('configuration')
    const endpoint = new URL('https://api.deepseek.com/chat/completions')
    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        redirect: 'error',
        signal: config.abortSignal,
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: DEEPSEEK_ARTICLE_MODEL,
          thinking: { type: 'disabled' },
          stream: false,
          temperature: config.temperature ?? 0.2,
          max_tokens: config.maxOutputTokens,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: options.systemInstruction + '\nReturn only JSON matching this shape: ' + JSON.stringify(config.responseSchema) },
            ...contents.map(content => ({ role: content.role, content: content.parts.map(part => part.text).join('\n') }))
          ]
        })
      })
    } catch {
      // Provider messages and fetch exceptions can include the request URL or body.
      throw new DeepSeekError('transport')
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw new DeepSeekError('http', response.status)
    }
    let body: { choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }>; usage?: { prompt_tokens?: number; completion_tokens?: number } }
    try {
      body = await response.json()
    } catch {
      throw new DeepSeekError('response')
    }
    const choice = body?.choices?.[0]
    const usage = body?.usage
    const validCount = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0
    // Return usage even for empty/truncated content so the runner charges it before repair.
    return {
      text: ['stop', 'length'].includes(choice?.finish_reason ?? '') && typeof choice?.message?.content === 'string' ? choice.message.content : '',
      finishReason: choice?.finish_reason === 'length' ? 'MAX_TOKENS' : choice?.finish_reason === 'stop' ? 'STOP' : 'OTHER',
      ...(validCount(usage?.prompt_tokens) && validCount(usage?.completion_tokens)
        ? { usage: { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens, thoughtTokens: 0 } }
        : {})
    }
  }
}
