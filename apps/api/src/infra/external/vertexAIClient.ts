import { GoogleGenAI, Content, FunctionDeclaration, Schema, Tool } from '@google/genai'
import { AIError } from '../../const/err'

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

    try {
      let currentContents = [...contents]
      const maxSteps = 10

      for (let step = 0; step < maxSteps; step++) {
        const response = await ai.models.generateContentStream({
          ...requestConfig,
          contents: currentContents
        })

        let hasFunctionCalls = false
        const functionCalls: any[] = []
        const allParts: any[] = []

        for await (const chunk of response) {
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
      console.error('ChatStream error:', error)
      throw AIError()
    }
  }
}
