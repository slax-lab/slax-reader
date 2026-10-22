import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {applyRssRealSyncNativeBridgeShim, prepareRssRealSyncFixture} from './prepare-rss-real-sync-fixture.mjs';

test('real RSS sync bridge shim is pinned to the production source and an isolated simulator identity', () => {
  const pathToSource = new URL('../../modules/slax-legacy/ios/SlaxLegacyModule.swift', import.meta.url);
  const source = readFileSync(pathToSource), text = source.toString('utf8'), output = applyRssRealSyncNativeBridgeShim(source).toString('utf8');
  assert.match(output, /Bundle\.main\.bundleIdentifier == "app\.slax\.reader\.uifixture\.rssacceptance"/);
  assert.match(output, /slax-real-sync-fixture-private/);
  assert.equal((output.match(/bundleIdentifier: "app\.slax\.reader\.uifixture\.rssacceptance"/g) ?? []).length, 3);
  assert.doesNotMatch(output, /containerURL\(forSecurityApplicationGroupIdentifier: "group\.app\.slax\.reader"\)/);
  assert.equal(readFileSync(pathToSource, 'utf8'), text, 'the task fixture transform must not alter the production module');
  assert.throws(() => applyRssRealSyncNativeBridgeShim(source.toString('utf8').replace('private let owner = StorageOwner()', 'private let owner = StorageOwner() // changed')), /source changed/);
});

test('real RSS sync fixture refuses an unmarked task path before copying sources', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'slax-reader-ui-fixture-'));
  try {
    const marker = path.join(root, '.slax-ui-fixture-project.json');
    writeFileSync(marker, JSON.stringify({kind: 'not-a-fixture'}));
    assert.throws(() => prepareRssRealSyncFixture(root), /prepared RSS acceptance project and isolated iOS identity/);
    assert.deepEqual(JSON.parse(readFileSync(marker, 'utf8')), {kind: 'not-a-fixture'});
  } finally {rmSync(root, {recursive: true, force: true});}
});

test('real RSS sync fixture refuses a generic or mismatched fixture app identity', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'slax-reader-ui-fixture-'));
  try {
    const canonical = realpathSync(root), marker = path.join(root, '.slax-ui-fixture-project.json');
    writeFileSync(marker, JSON.stringify({kind: 'slax-ui-fixture-project', version: 1, projectRoot: canonical,
      fixtureIdentity: '', iosId: 'app.slax.reader.uifixture', sourceMobileRoot: '/synthetic/mobile', scenario: 'rss-local-native-offline'}));
    assert.throws(() => prepareRssRealSyncFixture(root), /prepared RSS acceptance project and isolated iOS identity/);
    assert.equal(JSON.parse(readFileSync(marker, 'utf8')).fixtureIdentity, '');
  } finally {rmSync(root, {recursive: true, force: true});}
});
