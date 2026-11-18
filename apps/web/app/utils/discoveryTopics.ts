import type { RecommendedCollection } from '@slax-reader/contracts/collections'

type Member = RecommendedCollection['articles'][number]

const topics = [
  { key: 'coding', titles: /\b(?:codex|cursor|opencode|claude code|(?:ai|vibe) coding)\b|AI\s*编程/i },
  { key: 'design', titles: /\b(?:figma|opendesign|user experience|product design|UI|UX)\b|设计规范|产品设计|交互设计|用户体验/i },
  { key: 'agents', titles: /\b(?:agents?|agentic|skills?|MCP)\b|智能体/i },
  { key: 'openSource', titles: /\b(?:github|open[- ]source)\b|开源/i },
  { key: 'business', titles: /\b(?:startup|founders?|acquisition|venture capital)\b|创业|创始人|收购|商业模式/i },
  { key: 'science', titles: /\b(?:biology|physics|neuroscience|clinical)\b|科学家|生物学|物理学|神经|临床|医学|天文/i },
  { key: 'culture', titles: /\b(?:literature|cinema|filmmaking|novels?)\b|文学|电影|小说|导演|作家/i },
  { key: 'writing', titles: /\b(?:writing|storytelling|journalism)\b|写作|叙事|新闻业|记者/i },
  { key: 'money', titles: /\b(?:investing|investment|markets|inflation)\b|投资|基金|通胀|股票/i },
  { key: 'cities', titles: /\b(?:urban|architecture|housing|transit)\b|城市规划|建筑设计|住房|公共交通/i }
]

function isLegacySocialSnippet(article: Member) {
  return !article.selectionReason && /^(?:Tweet|Post):\s/i.test(article.title)
}

export function discoveryTopics(collections: RecommendedCollection[]) {
  return topics.map(({ key, titles }) => {
    const matches: { collection: RecommendedCollection; lead: Member }[] = []
    const urls = new Set<string>()
    for (const collection of collections) {
      const articles = collection.articles.filter(article => titles.test(article.title) && !urls.has(article.url))
      const lead = articles.find(article => !isLegacySocialSnippet(article)) ?? articles[0]
      if (!lead) continue
      urls.add(lead.url)
      matches.push({ collection, lead })
    }
    matches.sort((a, b) => Number(isLegacySocialSnippet(a.lead)) - Number(isLegacySocialSnippet(b.lead)))
    return { key, matches }
  }).filter(topic => topic.matches.length >= 2)
    .sort((a, b) => b.matches.length - a.matches.length)
    .slice(0, 5)
}
