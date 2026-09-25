import { GoogleGenAI, Content, FunctionDeclaration, Schema, Tool } from '@google/genai'
import { AIError, AIProviderAuthError, AIProviderUnavailableError, AIRateLimitError } from '../../const/err'
import type { MultiLangError } from '../../utils/multiLangError'

export type ToolDefinition = {
  declaration: FunctionDeclaration
  execute: (args: Record<string, any>) => Promise<any>
}

export type VertexAIConfig = {
  model?: string
  temperature?: number
  maxOutputTokens?: number
  responseMimeType?: string
  responseSchema?: Schema
  tools?: Tool[]
  thinkingConfig?: {
    thinkingBudget?: number
  }
}

export type OnStepCallback = (toolName: string, args: Record<string, any>) => void
export type OnTextDeltaCallback = (text: string) => Promise<void>

/** Budget for the provider to produce the first streamed chunk of one request. */
export const CHAT_FIRST_BYTE_TIMEOUT_MS = 30_000

export type AIProviderFailure = {
  providerStatus?: number
  providerCode?: string | number
  reference?: string
  overloaded?: boolean
  timedOut: boolean
}

/**
 * A provider interaction failure that keeps the detail the SDK exposed — HTTP status,
 * provider code, Google reference id and overload flag — so callers can classify it and
 * operators can still diagnose it. The previous generic AI error discarded all of it.
 */
export class AIProviderError extends Error {
  readonly providerStatus?: number
  readonly providerCode?: string | number
  readonly reference?: string
  readonly overloaded: boolean
  readonly timedOut: boolean
  readonly originalError?: unknown

  constructor(message: string, failure: AIProviderFailure, originalError?: unknown) {
    super(message)
    this.name = 'AIProviderError'
    this.providerStatus = failure.providerStatus
    this.providerCode = failure.providerCode
    this.reference = failure.reference
    this.overloaded = failure.overloaded ?? false
    this.timedOut = failure.timedOut
    this.originalError = originalError
  }
}

const asRecord = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {})

/** Google reports server-side faults as `internal error; reference = <id>`. */
const REFERENCE_PATTERN = /reference\s*[:=]\s*([A-Za-z0-9_-]+)/

export const toProviderFailure = (error: unknown, timedOut = false): AIProviderFailure => {
  const record = asRecord(error)
  const status = record.status
  const code = record.code
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''

  return {
    providerStatus: typeof status === 'number' ? status : undefined,
    providerCode: typeof code === 'string' || typeof code === 'number' ? code : undefined,
    reference: REFERENCE_PATTERN.exec(message)?.[1],
    overloaded: record.overloaded === true,
    timedOut
  }
}

/**
 * Maps a provider failure onto the user-facing error taxonomy. A provider failure that
 * carries no HTTP status is a network-level failure (the provider was unreachable), which
 * is transient from the caller's point of view and therefore shares the unavailable code.
 */
export const classifyProviderError = (error: unknown): MultiLangError => {
  if (error instanceof AIProviderError) {
    if (error.timedOut || error.overloaded) return AIProviderUnavailableError()

    const status = error.providerStatus
    if (status === 401 || status === 403) return AIProviderAuthError()
    if (status === 429) return AIRateLimitError()
    if (status === undefined || status >= 500) return AIProviderUnavailableError()
  }

  return AIError()
}

export class VertexAIClient {
  private apiKey: string
  private customTools: Map<string, ToolDefinition> = new Map()

  //@ts-ignore
  constructor(env: Env) {
    this.apiKey = env.VERTEX_API_KEY
  }

  private async getAIClient(): Promise<GoogleGenAI> {
    return new GoogleGenAI({
      apiKey: this.apiKey,
      vertexai: true
    })
  }

  private async executeFunctionCall(name: string, args: Record<string, any>): Promise<any> {
    const tool = this.customTools.get(name)
    if (!tool) throw new Error(`Unknown tool: ${name}`)
    return tool.execute(args)
  }

  public registerTools(tools: ToolDefinition[]) {
    for (const tool of tools) {
      if (tool.declaration.name) {
        this.customTools.set(tool.declaration.name, tool)
      }
    }
  }

  async chat(contents: Content[], config: VertexAIConfig = {}, options?: { onStep?: OnStepCallback; systemInstruction?: string }): Promise<{ text: string }> {
    const ai = await this.getAIClient()

    const generationConfig: any = {
      temperature: config.temperature ?? 0.6,
      maxOutputTokens: config.maxOutputTokens ?? 16384
    }

    if (config.responseMimeType) {
      generationConfig.responseMimeType = config.responseMimeType
    }

    if (config.responseSchema) {
      generationConfig.responseSchema = config.responseSchema
    }

    if (config.thinkingConfig) {
      generationConfig.thinkingConfig = config.thinkingConfig
    }

    const requestConfig: any = {
      model: config.model,
      contents,
      config: generationConfig
    }

    if (options?.systemInstruction) {
      requestConfig.config.systemInstruction = options.systemInstruction
    }

    if (config.tools && config.tools.length > 0) {
      requestConfig.config.tools = config.tools
    }

    let currentContents = [...contents]
    const maxSteps = 10

    for (let step = 0; step < maxSteps; step++) {
      const response = await ai.models.generateContent({
        ...requestConfig,
        contents: currentContents
      })

      if (response.functionCalls && response.functionCalls.length > 0) {
        const functionResponses: any[] = []

        for (const fc of response.functionCalls) {
          if (!fc.name) continue
          options?.onStep?.(fc.name, fc.args as Record<string, unknown>)
          const result = await this.executeFunctionCall(fc.name, fc.args as Record<string, unknown>)

          functionResponses.push({
            functionResponse: {
              name: fc.name,
              response: { output: result }
            }
          })
        }

        if (response.candidates && response.candidates[0]?.content) {
          currentContents.push(response.candidates[0].content)
        }

        currentContents.push({
          role: 'user',
          parts: functionResponses
        })

        continue
      }

      return { text: response.text || '' }
    }

    return { text: '' }
  }

  async chatStream(
    contents: Content[],
    config: VertexAIConfig,
    options?: { onStep?: OnStepCallback; onTextDelta?: OnTextDeltaCallback; systemInstruction?: string }
  ): Promise<void> {
    const ai = await this.getAIClient()

    const generationConfig: any = {
      temperature: config.temperature ?? 0.6,
      maxOutputTokens: config.maxOutputTokens ?? 16384
    }

    if (config.responseMimeType) {
      generationConfig.responseMimeType = config.responseMimeType
    }

    if (config.responseSchema) {
      generationConfig.responseSchema = config.responseSchema
    }

    if (config.thinkingConfig) {
      generationConfig.thinkingConfig = config.thinkingConfig
    }

    const requestConfig: any = {
      model: config.model,
      contents,
      config: generationConfig
    }

    if (options?.systemInstruction) {
      requestConfig.config.systemInstruction = options.systemInstruction
    }

    if (config.tools && config.tools.length > 0) {
      requestConfig.config.tools = config.tools
    }

    const abortController = new AbortController()
    let timedOut = false
    let firstByteTimer: ReturnType<typeof setTimeout> | undefined

    const armFirstByteBudget = () => {
      // Clear first so a budget can never outlive the step it belongs to.
      clearFirstByteBudget()
      firstByteTimer = setTimeout(() => {
        timedOut = true
        abortController.abort()
      }, CHAT_FIRST_BYTE_TIMEOUT_MS)
    }

    const clearFirstByteBudget = () => {
      if (firstByteTimer !== undefined) {
        clearTimeout(firstByteTimer)
        firstByteTimer = undefined
      }
    }

    requestConfig.config.abortSignal = abortController.signal

    try {
      let currentContents = [...contents]
      const maxSteps = 10

      for (let step = 0; step < maxSteps; step++) {
        armFirstByteBudget()

        const response = await ai.models.generateContentStream({
          ...requestConfig,
          contents: currentContents
        })

        let hasFunctionCalls = false
        const functionCalls: any[] = []
        const allParts: any[] = []

        for await (const chunk of response) {
          // The first chunk ends the first-byte budget, so long answers are never interrupted.
          clearFirstByteBudget()

          if (chunk.text && options?.onTextDelta) {
            await options.onTextDelta(chunk.text)
          }

          if (chunk.candidates && chunk.candidates[0]?.content?.parts) {
            allParts.push(...chunk.candidates[0].content.parts)
          }

          if (chunk.functionCalls && chunk.functionCalls.length > 0) {
            hasFunctionCalls = true
            functionCalls.push(...chunk.functionCalls)
          }
        }

        if (hasFunctionCalls && functionCalls.length > 0) {
          const functionResponses: any[] = []

          for (const fc of functionCalls) {
            if (!fc.name) continue
            options?.onStep?.(fc.name, fc.args as Record<string, unknown>)
            const result = await this.executeFunctionCall(fc.name, fc.args as Record<string, unknown>)

            functionResponses.push({
              functionResponse: {
                name: fc.name,
                response: { output: result }
              }
            })
          }

          currentContents.push({
            role: 'model',
            parts: allParts
          })
          currentContents.push({
            role: 'user',
            parts: functionResponses
          })

          continue
        }

        break
      }
    } catch (error) {
      clearFirstByteBudget()
      const failure = toProviderFailure(error, timedOut)

      // Structured, greppable diagnosis for operators. Only extracted scalars and the
      // provider message are logged — never the API key or the raw error object.
      console.error('[aigc.vertex] chat stream failed', {
        providerStatus: failure.providerStatus,
        providerCode: failure.providerCode,
        reference: failure.reference,
        overloaded: failure.overloaded,
        timedOut: failure.timedOut,
        message: error instanceof Error ? error.message : String(error)
      })

      throw new AIProviderError('AI provider chat stream failed', failure, error)
    } finally {
      clearFirstByteBudget()
    }
  }
}
