import { defineComponent, h, ref } from 'vue'

import DeferredSnapshotPanel from '~~/app/components/Snapshot/DeferredSnapshotPanel.vue'

import { flushPromises, mount } from '@vue/test-utils'
import type { QuoteData } from '~/components/Chat/type'
import { describe, expect, it, vi } from 'vitest'

const global = { mocks: { $t: (key: string) => key } }
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function fixture() {
  const quoted = vi.fn()
  const focused = vi.fn()
  const created = vi.fn()
  const component = defineComponent({
    props: ['bookmarkUid'],
    emits: ['dismiss'],
    setup(props, { expose, emit }) {
      created()
      const draft = ref('')
      expose({ addQuoteData: quoted, focusTextarea: focused })
      return () => h('section', [
        h('input', { value: draft.value, onInput: (event: Event) => { draft.value = (event.target as HTMLInputElement).value } }),
        h('button', { onClick: () => emit('dismiss') }, props.bookmarkUid)
      ])
    }
  })
  return { component, quoted, focused, created }
}

describe('DeferredSnapshotPanel', () => {
  it('does not import a closed panel', async () => {
    const load = vi.fn()
    const wrapper = mount(DeferredSnapshotPanel, { props: { active: false, load }, global })
    await flushPromises()
    expect(load).not.toHaveBeenCalled()
    expect(wrapper.find('section').exists()).toBe(false)
    wrapper.unmount()
  })

  it('loads on activation and keeps draft and props after reopening', async () => {
    const { component, created } = fixture()
    const load = vi.fn().mockResolvedValue({ default: component })
    const dismiss = vi.fn()
    const wrapper = mount(DeferredSnapshotPanel, { props: { active: false, load }, attrs: { bookmarkUid: 'one', onDismiss: dismiss }, global })
    await wrapper.setProps({ active: true })
    await flushPromises()
    await wrapper.get('input').setValue('keep this draft')
    await wrapper.get('button').trigger('click')
    expect(dismiss).toHaveBeenCalledOnce()
    await wrapper.setProps({ active: false })
    await wrapper.setProps({ active: true })
    expect(wrapper.get('input').element.value).toBe('keep this draft')
    expect(wrapper.get('button').text()).toBe('one')
    expect(created).toHaveBeenCalledOnce()
    expect(load).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('delivers the first quote and focus once after the component ref is ready', async () => {
    const { component, quoted, focused } = fixture()
    const pending = deferred<{ default: typeof component }>()
    const wrapper = mount(DeferredSnapshotPanel, { props: { active: true, load: () => pending.promise }, global })
    const quote = { text: 'first quote' } as unknown as QuoteData
    wrapper.vm.addQuoteData(quote)
    wrapper.vm.focusTextarea()
    expect(quoted).not.toHaveBeenCalled()
    pending.resolve({ default: component })
    await flushPromises()
    expect(quoted).toHaveBeenCalledExactlyOnceWith(quote)
    expect(focused).toHaveBeenCalledOnce()
    await wrapper.setProps({ active: false })
    await wrapper.setProps({ active: true })
    expect(quoted).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('keeps a pending quote through a failed load and retries without duplicate loading', async () => {
    const { component, quoted } = fixture()
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ default: component })
    const wrapper = mount(DeferredSnapshotPanel, { props: { active: true, load }, global })
    const quote = { text: 'pending' } as unknown as QuoteData
    wrapper.vm.addQuoteData(quote)
    await flushPromises()
    expect(wrapper.get('[role=status]').text()).toContain('component.ai_panel.retry')
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(quoted).toHaveBeenCalledExactlyOnceWith(quote)
    expect(load).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('does not apply a late component or quote after its page/account instance is destroyed', async () => {
    const { component, quoted, created } = fixture()
    const pending = deferred<{ default: typeof component }>()
    const wrapper = mount(DeferredSnapshotPanel, { props: { active: true, load: () => pending.promise }, global })
    wrapper.vm.addQuoteData({ text: 'old account' } as unknown as QuoteData)
    wrapper.unmount()
    pending.resolve({ default: component })
    await flushPromises()
    expect(created).not.toHaveBeenCalled()
    expect(quoted).not.toHaveBeenCalled()
  })

  it('does not start another request when toggled while the initial import is pending', async () => {
    const { component } = fixture()
    const pending = deferred<{ default: typeof component }>()
    const load = vi.fn(() => pending.promise)
    const wrapper = mount(DeferredSnapshotPanel, { props: { active: true, load }, global })
    await wrapper.setProps({ active: false })
    await wrapper.setProps({ active: true })
    expect(load).toHaveBeenCalledOnce()
    pending.resolve({ default: component })
    await flushPromises()
    wrapper.unmount()
  })
})
