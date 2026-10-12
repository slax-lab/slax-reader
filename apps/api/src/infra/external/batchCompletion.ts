import { AIError } from '@/const/err'

export enum BatchJobStatus {
  PENDING = 'BATCH_STATE_PENDING',
  RUNNING = 'BATCH_STATE_RUNNING',
  SUCCEEDED = 'BATCH_STATE_SUCCEEDED',
  FAILED = 'BATCH_STATE_FAILED',
  CANCELLED = 'BATCH_STATE_CANCELLED',
  EXPIRED = 'BATCH_STATE_EXPIRED'
}

export interface BatchRequest {
  request: {
    contents: Array<{
      role: string
      parts: Array<{ text: string }>
    }>
    generationConfig?:
      | {
          temperature?: number
          maxOutputTokens?: number
        }
      | {
          responseMimeType?: 'application/json'
          responseSchema?: any
        }
  }
  metadata: {
    key: string
  }
}

export interface BatchJob {
  name: string
  metadata: {
    '@type': string
    model: string
    displayName: string
    createTime: string
    updateTime: string
    endTime?: string
    batchStats: {
      requestCount: string
      successfulRequestCount?: string
    }
    state: BatchJobStatus
    name: string
  }
  done?: boolean
  response?: {
    inlinedResponses: {
      inlinedResponses: BatchResponseItem[]
    }
  }
  error?: string
}

export interface BatchResponseItem {
  response: {
    candidates: {
      content: {
        parts: { text: string }[]
        role: string
      }
      finishReason: string
      index: number
    }[]
    usageMetadata: {
      promptTokenCount: number
      candidatesTokenCount: number
      totalTokenCount: number
      thoughtsTokenCount?: number
    }
    modelVersion: string
    responseId: string
  }
  metadata: {
    key: string
  }
}

export class GeminiBatchProvider {
  constructor(
    private apiKey: string,
    private baseUrl: string,
    private source = 'unnoo-zhishixingqiu'
  ) {}

  async submitBatch(requests: BatchRequest[], model = 'gemini-2.5-flash', displayName?: string): Promise<BatchJob> {
    const url = `${this.baseUrl}/v1beta/models/${model}:batchGenerateContent`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.apiKey,
        source: this.source
      },
      body: JSON.stringify({
        batch: {
          display_name: displayName,
          input_config: {
            requests: {
              requests
            }
          }
        }
      })
    })

    if (!response.ok) {
      console.error(`Gemini Batch Response Error: ${await response.text()}`)
      throw AIError()
    }

    return response.json()
  }

  async queryBatch(batchId: string): Promise<BatchJob> {
    const url = `${this.baseUrl}/v1beta/${batchId}`

    const response = await fetch(url, {
      headers: {
        'x-goog-api-key': this.apiKey,
        source: this.source,
        'Content-Type': 'application/json'
      }
    })

    if (!response.ok) {
      throw new Error(`Batch query failed: ${await response.text()}`)
    }

    return response.json()
  }

  async cancelBatch(batchId: string): Promise<BatchJob> {
    const url = `${this.baseUrl}/v1beta/${batchId}:cancel`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'x-goog-api-key': this.apiKey,
        source: this.source,
        'Content-Type': 'application/json'
      }
    })

    if (!response.ok) {
      throw new Error(`Batch cancel failed: ${await response.text()}`)
    }

    return response.json()
  }

  async deleteBatch(batchId: string): Promise<void> {
    const url = `${this.baseUrl}/v1beta/${batchId}:delete`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'x-goog-api-key': this.apiKey,
        source: this.source
      }
    })

    if (!response.ok) {
      throw new Error(`Batch delete failed: ${await response.text()}`)
    }
  }
}
