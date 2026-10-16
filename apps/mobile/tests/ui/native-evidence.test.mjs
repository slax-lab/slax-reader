import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, readFile, writeFile, rm, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {nativePngDimensions, verifyCoverageEvidence} from '../../assets/native-evidence.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceHash = 'a'.repeat(64), fixtureHash = 'b'.repeat(64);
async function protocolFixture(t, {capturedFixtureHash = fixtureHash, currentFixtureBytes} = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'slax-evidence-protocol-')); t.after(() => rm(root, {recursive: true, force: true}));
  // This public artwork is a protocol-test raster, never a real native capture in the project ledger.
  const png = await readFile(new URL('../../assets/drawable/global-default-avatar.png', import.meta.url));
  const dimensions = nativePngDimensions(png);
  const item = {id: 'library.populated', requiredPlatforms: ['android'], requiredLocales: ['en'], targetFiles: [], evidence: [],
    implementation: 'unverified', sourceRender: 'unverified', targetRender: 'unverified', functionalVerification: 'unverified', visualComparison: 'unverified'};
  const coverage = {cases: [item], comparisonSettings: {appearances: ['light'], fontScales: ['default']}, allowedVisualExclusions: [{id: 'native-back'}]};
  async function save(name, bytes) {const relative = `docs/mobile/evidence/protocol/${name}`; const filename = path.join(root, relative); await mkdir(path.dirname(filename), {recursive: true}); await writeFile(filename, bytes); return {path: relative, sha256: hash(bytes)};}
  async function saveJson(name, value) {return save(name, Buffer.from(JSON.stringify(value)));}
  async function capture(implementation = 'target', extra = {}) {
    const image = await save(`${implementation}.png`, png);
    let actionDriverInputs, actionDriverSha256, sourceBuild;
    if (implementation === 'source') {
      const overlay = Buffer.from('public protocol test only');
      const driverFolder = 'source-driver';
      const entry = {path: 'Driver.kt', sha256: hash(overlay)};
      await save(`${driverFolder}/${entry.path}`, overlay);
      const entries = [entry];
      const archivedManifest = coverage.historicalFixtureInputs?.[0]?.manifest;
      if (archivedManifest) {
        const manifestPath = 'composeApp/src/androidInstrumentedTest/assets/slax-ui-fixtures/manifest.json';
        await save(`${driverFolder}/${manifestPath}`, await readFile(path.join(root, archivedManifest.path)));
        entries.push({path: manifestPath, sha256: archivedManifest.sha256});
      }
      actionDriverSha256 = hash(Buffer.from(JSON.stringify(entries)));
      const captureInputPath = 'composeApp/src/androidInstrumentedTest/assets/slax-ui-fixtures/source-capture-inputs.json';
      const inputs = await saveJson(`${driverFolder}/${captureInputPath}`, {actionDriverSha256});
      actionDriverInputs = await saveJson(`${driverFolder}/input-manifest.json`, {controlledFixture: true, fixtureInputSha256: capturedFixtureHash,
        sourceManifestSha256: sourceHash, sourceCheckoutModified: false, originalBuildConfigurationCopied: false,
        overlayDigests: [...entries, {path: captureInputPath, sha256: inputs.sha256}]});
      sourceBuild = await saveJson('source-build.json', {kind: 'sanitized-source-android-build', result: 'passed', actionDriverSha256,
        fixtureInputSha256: capturedFixtureHash, sourceManifestSha256: sourceHash, originalSourceModified: false, inputManifest: actionDriverInputs});
    } else {
      actionDriverInputs = await saveJson('target-driver.json', {kind: 'slax-ui-fixture-project',
        generatedSourceDigests: [{path: 'fixtures/scenarios.json', sha256: capturedFixtureHash}, ...(coverage.historicalFixtureInputs?.[0]?.manifest ? [{path: 'fixtures/manifest.json', sha256: coverage.historicalFixtureInputs[0].manifest.sha256}] : [])]});
      actionDriverSha256 = actionDriverInputs.sha256;
    }
    const raw = {controlledFixture: true, scenario: 'library-populated', locale: 'en', inputSha256: capturedFixtureHash, actionDriverSha256,
      nativeMeasurements: {platform: 'android', deviceModel: 'Protocol device', osVersion: 'Protocol OS', appearance: 'light', fontScaleProfile: 'default', fontScale: 1,
        widthPixels: dimensions.width, heightPixels: dimensions.height, pixelRatio: 1, safeArea: {top: 0, bottom: 0, left: 0, right: 0}}};
    const rawMetadata = await saveJson(`${implementation}-raw.json`, raw);
    const value = {schemaVersion: 1, kind: 'native-ui-capture', caseId: item.id, implementation, platform: 'android', locale: 'en',
      sourceManifestSha256: sourceHash, fixtureInputSha256: capturedFixtureHash, fixtureScenario: 'library-populated', captureMethod: 'adb-screencap',
      stateAssertion: 'Protocol test only: prepared populated case.', actionDriverSha256, actionDriverInputs, sourceBuild, rawMetadata,
      capturedAtMillis: 1, clockVerification: 'Protocol test only.', nativeInteractionVerified: false,
      conditions: {deviceModel: 'Protocol device', osVersion: 'Protocol OS', clock: '09:41', appearance: 'light', fontScaleProfile: 'default', fontScale: 1,
        widthPixels: dimensions.width, heightPixels: dimensions.height, pixelRatio: 1, safeArea: {top: 0, bottom: 0, left: 0, right: 0}}, image, ...extra};
    const reference = await saveJson(`${implementation}.json`, value); item.evidence.push(reference); return {value, reference, raw};
  }
  const verify = () => verifyCoverageEvidence({coverage, repoRoot: root, sourceManifestSha256: sourceHash, fixtureInputSha256: currentFixtureBytes ? hash(currentFixtureBytes) : fixtureHash, scenarios: ['library-populated'], fixtureBundleBytes: currentFixtureBytes});
  return {root, item, coverage, save, saveJson, capture, verify, png};
}
test('partial native evidence can be recorded without claiming full acceptance', async t => {
  const f = await protocolFixture(t); await f.capture(); assert.equal((await f.verify()).captureCount, 1);
  f.item.targetRender = 'verified'; assert.equal((await f.verify()).nativeParity, 'unverified');
  f.coverage.comparisonSettings.appearances.push('dark'); await assert.rejects(f.verify(), /Incomplete native evidence matrix/);
});
test('missing, tampered, or mismatched capture files cannot advance rendering', async t => {
  const f = await protocolFixture(t); const {value} = await f.capture(); f.item.targetRender = 'verified';
  await writeFile(path.join(f.root, value.image.path), Buffer.from('tampered'));
  await assert.rejects(f.verify(), /hash mismatch/);
  await rm(path.join(f.root, value.image.path)); await assert.rejects(f.verify(), /ENOENT/);
});
test('prepared/browser state, old source/fixture hashes and false native-input claims are rejected', async t => {
  for (const extra of [{captureMethod: 'browser-screenshot'}, {sourceManifestSha256: 'd'.repeat(64)}, {fixtureInputSha256: 'd'.repeat(64)}, {checks: {functionalVerification: 'passed'}}]) {
    const f = await protocolFixture(t); await f.capture('target', extra); await assert.rejects(f.verify());
  }
  const f = await protocolFixture(t); await f.capture('target', {nativeInteractionVerified: true}); await assert.rejects(f.verify(), /relative path and SHA/);
});
test('visual acceptance needs two native states with matched measured conditions and an inspected decision', async t => {
  const f = await protocolFixture(t); const source = await f.capture('source'), target = await f.capture('target');
  const comparison = {schemaVersion: 1, kind: 'native-ui-comparison', caseId: f.item.id, platform: 'android', locale: 'en', sourceManifestSha256: sourceHash,
    fixtureInputSha256: fixtureHash, sourceCapture: source.reference, targetCapture: target.reference, result: 'passed', reviewedBy: 'agent', rationale: 'Protocol validation test only.', exclusions: []};
  f.item.evidence.push(await f.saveJson('comparison.json', comparison)); f.item.sourceRender = 'verified'; f.item.targetRender = 'verified'; f.item.visualComparison = 'verified';
  assert.equal((await f.verify()).nativeParity, 'verified');
  target.value.conditions.fontScale = 1.3; target.value.conditions.fontScaleProfile = 'accessibility-enlarged';
  target.raw.nativeMeasurements.fontScale = 1.3; target.raw.nativeMeasurements.fontScaleProfile = 'accessibility-enlarged';
  target.value.rawMetadata = await f.saveJson('target-raw.json', target.raw);
  const replacement = await f.saveJson('target.json', target.value); f.item.evidence[1] = replacement; comparison.targetCapture = replacement;
  f.item.evidence[2] = await f.saveJson('comparison.json', comparison); f.coverage.comparisonSettings.fontScales.push('accessibility-enlarged');
  await assert.rejects(f.verify(), /conditions must match/);
});
test('compiled driver inputs and raw native measurements remain mandatory and hash-checked', async t => {
  const missing = await protocolFixture(t); await missing.capture('target', {rawMetadata: undefined}); await assert.rejects(missing.verify(), /relative path and SHA/);
  const tampered = await protocolFixture(t); const source = await tampered.capture('source');
  await writeFile(path.join(tampered.root, path.dirname(source.value.actionDriverInputs.path), 'Driver.kt'), 'changed');
  await assert.rejects(tampered.verify(), /hash mismatch/);
  const measured = await protocolFixture(t); const target = await measured.capture();
  target.raw.nativeMeasurements.safeArea.top = 20;
  target.value.rawMetadata = await measured.saveJson('target-raw.json', target.raw);
  measured.item.evidence[0] = await measured.saveJson('target.json', target.value);
  await assert.rejects(measured.verify(), /safe area differs/);
});
test('unsafe paths, symlinks, corrupt PNGs and cross-state reuse cannot become evidence', async t => {
  const f = await protocolFixture(t); const {value} = await f.capture();
  f.item.evidence = [{path: 'docs/mobile/evidence/../.env', sha256: sourceHash}]; await assert.rejects(f.verify(), /Unsafe/);
  f.item.evidence = []; const foreign = await f.capture('target', {caseId: 'reader.mixed'}); await assert.rejects(f.verify(), /coverage state/);
  f.item.evidence = []; await f.capture(); await rm(path.join(f.root, value.image.path));
  await symlink(new URL('../../assets/drawable/global-default-avatar.png', import.meta.url).pathname, path.join(f.root, value.image.path));
  await assert.rejects(f.verify(), /symlinks/);
  const corrupt = Buffer.from(f.png); corrupt[corrupt.length - 1] ^= 1; assert.throws(() => nativePngDimensions(corrupt), /Corrupt/);
});

const historicalBundle = () => ({schemaVersion: 1, synthetic: true, apiOrigin: 'https://fixture-api.test', webOrigin: 'https://fixture-pages.test',
  ids: {user: 'synthetic-user'}, artwork: {'https://fixture-images.test/one.png': {asset: '../assets/drawable/ic_app_logo.png'}}, documents: {'/notice': 'articles/notice.html'}, clock: 'fixed',
  scenarios: {'library-populated': {route: {name: 'Library'}, payload: {rows: ['fixed']}, actions: []}, 'reader-load-error': {response: {data: {error: 'source_unavailable'}}}}});
const encoded = value => Buffer.from(JSON.stringify(value));
async function historicalProtocol(t, change) {
  const old = historicalBundle(), current = structuredClone(old); change(current);
  const f = await protocolFixture(t, {capturedFixtureHash: hash(encoded(old)), currentFixtureBytes: encoded(current)});
  const archived = await f.save('archived-scenarios.json', encoded(old));
  // The real native harness uses scenarios.json alongside its pinned dependencies.
  archived.path = (await f.save('scenarios.json', encoded(old))).path;
  const dependencies = {'documents.ts': 'export const fixtureDocuments = {};', 'resources.ts': 'export const fixtureArtworkBase64 = ' + JSON.stringify(f.png.toString('base64')) + ';', 'articles/notice.html': '<html><body>fixed notice</body></html>'};
  const files = [{path: 'scenarios.json', sha256: hash(encoded(old))}];
  const fixtureRoot = path.join(f.root, 'apps/mobile/fixtures'); await mkdir(fixtureRoot, {recursive: true});
  for (const [name, contents] of Object.entries(dependencies)) {
    await f.save(name, Buffer.from(contents)); files.push({path: name, sha256: hash(Buffer.from(contents))});
    await mkdir(path.dirname(path.join(fixtureRoot, name)), {recursive: true}); await writeFile(path.join(fixtureRoot, name), contents);
  }
  const oldManifest = {synthetic: true, files};
  archived.manifest = await f.saveJson('manifest.json', oldManifest);
  await writeFile(path.join(fixtureRoot, 'manifest.json'), encoded({synthetic: true, files: files.map(entry => entry.path === 'scenarios.json' ? {...entry, sha256: hash(encoded(current))} : entry)}));
  const asset = path.join(f.root, 'apps/mobile/assets/drawable/ic_app_logo.png'); await mkdir(path.dirname(asset), {recursive: true}); await writeFile(asset, f.png);
  f.coverage.historicalFixtureInputs = [archived];
  return {...f, old, current};
}
test('an unchanged declared native state can retain exact archived fixture provenance after another case changes', async t => {
  const f = await historicalProtocol(t, value => {value.scenarios['reader-load-error'].response.data = 'source_unavailable';});
  const capture = await f.capture();
  const result = await f.verify(); assert.equal(result.captureCount, 1); assert.equal(result.nativeParity, 'unverified');
  assert.equal(capture.value.fixtureInputSha256, hash(encoded(f.old)), 'Historical native capture is never relabeled with the new global hash');
});
test('changed declared scenarios or global origins/documents/artwork/configuration require fresh native evidence', async t => {
  for (const change of [
    value => {value.scenarios['library-populated'].payload.rows.push('changed');},
    value => {value.scenarios['library-populated'].actions.push({kind: 'press'});},
    value => {value.apiOrigin = 'https://other.test';},
    value => {value.webOrigin = 'https://other.test';},
    value => {value.documents['/notice'] = 'articles/other.html';},
    value => {value.artwork['https://fixture-images.test/one.png'].asset = 'other.png';},
    value => {value.ids.user = 'different';},
    value => {value.clock = 'different';},
  ]) {
    const f = await historicalProtocol(t, change); await f.capture(); await assert.rejects(f.verify(), /Historical fixture .* changed/);
  }
});
test('historical fixture bytes must be present, hash checked and cannot follow symlinks', async t => {
  for (const invalidation of ['missing-reference', 'tampered-bytes', 'symlink']) {
    const f = await historicalProtocol(t, value => {value.scenarios['reader-load-error'].response.data = 'source_unavailable';}); await f.capture();
    const archive = path.join(f.root, f.coverage.historicalFixtureInputs[0].path);
    if (invalidation === 'missing-reference') f.coverage.historicalFixtureInputs = [];
    if (invalidation === 'tampered-bytes') await writeFile(archive, encoded(f.current));
    if (invalidation === 'symlink') {const bytes = await readFile(archive); await rm(archive); await writeFile(archive + '.original', bytes); await symlink(archive + '.original', archive);}
    await assert.rejects(f.verify(), /archived provenance|hash mismatch|symlinks/);
  }
});
test('historical provenance retains independent raw metadata and compiled-driver fixture identity checks', async t => {
  const f = await historicalProtocol(t, value => {value.scenarios['reader-load-error'].response.data = 'source_unavailable';});
  const target = await f.capture(); target.raw.inputSha256 = hash(encoded(f.current));
  target.value.rawMetadata = await f.saveJson('target-raw.json', target.raw); f.item.evidence[0] = await f.saveJson('target.json', target.value);
  await assert.rejects(f.verify(), /strictly equal/);
});

test('historical source and target captures retain an inspected comparison under their original bundle identity', async t => {
  const f = await historicalProtocol(t, value => {value.scenarios['reader-load-error'].response.data = 'source_unavailable';});
  const source = await f.capture('source'), target = await f.capture('target');
  const comparison = {schemaVersion: 1, kind: 'native-ui-comparison', caseId: f.item.id, platform: 'android', locale: 'en', sourceManifestSha256: sourceHash,
    fixtureInputSha256: hash(encoded(f.old)), sourceCapture: source.reference, targetCapture: target.reference, result: 'failed', reviewedBy: 'agent',
    rationale: 'Protocol test only: preserve a historical failed comparison without current acceptance.', exclusions: []};
  f.item.evidence.push(await f.saveJson('historical-comparison.json', comparison)); f.item.visualComparison = 'failed';
  const result = await f.verify(); assert.equal(result.captureCount, 2); assert.equal(result.comparisonCount, 1); assert.equal(result.nativeParity, 'unverified');
  comparison.fixtureInputSha256 = hash(encoded(f.current)); f.item.evidence[2] = await f.saveJson('historical-comparison.json', comparison);
  await assert.rejects(f.verify(), /Comparison fixture identity differs/);
});
test('a replaced historical compiled target fixture identity cannot bypass the archived raw identity', async t => {
  const f = await historicalProtocol(t, value => {value.scenarios['reader-load-error'].response.data = 'source_unavailable';});
  const target = await f.capture();
  target.value.actionDriverInputs = await f.saveJson('target-driver.json', {kind: 'slax-ui-fixture-project', generatedSourceDigests: [{path: 'fixtures/scenarios.json', sha256: hash(encoded(f.current))}, {path: 'fixtures/manifest.json', sha256: f.coverage.historicalFixtureInputs[0].manifest.sha256}]});
  target.value.actionDriverSha256 = target.value.actionDriverInputs.sha256; f.item.evidence[0] = await f.saveJson('target.json', target.value);
  await assert.rejects(f.verify(), /Target driver fixture inputs differ/);
});

test('same-path changed HTML and PNG bytes cannot reuse an unchanged historical scenario', async t => {
  for (const relative of ['apps/mobile/fixtures/articles/notice.html', 'apps/mobile/assets/drawable/ic_app_logo.png']) {
    const f = await historicalProtocol(t, value => {value.scenarios['reader-load-error'].response.data = 'source_unavailable';}); await f.capture();
    await writeFile(path.join(f.root, relative), Buffer.from('same path, changed actual bytes'));
    await assert.rejects(f.verify(), /dependency bytes changed/);
  }
});

test('historical dependency manifests cannot be missing, tampered or invented after capture', async t => {
  for (const failure of ['missing', 'tampered', 'unbound']) {
    const f = await historicalProtocol(t, value => {value.scenarios['reader-load-error'].response.data = 'source_unavailable';}); await f.capture();
    const reference = f.coverage.historicalFixtureInputs[0].manifest, filename = path.join(f.root, reference.path);
    if (failure === 'missing') await rm(filename);
    if (failure === 'tampered') await writeFile(filename, Buffer.from('{}'));
    if (failure === 'unbound') {
      const invented = JSON.parse((await readFile(filename)).toString()); invented.retrospective = true;
      f.coverage.historicalFixtureInputs[0].manifest = await f.saveJson('invented-manifest.json', invented);
    }
    await assert.rejects(f.verify(), /ENOENT|hash mismatch|not bound to the captured driver/);
  }
});
