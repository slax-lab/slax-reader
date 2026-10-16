import test from 'node:test';
import assert from 'node:assert/strict';
import {controlledNativeFixturePaths} from './native-fixture-paths.ts';

test('a preserved iOS fixture can move containers only within its same controlled simulator', () => {
  const prefix = '/Users/test/Library/Developer/CoreSimulator/Devices/32D9AFE0-32C7-443A-8FEC-3EBB42135386/data/Containers/Data/Application/';
  const oldRoot = `${prefix}E89DAAA5-06C8-4B8F-81E0-C8BBAF43944F/Library/Application Support`;
  const root = `${prefix}CBBE1A89-3A65-4599-9C8A-B2E95B19E3E2/Library/Application Support`;
  assert.deepEqual(controlledNativeFixturePaths('ios', root, `${oldRoot}/databases/powersync.db`), {databasePaths: [`${root}/databases/powersync.db`], cacheRoot: root, containerRelocated: true});
  assert.equal(controlledNativeFixturePaths('ios', root, `${root}/databases/powersync.db`).containerRelocated, false);
  for (const other of [oldRoot.replace('32D9AFE0', '12345678'), '/var/mobile/Containers/Data/Application/E89DAAA5-06C8-4B8F-81E0-C8BBAF43944F/Library/Application Support', `${oldRoot}/../Other`]) {
    assert.throws(() => controlledNativeFixturePaths('ios', root, `${other}/databases/powersync.db`), /controlled iOS simulator/);
  }
  assert.throws(() => controlledNativeFixturePaths('ios', '/var/mobile/Library/Application Support', `${oldRoot}/databases/powersync.db`), /controlled iOS simulator/);
});
test('Android fixture paths retain only the two known source sandbox aliases', () => {
  assert.equal(controlledNativeFixturePaths('android', '/data/user/0/com.slax.reader', '/data/data/com.slax.reader/databases/powersync.db').cacheRoot, '/data/data/com.slax.reader');
  assert.throws(() => controlledNativeFixturePaths('android', '/data/user/0/com.slax.reader', '/data/user/0/com.other/databases/powersync.db'), /Android fixture identity/);
});
