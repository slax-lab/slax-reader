/**
 * 已知成人内容站点的完整域名黑名单，用于在 AI 处理（自动打标签 / 总览 / 大纲 / 对话）前拦截。
 * 硬编码维护，直接写完整域名（如 t66y.com）；非详尽列表，按需增删。
 * 匹配规则：精确匹配域名本身，或其子域名（如 www.pornhub.com、cn.pornhub.com）。
 */
const PROHIBITED_DOMAINS = [
  'pornhub.com',
  'xvideos.com',
  'xnxx.com',
  'xhamster.com',
  'redtube.com',
  'youporn.com',
  'youjizz.com',
  't66y.com',
  '91porn.com',
  'jable.tv',
  'javhd.com',
  'javbus.com',
  'javlibrary.com',
  'spankbang.com',
  'motherless.com',
  'chaturbate.com',
  'tktube.com',
  'txxx.com',
  'eporner.com',
  'hclips.com',
  'porntrex.com',
  'theporndude.com',
  'javrate.com',
  'missav.com',
  'missav.ai'
]

export function isProhibitedContentUrl(url: URL | string): boolean {
  if (!url) return false
  try {
    const host = (typeof url === 'string' ? new URL(url) : url).host.toLowerCase()
    return PROHIBITED_DOMAINS.some(domain => host === domain || host.endsWith(`.${domain}`))
  } catch {
    return false
  }
}
