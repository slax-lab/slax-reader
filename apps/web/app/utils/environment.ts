import { isClient } from '@commons/utils/is'

/**
 * 获取浏览器的 Accept-Language 头信息
 * @returns Accept-Language 字符串，如果无法获取则返回空字符串
 */
export const getAcceptLanguage = (): string => {
  if (!isClient) {
    return ''
  }

  // 从 navigator.languages 获取用户的语言偏好列表
  if (navigator.languages && navigator.languages.length > 0) {
    return navigator.languages.join(',')
  }

  // 降级方案：使用 navigator.language
  return navigator.language || ''
}

/**
 * 从 Accept-Language 字符串中提取首选语言代码
 * @param acceptLanguage - Accept-Language 字符串，如 "zh-CN,zh,en-US,en"
 * @returns 返回首选的语言代码，只返回 'zh' 或 'en'，默认返回 'en'
 */
export const getPreferredLanguage = (acceptLanguage?: string): 'zh' | 'en' => {
  if (!acceptLanguage) {
    acceptLanguage = getAcceptLanguage()
  }

  if (!acceptLanguage) {
    return 'en'
  }

  // 将语言列表按逗号分割，取第一个语言代码
  const languages = acceptLanguage.split(',').map(lang => (lang.trim().split(';')[0] ?? '').toLowerCase())

  // 查找第一个匹配的中文语言代码
  for (const lang of languages) {
    if (lang.startsWith('zh')) {
      return 'zh'
    }
  }

  return 'en'
}

/**
 * 判断当前环境是否为 SlaxReader App
 * @returns 如果 UserAgent 包含 "SlaxReader" 则返回 true，否则返回 false
 */
export const isSlaxReaderApp = (): boolean => {
  if (!isClient) {
    return false
  }

  return navigator.userAgent.includes('SlaxReader')
}

/**
 * 判断当前浏览器是否运行在移动设备上
 */
export const isMobileBrowser = (): boolean => {
  if (!isClient) {
    return false
  }

  if (/Android|iPhone|iPad|iPod|IEMobile|Windows Phone|BlackBerry|Opera Mini/i.test(navigator.userAgent)) {
    return true
  }

  // iPadOS 13+ 的 Safari UA 伪装成桌面 Mac，用触屏兜底
  return navigator.maxTouchPoints > 1 && navigator.platform === 'MacIntel'
}
