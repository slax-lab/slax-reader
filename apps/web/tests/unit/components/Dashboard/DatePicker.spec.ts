import { mountWithApp } from '../../../setup/mount'
import { describe, expect, it } from 'vitest'

// DatePicker is a pure UI component with no auto-imports beyond Vue reactivity.
// It uses Teleport to body for the popup — we test the trigger and computed logic.

describe('DatePicker', () => {
  it('renders trigger button with formatted date', async () => {
    const { default: DatePicker } = await import('~~/app/components/Dashboard/DatePicker.vue')
    const wrapper = mountWithApp(DatePicker, {
      props: { modelValue: '2026-01-15' }
    })
    expect(wrapper.find('.dp__trigger').exists()).toBe(true)
    // displayValue: Jan 15, 2026
    expect(wrapper.find('.dp__trigger span').text()).toContain('Jan')
    expect(wrapper.find('.dp__trigger span').text()).toContain('2026')
  })

  it('shows "—" when modelValue is empty', async () => {
    const { default: DatePicker } = await import('~~/app/components/Dashboard/DatePicker.vue')
    const wrapper = mountWithApp(DatePicker, {
      props: { modelValue: '' }
    })
    expect(wrapper.find('.dp__trigger span').text()).toBe('—')
  })

  it('opens popup on trigger click', async () => {
    const { default: DatePicker } = await import('~~/app/components/Dashboard/DatePicker.vue')
    const wrapper = mountWithApp(DatePicker, {
      props: { modelValue: '2026-01-15' }
    })
    // popup is teleported to body — check isOpen via trigger click
    await wrapper.find('.dp__trigger').trigger('click')
    // After click, isOpen=true; popup is in Teleport so check emitted 'open'
    expect(wrapper.emitted('open')).toBeTruthy()
  })

  it('does not open when disabled', async () => {
    const { default: DatePicker } = await import('~~/app/components/Dashboard/DatePicker.vue')
    const wrapper = mountWithApp(DatePicker, {
      props: { modelValue: '2026-01-15', disabled: true }
    })
    await wrapper.find('.dp__trigger').trigger('click')
    expect(wrapper.emitted('open')).toBeFalsy()
  })

  it('emits update:modelValue when a date is selected', async () => {
    const { default: DatePicker } = await import('~~/app/components/Dashboard/DatePicker.vue')
    const wrapper = mountWithApp(DatePicker, {
      props: { modelValue: '2026-01-15' }
    })
    // Open the picker
    await wrapper.find('.dp__trigger').trigger('click')
    // Find a day button in the current month (inMonth cells) and click it
    // The popup is teleported — use document.querySelector to find it
    const dayBtns = document.querySelectorAll('.dp__day')
    const inMonthBtn = Array.from(dayBtns).find(btn => !btn.classList.contains('is-other')) as HTMLElement | undefined
    // Hard assert so the test fails explicitly if Teleport didn't mount (not a silent skip)
    expect(inMonthBtn).toBeDefined()
    await inMonthBtn!.click()
    expect(wrapper.emitted('update:modelValue')).toBeTruthy()
  })

  it('trigger button is disabled when disabled prop is true', async () => {
    const { default: DatePicker } = await import('~~/app/components/Dashboard/DatePicker.vue')
    const wrapper = mountWithApp(DatePicker, {
      props: { modelValue: '2026-01-15', disabled: true }
    })
    expect((wrapper.find('.dp__trigger').element as HTMLButtonElement).disabled).toBe(true)
  })

  it('prevMonth navigates to previous month', async () => {
    const { default: DatePicker } = await import('~~/app/components/Dashboard/DatePicker.vue')
    const wrapper = mountWithApp(DatePicker, { props: { modelValue: '2026-03-15' } })
    // Open picker
    await wrapper.find('.dp__trigger').trigger('click')
    const vm = wrapper.vm as any
    const initialMonth = vm.viewMonth
    vm.prevMonth()
    await wrapper.vm.$nextTick()
    expect(vm.viewMonth).toBe(initialMonth - 1)
  })

  it('prevMonth wraps from January to December of previous year', async () => {
    const { default: DatePicker } = await import('~~/app/components/Dashboard/DatePicker.vue')
    const wrapper = mountWithApp(DatePicker, { props: { modelValue: '2026-01-15' } })
    await wrapper.find('.dp__trigger').trigger('click')
    const vm = wrapper.vm as any
    vm.prevMonth()
    await wrapper.vm.$nextTick()
    expect(vm.viewMonth).toBe(11) // December
    expect(vm.viewYear).toBe(2025)
  })

  it('nextMonth navigates to next month', async () => {
    const { default: DatePicker } = await import('~~/app/components/Dashboard/DatePicker.vue')
    const wrapper = mountWithApp(DatePicker, { props: { modelValue: '2026-03-15' } })
    await wrapper.find('.dp__trigger').trigger('click')
    const vm = wrapper.vm as any
    const initialMonth = vm.viewMonth
    vm.nextMonth()
    await wrapper.vm.$nextTick()
    expect(vm.viewMonth).toBe(initialMonth + 1)
  })

  it('nextMonth wraps from December to January of next year', async () => {
    const { default: DatePicker } = await import('~~/app/components/Dashboard/DatePicker.vue')
    const wrapper = mountWithApp(DatePicker, { props: { modelValue: '2026-12-15' } })
    await wrapper.find('.dp__trigger').trigger('click')
    const vm = wrapper.vm as any
    vm.nextMonth()
    await wrapper.vm.$nextTick()
    expect(vm.viewMonth).toBe(0) // January
    expect(vm.viewYear).toBe(2027)
  })

  it('close() sets isOpen to false', async () => {
    const { default: DatePicker } = await import('~~/app/components/Dashboard/DatePicker.vue')
    const wrapper = mountWithApp(DatePicker, { props: { modelValue: '2026-01-15' } })
    await wrapper.find('.dp__trigger').trigger('click') // open
    const vm = wrapper.vm as any
    expect(vm.isOpen).toBe(true)
    vm.close()
    await wrapper.vm.$nextTick()
    expect(vm.isOpen).toBe(false)
  })

  it('defineExpose close() is accessible', async () => {
    const { default: DatePicker } = await import('~~/app/components/Dashboard/DatePicker.vue')
    const wrapper = mountWithApp(DatePicker, { props: { modelValue: '2026-01-15' } })
    // DatePicker uses defineExpose({ close }) — verify it's callable
    expect(typeof (wrapper.vm as any).close).toBe('function')
  })
})
