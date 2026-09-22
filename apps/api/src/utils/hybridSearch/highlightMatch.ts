import { escapeHtml } from '@/utils/escape'

interface HighlightRange {
  text: string
  start: number
  end: number
}

const LENGTH_CONFIG = {
  TARGET_LENGTH: 60, // 目标返回长度
  MIN_WINDOW_SIZE: 60, // 最小窗口大小
  WINDOW_STEP: 5 // 滑动窗口步长
} as const

export const mapHighlight = (originalText: string, processedText: string): string => {
  const highlightTokens =
    processedText
      .match(/\[highlight\](.*?)\[\/highlight\]/g)
      ?.map(t => t.replace(/\[highlight\]|\[\/highlight\]/g, ''))
      .filter(Boolean) || []

  // 如果没有匹配到高亮内容，返回指定长度的文本
  if (!highlightTokens.length) {
    return escapeHtml(originalText.slice(0, LENGTH_CONFIG.TARGET_LENGTH))
  }

  // 获取所有高亮位置
  const positions: HighlightRange[] = []
  highlightTokens.forEach(token => {
    let pos = 0
    while ((pos = originalText.toLowerCase().indexOf(token.toLowerCase(), pos)) !== -1) {
      positions.push({
        text: originalText.slice(pos, pos + token.length),
        start: pos,
        end: pos + token.length
      })
      pos += 1
    }
  })

  // 如果没找到任何匹配位置，返回指定长度的文本
  if (!positions.length) {
    return escapeHtml(originalText.slice(0, LENGTH_CONFIG.TARGET_LENGTH))
  }

  positions.sort((a, b) => a.start - b.start)

  // 合并重叠的高亮区域
  const mergedPositions: HighlightRange[] = positions.reduce((merged: HighlightRange[], current) => {
    if (!merged.length) {
      return [current]
    }
    const last = merged[merged.length - 1]
    if (current.start <= last.end) {
      last.end = Math.max(last.end, current.end)
      last.text = originalText.slice(last.start, last.end)
      return merged
    }
    merged.push(current)
    return merged
  }, [])

  // 找到最长的匹配，决定窗口大小
  const maxHighlightLength = Math.max(...mergedPositions.map(pos => pos.end - pos.start))
  const WINDOW_SIZE = Math.max(LENGTH_CONFIG.MIN_WINDOW_SIZE, maxHighlightLength)

  // 如果文本较短，直接处理整个文本
  if (originalText.length <= WINDOW_SIZE) {
    let result = ''
    let lastPos = 0
    mergedPositions.forEach(pos => {
      result += escapeHtml(originalText.slice(lastPos, pos.start))
      result += `<mark>${escapeHtml(originalText.slice(pos.start, pos.end))}</mark>`
      lastPos = pos.end
    })
    result += escapeHtml(originalText.slice(lastPos))
    return result
  }

  // 计算高亮密度
  const densityRanges: { start: number; end: number; density: number }[] = []
  const maxWindowStart = Math.max(0, originalText.length - WINDOW_SIZE)

  for (let i = 0; i <= maxWindowStart; i += LENGTH_CONFIG.WINDOW_STEP) {
    const windowStart = i
    const windowEnd = i + WINDOW_SIZE

    let highlightLength = 0
    for (const pos of mergedPositions) {
      if (pos.start >= windowStart && pos.end <= windowEnd) {
        highlightLength += pos.end - pos.start
      }
    }

    if (highlightLength > 0) {
      densityRanges.push({
        start: windowStart,
        end: windowEnd,
        density: highlightLength / WINDOW_SIZE
      })
    }
  }

  // 如果没有找到高亮区域，使用第一个匹配
  if (!densityRanges.length) {
    const pos = mergedPositions[0]
    const remainingLength = Math.max(0, LENGTH_CONFIG.TARGET_LENGTH - (pos.end - pos.start))
    const contextBefore = Math.floor(remainingLength / 2)
    const start = Math.max(0, pos.start - contextBefore)
    const end = Math.min(originalText.length, Math.max(pos.end, start + LENGTH_CONFIG.TARGET_LENGTH))

    return escapeHtml(originalText.slice(start, pos.start)) + `<mark>${escapeHtml(originalText.slice(pos.start, pos.end))}</mark>` + escapeHtml(originalText.slice(pos.end, end))
  }

  // 找出密度最高的区域
  const bestRange = densityRanges.reduce((max, range) => (range.density > max.density ? range : max))

  // 在最佳范围内找到一个高亮位置
  const targetHighlight = mergedPositions.find(pos => pos.start >= bestRange.start && pos.end <= bestRange.end) || mergedPositions[0]

  // 计算最终返回的文本范围
  const highlightLength = targetHighlight.end - targetHighlight.start
  const remainingLength = Math.max(0, LENGTH_CONFIG.TARGET_LENGTH - highlightLength)
  const contextBefore = Math.floor(remainingLength / 2)
  const contextAfter = remainingLength - contextBefore

  const finalStart = Math.max(0, targetHighlight.start - contextBefore)
  const finalEnd = Math.min(originalText.length, targetHighlight.end + contextAfter)

  // 构建最终文本
  let result = ''
  let lastPos = finalStart

  // 只处理最终范围内的高亮
  mergedPositions.forEach(pos => {
    if (pos.end < finalStart || pos.start > finalEnd) {
      return
    }

    if (pos.start > lastPos) {
      result += escapeHtml(originalText.slice(lastPos, pos.start))
    }

    const highlightStart = Math.max(finalStart, pos.start)
    const highlightEnd = Math.min(finalEnd, pos.end)
    result += `<mark>${escapeHtml(originalText.slice(highlightStart, highlightEnd))}</mark>`

    lastPos = highlightEnd
  })

  if (lastPos < finalEnd) {
    result += escapeHtml(originalText.slice(lastPos, finalEnd))
  }

  return result
}
