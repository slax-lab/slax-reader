import test from 'node:test';
import assert from 'node:assert/strict';
import {RuntimeActivity} from '../../src/data/runtime-activity.ts';
import {AccountDatabaseLease} from '../../src/data/account-lease.ts';
import type {SqlDatabase} from '../../src/data/repositories.ts';
import {DatabaseSync} from 'node:sqlite';

const deferred = () => {let resolve!: () => void; const promise = new Promise<void>(done => {resolve = done;}); return {promise, resolve};};

test('background protection begins synchronously, drains before resume, and coalesces stale foreground requests', async () => {
  const events: string[] = [], drain = deferred(); let token = 0;
  const activity = new RuntimeActivity({begin: () => {events.push('begin'); return ++token;}, end: async id => {events.push(`end:${id}`);}, pause: async () => {events.push('pause'); await drain.promise;}, resume: async () => {events.push('resume');}});
  const first = activity.setForeground(false);
  assert.deepEqual(events, ['begin', 'pause']); assert.equal(activity.isForeground(), false);
  const resume = activity.setForeground(true), latest = activity.setForeground(false);
  await Promise.resolve(); await Promise.resolve(); drain.resolve();
  await Promise.all([first, resume, latest]);
  assert.equal(events.includes('resume'), false); assert.equal(events.filter(event => event === 'pause').length, 2);
  await activity.setForeground(true);
  assert.equal(events.at(-1), 'resume'); assert.equal(activity.isForeground(), true);
  const length = events.length; await activity.setForeground(true); assert.equal(events.length, length);
});

test('assertion denial does not prevent pausing, and failed drain never revokes the next foreground transition', async () => {
  const events: string[] = [];
  const activity = new RuntimeActivity({begin: () => {throw new Error('denied');}, pause: async () => {events.push('pause'); throw new Error('disconnect');}, resume: async () => {events.push('resume');}});
  await assert.rejects(activity.setForeground(false), /disconnect/);
  await activity.setForeground(true); assert.deepEqual(events, ['pause', 'resume']);
});

test('account writes are protected before starting and drain without revoking account identity', async () => {
  const events: string[] = [], gate = deferred();
  const activity = new RuntimeActivity({begin: () => {events.push('begin'); return 1;}, end: async () => {events.push('end');}, pause: async () => {}, resume: async () => {}});
  const execute = async () => {events.push('write'); await gate.promise; return 7;};
  const database = {execute, writeTransaction: async (work: (transaction: {execute: typeof execute}) => Promise<unknown>) => work({execute})} as unknown as SqlDatabase;
  const lease = new AccountDatabaseLease(database, work => activity.whileActive(work));
  const writing = lease.execute('INSERT'); let drained = false;
  const drain = lease.drainWrites().then(() => {drained = true;});
  assert.deepEqual(events, ['begin', 'write']); assert.equal(drained, false);
  gate.resolve(); assert.equal(await writing, 7); await drain;
  assert.deepEqual(events, ['begin', 'write', 'end']); lease.assertActive();
  lease.invalidate(); await assert.rejects(lease.execute('INSERT'), /no longer active/);
});

test('expired native token rolls back an in-flight account transaction and denies queued work without revoking the account', async () => {
  const db = new DatabaseSync(':memory:'); db.exec('CREATE TABLE edits (id INTEGER)');
  const gate = deferred(), started = deferred(); let expired = false, rolledBack = false;
  const activity = new RuntimeActivity({begin: () => 1, check: () => {if (expired) throw new Error('expired');}, end: async () => {}, pause: async () => {}, resume: async () => {}});
  const database = {writeTransaction: async (work: (tx: {execute(sql: string): Promise<void>}) => Promise<unknown>) => {
    db.exec('BEGIN');
    try {const result = await work({execute: async sql => {db.exec(sql); started.resolve(); await gate.promise;}}); db.exec('COMMIT'); return result;}
    catch (error) {db.exec('ROLLBACK'); rolledBack = true; throw error;}
  }} as unknown as SqlDatabase;
  const lease = new AccountDatabaseLease(database, work => activity.whileActive(work));
  const writing = lease.execute('INSERT INTO edits VALUES (1)');
  await started.promise; expired = true; gate.resolve();
  await assert.rejects(writing, /expired/); await lease.drainWrites();
  assert.equal(rolledBack, true); assert.equal(db.prepare('SELECT count(*) AS count FROM edits').get()!.count, 0);
  await assert.rejects(lease.execute('INSERT INTO edits VALUES (2)'), /expired/);
  lease.assertActive(); db.close();
});
