import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const controller = fileURLToPath(new URL('./adoption-fixtures/tooling/visible-upgrade-control.mjs', import.meta.url));
const retained = JSON.parse(readFileSync(new URL('./adoption-fixtures/reports/ios-source-valid-original-queue-real-service.json', import.meta.url), 'utf8'));
const observed = JSON.parse(readFileSync(new URL('./adoption-fixtures/reports/ios-source-valid-passive-input-visible-ui.json', import.meta.url), 'utf8'));
const hash = value => createHash('md5').update(value).digest('hex');

test('actual Android controller preserves native marker bytes through request and immutable offline cleanup', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'slax-native-visible-upgrade-android-'));
  const device = 'emulator-5598', runId = 'controlled-host-android-raw-transport';
  const markers = path.join(root, 'mock-markers'), bin = path.join(root, 'bin'); mkdirSync(markers); mkdirSync(bin);
  writeFileSync(path.join(root, 'fixture-owner.json'), JSON.stringify({kind: 'slax-controlled-native-visible-upgrade-android', version: 1, device, runId}));
  const adb = `#!${process.execPath}\nconst fs=require('node:fs'),path=require('node:path');
const args=process.argv.slice(2); if(args.shift()!=='-s'||args.shift()!==${JSON.stringify(device)}) process.exit(10);
const prefix=['shell','run-as','com.slax.reader'], dir=${JSON.stringify(markers)};
const target=name=>{if(!/^[a-z-]+\\.json$/.test(name))process.exit(11);return path.join(dir,name);};
if(args.slice(0,3).join('|')===prefix.join('|')){
 const command=args[3], name=(args.at(-1)||'').replace(/^files\\//,'');
 if(command==='readlink'&&args[4]==='-f'){process.stdout.write('/data/user/0/com.slax.reader/files/'+name+'\\n');}
 else if(command==='cat'){process.stdout.write(fs.readFileSync(target(name)));}
 else if(command==='rm'){fs.unlinkSync(target(name));}
 else process.exit(12);
}else if(args[0]==='shell'&&args.length===2){
 const text=args[1], match=text.match(/files\\/([a-z-]+\\.json)/); if(!match)process.exit(13);
 if(text.includes('test -f'))process.stdout.write(fs.existsSync(target(match[1]))?'present\\n':'absent\\n');
 else if(text.includes('cat >'))fs.writeFileSync(target(match[1]),fs.readFileSync(0),{flag:text.includes('set -C')?'wx':'w'});
 else process.exit(14);
}else process.exit(15);\n`;
  writeFileSync(path.join(bin, 'adb'), adb, {mode: 0o755});
  const write = (name, value) => writeFileSync(path.join(markers, name), JSON.stringify(value, null, 2) + '\n');
  const run = action => spawnSync(process.execPath, [controller, '--platform', 'android', '--device', device, '--owner-directory', root, '--phase', 'pre-reconnect', action],
    {env: {...process.env, PATH: bin + path.delimiter + process.env.PATH}, encoding: 'utf8', timeout: 10000});
  try {
    const source = {...retained.originalNativeProducer, androidBundleId: 'com.slax.reader'}; write('legacy-fixture-report.json', source);
    const generated = run('--request'); assert.equal(generated.status, 0, generated.stderr);
    const raw = readFileSync(path.join(markers, 'native-upgrade-ui-request.json'), 'utf8'); assert.ok(raw.endsWith('\n'));
    const request = JSON.parse(raw), visibilityRequestMd5 = hash(raw);
    const before = {...retained.openingHold.baseline, databasePath: '/data/user/0/com.slax.reader/databases/powersync.db'};
    const localJson = JSON.stringify({...JSON.parse(source.localJson), read_position: '351'}), after = {...before, localDigest: '1'.repeat(64)};
    const common = {platform: 'android', device, runId, nonce: request.nonce, requestedAt: request.requestedAt,
      visibleInputsSHA256: request.visibleInputsSHA256, visibilityRequestMd5, actualNativeResourceOwner: 'controlled-host-native-owner'};
    const offline = {...request, ...common, kind: 'slax-controlled-pre-reconnect-visible-startup', status: 'passed', capturedAt: request.requestedAt + 1,
      normalCreateMobileDataRuntimeExecuted: true, explicitAdoptionEvidenceProvided: false, networkRequestsForwarded: 0,
      nativeDatabaseIdentity: {owner: 'android:com.slax.reader:/data/user/0/com.slax.reader/files', relativePath: 'databases/powersync.db'},
      before: structuredClone(before), afterSchema: structuredClone(before), afterAccountStart: structuredClone(before), pending: source.transactions,
      originalLocalRows: [{id: 'bookmark-1', data: source.localJson}], actualSdkVersion: '2.3.1', actualCoreVersion: '0.5.3/2ba6b280',
      originalCacheRetained: true, originalLocalJsonRetained: true, originalPreferencesUntouched: true, originalBookmarkTagCommentAvailableInNormalRepositories: true,
      originalDataStoreFingerprint: observed.actualContext.originalDataStoreFingerprint, sourceCachedArticleMd5: observed.actualContext.sourceCachedArticleMd5};
    const events = observed.actualReaderObservations.events.map((event, index) => ({...event, observedAt: request.requestedAt + 2 + index}));
    const context = {...common, kind: 'slax-controlled-visible-upgrade-context', version: 1, phase: 'pre-reconnect', capturedAt: request.requestedAt + events.length + 3,
      realProductionRoutesMounted: true, simulatedUiRowsOrHtml: false, fixtureOnlyProviderUsed: false, explicitAdoptionEvidenceProvided: false, normalRuntimeReady: true,
      networkRequestsForwarded: 0, originalPendingQueueAndDataUnchanged: true, currentPending: source.transactions, currentInspection: after,
      currentLocalJson: JSON.parse(localJson), currentLocalRows: [{id: 'bookmark-1', data: localJson}], observedRoute: {name: 'Library'}, canGoBack: false,
      originalDataStoreFingerprint: offline.originalDataStoreFingerprint, sourceCachedArticleMd5: offline.sourceCachedArticleMd5};
    write('native-upgrade-offline-report.json', offline); write('native-upgrade-ui-context.json', context);
    write('native-upgrade-reader-lifecycle.json', {...common, kind: 'slax-controlled-visible-upgrade-reader-observations', version: 1, observationsOnly: true, events});
    const cleaned = run('--cleanup'); assert.equal(cleaned.status, 0, cleaned.stderr);
    const receipt = JSON.parse(readFileSync(path.join(markers, 'native-upgrade-offline-finished.json'), 'utf8'));
    assert.equal(receipt.visibilityRequestRaw, raw); assert.equal(receipt.visibilityRequestMd5, visibilityRequestMd5);
    for (const value of [receipt.offline, receipt.context, receipt.observations]) assert.equal(value.visibilityRequestMd5, visibilityRequestMd5);
    assert.equal(existsSync(path.join(markers, 'native-upgrade-ui-request.json')), false);
    assert.deepEqual(receipt.context.currentPending, source.transactions);
  } finally {rmSync(root, {recursive: true, force: true});}
});
