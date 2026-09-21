import type { II18nService } from '@slax-reader/selection/adapters'
import { useNuxtApp } from '#app'

/**
 * Dweb端国际化服务
 *
 * 使用Nuxt的i18n插件
 */
export class DwebI18nService implements II18nService {
  t(key: string): string {
    return useNuxtApp().$i18n.t(key)
  }
}
