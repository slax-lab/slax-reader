import { describe, expect, test, vi } from 'vitest'
import { AigcService, toolStatus } from '@/domain/aigc'
import type { VertexAIClient } from '@/infra/external/vertexAIClient'

describe('Chat web search', () => {
  test('requests Google Search with an explicit model and returns its summary', async () => {
    const chat = vi.fn().mockResolvedValue({ text: 'A grounded search summary' })
    const client = { chat } as unknown as VertexAIClient
    const service = new AigcService(() => client, undefined as never, undefined as never, undefined as never)
    const progress = vi.spyOn(service, 'writeProgress').mockResolvedValue(undefined)

    await expect(service.chatToolGoogleSearch('sample query')).resolves.toBe('A grounded search summary')

    expect(chat).toHaveBeenCalledWith(
      [{ role: 'user', parts: [{ text: 'Search for: sample query' }] }],
      expect.objectContaining({ model: 'gemini-3-flash-preview', tools: [{ googleSearch: {} }] }),
      expect.anything()
    )
    expect(progress).toHaveBeenNthCalledWith(1, 'tool', 'search', 'sample query', toolStatus.PROCESSING)
    expect(progress).toHaveBeenNthCalledWith(2, 'tool', 'search', null, toolStatus.SUCCESSFULLY)
  })
})
