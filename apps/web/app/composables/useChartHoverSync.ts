const sharedHoverIndex = ref<number | null>(null)
let clearTimer: ReturnType<typeof setTimeout> | null = null

export const useChartHoverSync = () => {
  const setIndex = (idx: number) => {
    if (clearTimer) {
      clearTimeout(clearTimer)
      clearTimer = null
    }
    sharedHoverIndex.value = idx
  }

  const clearIndex = () => {
    clearTimer = setTimeout(() => {
      sharedHoverIndex.value = null
      clearTimer = null
    }, 40)
  }

  return { sharedHoverIndex, setIndex, clearIndex }
}
