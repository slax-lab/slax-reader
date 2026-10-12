import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixtureDocument} from '../../src/native/fixture-document.ts';

test('controlled document policy precedes resources without changing the document mode', () => {
  const original = '<!DOCTYPE html><html><head><script src="https://outside.test/script.js"></script></head><body>Fixture</body></html>';
  const result = fixtureDocument(original);
  assert.ok(result.startsWith('<!DOCTYPE html>'));
  assert.ok(result.indexOf('Content-Security-Policy') < result.indexOf('<script'));
  assert.match(result, /connect-src 'none'; frame-src 'none'/);
  assert.ok(result.endsWith('<body>Fixture</body></html>'));
});

test('missing fixture head preserves an existing doctype and body content', () => {
  for (const original of ['<!doctype html><html lang="en"><body>Fixture</body></html>', '<!doctype html><body>Fixture</body>']) {
    const result = fixtureDocument(original);
    assert.ok(result.startsWith('<!doctype html>'));
    assert.ok(result.indexOf('Content-Security-Policy') < result.indexOf('<body>'));
    assert.ok(result.includes('<body>Fixture</body>'));
  }
});
