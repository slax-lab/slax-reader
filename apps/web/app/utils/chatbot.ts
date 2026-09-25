import { LineDecoder, SSEDecoder } from '@commons/frontend-utils/decoder'
import { partialParse } from '@commons/frontend-utils/json'
import { RequestMethodType } from '@commons/frontend-utils/request'

import { RESTMethodPath } from '@slax-reader/contracts/const'
import { type ChatCompletionChunk } from '@slax-reader/contracts/openai'
import type { QuoteData } from '~/components/Chat/type'

export enum ChatParamsType {
  CONTENT = 'CONTENT',
  QUESTIONS = 'QUESTIONS',
  ASK = 'ASK'
}

export type ChatParams =
  | { type: ChatParamsType.CONTENT; content: string; history?: { role: 'user' | 'assistant'; content: string }[]; quote?: QuoteData }
  | { type: ChatParamsType.ASK; questions: string }
  | { type: ChatParamsType.QUESTIONS }

export enum ChatResponseType {
  CONTENT = 'CONTENT',
  FUNCTION = 'FUNCTION',
  STATUS_UPDATE = 'STATUS_UPDATE'
}

export type ChatBotParams = { bookmarkId: number } | { shareCode: string } | { collection: { code: string; cbId: number } } | { bookmarkUid: string }

export type ChatResponseFunctionData =
  | {
      name: 'generateQuestion'
      args: string[] | null
    }
  | {
      name: 'search'
      args: { url: string; title: string; content: string; icon: string }[]
    }
  | {
      name: 'relatedQuestion'
      args: string | null
    }
  | {
      name: 'searchBookmark'
      args: string | null
    }

export interface ChatResponseStatusUpdateData {
  name: 'generateQuestion' | 'search' | 'browser' | 'searchBookmark' | 'error'
  tips: string
  status: 'processing' | 'finished' | 'failed'
}

export interface ChatResponseData {
  [ChatResponseType.CONTENT]?: string
  [ChatResponseType.FUNCTION]?: ChatResponseFunctionData
  [ChatResponseType.STATUS_UPDATE]?: ChatResponseStatusUpdateData
}

type QuotePayloadItem = { type: 'text'; content: string } | { type: 'image'; content: string } | { type: 'image_base64'; content: string; mimeType: string }

async function imageUrlToBase64(url: string): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const resp = await fetch(url)
    if (!resp.ok) return null
    const blob = await resp.blob()
    const mimeType = blob.type || 'image/png'
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result as string)
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })

    const base64 = dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : dataUrl
    return { base64, mimeType }
  } catch (e) {
    console.error('convert quote image to base64 failed:', e)
    return null
  }
}

async function buildQuotePayload(quote?: QuoteData): Promise<QuotePayloadItem[] | undefined> {
  if (!quote || quote.data.length === 0) return undefined
  return Promise.all(
    quote.data.map(async (item: any): Promise<QuotePayloadItem> => {
      if (item.type !== 'image') return { type: 'text', content: item.content }
      const img = await imageUrlToBase64(item.content)
      return img ? { type: 'image_base64', content: img.base64, mimeType: img.mimeType } : { type: 'image', content: item.content }
    })
  )
}

/** How long the client waits for any stream data before giving up on the response. */
const CHAT_READ_IDLE_TIMEOUT_MS = 60_000

type ChatStreamState = {
  /** Whether the stream produced any line at all; nothing at all means the server failed. */
  frameSeen: boolean
  /** Whether a failure was already surfaced, so later ones cannot stack up. */
  errorReported: boolean
}

export class ChatBot {
  private _isChatting = false
  bookmarkId?: number
  shareCode?: string
  collection?: { code: string; cbId: number }
  bookmarkUid?: string
  model?: string
  responseCallback?: (params: { type: ChatResponseType; data: ChatResponseData }) => void
  chatStatusUpdateHandler?: (isChatting: boolean) => void

  constructor(params: ChatBotParams, responseCallback: (params: { type: ChatResponseType; data: ChatResponseData }) => void) {
    if ('bookmarkId' in params) {
      this.bookmarkId = params.bookmarkId
    } else if ('shareCode' in params) {
      this.shareCode = params.shareCode
    } else if ('collection' in params) {
      this.collection = params.collection
    } else if ('bookmarkUid' in params) {
      this.bookmarkUid = params.bookmarkUid
    }

    this.responseCallback = responseCallback
  }

  async chat(params: ChatParams) {
    this.updateChatStatus(true)

    const sseDecoder = new SSEDecoder()
    const lineDecoder = new LineDecoder()
    const abortController = new AbortController()
    const state: ChatStreamState = { frameSeen: false, errorReported: false }
    let idleTimer: ReturnType<typeof setTimeout> | undefined

    const clearIdleTimer = () => {
      if (idleTimer !== undefined) {
        clearTimeout(idleTimer)
        idleTimer = undefined
      }
    }

    // The server budget only covers its first byte, so the client bounds silence across the
    // whole response: a stalled stream must not leave the chat loading forever.
    const armIdleTimer = () => {
      clearIdleTimer()
      idleTimer = setTimeout(() => {
        // Terminate the surface directly: the abort below is asynchronous, so a transport
        // that ignores it must not leave the user waiting on a spinner.
        this.reportChatError(state, t('util.chatbot.error_timeout'))
        abortController.abort()
        this.updateChatStatus(false)
      }, CHAT_READ_IDLE_TIMEOUT_MS)
    }

    try {
      const quotePayload = params.type === ChatParamsType.CONTENT ? await buildQuotePayload(params.quote) : undefined
      const messages = this.createMessages(params, quotePayload)

      armIdleTimer()
      const callBack = await request().stream({
        url: RESTMethodPath.BOT_CHAT,
        method: RequestMethodType.post,
        body: messages,
        signal: abortController.signal
      })

      if (!callBack) throw new Error(t('util.chatbot.error_request_failed'))

      Promise.resolve(
        callBack((text: string, isDone: boolean) => {
          if (isDone) {
            clearIdleTimer()
            this.consumeLines(state, lineDecoder.flush(), sseDecoder)
            this.updateChatStatus(false)
            return
          }

          armIdleTimer()
          this.consumeLines(state, lineDecoder.decode(text), sseDecoder)
        })
      )
        .catch(err => {
          console.error('chat stream failed:', err)
          this.reportChatError(state, t('util.chatbot.error_request_failed'))
        })
        .finally(() => {
          clearIdleTimer()
          // A stream that ended without a single frame left the user with nothing to read.
          if (!state.frameSeen) this.reportChatError(state, t('util.chatbot.error_no_response'))
          this.updateChatStatus(false)
        })
    } catch (e) {
      console.error('chat request failed:', e)
      clearIdleTimer()
      this.reportChatError(state, t('util.chatbot.error_request_failed'))
      this.updateChatStatus(false)
    }
  }

  /**
   * Routes decoded lines to chat chunks, the end sentinel, or an error envelope. Both the
   * streaming and the end-of-stream paths go through here: an error frame can arrive as a
   * complete line mid-stream, and handling it only at end-of-stream would drop it.
   */
  private consumeLines(state: ChatStreamState, lines: string[], sseDecoder: SSEDecoder) {
    for (const line of lines) {
      if (line.length > 0) state.frameSeen = true
      if (isDoneSentinel(line)) continue

      const sse = sseDecoder.decode(line)

      if (sse) {
        if (sse.data === '[DONE]') continue
        try {
          const data = JSON.parse(sse.data) as ChatCompletionChunk
          this.handleData(data)
        } catch (e) {
          console.error(e)
        }
      } else if (line.trimStart().startsWith('{')) {
        // Only a bare JSON object is an error envelope; an SSE field line such as
        // `data: {...}` is not one, and is emitted as an event by the empty line that follows.
        this.handleErrorLine(state, line)
      }
    }
  }

  private handleErrorLine(state: ChatStreamState, line: string) {
    try {
      const data = JSON.parse(line) as { data?: string; message?: string; code?: number }
      if (typeof data?.data !== 'string' && typeof data?.message !== 'string') return

      state.errorReported = true
      const errorRefs: Record<string, string> = {
        NOT_SUBSCRIPTION: t('util.chatbot.error_not_subscription')
      }

      const error = new Error((data.data && errorRefs[data.data]) || data.message || '', { cause: { data: data.data, message: data.message, code: data.code } })
      this.handleData(error)
    } catch (e) {
      console.error(e)
    }
  }

  /** Surfaces the first failure of a chat, so a later one cannot stack up behind it. */
  private reportChatError(state: ChatStreamState, message: string) {
    if (state.errorReported) return
    state.errorReported = true
    this.handleData(new Error(message))
  }

  destruct() {
    this.responseCallback = undefined
  }

  get isChatting() {
    return this._isChatting
  }

  private handleData(data: ChatCompletionChunk | Error) {
    if (data instanceof Error) {
      if (!this.responseCallback) {
        return
      }

      this.responseCallback({
        type: ChatResponseType.STATUS_UPDATE,
        data: { [ChatResponseType.STATUS_UPDATE]: { name: 'error', tips: data.message, status: 'failed' } }
      })

      return
    }

    if (data.choices.length === 0) {
      return
    }

    for (const choice of data.choices) {
      if (!choice.delta || choice.delta.length === 0 || !this.responseCallback) {
        continue
      }

      for (const delta of choice.delta) {
        if (delta.role === 'assistant') {
          if (delta.content) {
            this.responseCallback({ type: ChatResponseType.CONTENT, data: { [ChatResponseType.CONTENT]: delta.content || '' } })
          }
        } else if (delta.role === 'tool') {
          const funcName = delta.name
          const args = delta.content
          let parseArg: string | object | unknown | null = args
          if (args !== null && funcName !== 'relatedQuestion') {
            try {
              parseArg = partialParse(args || '{}') as unknown
            } catch (e) {
              console.error(`parsing args error: ${e}`)
            }
          }

          if (funcName === 'generateQuestion') {
            choice.status === 'processing' &&
              this.responseCallback({
                type: ChatResponseType.STATUS_UPDATE,
                data: { [ChatResponseType.STATUS_UPDATE]: { name: 'generateQuestion', tips: t('util.chatbot.generate_question'), status: 'processing' } }
              })
            choice.status === 'finished_successfully' &&
              this.responseCallback({
                type: ChatResponseType.STATUS_UPDATE,
                data: { [ChatResponseType.STATUS_UPDATE]: { name: 'generateQuestion', tips: t('util.chatbot.generate_question_finished'), status: 'finished' } }
              })

            choice.status === 'finished_successfully' &&
              this.responseCallback({ type: ChatResponseType.FUNCTION, data: { [ChatResponseType.FUNCTION]: { name: `${funcName}`, args: parseArg as string[] } } })
          } else if (funcName === 'browser') {
            choice.status === 'processing' &&
              this.responseCallback({
                type: ChatResponseType.STATUS_UPDATE,
                data: { [ChatResponseType.STATUS_UPDATE]: { name: 'browser', tips: `${delta.content || ''}`, status: 'processing' } }
              })
            choice.status === 'finished_successfully' &&
              this.responseCallback({
                type: ChatResponseType.STATUS_UPDATE,
                data: { [ChatResponseType.STATUS_UPDATE]: { name: 'browser', tips: t('util.chatbot.browser_finished'), status: 'finished' } }
              })

            choice.status === 'finished_failed' &&
              this.responseCallback({
                type: ChatResponseType.STATUS_UPDATE,
                data: { [ChatResponseType.STATUS_UPDATE]: { name: 'browser', tips: t('util.chatbot.browser_finished'), status: 'failed' } }
              })
          } else if (funcName === 'search') {
            choice.status === 'processing' &&
              this.responseCallback({
                type: ChatResponseType.STATUS_UPDATE,
                data: { [ChatResponseType.STATUS_UPDATE]: { name: 'search', tips: `${delta.content}`, status: 'processing' } }
              })
            choice.status === 'finished_successfully' &&
              this.responseCallback({
                type: ChatResponseType.STATUS_UPDATE,
                data: { [ChatResponseType.STATUS_UPDATE]: { name: 'search', tips: t('util.chatbot.search_finished'), status: 'finished' } }
              })

            choice.status === 'finished_failed' &&
              this.responseCallback({
                type: ChatResponseType.STATUS_UPDATE,
                data: { [ChatResponseType.STATUS_UPDATE]: { name: 'search', tips: t('util.chatbot.search_finished'), status: 'finished' } }
              })

            choice.status === 'finished_successfully' &&
              this.responseCallback({
                type: ChatResponseType.FUNCTION,
                data: { [ChatResponseType.FUNCTION]: { name: `${funcName}`, args: parseArg as { url: string; title: string; content: string; icon: string }[] } }
              })
          } else if (funcName === 'relatedQuestion') {
            choice.status === 'finished_successfully' &&
              this.responseCallback({ type: ChatResponseType.FUNCTION, data: { [ChatResponseType.FUNCTION]: { name: `${funcName}`, args: parseArg as string } } })
          } else if (funcName === 'searchBookmark') {
            choice.status === 'processing' &&
              this.responseCallback({
                type: ChatResponseType.STATUS_UPDATE,
                data: { [ChatResponseType.STATUS_UPDATE]: { name: 'searchBookmark', tips: `${delta.content || ''}`, status: 'processing' } }
              })
            choice.status === 'finished_successfully' &&
              this.responseCallback({
                type: ChatResponseType.STATUS_UPDATE,
                data: { [ChatResponseType.STATUS_UPDATE]: { name: 'searchBookmark', tips: t('util.chatbot.search_bookmark_finished'), status: 'finished' } }
              })
            choice.status === 'finished_failed' &&
              this.responseCallback({
                type: ChatResponseType.STATUS_UPDATE,
                data: { [ChatResponseType.STATUS_UPDATE]: { name: 'searchBookmark', tips: t('util.chatbot.search_bookmark_failed'), status: 'failed' } }
              })

            choice.status === 'finished_successfully' &&
              this.responseCallback({ type: ChatResponseType.FUNCTION, data: { [ChatResponseType.FUNCTION]: { name: `${funcName}`, args: parseArg as string } } })
          }
        }
      }
    }
  }

  private createMessages(params: ChatParams, quotePayload?: QuotePayloadItem[]) {
    if (params.type === ChatParamsType.CONTENT) {
      const messages: { role: 'user' | 'assistant'; content: string }[] = []
      if (params.history) {
        params.history.forEach(history => {
          messages.push(history)
        })
      }

      messages.push({ role: 'user', content: params.content })
      return {
        bm_id: this.bookmarkId ? this.bookmarkId : undefined,
        share_code: this.shareCode ? this.shareCode : undefined,
        ...(this.bookmarkUid ? { bookmark_uid: this.bookmarkUid } : {}),
        ...(this.collection ? { collection_code: this.collection.code, cb_id: this.collection.cbId } : {}),
        messages,
        quote: quotePayload && quotePayload.length > 0 ? quotePayload : undefined,
        platform: this.getPlatform(),
        ...(this.model ? { model: this.model } : {})
      }
    } else if (params.type === ChatParamsType.QUESTIONS) {
      return {
        bm_id: this.bookmarkId ? this.bookmarkId : undefined,
        share_code: this.shareCode ? this.shareCode : undefined,
        ...(this.bookmarkUid ? { bookmark_uid: this.bookmarkUid } : {}),
        ...(this.collection ? { collection_code: this.collection.code, cb_id: this.collection.cbId } : {}),
        messages: [{ role: 'assistant', tool_calls: [{ id: '1', type: 'function', function: { name: 'generateQuestion' } }] }]
      }
    } else if (params.type === ChatParamsType.ASK) {
      return {
        bm_id: this.bookmarkId ? this.bookmarkId : undefined,
        share_code: this.shareCode ? this.shareCode : undefined,
        ...(this.bookmarkUid ? { bookmark_uid: this.bookmarkUid } : {}),
        ...(this.collection ? { collection_code: this.collection.code, cb_id: this.collection.cbId } : {}),
        messages: [
          {
            role: 'assistant',
            content: params.questions
          }
        ]
      }
    }
  }

  private getPlatform(): 'mobile' | 'desktop' {
    if (typeof window === 'undefined') return 'desktop'
    const ua = window.navigator?.userAgent ?? ''

    if (/^SlaxReader\/[\d.]+\s+Build\//.test(ua) || /^com\.slax\.reader\/[\d.]+\s+\(Android/.test(ua)) return 'mobile'
    return window.innerWidth <= 768 ? 'mobile' : 'desktop'
  }

  private updateChatStatus(isChatting: boolean) {
    // Idempotent: several terminal paths can report the same state, and the handler must
    // run once per transition so the surface does not flush its buffer twice.
    if (this._isChatting === isChatting) return

    this._isChatting = isChatting
    this.chatStatusUpdateHandler && this.chatStatusUpdateHandler(isChatting)
  }
}

const t = (text: string) => {
  return useNuxtApp().$i18n.t(text)
}

const isDoneSentinel = (line: string): boolean => {
  const normalized = line.replace(/\r$/, '').trim()
  return normalized === '[DONE]' || normalized === 'data: [DONE]'
}
