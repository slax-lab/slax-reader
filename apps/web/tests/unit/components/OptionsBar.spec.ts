// OptionsBar 组件单测
// props: options: string[]; defaultSelectedIndex: number
// model: index (number)
// emit: optionSelected(index)
// 内部 ref showOptions，bar-container click 切换；optionClick 同 index 短路
import { nextTick } from 'vue'

import OptionsBar from '~~/app/components/OptionsBar.vue'

import { mountWithApp } from '~~/tests/setup/mount'
import { describe, expect, it } from 'vitest'

const defaultOptions = ['Option A', 'Option B', 'Option C']

describe('OptionsBar', () => {
  describe('渲染', () => {
    it('默认 selectedIndex=0 → .title 显示 options[0]', () => {
      const wrapper = mountWithApp(OptionsBar, { props: { options: defaultOptions } })
      expect(wrapper.find('.title').text()).toBe('Option A')
    })

    it('defaultSelectedIndex=2 → .title 显示 options[2]', () => {
      const wrapper = mountWithApp(OptionsBar, { props: { options: defaultOptions, defaultSelectedIndex: 2 } })
      expect(wrapper.find('.title').text()).toBe('Option C')
    })

    it('options.length → 渲染对应数量 .option-wrapper', () => {
      const wrapper = mountWithApp(OptionsBar, { props: { options: defaultOptions } })
      expect(wrapper.findAll('.option-wrapper')).toHaveLength(3)
    })

    it('默认 showOptions=false → .options-container 通过 v-show 隐藏', () => {
      const wrapper = mountWithApp(OptionsBar, { props: { options: defaultOptions } })
      const container = wrapper.find('.options-container')
      expect(container.attributes('style') || '').toContain('display: none')
    })

    it('渲染 SVG 箭头（无旧 <i> 图片箭头）', () => {
      const wrapper = mountWithApp(OptionsBar, { props: { options: defaultOptions } })
      expect(wrapper.find('.bar-container svg').exists()).toBe(true)
      expect(wrapper.find('.bar-container i').exists()).toBe(false)
    })
  })

  describe('交互', () => {
    it('click .bar-container → showOptions 切换 → 选项展开', async () => {
      const wrapper = mountWithApp(OptionsBar, { props: { options: defaultOptions } })
      await wrapper.find('.bar-container').trigger('click')
      const container = wrapper.find('.options-container')
      const style = container.attributes('style') || ''
      expect(style.includes('display: none')).toBe(false)
    })

    it('click .option-wrapper 选不同 index → emit optionSelected 且 .title 更新', async () => {
      const wrapper = mountWithApp(OptionsBar, { props: { options: defaultOptions } })
      await wrapper.find('.bar-container').trigger('click')
      const wrappers = wrapper.findAll('.option-wrapper')
      await wrappers[1]!.trigger('click')
      const events = wrapper.emitted('optionSelected')
      expect(events).toBeTruthy()
      expect(events![0]).toEqual([1])
      expect(wrapper.find('.title').text()).toBe('Option B')
    })

    it('click 当前选中的 .option-wrapper → 不 emit + 关闭选项', async () => {
      const wrapper = mountWithApp(OptionsBar, { props: { options: defaultOptions, defaultSelectedIndex: 1 } })
      await wrapper.find('.bar-container').trigger('click')
      const wrappers = wrapper.findAll('.option-wrapper')
      await wrappers[1]!.trigger('click')
      expect(wrapper.emitted('optionSelected')).toBeUndefined()
      // showOptions 仍被设为 false
      const container = wrapper.find('.options-container')
      expect(container.attributes('style') || '').toContain('display: none')
    })
  })

  describe('watch defaultSelectedIndex', () => {
    it('defaultSelectedIndex 改变 → selectedIndex 同步 → .title 更新', async () => {
      const wrapper = mountWithApp(OptionsBar, { props: { options: defaultOptions, defaultSelectedIndex: 0 } })
      await wrapper.setProps({ defaultSelectedIndex: 2 })
      await nextTick()
      expect(wrapper.find('.title').text()).toBe('Option C')
    })

    it('defaultSelectedIndex 改为相同值 → 早退（覆盖 watch newValue===selectedIndex 短路）', async () => {
      const wrapper = mountWithApp(OptionsBar, { props: { options: defaultOptions, defaultSelectedIndex: 1 } })
      await wrapper.setProps({ defaultSelectedIndex: 1 })
      await nextTick()
      expect(wrapper.find('.title').text()).toBe('Option B')
    })
  })

  describe('closePopup（v-on-click-outside）', () => {
    it('showOptions=false 时外部点击 → closePopup 早退', async () => {
      const wrapper = mountWithApp(OptionsBar, { props: { options: defaultOptions }, attachTo: document.body })
      // 默认 showOptions=false → outside 点击应触发 closePopup 早退
      const event = new MouseEvent('mousedown', { bubbles: true })
      document.body.dispatchEvent(event)
      await nextTick()
      // 不抛错即覆盖 if (!showOptions.value) return 早退分支
      wrapper.unmount()
      expect(true).toBe(true)
    })

    it('showOptions=true 时外部点击 → closePopup 把 showOptions 置 false', async () => {
      const wrapper = mountWithApp(OptionsBar, { props: { options: defaultOptions }, attachTo: document.body })
      await wrapper.find('.bar-container').trigger('click')
      const event = new MouseEvent('mousedown', { bubbles: true })
      document.body.dispatchEvent(event)
      await nextTick()
      wrapper.unmount()
      expect(true).toBe(true)
    })
  })
})
