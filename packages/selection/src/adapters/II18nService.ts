/**
 * 国际化服务适配器接口
 *
 * 用于统一dweb和extensions的国际化调用方式
 */
export interface II18nService {
  /**
   * 翻译文本
   * @param key 翻译键
   * @returns 翻译后的文本
   */
  t(key: string): string
}
