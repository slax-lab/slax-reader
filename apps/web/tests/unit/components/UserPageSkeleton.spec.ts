// UserPageSkeleton 组件单测
// 验证骨架屏关键元素渲染正确
import UserPageSkeleton from '~~/app/components/UserPageSkeleton.vue'

import { mountWithApp } from '~~/tests/setup/mount'
import { describe, expect, it } from 'vitest'

describe('UserPageSkeleton', () => {
  it('渲染 .skeleton 元素数量 ≥ 1', () => {
    const wrapper = mountWithApp(UserPageSkeleton, {})
    expect(wrapper.findAll('.skeleton').length).toBeGreaterThanOrEqual(1)
  })

  it('渲染 .skeleton-avatar', () => {
    const wrapper = mountWithApp(UserPageSkeleton, {})
    expect(wrapper.find('.skeleton-avatar').exists()).toBe(true)
  })

  it('渲染 .skeleton-title', () => {
    const wrapper = mountWithApp(UserPageSkeleton, {})
    expect(wrapper.find('.skeleton-title').exists()).toBe(true)
  })

  it('渲染 .skeleton-username', () => {
    const wrapper = mountWithApp(UserPageSkeleton, {})
    expect(wrapper.find('.skeleton-username').exists()).toBe(true)
  })

  it('渲染 .skeleton-email', () => {
    const wrapper = mountWithApp(UserPageSkeleton, {})
    expect(wrapper.find('.skeleton-email').exists()).toBe(true)
  })
})
