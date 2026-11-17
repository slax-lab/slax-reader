import Status from '~~/app/components/Snapshot/SnapshotSubscriptionStatus.vue'

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

const start = (status: 'pending' | 'error' | 'active' | 'inactive') => mount(Status, { props: { status }, global: { mocks: { $t: (key: string) => key } } })
describe('subscription checking feedback', () => {
  it('announces pending status without offering a purchase or retry', () => {
    const wrapper = start('pending')
    expect(wrapper.find('[role="status"]').exists()).toBe(true)
    expect(wrapper.attributes('aria-busy')).toBe('true')
    expect(wrapper.find('button').exists()).toBe(false)
  })
  it('announces failure and emits an explicit retry', async () => {
    const wrapper = start('error')
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
  })
  it.each(['active', 'inactive'] as const)('does not replace a resolved %s flow', status => {
    expect(start(status).find('.subscription-status').exists()).toBe(false)
  })
})
