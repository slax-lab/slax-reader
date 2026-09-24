import { describe, expect, test, vi } from 'vitest'
import { AigcService } from '@/domain/aigc'
import { buildChatSystemInstruction, generateOverviewTagsUserPrompt } from '@/const/prompt'

describe('AIGC prompts', () => {
  test('puts article content in the system instruction', () => {
    const prompt = buildChatSystemInstruction('desktop', 'zh', 'article-$&-$1')

    expect(prompt).toContain('<article>\narticle-$&-$1\n</article>')
  })

  test.each(['mobile', 'desktop'] as const)('chat rules for %s pin diagrams to mermaid fenced blocks', platform => {
    const prompt = buildChatSystemInstruction(platform, 'zh', 'article')

    expect(prompt).toContain('```mermaid fenced code block')
  })

  test('auto-tagging allows zero to three precise tags', () => {
    const prompt = generateOverviewTagsUserPrompt('zh', ['技术', '阅读'])

    expect(prompt).toContain('数量可以是0~3个')
    expect(prompt).toContain('输出空数组 []')
    expect(prompt).toContain('标签必须描述文章本身的内容')
    expect(prompt).toContain('tags: [标签1, 标签2, 标签3, 标签4, ...]')
  })

  test('auto-tagging lists my tags before fallback tags', () => {
    const prompt = generateOverviewTagsUserPrompt('zh', { mine: ['创业'], auto: ['技术', '阅读'] })
    const mineAt = prompt.indexOf('我的标签（能对上就必须优先用）：\n创业')
    const autoAt = prompt.indexOf('备选标签（我的标签都对不上时才用）：\n技术,阅读')

    expect(mineAt).toBeGreaterThan(-1)
    expect(autoAt).toBeGreaterThan(mineAt)
  })

  test('auto-tagging keeps both sections when my tags are empty', () => {
    const prompt = generateOverviewTagsUserPrompt('zh', { mine: [], auto: ['技术'] })

    expect(prompt).toContain('我的标签（能对上就必须优先用）：\n\n')
    expect(prompt).toContain('备选标签（我的标签都对不上时才用）：\n技术')
  })

  test('preserves the latest user message instead of replacing it with the article', async () => {
    const client = {
      registerTools: vi.fn(),
      chatStream: vi.fn().mockResolvedValue(undefined)
    }
    const service = new AigcService((() => client) as never)
    Object.assign(service as any, {
      wr: {
        write: vi.fn().mockResolvedValue(undefined)
      }
    })
    const messages = [
      { role: 'user', parts: [{ text: 'first question' }] },
      { role: 'model', parts: [{ text: 'first answer' }] },
      { role: 'user', parts: [{ text: 'latest question' }] }
    ] as any
    const ctx = { get: vi.fn((key: string) => (key === 'ai_lang' ? 'zh' : undefined)), env: {} }

    await service.chatRawContentText(ctx as never, 'article body', 'latest question', messages, [])

    expect(client.chatStream).toHaveBeenCalledWith(
      expect.arrayContaining([{ role: 'user', parts: [{ text: expect.stringContaining('latest question') }] }]),
      expect.anything(),
      expect.objectContaining({ systemInstruction: expect.stringContaining('<article>\narticle body\n</article>') })
    )
    expect(messages.at(-1)?.parts?.[0]?.text).toContain('latest question')
    expect(messages.at(-1)?.parts?.[0]?.text).not.toContain('article body')
  })
})
