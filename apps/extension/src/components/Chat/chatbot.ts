import { $t } from '@/utils/locale'
import { LineDecoder, SSEDecoder } from '@commons/frontend-utils/decoder'
import { partialParse } from '@commons/frontend-utils/json'
import { RequestMethodType } from '@commons/frontend-utils/request'

import { request } from '@/bridge/request'
import { RESTMethodPath } from '@commons/contracts/const'
import { type ChatCompletionChunk } from '@commons/contracts/openai'
import type { QuoteData } from '@slax-reader/selection/types'

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

export type ChatBotParams = { bookmarkId: number } | { shareCode: string } | { collection: { code: string; cbId: number } } | { title: string; raw_content: string }

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

export interface ChatResponseCallback {
  type: ChatResponseType
  data: ChatResponseData
  sessionId: number
}

export class ChatBot {
  private _isChatting = false
  bookmarkId?: number
  shareCode?: string
  collection?: { code: string; cbId: number }
  raw?: {
    title: string
    raw_content: string
  }

  private currentSessionsCount = 0

  responseCallback?: (params: ChatResponseCallback) => void
  chatStatusUpdateHandler?: (isChatting: boolean) => void

  constructor(params: ChatBotParams, responseCallback: (params: ChatResponseCallback) => void) {
    if ('bookmarkId' in params) {
      this.bookmarkId = params.bookmarkId
    } else if ('shareCode' in params) {
      this.shareCode = params.shareCode
    } else if ('collection' in params) {
      this.collection = params.collection
    } else if ('title' in params && 'raw_content' in params) {
      this.raw = {
        title: params.title,
        raw_content: params.raw_content
      }
    }

    this.responseCallback = responseCallback
  }

  async chat(params: ChatParams) {
    this.updateChatStatus(true)
    const sseDecoder = new SSEDecoder()
    const lineDecoder = new LineDecoder()

    const messages = this.createMessages(params)
    const callBack = await request.stream({
      url: RESTMethodPath.BOT_CHAT,
      method: RequestMethodType.post,
      body: messages
    })

    const sessionId = ++this.currentSessionsCount

    callBack &&
      callBack((text: string, isDone: boolean) => {
        if (isDone) {
          for (const line of lineDecoder.flush()) {
            if (isDoneSentinel(line)) continue
            const sse = sseDecoder.decode(line)

            if (sse) {
              if (sse.data === '[DONE]') continue
              try {
                const data = JSON.parse(sse.data) as ChatCompletionChunk
                this.handleData(data, sessionId)
              } catch (e) {
                console.error(e)
              }
            } else if (line.length > 0) {
              try {
                const data = JSON.parse(line) as { data: string; message: string; code: number }
                const errorRefs: Record<string, string> = {
                  NOT_SUBSCRIPTION: $t('util.chatbot.error_not_subscription')
                }

                const error = new Error(errorRefs[data.data] || data.message, { cause: { data: data.data, message: data.message, code: data.code } })
                this.handleData(error, sessionId)
              } catch (e) {
                console.error(e)
              }
            }
          }

          this.updateChatStatus(false)
          return
        }

        const lines = lineDecoder.decode(text)
        for (const line of lines) {
          if (isDoneSentinel(line)) continue
          const sse = sseDecoder.decode(line)

          if (sse) {
            if (sse.data === '[DONE]') continue
            try {
              const data = JSON.parse(sse.data) as ChatCompletionChunk
              this.handleData(data, sessionId)
            } catch (e) {
              console.log('error data', sse.data)
              console.error(e)
            }
          }
        }
      })
  }

  destruct() {
    this.responseCallback = undefined
  }

  get isChatting() {
    return this._isChatting
  }

  private handleData(data: ChatCompletionChunk | Error, sessionId: number) {
    if (data instanceof Error) {
      if (!this.responseCallback) {
        return
      }

      this.responseCallback({
        type: ChatResponseType.STATUS_UPDATE,
        data: { [ChatResponseType.STATUS_UPDATE]: { name: 'error', tips: data.message, status: 'failed' } },
        sessionId
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
            this.responseCallback({ type: ChatResponseType.CONTENT, data: { [ChatResponseType.CONTENT]: delta.content || '' }, sessionId })
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
                data: { [ChatResponseType.STATUS_UPDATE]: { name: 'generateQuestion', tips: $t('util.chatbot.generate_question'), status: 'processing' } },
                sessionId
              })
            choice.status === 'finished_successfully' &&
              this.responseCallback({
                type: ChatResponseType.STATUS_UPDATE,
                data: { [ChatResponseType.STATUS_UPDATE]: { name: 'generateQuestion', tips: $t('util.chatbot.generate_question_finished'), status: 'finished' } },
                sessionId
              })

            choice.status === 'finished_successfully' &&
              this.responseCallback({ type: ChatResponseType.FUNCTION, data: { [ChatResponseType.FUNCTION]: { name: `${funcName}`, args: parseArg as string[] } }, sessionId })
          } else if (funcName === 'browser') {
            choice.status === 'processing' &&
              this.responseCallback({
                type: ChatResponseType.STATUS_UPDATE,
                data: { [ChatResponseType.STATUS_UPDATE]: { name: 'browser', tips: `${delta.content || ''}`, status: 'processing' } },
                sessionId
              })
            choice.status === 'finished_successfully' &&
              this.responseCallback({
                type: ChatResponseType.STATUS_UPDATE,
                data: { [ChatResponseType.STATUS_UPDATE]: { name: 'browser', tips: $t('util.chatbot.browser_finished'), status: 'finished' } },
                sessionId
              })

            choice.status === 'finished_failed' &&
              this.responseCallback({
                type: ChatResponseType.STATUS_UPDATE,
                data: { [ChatResponseType.STATUS_UPDATE]: { name: 'browser', tips: $t('util.chatbot.browser_finished'), status: 'failed' } },
                sessionId
              })
          } else if (funcName === 'search') {
            choice.status === 'processing' &&
              this.responseCallback({
                type: ChatResponseType.STATUS_UPDATE,
                data: { [ChatResponseType.STATUS_UPDATE]: { name: 'search', tips: `${delta.content}`, status: 'processing' } },
                sessionId
              })
            choice.status === 'finished_successfully' &&
              this.responseCallback({
                type: ChatResponseType.STATUS_UPDATE,
                data: { [ChatResponseType.STATUS_UPDATE]: { name: 'search', tips: $t('util.chatbot.search_finished'), status: 'finished' } },
                sessionId
              })

            choice.status === 'finished_failed' &&
              this.responseCallback({
                type: ChatResponseType.STATUS_UPDATE,
                data: { [ChatResponseType.STATUS_UPDATE]: { name: 'search', tips: $t('util.chatbot.search_finished'), status: 'finished' } },
                sessionId
              })

            choice.status === 'finished_successfully' &&
              this.responseCallback({
                type: ChatResponseType.FUNCTION,
                data: { [ChatResponseType.FUNCTION]: { name: `${funcName}`, args: parseArg as { url: string; title: string; content: string; icon: string }[] } },
                sessionId
              })
          } else if (funcName === 'relatedQuestion') {
            choice.status === 'finished_successfully' &&
              this.responseCallback({ type: ChatResponseType.FUNCTION, data: { [ChatResponseType.FUNCTION]: { name: `${funcName}`, args: parseArg as string } }, sessionId })
          } else if (funcName === 'searchBookmark') {
            choice.status === 'processing' &&
              this.responseCallback({
                type: ChatResponseType.STATUS_UPDATE,
                data: { [ChatResponseType.STATUS_UPDATE]: { name: 'searchBookmark', tips: `${delta.content || ''}`, status: 'processing' } },
                sessionId
              })
            choice.status === 'finished_successfully' &&
              this.responseCallback({
                type: ChatResponseType.STATUS_UPDATE,
                data: { [ChatResponseType.STATUS_UPDATE]: { name: 'searchBookmark', tips: $t('util.chatbot.search_bookmark_finished'), status: 'finished' } },
                sessionId
              })
            choice.status === 'finished_failed' &&
              this.responseCallback({
                type: ChatResponseType.STATUS_UPDATE,
                data: { [ChatResponseType.STATUS_UPDATE]: { name: 'searchBookmark', tips: $t('util.chatbot.search_bookmark_failed'), status: 'failed' } },
                sessionId
              })

            choice.status === 'finished_successfully' &&
              this.responseCallback({ type: ChatResponseType.FUNCTION, data: { [ChatResponseType.FUNCTION]: { name: `${funcName}`, args: parseArg as string } }, sessionId })
          }
        }
      }
    }
  }

  private createMessages(params: ChatParams) {
    if (params.type === ChatParamsType.CONTENT) {
      const messages: { role: 'user' | 'assistant'; content: string }[] = []
      if (params.history) {
        params.history.forEach(history => {
          messages.push(history)
        })
      }

      messages.push({ role: 'user', content: params.content })
      return {
        ...(this.bookmarkId ? { bm_id: this.bookmarkId } : {}),
        ...(this.shareCode ? { share_code: this.shareCode } : {}),
        ...(this.collection ? { collection_code: this.collection.code, cb_id: this.collection.cbId } : {}),
        ...(this.raw ? { title: this.raw.title, raw_content: this.raw.raw_content } : {}),
        messages,
        quote: params.quote && params.quote.data.length > 0 ? params.quote.data : undefined
      }
    } else if (params.type === ChatParamsType.QUESTIONS) {
      return {
        ...(this.bookmarkId ? { bm_id: this.bookmarkId } : {}),
        ...(this.shareCode ? { share_code: this.shareCode } : {}),
        ...(this.collection ? { collection_code: this.collection.code, cb_id: this.collection.cbId } : {}),
        ...(this.raw ? { title: this.raw.title, raw_content: this.raw.raw_content } : {}),
        messages: [{ role: 'assistant', tool_calls: [{ id: '1', type: 'function', function: { name: 'generateQuestion' } }] }]
      }
    } else if (params.type === ChatParamsType.ASK) {
      return {
        ...(this.bookmarkId ? { bm_id: this.bookmarkId } : {}),
        ...(this.shareCode ? { share_code: this.shareCode } : {}),
        ...(this.collection ? { collection_code: this.collection.code, cb_id: this.collection.cbId } : {}),
        ...(this.raw ? { title: this.raw.title, raw_content: this.raw.raw_content } : {}),
        messages: [
          {
            role: 'assistant',
            content: params.questions
          }
        ]
      }
    }
  }

  private updateChatStatus(isChatting: boolean) {
    this._isChatting = isChatting
    this.chatStatusUpdateHandler && this.chatStatusUpdateHandler(isChatting)
  }
}

const isDoneSentinel = (line: string): boolean => {
  const normalized = line.replace(/\r$/, '').trim()
  return normalized === '[DONE]' || normalized === 'data: [DONE]'
}
