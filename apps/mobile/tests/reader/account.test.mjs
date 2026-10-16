import test from 'node:test'
import assert from 'node:assert/strict'
import {readerAccountActive, updateReaderPreferences} from '../../src/reader/account.ts'
import {ReaderPositionWriter} from '../../src/reader/position.ts'
import {PreferenceStore} from '../../src/data/preferences.ts'
import {MemoryPreferences} from '../data/helpers.ts'

test('committed reader exits flush for the same account but logout discards pending positions', async () => {
  let state = {status: 'authenticated', session: {token: 'synthetic-a', userId: 'a', refreshedAt: 0}}
  const written = []
  const writer = new ReaderPositionWriter(value => {if (readerAccountActive(state, 'a')) written.push(value)}, () => {}, 60_000)
  writer.update(230); await writer.dispose('exit')
  assert.deepEqual(written, [230])
  const oldReader = new ReaderPositionWriter(value => {if (readerAccountActive(state, 'a')) written.push(value)}, () => {}, 60_000)
  oldReader.update(470); state = {status: 'loading'}
  await oldReader.dispose('exit')
  assert.deepEqual(written, [230])
})

test('a delayed continue-reading CAS cannot replace the next account context', async () => {
  const storage = new MemoryPreferences({user_id: 'a'})
  const preferences = new PreferenceStore(storage)
  let state = {status: 'authenticated', session: {token: 'synthetic-a', userId: 'a', refreshedAt: 0}}
  storage.beforeSwap = () => {
    storage.beforeSwap = undefined
    state = {status: 'authenticated', session: {token: 'synthetic-b', userId: 'b', refreshedAt: 0}}
    storage.values = {user_id: 'b', continue_reading_bookmark: 'account-b-context'}; storage.revision++
  }
  await updateReaderPreferences(preferences, 'a', () => state, values => {values.continue_reading_bookmark = 'account-a-context'})
  assert.deepEqual(await preferences.read(), {user_id: 'b', continue_reading_bookmark: 'account-b-context'})
  state = {status: 'loading'}
  await updateReaderPreferences(preferences, 'b', () => state, values => {delete values.continue_reading_bookmark})
  assert.equal((await preferences.read()).continue_reading_bookmark, 'account-b-context')
})

test('a departed reader cannot acquire a new account scope when its context changes or the same user logs in again', async () => {
  const authenticated = userId => ({status: 'authenticated', session: {token: 'synthetic', userId, refreshedAt: 0}})
  const owner = 'scope-a'
  let currentOwner = owner
  const owns = userId => readerAccountActive(authenticated(userId), userId, {owner, currentOwner})
  assert.equal(owns('a'), true)
  currentOwner = 'scope-b'
  assert.equal(owns('b'), false, 'new context userId must not rebind the departed reader')
  assert.equal(owns('a'), false, 'the same user still needs a new scope after a fresh login')
  const storage = new MemoryPreferences({user_id: 'a', continue_reading_bookmark: 'new-session-context'})
  const preferences = new PreferenceStore(storage)
  await updateReaderPreferences(preferences, 'a', () => authenticated('a'), values => {delete values.continue_reading_bookmark}, () => owns('a'))
  assert.equal((await preferences.read()).continue_reading_bookmark, 'new-session-context')
})
