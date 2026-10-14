// ImportPreviewModal: pre-import confirmation modal
// Covers: file name / counts / rows, the Readwise-only feed checkbox, loading and error states, button state and events, close
import { ref } from 'vue'

import ImportPreviewModal from '~~/app/components/ThirdPartyImport/ImportPreviewModal.vue'

import { mountWithApp } from '~~/tests/setup/mount'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@vueuse/core', async () => {
  const actual = await vi.importActual<any>('@vueuse/core')
  return {
    ...actual,
    useScrollLock: () => ref(false)
  }
})

const preview = {
  eligible_count: 2,
  excluded_feed_count: 10,
  duplicate_count: 1,
  invalid_row_count: 3,
  invalid_date_count: 0,
  preview: [
    { target_url: 'https://example.com/a', target_title: 'Sample A' },
    { target_url: 'https://example.com/b', target_title: '' }
  ]
}

const mountModal = (props: Record<string, unknown> = {}) =>
  mountWithApp(ImportPreviewModal, {
    attachTo: document.body,
    props: { fileName: 'reader.csv', sourceType: 'pinboard', busy: false, errorText: '', ...props }
  })

const $ = (selector: string) => document.querySelector(selector) as HTMLElement

describe('ThirdPartyImport/ImportPreviewModal', () => {
  it('renders the file name, counts and the preview rows in a modal', () => {
    const wrapper = mountModal({ preview })
    expect($('.modal-overlay')).not.toBeNull()
    expect($('.file-name').textContent).toBe('reader.csv')
    expect($('.preview-counts').textContent).toContain('2')
    const rows = document.querySelectorAll('.preview-list li')
    expect(rows).toHaveLength(2)
    expect(rows[0]?.querySelector('strong')?.textContent).toBe('Sample A')
    // A row without a title falls back to its URL
    expect(rows[1]?.querySelector('strong')?.textContent).toBe('https://example.com/b')
    expect($('.preview-warning')).toBeNull()
    expect($('.loading-container')).toBeNull()
    wrapper.unmount()
  })

  it('warns about unreadable dates', () => {
    const wrapper = mountModal({ preview: { ...preview, invalid_date_count: 4 } })
    expect($('.preview-warning').textContent).toContain('4')
    wrapper.unmount()
  })

  it('shows the feed checkbox only for Readwise and reports a change', async () => {
    const wrapper = mountModal({ preview, sourceType: 'readwise', includeFeed: false })
    const box = $('.feed-option input') as HTMLInputElement
    expect(box).not.toBeNull()
    box.checked = true
    box.dispatchEvent(new Event('change'))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('update:includeFeed')?.[0]).toEqual([true])
    wrapper.unmount()

    const other = mountModal({ preview, sourceType: 'instapaper' })
    expect($('.feed-option')).toBeNull()
    other.unmount()
  })

  it('spins while the preview is loading, disables start, and ignores the backdrop', async () => {
    const wrapper = mountModal({ busy: true })
    expect($('.loading-container')).not.toBeNull()
    expect(($('.btn.primary') as HTMLButtonElement).disabled).toBe(true)
    expect(($('.btn.ghost') as HTMLButtonElement).disabled).toBe(true)
    expect(($('.close-btn') as HTMLButtonElement).disabled).toBe(true)
    $('.modal-overlay').click()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('close')).toBeUndefined()
    wrapper.unmount()
  })

  it('shows the error instead of the list and keeps start disabled', () => {
    const wrapper = mountModal({ errorText: 'Cannot preview this file' })
    expect($('[role=alert]').textContent).toBe('Cannot preview this file')
    expect($('.preview-list')).toBeNull()
    expect(($('.btn.primary') as HTMLButtonElement).disabled).toBe(true)
    expect(($('.btn.ghost') as HTMLButtonElement).disabled).toBe(false)
    wrapper.unmount()
  })

  it('disables start when nothing is eligible', () => {
    const wrapper = mountModal({ preview: { ...preview, eligible_count: 0 } })
    expect(($('.btn.primary') as HTMLButtonElement).disabled).toBe(true)
    wrapper.unmount()
  })

  it('emits start, and close from cancel, the × and the overlay', async () => {
    const wrapper = mountModal({ preview })
    $('.btn.primary').click()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('start')).toHaveLength(1)
    $('.btn.ghost').click()
    $('.close-btn').click()
    $('.modal-overlay').click()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('close')).toHaveLength(3)
    // Clicking inside the dialog is not a close
    $('.modal-content').click()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('close')).toHaveLength(3)
    wrapper.unmount()
  })
})
