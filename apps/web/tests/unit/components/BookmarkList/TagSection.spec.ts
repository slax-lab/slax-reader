// TagSection 组件单测
// props: title / hint / tags / promotable / editable
// emit: select / promote / edit
// tags 空 → 渲染 #empty slot
import TagSection from '~~/app/components/BookmarkList/TagSection.vue'

import type { BookmarkTag } from '@commons/types/interface'
import { mountWithApp } from '~~/tests/setup/mount'
import { describe, expect, it } from 'vitest'

const tags = [
  { id: 'a', name: 'alpha', show_name: 'alpha', source: 'mine' },
  { id: 'b', name: 'beta', show_name: 'beta', source: 'auto' }
] as unknown as BookmarkTag[]

describe('components/BookmarkList/TagSection', () => {
  it('renders title, hint and one TagChip per tag', () => {
    const w = mountWithApp(TagSection, { props: { title: 'My tags', hint: 'hint text', tags } })
    expect(w.find('.tag-section-title').text()).toBe('My tags')
    expect(w.find('.tag-section-hint').text()).toBe('hint text')
    expect(w.findAll('.tag-chip').length).toBe(2)
    expect(w.find('.tags-cells').exists()).toBe(true)
    // 默认不可编辑、不可提升
    expect(w.find('.tag-edit-btn').exists()).toBe(false)
    expect(w.find('.tag-act.promote').exists()).toBe(false)
  })

  it('omits the hint element when no hint given', () => {
    const w = mountWithApp(TagSection, { props: { title: 'Auto tags', tags } })
    expect(w.find('.tag-section-hint').exists()).toBe(false)
  })

  it('emits select on chip click, promote on ↑, edit on the pencil', async () => {
    const w = mountWithApp(TagSection, { props: { title: 't', tags, promotable: true, editable: true } })
    await w.findAll('.tag-chip')[1]!.trigger('click')
    expect(w.emitted('select')![0]).toEqual([tags[1]])

    await w.findAll('.tag-act.promote')[0]!.trigger('click')
    expect(w.emitted('promote')![0]).toEqual([tags[0]])

    await w.findAll('.tag-edit-btn')[0]!.trigger('click')
    expect(w.emitted('edit')![0]).toEqual([tags[0]])
    // 编辑按钮不触发 select
    expect(w.emitted('select')!.length).toBe(1)
  })

  it('renders the empty slot instead of chips when tags is empty', () => {
    const w = mountWithApp(TagSection, {
      props: { title: 't', tags: [] },
      slots: { empty: '<div class="onboarding">pick some</div>' }
    })
    expect(w.find('.tags-cells').exists()).toBe(false)
    expect(w.find('.onboarding').text()).toBe('pick some')
  })
})
