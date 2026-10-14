import { $t } from '@/utils/locale'

import type { II18nService } from '@slax-reader/selection/adapters'

/**
 * Extensions端国际化服务
 *
 * 使用全局$t函数
 */
export class ExtensionsI18nService implements II18nService {
  t(key: string): string {
    // 由于 commons/selection 使用通用 string key，而本地 $t 使用强类型 key
    // 这里需要类型断言来兼容
    // @ts-expect-error - $t 使用强类型 key，但 II18nService 要求通用 string
    return $t(key)
  }
}
