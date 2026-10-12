import { getI18nLang } from '~~/i18n/config'
import { createI18n } from 'vue-i18n'

// 项目 i18n 仅配置 en / zh 两个 locale（layers/core/i18n/config.ts）
// 不要写 zh-CN，否则 vue-i18n 找不到 messages 会退回到 key 文本
export const createTestI18n = (locale: 'en' | 'zh' = 'en') => createI18n({ legacy: false, locale, messages: getI18nLang() })
