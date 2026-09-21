/**
 * 核心逻辑统一导出
 */

export * from './Base'
export * from './SelectionMonitor'
export * from './MarkRenderer'
export * from './utils'

// MarkManager和ArticleSelection都导出了IMarkModal和Ref，需要明确导出
export { MarkManager, type Ref } from './MarkManager'
export { ArticleSelection, type IMarkModal } from './ArticleSelection'
