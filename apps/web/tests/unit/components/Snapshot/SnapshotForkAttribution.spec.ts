import { describe, expect, it } from 'vitest'
import SnapshotForkAttribution from '~~/app/components/Snapshot/SnapshotForkAttribution.vue'
import { mountWithApp } from '~~/tests/setup/mount'

describe('Fork attribution', () => {
  it('shows a neutral marker without placing source identity into server markup', () => {
    const wrapper = mountWithApp(SnapshotForkAttribution, {
      props: { hasFork: true, attribution: null }
    })
    expect(wrapper.text()).toContain('Fork:')
    expect(wrapper.find('a').exists()).toBe(false)
  })
  it('uses a generic source label when owner identity is hidden', () => {
    const wrapper = mountWithApp(SnapshotForkAttribution, {
      props: {
        hasFork: true,
        attribution: {
          status: 'available',
          source_bookmark_uid: 'source',
          display_name: null
        }
      }
    })
    // The shared test harness stubs NuxtLink with an anchor and forwards `to`.
    expect(wrapper.find('a').attributes('to')).toBe('/b/source')
    expect(wrapper.text()).toContain('Reader snapshot')
  })
  it('removes the link when access to the source is revoked', async () => {
    const wrapper = mountWithApp(SnapshotForkAttribution, {
      props: {
        hasFork: true,
        attribution: {
          status: 'available',
          source_bookmark_uid: 'source',
          display_name: 'Writer'
        }
      }
    })
    await wrapper.setProps({ attribution: { status: 'unavailable' } })
    expect(wrapper.find('a').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Writer')
  })
})
