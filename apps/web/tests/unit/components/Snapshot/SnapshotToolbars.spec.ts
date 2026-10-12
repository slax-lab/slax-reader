import AppIcon from '~~/app/components/AppIcon.vue'
import SnapshotSidePanel from '~~/app/components/Layouts/SnapshotSidePanel.vue'
import SnapshotBottomToolbar from '~~/app/components/Snapshot/SnapshotBottomToolbar.vue'
import SnapshotMoreMenu from '~~/app/components/Snapshot/SnapshotMoreMenu.vue'
import SnapshotRightEdgeToolbar from '~~/app/components/Snapshot/SnapshotRightEdgeToolbar.vue'

import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, describe, expect, it } from 'vitest'

const originalWidth = window.innerWidth

afterEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth })
})

describe('Snapshot icon-backed controls', () => {
  it('renders panel registry icons and keeps translated labels/order', () => {
    const wrapper = mountWithApp(SnapshotSidePanel, { props: { activeTab: null } })
    const buttons = wrapper.findAll('.side-panel-tab')

    expect(buttons).toHaveLength(4)
    expect(buttons.map(button => button.attributes('title'))).toEqual(['Analysis', 'Transcript', 'Chat', 'Comment'])
    expect(wrapper.findAll('.tab-icon')).toHaveLength(4)
    expect(wrapper.findAllComponents(AppIcon).map(icon => icon.props('name'))).toEqual([
      'snapshot.collapse',
      'snapshot.ai',
      'snapshot.transcript',
      'snapshot.chat',
      'snapshot.comment'
    ])
  })

  it('keeps desktop edge active state and toggles the active panel', async () => {
    const wrapper = mountWithApp(SnapshotRightEdgeToolbar, { props: { modelValue: 'chat' } })
    const buttons = wrapper.findAll('.edge-btn')

    expect(buttons).toHaveLength(4)
    expect(buttons[2]!.classes()).toContain('active')
    await buttons[2]!.trigger('click')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([null])
    await buttons[0]!.trigger('click')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['ai'])
  })

  it('renders page action icons from the registry', async () => {
    const wrapper = mountWithApp(SnapshotMoreMenu, {
      props: {
        actions: [{ id: 'edit-title', label: 'Edit title', icon: 'snapshot.edit-title' }]
      }
    })

    await wrapper.get('.more-btn').trigger('click')
    expect(wrapper.findComponent(AppIcon).props('name')).toBe('snapshot.more')
    expect(wrapper.findAllComponents(AppIcon).map(icon => icon.props('name'))).toEqual(['snapshot.more', 'snapshot.edit-title'])
  })

  it('renders action icons on desktop and aggregates panels on narrow mobile', async () => {
    const actions = [{ id: 'top', icon: 'snapshot.back-to-top' as const, label: 'Back to top' }]
    const desktop = mountWithApp(SnapshotBottomToolbar, { props: { actions, activePanel: null } })
    expect(desktop.findAll('.toolbar-btn')).toHaveLength(1)
    expect(desktop.find('.btn-icon').exists()).toBe(true)
    expect(desktop.findComponent(AppIcon).props('name')).toBe('snapshot.back-to-top')

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 600 })
    const mobile = mountWithApp(SnapshotBottomToolbar, { props: { actions, activePanel: 'comment' } })
    await mobile.vm.$nextTick()
    expect(mobile.findAll('.toolbar-btn')).toHaveLength(5)
    expect(mobile.find('.btn-label').exists()).toBe(false)
    expect(mobile.findAll('.btn-icon')).toHaveLength(5)
    expect(mobile.findAll('.toolbar-btn')[4]!.classes()).toContain('active')
  })
})
