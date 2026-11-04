/**
 * Usage mapping of one Gemini reply: thinking tokens are billed as output and also kept apart
 * for the truncation telemetry.
 * 来源: src/infra/external/vertexAIClient.ts
 */
import { describe, expect, test } from 'vitest'
import { chatUsageFromMetadata } from '@/infra/external/vertexAIClient'

describe('chatUsageFromMetadata', () => {
  test('adds thinking tokens to the output and reports them apart', () => {
    expect(chatUsageFromMetadata({ promptTokenCount: 3000, candidatesTokenCount: 15500, thoughtsTokenCount: 500 })).toEqual({ inputTokens: 3000, outputTokens: 16000, thoughtTokens: 500 })
  })

  test('missing counts read as zero; missing metadata reads as undefined', () => {
    expect(chatUsageFromMetadata({ promptTokenCount: 10 })).toEqual({ inputTokens: 10, outputTokens: 0, thoughtTokens: 0 })
    expect(chatUsageFromMetadata(undefined)).toBeUndefined()
  })
})
