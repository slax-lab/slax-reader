import { computeVisibleTagCount } from '~~/app/utils/tagOverflow'

import { describe, expect, it } from 'vitest'

describe('utils/tagOverflow', () => {
  it('全部 chip 加起来仍在可用宽度内：返回全部数量', () => {
    const count = computeVisibleTagCount({
      availableWidth: 400,
      chipWidths: [50, 60, 40],
      gap: 8,
      addButtonWidth: 28,
      safetyMargin: 28
    })
    expect(count).toBe(3)
  })

  it('宽度只够放下前两个：第三个开始截断', () => {
    const count = computeVisibleTagCount({
      availableWidth: 150,
      chipWidths: [50, 60, 40],
      gap: 8,
      addButtonWidth: 28,
      safetyMargin: 28
    })
    // usable = 150 - 28 - 28 = 94；50 放下（used=50）；+8+60=118 > 94 截断
    expect(count).toBe(1)
  })

  it('可用宽度为 0 或负：一个都不放', () => {
    expect(computeVisibleTagCount({ availableWidth: 0, chipWidths: [10], gap: 8, addButtonWidth: 28, safetyMargin: 28 })).toBe(0)
    expect(computeVisibleTagCount({ availableWidth: -100, chipWidths: [10], gap: 8, addButtonWidth: 28, safetyMargin: 28 })).toBe(0)
  })

  it('空 chip 列表：返回 0', () => {
    expect(computeVisibleTagCount({ availableWidth: 400, chipWidths: [], gap: 8, addButtonWidth: 28, safetyMargin: 28 })).toBe(0)
  })

  it('gap 只在第二个及之后的 chip 前累加，第一个不算 gap', () => {
    // usable = 100 - 28 - 28 = 44；单个 chip 宽度 44 恰好放下（不含 gap）
    const count = computeVisibleTagCount({ availableWidth: 100, chipWidths: [44], gap: 8, addButtonWidth: 28, safetyMargin: 28 })
    expect(count).toBe(1)
  })

  it('恰好卡在边界：next === usable 时算放得下', () => {
    // usable = 100 - 20 - 20 = 60；单 chip 宽度 60，next=60，不超过 usable
    const count = computeVisibleTagCount({ availableWidth: 100, chipWidths: [60], gap: 8, addButtonWidth: 20, safetyMargin: 20 })
    expect(count).toBe(1)
  })
})
