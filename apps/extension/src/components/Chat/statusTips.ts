import { $t } from '@/utils/locale'

import type { GeneratedI18nStructure } from '#i18n'
export type LocalizedToolTip =
  { tool: 'generateQuestion'; status: 'processing' } | { tool: 'search' | 'browser' | 'searchBookmark'; status: 'processing' | 'finished' | 'failed'; subject?: string }
export const getToolTipMessage = (tip: LocalizedToolTip): { key: keyof GeneratedI18nStructure; params?: string[] } => {
  if (tip.tool === 'generateQuestion') return { key: 'component.chat_bot.generating_question' }
  if (tip.status === 'processing') {
    const key = tip.tool === 'search' ? 'tips_searching' : tip.tool === 'searchBookmark' ? 'tips_searching_bookmark' : tip.subject ? 'tips_accessing' : 'now_accessing'
    return { key: `component.chat_bot.${key}`, params: [tip.subject ?? ''] }
  }
  const prefix = tip.tool === 'search' ? 'search' : tip.tool === 'browser' ? 'access' : 'search_bookmark'
  const key = `component.chat_bot.${prefix}_${tip.status === 'finished' ? 'complete' : 'failed'}${tip.subject ? '_subject' : ''}` as keyof GeneratedI18nStructure
  return { key, params: tip.subject ? [tip.subject] : undefined }
}
export const formatToolTip = (tip: LocalizedToolTip) => {
  const { key, params } = getToolTipMessage(tip)
  return $t(key, params)
}
