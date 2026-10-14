export type SourceSyncState = {kind: 'connected' | 'connecting' | 'uploading' | 'offline'} | {kind: 'downloading'; progress: number} | {kind: 'error'; message: string};
export interface SourceSyncInput {connected: boolean; connecting: boolean; downloading: boolean; uploading: boolean; downloadProgress?: {downloadedOperations: number; totalOperations: number} | null; downloadError?: Error; uploadError?: Error}
/** Preserve Coordinator.kt priority, including connected before uploading/downloading. */
export function sourceSyncState(sync: SourceSyncInput | undefined, networkAvailable: boolean): SourceSyncState {
  if (!networkAvailable) return {kind: 'offline'};
  if (!sync) return {kind: 'connecting'};
  if (sync.connected) return {kind: 'connected'};
  if (sync.downloading) return {kind: 'downloading', progress: sync.downloadProgress && sync.downloadProgress.totalOperations > 0 ? Math.max(0, Math.min(1, sync.downloadProgress.downloadedOperations / sync.downloadProgress.totalOperations)) : 0};
  if (sync.uploading) return {kind: 'uploading'};
  if (sync.connecting) return {kind: 'connecting'};
  const error = sync.downloadError ?? sync.uploadError;
  if (error) {
    if (/NSURLErrorDomain|ConnectException|NoRouteToHost|PortUnreachable|ProtocolException|ClosedByteChannel|SSL|Socket|UnknownHost|EOFException|Network request failed|Failed to fetch/i.test(String(error))) return {kind: 'offline'};
    return {kind: 'error', message: String(error)};
  }
  return {kind: 'connecting'};
}
