import { isClient } from '@commons/utils/is'

import { useStatus } from '@powersync/vue'

export const useLocalSyncProgress = () => {
  const enabled = isClient && isLocalFirstEnabled()
  const status = enabled ? useStatus() : null

  const isFirstSyncing = computed(() => !!status && status.value.hasSynced === false)

  const total = computed(() => status?.value.downloadProgress?.totalOperations ?? 0)
  const downloaded = computed(() => status?.value.downloadProgress?.downloadedOperations ?? 0)
  const fraction = computed(() => status?.value.downloadProgress?.downloadedFraction ?? 0)
  const percent = computed(() => Math.min(100, Math.round(fraction.value * 100)))

  return { isFirstSyncing, total, downloaded, fraction, percent }
}
