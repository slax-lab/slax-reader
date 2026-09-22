import TagChip from '~/components/BookmarkList/TagChip.vue'

import { mountWithApp } from '../../../setup/mount'
import type { BookmarkTag } from '@commons/contracts/interface'
import { describe, expect, it, vi } from 'vitest'

const tag: BookmarkTag = { id: 1, name: '创业', show_name: '创业', source: 'mine' }

describe('components/BookmarkList/TagChip', () => {
  it('renders name, count and the AI mark', () => {
    const w = mountWithApp(TagChip, { props: { tag, count: 12, aiMark: true } })
    expect(w.text()).toContain('创业')
    expect(w.find('.tag-count').text()).toBe('12')
    expect(w.find('.tag-ai').exists()).toBe(true)
    expect(w.classes()).toContain('mine')
  })

  it('shows no count, no mark, no buttons by default', () => {
    const w = mountWithApp(TagChip, { props: { tag: { ...tag, source: 'auto' } } })
    expect(w.find('.tag-count').exists()).toBe(false)
    expect(w.find('.tag-ai').exists()).toBe(false)
    expect(w.find('.tag-act').exists()).toBe(false)
    expect(w.classes()).not.toContain('mine')
    expect(w.classes()).not.toContain('has-acts')
  })

  it('reserves the action gutter only on chips that have actions', () => {
    expect(mountWithApp(TagChip, { props: { tag, removable: true } }).classes()).toContain('has-acts')
    expect(mountWithApp(TagChip, { props: { tag, promotable: true } }).classes()).toContain('has-acts')
    expect(mountWithApp(TagChip, { props: { tag, count: 3 } }).classes()).not.toContain('has-acts')
  })

  it('supports the legacy BookmarkTags appearance without changing its events', async () => {
    const onClick = vi.fn()
    const onRemove = vi.fn()
    const w = mountWithApp(TagChip, { props: { tag, legacy: true, legacyInteractive: true, removable: true, aiMark: true, onClick, onRemove } })

    expect(w.classes()).toContain('legacy')
    expect(w.classes()).toContain('clickable')
    expect(w.find('.tag-ai').exists()).toBe(true)

    await w.find('.tag-act.remove').trigger('click')
    expect(onRemove).toHaveBeenCalledWith(tag)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('emits click on the chip and remove on the × without click', async () => {
    const onClick = vi.fn()
    const onRemove = vi.fn()
    const w = mountWithApp(TagChip, { props: { tag, removable: true, onClick, onRemove } })
    expect(w.classes()).toContain('clickable')

    await w.find('.tag-act.remove').trigger('click')
    expect(onRemove).toHaveBeenCalledWith(tag)
    expect(onClick).not.toHaveBeenCalled()

    await w.trigger('click')
    expect(onClick).toHaveBeenCalledWith(tag)
  })

  it('emits promote on ↑', async () => {
    const onPromote = vi.fn()
    const w = mountWithApp(TagChip, { props: { tag, promotable: true, onPromote } })
    await w.find('.tag-act.promote').trigger('click')
    expect(onPromote).toHaveBeenCalledWith(tag)
  })
})
