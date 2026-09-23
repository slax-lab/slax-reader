// TagCandidatePopover 组件单测
// props: selectedIds / candidates / loading
// emit: pick / close
// 搜索框按子串过滤；空 → no_candidates；Escape / 点击外部 → close
import TagCandidatePopover from '~~/app/components/BookmarkList/TagCandidatePopover.vue'

import type { BookmarkTag } from '@commons/frontend-types/models'
import { mountWithApp } from '~~/tests/setup/mount'
import { describe, expect, it } from 'vitest'

const candidates = [
  { id: 'c1', name: 'startup', show_name: 'startup', source: 'mine', count: 12 },
  { id: 'c2', name: 'design', show_name: 'design', source: 'auto', count: 3 }
] as unknown as BookmarkTag[]

describe('components/BookmarkList/TagCandidatePopover', () => {
  it('lists every candidate as a TagChip with its count', () => {
    const w = mountWithApp(TagCandidatePopover, { props: { selectedIds: ['a'], candidates } })
    const chips = w.findAll('.tag-chip')
    expect(chips.length).toBe(2)
    expect(chips[0]!.find('.tag-count').text()).toBe('12')
    expect(w.find('input').attributes('placeholder')).toBe('Enter new tag')
    expect(w.find('.candidate-empty').exists()).toBe(false)
  })

  it('filters candidates by substring (case-insensitive)', async () => {
    const w = mountWithApp(TagCandidatePopover, { props: { selectedIds: ['a'], candidates } })
    await w.find('input').setValue('DES')
    const chips = w.findAll('.tag-chip')
    expect(chips.length).toBe(1)
    expect(chips[0]!.text()).toContain('design')
  })

  it('shows no_candidates when nothing matches or list is empty', async () => {
    const w = mountWithApp(TagCandidatePopover, { props: { selectedIds: ['a'], candidates: [] } })
    expect(w.find('.candidate-empty').text()).toBe('No more tags to add')

    const w2 = mountWithApp(TagCandidatePopover, { props: { selectedIds: ['a'], candidates } })
    await w2.find('input').setValue('zzz')
    expect(w2.find('.candidate-empty').exists()).toBe(true)
  })

  it('shows the spinner instead of the list while loading', () => {
    const w = mountWithApp(TagCandidatePopover, { props: { selectedIds: ['a'], candidates, loading: true } })
    expect(w.find('.candidate-loading').exists()).toBe(true)
    expect(w.find('.tag-chip').exists()).toBe(false)
    expect(w.find('.candidate-empty').exists()).toBe(false)
  })

  it('emits pick with the tag on chip click', async () => {
    const w = mountWithApp(TagCandidatePopover, { props: { selectedIds: ['a'], candidates } })
    await w.findAll('.tag-chip')[1]!.trigger('click')
    expect(w.emitted('pick')![0]).toEqual([candidates[1]])
  })

  it('emits close on Escape', async () => {
    const w = mountWithApp(TagCandidatePopover, { props: { selectedIds: ['a'], candidates } })
    await w.find('input').trigger('keydown', { key: 'Escape' })
    expect(w.emitted('close')).toBeTruthy()
  })

  it('emits close on click outside', async () => {
    const w = mountWithApp(TagCandidatePopover, { props: { selectedIds: ['a'], candidates }, attachTo: document.body })
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await w.vm.$nextTick()
    expect(w.emitted('close')).toBeTruthy()
    w.unmount()
  })
})
