import CollectionPager from '~~/app/components/Collection/CollectionPager.vue'

import { mountWithApp } from '../../../setup/mount'
import { describe, expect, it } from 'vitest'

const mountPager = (page: number, totalPages = 20) =>
  mountWithApp(CollectionPager, {
    props: { page, totalPages }
  })

const pageLabels = (wrapper: ReturnType<typeof mountPager>) => wrapper.findAll('.cp-pager-num').map(item => item.text())
const ellipsisTargets = (wrapper: ReturnType<typeof mountPager>) =>
  (wrapper.vm as unknown as { items: Array<{ type: string; target?: number }> }).items.filter(item => item.type === 'ellipsis').map(item => item.target)

describe('Collection/CollectionPager', () => {
  it('renders all pages without ellipses when the page count fits', () => {
    const wrapper = mountPager(4, 7)

    expect(pageLabels(wrapper)).toEqual(['1', '2', '3', '4', '5', '6', '7'])
    expect(wrapper.find('.cp-pager-ellipsis').exists()).toBe(false)
  })

  it('keeps the last page visible and provides a forward group jump near the start', () => {
    const wrapper = mountPager(3)

    expect(pageLabels(wrapper)).toEqual(['1', '2', '3', '4', '5', '6', '20'])
    expect(ellipsisTargets(wrapper)).toEqual([8])
    expect(wrapper.find('.cp-pager-ellipsis').attributes('aria-label')).toBe('Next page group')
  })

  it('keeps both boundary pages and provides group jumps around a middle page', () => {
    const wrapper = mountPager(10)
    const jumps = wrapper.findAll('.cp-pager-ellipsis')

    expect(pageLabels(wrapper)).toEqual(['1', '8', '9', '10', '11', '12', '20'])
    expect(ellipsisTargets(wrapper)).toEqual([5, 15])
    expect(jumps.map(link => link.attributes('aria-label'))).toEqual(['Previous page group', 'Next page group'])
  })

  it('keeps the first page visible and provides a backward group jump near the end', () => {
    const wrapper = mountPager(18)

    expect(pageLabels(wrapper)).toEqual(['1', '15', '16', '17', '18', '19', '20'])
    expect(ellipsisTargets(wrapper)).toEqual([13])
    expect(wrapper.find('.cp-pager-ellipsis').attributes('aria-label')).toBe('Previous page group')
  })
})
