import { describe, test, expect } from 'vitest'
import { extractImageUrls } from '../../src/utils/htmlImages'

describe('extractImageUrls', () => {
  test('按顺序提取 img src，反转义 &amp;', () => {
    const html = `<p>x</p><img src="https://p.example/img?u=a&amp;r=b"><img src='https://p.example/2.png'>`
    expect(extractImageUrls(html)).toEqual(['https://p.example/img?u=a&r=b', 'https://p.example/2.png'])
  })

  test('去重且跳过 data: 内联图', () => {
    const html = `<img src="data:image/png;base64,AAAA"><img src="https://x/1.jpg"><img src="https://x/1.jpg">`
    expect(extractImageUrls(html)).toEqual(['https://x/1.jpg'])
  })

  test('限制最多 limit 张', () => {
    const html = Array.from({ length: 25 }, (_, i) => `<img src="https://x/${i}.jpg">`).join('')
    expect(extractImageUrls(html, 20)).toHaveLength(20)
  })

  test('空内容 → 空数组', () => {
    expect(extractImageUrls('')).toEqual([])
    expect(extractImageUrls('<p>no images</p>')).toEqual([])
  })
})
