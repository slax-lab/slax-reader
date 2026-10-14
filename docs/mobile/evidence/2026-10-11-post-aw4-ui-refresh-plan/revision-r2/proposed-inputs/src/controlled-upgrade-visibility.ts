import {validateDatabaseSnapshot, unchangedDatabaseData, type DatabaseSnapshot} from './data/adoption.ts';

export const CONTROLLED_VISIBLE_INPUT_SHA256 = 'bd660fd48fbdecd7c9eb599ce701281fdf6c6ff78d716cab945cdcfc0d59d110';
export type UpgradeVisibilityPhase = 'pre-reconnect' | 'post-service';
type RecordValue = Record<string, unknown>;
const check: (value: unknown) => asserts value = value => {if (!value) throw new Error('Controlled upgrade visibility prerequisites do not match this phase');};
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
export const sameControlledValue = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/** An absent phase is the retained post-service contract; pending visibility always requires an explicit phase. */
export function upgradeVisibilityPhase(value: unknown): UpgradeVisibilityPhase {
  check(value === undefined || value === 'pre-reconnect' || value === 'post-service');
  return value === 'pre-reconnect' ? value : 'post-service';
}

export function validateVisibilityRequest(request: RecordValue, platform: string, device: string) {
  check(request.kind === 'slax-controlled-visible-upgrade-request' && request.version === 1 && request.platform === platform && request.device === device
    && typeof request.runId === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(request.runId)
    && typeof request.nonce === 'string' && /^[0-9a-f-]{36}$/.test(request.nonce)
    && Number.isSafeInteger(request.requestedAt) && (request.requestedAt as number) > 0 && request.visibleInputsSHA256 === CONTROLLED_VISIBLE_INPUT_SHA256);
  upgradeVisibilityPhase(request.phase);
}

export function validateVisibleLegacyProducer(source: RecordValue, platform: string) {
  check(source.controlledFixture === true && source.fixtureVersion === 1 && source.fixtureScenario === 'source-valid-visible-v1'
    && source.visibleInputsSHA256 === CONTROLLED_VISIBLE_INPUT_SHA256 && source.producer === 'powersync-kotlin-1.14.1'
    && typeof source.coreVersion === 'string' && source.coreVersion.startsWith('0.5.1/'));
  check(platform === 'ios' ? source.iosBundleId === 'app.slax.reader' && source.nativePlatform === 'ios-simulator'
    : platform === 'android' && source.androidBundleId === 'com.slax.reader');
  const transactions = source.transactions as {transactionId: number; crud: RecordValue[]}[];
  check(Array.isArray(transactions) && transactions.length === 2 && transactions.every((value, index) => value.transactionId === index + 1 && Array.isArray(value.crud) && value.crud.length === 2));
  check(sameControlledValue(transactions.flatMap(value => value.crud.map(entry => [entry.clientId, entry.table, entry.op, entry.id])), [
    [1, 'sr_user_tag', 'PUT', 'tag-1'], [2, 'sr_user_bookmark', 'PUT', 'bookmark-1'],
    [3, 'sr_user_bookmark', 'PATCH', 'bookmark-1'], [4, 'sr_bookmark_comment', 'PUT', 'comment-1'],
  ]));
  const bookmark = transactions[0]!.crud[1]!.opData as RecordValue, patch = transactions[1]!.crud[0]!.opData as RecordValue,
    comment = transactions[1]!.crud[1]!.opData as RecordValue;
  check(bookmark && bookmark.user_id === 'synthetic-user' && bookmark.archive_status === 0 && bookmark.is_read === 0 && typeof bookmark.metadata === 'string'
    && patch?.is_starred === 1 && comment?.user_bookmark_uuid === 'bookmark-1' && comment.type === 2 && comment.comment === 'Pending comment');
  const metadata = JSON.parse(bookmark.metadata) as RecordValue;
  check((metadata.bookmark as RecordValue)?.status === 'success' && (metadata.bookmark as RecordValue)?.content_word_count === 661);
  check(typeof source.localJson === 'string');
  const local = JSON.parse(source.localJson) as RecordValue;
  check(local.read_position === '348.25' && local.is_downloaded === 2 && local.is_auto_cached === 0 && (local.future_field as RecordValue)?.preserve === true);
}

/** Reports are produced by the unchanged native delegate and normal factory, before mounting any product routes. */
export function validatePreReconnectVisibility(source: RecordValue, request: RecordValue, report: RecordValue, nativeOwner?: string) {
  validateVisibilityRequest(request, String(request.platform), String(request.device));
  check(request.phase === 'pre-reconnect' && request.visibleInputsSHA256 === CONTROLLED_VISIBLE_INPUT_SHA256);
  check(report.kind === 'slax-controlled-pre-reconnect-visible-startup' && report.version === 1 && report.status === 'passed');
  for (const key of ['platform', 'device', 'runId', 'nonce', 'requestedAt', 'visibleInputsSHA256']) check(report[key] === request[key]);
  check(Number.isSafeInteger(request.requestedAt) && typeof report.capturedAt === 'number' && report.capturedAt >= (request.requestedAt as number));
  check(report.explicitAdoptionEvidenceProvided === false && report.networkRequestsForwarded === 0 && typeof report.actualNativeResourceOwner === 'string'
    && report.actualNativeResourceOwner && (nativeOwner === undefined || report.actualNativeResourceOwner === nativeOwner));
  const identity = report.nativeDatabaseIdentity as RecordValue;
  check(identity && typeof identity.owner === 'string' && identity.owner && typeof identity.relativePath === 'string' && identity.relativePath);
  const before = report.before as DatabaseSnapshot, after = report.afterSchema as DatabaseSnapshot;
  check(before && after);
  validateDatabaseSnapshot(before, before.databasePath); validateDatabaseSnapshot(after, before.databasePath);
  check(before.pendingOperations === 4 && before.pendingTransactions === 2 && unchangedDatabaseData(before, after));
  const afterAccountStart = report.afterAccountStart as DatabaseSnapshot;
  check(afterAccountStart && unchangedDatabaseData(before, afterAccountStart));
  validateDatabaseSnapshot(afterAccountStart, before.databasePath);
  check(report.normalCreateMobileDataRuntimeExecuted === true && report.actualSdkVersion === '2.3.1' && report.actualCoreVersion === '0.5.3/2ba6b280');
  check(sameControlledValue(report.pending, source.transactions));
  for (const key of ['originalCacheRetained', 'originalLocalJsonRetained', 'originalPreferencesUntouched', 'originalBookmarkTagCommentAvailableInNormalRepositories']) check(report[key] === true);
}

/** Keep the historical post-service boundary separate from pending-queue rendering. */
export function validatePostServiceVisibility(platform: string, device: string, service: RecordValue, startup: RecordValue) {
  check(service.status === 'passed' && service.platform === platform && service.originalLegacyFirstQueueUpload === true && service.credentialsPersisted === false
    && service.originalQueueOperations === 4 && service.pendingOperations === 0 && (service.exactServerSqlReceipts as unknown[][])?.flat().length === 6);
  check(sameControlledValue(service.realNativeSdkCompletions, [{transactionId: 1, clientIds: [1, 2]}, {transactionId: 2, clientIds: [3, 4]}, {transactionId: 3, clientIds: [5, 6]}]));
  check(startup.kind === 'slax-controlled-normal-runtime-start-report' && startup.status === 'passed' && startup.platform === platform && startup.device === device
    && startup.explicitAdoptionEvidenceProvided === false && startup.networkRequestsForwarded === 0 && startup.originalBookmarkTagCommentAvailableInNormalRepositories === true
    && startup.originalCacheReadByNormalAccountCache === true);
}
