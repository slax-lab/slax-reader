import { describe, expect, it } from 'vitest'
import { generateOverviewTagsUserPrompt, systemPrompt } from '@/const/prompt'

describe('systemPrompt', () => {
  it('asks the model for markdown directly, with no JSON envelope', () => {
    expect(systemPrompt).toContain('用markdown列表的形式总结这篇文章')
    expect(systemPrompt).toContain('md语法要求只能用#, ## 和 -')
    expect(systemPrompt.trimEnd().endsWith('</要求>')).toBe(true)
    expect(systemPrompt).not.toContain('JSON')
    expect(systemPrompt).not.toContain('content:')
  })
})

describe('generateOverviewTagsUserPrompt', () => {
  it('lists my tags before the fallback tags', () => {
    const prompt = generateOverviewTagsUserPrompt('zh', { mine: ['创业', '育儿'], auto: ['技术'] })
    const mineAt = prompt.indexOf('我的标签（能对上就必须优先用）：\n创业,育儿')
    const autoAt = prompt.indexOf('备选标签（我的标签都对不上时才用）：\n技术')
    expect(mineAt).toBeGreaterThan(-1)
    expect(autoAt).toBeGreaterThan(mineAt)
  })

  it('still emits both sections when my tags are empty', () => {
    const prompt = generateOverviewTagsUserPrompt('en', { mine: [], auto: ['tech'] })
    expect(prompt).toContain('我的标签（能对上就必须优先用）：\n\n')
    expect(prompt).toContain('备选标签（我的标签都对不上时才用）：\ntech')
  })

  it('treats a plain string array as fallback tags only', () => {
    const prompt = generateOverviewTagsUserPrompt('en', ['a', 'b'])
    expect(prompt).toContain('备选标签（我的标签都对不上时才用）：\na,b')
  })

  it('keeps the wording other tests pin', () => {
    const prompt = generateOverviewTagsUserPrompt('zh', [])
    expect(prompt).toContain('数量可以是0~3个')
    expect(prompt).toContain('输出空数组 []')
    expect(prompt).toContain('标签必须描述文章本身的内容')
    expect(prompt).toContain('tags: [标签1, 标签2, 标签3, 标签4, ...]')
  })
})
