import { isClient } from '@commons/frontend-utils/is'

import { useStatus } from '@powersync/vue'

export interface LocalSyncStatusInfo {
  key: 'connecting' | 'downloading' | 'synced' | 'disconnected' | 'error'
  label: string
  color: string
}

export const useLocalSyncStatus = () => {
  const cfg = useRuntimeConfig().public
  const isTestEnv = cfg.slaxEnv !== 'production'
  const enabled = isClient && isTestEnv && isLocalFirstEnabled()

  const status = enabled ? useStatus() : null

  const info = computed<LocalSyncStatusInfo | null>(() => {
    if (!status) return null
    const s = status.value
    const flow = s.dataFlowStatus
    if (flow?.downloadError || flow?.uploadError) return { key: 'error', label: 'error', color: 'var(--slax-danger)' }
    if (s.connecting) return { key: 'connecting', label: 'connecting', color: 'color-mix(in srgb, var(--slax-accent) 60%, #f59e0b)' }
    if (!s.connected) return { key: 'disconnected', label: 'disconnected', color: 'var(--slax-text-light)' }
    if (!s.hasSynced || flow?.downloading) return { key: 'downloading', label: 'downloading', color: 'var(--slax-accent)' }
    return { key: 'synced', label: 'synced', color: 'var(--slax-text-muted)' }
  })

  return { info }
}
