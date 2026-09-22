/**
 * @description: 防XSS攻击过滤器
 */
export function filterXSS(input: string): string {
  const re = /<|>|"|'|&/g
  return input.replace(re, (str: string) => {
    switch (str) {
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '""':
        return '&quot;'
      case "'":
        return '&#39;'
      case '&':
        return '&amp;'
      default:
        return ''
    }
  })
}
