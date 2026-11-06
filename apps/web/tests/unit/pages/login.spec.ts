import LoginPage from '~~/app/pages/login.vue'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { mountWithApp } from '~~/tests/setup/mount'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const route = vi.hoisted(() => ({ query: {} as Record<string, string> }))
mockNuxtImport('useRoute', () => () => route)
mockNuxtImport('analyticsLog', () => vi.fn())

describe('login page acquisition attribution', () => {
  beforeEach(() => {
    route.query = {}
  })

  it('passes a direct valid HackerLinks triplet to the provider view', () => {
    route.query = { utm_source: 'hackerlinks', utm_campaign: 'mvp', utm_medium: 'header', utm_content: 'zh' }
    const wrapper = mountWithApp(LoginPage)
    expect(wrapper.findComponent({ name: 'LoginView' }).props('authAttribution')).toEqual({ source: 'hackerlinks', campaign: 'mvp', medium: 'header' })
  })

  it('passes no attribution for a direct partial triplet', () => {
    route.query = { utm_source: 'hackerlinks', utm_campaign: 'mvp' }
    const wrapper = mountWithApp(LoginPage)
    expect(wrapper.findComponent({ name: 'LoginView' }).props('authAttribution')).toBeUndefined()
  })
})
