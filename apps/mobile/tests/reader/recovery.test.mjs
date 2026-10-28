import test from 'node:test'
import assert from 'node:assert/strict'
import {ReaderCrashRecovery, readerDocumentError, READER_PROCESS_GONE} from '../../src/reader/recovery.ts'

test('ordinary operation failures do not replace the document, while a crash recovers identical content', async () => {
  const recovery = new ReaderCrashRecovery()
  assert.equal(recovery.fail(new Error('Network request failed')), false)
  assert.equal(await recovery.retry(async () => assert.fail('No operation-error remount'), () => 500), null)
  assert.equal(recovery.fail(readerDocumentError(READER_PROCESS_GONE)), true)
  assert.deepEqual(await recovery.retry(async () => {}, () => 500), {generation: 1, position: 500})
  assert.equal(await recovery.retry(async () => assert.fail('No duplicate remount'), () => 0), null)
})
test('native document load failures expose manual recovery without repeated automatic reloads', async () => {
  const recovery = new ReaderCrashRecovery(), error = readerDocumentError(-1, 'Reader security policy unavailable')
  assert.equal(error.name, 'ReaderDocumentLoadFailed')
  assert.equal(recovery.fail(error), true); assert.equal(recovery.needsRecovery, true)
  assert.equal(await recovery.recoverForeground(async () => assert.fail('Load failures wait for retry'), () => 500, () => true), null)
  assert.deepEqual(await recovery.retry(async () => {}, () => 500), {generation: 1, position: 500})
  assert.equal(recovery.needsRecovery, false)
  assert.equal(await recovery.retry(async () => assert.fail('No duplicate remount'), () => 0), null)
})
test('concurrent retry flushes once and restores the latest position after pending persistence', async () => {
  const recovery = new ReaderCrashRecovery(); recovery.fail(readerDocumentError(READER_PROCESS_GONE))
  let release, flushes = 0, position = 120
  const flush = () => {flushes++; return new Promise(resolve => {release = resolve})}
  const first = recovery.retry(flush, () => position)
  const second = recovery.retry(flush, () => position)
  assert.equal(first, second)
  position = 450; release()
  assert.deepEqual(await first, {generation: 1, position: 450})
  assert.equal(flushes, 1)
})
test('exit while retry persistence is pending does not resurrect the departed native reader', async () => {
  const recovery = new ReaderCrashRecovery(); recovery.fail(readerDocumentError(READER_PROCESS_GONE))
  let release
  const pending = recovery.retry(() => new Promise(resolve => {release = resolve}), () => 50)
  recovery.dispose(); release()
  assert.equal(await pending, null)
})
