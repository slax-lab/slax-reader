import { RESTMethodPath } from '@slax-reader/contracts/const'
import type { ImportProcessResp } from '@slax-reader/contracts/interface'

// Mirrors MAX_ACTIVE_IMPORT_TASKS in the backend import service.
export const MAX_ACTIVE_IMPORT_TASKS = 5
export const IMPORT_STATUS_PROCESSING = 1

export const importProgressPercent = (task: Pick<ImportProcessResp, 'current_count' | 'batch_count'>) => {
  if (!task.batch_count) return 0
  return Math.min(100, Math.round((task.current_count / task.batch_count) * 100))
}

// One list for the whole page: the settings section keeps it fresh, so the
// progress modal can open with data already on screen and refresh behind it.
const tasks = ref<ImportProcessResp[]>([])
const loaded = ref(false)
// Two callers poll on their own timers; a slow older response must not overwrite a newer list
let requestSeq = 0
let appliedSeq = 0

/** Test helper: forget the shared list. */
export const resetImportTasks = () => {
  tasks.value = []
  loaded.value = false
  requestSeq = 0
  appliedSeq = 0
}

/**
 * The user's import tasks, newest first, with an optional poll that runs only while
 * at least one task is still processing. `loading` is per caller; `tasks` and `loaded` are shared.
 */
export const useImportTasks = () => {
  const loading = ref(false)
  let timer: ReturnType<typeof setInterval> | undefined

  const activeTasks = computed(() => tasks.value.filter(task => task.status === IMPORT_STATUS_PROCESSING))
  const activeCount = computed(() => activeTasks.value.length)
  const canStart = computed(() => activeCount.value < MAX_ACTIVE_IMPORT_TASKS)

  const stopPolling = () => {
    if (timer) clearInterval(timer)
    timer = undefined
  }

  const refresh = async (): Promise<boolean> => {
    loading.value = true
    const seq = ++requestSeq
    try {
      const res = await request().get<ImportProcessResp[]>({ url: RESTMethodPath.IMPORT_THIRD_PARTY_DATA_PROGRESS })
      if (!res) return false
      if (seq < appliedSeq) return true
      appliedSeq = seq
      tasks.value = [...res].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      loaded.value = true
      return true
    } catch {
      return false
    } finally {
      loading.value = false
      if (activeCount.value === 0) stopPolling()
    }
  }

  const startPolling = (intervalMs: number) => {
    stopPolling()
    if (activeCount.value === 0) return
    timer = setInterval(() => {
      if (activeCount.value === 0) return stopPolling()
      void refresh()
    }, intervalMs)
  }

  if (getCurrentScope()) onScopeDispose(stopPolling)

  return { tasks, activeTasks, activeCount, canStart, loading, loaded, refresh, startPolling, stopPolling }
}
