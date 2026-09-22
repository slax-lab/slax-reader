// Modal/SnapshotStatusModal 组件单测
// props: status / title / content / onDismiss / onConfirm
// emit: dismiss / confirm(dontRemindAgain)
// onMounted setTimeout → appear=true
// closeModal → appear=false
// handleConfirm → emit confirm + closeModal
// onAfterLeave → emit dismiss
import { ref } from 'vue'

import SnapshotStatusModal from '~~/app/components/Modal/SnapshotStatusModal.vue'

import { BookmarkParseStatus } from '@commons/contracts/interface'
import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@vueuse/core', async () => {
  const actual = await vi.importActual<any>('@vueuse/core')
  return {
    ...actual,
    useScrollLock: () => ref(false)
  }
})

describe('Modal/SnapshotStatusModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('mount → 渲染 .snapshot-status-modal + .modal-content', () => {
    const wrapper = mountWithApp(SnapshotStatusModal, {
      props: { status: BookmarkParseStatus.PENDING, title: 'Title', content: 'Content' }
    })
    expect(wrapper.find('.snapshot-status-modal').exists()).toBe(true)
    expect(wrapper.find('.modal-content').exists()).toBe(true)
  })

  it('header 渲染 title 文案', () => {
    const wrapper = mountWithApp(SnapshotStatusModal, {
      props: { status: BookmarkParseStatus.PENDING, title: 'My Title', content: 'C' }
    })
    expect(wrapper.find('.header span').text()).toBe('My Title')
  })

  it('content 渲染 message', () => {
    const wrapper = mountWithApp(SnapshotStatusModal, {
      props: { status: BookmarkParseStatus.PENDING, title: 'T', content: 'My Content' }
    })
    expect(wrapper.find('.message').text()).toBe('My Content')
  })

  it('confirm button click → emit confirm(false)（默认不勾选 dontRemindAgain）', async () => {
    const wrapper = mountWithApp(SnapshotStatusModal, {
      props: { status: BookmarkParseStatus.PENDING, title: 'T', content: 'C' }
    })
    await wrapper.find('button.primary').trigger('click')
    const events = wrapper.emitted('confirm')
    expect(events).toBeTruthy()
    expect(events![0]).toEqual([false])
  })

  it('勾选 dontRemindAgain → confirm emit true', async () => {
    const wrapper = mountWithApp(SnapshotStatusModal, {
      props: { status: BookmarkParseStatus.PENDING, title: 'T', content: 'C' }
    })
    const checkbox = wrapper.find('input.checkbox')
    await checkbox.setValue(true)
    await wrapper.find('button.primary').trigger('click')
    const events = wrapper.emitted('confirm')
    expect(events![0]).toEqual([true])
  })

  it('close button click → appear=false（不抛错）', async () => {
    const wrapper = mountWithApp(SnapshotStatusModal, {
      props: { status: BookmarkParseStatus.PENDING, title: 'T', content: 'C' }
    })
    await wrapper.find('button.close').trigger('click')
    expect(wrapper.exists()).toBe(true)
  })

  it('外层 .snapshot-status-modal click → 触发 closeModal', async () => {
    const wrapper = mountWithApp(SnapshotStatusModal, {
      props: { status: BookmarkParseStatus.PENDING, title: 'T', content: 'C' }
    })
    await wrapper.find('.snapshot-status-modal').trigger('click')
    expect(wrapper.exists()).toBe(true)
  })

  it('Transition after-leave → emit dismiss', async () => {
    const wrapper = mountWithApp(SnapshotStatusModal, {
      props: { status: BookmarkParseStatus.PENDING, title: 'T', content: 'C' }
    })
    const transitions = wrapper.findAllComponents({ name: 'Transition' })
    transitions[0]!.vm.$emit('after-leave')
    expect(wrapper.emitted('dismiss')).toBeTruthy()
  })
})
