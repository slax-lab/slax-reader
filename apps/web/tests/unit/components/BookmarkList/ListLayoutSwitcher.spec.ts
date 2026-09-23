import ListLayoutSwitcher from '~~/app/components/BookmarkList/ListLayoutSwitcher.vue'

import { mountWithApp } from '~~/tests/setup/mount'
import { describe, expect, it } from 'vitest'

describe('components/BookmarkList/ListLayoutSwitcher', () => {
  it('默认显示最近更新时间', () => {
    const wrapper = mountWithApp(ListLayoutSwitcher, {
      props: { modelValue: 'card', lastUpdatedText: 'Updated 2 minutes ago' }
    })

    expect(wrapper.find('.page-subtitle').text()).toBe('Updated 2 minutes ago')
  })

  it('showLeading=true 时用 leading slot 替换最近更新时间', () => {
    const wrapper = mountWithApp(ListLayoutSwitcher, {
      props: { modelValue: 'card', lastUpdatedText: 'Updated 2 minutes ago', showLeading: true },
      slots: { leading: '<div class="source-filter-tag">example.com</div>' }
    })

    expect(wrapper.find('.page-subtitle').exists()).toBe(false)
    expect(wrapper.find('.source-filter-tag').text()).toBe('example.com')
    expect(wrapper.find('.page-toolbar').classes()).toContain('has-leading')
  })
})
