// BookmarkTags compact 模式：按可用宽度裁剪能完整显示的 tag chip 数量。
// 纯函数，不摸 DOM —— 调用方（BookmarkTags.vue）负责测量 chip 实际宽度后传入，
// 方便在没有真实布局引擎的测试环境里直接验证裁剪逻辑。
export const computeVisibleTagCount = (params: { availableWidth: number; chipWidths: number[]; gap: number; addButtonWidth: number; safetyMargin: number }): number => {
  const { availableWidth, chipWidths, gap, addButtonWidth, safetyMargin } = params
  const usable = availableWidth - addButtonWidth - safetyMargin

  let used = 0
  let count = 0
  for (const width of chipWidths) {
    const next = used + width + (count > 0 ? gap : 0)
    if (next > usable) break
    used = next
    count++
  }

  return count
}
