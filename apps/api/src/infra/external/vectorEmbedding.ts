import { Buffer } from 'node:buffer'
import { injectable } from '@/decorators/di'
import {
  bisectText,
  estimatedTokens,
  modelPayload,
  normalized,
  VECTOR_BATCH_SIZE,
  VECTOR_MEDIA_REQUEST_BYTES,
  VECTOR_MODEL,
  VECTOR_REQUEST_BYTES,
  type EmbeddedPart,
  type ModelInput
} from '@/utils/vectorEmbedding'

async function responseText(response: Response, limit: number): Promise<string> {
  if (!response.body) throw new Error('empty_embedding_response')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read().catch(() => {
        throw new Error('embedding_response_interrupted')
      })
      if (done) break
      size += value.byteLength
      if (size > limit) throw new Error('embedding_response_too_large')
      text += decoder.decode(value, { stream: true })
    }
    return text + decoder.decode()
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

class ContextOverflow extends Error {}

const SAFE_PROVIDER_DETAILS: Record<string, string> = {
  INPUT_TOKEN_LIMIT_EXCEEDED: 'Input exceeds the model token limit',
  INVALID_TASK: 'Task is not supported',
  AUTH_INVALID_API_KEY: 'Invalid API key'
}

export function providerDiagnostic(status: number, text: string, requestId: string | null) {
  const diagnostic: { status: number; code?: string; detail?: string; requestId?: string } = { status }
  try {
    const body = JSON.parse(text) as { code?: unknown; detail?: unknown; request_id?: unknown }
    if (typeof body.code === 'string' && /^[A-Z][A-Z0-9_]{1,64}$/.test(body.code)) {
      diagnostic.code = body.code
      const detail = SAFE_PROVIDER_DETAILS[body.code]
      if (detail) diagnostic.detail = detail
    }
    if (typeof body.request_id === 'string' && /^[a-f0-9]{16,64}$/i.test(body.request_id)) diagnostic.requestId = body.request_id
  } catch {
    // Only structured provider metadata is retained; raw error responses are never logged.
  }
  if (!diagnostic.requestId && requestId && /^[a-f0-9]{16,64}$/i.test(requestId)) diagnostic.requestId = requestId
  return diagnostic
}

@injectable()
export class VectorEmbeddingClient {
  private readonly apiKey: string
  private readonly fetcher: typeof fetch = (input, init) => fetch(input, init)

  constructor(env: Env) {
    this.apiKey = env.JINA_API_KEY
  }

  async query(text: string, signal?: AbortSignal): Promise<number[]> {
    return (await this.request([{ text }], 1, VECTOR_REQUEST_BYTES, signal))[0]
  }

  private async request(input: ModelInput[] | { pdf: string }, count?: number, maxBytes = VECTOR_REQUEST_BYTES, requestSignal?: AbortSignal): Promise<number[][]> {
    if (!this.apiKey) throw new Error('missing_jina_api_key')
    const body = JSON.stringify(modelPayload(input))
    if (Buffer.byteLength(body, 'utf8') > maxBytes) throw new Error('embedding_request_too_large')
    const timeout = AbortSignal.timeout(90_000)
    const signal = requestSignal ? AbortSignal.any([requestSignal, timeout]) : timeout
    const bodyFailure = (error: unknown): never => {
      requestSignal?.throwIfAborted()
      if (timeout.aborted) throw new Error('embedding_request_timeout')
      throw error
    }
    const response = await this.fetcher('https://api.jina.ai/v1/embeddings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body,
      signal
    }).catch(() => bodyFailure(new Error('embedding_transport_failed')))
    if (!response.ok) {
      const text = await responseText(response, 16 * 1024).catch(bodyFailure)
      console.error('[embedding-provider]', JSON.stringify(providerDiagnostic(response.status, text, response.headers.get('x-request-id'))))
      if (
        (response.status === 400 || response.status === 413 || response.status === 422) &&
        /context[_ -]?(length|window)|maximum.*tokens|token.*(limit|exceed)|input.*too long|(?:input.*exceed.*maximum length|exceed.*model(?:['’]s)? maximum length)/i.test(text)
      ) {
        throw new ContextOverflow('embedding_context_overflow')
      }
      throw new Error(`embedding_http_${response.status}`)
    }
    const result = (
      count === undefined ? await response.json().catch(bodyFailure) : JSON.parse(await responseText(response, Math.max(2 * 1024 * 1024, count * 64 * 1024)).catch(bodyFailure))
    ) as {
      model?: string
      data?: { index: number; embedding: number[] }[]
    } | null
    if (!result || result.model !== VECTOR_MODEL || !Array.isArray(result.data) || !result.data.length || (count !== undefined && result.data.length !== count))
      throw new Error('embedding_response_shape')
    const vectors: number[][] = new Array(result.data.length)
    for (const item of result.data) {
      if (!item || !Number.isInteger(item.index) || item.index < 0 || item.index >= vectors.length || vectors[item.index] || !Array.isArray(item.embedding))
        throw new Error('embedding_response_index')
      vectors[item.index] = normalized(item.embedding)
    }
    return vectors
  }

  async embed(inputs: ModelInput[]): Promise<EmbeddedPart[][]> {
    if (!inputs.length || inputs.length > VECTOR_BATCH_SIZE) throw new Error('invalid_embedding_batch')
    return this.embedWithinBudget(inputs, { remaining: 128 })
  }

  private async embedWithinBudget(inputs: ModelInput[], budget: { remaining: number }): Promise<EmbeddedPart[][]> {
    if (inputs.length > budget.remaining) throw new Error('pending_embedding_subdivision_limit')
    try {
      const values = await this.request(inputs, inputs.length, inputs.some(input => !('text' in input)) ? VECTOR_MEDIA_REQUEST_BYTES : VECTOR_REQUEST_BYTES)
      budget.remaining -= values.length
      return values.map((vector, i) => [
        {
          values: vector,
          weight: 'text' in inputs[i] ? Math.max(1, estimatedTokens((inputs[i] as { text: string }).text)) : 1,
          modality: 'text' in inputs[i] ? 'text' : 'image'
        }
      ])
    } catch (error) {
      if (!(error instanceof ContextOverflow)) throw error
      if (inputs.length > 1) {
        const middle = Math.floor(inputs.length / 2)
        return [...(await this.embedWithinBudget(inputs.slice(0, middle), budget)), ...(await this.embedWithinBudget(inputs.slice(middle), budget))]
      }
      const input = inputs[0]
      if (!('text' in input)) throw new Error('pending_multimodal_context_overflow')
      const parts: EmbeddedPart[] = []
      for (const text of bisectText(input.text)) parts.push(...(await this.embedWithinBudget([{ text }], budget))[0])
      return [parts]
    }
  }

  async pdf(base64: string): Promise<number[][]> {
    return this.request({ pdf: base64 }, undefined, VECTOR_MEDIA_REQUEST_BYTES)
  }
}
