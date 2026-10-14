<template>
  <div class="dp" ref="root">
    <button class="dp__trigger" type="button" @click.stop="toggle" :disabled="disabled">
      <svg class="dp__icon" width="14" height="14" viewBox="0 0 14 14" fill="none">
        <rect x="1" y="2.5" width="12" height="10" rx="2" stroke="currentColor" stroke-width="1.2" />
        <path d="M1 6h12" stroke="currentColor" stroke-width="1.2" />
        <path d="M4 1v3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
        <path d="M10 1v3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
        <circle cx="4.5" cy="9.5" r="0.9" fill="currentColor" />
        <circle cx="7" cy="9.5" r="0.9" fill="currentColor" />
        <circle cx="9.5" cy="9.5" r="0.9" fill="currentColor" />
      </svg>
      <span>{{ displayValue }}</span>
    </button>

    <Teleport to="body">
      <Transition name="dp-popup">
        <div class="dp__popup" ref="popupEl" v-if="isOpen" :style="popupStyle" @click.stop>
          <div class="dp__nav">
            <button class="dp__nav-btn" type="button" @click="prevMonth">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M10 12L6 8l4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
            <span class="dp__month-label">{{ monthYearLabel }}</span>
            <button class="dp__nav-btn" type="button" @click="nextMonth">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
          </div>

          <div class="dp__grid">
            <div class="dp__weekday" v-for="h in weekdayHeaders" :key="h">{{ h }}</div>
            <button
              v-for="cell in cells"
              :key="cell.key"
              class="dp__day"
              :class="{
                'is-other': !cell.inMonth,
                'is-selected': cell.isSelected,
                'is-today': cell.isToday && !cell.isSelected
              }"
              type="button"
              @click="select(cell.fullDate)"
            >
              {{ cell.day }}
            </button>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{ modelValue: string; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [string]; open: [] }>()

const isOpen = ref(false)
const root = ref<HTMLElement | null>(null)
const popupEl = ref<HTMLElement | null>(null)
const popupStyle = ref<Record<string, string>>({})

const today = new Date()

const parseDate = (s: string) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y!, m! - 1, d)
}

const toDateStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const isSameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

const seed = computed(() => (props.modelValue ? parseDate(props.modelValue) : today))
const viewYear = ref(seed.value.getFullYear())
const viewMonth = ref(seed.value.getMonth())

watch(
  () => props.modelValue,
  val => {
    if (val) {
      const d = parseDate(val)
      viewYear.value = d.getFullYear()
      viewMonth.value = d.getMonth()
    }
  }
)

const updatePosition = () => {
  const el = root.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  popupStyle.value = {
    position: 'fixed',
    top: `${rect.bottom + 10}px`,
    right: `${window.innerWidth - rect.right}px`,
    zIndex: '9999'
  }
}

const toggle = () => {
  if (props.disabled) return
  if (!isOpen.value) {
    updatePosition()
    emit('open')
  }
  isOpen.value = !isOpen.value
}

const close = () => {
  isOpen.value = false
}

defineExpose({ close })

const displayValue = computed(() => {
  if (!props.modelValue) return '—'
  const d = parseDate(props.modelValue)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
})

const monthYearLabel = computed(() => {
  return new Date(viewYear.value, viewMonth.value, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric'
  })
})

const weekdayHeaders = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

const cells = computed(() => {
  const year = viewYear.value
  const month = viewMonth.value
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)

  let dow = firstDay.getDay()
  const startDow = dow === 0 ? 6 : dow - 1

  const result = []

  for (let i = startDow; i > 0; i--) {
    const d = new Date(year, month, 1 - i)
    const s = toDateStr(d)
    result.push({ key: s, day: d.getDate(), fullDate: s, inMonth: false, isSelected: s === props.modelValue, isToday: isSameDay(d, today) })
  }

  for (let day = 1; day <= lastDay.getDate(); day++) {
    const d = new Date(year, month, day)
    const s = toDateStr(d)
    result.push({ key: s, day, fullDate: s, inMonth: true, isSelected: s === props.modelValue, isToday: isSameDay(d, today) })
  }

  const remaining = result.length % 7 === 0 ? 0 : 7 - (result.length % 7)
  for (let day = 1; day <= remaining; day++) {
    const d = new Date(year, month + 1, day)
    const s = toDateStr(d)
    result.push({ key: s, day, fullDate: s, inMonth: false, isSelected: s === props.modelValue, isToday: isSameDay(d, today) })
  }

  return result
})

const prevMonth = () => {
  if (viewMonth.value === 0) {
    viewMonth.value = 11
    viewYear.value--
  } else viewMonth.value--
}

const nextMonth = () => {
  if (viewMonth.value === 11) {
    viewMonth.value = 0
    viewYear.value++
  } else viewMonth.value++
}

const select = (dateStr: string) => {
  emit('update:modelValue', dateStr)
  isOpen.value = false
}

const handleOutsideClick = (e: MouseEvent) => {
  const target = e.target as Node
  if (!root.value?.contains(target) && !popupEl.value?.contains(target)) {
    isOpen.value = false
  }
}

onMounted(() => document.addEventListener('click', handleOutsideClick))
onUnmounted(() => document.removeEventListener('click', handleOutsideClick))
</script>

<style lang="scss" scoped>
.dp {
  position: relative;
}

.dp__trigger {
  display: flex;
  align-items: center;
  gap: 7px;
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 0;
  font-family: inherit;
  color: var(--slax-text);
  transition: opacity 0.15s;

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  span {
    font-size: 13px;
    font-weight: 600;
    line-height: 1;
    white-space: nowrap;
  }
}

.dp__icon {
  color: var(--slax-chart-primary);
  flex-shrink: 0;
}

.dp__popup {
  width: 252px;
  padding: 14px;
  border-radius: 18px;
  background: rgba(var(--slax-overlay-white-rgb), 0.88);
  border: 1px solid rgba(var(--slax-overlay-white-rgb), 0.75);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  box-shadow:
    0 20px 60px rgba(var(--slax-modal-overlay-rgb), 0.14),
    0 4px 16px rgba(var(--slax-modal-overlay-rgb), 0.08),
    inset 0 1px 0 rgba(var(--slax-overlay-white-rgb), 0.95);
}

.dp__nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.dp__nav-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--slax-text-muted);
  transition:
    background 0.12s,
    color 0.12s;

  &:hover {
    background: rgba(var(--slax-chart-primary-rgb), 0.1); /* chart-primary tinted bg; rgba needed for opacity */
    color: var(--slax-chart-primary);
  }
}

.dp__month-label {
  font-size: 13px;
  font-weight: 700;
  color: var(--slax-text);
}

.dp__grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}

.dp__weekday {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 28px;
  font-size: 10px;
  font-weight: 700;
  color: var(--slax-chart-primary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.dp__day {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 32px;
  border-radius: 8px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  color: var(--slax-text);
  transition:
    background 0.1s,
    color 0.1s;

  &:hover:not(.is-selected) {
    background: rgba(var(--slax-chart-primary-rgb), 0.1); /* chart-primary tinted bg; rgba needed for opacity */
    color: var(--slax-chart-primary);
  }

  &.is-other {
    color: var(--slax-text-light);
  }

  &.is-today {
    font-weight: 700;
    box-shadow: inset 0 0 0 1.5px var(--slax-chart-primary);
    color: var(--slax-chart-primary);
  }

  &.is-selected {
    background: var(--slax-chart-primary);
    color: #ffffff; /* white text on accent bg, intentionally fixed */
    font-weight: 700;
    box-shadow: 0 4px 12px rgba(var(--slax-chart-primary-rgb), 0.35); /* chart-primary shadow; rgba needed for opacity */
  }
}

.dp-popup-enter-active,
.dp-popup-leave-active {
  transition:
    opacity 0.15s,
    transform 0.15s;
}

.dp-popup-enter-from,
.dp-popup-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.97);
}
</style>
