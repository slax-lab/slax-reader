import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFixtureCommand} from '../../fixtures/commands.ts';

const cases = {'library-populated': {}, 'login': {}};
test('fixture commands only select pinned cases and state preparation', () => {
  assert.deepEqual(parseFixtureCommand('slaxreader-ui-fixture://control?case=login&locale=zh', cases), {kind: 'case', scenario: 'login', locale: 'zh'});
  assert.deepEqual(parseFixtureCommand('slaxreader-ui-fixture://control?index=3', cases), {kind: 'action', action: 3});
  assert.equal(parseFixtureCommand('slaxreader://control?case=login', cases), null);
  assert.equal(parseFixtureCommand('https://example.com/control?case=login', cases), null);
  assert.equal(parseFixtureCommand('slaxreader-ui-fixture://expo-development-client/?url=http://127.0.0.1:8083', cases), null);
  for (const query of ['case=missing', 'case=login&locale=fr', 'case=login&path=/real/data', 'case=login&index=1', 'index=-1', 'index=1&locale=zh', 'action=%5B%5D', 'action=%7B%22kind%22%3A%22eval(js)%22%7D']) {
    assert.throws(() => parseFixtureCommand('slaxreader-ui-fixture://control?' + query, cases));
  }
});
