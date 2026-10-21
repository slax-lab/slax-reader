import { escapeHtml } from '@/utils/escape'

const LENGTH_CONFIG = {
  TARGET_LENGTH: 60, // 目标返回长度
  MIN_WINDOW_SIZE: 60, // 最小窗口大小
  WINDOW_STEP: 5 // 滑动窗口步长
} as const

interface HighlightRange {
  start: number
  end: number
}

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

  // 小写只做一次，并对 snippet 里重复出现的 token 去重
  const lowerText = originalText.toLowerCase()
  const tokens = [...new Set(highlightTokens.map(token => token.toLowerCase()))]
  const positions: HighlightRange[] = []

  for (const token of tokens) {
    if (!token) continue
    let pos = 0
    while ((pos = lowerText.indexOf(token, pos)) !== -1) {
      positions.push({ start: pos, end: pos + token.length })
      pos += 1
    }
  }

  // 如果没找到任何匹配位置，返回指定长度的文本
  if (!positions.length) {
    return escapeHtml(originalText.slice(0, LENGTH_CONFIG.TARGET_LENGTH))
  }

  positions.sort((a, b) => a.start - b.start)

  // 合并重叠的高亮区域
  const mergedPositions: HighlightRange[] = []
  for (const current of positions) {
    const last = mergedPositions[mergedPositions.length - 1]
    if (last && current.start <= last.end) {
      last.end = Math.max(last.end, current.end)
    } else {
      mergedPositions.push({ start: current.start, end: current.end })
    }
  }

  // 找到最长的匹配，决定窗口大小
  let maxHighlightLength = 0
  for (const pos of mergedPositions) {
    maxHighlightLength = Math.max(maxHighlightLength, pos.end - pos.start)
  }
  const WINDOW_SIZE = Math.max(LENGTH_CONFIG.MIN_WINDOW_SIZE, maxHighlightLength)

  // 如果文本较短，直接处理整个文本
  if (originalText.length <= WINDOW_SIZE) {
    let result = ''
    let lastPos = 0
    for (const pos of mergedPositions) {
      result += escapeHtml(originalText.slice(lastPos, pos.start))
      result += `<mark>${escapeHtml(originalText.slice(pos.start, pos.end))}</mark>`
      lastPos = pos.end
    }
    result += escapeHtml(originalText.slice(lastPos))
    return result
  }

  // 用差分数组复现原有「每 5 个字符一个窗口」的高亮密度计算，避免逐窗口扫描全文
  const maxWindowStart = Math.max(0, originalText.length - WINDOW_SIZE)
  const windowCount = Math.floor(maxWindowStart / LENGTH_CONFIG.WINDOW_STEP)
  const densityDelta = new Int32Array(windowCount + 2)

  for (const pos of mergedPositions) {
    const firstWindow = Math.max(0, Math.ceil((pos.end - WINDOW_SIZE) / LENGTH_CONFIG.WINDOW_STEP))
    const lastWindow = Math.min(windowCount, Math.floor(pos.start / LENGTH_CONFIG.WINDOW_STEP))
    if (firstWindow <= lastWindow) {
      const length = pos.end - pos.start
      densityDelta[firstWindow] += length
      densityDelta[lastWindow + 1] -= length
    }
  }

  let bestWindowStart = -1
  let bestDensity = -1
  let density = 0
  for (let window = 0; window <= windowCount; window++) {
    density += densityDelta[window]
    if (density > 0) {
      const currentDensity = density / WINDOW_SIZE
      if (currentDensity > bestDensity) {
        bestDensity = currentDensity
        bestWindowStart = window * LENGTH_CONFIG.WINDOW_STEP
      }
    }
  }

  // 如果没有找到高亮区域，使用第一个匹配
  if (bestWindowStart < 0) {
    const pos = mergedPositions[0]
    const remainingLength = Math.max(0, LENGTH_CONFIG.TARGET_LENGTH - (pos.end - pos.start))
    const contextBefore = Math.floor(remainingLength / 2)
    const start = Math.max(0, pos.start - contextBefore)
    const end = Math.min(originalText.length, Math.max(pos.end, start + LENGTH_CONFIG.TARGET_LENGTH))

    return escapeHtml(originalText.slice(start, pos.start)) + `<mark>${escapeHtml(originalText.slice(pos.start, pos.end))}</mark>` + escapeHtml(originalText.slice(pos.end, end))
  }

  // 在最佳范围内找到一个高亮位置
  const bestWindowEnd = bestWindowStart + WINDOW_SIZE
  const targetHighlight = mergedPositions.find(pos => pos.start >= bestWindowStart && pos.end <= bestWindowEnd) || mergedPositions[0]

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

  for (const pos of mergedPositions) {
    if (pos.end < finalStart || pos.start > finalEnd) {
      continue
    }

    if (pos.start > lastPos) {
      result += escapeHtml(originalText.slice(lastPos, pos.start))
    }

    const highlightStart = Math.max(finalStart, pos.start)
    const highlightEnd = Math.min(finalEnd, pos.end)
    result += `<mark>${escapeHtml(originalText.slice(highlightStart, highlightEnd))}</mark>`

    lastPos = highlightEnd
  }

  if (lastPos < finalEnd) {
    result += escapeHtml(originalText.slice(lastPos, finalEnd))
  }

  return result
}
