// content 可能是划线 JSON，提取纯文本
export const markText = (raw?: string): string => {
  if (!raw) return ''
  try {
    const arr = JSON.parse(raw)
    if (Array.isArray(arr))
      return arr
        .map((s: { text?: string }) => s?.text ?? '')
        .join('')
        .trim()
  } catch {}
  return raw.trim()
}
