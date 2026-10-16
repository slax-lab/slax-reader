const repeatPhases = ['hold-after-offline-commit', 'resume-after-offline-commit', 'repeat-accepted'];
const equal = (a: unknown, b: unknown): boolean => {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)])) : value;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
};
function check(value: unknown): asserts value {if (!value) throw new Error('A genuine completed Android original-queue service fixture is required for this repeat phase');}

/** This prerequisite authorizes only synthetic repeat phases, never runtime adoption. */
export function validateCompletedServicePrerequisite(value: unknown, platform: string, phase: string, runId?: string): void {
  check(platform === 'android' && repeatPhases.includes(phase) && value && typeof value === 'object');
  const report = value as Record<string, unknown>;
  check(report.status === 'passed' && report.platform === platform && report.coreVersion === '0.5.3/2ba6b280' && typeof report.runId === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(report.runId) && (runId === undefined || report.runId === runId));
  check(['/data/data/com.slax.reader/databases/powersync.db', '/data/user/0/com.slax.reader/databases/powersync.db'].includes(String(report.databasePath)));
  for (const key of ['serviceReconnect', 'originalLegacyFirstQueueUpload', 'actualServiceProcessKillRecovery', 'actualRetryRetainsQueue', 'replicationCheckpointObserved', 'defaultTransportReplicated', 'explicitWebSocketReplicated', 'originalPreferencesUntouched', 'completeLocalJsonUntouched', 'originalCacheRetained']) check(report[key] === true);
  check(report.productionAdoptionEnabled === false && report.credentialsPersisted === false && report.originalQueueOperations === 4 && report.pendingOperations === 0);
  const expectedIds = ['tag-1', 'bookmark-1', 'bookmark-1', 'comment-1', 'bookmark-1', `tag-service-android-${report.runId.slice(0, 36)}`];
  const tables = ['sr_user_tag', 'sr_user_bookmark', 'sr_user_bookmark', 'sr_bookmark_comment', 'sr_user_bookmark', 'sr_user_tag'];
  const operations = ['PUT', 'PUT', 'PATCH', 'PUT', 'PATCH', 'PUT'];
  const pending = report.offlineTransaction as {transactionId: number; crud: {clientId: number; id: string; op: string; table: string}[]}[];
  check(Array.isArray(pending) && pending.length === 3 && pending.every((transaction, index) => transaction.transactionId === index + 1 && Array.isArray(transaction.crud) && transaction.crud.length === 2));
  check(equal(pending.flatMap(transaction => transaction.crud.map(entry => entry.clientId)), [1, 2, 3, 4, 5, 6]));
  check(equal(pending.flatMap(transaction => transaction.crud.map(entry => [entry.id, entry.table, entry.op])), expectedIds.map((id, index) => [id, tables[index], operations[index]])));
  check(equal(report.realNativeSdkCompletions, [{transactionId: 1, clientIds: [1, 2]}, {transactionId: 2, clientIds: [3, 4]}, {transactionId: 3, clientIds: [5, 6]}]));
  const receipts = report.exactServerSqlReceipts as {id: string; table: string; op: string}[][];
  check(Array.isArray(receipts) && receipts.every(Array.isArray) && equal(receipts.flat().map(entry => [entry.id, entry.table, entry.op]), expectedIds.map((id, index) => [id, tables[index], operations[index]])));
  const rows = report.materializedNativeRows as Record<string, Record<string, unknown>[]>;
  check(rows && equal(rows, report.materializedLegacyRows));
  check(rows.sr_user_tag?.length === 1 && rows.sr_user_tag[0]?.id === 'tag-1' && rows.sr_user_tag[0]?.display === 'Offline');
  check(rows.sr_user_bookmark?.length === 1 && rows.sr_user_bookmark[0]?.id === 'bookmark-1' && rows.sr_user_bookmark[0]?.alias_title === 'Controlled actual service offline edit' && rows.sr_user_bookmark[0]?.is_starred === 1 && rows.sr_user_bookmark[0]?.metadata === '{"tags":["tag-1","tag-2"],"share":{"allow_access":0}}');
  check(rows.sr_bookmark_comment?.length === 1 && rows.sr_bookmark_comment[0]?.id === 'comment-1' && rows.sr_bookmark_comment[0]?.comment === 'Pending comment');
  const traffic = report.traffic as Record<string, number>;
  check(traffic && traffic.streamHttpRequests >= 2 && traffic.webSocketUpgrades >= 1 && traffic.serverToClientBytes > 0);
}
