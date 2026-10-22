import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

test('local-first search controller and repository behavior', () => {
  const cases = fileURLToPath(new URL('./search.cases.mjs', import.meta.url));
  const result = spawnSync(process.execPath, ['--experimental-transform-types', '--experimental-strip-types', '--test', cases], {encoding: 'utf8'});
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
