import { ref } from 'vue'

import { mountWithApp } from '../../../setup/mount'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// useHistoryMetrics is a fork-only composable (auto-import)
const { useHistoryMetricsMock } = vi.hoisted(() => ({ useHistoryMetricsMock: vi.fn() }))
mockNuxtImport('useHistoryMetrics', () => useHistoryMetricsMock)

const makeMetrics = (overrides = {}) => ({
  rangeOptions: ref([
    { days: 7, label: '7 天' },
    { days: 30, label: '30 天' },
    { days: 90, label: '90 天' },
    { days: 365, label: '365 天' }
  ]),
  selectedRange: ref(7),
  activeMode: ref('preset'),
  activeRange: ref({ days: 7, labels: [], rawLabels: [], charts: [] }),
  loading: ref(false),
  errorMessage: ref(''),
  loadRange: vi.fn().mockResolvedValue(undefined),
  loadCustomRange: vi.fn().mockResolvedValue(undefined),
  ...overrides
})

describe('HistorySection', () => {
  beforeEach(() => {
    useHistoryMetricsMock.mockReturnValue(makeMetrics())
  })

  it('renders 4 range buttons', async () => {
    const { default: HistorySection } = await import('~~/app/components/Dashboard/HistorySection.vue')
    const wrapper = mountWithApp(HistorySection)
    expect(wrapper.findAll('.history-section__range-btn').length).toBe(4)
  })

  it('marks active range button with is-active class', async () => {
    useHistoryMetricsMock.mockReturnValue(makeMetrics({ selectedRange: ref(7), activeMode: ref('preset') }))
    const { default: HistorySection } = await import('~~/app/components/Dashboard/HistorySection.vue')
    const wrapper = mountWithApp(HistorySection)
    const activeBtn = wrapper.find('.history-section__range-btn.is-active')
    expect(activeBtn.exists()).toBe(true)
    expect(activeBtn.text()).toBe('7 天')
  })

  it('calls loadRange on mount with selectedRange', async () => {
    const loadRange = vi.fn().mockResolvedValue(undefined)
    useHistoryMetricsMock.mockReturnValue(makeMetrics({ loadRange }))
    const { default: HistorySection } = await import('~~/app/components/Dashboard/HistorySection.vue')
    mountWithApp(HistorySection)
    await flushPromises()
    expect(loadRange).toHaveBeenCalledWith(7)
  })

  it('calls loadRange when range button is clicked', async () => {
    const loadRange = vi.fn().mockResolvedValue(undefined)
    useHistoryMetricsMock.mockReturnValue(makeMetrics({ loadRange }))
    const { default: HistorySection } = await import('~~/app/components/Dashboard/HistorySection.vue')
    const wrapper = mountWithApp(HistorySection)
    await flushPromises()
    loadRange.mockClear()
    const btns = wrapper.findAll('.history-section__range-btn')
    await btns[1]!.trigger('click') // 30 days
    await flushPromises()
    expect(loadRange).toHaveBeenCalledWith(30)
  })

  it('does not render charts when activeRange has no labels', async () => {
    useHistoryMetricsMock.mockReturnValue(
      makeMetrics({
        activeRange: ref({ days: 7, labels: [], rawLabels: [], charts: [] })
      })
    )
    const { default: HistorySection } = await import('~~/app/components/Dashboard/HistorySection.vue')
    const wrapper = mountWithApp(HistorySection)
    expect(wrapper.find('.history-section__charts').exists()).toBe(false)
  })

  it('renders charts when activeRange has labels', async () => {
    useHistoryMetricsMock.mockReturnValue(
      makeMetrics({
        activeRange: ref({
          days: 7,
          labels: ['Jan 1', 'Jan 2'],
          rawLabels: ['2026-01-01', '2026-01-02'],
          charts: [{ key: 'test', eyebrow: 'Test', title: 'Test Chart', description: '', series: [] }]
        })
      })
    )
    const { default: HistorySection } = await import('~~/app/components/Dashboard/HistorySection.vue')
    const wrapper = mountWithApp(HistorySection)
    expect(wrapper.find('.history-section__charts').exists()).toBe(true)
  })

  it('shows validation error when start > end on applyCustomRange', async () => {
    const { default: HistorySection } = await import('~~/app/components/Dashboard/HistorySection.vue')
    const wrapper = mountWithApp(HistorySection)
    const vm = wrapper.vm as any
    vm.customStart = '2026-01-10'
    vm.customEnd = '2026-01-05'
    await vm.applyCustomRange()
    expect(wrapper.find('.history-section__error').exists()).toBe(true)
  })

  it('calls loadCustomRange when valid custom range is applied', async () => {
    const loadCustomRange = vi.fn().mockResolvedValue(undefined)
    useHistoryMetricsMock.mockReturnValue(makeMetrics({ loadCustomRange }))
    const { default: HistorySection } = await import('~~/app/components/Dashboard/HistorySection.vue')
    const wrapper = mountWithApp(HistorySection)
    const vm = wrapper.vm as any
    vm.customStart = '2026-01-01'
    vm.customEnd = '2026-01-10'
    await vm.applyCustomRange()
    await flushPromises()
    expect(loadCustomRange).toHaveBeenCalledWith('2026-01-01', '2026-01-10')
  })

  it('shows custom apply button when both dates are set and not yet applied', async () => {
    const { default: HistorySection } = await import('~~/app/components/Dashboard/HistorySection.vue')
    const wrapper = mountWithApp(HistorySection)
    const vm = wrapper.vm as any
    vm.customStart = '2026-01-01'
    vm.customEnd = '2026-01-10'
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.history-section__custom-apply').exists()).toBe(true)
  })

  it('isBusy disables range buttons during pending', async () => {
    const loadRange = vi.fn(() => new Promise(() => {})) // never resolves
    useHistoryMetricsMock.mockReturnValue(makeMetrics({ loadRange }))
    const { default: HistorySection } = await import('~~/app/components/Dashboard/HistorySection.vue')
    const wrapper = mountWithApp(HistorySection)
    await flushPromises()
    // click 30-day button to trigger pending
    const btns = wrapper.findAll('.history-section__range-btn')
    btns[1]!.trigger('click') // don't await — stays pending
    await wrapper.vm.$nextTick()
    // other buttons (not the pending one) should be disabled
    const disabledBtns = wrapper.findAll('.history-section__range-btn[disabled]')
    expect(disabledBtns.length).toBeGreaterThan(0)
  })
})
