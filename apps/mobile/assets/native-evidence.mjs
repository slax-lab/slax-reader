import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, lstat, realpath} from 'node:fs/promises';
import path from 'node:path';
import {inflateSync} from 'node:zlib';

const fields = ['implementation', 'sourceRender', 'targetRender', 'functionalVerification', 'visualComparison'];
const statuses = new Set(['unverified', 'verified', 'failed']);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const deniedName = /(^\.env(?:\.|$)|^\.dev\.vars(?:\.|$)|credential|secret|private.?key|keystore|GoogleService|google-services)/i;
const recordKey = record => [record.platform, record.locale, record.conditions.appearance, record.conditions.fontScaleProfile].join('/');
function crc32(bytes) {let value = 0xffffffff; for (const byte of bytes) {value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);} return (value ^ 0xffffffff) >>> 0;}

export function nativePngDimensions(bytes) {
  assert(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'Native image must be a PNG');
  let position = 8, width, height, rowBytes, ended = false; const data = [];
  while (position + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(position), type = bytes.toString('ascii', position + 4, position + 8);
    assert(position + length + 12 <= bytes.length, 'Truncated native PNG chunk');
    assert.equal(crc32(bytes.subarray(position + 4, position + 8 + length)), bytes.readUInt32BE(position + 8 + length), 'Corrupt native PNG chunk');
    if (position === 8) {
      assert.equal(type, 'IHDR'); assert.equal(length, 13); width = bytes.readUInt32BE(position + 8); height = bytes.readUInt32BE(position + 12);
      const bits = bytes[position + 16], channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[bytes[position + 17]];
      assert(width > 0 && height > 0 && width * height <= 16_000_000 && channels && [1, 2, 4, 8, 16].includes(bits), 'Invalid native PNG raster');
      assert.equal(bytes[position + 18], 0); assert.equal(bytes[position + 19], 0); assert.equal(bytes[position + 20], 0, 'Interlaced native captures require an explicit decoder');
      rowBytes = Math.ceil(width * channels * bits / 8) + 1;
    } else if (type === 'IDAT') data.push(bytes.subarray(position + 8, position + 8 + length));
    position += length + 12;
    if (type === 'IEND') {ended = true; assert.equal(length, 0); break;}
  }
  assert(ended && position === bytes.length && data.length > 0, 'Incomplete native PNG');
  const raster = inflateSync(Buffer.concat(data), {maxOutputLength: 128 * 1024 * 1024});
  assert.equal(raster.length, rowBytes * height, 'Native PNG raster size mismatch');
  for (let row = 0; row < height; row++) assert(raster[row * rowBytes] <= 4, 'Invalid native PNG row filter');
  return {width, height};
}

/** Validate evidence integrity and declared measurements; this does not assess visual similarity. */
export async function verifyCoverageEvidence({coverage, repoRoot, sourceManifestSha256, fixtureInputSha256, scenarios, fixtureBundleBytes}) {
  const root = await realpath(path.resolve(repoRoot)), evidenceRoot = path.join(root, 'docs/mobile/evidence');
  const cache = new Map(), loading = new Set(); let captureCount = 0, comparisonCount = 0;
  async function artifact(reference, extensions, maxBytes = 16 * 1024 * 1024) {
    assert(reference && typeof reference.path === 'string' && /^[a-f0-9]{64}$/.test(reference.sha256), 'Evidence needs a relative path and SHA-256');
    const relative = reference.path, parts = relative.split('/');
    assert(!path.isAbsolute(relative) && !relative.includes('\\') && !parts.some(part => !part || part === '.' || part === '..' || deniedName.test(part)), 'Unsafe native evidence path');
    assert(relative.startsWith('docs/mobile/evidence/') && extensions.includes(path.extname(relative)), 'Evidence must use the documented native artifact directory/type');
    const filename = path.resolve(root, relative);
    let parent = root;
    for (const part of parts) {parent = path.join(parent, part); assert(!(await lstat(parent)).isSymbolicLink(), 'Native evidence cannot follow symlinks');}
    const canonical = await realpath(filename); assert(canonical.startsWith(evidenceRoot + path.sep), 'Evidence escaped its directory');
    const info = await lstat(filename); assert(info.isFile() && info.size > 0 && info.size <= maxBytes, 'Invalid native evidence file size');
    const bytes = await readFile(filename); assert.equal(digest(bytes), reference.sha256, `Native evidence hash mismatch: ${relative}`); return bytes;
  }
  async function currentPublicBytes(relative) {
    assert(/^(apps\/mobile\/fixtures\/(manifest\.json|documents\.ts|resources\.ts|articles\/[a-z-]+\.html)|apps\/mobile\/assets\/drawable\/ic_app_logo\.png)$/.test(relative), 'Historical dependencies must use closed public fixture paths');
    let filename = root;
    for (const part of relative.split('/')) {filename = path.join(filename, part); assert(!(await lstat(filename)).isSymbolicLink(), 'Current fixture dependencies cannot follow symlinks');}
    const info = await lstat(filename); assert(info.isFile() && info.size > 0 && info.size <= 4 * 1024 * 1024, 'Invalid current fixture dependency');
    return readFile(filename);
  }
  const historicalFixtures = new Map();
  for (const reference of coverage.historicalFixtureInputs ?? []) {
    assert(reference && /^[a-f0-9]{64}$/.test(reference.sha256) && !historicalFixtures.has(reference.sha256), 'Historical fixture archives must have unique SHA-256 identities');
    historicalFixtures.set(reference.sha256, reference);
  }
  async function verifyFixtureIdentity(value) {
    assert(/^[a-f0-9]{64}$/.test(value.fixtureInputSha256), 'Native capture needs its fixture SHA-256');
    if (value.fixtureInputSha256 === fixtureInputSha256) return;
    const reference = historicalFixtures.get(value.fixtureInputSha256);
    assert(reference, 'Native capture uses an older fixture bundle without archived provenance');
    assert(fixtureBundleBytes && digest(fixtureBundleBytes) === fixtureInputSha256, 'Historical fixture validation needs the exact current bundle bytes');
    const archived = JSON.parse((await artifact(reference, ['.json'], 4 * 1024 * 1024)).toString('utf8'));
    const current = JSON.parse(fixtureBundleBytes.toString('utf8'));
    const {scenarios: archivedScenarios, ...archivedGlobals} = archived;
    const {scenarios: currentScenarios, ...currentGlobals} = current;
    assert.deepEqual(archivedGlobals, currentGlobals, 'Historical fixture global origins/documents/artwork or configuration changed');
    assert(archivedScenarios && currentScenarios && Object.hasOwn(archivedScenarios, value.fixtureScenario) && Object.hasOwn(currentScenarios, value.fixtureScenario), 'Historical fixture declared scenario is missing');
    assert.deepEqual(archivedScenarios[value.fixtureScenario], currentScenarios[value.fixtureScenario], 'Historical fixture declared scenario changed; fresh native captures are required');
    const oldManifest = JSON.parse((await artifact(reference.manifest, ['.json'], 256 * 1024)).toString('utf8'));
    const currentManifest = JSON.parse((await currentPublicBytes('apps/mobile/fixtures/manifest.json')).toString('utf8'));
    assert(oldManifest.synthetic === true && currentManifest.synthetic === true && Array.isArray(oldManifest.files) && Array.isArray(currentManifest.files), 'Historical fixture dependencies need real pinned manifests');
    assert.deepEqual(oldManifest.files.map(entry => entry.path).sort(), currentManifest.files.map(entry => entry.path).sort(), 'Historical fixture dependency paths changed');
    const dependencies = new Map();
    for (const entry of oldManifest.files) {
      assert(/^(scenarios\.json|documents\.ts|resources\.ts|articles\/[a-z-]+\.html)$/.test(entry.path) && !dependencies.has(entry.path), 'Historical fixture manifest contains an unsafe or duplicate dependency');
      const bytes = await artifact({path: path.posix.join(path.posix.dirname(reference.path), entry.path), sha256: entry.sha256}, [path.extname(entry.path)], 4 * 1024 * 1024);
      dependencies.set(entry.path, bytes);
      if (entry.path === 'scenarios.json') {assert.equal(entry.sha256, value.fixtureInputSha256, 'Historical manifest scenario identity differs'); assert.equal(currentManifest.files.find(currentEntry => currentEntry.path === entry.path)?.sha256, fixtureInputSha256, 'Current manifest scenario identity differs'); continue;}
      const actual = await currentPublicBytes('apps/mobile/fixtures/' + entry.path);
      assert.equal(digest(actual), entry.sha256, 'Historical fixture dependency bytes changed: ' + entry.path);
      assert.equal(currentManifest.files.find(currentEntry => currentEntry.path === entry.path)?.sha256, digest(actual), 'Current fixture manifest differs from actual dependency bytes');
    }
    assert(dependencies.has('scenarios.json') && dependencies.has('documents.ts') && dependencies.has('resources.ts'), 'Historical fixture required dependencies are absent');
    for (const document of Object.values(archived.documents ?? {})) assert(dependencies.has(document), 'Historical global document bytes are absent');
    for (const article of archivedScenarios[value.fixtureScenario].payload?.cache ?? []) assert(dependencies.has(article.htmlFile), 'Historical declared article bytes are absent');
    // The captured generator prewrites the single public logo for every successful
    // synthetic artwork URL. Its archived resource export contains the exact bytes.
    const artworkMatch = dependencies.get('resources.ts').toString('utf8').match(/export const fixtureArtworkBase64 = ("[A-Za-z0-9+/=]+");/);
    assert(artworkMatch, 'Historical artwork needs its captured resource bytes');
    const encodedArtwork = JSON.parse(artworkMatch[1]), artworkBytes = Buffer.from(encodedArtwork, 'base64');
    assert.equal(artworkBytes.toString('base64'), encodedArtwork, 'Historical artwork encoding is invalid');
    for (const artwork of Object.values(archived.artwork ?? {})) if (artwork.asset) {
      assert.equal(artwork.asset, '../assets/drawable/ic_app_logo.png', 'Unknown historical artwork requires explicit captured byte provenance');
      assert.equal(digest(await currentPublicBytes('apps/mobile/assets/drawable/ic_app_logo.png')), digest(artworkBytes), 'Historical artwork dependency bytes changed');
    }
  }
  async function captureProvenance(value) {
    const capturedFixtureSha256 = value.fixtureInputSha256;
    const raw = JSON.parse((await artifact(value.rawMetadata, ['.json'], 256 * 1024)).toString('utf8'));
    assert.equal(raw.controlledFixture, true); assert.equal(raw.scenario, value.fixtureScenario);
    assert.equal(raw.locale, value.locale); assert.equal(raw.inputSha256, capturedFixtureSha256);
    const measured = raw.nativeMeasurements ?? {
      platform: raw.platform, osVersion: raw.osVersion, deviceModel: raw.deviceModel, appearance: raw.appearance,
      pixelRatio: raw.density, fontScale: raw.fontScale, fontScaleProfile: raw.fontScaleProfile, safeArea: raw.safeArea,
      widthPixels: raw.widthPixels, heightPixels: raw.heightPixels,
    };
    const c = value.conditions;
    assert.equal(measured.platform, value.platform, 'Raw native platform differs');
    for (const field of ['osVersion', 'deviceModel', 'appearance', 'pixelRatio', 'fontScale', 'fontScaleProfile']) {
      assert.equal(measured[field], c[field], `Raw native ${field} differs`);
    }
    assert.equal(measured.widthPixels ?? Math.round(measured.screen?.width * measured.pixelRatio), c.widthPixels);
    assert.equal(measured.heightPixels ?? Math.round(measured.screen?.height * measured.pixelRatio), c.heightPixels);
    for (const edge of ['top', 'bottom', 'left', 'right']) {
      assert.equal(Number(measured.safeArea?.[edge]?.toFixed(6)), c.safeArea[edge], 'Raw native safe area differs');
    }
    assert(typeof value.clockVerification === 'string' && value.clockVerification.trim(), 'Displayed clock needs native-frame inspection');
    assert(Number.isFinite(value.capturedAtMillis) && value.capturedAtMillis > 0, 'Native capture needs its capture time');
    const driverBytes = await artifact(value.actionDriverInputs, ['.json'], 512 * 1024);
    const driver = JSON.parse(driverBytes.toString('utf8'));
    if (value.fixtureInputSha256 !== fixtureInputSha256) {
      const archived = historicalFixtures.get(value.fixtureInputSha256);
      const manifestEntry = value.implementation === 'source' && value.platform === 'android'
        ? driver.overlayDigests?.find(entry => entry.path === 'composeApp/src/androidInstrumentedTest/assets/slax-ui-fixtures/manifest.json')
        : value.implementation === 'target' ? driver.generatedSourceDigests?.find(entry => entry.path === 'fixtures/manifest.json') : null;
      assert(manifestEntry && manifestEntry.sha256 === archived?.manifest?.sha256, 'Historical dependency manifest was not bound to the captured driver inputs');
    }
    if (value.implementation === 'source' && value.platform === 'android') {
      assert.equal(driver.controlledFixture, true); assert.equal(driver.fixtureInputSha256, capturedFixtureSha256);
      assert.equal(driver.sourceManifestSha256, sourceManifestSha256);
      assert.equal(driver.sourceCheckoutModified, false); assert.equal(driver.originalBuildConfigurationCopied, false);
      const entries = driver.overlayDigests;
      assert(Array.isArray(entries) && entries.length > 0, 'Source capture needs its archived overlay inputs');
      const names = new Set();
      for (const entry of entries) {
        assert(!names.has(entry.path), 'Source capture overlay contains duplicate paths'); names.add(entry.path);
        const extension = path.extname(entry.path);
        assert(['.md', '.kt', '.kts', '.json', '.xml', '.html', '.ts', '.properties'].includes(extension), 'Unexpected source overlay input');
        await artifact({path: path.posix.join(path.posix.dirname(value.actionDriverInputs.path), entry.path), sha256: entry.sha256}, [extension], 4 * 1024 * 1024);
      }
      const captureInput = 'composeApp/src/androidInstrumentedTest/assets/slax-ui-fixtures/source-capture-inputs.json';
      assert(names.has(captureInput), 'Source capture inputs are missing');
      const compiledHash = digest(Buffer.from(JSON.stringify(entries.filter(entry => entry.path !== captureInput).map(entry => ({path: entry.path, sha256: entry.sha256})))));
      assert.equal(compiledHash, value.actionDriverSha256, 'Source compiled driver differs from archived inputs');
      assert.equal(raw.actionDriverSha256, compiledHash, 'Raw source driver differs');
      const build = JSON.parse((await artifact(value.sourceBuild, ['.json'], 256 * 1024)).toString('utf8'));
      assert.equal(build.kind, 'sanitized-source-android-build'); assert.equal(build.result, 'passed');
      assert.equal(build.actionDriverSha256, compiledHash); assert.equal(build.fixtureInputSha256, capturedFixtureSha256);
      assert.equal(build.sourceManifestSha256, sourceManifestSha256); assert.equal(build.originalSourceModified, false);
      assert.deepEqual(build.inputManifest, value.actionDriverInputs, 'Source build input manifest differs');
    } else if (value.implementation === 'target') {
      assert.equal(driver.kind, 'slax-ui-fixture-project');
      assert.equal(digest(driverBytes), value.actionDriverSha256, 'Target driver differs from archived inputs');
      assert(driver.generatedSourceDigests?.some(entry => entry.path === 'fixtures/scenarios.json' && entry.sha256 === capturedFixtureSha256), 'Target driver fixture inputs differ');
    }
  }
  async function record(reference, item) {
    const key = reference.path + '/' + reference.sha256;
    if (cache.has(key)) {const cached = cache.get(key); assert.equal(cached.caseId, item.id, 'Evidence cannot be reused for a different state'); return cached;}
    assert(!loading.has(key), 'Native evidence references form a cycle'); loading.add(key);
    const value = JSON.parse((await artifact(reference, ['.json'], 256 * 1024)).toString('utf8'));
    assert.equal(value.schemaVersion, 1); assert.equal(value.caseId, item.id, 'Native evidence must identify its coverage state');
    assert.equal(value.sourceManifestSha256, sourceManifestSha256, 'Native capture source baseline differs');
    assert(item.requiredPlatforms.includes(value.platform) && item.requiredLocales.includes(value.locale), 'Native capture platform/locale is outside the case');
    if (value.kind === 'native-ui-capture') {
      assert(['source', 'target'].includes(value.implementation));
      assert(['android-ui-automation', 'adb-screencap', 'simctl-screenshot'].includes(value.captureMethod), 'Prepared/browser frames are not native captures');
      assert(value.platform === 'android' ? value.captureMethod !== 'simctl-screenshot' : value.captureMethod === 'simctl-screenshot');
      assert(scenarios.includes(value.fixtureScenario), 'Native capture scenario is not prepared');
      await verifyFixtureIdentity(value);
      assert(typeof value.stateAssertion === 'string' && value.stateAssertion.trim(), 'Native capture must explain the state actually shown');
      assert(/^[a-f0-9]{64}$/.test(value.actionDriverSha256), 'Native capture needs its compiled/action driver digest');
      const c = value.conditions;
      assert(c && ['deviceModel', 'osVersion', 'clock'].every(field => typeof c[field] === 'string' && c[field].trim()), 'Native conditions are incomplete');
      assert(coverage.comparisonSettings.appearances.includes(c.appearance) && coverage.comparisonSettings.fontScales.includes(c.fontScaleProfile));
      assert(Number.isFinite(c.pixelRatio) && c.pixelRatio > 0 && Number.isFinite(c.fontScale) && c.fontScale > 0);
      assert(c.fontScaleProfile === 'default' ? c.fontScale === 1 : c.fontScale > 1, 'Font scale profile must match the measured native scale');
      assert(Number.isInteger(c.widthPixels) && Number.isInteger(c.heightPixels) && c.widthPixels > 0 && c.heightPixels > 0);
      assert(c.safeArea && ['top', 'bottom', 'left', 'right'].every(edge => Number.isFinite(c.safeArea[edge]) && c.safeArea[edge] >= 0));
      const image = nativePngDimensions(await artifact(value.image, ['.png']));
      assert.equal(image.width, c.widthPixels); assert.equal(image.height, c.heightPixels);
      await captureProvenance(value);
      assert.equal(typeof value.nativeInteractionVerified, 'boolean');
      if (value.nativeInteractionVerified) {
        const movie = await artifact(value.interactionRecording, ['.mp4', '.mov'], 128 * 1024 * 1024);
        assert(movie.length >= 12 && movie.toString('ascii', 4, 8) === 'ftyp', 'Native interaction recording must be an MP4/MOV container');
        const log = JSON.parse((await artifact(value.nativeInputLog, ['.json'], 256 * 1024)).toString('utf8'));
        assert.equal(log.kind, 'native-input-log'); assert.equal(log.caseId, item.id); assert.equal(log.platform, value.platform);
        assert(Array.isArray(log.events) && log.events.length > 0 && log.events.every(event => event.native === true && typeof event.action === 'string' && event.action.trim()), 'Programmatic state preparation cannot verify native interaction');
      }
      for (const field of ['implementation', 'functionalVerification']) if (value.checks?.[field] !== undefined) assert(['passed', 'failed'].includes(value.checks[field]));
      if (value.checks?.functionalVerification !== undefined) assert(value.nativeInteractionVerified, 'Functional acceptance requires native inputs and recordings');
      captureCount++;
    } else {
      assert.equal(value.kind, 'native-ui-comparison'); assert(['passed', 'failed'].includes(value.result));
      assert(['agent', 'human'].includes(value.reviewedBy) && typeof value.rationale === 'string' && value.rationale.trim(), 'Visual decisions need inspected-frame rationale');
      const source = await record(value.sourceCapture, item), target = await record(value.targetCapture, item);
      assert.equal(source.kind, 'native-ui-capture'); assert.equal(target.kind, 'native-ui-capture');
      assert.equal(source.implementation, 'source'); assert.equal(target.implementation, 'target');
      assert.equal(source.fixtureInputSha256, target.fixtureInputSha256, 'Native source/target must retain the same actual fixture bundle');
      assert.equal(value.fixtureInputSha256, source.fixtureInputSha256, 'Comparison fixture identity differs from its native captures');
      assert.equal(source.fixtureScenario, target.fixtureScenario, 'Comparison must show the same declared fixture scenario');
      assert.equal(recordKey(source), recordKey(target), 'Native source/target conditions must match'); assert.equal(value.platform, source.platform); assert.equal(value.locale, source.locale);
      assert.deepEqual(source.conditions, target.conditions, 'Native source/target conditions must match');
      value.conditions = source.conditions;
      assert(Array.isArray(value.exclusions));
      for (const exclusion of value.exclusions) {
        assert(coverage.allowedVisualExclusions.some(allowed => allowed.id === exclusion.id));
        assert(exclusion.wholeHeaderExcluded === false && typeof exclusion.reason === 'string' && exclusion.reason.trim());
        const b = exclusion.bounds, c = source.conditions;
        assert(b && ['x', 'y', 'width', 'height'].every(field => Number.isInteger(b[field])) && b.x >= 0 && b.y >= 0 && b.width > 0 && b.height > 0);
        assert(b.x + b.width <= c.widthPixels && b.y + b.height <= c.heightPixels && b.width < c.widthPixels && b.height < c.heightPixels, 'Visual exclusions cannot mask entire headers or frames');
      }
      comparisonCount++;
    }
    loading.delete(key); cache.set(key, value); return value;
  }
  for (const item of coverage.cases) {
    for (const field of fields) assert(statuses.has(item[field]), `Unknown coverage status: ${item.id}/${field}`);
    assert(Array.isArray(item.evidence));
    const records = [];
    for (const reference of item.evidence) records.push(await record(reference, item));
    const matrix = item.requiredPlatforms.flatMap(platform => item.requiredLocales.flatMap(locale => coverage.comparisonSettings.appearances.flatMap(appearance => coverage.comparisonSettings.fontScales.map(scale => [platform, locale, appearance, scale].join('/')))));
    for (const field of fields) {
      if (item[field] === 'unverified') continue;
      const accepted = records.filter(value => {
        if (field === 'visualComparison') return value.kind === 'native-ui-comparison' && value.result === (item[field] === 'verified' ? 'passed' : 'failed');
        if (value.kind !== 'native-ui-capture') return false;
        if (field === 'sourceRender' || field === 'targetRender') return item[field] === 'verified' && value.implementation === (field === 'sourceRender' ? 'source' : 'target');
        return value.implementation === 'target' && value.checks?.[field] === (item[field] === 'verified' ? 'passed' : 'failed');
      });
      if (item[field] === 'verified') {
        assert(matrix.every(key => accepted.some(value => recordKey(value) === key)), `Incomplete native evidence matrix: ${item.id}/${field}`);
        if (field === 'implementation') assert(item.targetFiles.length > 0, 'Implementation acceptance needs its target locations');
      } else assert(accepted.length > 0, `Failed status lacks state-indexed evidence: ${item.id}/${field}`);
    }
  }
  return {captureCount, comparisonCount, nativeParity: coverage.cases.every(item => item.visualComparison === 'verified') ? 'verified' : 'unverified'};
}
