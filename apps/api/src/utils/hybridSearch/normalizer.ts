import { SlaxJieba } from './jieba'
import { embedding } from './vectorize'

export interface contentShard {
  raw_content: string
  normalized_content: string
  raw_title: string
  normalized_title: string
  shard_idx: number
}

export interface semanticShard {
  id: string
  embedding: number[]
}

export class Normalizer {
  private ngramLengths = [1, 2, 3]
  private static maxDOCount = 20
  private static maxShardSize = 2 * 1024 * 1024
  private static maxTokens = 8096
  private overlapSize = 500
  private shardCount = 0
  private jbObject!: DurableObjectStub<SlaxJieba>

  constructor(private env: Env) {
    const doId = Math.floor(Math.random() * Normalizer.maxDOCount)
    const jbObj = this.env.SLAX_JIEBA
    this.jbObject = jbObj.get(jbObj.idFromName(`${doId}`))
    // this.jbObject = jbObj.get(jbObj.idFromName('0'))
  }

  async cut(text: string, hmm?: boolean): Promise<any[]> {
    const res = await this.jbObject.fetch('http://cut_for_search', { method: 'POST', body: JSON.stringify({ text: text, hmm: hmm }) })
    if (!res.ok) return []
    const result = await res.json<{ data: string[] }>()
    return result.data
  }

  async processSearchKeyword(keyword: string): Promise<string> {
    keyword = keyword.replace(/[^\w\s\u4e00-\u9fff]/g, ' ')
    const searchTerms = keyword.split(/\s+/).filter(term => term.trim().length > 0)
    if (searchTerms.length === 0) return ''

    // 分词处理
    const termSegments = await Promise.all(
      searchTerms.map(async term => {
        return (await this.cut(term, true))
          .map(item => item.trim())
          .filter(item => !!item && item.length > 0)
          .join(' ')
      })
    )

    const mainTerm = termSegments[0]
    const otherTerms = termSegments.slice(1)

    const mainTermSegments = mainTerm.split(' ').map(item => `"${item}"`)
    const titleQueries: string[] = [`title:NEAR(${mainTermSegments.join(' ')}, 20)`]
    const contentQueries: string[] = [`content:NEAR(${mainTermSegments.join(' ')}, 30)`]

    if (otherTerms.length > 0) {
      titleQueries.push(`(${otherTerms.map(item => `title:"${item}"`).join(' OR ')})`)
      contentQueries.push(`(${otherTerms.map(item => `content:"${item}"`).join(' OR ')})`)
    }

    return `(${titleQueries.join(' AND ')}) OR (${contentQueries.join(' AND ')})`
  }
  /**
   * 处理文本内容，返回分片结果
   */
  async processFulltext(title: string, content: string): Promise<contentShard[]> {
    try {
      return await this.splitAndProcess(title, this.cleanRawText(content))
    } catch (e) {
      const ct = content?.slice(0, 100)
      console.log(`processFulltext ${title} ${ct} error:`, e)
      return []
    }
  }

  private cleanRawText(text: string): string {
    return (
      text
        // 统一换行符
        .replace(/\r\n/g, '\n')
        // 连续3个及以上换行符替换为2个
        .replace(/\n{3,}/g, '\n\n')
        // 连续的空格替换为单个空格
        .replace(/[ \t]+/g, ' ')
        // 移除只包含空格的行
        .replace(/[\n\s]+/g, ' ')
        .trim()
    )
  }

  /**
   * 处理语义内容，返回分片结果
   */
  async processSemantic(bmId: number, title: string, content: string): Promise<semanticShard[]> {
    const processedText = this.preprocessForSemantic(`${title} ${content}`)
    const chunks = this.semanticSplit(processedText)

    return (await embedding(this.env, chunks)).map((item, idx) => {
      return { id: `${bmId}_${idx}`, embedding: item.embedding }
    })
  }

  private preprocessForSemantic(text: string): string {
    return (
      text
        // 统一换行符
        .replace(/\r\n/g, '\n')
        // 移除连续的换行
        .replace(/\n{3,}/g, '\n\n')
        // 移除多余空白字符
        .replace(/\s+/g, ' ')
        // 清理特殊字符
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        // 转小写
        .toLowerCase()
        .trim()
    )
  }

  /**
   * 在最近的句子边界处分割
   */
  private findSplitPosition(text: string, targetPosition: number): number {
    // 向前最多查找100个字符
    const minPosition = Math.max(0, targetPosition - 100)

    while (targetPosition > minPosition) {
      const char = text[targetPosition]
      // 找到了句子边界则返回
      if (char && '。.!?！？'.includes(char)) {
        return targetPosition + 1
      }
      targetPosition--
    }

    // 如果找不到句子边界，就在最近的空格或标点处分割
    targetPosition = targetPosition
    while (targetPosition > minPosition) {
      const char = text[targetPosition]
      // 找到了空格或标点则返回
      if (char && ' ，,；;：:'.includes(char)) {
        return targetPosition + 1
      }
      targetPosition--
    }

    // 如果实在找不到合适的分割点，就直接在目标位置分割
    return targetPosition
  }

  /**
   * 分割文本
   */
  private semanticSplit(text: string): string[] {
    // 如果文本的token数小于等于最大token数，直接返回
    if (this.estimateTokens(text) <= Normalizer.maxTokens) return [text]

    const mid = Math.floor(text.length / 2)
    const splitPosition = this.findSplitPosition(text, mid)

    const firstHalf = text.slice(0, splitPosition).trim()
    const secondHalf = text.slice(splitPosition).trim()

    return [...this.semanticSplit(firstHalf), ...this.semanticSplit(secondHalf)]
  }

  /**
   * 递归分片处理
   */
  private async splitAndProcess(title: string, content: string): Promise<contentShard[]> {
    const normalized = await this.normalize(content)
    const normalizedSize = this.getByteLength(normalized)
    const normalizedTitle = await this.normalize(title)

    // console.log(`normalize title: ${normalizedTitle} content slice: ${normalized.slice(0, 50)}`)
    // 如果处理后的内容小于限制，直接返回
    if (normalizedSize <= Normalizer.maxShardSize) {
      return [
        {
          raw_content: content,
          normalized_content: normalized,
          raw_title: title,
          normalized_title: normalizedTitle,
          shard_idx: this.shardCount++
        }
      ]
    }

    // 内容过大，进行二分
    const mid = Math.floor(content.length / 2)
    const overlap = this.overlapSize
    // 分别处理左右两半
    const leftContent = content.slice(0, mid + overlap)
    const rightContent = content.slice(mid)
    // 递归处理两部分
    return [...(await this.splitAndProcess(title, leftContent)), ...(await this.splitAndProcess(title, rightContent))]
  }

  /**
   * 文本归一化处理
   */
  private async normalize(text: string): Promise<string> {
    if (!text) return ''

    const res = await this.jbObject.fetch('http://cut_for_search', {
      method: 'POST',
      body: JSON.stringify({ text })
    })
    if (!res.ok) return ''

    const { data: segments } = await res.json<{ data: string[] }>()

    // 预编译正则
    const spaceRegex = /\s+/g
    const chineseRegex = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uff60]/g

    // 处理归一化
    const normalized = segments
      .filter(Boolean)
      .map(segment => this.removePunctuationMarks(segment.toLowerCase()).replace(spaceRegex, ''))
      .filter(item => item.length > 0)

    const seen = new Set<string>()
    const newNormalized = []

    for (let i = 0; i < normalized.length; i++) {
      const item = normalized[i]

      if (item.length < 3) {
        newNormalized.push(item)
        continue
      }

      const hasChinese = chineseRegex.test(item)
      const needSplit = (i < 1 || !item.includes(normalized[i - 1])) && hasChinese

      // if (needSplit && !seen.has(item)) {
      if (needSplit) {
        const ngrams = this.generateNgrams(Array.from(item))
        newNormalized.push(...ngrams, item)
        ngrams.forEach(n => seen.add(n))
      } else {
        newNormalized.push(item)
      }

      seen.add(item)
    }

    return newNormalized.join(' ')
  }
  /**
   * 生成NGRAM
   */
  private generateNgrams(words: string[]): string[] {
    const ngrams: string[] = []

    for (const len of this.ngramLengths) {
      for (let i = 0; i <= words.length - len; i++) {
        const ngram = words.slice(i, i + len).join('')
        if (ngram) {
          ngrams.push(ngram)
        }
      }
    }

    return ngrams
  }

  /**
   * 移除标点符号
   */
  private removePunctuationMarks(text: string): string {
    // 移除所有标点符号 {P} 是 Unicode 标点符号，{S} 是 Unicode 符号
    return text.replace(/[\p{P}\p{S}]/gu, '')
  }

  /**
   * 计算字符串的字节长度
   */
  private getByteLength(str: string): number {
    return new TextEncoder().encode(str).length
  }

  /**
   * 估算字符串的 token 数
   */
  private estimateTokens(text: string): number {
    // 中文字符和中文标点
    const cjkCount = (text.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uff60]/g) || []).length

    // 英文单词(按空格分词)
    const words = text.match(/[a-zA-Z]+/g) || []
    const wordTokens = words.reduce((sum, word) => sum + Math.ceil(word.length / 4), 0)

    // 数字序列
    const numbers = text.match(/\d+/g) || []
    const numberTokens = numbers.reduce((sum, num) => sum + Math.ceil(num.length / 4), 0)

    // 表情符号
    const emojiCount = (text.match(/[\u{1F300}-\u{1F9FF}\u{1F600}-\u{1F64F}]/gu) || []).length

    // 空格、标点和其他字符
    const otherCount = (text.match(/[^a-zA-Z\d\u4e00-\u9fff\u3000-\u303f\uff00-\uff60]/g) || []).length

    return cjkCount + wordTokens + numberTokens + emojiCount * 2 + otherCount
  }
}
