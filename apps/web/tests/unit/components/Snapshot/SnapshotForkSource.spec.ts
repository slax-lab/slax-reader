import { describe, expect, it } from 'vitest'
import SnapshotForkSource from '~~/app/components/Snapshot/SnapshotForkSource.vue'
import { mountWithApp } from '~~/tests/setup/mount'

describe('SnapshotForkSource', () => {
  it('links separately to the source Reader snapshot and displays the permitted source name', () => {
    const wrapper = mountWithApp(SnapshotForkSource, { props: { info: { bookmark_uid: 'source-uuid', display_name: 'Ada' } } })
    expect(wrapper.get('a').attributes('href')).toBe('/b/source-uuid')
    expect(wrapper.text()).toContain('Fork:')
    expect(wrapper.text()).toContain('Ada')
  })

  it('uses anonymous attribution when the API omits display identity', () => {
    const wrapper = mountWithApp(SnapshotForkSource, { props: { info: { bookmark_uid: 'source-uuid', display_name: null, user_id: 123456 } } })
    expect(wrapper.text()).toContain('Shared snapshot')
    expect(wrapper.html()).not.toContain('123456')
  })

  it('renders nothing after a direct capture clears lineage', () => {
    const wrapper = mountWithApp(SnapshotForkSource, { props: { info: null } })
    expect(wrapper.find('a').exists()).toBe(false)
  })
})
