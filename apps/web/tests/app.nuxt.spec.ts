// @noErrors
import App from '~/app.vue'

import { renderSuspended } from '@nuxt/test-utils/runtime'
import { fireEvent, screen, waitFor } from '@testing-library/vue'
import { getI18nLang } from '~~/i18n/config'
import { createPinia } from 'pinia'
import { describe, expect, it } from 'vitest'
import { createI18n } from 'vue-i18n'

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: getI18nLang()
})

const pinia = createPinia()

describe('首页测试', () => {
  it.skip('登录页导航', async () => {
    // 渲染页面
    await renderSuspended(App, {
      route: '/',
      global: {
        plugins: [i18n, pinia]
      }
    })

    const button = screen.getByRole('button', { name: 'Login' })

    await fireEvent.click(button)
    await waitFor(() => expect(document.location.href).toMatch(`/login`))
    expect(screen.getByText('Slax Reader')).toBeDefined()
  })
})
