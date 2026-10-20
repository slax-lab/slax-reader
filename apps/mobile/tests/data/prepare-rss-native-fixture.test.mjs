import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {applyRssNativeSceneShim, prepareRssNativeFixture} from './prepare-rss-native-fixture.mjs';

function project() {
  const root = mkdtempSync(path.join(tmpdir(), 'slax-reader-ui-fixture-'));
  const canonical = realpathSync(root);
  mkdirSync(path.join(root, 'fixtures'));
  writeFileSync(path.join(root, '.slax-ui-fixture-project.json'), JSON.stringify({kind: 'slax-ui-fixture-project', version: 1, projectRoot: canonical, fixtureIdentity: 'rssacceptance', iosId: 'app.slax.reader.uifixture.rssacceptance', sourceFileDigests: [{path: 'fixtures/scenarios.json', sha256: 'source-scenario'}, {path: 'fixtures/manifest.json', sha256: 'source-manifest'}], generatedSourceDigests: [{path: 'fixtures/scenarios.json', sha256: 'generated-scenario'}, {path: 'fixtures/manifest.json', sha256: 'generated-manifest'}]}));
  const bookmark = {id: 'bookmark', user_id: 'user', metadata: JSON.stringify({bookmark: {uuid: 'bookmark', target_url: 'https://old.test'}})};
  writeFileSync(path.join(root, 'fixtures/scenarios.json'), JSON.stringify({scenarios: { 'rss-populated': {actions: [], payload: {session: {userId: 'user'}, database: {sr_user_bookmark: [bookmark]}, api: []}}}}));
  writeFileSync(path.join(root, 'fixtures/manifest.json'), JSON.stringify({files: [{path: 'scenarios.json', sha256: 'old'}]}));
  mkdirSync(path.join(root, 'ios/SlaxReader'), {recursive: true});
  writeFileSync(path.join(root, 'ios/SlaxReader/AppDelegate.swift'), `import Expo\nclass AppDelegate: ExpoAppDelegate {\n  var window: UIWindow?\n  var reactNativeFactory: RCTReactNativeFactory?\n#if os(iOS) || os(tvOS)\n    window = UIWindow(frame: UIScreen.main.bounds)\n    factory.startReactNative(\n      withModuleName: "main",\n      in: window,\n      launchOptions: launchOptions)\n#endif\n}`);
  writeFileSync(path.join(root, 'ios/SlaxReader/Info.plist'), '<?xml version="1.0"?><plist version="1.0"><dict>\n</dict>\n</plist>');
  return root;
}

test('RSS native fixture preparation seeds offline two-source PowerSync rows and updates its input digest', () => {
  const root = project();
  try {
    const report = prepareRssNativeFixture(root);
    const scenarios = JSON.parse(readFileSync(path.join(root, 'fixtures/scenarios.json'), 'utf8'));
    const payload = scenarios.scenarios['rss-local-native-offline'].payload;
    const manifest = JSON.parse(readFileSync(path.join(root, 'fixtures/manifest.json'), 'utf8'));
    const marker = JSON.parse(readFileSync(path.join(root, '.slax-ui-fixture-project.json'), 'utf8'));
    const sha = file => createHash('sha256').update(readFileSync(path.join(root, file))).digest('hex');
    assert.deepEqual(report.seeded, {subscriptions: 2, feeds: 2, entries: 3, savedBookmarks: 1});
    assert.equal(report.scenarioSha256, manifest.files[0].sha256);
    assert.deepEqual(marker.sourceFileDigests, [{path: 'fixtures/scenarios.json', sha256: 'source-scenario'}, {path: 'fixtures/manifest.json', sha256: 'source-manifest'}], 'source digests retain source provenance');
    assert.equal(marker.generatedSourceDigests.find(file => file.path === 'fixtures/scenarios.json').sha256, sha('fixtures/scenarios.json'));
    assert.equal(marker.generatedSourceDigests.find(file => file.path === 'fixtures/manifest.json').sha256, sha('fixtures/manifest.json'));
    assert.equal(payload.network.isConnected, false);
    assert.equal(payload.sync.hasSynced, false);
    assert.deepEqual(payload.database.sr_rss_subscription.map(row => row.id), ['rss-alpha', 'rss-beta']);
    assert.deepEqual(payload.database.sr_rss_entry.map(row => row.feed_id), ['rss-feed-alpha', 'rss-feed-alpha', 'rss-feed-beta']);
    assert.equal(JSON.parse(payload.database.sr_user_bookmark.at(-1).metadata).bookmark.target_url, 'https://fixture-pages.test/rss-alpha-saved');
  } finally {rmSync(root, {recursive: true, force: true});}
});

test('RSS native fixture preparation refuses the generic shared fixture identity', () => {
  const root = project();
  try {
    const marker = JSON.parse(readFileSync(path.join(root, '.slax-ui-fixture-project.json'), 'utf8'));
    marker.fixtureIdentity = ''; marker.iosId = 'app.slax.reader.uifixture';
    writeFileSync(path.join(root, '.slax-ui-fixture-project.json'), JSON.stringify(marker));
    assert.throws(() => prepareRssNativeFixture(root), /task-specific isolated fixture identity/);
  } finally {rmSync(root, {recursive: true, force: true});}
});

test('RSS native scene shim is guarded, fixture-only, and idempotently records its generated changes', () => {
  const root = project();
  try {
    const result = applyRssNativeSceneShim(root);
    const appDelegate = readFileSync(path.join(root, 'ios/SlaxReader/AppDelegate.swift'), 'utf8');
    const info = readFileSync(path.join(root, 'ios/SlaxReader/Info.plist'), 'utf8');
    const marker = JSON.parse(readFileSync(path.join(root, '.slax-ui-fixture-project.json'), 'utf8'));
    assert.match(appDelegate, /class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider/);
    assert.doesNotMatch(appDelegate, /factory\.startReactNative\(/);
    assert.match(info, /<string>EXExpoAppSceneDelegate<\/string>/);
    assert.equal(marker.preparedNativeChanges.length, 2);
    assert.deepEqual(result.preparedNativeChanges, marker.preparedNativeChanges);
    assert.doesNotThrow(() => applyRssNativeSceneShim(root), 'an already prepared fixture remains verifiable');
  } finally {rmSync(root, {recursive: true, force: true});}
});
