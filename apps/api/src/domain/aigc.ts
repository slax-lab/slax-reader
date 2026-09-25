import { groupVocabulary, type VocabularyTag } from '@/utils/tags'
import { inject, injectable } from '@/decorators/di'
import type { LazyInstance } from '@/decorators/lazy'
import { BucketClient } from '@/infra/repository/bucketClient'
import { GEMINI_BATCH_PROVIDER, GEMINI_AGENT } from '@/const/symbol'
import { BookmarkRepo } from '@/infra/repository/dbBookmark'
import { ContextManager } from '@/utils/context'
import { SlaxFetch } from '@/infra/external/remoteFetcher'
import { ContentParser } from '@/utils/parser'
import {
  generateOverviewTagsPrompt,
  generateOverviewTagsUserPrompt,
  generateQuestionPrompt,
  systemPrompt,
  generateRelatedTagPrompt,
  buildChatSystemInstruction,
  buildChatUserMessage,
  type TagVocabularyPrompt
} from '@/const/prompt'
import { BatchRequest, GeminiBatchProvider } from '@/infra/external/batchCompletion'
import { VertexAIClient, ToolDefinition, classifyProviderError } from '@/infra/external/vertexAIClient'
import { Content, Type } from '@google/genai'
import { MultiLangError } from '@/utils/multiLangError'
import { AIError, ErrorParam, ErrorName } from '@/const/err'

export type deltaType = {
  role?: 'system' | 'user' | 'assistant' | 'tool'
  content?: string
  function_call?: { name: string; arguments: string }
  name?: string
  tool_call_id?: string
}

export type completionQuote = {
  type: 'text' | 'image' | 'image_base64'
  content: string
  mimeType?: string
}

const parseBase64Image = (item: { content: string; mimeType?: string }): { data: string; mimeType: string } | null => {
  if (!item.content) return null
  const dataUri = item.content.match(/^data:([^;]+);base64,(.*)$/s)

  if (dataUri) return { mimeType: item.mimeType || dataUri[1], data: dataUri[2] }
  return { mimeType: item.mimeType || 'image/png', data: item.content }
}

export enum toolStatus {
  PROCESSING = 'processing',
  SUCCESSFULLY = 'finished_successfully',
  FAILED = 'finished_failed'
}

export type MixTagsOverviewResult = {
  tags: string[]
  overview: string
  key_takeaways: string[]
}

export type OverviewObjectStreamResult = {
  tags: string[]
  overview: {
    gist: string
    key_takeaways: string[]
  }
}

export type OutlineObjectStreamResult = {
  content: string
}

@injectable()
export class AigcService {
  private chunks: Uint8Array[] = []
  private ted = new TextEncoder()
  private wr!: WritableStreamDefaultWriter<Uint8Array>

  static target = '<relatedQuestionStart>'

  constructor(
    @inject(GEMINI_AGENT) private gemini: LazyInstance<VertexAIClient>,
    @inject(BucketClient) bucket: LazyInstance<BucketClient>,
    @inject(BookmarkRepo) bookmarkRepo: BookmarkRepo,
    @inject(GEMINI_BATCH_PROVIDER) private geminiBatchProvider: GeminiBatchProvider
  ) {}

  async recordChunks(chunk: Uint8Array, controller: TransformStreamDefaultController<Uint8Array>) {
    this.chunks.push(chunk)
    controller.enqueue(chunk)
  }

  public async writeDone() {
    await this.wr.write(this.ted.encode('data: [DONE]'))
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private isFunctionCall(part: any): boolean {
    return !!part.functionCall
  }

  private isToolCallMessage(message: Content): boolean {
    return message.role === 'model' && Array.isArray(message.parts) && message.parts.length > 0 && message.parts.every(p => this.isFunctionCall(p))
  }

  public async writeChunk(delta: deltaType[], status: string | null = null, finishReason: string | null = null) {
    const chunk = {
      id: `slax-chat-${Date.now()}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      choices: [{ index: 0, delta, status, finish_reason: finishReason }]
    }
    await this.wr.write(this.ted.encode(`data: ${JSON.stringify(chunk)}\n\n`))
  }

  public async writeProgress(
    role: 'system' | 'user' | 'assistant' | 'tool',
    name: string | undefined = undefined,
    content: string | undefined = undefined,
    status: string | undefined = undefined,
    finishReason: string | undefined = undefined
  ) {
    await this.writeChunk([{ role, name, content }], status, finishReason)
  }

  /** LLM Google Search Tool */
  public async chatToolGoogleSearch(query: string): Promise<string> {
    console.log(`Executing Google Search tool with query: ${query}`)
    await this.writeProgress('tool', 'search', query, toolStatus.PROCESSING)

    try {
      const searchAgent = this.gemini()
      const searchMessages: Content[] = [
        {
          role: 'user',
          parts: [{ text: `Search for: ${query}` }]
        }
      ]

      const result = await searchAgent.chat(
        searchMessages,
        {
          tools: [{ googleSearch: {} }],
          temperature: 0.7,
          maxOutputTokens: 2048
        },
        {
          systemInstruction: 'You are a search assistant. Use Google Search to find relevant information and provide a concise summary of the results.'
        }
      )

      const searchResult = result.text || 'No search results found'
      await this.writeProgress('tool', 'search', searchResult, toolStatus.SUCCESSFULLY)
      return searchResult
    } catch (error) {
      await this.writeProgress('tool', 'search', query, toolStatus.FAILED)
      return `Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    }
  }

  private createStopSequenceFilter(stopSequence: string, onChunk: (chunk: string) => Promise<void>) {
    let buffer = ''
    let matchIndex = 0
    let stopped = false

    return {
      async process(chunk: string) {
        if (stopped) return
        for (const char of chunk) {
          if (char === stopSequence[matchIndex]) {
            buffer += char
            matchIndex++
            if (matchIndex === stopSequence.length) {
              stopped = true
              return
            }
          } else {
            if (matchIndex > 0) {
              await onChunk(buffer + char)
              buffer = ''
              matchIndex = 0
            } else {
              await onChunk(char)
            }
          }
        }
      },
      async flush() {
        if (buffer && !stopped) await onChunk(buffer)
      }
    }
  }

  /** Chat with bookmark */
  public async chatRawContentText(ctx: ContextManager, rawContent: string, content: string, messages: Content[], quote: completionQuote[]) {
    if (!rawContent) return await this.writeChunk([{ role: 'assistant', content: 'No Content' }])

    messages.pop()
    const platform = ctx.get('platform') === 'mobile' ? 'mobile' : 'desktop'
    const systemInstruction = buildChatSystemInstruction(platform, ctx.get('ai_lang'), rawContent)
    const userContent = buildChatUserMessage(content)
    const quoteMessages: Content[] = await Promise.all(
      quote.map(async (item): Promise<Content> => {
        if (item.type === 'image_base64') {
          const inlineData = parseBase64Image(item)
          return { role: 'user', parts: [inlineData ? { inlineData } : { text: item.content }] }
        }
        if (item.type === 'image') {
          const inlineData = await this.fetchImageAsInlineData(item.content)
          return { role: 'user', parts: [inlineData ? { inlineData } : { text: item.content }] }
        }
        return { role: 'user', parts: [{ text: item.content }] }
      })
    )

    messages.push(...quoteMessages, { role: 'user', parts: [{ text: userContent }] })
    const filter = this.createStopSequenceFilter(AigcService.target, chunk => this.writeChunk([{ role: 'assistant', content: chunk }]))

    const toolDefinitions: ToolDefinition[] = [
      {
        declaration: {
          name: 'browser',
          description: 'Browse a web page by url',
          parameters: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING, description: 'Page title' },
              url: { type: Type.STRING, description: 'URL to browse' }
            },
            required: ['title', 'url']
          }
        },
        execute: async args => this.chatToolBrowser(ctx.env, args as { title: string; url: string })
      },
      {
        declaration: {
          name: 'googleSearch',
          description: 'Search the web using Google Search. Use this when you need current information, facts, or answers that require web search.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              query: { type: Type.STRING, description: 'Search query' }
            },
            required: ['query']
          }
        },
        execute: async args => this.chatToolGoogleSearch(args.query as string)
      }
    ]

    // Register tools with the client
    const client = this.gemini()
    client.registerTools(toolDefinitions)

    try {
      await client.chatStream(
        messages,
        {
          model: ctx.get('chat_model') || 'gemini-3-flash-preview',
          tools: [
            {
              functionDeclarations: toolDefinitions.map(t => t.declaration)
            }
          ],
          thinkingConfig: { thinkingBudget: 2048 }
        },
        {
          onTextDelta: chunk => filter.process(chunk),
          systemInstruction
        }
      )
    } catch (error) {
      console.error('StreamText error:', error)
      throw error
    }

    await filter.flush()
    await this.writeProgress('assistant', 'chat', undefined, 'completed')
    await this.writeDone()
  }

  private async fetchImageAsInlineData(url: string): Promise<{ data: string; mimeType: string } | null> {
    if (url.startsWith('data:')) return parseBase64Image({ content: url })

    try {
      const resp = await fetch(url)
      if (!resp.ok) {
        console.error(`fetch quote image failed: ${resp.status} ${url}`)
        return null
      }
      const mimeType = resp.headers.get('content-type')?.split(';')[0]?.trim() || ''
      if (!mimeType.startsWith('image/')) {
        console.error(`quote image unexpected content-type: ${mimeType} ${url}`)
        return null
      }
      const buf = await resp.arrayBuffer()
      return { data: Buffer.from(buf).toString('base64'), mimeType }
    } catch (err) {
      console.error(`fetch quote image error: ${url} ${err}`)
      return null
    }
  }

  /** LLM Tool: Generate Question */
  public async chatToolGenerateRawContentQuestion(ctx: ContextManager, title: string) {
    if (!title) return this.writeChunk([{ role: 'assistant', content: 'No raw content' }])

    const contents: Content[] = [{ role: 'user', parts: [{ text: title }] }]
    const sysInstruction = generateQuestionPrompt.replace('{ai_lang}', ctx.get('ai_lang'))

    let buffer: string = ''

    const onTextDelta = async (chunk: string) => {
      if (chunk.endsWith('\n') && buffer.length > 0) {
        buffer = buffer.concat(chunk)
        await this.writeProgress('tool', 'generateQuestion', JSON.stringify([buffer]), toolStatus.SUCCESSFULLY)
        buffer = ''
        return
      }
      if (chunk.startsWith('-') || buffer.length > 0) {
        buffer = buffer.concat(chunk)
      }
    }

    await this.writeProgress('tool', 'generateQuestion', undefined, toolStatus.PROCESSING)

    await this.gemini().chatStream(contents, { model: 'gemini-3-flash-preview' }, { onTextDelta, systemInstruction: sysInstruction })

    if (buffer) await this.writeProgress('tool', 'generateQuestion', JSON.stringify([buffer]), toolStatus.SUCCESSFULLY)

    await this.writeDone()
  }

  // Generate tags from system tag list
  public async generateTagsFromPresupposition(bmTitle: string, bmContent: string): Promise<string[]> {
    const contents: Content[] = [{ role: 'user', parts: [{ text: `title: ${bmTitle}\n content: ${bmContent.slice(0, 200)}` }] }]
    const result = await this.gemini().chat(contents, { model: 'gemini-3-flash-preview' }, { systemInstruction: generateRelatedTagPrompt })

    const tags = result.text.split('\n').filter(tag => tag.length >= 1)

    console.log(`generate tags: ${tags}`)
    return tags
  }

  // Generate tags from user tags
  public async generateOverviewTags(
    ctx: ContextManager,
    bmTitle: string,
    bmContent: string,
    byline: string,
    userTags: string[] | TagVocabularyPrompt
  ): Promise<MixTagsOverviewResult> {
    const userLang = ctx.get('ai_lang') || 'EN'

    const contents: Content[] = [
      { role: 'user', parts: [{ text: generateOverviewTagsPrompt(bmTitle, bmContent, byline) }] },
      { role: 'user', parts: [{ text: generateOverviewTagsUserPrompt(userLang, userTags) }] }
    ]

    const result = await this.gemini().chat(contents, {
      model: 'gemini-3-flash-preview',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          overview: {
            type: Type.OBJECT,
            properties: {
              gist: { type: Type.STRING },
              key_takeaways: { type: Type.ARRAY, items: { type: Type.STRING } }
            },
            required: ['gist', 'key_takeaways']
          },
          tags: { type: Type.ARRAY, items: { type: Type.STRING }, maxItems: '3' }
        },
        required: ['overview', 'tags']
      }
    })

    const object = JSON.parse(result.text) as Partial<OverviewObjectStreamResult>

    const overview = object.overview?.gist || ''
    const key_takeaways = object.overview?.key_takeaways || []
    const tags = (object.tags || []).map(tag => tag.trim())

    console.log(`generate overview tags result: ${result.text}`)

    return { tags, overview, key_takeaways }
  }

  // Generate outline from content
  public async generateOutline(ctx: ContextManager, bmContent: string, callback: (chunk: MultiLangError | Partial<OutlineObjectStreamResult>) => Promise<void>) {
    const contents: Content[] = [
      { role: 'user', parts: [{ text: systemPrompt.replace('{ai_lang}', ctx.get('ai_lang')) }] },
      { role: 'user', parts: [{ text: bmContent }] }
    ]

    try {
      let buffer = ''
      await this.gemini().chatStream(
        contents,
        {
          model: 'gemini-3-flash-preview'
        },
        {
          onTextDelta: async (chunk: string) => {
            buffer += chunk
            await callback({ content: buffer })
          }
        }
      )

      return { model: 'gemini-3-flash-preview' }
    } catch (error) {
      console.error('Generate outline error:', error)
      await callback(AIError())
      return { model: 'gemini-3-flash-preview' }
    }
  }

  // chat with bookmark
  public async bookmarkChat(ctx: ContextManager, title: string, rawContent: string, messages: Content[], writer: WritableStream<Uint8Array>, quote: completionQuote[]) {
    this.wr = writer.getWriter()
    // Hold our own writer so the frame and the close below always reach THIS stream, even if a
    // concurrent request reassigns the shared `this.wr` field. The guarantee is deliberately
    // limited to termination and the error frame: the content helpers still write through
    // `this.wr`, which is pre-existing (see the design's Non-Goals).
    const wr = this.wr

    try {
      if (messages.length < 1) throw ErrorParam()

      const latestMessage = messages[messages.length - 1]
      const isToolCall = this.isToolCallMessage(latestMessage)
      const content = (!isToolCall && latestMessage.parts?.[0]?.text) || ''

      if (!isToolCall) return await this.chatRawContentText(ctx, rawContent, content, messages, quote)
      if (!latestMessage.parts?.[0]?.functionCall) throw ErrorParam()

      switch (latestMessage.parts[0].functionCall.name) {
        case 'generateQuestion':
          return await this.chatToolGenerateRawContentQuestion(ctx, title)
        default:
          throw ErrorParam()
      }
    } catch (err) {
      await this.writeChatErrorFrame(wr, err)
    } finally {
      await this.closeChatStream(wr)
    }
  }

  /**
   * Emits exactly one terminal error frame in the API's error envelope shape, as a plain
   * JSON line. The framing is load-bearing: the web client parses an SSE-framed payload as
   * a chat chunk (and discards it on the resulting type error), while a plain line reaches
   * the same `{data, message, code}` branch the non-streaming errors already use.
   */
  private async writeChatErrorFrame(wr: WritableStreamDefaultWriter<Uint8Array>, err: unknown) {
    const error = err instanceof MultiLangError ? err : classifyProviderError(err)
    const frame = JSON.stringify({ data: error.name, message: error.getMessage, code: error.errCode })

    const detail = { name: error.name, code: error.errCode, cause: err instanceof Error ? err.message : String(err) }

    // A rejected request is the caller's mistake, not a service failure. Keeping it out of the
    // error channel stops a public endpoint from polluting error-rate signals.
    if (error.name === ErrorName.ERROR_PARAM) console.warn('[aigc.chat] rejected request', detail)
    else console.error('[aigc.chat] stream failed', detail)

    try {
      await wr.write(this.ted.encode(`${frame}\n`))
    } catch (writeErr) {
      console.error('[aigc.chat] failed to write error frame', writeErr)
    }
  }

  /** Awaited close, so the stream is terminated before the background task settles. */
  private async closeChatStream(wr: WritableStreamDefaultWriter<Uint8Array>) {
    try {
      await wr.close()
    } catch (closeErr) {
      console.error('[aigc.chat] failed to close stream', closeErr)
    }
  }

  // generate bookmark summary
  public async bookmarkSummary(
    ctx: ContextManager,
    rawContent: string,
    writer: WritableStream<Uint8Array>,
    callbackHandler?: (result: { provider: string; model: string; response: string }) => Promise<void>
  ) {
    this.wr = writer.getWriter()

    try {
      const contents: Content[] = [
        { role: 'user', parts: [{ text: systemPrompt.replace('{ai_lang}', ctx.get('ai_lang')) }] },
        { role: 'user', parts: [{ text: rawContent }] }
      ]

      await this.gemini().chatStream(
        contents,
        {
          model: 'gemini-3-flash-preview'
        },
        {
          onTextDelta: async (chunk: string) => {
            await this.wr.write(this.ted.encode(chunk))
          },
          onStep: async step => {
            console.log(`Step: ${step}`)
          }
        }
      )
    } catch (error) {
      console.error(error)
      void this.wr.write(this.ted.encode(error instanceof MultiLangError ? error.message : 'Failed to get summary, please try again later.\n'))
    } finally {
      void this.wr.close()

      if (!callbackHandler || !this.chunks) return

      const blob = new Blob(this.chunks)

      await callbackHandler({
        provider: 'google',
        model: 'gemini-3-flash-preview',
        response: await blob.text()
      })
    }
  }
  readonly overviewTagsJsonSchema = {
    type: 'OBJECT',
    properties: {
      overview: {
        type: 'OBJECT',
        properties: {
          gist: { type: 'STRING' },
          key_takeaways: {
            type: 'ARRAY',
            items: { type: 'STRING' }
          }
        }
      },
      tags: {
        type: 'ARRAY',
        items: { type: 'STRING' }
      }
    },
    propertyOrdering: ['overview', 'key_takeaways', 'tags']
  }

  public async chatToolSearchBookmark(ctx: ContextManager, args: { q: string }) {
    await this.writeProgress('tool', 'searchBookmark', args.q, toolStatus.PROCESSING)

    const url = ctx.get('req_url')
    const auth = ctx.get('req_auth')
    const bmId = ctx.get('bm_id')
    const encodedBmId = bmId ? ctx.hashIds.encodeId(bmId) : 0

    if (!url) {
      await this.writeProgress('tool', 'searchBookmark', args.q, toolStatus.FAILED)
      return 'Search fail, context no found.'
    }
    const urlObj = new URL(url)
    urlObj.pathname = '/v1/bookmark/search'

    const res = await fetch(urlObj.toString(), {
      method: 'POST',
      headers: {
        Authorization: auth,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ keyword: args.q })
    })

    if (!res.ok) {
      await this.writeProgress('tool', 'searchBookmark', args.q, toolStatus.FAILED)
      const body = await res.text()
      console.log(`searchBookmark failed: ${res.status} ${res.statusText}, body: ${body}`)
      return `Search bookmark failed: ${res.status} ${res.statusText}`
    }

    const search = await res.json<{ code: number; message: string; data: { title: string; content: string; bookmark_id: number }[] }>()
    const data = search.data.filter(item => item.bookmark_id !== encodedBmId).slice(0, 2)
    await this.writeProgress('tool', 'searchBookmark', JSON.stringify(data), toolStatus.SUCCESSFULLY)
    return data as any
  }

  public async getBatchTaskRequest(req: { ctx: ContextManager; bmId: number; bmTitle: string; bmContent: string; byline: string; userTags: string[] }): Promise<BatchRequest> {
    const { ctx, bmId, bmTitle, bmContent, byline, userTags } = req
    const userLang = ctx.get('ai_lang') || 'EN'

    return {
      request: {
        contents: [
          {
            role: 'user',
            parts: [{ text: generateOverviewTagsPrompt(bmTitle, bmContent, byline) }]
          },
          { role: 'user', parts: [{ text: generateOverviewTagsUserPrompt(userLang, userTags) }] }
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: this.overviewTagsJsonSchema
        }
      },
      metadata: {
        key: `task_generate_overview_tags_${bmId}`
      }
    }
  }

  public async generateOverviewTag(ctx: ContextManager, bmTitle: string, bmContent: string, byline: string, userTagList: VocabularyTag[]): Promise<MixTagsOverviewResult> {
    return this.generateOverviewTags(ctx, bmTitle, bmContent, byline, groupVocabulary(userTagList))
  }

  // use scraping bot to fetch url content
  public async chatToolBrowser(env: Env, args: { title: string; url: string }) {
    await this.writeProgress('tool', 'browser', args.title, toolStatus.PROCESSING)

    const fetchUrl = async () => {
      const fetcher = new SlaxFetch(env)
      const result = await fetcher.scrapingBot(args.url)

      const content = await ContentParser.parse({ url: new URL(args.url), content: result.content, title: args.title })

      await this.writeProgress('tool', 'browser', args.title, toolStatus.SUCCESSFULLY)
      return content.textContent
    }

    try {
      // max 30s timeout
      return await Promise.race([fetchUrl(), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 30000))])
    } catch (e) {
      console.log(`fetch ${args.url} failed: ${e as Error}`)
      await this.writeProgress('tool', 'browser', args.title, toolStatus.FAILED)
      return `fetch failed, please use your knowledge to answer the question`
    }
  }

  public async createBatchTask(taskName: string, request: BatchRequest) {
    return await this.geminiBatchProvider.submitBatch([request], 'gemini-2.5-flash', taskName)
  }

  public async getBatchTask(batchId: string) {
    try {
      return await this.geminiBatchProvider.queryBatch(batchId)
    } catch (e) {
      console.error(`get batch task failed: ${e}`)
      return null
    }
  }

  public async cancelBatchTask(batchId: string) {
    await this.geminiBatchProvider.cancelBatch(batchId)
  }

  public async deleteBatchTask(batchId: string) {
    await this.geminiBatchProvider.deleteBatch(batchId)
  }
}
