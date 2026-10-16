import test from 'node:test'
import assert from 'node:assert/strict'
import {ReaderCrashRecovery, readerDocumentError, READER_PROCESS_GONE} from '../../src/reader/recovery.ts'

test('ordinary network failures do not replace the document, while a crash recovers identical content', async () => {
  const recovery = new ReaderCrashRecovery()
  assert.equal(recovery.fail(readerDocumentError(-1)), false)
  assert.equal(await recovery.retry(async () => assert.fail('No network-error remount'), () => 500), null)
  assert.equal(recovery.fail(readerDocumentError(READER_PROCESS_GONE)), true)
  assert.deepEqual(await recovery.retry(async () => {}, () => 500), {generation: 1, position: 500})
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
