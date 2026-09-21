/** 列表标题字数上限 */
export const TITLE_DISPLAY_MAX = 48

/** 中文记 2 宽度，其余记 1 */
const CJK_REGEX = /[　-〿぀-ヿ㐀-䶿一-鿿豈-﫿＀-￯]/

/** 按视觉宽度截断标题，超出加省略号 */
export function truncateTitle(title?: string | null, max = TITLE_DISPLAY_MAX): string {
  const str = title ?? ''
  const chars = Array.from(str)
  const maxWidth = max * 2

  let width = 0
  let cutAt = chars.length
  for (const [i, char] of chars.entries()) {
    width += CJK_REGEX.test(char) ? 2 : 1
    if (width > maxWidth) {
      cutAt = i
      break
    }
  }

  if (cutAt >= chars.length) return str
  return `${chars.slice(0, cutAt).join('')}…`
}

export function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/')

  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}
