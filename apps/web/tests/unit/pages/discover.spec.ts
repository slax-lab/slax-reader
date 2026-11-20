import DiscoverPage from '~~/app/pages/discover.vue'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, expect, it, vi } from 'vitest'

const { get } = vi.hoisted(() => ({ get: vi.fn() }))
mockNuxtImport('request', () => () => ({ get }))
mockNuxtImport('useLabFeatures', () => () => ({ fetch: async () => {}, isEnabled: () => true }))
mockNuxtImport('useHead', () => () => {})
mockNuxtImport('useI18n', () => () => ({ t: (key: string) => key }))
enableAutoUnmount(afterEach)

it('shows the first three members under each Collection and keeps single-member picks readable', async () => {
  const collection = (code: string, titles: string[]) => ({
    code, name: code, description: '',
    articles: titles.map(title => ({ title, bookmarkUuid: title, url: 'https://example.org/' + title, description: 'Excerpt for ' + title }))
  })
  get.mockResolvedValue({
    items: [
      collection('first', ['a', 'b', 'c', 'extra']),
      collection('single', ['d']),
      collection('second', ['e', 'f'])
    ]
  })
  const wrapper = mountWithApp(DiscoverPage, { global: { stubs: { BookmarksTopBar: true, AppIcon: true } } })
  await flushPromises()

  expect(get).toHaveBeenCalledWith({ url: '/v1/recommendations/collections', query: { limit: 36 }, headers: { Accept: 'application/vnd.slax.discovery+json' } })
  const groups = wrapper.findAll('.spotlight')
  expect(groups.map(group => group.get('.spot-collection').attributes('href'))).toEqual(['/c/first', '/c/second'])
  expect(groups.map(group => group.findAll('.lead-link, .related a').map(link => link.attributes('href')))).toEqual([['/b/a', '/b/b', '/b/c'], ['/b/e', '/b/f']])
  expect(groups[0].get('.spot-collection strong').text()).toBe('first')
  expect(groups[0].findAll('.related-source').map(source => source.text())).toEqual(['example.org', 'example.org'])
  expect(groups[0].get('.lead-excerpt').text()).toBe('Excerpt for a')
  expect(wrapper.get('#single-picks .article-link').attributes('href')).toBe('/b/d')
  expect(wrapper.get('#single-picks .single-source').attributes('href')).toBe('/c/single')
})

it('opens different topics across real Collections and rotates through distinct member links', async () => {
  const collection = (code: string, titles: string[]) => ({
    code, name: code, description: '',
    articles: titles.map((title, index) => ({ title, bookmarkUuid: code + index, url: 'https://example.org/' + code + index }))
  })
  get.mockResolvedValue({ items: [
    collection('one', ['Unrelated lead', 'Building with Codex', 'Designing with Figma']),
    collection('two', ['Claude Code in practice', 'Figma at work']),
    collection('three', ['Vibe Coding', 'A different story'])
  ] })
  const wrapper = mountWithApp(DiscoverPage, { global: { stubs: { BookmarksTopBar: true, AppIcon: true } } })
  await flushPromises()
  const links = () => wrapper.findAll('.lead-link').map(a => a.attributes('href'))
  expect(links()).toEqual(['/b/one0', '/b/two0'])
  const tabs = wrapper.findAll('.topic-nav button')
  await tabs[1].trigger('click')
  expect(links()).toEqual(['/b/one1', '/b/two0'])
  await wrapper.get('.rotate').trigger('click')
  expect(links()).toEqual(['/b/three0', '/b/one1'])
  await tabs[2].trigger('click')
  expect(tabs[2].attributes('aria-pressed')).toBe('true')
  expect(links()).toEqual(['/b/one2', '/b/two1'])
  expect(wrapper.find('.rotate').exists()).toBe(false)
  expect(wrapper.get('.collection-card .collection-link').attributes('href')).toBe('/c/three')
  await tabs[0].trigger('click')
  expect(links()).toEqual(['/b/one0', '/b/two0'])
})
