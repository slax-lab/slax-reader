import { parseHTML } from 'linkedom'
import { Readability } from '@slax-lab/readability'
import TurndownService from 'turndown'
import murmur from 'murmurhash3js-revisited'

const encoder = new TextEncoder()

// ==========================================
// 阶段 1 & 2: HTML 清洗与核心内容提取
// ==========================================
function extractNormalizedMarkdown(html: string): string {
  const dom = parseHTML(html)
  const document = dom.document

  // 1. 暴力清除绝对不包含正文的干扰标签
  const BOILERPLATE_SELECTORS = ['script', 'style', 'nav', 'header', 'footer', '.sidebar', '.advertisement', '#comments']
  document.querySelectorAll(BOILERPLATE_SELECTORS.join(', ')).forEach(el => el.remove())

  // 2. 使用 Readability 提取核心正文
  const article = new Readability(document, {
    charThreshold: 100
  }).parse()

  if (!article || !article.content) {
    throw new Error('Readability 无法从该 HTML 中提取出有效正文')
  }

  // 3. 将提取出的干净 HTML 转换为 Markdown (抹平 class 和 style 差异)
  const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced'
  })

  return turndownService.turndown(article.content)
}

// ==========================================
// 阶段 3: 文本切片与 SimHash 算法核心
// ==========================================

/**
 * 兼容中英文的 N-Gram 切片
 * 博客原版用空格切分对中文无效，这里我们按 3 个字符为一组滑动切分
 */
function createShingles(text: string, size: number = 3): string[] {
  // 剔除所有空白字符，全部转小写，防止排版干扰
  const cleanText = text.replace(/\s+/g, '').toLowerCase()
  const shingles: string[] = []

  // 使用 Array.from 正确处理包含 Emoji 或特殊中文字符的 Unicode
  const chars = Array.from(cleanText)
  for (let i = 0; i <= chars.length - size; i++) {
    shingles.push(chars.slice(i, i + size).join(''))
  }
  return shingles
}

/**
 * 使用 MurmurHash3 生成 64位 哈希串 (拼接两个 32位)
 */
function hash64(token: string): bigint {
  // 关键修复：将 string 转为 Uint8Array (UTF-8 字节)
  const tokenBytes = encoder.encode(token)

  // 现在传入 Uint8Array，TypeScript 就不会报错了
  const h1 = murmur.x86.hash32(tokenBytes, 0)
  const h2 = murmur.x86.hash32(tokenBytes, h1) // 用 h1 作为随机种子产生 h2

  return (BigInt(h1) << 32n) | BigInt(h2)
}

/**
 * SimHash 64位 核心投票机制
 */
function computeSimhash(text: string): bigint {
  const tokens = createShingles(text, 3)

  // 初始化 64 维度的向量数组
  const vector = new Array(64).fill(0)

  // 1. 权重投票：每个 token 对 64 个 bit 位进行投票
  for (const token of tokens) {
    const hash = hash64(token)
    for (let i = 0n; i < 64n; i++) {
      const bit = (hash >> i) & 1n
      // 位是 1 则投赞成票(+1)，位是 0 则投反对票(-1)
      vector[Number(i)] += bit === 1n ? 1 : -1
    }
  }

  // 2. 降维收敛：根据最终投票结果生成最终的 64 位 SimHash
  let simhash = 0n
  for (let i = 0n; i < 64n; i++) {
    if (vector[Number(i)] > 0) {
      simhash |= 1n << i
    }
  }

  return simhash
}

// ==========================================
// 阶段 4: 海明距离计算与结果判定
// ==========================================

function hammingDistance(hash1: bigint, hash2: bigint): number {
  let xor = hash1 ^ hash2 // 异或运算，不同的位会变成 1
  let distance = 0
  while (xor > 0n) {
    distance += Number(xor & 1n) // 统计 1 的个数
    xor >>= 1n
  }
  return distance
}

// ==========================================
// 业务调用 Demo 演示
// ==========================================

async function runDemo() {
  console.log('🚀 开始网页去重分析...')

  // 模拟从不同 URL 获取的两个 HTML (注意里面的干扰项完全不同)
  const htmlA = `
        <html>
        <body>
            <nav>我是网站A的导航栏，包含50个链接</nav>
            <div id="content">
                <h1>苹果发布会总结</h1>
                <p>今天发布了新款手机，性能提升了 200%。</p>
                <p>价格非常昂贵。</p>
            </div>
            <div class="advertisement">看这里！双十一大促销！</div>
            <footer>最新更新时间：2026-03-25 10:00:00</footer>
            </body>
        </html>
    `

  const htmlB = `
        <html>
        <body>
            <nav>我是网站B的完全不一样的导航</nav>
            <div id="content">
                <h1 class="title-bold">苹果发布会总结</h1>
                <p>今天发布了新款手机， 性能提升了 200%。</p>
                <p>价格非常昂贵。</p>
            </div>
            <div class="sidebar">加入我们的邮件订阅列表</div>
            <footer>最新更新时间：2026-03-25 14:46:15</footer>
            </body>
        </html>
    `

  // 1. 提取并转为 Markdown
  const mdA = extractNormalizedMarkdown(htmlA)

  console.log(mdA)

  const mdB = extractNormalizedMarkdown(htmlB)
  console.log(mdB)

  console.log('✅ 归一化完成')

  // 2. 计算 64位 SimHash
  const hashA = computeSimhash(mdA)
  const hashB = computeSimhash(mdB)

  // 你可以将这两个字符串存入数据库 (VARCHAR / BIGINT)
  console.log(`\n📄 文章 A 的 SimHash: ${hashA.toString()}`)
  console.log(`📄 文章 B 的 SimHash: ${hashB.toString()}`)

  // 3. 计算距离并判定
  const distance = hammingDistance(hashA, hashB)
  console.log(`\n📏 两篇文章的海明距离: ${distance}`)

  // 工业界标准：距离 <= 3 判定为同一篇文章
  if (distance <= 3) {
    console.log('🎉 结论：它们是【相同】的内容！(成功忽略了时间戳、广告和排版的差异)')
  } else {
    console.log('❌ 结论：它们是【不同】的内容。')
  }
}

runDemo().catch(console.error)
