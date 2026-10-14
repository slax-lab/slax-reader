// apps/slax-reader-dweb/tests/setup/mount.ts
import { createTestPinia } from './pinia'
import { mount, type MountingOptions } from '@vue/test-utils'
import { imeGuard } from '~~/app/directives/imeGuard'
import { getI18nLang } from '~~/i18n/config'
import { createI18n } from 'vue-i18n'

export const createTestI18n = (locale: 'en' | 'zh' = 'en') => createI18n({ legacy: false, locale, messages: getI18nLang() })

// 注意 plugin 顺序：caller 传入的 plugins 在前，默认 i18n + pinia 在后。
// 默认插件放在 caller 插件之后，因为 vue-i18n / pinia 在 install 时是
// "first plugin wins"；这样 caller 注入的 locale / store 才能生效。
//
// v-ime-guard 由 Nuxt 插件（app/plugins/ime-guard.ts）注册，测试环境不跑插件生命周期，
// 这里手动挂到全局指令，保持与生产一致行为。
export const mountWithApp = <T>(component: T, options: MountingOptions<any> = {}) =>
  mount(component as any, {
    ...options,
    global: {
      ...options.global,
      plugins: [...(options.global?.plugins ?? []), createTestI18n(), createTestPinia()],
      directives: {
        'ime-guard': imeGuard,
        ...(options.global?.directives ?? {})
      }
    }
  })
