import SnapshotArticleSource from '~~/app/components/Snapshot/SnapshotArticleSource.vue'

import { mountWithApp } from '~~/tests/setup/mount'
import { describe, expect, it } from 'vitest'

const mountSource = (props: InstanceType<typeof SnapshotArticleSource>['$props']) => mountWithApp(SnapshotArticleSource, { props })

describe('SnapshotArticleSource', () => {
  it('uses column, site and domain in priority order', () => {
    const column = mountSource({ url: 'https://example.com/post', columnName: 'The Column', siteName: 'Example' })
    const site = mountSource({ url: 'https://example.com/post', siteName: 'Example' })
    const domain = mountSource({ url: 'https://www.example.com/post' })

    expect(column.find('.article-source-name').text()).toBe('The Column')
    expect(site.find('.article-source-name').text()).toBe('Example')
    expect(domain.find('.article-source-name').text()).toBe('example.com')
  })

  it('renders the parsed author when present and omits its separator otherwise', () => {
    const withAuthor = mountSource({ url: 'https://example.com/post', siteName: 'Example', author: 'Jane Doe' })
    const withoutAuthor = mountSource({ url: 'https://example.com/post' })

    expect(withAuthor.find('.article-source-author').text()).toBe('Jane Doe')
    expect(withAuthor.find('.article-source-separator').text()).toBe('·')
    expect(withoutAuthor.find('.article-source-author').exists()).toBe(false)
    expect(withoutAuthor.find('.article-source-separator').exists()).toBe(false)
  })

  it('normalizes X and gets the author handle from the URL', () => {
    const wrapper = mountSource({ url: 'https://x.com/jack/status/20', siteName: 'Twitter', author: 'Jack Dorsey' })

    expect(wrapper.find('.article-source-name').text()).toBe('X')
    expect(wrapper.find('.article-source-author').text()).toBe('@jack')
  })

  it('links to the original URL and shows the external-link mark', () => {
    const wrapper = mountSource({ url: 'example.com/post' })

    expect(wrapper.attributes('href')).toBe('https://example.com/post')
    expect(wrapper.attributes('target')).toBe('_blank')
    expect(wrapper.find('.article-source-external').text()).toBe('↗')
  })
})
