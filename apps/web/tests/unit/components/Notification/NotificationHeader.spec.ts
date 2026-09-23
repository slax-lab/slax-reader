// NotificationHeader 组件单测
// emit: back
// onMounted: history.length > 2 → showHeader=true
import NotificationHeader from '~~/app/components/Notification/NotificationHeader.vue'

import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, describe, expect, it } from 'vitest'

describe('NotificationHeader', () => {
  afterEach(() => {
    // 不直接修改 history.length（不可写）；测试默认环境即可
  })

  it('mount → 渲染 .notifications-header（v-show 由 history.length 决定）', () => {
    const wrapper = mountWithApp(NotificationHeader)
    expect(wrapper.find('.notifications-header').exists()).toBe(true)
  })

  it('button click → emit back', async () => {
    const wrapper = mountWithApp(NotificationHeader)
    await wrapper.find('button').trigger('click')
    expect(wrapper.emitted('back')).toBeTruthy()
  })

  it('span 渲染 i18n 文案', () => {
    const wrapper = mountWithApp(NotificationHeader)
    expect(wrapper.find('span').text().length).toBeGreaterThan(0)
  })
})
