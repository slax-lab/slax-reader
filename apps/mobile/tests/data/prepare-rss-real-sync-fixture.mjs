import {createHash} from 'node:crypto';
import {lstatSync, readFileSync, realpathSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {verifyFixtureProject} from '../../tooling/fixture-project.mjs';

const MOBILE_ROOT = realpathSync(path.resolve(fileURLToPath(new URL('../..', import.meta.url))));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const NATIVE_BRIDGE = 'modules/slax-legacy/ios/SlaxLegacyModule.swift';
const NATIVE_BRIDGE_SHA256 = 'c43c5264cd5490e00a8b35fa8b6d1e5cd7bcc52ccfcf59075d621b1a7159573e';
const TASK_BUNDLE_ID = 'app.slax.reader.uifixture.rssacceptance';
const SOURCES = ['index.ts', 'src/components/RssFeed.tsx', 'src/data/installation.ts', 'src/data/adoption.ts', 'tests/data/RssRealSyncFixtureApp.tsx'];
function scopedFile(root, relative) {
  if (path.isAbsolute(relative) || relative.split('/').includes('..')) throw new Error('Real-sync fixture source path is invalid');
  const absolute = path.join(root, relative), canonical = realpathSync(absolute), stat = lstatSync(absolute);
  if (!canonical.startsWith(root + path.sep) || !stat.isFile() || stat.isSymbolicLink()) throw new Error('Real-sync fixture path escaped its task project');
  return absolute;
}

/** Restrict the copied legacy storage bridge to this simulator identity and its private app sandbox. */
export function applyRssRealSyncNativeBridgeShim(source) {
  const bytes = Buffer.isBuffer(source) ? source : Buffer.from(source);
  if (digest(bytes) !== NATIVE_BRIDGE_SHA256) throw new Error('Real-sync fixture native bridge source changed; review the fixture-only transform before use');
  let output = bytes.toString('utf8');
  const originalDirectory = [
    '  private func sharedDirectory() throws -> URL {',
    '    guard let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.app.slax.reader") else {',
    '      throw NSError(domain: "SlaxLegacy", code: 1, userInfo: [NSLocalizedDescriptionKey: "Shared application container is unavailable"])',
    '    }',
    '    return url',
    '  }',
    '',
  ].join('\n');
  const fixtureDirectory = [
    '  private func sharedDirectory() throws -> URL {',
    `    guard Bundle.main.bundleIdentifier == "${TASK_BUNDLE_ID}" else {`,
    '      throw CocoaError(.fileReadNoPermission)',
    '    }',
    '    let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)',
    '    let root = support.appendingPathComponent("slax-real-sync-fixture-private", isDirectory: true)',
    '    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)',
    '    return root',
    '  }',
    '',
  ].join('\n');
  if (!output.includes(originalDirectory) || output.split('guard Bundle.main.bundleIdentifier == "app.slax.reader"').length !== 2 || output.split('bundleIdentifier: "app.slax.reader"').length !== 4) throw new Error('Real-sync fixture native bridge no longer matches its reviewed identity and storage guards');
  output = output.replace(originalDirectory, fixtureDirectory)
    .replace('guard Bundle.main.bundleIdentifier == "app.slax.reader"', `guard Bundle.main.bundleIdentifier == "${TASK_BUNDLE_ID}"`)
    .replaceAll('bundleIdentifier: "app.slax.reader"', `bundleIdentifier: "${TASK_BUNDLE_ID}"`);
  return Buffer.from(output);
}

/** Copy the real PowerSync runtime entry into one explicitly marked isolated fixture project. */
export function prepareRssRealSyncFixture(projectPath) {
  const root = realpathSync(projectPath), temp = realpathSync(os.tmpdir());
  if (path.dirname(root) !== temp || !/^slax-reader-ui-fixture-[A-Za-z0-9]+$/.test(path.basename(root)) || lstatSync(projectPath).isSymbolicLink()) throw new Error('Real-sync fixture requires a generated direct child of the system temp directory');
  const markerPath = scopedFile(root, '.slax-ui-fixture-project.json'), marker = JSON.parse(readFileSync(markerPath, 'utf8'));
  if (marker.kind !== 'slax-ui-fixture-project' || marker.version !== 1 || marker.platform !== 'ios' || marker.projectRoot !== root || marker.fixtureIdentity !== 'rssacceptance' || marker.iosId !== TASK_BUNDLE_ID || marker.sourceMobileRoot !== MOBILE_ROOT || marker.scenario !== 'rss-local-native-offline') throw new Error('Real-sync fixture requires its prepared RSS acceptance project and isolated iOS identity');
  const markerHashes = new Map((marker.generatedSourceDigests ?? []).map(file => [file.path, file]));
  for (const filePath of ['ios/SlaxReader/AppDelegate.swift', 'ios/SlaxReader/Info.plist']) {
    const generated = markerHashes.get(filePath);
    if (generated && typeof generated.sha256 !== 'string') {
      const prepared = marker.preparedNativeChanges?.find(file => file.path === filePath && typeof file.sha256 === 'string');
      const actual = digest(readFileSync(scopedFile(root, filePath)));
      if (!prepared || prepared.sha256 !== actual) throw new Error('Real-sync fixture cannot repair an unproven Expo scene manifest entry');
      generated.sha256 = actual;
    }
  }
  marker.generatedSourceDigests = [...markerHashes.values()];
  writeFileSync(markerPath, JSON.stringify(marker, null, 2) + '\n');
  verifyFixtureProject(root);
  const preparedSourceChanges = [];
  for (const relative of SOURCES) {
    const source = scopedFile(MOBILE_ROOT, relative), bytes = readFileSync(source), target = path.join(root, relative);
    const parent = realpathSync(path.dirname(target));
    if (parent !== root && !parent.startsWith(root + path.sep)) throw new Error('Real-sync fixture output parent escaped its task project');
    try {if (lstatSync(target).isSymbolicLink() || !lstatSync(target).isFile()) throw new Error('Real-sync fixture output is not a regular file');}
    catch (error) {if (error?.code !== 'ENOENT') throw error;}
    writeFileSync(target, bytes);
    preparedSourceChanges.push({path: relative, sourceSha256: digest(bytes), generatedSha256: digest(readFileSync(target))});
  }
  const nativeSource = readFileSync(scopedFile(MOBILE_ROOT, NATIVE_BRIDGE));
  const sourceSha256 = digest(nativeSource);
  if (sourceSha256 !== NATIVE_BRIDGE_SHA256) throw new Error('Real-sync fixture native bridge source digest is not the reviewed version');
  const nativeTarget = scopedFile(root, NATIVE_BRIDGE), currentNative = readFileSync(nativeTarget), currentNativeSha256 = digest(currentNative);
  const priorNative = marker.preparedNativeChanges?.find(file => file.path === NATIVE_BRIDGE);
  let preparedNative = currentNative;
  if (currentNativeSha256 === sourceSha256) preparedNative = applyRssRealSyncNativeBridgeShim(currentNative);
  else if (!(priorNative?.sourceSha256 === sourceSha256 && priorNative.generatedSha256 === currentNativeSha256 && currentNative.toString('utf8').includes('slax-real-sync-fixture-private'))) throw new Error('Real-sync fixture native bridge output changed outside its guarded preparer');
  writeFileSync(nativeTarget, preparedNative);
  const hashes = new Map((marker.generatedSourceDigests ?? []).map(file => [file.path, file]));
  const preservedNativeChanges = (marker.preparedNativeChanges ?? []).filter(file => file.path !== NATIVE_BRIDGE);
  for (const filePath of ['ios/SlaxReader/AppDelegate.swift', 'ios/SlaxReader/Info.plist']) {
    if (!preservedNativeChanges.some(file => file.path === filePath)) {
      const sceneFile = readFileSync(scopedFile(root, filePath));
      const sceneText = sceneFile.toString('utf8');
      if (filePath.endsWith('AppDelegate.swift') ? !sceneText.includes('ExpoReactNativeFactoryProvider') : !sceneText.includes('EXExpoAppSceneDelegate')) throw new Error('Real-sync fixture requires its guarded Expo scene lifecycle preparation');
      preservedNativeChanges.push({path: filePath, sha256: digest(sceneFile)});
    }
  }
  const preparedNativeChanges = [...preservedNativeChanges, {path: NATIVE_BRIDGE, sourceSha256, generatedSha256: digest(preparedNative)}];
  for (const file of preparedSourceChanges) hashes.set(file.path, {path: file.path, sha256: file.generatedSha256});
  for (const file of preparedNativeChanges) hashes.set(file.path, {path: file.path, sha256: file.generatedSha256 ?? file.sha256});
  marker.generatedSourceDigests = [...hashes.values()].sort((left, right) => left.path.localeCompare(right.path));
  marker.preparedSourceChanges = preparedSourceChanges;
  marker.preparedNativeChanges = preparedNativeChanges;
  writeFileSync(markerPath, JSON.stringify(marker, null, 2) + '\n');
  const verification = verifyFixtureProject(root);
  return {project: root, identity: marker.fixtureIdentity, preparedSourceChanges, preparedNativeChanges, verification: verification.kind, fakeRowsSeededByApp: false, runtime: 'createMobileDataRuntime and the production PowerSync connector'};
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {console.log(JSON.stringify(prepareRssRealSyncFixture(process.argv[2]), null, 2));}
  catch (error) {console.error(error instanceof Error ? error.message : 'Unable to prepare real RSS sync fixture'); process.exitCode = 1;}
}
