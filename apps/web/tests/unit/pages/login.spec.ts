import { nextTick, reactive } from 'vue'

import LoginPage from '~~/app/pages/login.vue'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { mountWithApp } from '~~/tests/setup/mount'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const route = reactive({ query: {} as Record<string, string> })
mockNuxtImport('useRoute', () => () => route)
mockNuxtImport('analyticsLog', () => vi.fn())

describe('login page acquisition attribution', () => {
  beforeEach(() => {
    route.query = {}
  })

  it('passes a direct triplet and reacts to same-route query changes', async () => {
    route.query = { utm_source: 'hackerlinks', utm_campaign: 'mvp', utm_medium: 'header', utm_content: 'zh' }
    const wrapper = mountWithApp(LoginPage)
    expect(wrapper.findComponent({ name: 'LoginView' }).props('authAttribution')).toEqual({ source: 'hackerlinks', campaign: 'mvp', medium: 'header' })
    route.query = { utm_source: 'hackerlinks', utm_campaign: 'mvp', utm_medium: 'resource_detail' }
    await nextTick()
    expect(wrapper.findComponent({ name: 'LoginView' }).props('authAttribution')).toEqual({ source: 'hackerlinks', campaign: 'mvp', medium: 'resource_detail' })
    route.query = { utm_source: 'hackerlinks', utm_campaign: 'mvp' }
    await nextTick()
    expect(wrapper.findComponent({ name: 'LoginView' }).props('authAttribution')).toBeUndefined()
  })

  it('passes no attribution for a direct partial triplet', () => {
    route.query = { utm_source: 'hackerlinks', utm_campaign: 'mvp' }
    const wrapper = mountWithApp(LoginPage)
    expect(wrapper.findComponent({ name: 'LoginView' }).props('authAttribution')).toBeUndefined()
  })
})
