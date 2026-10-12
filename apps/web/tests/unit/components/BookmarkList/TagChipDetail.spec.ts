import TagChipDetail from '~/components/BookmarkList/TagChipDetail.vue'

import { mountWithApp } from '../../../setup/mount'
import type { BookmarkTag } from '@commons/frontend-types/models'
import { describe, expect, it, vi } from 'vitest'

const tag: BookmarkTag = { id: 1, name: '创业', show_name: '创业', source: 'mine' }

describe('components/BookmarkList/TagChipDetail', () => {
  it('renders the tag name and a plain text close control', () => {
    const w = mountWithApp(TagChipDetail, { props: { tag, removable: true } })
    expect(w.text()).toContain('创业')
    expect(w.find('.tag-act.remove').text()).toBe('×')
    expect(w.find('.tag-act.remove svg').exists()).toBe(false)
  })

  it('hides the action gutter when not removable', () => {
    const w = mountWithApp(TagChipDetail, { props: { tag } })
    expect(w.find('.tag-act').exists()).toBe(false)
    expect(w.classes()).not.toContain('has-acts')
  })

  it('keeps the remove button focusable and emits remove', async () => {
    const w = mountWithApp(TagChipDetail, { props: { tag, removable: true } })
    const remove = w.find('.tag-act.remove')
    expect(remove.exists()).toBe(true)
    await remove.trigger('focus')
    await remove.trigger('click')
    expect(w.emitted('remove')).toEqual([[tag]])
  })

  it('is only clickable when legacyInteractive is set, and remove does not bubble into click', async () => {
    const onClick = vi.fn()
    const onRemove = vi.fn()
    const w = mountWithApp(TagChipDetail, { props: { tag, removable: true, legacyInteractive: true, onClick, onRemove } })
    expect(w.classes()).toContain('clickable')

    await w.find('.tag-act.remove').trigger('click')
    expect(onRemove).toHaveBeenCalledWith(tag)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('is not clickable without legacyInteractive even with a click listener', () => {
    const w = mountWithApp(TagChipDetail, { props: { tag, onClick: vi.fn() } })
    expect(w.classes()).not.toContain('clickable')
  })

  it('does not select the tag when Enter activates its remove button', async () => {
    const w = mountWithApp(TagChipDetail, { props: { tag, removable: true, legacyInteractive: true, onClick: vi.fn() } })
    const remove = w.find('.tag-act.remove')
    await remove.trigger('keydown', { key: 'Enter' })
    await remove.trigger('click')
    expect(w.emitted('click')).toBeUndefined()
    expect(w.emitted('remove')).toEqual([[tag]])
  })

  it('updates clickability when the parent changes the interactive mode', async () => {
    const w = mountWithApp(TagChipDetail, { props: { tag, legacyInteractive: false, onClick: vi.fn() } })
    expect(w.attributes('tabindex')).toBe('-1')
    await w.setProps({ legacyInteractive: true })
    expect(w.attributes('tabindex')).toBe('0')
  })
})
