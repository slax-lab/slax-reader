import test from 'node:test';
import assert from 'node:assert/strict';
import {offlineEngineError, offlinePdfDescriptor, unavailableOfflineEngine, OfflineEngineUnavailableError} from '../../src/data/offline-engine.ts';
import {getDataErrorDiagnostic} from '../../src/data/transport-errors.ts';
import {loadComponent} from '../reader/parity-host.mjs';

const {pdfMustInvalidate} = await loadComponent('../../src/reader/state/document-errors.ts', {
  '../../data/transport-errors': {getDataErrorDiagnostic}, '../../rss/controller': {rssErrorCode: () => 'unknown'}, '../pdf-errors': {pdfFailure: () => ({stage: 'document', code: 'unknown'})},
});

const descriptor = {filename: 'paper.pdf', size: 12, document_id: 'opaque identity', source: 'url', text_status: 'ready', pages: 2};

test('native PDF descriptors keep an opaque identity and the existing relative transport URL', () => {
  assert.deepEqual(offlinePdfDescriptor('bookmark /?&', {...descriptor, url: 'https://untrusted.example/x.pdf'}), {...descriptor, url: `/v1/bookmark/pdf?bookmark_uid=${encodeURIComponent('bookmark /?&')}`});
  const {pages: _pages, ...withoutPages} = descriptor;
  assert.deepEqual(offlinePdfDescriptor('b', {...withoutPages, pages: null}), {...withoutPages, url: '/v1/bookmark/pdf?bookmark_uid=b'});
  for (const invalid of [null, {...descriptor, size: 0}, {...descriptor, size: 1.5}, {...descriptor, document_id: ''}, {...descriptor, document_id: 'x'.repeat(257)},
    {...descriptor, source: 'external'}, {...descriptor, text_status: 'unknown'}, {...descriptor, pages: 0}, {...descriptor, filename: 3}]) {
    assert.throws(() => offlinePdfDescriptor('b', invalid), error => error.name === 'ApiError' && error.code === 'pdf_metadata_invalid', JSON.stringify(invalid));
  }
});

test('native rejection codes map onto the transport errors the Reader classifies', () => {
  const http = offlineEngineError(Object.assign(new Error('x'), {code: 'ERR_HTTP_404'}), 'pdf-range');
  assert.deepEqual(getDataErrorDiagnostic(http), {stage: 'pdf-range', kind: 'http', code: 'http_not_found', status: 404}); assert.equal(pdfMustInvalidate(http), true);
  const server = offlineEngineError({code: 'HTTP_503'}, 'pdf-range'); assert.equal(pdfMustInvalidate(server), false);
  assert.deepEqual(getDataErrorDiagnostic(offlineEngineError({code: 'NETWORK'}, 'pdf-metadata')), {stage: 'pdf-metadata', kind: 'network', code: 'network_unavailable'});
  assert.deepEqual(getDataErrorDiagnostic(offlineEngineError({code: 'ERR_TIMEOUT'}, 'pdf-range')), {stage: 'pdf-range', kind: 'timeout', code: 'request_timeout'});
  assert.equal(offlineEngineError({code: 'CANCELLED'}, 'api').name, 'AbortError');
  const identity = offlineEngineError({code: 'pdf_identity_mismatch'}, 'pdf-range');
  assert.deepEqual(getDataErrorDiagnostic(identity), {stage: 'pdf-range', kind: 'protocol', code: 'pdf_identity_mismatch', status: 412}); assert.equal(pdfMustInvalidate(identity), true);
  const unknown = new Error('unmapped'); assert.equal(offlineEngineError(unknown, 'api'), unknown);
});

test('native DataErrorCode rejections (iOS message status, Android code only) classify like the former JavaScript transport', () => {
  const ios = offlineEngineError(Object.assign(new Error('http_server_error (503)'), {code: 'http_server_error'}), 'pdf-range');
  assert.deepEqual(getDataErrorDiagnostic(ios), {stage: 'pdf-range', kind: 'http', code: 'http_server_error', status: 503});
  const android = offlineEngineError(Object.assign(new Error('Offline engine request failed: http_not_found'), {code: 'http_not_found'}), 'pdf-metadata');
  assert.equal(android.status, 404); assert.equal(pdfMustInvalidate(android), true);
  assert.equal(pdfMustInvalidate(offlineEngineError({code: 'http_forbidden', message: 'http_forbidden (403)'}, 'pdf-range')), true);
  assert.equal(getDataErrorDiagnostic(offlineEngineError({code: 'network_unavailable'}, 'pdf-range')).kind, 'network');
  assert.equal(getDataErrorDiagnostic(offlineEngineError({code: 'request_timeout'}, 'pdf-range')).kind, 'timeout');
  assert.equal(offlineEngineError({code: 'operation_cancelled'}, 'api').name, 'AbortError');
  assert.equal(getDataErrorDiagnostic(offlineEngineError({code: 'session_changed'}, 'api')).kind, 'session');
  assert.equal(offlineEngineError({code: 'credential_unavailable'}, 'api').name, 'CredentialsUnavailableError');
  assert.equal(getDataErrorDiagnostic(offlineEngineError({code: 'pdf_range_invalid', message: 'pdf_range_invalid (502)'}, 'pdf-range')).code, 'pdf_range_invalid');
  assert.equal(offlineEngineError({code: 'pdf_metadata_failed', message: 'pdf_metadata_failed (404)'}, 'pdf-metadata').status, 404);
});

test('hosts without the native engine cache nothing and reject network reads explicitly', async () => {
  const engine = unavailableOfflineEngine();
  assert.deepEqual(await engine.open({owner: 'o'}), {adopted: [], dropped: [], migrationPending: false});
  assert.equal(await engine.readArticle('o', 'k'), null); assert.deepEqual(await engine.evict('o', ['k']), []);
  await assert.rejects(engine.fetchArticle('o', {key: 'k', id: 'k', requestId: 'r', force: false}), OfflineEngineUnavailableError);
  await assert.rejects(engine.readPdfRange('o', {}), OfflineEngineUnavailableError);
  const subscription = engine.addListener('onStatus', () => assert.fail('No events')); subscription.remove();
});
