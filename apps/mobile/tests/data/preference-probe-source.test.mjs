import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {extractPreferenceBodies} from './adoption-fixtures/tooling/preference-probe-source.mjs';

test('native CAS probes preserve the literal production lock/read/CAS bodies and bind changes to their hashes', () => {
  for (const [platform, file] of [['android', '../../modules/slax-legacy/android/src/main/java/com/slax/reader/legacy/SlaxLegacyModule.kt'], ['ios', '../../modules/slax-legacy/ios/SlaxLegacyModule.swift']]) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8'), extracted = extractPreferenceBodies(source, platform);
    assert(source.includes(extracted.lockingAndSnapshot)); assert(source.includes(extracted.compareAndSwap));
    const changed = source.replace('revision + 1', 'revision + 2');
    assert.notEqual(extracted.hashes.compareAndSwap, extractPreferenceBodies(changed, platform).hashes.compareAndSwap);
    assert.throws(() => extractPreferenceBodies(source.replace(platform === 'android' ? 'file.channel.lock()' : 'flock(descriptor, LOCK_EX | LOCK_NB)', 'removed-lock'), platform));
    assert.throws(() => extractPreferenceBodies(source.replace('AsyncFunction("compareAndSwapPreferences")', 'AsyncFunction("changedCallback")'), platform));
  }
});
