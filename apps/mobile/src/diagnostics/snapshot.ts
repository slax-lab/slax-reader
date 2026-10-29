import {diagnosticTimestamp} from '../domain/diagnostics.ts';
import {redactError} from './redact.ts';

export interface DiagnosticSnapshotSource {
  database(): {currentStatus: {connected: boolean; lastSyncedAt?: Date; uploadError?: unknown; downloadError?: unknown}; getUploadQueueStats(): Promise<{count: number}>} | null;
  session(): {status: string};
  reauthentication(): string;
  network(): unknown;
  environment(): string;
  version: string; build: string; os: string;
}
export async function readDiagnosticSnapshot(source: DiagnosticSnapshotSource, shareAvailable: boolean, now = new Date()) {
  const database = source.database(), status = database?.currentStatus;
  let pendingUploads: number | null = null;
  try {if (database) pendingUploads = (await database.getUploadQueueStats()).count;} catch {}
  const errorState = (error: unknown) => {const value = redactError(error); return value ? {class: value.class, ...(value.status === undefined ? {} : {status: value.status})} : null;};
  return {v: 1 as const, event: 'snapshot' as const, ts: diagnosticTimestamp(now), app: `${source.version} (${source.build})`, version: source.version, build: source.build, os: source.os, env: source.environment(), shareAvailable,
    sync: {connected: status?.connected ?? false, lastSyncedAt: status?.lastSyncedAt?.toISOString() ?? null, uploadError: errorState(status?.uploadError), downloadError: errorState(status?.downloadError), pendingUploads},
    session: source.session().status, reauthentication: source.reauthentication(), network: source.network(),
  };
}
export type DiagnosticSnapshot = Awaited<ReturnType<typeof readDiagnosticSnapshot>>;
