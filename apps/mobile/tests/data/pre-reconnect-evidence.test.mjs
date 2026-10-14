import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {validateServiceLocalJson, validatePreReconnectServiceBaseline} from './pre-reconnect-evidence.ts';

const retained = JSON.parse(readFileSync(new URL('./adoption-fixtures/reports/ios-source-valid-original-queue-real-service.json', import.meta.url), 'utf8'));
const visible = JSON.parse(readFileSync(new URL('./adoption-fixtures/reports/ios-source-valid-passive-input-visible-ui.json', import.meta.url), 'utf8'));

// Constructed host receipts exercise the contract using recorded native event payloads;
// they are never emitted as native pre-reconnect acceptance evidence.
function fixture() {
  const source = structuredClone(retained.originalNativeProducer), snapshot = structuredClone(retained.openingHold.baseline);
  const metadata = structuredClone(visible.actualReaderObservations);
  const request = {kind: 'slax-controlled-visible-upgrade-request', version: 1, phase: 'pre-reconnect', platform: 'ios', device: retained.device,
    runId: retained.runId, nonce: metadata.nonce, requestedAt: metadata.requestedAt, visibleInputsSHA256: retained.inputsSHA256};
  const identity = {owner: 'controlled-native-owner', relativePath: 'Library/Application Support/databases/powersync.db'};
  const requestRaw = JSON.stringify(request), md5String = value => createHash('md5').update(value).digest('hex'), visibilityRequestMd5 = md5String(requestRaw);
  metadata.visibilityRequestMd5 = visibilityRequestMd5;
  const local = {...JSON.parse(source.localJson), read_position: '351'}, localJson = JSON.stringify(local);
  const current = {...snapshot, localDigest: '1'.repeat(64)};
  const offline = {...request, kind: 'slax-controlled-pre-reconnect-visible-startup', status: 'passed', capturedAt: request.requestedAt + 1, visibilityRequestMd5,
    normalCreateMobileDataRuntimeExecuted: true, explicitAdoptionEvidenceProvided: false, networkRequestsForwarded: 0,
    actualNativeResourceOwner: metadata.actualNativeResourceOwner, nativeDatabaseIdentity: structuredClone(identity),
    before: structuredClone(snapshot), afterSchema: structuredClone(snapshot), afterAccountStart: structuredClone(snapshot),
    originalLocalRows: [{id: 'bookmark-1', data: source.localJson}], pending: structuredClone(source.transactions),
    actualSdkVersion: '2.3.1', actualCoreVersion: '0.5.3/2ba6b280', originalCacheRetained: true, originalLocalJsonRetained: true,
    originalPreferencesUntouched: true, originalBookmarkTagCommentAvailableInNormalRepositories: true,
    sourceCachedArticleMd5: visible.actualContext.sourceCachedArticleMd5, originalDataStoreFingerprint: visible.actualContext.originalDataStoreFingerprint};
  const context = {...request, kind: 'slax-controlled-visible-upgrade-context', capturedAt: visible.actualContext.capturedAt, visibilityRequestMd5,
    realProductionRoutesMounted: true, simulatedUiRowsOrHtml: false, fixtureOnlyProviderUsed: false, explicitAdoptionEvidenceProvided: false,
    normalRuntimeReady: true, networkRequestsForwarded: 0, actualNativeResourceOwner: metadata.actualNativeResourceOwner,
    originalPendingQueueAndDataUnchanged: true, currentPending: structuredClone(source.transactions), currentInspection: structuredClone(current),
    currentLocalJson: local, currentLocalRows: [{id: 'bookmark-1', data: localJson}], observedRoute: {name: 'Library'}, canGoBack: false,
    sourceCachedArticleMd5: offline.sourceCachedArticleMd5, originalDataStoreFingerprint: offline.originalDataStoreFingerprint};
  const receipt = {...request, kind: 'slax-controlled-pre-reconnect-visible-finished', capturedAt: context.capturedAt + 1,
    visibilityRequestRaw: requestRaw, visibilityRequestMd5, offline, context, observations: metadata};
  return {source, receipt, platform: 'ios', runId: retained.runId, nativeDatabaseIdentity: identity, originalSnapshot: current, currentLocalJson: localJson, md5String};
}

test('without an offline receipt the original complete local JSON remains byte-exact', () => {
  const d = fixture();
  assert.equal(validateServiceLocalJson(d.source.localJson, d.source.localJson), d.source.localJson);
  assert.throws(() => validateServiceLocalJson(d.source.localJson, d.currentLocalJson));
  assert.throws(() => validateServiceLocalJson(d.source.localJson, JSON.stringify(JSON.parse(d.source.localJson), null, 2)));
});

test('recorded native ready/scroll/persistence and committed exit permit only the observed reading position', () => {
  const d = fixture();
  assert.equal(validateServiceLocalJson(d.source.localJson, d.currentLocalJson, d), d.currentLocalJson);
  assert.equal(JSON.parse(d.source.localJson).read_position, '348.25');
  assert.equal(JSON.parse(d.currentLocalJson).read_position, '351');
  assert.deepEqual(d.receipt.context.currentPending, d.source.transactions);
});

test('pre-reconnect evidence rejects stale ownership, altered business operations, nonposition JSON and fabricated persistence', async t => {
  for (const [name, change] of [
    ['other service run', d => d.runId = 'other-run'],
    ['other finished nonce', d => d.receipt.nonce = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'],
    ['other source input', d => d.receipt.visibleInputsSHA256 = 'a'.repeat(64)],
    ['rewritten raw request', d => d.receipt.visibilityRequestRaw += '\n'],
    ['different raw request fingerprint', d => d.receipt.context.visibilityRequestMd5 = 'b'.repeat(32)],
    ['other native owner', d => d.nativeDatabaseIdentity.owner = 'another-native-owner'],
    ['changed business checksum', d => d.originalSnapshot.dataDigest = 'a'.repeat(64)],
    ['changed queue checksum', d => d.receipt.context.currentInspection.queueDigest = 'b'.repeat(64)],
    ['different captured local checksum', d => d.originalSnapshot.localDigest = 'c'.repeat(64)],
    ['missing original mark', d => d.receipt.context.currentPending[1].crud.pop()],
    ['extra original operation', d => d.receipt.context.currentPending[1].crud.push(d.source.transactions[0].crud[0])],
    ['reordered original operations', d => d.receipt.context.currentPending[0].crud.reverse()],
    ['changed operation payload', d => d.receipt.context.currentPending[1].crud[1].opData.comment = 'not the original mark'],
    ['different transaction identity', d => d.receipt.context.currentPending[1].transactionId = 4],
    ['altered future metadata', d => {const value = JSON.parse(d.currentLocalJson); value.future_field.preserve = false; d.currentLocalJson = JSON.stringify(value);}],
    ['altered outline position without native observation', d => {const value = JSON.parse(d.currentLocalJson); value.outline_read_position = '13'; d.currentLocalJson = JSON.stringify(value);}],
    ['extra local row', d => d.receipt.context.currentLocalRows.push({id: 'unexpected', data: '{}'})],
    ['lost original cached article', d => d.receipt.context.sourceCachedArticleMd5 = 'e'.repeat(32)],
    ['changed original preferences', d => d.receipt.context.originalDataStoreFingerprint = 'changed'],
    ['adoption override', d => d.receipt.offline.explicitAdoptionEvidenceProvided = true],
    ['forwarded network request', d => d.receipt.context.networkRequestsForwarded = 1],
    ['only a declared persisted event', d => d.receipt.observations.events = d.receipt.observations.events.filter(e => e.type === 'position-persisted')],
    ['no matching native scroll', d => d.receipt.observations.events = d.receipt.observations.events.filter(e => e.type !== 'native-scroll')],
    ['no real document readiness', d => d.receipt.observations.events = d.receipt.observations.events.filter(e => e.type !== 'ready')],
    ['uncommitted route exit', d => d.receipt.observations.events = d.receipt.observations.events.filter(e => e.type !== 'lifecycle')],
    ['capture before final native event', d => d.receipt.context.capturedAt = d.receipt.requestedAt + 2],
    ['reader still active', d => d.receipt.context.observedRoute.name = 'Reader'],
  ]) await t.test(name, () => {const d = fixture(); change(d); assert.throws(() => validatePreReconnectServiceBaseline(d));});
});
