import {sameControlledValue, validatePreReconnectVisibility, validateVisibleLegacyProducer} from '../../src/controlled-upgrade-visibility.ts';
import {validateDatabaseSnapshot, type DatabaseSnapshot} from '../../src/data/adoption.ts';
import type {DatabaseLogicalIdentity} from '../../src/data/upgrade.ts';

type Value = Record<string, unknown>;
const check: (value: unknown) => asserts value = value => {if (!value) throw new Error('Pre-reconnect native reading evidence does not preserve the original queue and local state');};
const record = (value: unknown): Value => {check(value && typeof value === 'object' && !Array.isArray(value)); return value as Value;};
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** Synthetic-only bridge between a finished normal offline render and its subsequent real-service exercise. */
export function validatePreReconnectServiceBaseline(options: {
  source: Value; receipt: Value; platform: string; runId: string; nativeDatabaseIdentity: DatabaseLogicalIdentity;
  originalSnapshot: DatabaseSnapshot; currentLocalJson: string; md5String(value: string): string;
}): string {
  const {source, receipt, platform, runId, nativeDatabaseIdentity, originalSnapshot, currentLocalJson} = options;
  validateVisibleLegacyProducer(source, platform);
  check(receipt.kind === 'slax-controlled-pre-reconnect-visible-finished' && receipt.version === 1 && receipt.phase === 'pre-reconnect'
    && receipt.platform === platform && receipt.runId === runId && typeof receipt.device === 'string'
    && (platform === 'ios' ? /^[0-9a-f-]{36}$/i.test(receipt.device) && originalSnapshot.databasePath.includes(`/CoreSimulator/Devices/${receipt.device}/data/Containers/Data/Application/`) : /^emulator-\d+$/.test(receipt.device)));
  const offline = record(receipt.offline), context = record(receipt.context), observations = record(receipt.observations);
  check(typeof receipt.visibilityRequestRaw === 'string' && receipt.visibilityRequestRaw.length <= 8192
    && typeof receipt.visibilityRequestMd5 === 'string' && /^[a-f0-9]{32}$/.test(receipt.visibilityRequestMd5)
    && options.md5String(receipt.visibilityRequestRaw) === receipt.visibilityRequestMd5);
  const originalRequest = record(JSON.parse(receipt.visibilityRequestRaw));
  check(originalRequest.kind === 'slax-controlled-visible-upgrade-request' && originalRequest.phase === 'pre-reconnect');
  for (const key of ['version', 'platform', 'device', 'runId', 'nonce', 'requestedAt', 'visibleInputsSHA256']) check(originalRequest[key] === receipt[key]);
  validatePreReconnectVisibility(source, {...receipt, kind: 'slax-controlled-visible-upgrade-request'}, offline);
  check(sameControlledValue(nativeDatabaseIdentity, offline.nativeDatabaseIdentity));
  validateDatabaseSnapshot(originalSnapshot, originalSnapshot.databasePath);
  const before = offline.before as DatabaseSnapshot;
  check(originalSnapshot.databasePath === before.databasePath && originalSnapshot.dataDigest === before.dataDigest
    && originalSnapshot.queueDigest === before.queueDigest && originalSnapshot.pendingOperations === 4 && originalSnapshot.pendingTransactions === 2);
  for (const value of [context, observations]) {
    for (const key of ['platform', 'device', 'runId', 'nonce', 'requestedAt', 'visibleInputsSHA256']) check(value[key] === receipt[key]);
    check(value.actualNativeResourceOwner === offline.actualNativeResourceOwner);
  }
  check([offline, context, observations].every(value => value.visibilityRequestMd5 === receipt.visibilityRequestMd5));
  check(context.kind === 'slax-controlled-visible-upgrade-context' && context.version === 1 && context.phase === 'pre-reconnect'
    && context.realProductionRoutesMounted === true && context.simulatedUiRowsOrHtml === false && context.fixtureOnlyProviderUsed === false
    && context.explicitAdoptionEvidenceProvided === false && context.normalRuntimeReady === true && context.networkRequestsForwarded === 0
    && context.originalPendingQueueAndDataUnchanged === true && sameControlledValue(context.currentPending, source.transactions)
    && context.originalDataStoreFingerprint === offline.originalDataStoreFingerprint && typeof context.originalDataStoreFingerprint === 'string'
    && context.sourceCachedArticleMd5 === offline.sourceCachedArticleMd5 && /^[0-9a-f]{32}$/.test(String(context.sourceCachedArticleMd5)));
  const captured = context.currentInspection as DatabaseSnapshot;
  validateDatabaseSnapshot(captured, before.databasePath);
  check(captured.pendingOperations === 4 && captured.pendingTransactions === 2 && captured.queueDigest === before.queueDigest && captured.dataDigest === before.dataDigest
    && captured.localDigest === originalSnapshot.localDigest);
  const local = record(JSON.parse(currentLocalJson)), originalLocal = record(JSON.parse(String(source.localJson)));
  const originalRows = offline.originalLocalRows as Value[], currentRows = context.currentLocalRows as Value[];
  check(sameControlledValue(originalRows, [{id: 'bookmark-1', data: source.localJson}]) && Array.isArray(currentRows) && currentRows.length === 1
    && currentRows[0]?.id === 'bookmark-1' && currentRows[0].data === currentLocalJson && sameControlledValue(local, context.currentLocalJson));
  const withoutPosition = ({read_position: _position, ...rest}: Value) => rest;
  check(sameControlledValue(withoutPosition(local), withoutPosition(originalLocal)) && typeof local.read_position === 'string'
    && String(Number(local.read_position)) === local.read_position && finite(Number(local.read_position)));
  check(observations.kind === 'slax-controlled-visible-upgrade-reader-observations' && observations.version === 1 && observations.observationsOnly === true
    && Array.isArray(observations.events) && observations.events.length > 0 && observations.events.length <= 128);
  const events = (observations.events as unknown[]).map(record);
  check(events.every(event => event.cacheKey === 'bookmark-1' && typeof event.routeKey === 'string' && event.routeKey.startsWith('Reader-')
    && finite(event.observedAt) && event.observedAt >= Number(receipt.requestedAt) && JSON.stringify(event).length <= 8192));
  const persisted = events.filter(event => event.type === 'position-persisted' && finite(event.persistedPixels) && event.persistedPixels === Number(local.read_position)
    && event.requestedPixels === event.persistedPixels && typeof event.pageId === 'string').at(-1);
  check(persisted);
  const samePage = (event: Value) => event.routeKey === persisted.routeKey && record(event.event).bridge && record(record(event.event).bridge).pageId === persisted.pageId;
  const ready = events.find(event => event.type === 'ready' && samePage(event) && (event.observedAt as number) <= (persisted.observedAt as number)
    && record(record(event.event).bridge).ready === true && record(record(event.event).bridge).documentLoaded === true);
  const nativeScroll = events.find(event => event.type === 'native-scroll' && samePage(event) && (event.observedAt as number) <= (persisted.observedAt as number)
    && record(record(event.event).bridge).ready === true && record(record(event.event).bridge).documentLoaded === true
    && record(record(event.event).observed).positionPixels === persisted.persistedPixels && record(event.event).consumed === true);
  check(ready && nativeScroll && (ready.observedAt as number) <= (nativeScroll.observedAt as number));
  for (const kind of ['unmount', 'position-flush-completed', 'native-detach-completed']) check(events.some(event => event.type === 'lifecycle'
    && event.routeKey === persisted.routeKey && record(event.event).pageId === persisted.pageId && record(event.event).kind === kind
    && (event.observedAt as number) >= (persisted.observedAt as number) && record(event.event).ready === true));
  check(context.observedRoute && record(context.observedRoute).name === 'Library' && context.canGoBack === false
    && finite(context.capturedAt) && context.capturedAt >= Math.max(...events.map(event => Number(event.observedAt)))
    && finite(receipt.capturedAt) && receipt.capturedAt >= context.capturedAt);
  return currentLocalJson;
}

/** Absence of a visibility receipt keeps the original byte-for-byte adoption predicate. */
export function validateServiceLocalJson(sourceLocalJson: string, currentLocalJson: string, evidence?: Parameters<typeof validatePreReconnectServiceBaseline>[0]): string {
  if (!evidence) {check(currentLocalJson === sourceLocalJson); return currentLocalJson;}
  check(evidence.source.localJson === sourceLocalJson && evidence.currentLocalJson === currentLocalJson);
  return validatePreReconnectServiceBaseline(evidence);
}
